# 0043 — 多阶段预标注编排(路径 B:平台层跨 backend pipeline)

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** core team
- **Supersedes:** —(在 [ADR-0036](./0036-ml-backend-capability-protocol-v2-multi-model.md) 协议 v2 之上做平台层加法,不推翻)

## Context

[ADR-0020](./0020-ml-backend-capability-negotiation.md) + [ADR-0036](./0036-ml-backend-capability-protocol-v2-multi-model.md) 让一个 backend 能在 `/setup` 自报 N 个 model,但**单次 `/predict` 调用仍是单 backend × 单 model**。生产场景频繁出现「先检测再做属性分类」这类**跨 backend 流水线**——典型样例:

- 车辆框由通用检测器(`yolo` / `gsam2` / `onnxtools-rtdetr`)出 → 车型 / 颜色 / 车牌属性由 `onnxtools-va` 出
- 行人检测 → 性别 / 年龄 / 着装属性分类
- 文档版面分析 → 各区块 OCR

v0.18.0 用**路径 A**(`onnxtools-backend` 自维护「rtdetr 检测 → va 分类」二阶段 pipeline)落地了首个二阶段预标注,但路径 A 的扩展性是 **N × M 复杂度爆炸**:每加一个「检测器 × 分类器」组合都要新写一个 backend。业务需求是「任意检测器 × 任意分类器自由组合,复用现有任意 backend、零改造」——必须把编排从 backend 内部上提到**平台层**。

候选方案:

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A. 平台层声明式 `pipeline_stages`(线性阶段卡)** | 单数据结构 + 单 worker 函数覆盖 90% 真实场景;复用现有 `/setup` 能力声明,backend 零改;前端编排 UI 简单(每阶段一张卡) | 不支持运行时分支 / 深度 ≥ 3 扇出 / 循环 / 任意 DAG;不直接表达「source 出 N 类框 → 各类喂不同分类器」之外的拓扑 |
| B. 节点图 DAG 编排(visual graph) | 任意拓扑 / 自助编排 / 可视化强 | 实现成本指数级(DAG 引擎 + 拓扑校验 + cycle 检测 + 节点编辑器 UI);现实需求未到深度 ≥ 3 / 运行时分支,过度设计 |
| C. 每加一个组合都自写 backend(路径 A 推广) | 协议不动 | N × M 复杂度爆炸;backend 仓库膨胀;模型组合策略锁在 Python 代码里非配置 |
| D. backend 间直接互调 | 编排逻辑离模型最近 | backend 互相耦合;平台失去观测 / 失败兜底 / 统计能力;违背 backend 自描述初衷 |

## Decision

**路径 B:平台层声明式 `pipeline_stages` 线性阶段卡编排**——把跨 backend 流水线从 backend 内部上提到平台 worker,backend 仍只看到自己的单次 `/predict` 调用。完整实现散落在以下文件,本 ADR 锁定关键约束。

### 1. 协议形态:`PreannotateRequest.pipeline_stages`(纯加法)

