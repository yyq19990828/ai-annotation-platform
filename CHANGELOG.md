# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.17.x | [docs/changelogs/0.17.x.md](docs/changelogs/0.17.x.md) |
| 0.16.x | [docs/changelogs/0.16.x.md](docs/changelogs/0.16.x.md) |
| 0.15.x | [docs/changelogs/0.15.x.md](docs/changelogs/0.15.x.md) |
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## 最新版本

<!-- 0.18.x 版本变更按版本段追加到本区；进入 0.19.x 后整体移到 docs/changelogs/0.18.x.md -->

## [0.18.5] - 2026-06-23

多阶段预标注（路径 B）配置硬化：把下游阶段卡里最容易让人「配了没反应」的自由文本框升级为选择器，并把键冲突校验从「跑完才 422」前移到配置期。纯前端。方案见 [`docs/plans/2026-06-23-v0.18.5-staged-preannotate-config-hardening.md`](docs/plans/2026-06-23-v0.18.5-staged-preannotate-config-hardening.md)。

### Changed

- **父框类别 / 写回属性键选择器化**：阶段卡的 `parent_class_filter` 与 `write.keys` 从逗号分隔文本框改为 chip 多选——类别取项目类别，属性键优先取下游 backend 自报的 `output_attribute_schema`（回落项目 `attribute_schema`）。非工程师管理员全程点选、不再手敲，杜绝拼写误配静默过滤。

### Added

- **键冲突配置期预警**：多张并行阶段卡写同一属性键时，配置期即红字提示 + 涉事 chip 标红；默认拦截运行（对应后端 `on_key_conflict=reject`），勾选「允许末位覆盖」后放行（`last_wins`），不再跑完才 422。
- **下游 backend 能力门控**：阶段卡选中的下游 backend 若不自报输出属性（纯检测器），给 ⚠ 警示「作下游只会重新检测、属性恒空」。
- **单 backend 兜底**：项目只绑 1 个 backend 时，加分类阶段处提示「需先绑定第二个 ML backend」，不再静默不可用。

## [0.18.4] - 2026-06-23

多阶段预标注（路径 B）后端补强：修一处实质兼容缺口——下游 crop 此前用 `data:` base64 内联投递，只有支持 `data:` 的后端（onnxtools/yolo）能作下游，而走 `httpx.get` 的 gsam2/sam3 收到 data URI 直接失败。本期把 crop 投递改成对所有后端通用，并补健壮性/可观测/测试。方案见 [`docs/plans/2026-06-23-v0.18.4-staged-preannotate-backend-hardening.md`](docs/plans/2026-06-23-v0.18.4-staged-preannotate-backend-hardening.md)。

### Changed

- **crop 投递通用化**：平台裁好的 ROI crop 改为上传对象存储（import 桶，挂 7 天 lifecycle 自动清）→ presigned URL 投递，所有走 `httpx.get` 的下游后端零改造可作分类阶段（此前 data URI 仅部分后端兼容）。crop URL 与 task URL 共用同一 host 解析逻辑（抽成 `StorageService.rewrite_host_for_ml_backend`）。`data:` 内联保留为纯函数快路径（单测/已知支持的后端）。

### Added

- **crop 编码复用**：并行兄弟阶段 target 同一批父框时，按 `(box_idx, pad)` 复用已裁/已上传 crop，不重复裁剪 + 重编码 + 重上传。
- **pipeline 拓扑落库**：`PredictionMeta.extra.pipeline.stages` 记每阶段 `{stage, ml_backend_id, model_id, parent_class_filter, write_keys}`，让「这框的某属性来自哪个 backend/model」可追溯。
- **几何跳过统计**：命中阶段路由但因几何不支持（旋转框/多边形/退化框）无法裁 crop 的父框数，计入逐阶段统计 `skipped_geometry`，不再静默跳过。

### Notes

- 下游分类失败由 `print()` 改 `logger.warning()`，对齐 worker 模块日志约定。
- crop 临时对象依赖 import 桶 lifecycle 清理；高频大批量下堆积量需观测，必要时 job 终态主动删前缀。

## [0.18.3] - 2026-06-23

多阶段预标注（路径 B）收尾：补审阅侧与运行态，把整条「检测→分类→写属性→人审」闭环跑通。方案见 [`docs/plans/2026-06-23-v0.18.3-staged-preannotate-ui-productization.md`](docs/plans/2026-06-23-v0.18.3-staged-preannotate-ui-productization.md)。

### Added

- **候选属性审阅 + 分步采纳**：工作台选中未落库的 AI 候选时，底部「属性审阅」区从只读升为**可编辑**——先看多阶段预标产出的 select/multiselect 属性、改后再采纳；改动经采纳端点的 `attribute_overrides` 原子落库（而非一步全采纳原值再改）。
- **运行态逐阶段统计**：`/ai-pre` 多阶段批跑完后，展示逐阶段统计（阶段 1 检出框数 / 各下游分类阶段「目标·成功·失败」计数），轮询 async_job 结果实时刷新。
- **采纳端点 `attribute_overrides`**：`POST /tasks/{id}/predictions/{pid}/accept` 新增可选 body `attribute_overrides`，按属性键覆盖 shape 自带 attributes 落库（内部键 `_shape_index` 等不受影响）。

### Notes

- 编排界面维持**线性阶段卡**形态，未引入节点图（路径 B 决议：无深度≥3 扇出 / 运行时动态分支 / 循环 / 用户自助任意拓扑，节点图即过度设计）。
- 下列项按「实测未出现驱动」暂不实装、留待真实需求：下游产独立几何 `write=new_shape`、`stage_index`/`parent_prediction_id` 正式表列、并行兄弟 Celery `chord` 并行、「一键采纳整条 pipeline」。

## [0.18.2] - 2026-06-23

多阶段预标注（路径 B）第二块：把 0.18.1 的「单 detect→单 classify 顺序链」升级为**可控编排**——按类别路由、并行扇出、降级策略、逐阶段统计。方案见 [`docs/plans/2026-06-23-v0.18.2-staged-preannotate-roi-routing.md`](docs/plans/2026-06-23-v0.18.2-staged-preannotate-roi-routing.md)。

### Added

- **单层并行扇出**：一个源检测阶段下可挂多个共享 `parent_stage` 的下游分类阶段（如车辆框 → 颜色 + 车型 + 车牌 OCR 各写不同属性键，结果 union 合并进同一框）。`/ai-pre` 支持「并行加同级阶段」，每张阶段卡自持配置实例。
- **按类别路由 `parent_class_filter`**：每个下游阶段声明只对哪些父框 `class_name` 启动——不相交类别集 = 不同类走不同模型，重叠 = 同类喂多模型；命中零阶段的框保持纯检测（降级）。声明式过滤，非条件分支节点。
- **ROI 可配**：`roi.pad`（0–0.5）按请求可调，`roi.mode` 校验（本期仅 `crop`）。
- **阶段级失败策略 `on_failure`**：`keep_parent`（默认，下游失败保留上游框、属性留空 + 软告警）/ `drop_box`（丢弃该父框）。下游失败不再整 task 失败。
- **并行兄弟键冲突检测**：多个阶段声明写同一属性键时，默认 `on_key_conflict=reject`（422）；`last_wins` 时按阶段顺序末位覆盖。
- **逐阶段统计**：多阶段预标的检出框数 / 各下游富集成功失败数写入 async_job 结果（`pipeline_stages`），供后续逐阶段可视化。

### Changed

- 阶段卡 UI 补「父框类别 / ROI pad / 写回属性键」字段；下游阶段从「单一第二阶段」泛化为「可增删的并行兄弟列表」。

多阶段预标注（路径 B）第一块落地：把「检测 → 拿框 → 对每个框跑分类 → 写回属性」的级联从单 backend 内部（0.18.0 路径 A）泛化为**平台层跨 backend 编排**。任意检测器 × 任意分类器自由组合，复用现有任意 backend、零改造。本版聚焦顺序 2 阶段 MVP，方案见 [`docs/plans/2026-06-23-v0.18.1-staged-preannotate-mvp.md`](docs/plans/2026-06-23-v0.18.1-staged-preannotate-mvp.md)。

### Added