`POST /api/v1/projects/{id}/preannotate` 新增可选 `pipeline_stages: list[Stage]`。缺省(无 `pipeline_stages`)与单阶段批量预标**逐字等价**,完全向后兼容。完整字段表 + 请求体示例见 [prediction-pipeline §多阶段预标注](../../docs-site/dev/concepts/prediction-pipeline.md#多阶段预标注pipeline_stages路径-b)。

### 2. 单层声明式并行兄弟(非 Celery chord)

同一 `parent_stage` 可挂多个下游阶段(车辆框 → 颜色 + 车型 + 车牌 OCR 各写不同属性键),结果按 `write.keys` union 合并进同一框。**声明形态是「并行」语义(下游兄弟互不依赖)**,**实施层当前是 worker 内顺序串跑各兄弟阶段**——不是 Celery chord。

- chord 真并行作 v0.18.7 单列计划([docs/plans/2026-06-23-v0.18.7-staged-preannotate-chord-parallelism.md](../../docs/plans/2026-06-23-v0.18.7-staged-preannotate-chord-parallelism.md))**被搁置**:无实测 wall-clock 压力前不实施,避免引入 chord 编排复杂度换不到收益。
- 声明形态本身是并行,后续切 chord **不破协议**——`pipeline_stages` 的 `parent_stage` 字段已足够推断并行兄弟集合。

### 3. ROI 路由:`_stage_input_mode` 按下游 `supported_prompts` 自动判别

worker 根据下游 model 的 `supported_prompts` 自动选投递方式([apps/api/app/workers/tasks.py:171](../../apps/api/app/workers/tasks.py)):

- **`crop` 模式**(纯分类,如 `onnxtools-va` / `yolo-cls`):平台按 `parent_class_filter` 裁父框 ROI(`pad` 默认 5%)逐父框喂下游。
- **`geometry` 模式**(含 `bbox` 且非交互,如 `gsam2-box-seg`):全图 URL + 父框归一化坐标列表(`tasks[].prompts[]`)整批喂下游;下游 `set_image` 一次、N 框共享 embedding 出 polygon。下游返回带 `parent_box_idx`,平台按 idx 还原到原图坐标后追加进父框预测。

路由由 backend 自报能力驱动,**不**让用户在编排面板手选模式——避免「配错模式跑不出来」类的运维负担。

### 4. crop 投递通用化(presigned URL,v0.18.4)

crop 默认走 **presigned URL** 而非 `data:` base64:平台把裁好的 ROI 上传 import 桶(key=`roi-crops/{job_id}/{task_id}/{box_idx}.jpg`,7 天 lifecycle 自动清),URL 经 `StorageService.rewrite_host_for_ml_backend` 重写到 backend 可拉取的 host。所有走 `httpx.get` 的下游 backend(gsam2 / sam3)**零改造**可作分类阶段。`data:` 内联保留为纯函数快路径(单测 / 已知支持 `data:` 的 backend:onnxtools / yolo),由 `_make_crop_uploader` 是否注入 `upload_crop` 选择路径。

并行兄弟阶段 target 同一批父框时按 `(box_idx, pad)` 复用已裁 / 已上传 crop,不重复裁剪 + 重编码 + 重上传。

### 5. 协议 v2.2 `composition` 维度(atom / composite)

model 条目可声明 `composition: "atom" | "composite"`(缺省 `atom`):

- `atom`:能力是原子单元(单一模型,如 `vehicle-detect` / `vehicle-attr-classify` / `gsam2-box-seg`)。
- `composite`:内部已编排多步流程(如 `vehicle-attr` 内部串 rtdetr + va 一锅端)。

**编排下游 stage 选择器只接 `atom`**(避免重复编排或「composite 套 composite」语义不清);**单阶段配置面板不过滤**——`composite` 可作开箱即用默认。

(v0.18.11 曾引入 `visibility: internal | public` 字段,v0.18.13 删除——`composition` 已足够覆盖过滤语义,`visibility` 与之重载、徒增协议表面积。)

### 6. 配置硬化:chip 多选 + 键冲突配置期预警(v0.18.5)

阶段卡 `parent_class_filter` / `write.keys` 从自由文本框升级为 **chip 多选**——类别取项目类别,属性键取下游 backend 自报的 `output_attribute_schema`(回落项目 `attribute_schema`)。**杜绝拼写误配静默过滤**(管理员手敲属性 key 拼错时,过去要跑完才发现没写回)。

并行兄弟写同一属性键时**配置期红字 + 红 chip 预警**:默认 `on_key_conflict=reject`(运行时 422),勾选「允许末位覆盖」后切 `last_wins` 放行。不再让冲突在跑完后才暴露。

### 7. 实时统计:5% 步长 WS + 终态真值双通道

worker 累加各阶段 stats(源阶段 `{detected}`、下游 `{targeted, ok, failed, skipped_geometry}`):

- **运行中**:按 5% 步长把当前累加 `pipeline_stages` 随进度推上 WS `project:{id}:preannotate`(复用现有通道,不新增)。前端阶段卡实时下放,显「待运行 / 运行中 / 已完成」徽标 + 计数 + `ProgressBar`。
- **终态**:`async_jobs.result.pipeline_stages` 落库(job 终态写一次)。WS 重连或运行后回看一律走终态字段,不丢。

### 8. 拓扑落库可追溯

`_pipeline_topology` 把 stages 配置派生为可审计拓扑落 `PredictionMeta.extra.pipeline`(`stage_count` / `enriched_attr_keys` / `stages: [...]`,见 prediction-pipeline 文档示例)。「这框的某属性来自哪个 backend / model」可逐条追溯,**不改表**(仍在 `PredictionMeta.extra` JSONB 内)。

### 9. 几何不支持的父框不静默(`skipped_geometry`)

旋转框 / 多边形 / 退化框命中阶段路由但几何不支持(`crop_inputs_from_boxes` 无法裁 ROI)的父框数计入 `stats[si].skipped_geometry`,逐阶段统计暴露「N 框因几何不支持未富集」。运维侧能看见「为什么这批的属性少」。

### 10. 失败粒度:阶段级 `on_failure`(`keep_parent` / `drop_box`)

下游分类失败不再整 task 失败:

- `keep_parent`(默认):保留上游父框,属性留空 + `logger.warning`。
- `drop_box`:丢弃该父框(适用于「下游分类是必填业务关键属性,缺则视为无效检测」的场景)。

## Consequences

正向:

- **任意检测器 × 任意分类器自由组合**:`yolo` det + `onnxtools` cls / `gsam2 box-seg` + `onnxtools` cls / `onnxtools-rtdetr` + `onnxtools-va-classify` 都可声明式编排,backend 零改。
- **配置 UX 收敛**:doc / 几何 / 文本三路径彻底统一为「选 model(= 模型市场卡片)」单一交互,文本路径(gsam2/sam3)不再是「输出形态开关」特例。
- **观测 / 追溯到 backend × model 粒度**:`PredictionMeta.extra.pipeline.stages` + `async_jobs.result.pipeline_stages` 让「属性来自谁」可逐条审计。
- **失败粒度细化**:从「整 task 失败」降到「阶段级降级」,部分成功仍写库。

负向:

- **worker 内顺序串跑**:并行兄弟当前不真并行,wall-clock = 各兄弟阶段时间之和;chord 真并行被搁置等实测压力。**已留协议位**(`parent_stage` 字段),切 chord 不破协议。
- **crop 临时对象依赖 import 桶 lifecycle**:7 天 auto-clean;高频大批量下堆积量需观测,必要时 job 终态主动删 `roi-crops/{job_id}/` 前缀。
- **不支持复杂拓扑**:无深度 ≥ 3 扇出 / 运行时动态分支 / 循环 / 用户自助任意拓扑——这些场景留待真实需求驱动再扩(节点图作下一档增量,不在本 ADR 范围)。
- **`MAX_ML_BACKENDS_PER_PROJECT` 1 → 3**:跨 backend 编排天然需 ≥ 2 backend,留一档余量;显存预算责任落到运维侧。

## Alternatives Considered(详)

**方案 B(节点图 DAG)**:能表达任意拓扑,但现实需求清单收敛到「线性 + 单层扇出」——v0.18.x 真实跑过的所有组合都是「source 出框 → 各类喂不同分类器(N 个并行兄弟)」,**没有**深度 ≥ 3 扇出 / 运行时分支 / 循环。节点图引擎 + 拓扑校验 + cycle 检测 + 节点编辑器 UI 的实现成本是线性卡 5–10 倍,而带来的表达力增量在当前没有真实兑现入口——典型过度设计。**触发条件**:出现明确「深度 ≥ 3 扇出」或「需要用户自助配置任意拓扑」业务时再上,届时声明式 `pipeline_stages` 自然成为节点图的「DSL 序列化形式」。

**方案 C(全部走路径 A,backend 内自维护组合)**:N × M 复杂度爆炸。`yolo-det × onnxtools-va` / `gsam2-det × onnxtools-va` / 后续 `行人检测 × 属性分类` / `版面 × OCR` 都得各起一个 backend。模型仓库膨胀,组合策略锁在 Python 代码非配置——管理员想换检测器要走代码改动 + 镜像构建。**保留**:`vehicle-attr`(rtdetr + va 一锅端)作 `composition=composite` 单阶段开箱即用入口保留,但不再作组合复用模板。

**方案 D(backend 间直接互调)**:让 backend 在 `/predict` 内部 fetch 另一个 backend——backend 互相耦合,平台失去观测 / 失败兜底 / 统计能力,违背 backend 自描述初衷(每个 backend 只应描述自己能做什么,不应感知其他 backend 的存在)。

## Notes

- **核心实现**:
  - 协议:`apps/api/app/schemas/preannotate.py::PreannotateRequest.pipeline_stages`
  - Worker:`apps/api/app/workers/tasks.py::_run_batch` / `_run_task_pipeline` / `_stage_input_mode` / `_make_crop_uploader` / `_pipeline_topology`
  - ROI 路由:`apps/api/app/workers/roi.py`(`crop_inputs_from_boxes` / `geometry_prompts_from_boxes` / `collect_geometry_shapes` / `merge_classify_attributes`)
  - 采纳端点 `attribute_overrides`:`apps/api/app/api/v1/tasks/predictions.py::accept_prediction`
  - 协议 v2.2 `composition`:`apps/api/app/schemas/ml_backend.py::ModelCapability` / `InstanceModelItem`
- **前端**:`apps/web/src/pages/AIPreAnnotate/components/StageCard.tsx`(阶段卡 + 实时统计)、`PreannotateConfigForm.tsx`(model-first 单一下拉)、`ImportAttributesFromBackendDialog.tsx`(从 ML Backend 导入属性)
- **相关 ADR**:
  - [ADR-0020](./0020-ml-backend-capability-negotiation.md)(`/setup` 能力协商)
  - [ADR-0036](./0036-ml-backend-capability-protocol-v2-multi-model.md)(协议 v2 多模型目录,本 ADR 在其上做平台层加法)
  - [ADR-0037](./0037-protocol-capability-catalog-decoupling.md)(协议 / 能力目录解耦,`composition` 沿同一透传路径)
- **相关文档**:
  - [prediction-pipeline §多阶段预标注](../../docs-site/dev/concepts/prediction-pipeline.md#多阶段预标注pipeline_stages路径-b)
  - [ai-preannotate-handoff §采纳前候选属性预览](../../docs-site/dev/concepts/ai-preannotate-handoff.md#采纳前候选属性预览--分步采纳v0180--v0183)
  - [ai-models §6.2 onnxtools-backend](../../docs-site/dev/concepts/ai-models.md#62-onnxtools-backend8004--gpu-onnxtoolsv0180)
- **后续演进 / 触发条件**:
  - **Celery chord 真并行**:实测发现并行兄弟 wall-clock 成单 task 瓶颈时启用([v0.18.7 plan](../../docs/plans/2026-06-23-v0.18.7-staged-preannotate-chord-parallelism.md))。
  - **`stage_index` / `parent_prediction_id` 正式表列**:目前在 `PredictionMeta.extra.pipeline` JSONB 内,频繁需要按 stage 索引 / 按父预测查时升正式列(加索引)。
  - **节点图编排**:出现深度 ≥ 3 扇出 / 运行时分支需求时考虑;声明式 `pipeline_stages` 作 DSL 序列化形式可承接。
  - **下游产独立几何 `write=new_shape`**:`gsam2-box-seg` 已在 v0.18.12 用 `collect_geometry_shapes` 实现追加独立 polygon shape,后续如需更复杂的「下游 shape 覆盖上游 shape」语义,加 `write.mode` 维度。