- **多阶段预标注编排（顺序 detect→classify）**：`POST /projects/{id}/preannotate` 新增可选 `pipeline_stages`（有序阶段列表）。源阶段产框后，平台按每个检测框的 bbox 裁 ROI crop（`pad` 默认 5%、`data:` base64 内存传递，下游 backend 无感），喂下游分类 backend，把返回的 `attributes` 合并（union）进对应框——维持「一个框 + 一串属性」模型，前端采纳/编辑零改动。缺省（无 `pipeline_stages`）与现有单模型预标逐字等价，完全向后兼容。
- **`/ai-pre` 加第二阶段**：项目详情面板预标配置区可勾选「加第二阶段」，容器持第二份配置表单实例（复用 `PreannotateConfigForm`），选下游 backend/model 即组成 detect→classify 级联。
- **阶段元信息追溯**：多阶段预标的 `stage_count` / `enriched_attr_keys` 暂存 `PredictionMeta.extra`，可追溯「哪个属性来自哪个阶段」（MVP 不改表）。

### Changed

- **`MAX_ML_BACKENDS_PER_PROJECT` 默认 1 → 3**：多阶段编排天然需 ≥2 backend（detect + classify）；仍保留上限挡入口防显存爆炸，生产按显存预算调整。

## [0.18.0] - 2026-06-23

二阶段预标注落地：新增**自维护的第四个 ML backend `onnxtools-backend`**——「检测 → 拿到框 → 对机动车做车型/颜色分类 → 写入框属性」一条流水线打通，并扩展协议让 backend 自报输出属性 schema、前端一键导入。Path B（平台层跨 backend 可视化编排）作为后续 Epic 单列 [`ROADMAP`](ROADMAP/2026-06-23-staged-preannotation-pipeline-roadmap.md)。本版方案见 [`docs/plans/2026-06-23-v0.18.0-onnxtools-vehicle-attribute-backend.md`](docs/plans/2026-06-23-v0.18.0-onnxtools-vehicle-attribute-backend.md)。

### Added

- **onnxtools 第四 backend（二阶段车辆属性）**：独立 FastAPI 微服务（端口 8004、compose profile `gpu-onnxtools`），与 gsam2 / sam3 / yolo 同构（HTTP 协议 v2.1）但单一固定 pipeline。基于 onnxtools 的 `VehicleAttributePipeline`：rtdetr 检测 → 对机动车框裁 ROI → va 模型出**车型（13 类）+ 颜色（11 类）**→ 写入框 `attributes`。`class_name` 为 rtdetr 粗检测类，`attributes.vehicle_type` / `attributes.color` 为细分类（value 与 onnxtools 枚举严格对齐）；车牌作独立检测类，本轮不做父子。
- **协议扩展 · backend 自报输出属性 schema**：`/setup` 的 model 目录新增 `output_attribute_schema`（含每个 select 字段的 `options`，value+中文 label）与 `output_attribute_types`，沿 `ml_capabilities`（protocol → capability_instances）透传到前端。
- **「从 ML Backend 导入属性」**：项目设置「类别与属性」区新增按钮，列出所有自报输出属性的在线 backend / model，预览并勾选字段后一键合并进当前工具单位的 `attribute_schema`（同 key 覆盖、新 key 追加），免去手抄选项 + key 对齐。
- **采纳前候选属性预览**：工作台选中尚未落库的 AI 候选时，画布选中卡与右侧标注详情都以只读 `AttributeForm` 预览其 `attributes`（经项目 schema 的 options 解析为中文）；候选列表行补属性摘要 chip。无需先采纳即可核对车型 / 颜色。

### Removed

- **画布「属性模式」浮条**：移除 v0.14.10 引入的属性快速赋值模式（顶部浮条 + `[` / `]` / `1`-`9` / `N` 快捷键 + `attributeMode` 状态）。属性改在选中卡 / 右栏属性表单中按对象编辑。

### Notes

- onnxtools 经 `git+https://github.com/yyq19990828/onnxtools.git@main` 安装（`VehicleAttributePipeline` 已合入 main）；两个 onnx 模型经 volume 挂载注入、不打进镜像。镜像复用本机已缓存的 `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel`（cuda12.8 + cudnn9 满足 onnxruntime-gpu 1.22）。
- entrypoint 把 torch 自带的 `nvidia/*/lib` 加进 `LD_LIBRARY_PATH`，否则 onnxruntime CUDAExecutionProvider 找不到 cudnn 静默退回 CPU；实测 GPU ~35ms/图 vs CPU ~940ms。缺 GPU 时自动 fallback CPU，功能不受影响。
- `accept_prediction` 复制候选 attributes 时对项目 select 字段做软校验：值不在 options 内只告警、不阻断（保留原值），避免 backend 枚举与项目配置漂移时丢数据。
