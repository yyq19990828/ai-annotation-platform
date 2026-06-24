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
<!-- 0.18.7（并行扇出规模化 / Celery chord）为规模驱动的「按需」版本，无实测 wall-clock 压力前不实施，故版本号留空，见 docs/plans/2026-06-23-v0.18.7-staged-preannotate-chord-parallelism.md -->

## [0.18.12] - 2026-06-24

多阶段预标注（路径 B）下游几何原子化 + 配置 UX 彻底 model-first 统一：gsam2 暴露独立的「框→掩膜」纯几何原子（开放/非交互/原子），使「检测（出框）→ 几何分割（吃框出掩膜）」可端到端跑通；协议升 v2.2（纯加法）引入 `composition`（atom/composite）维度与几何 prompt 批量入参。同时把预标配置面板的三条配置路径（doc / 几何 / 文本）统一收敛为「选 model（= 模型市场卡片）」的 model-first 范式——所有 ml 后端统一走 `model_id + task_type + model_variants` 这一套 wire，文本路径（gsam2/sam3）不再是输出形态开关的特例。

### Added

- **gsam2 暴露「框→掩膜」几何原子 model**：新增 `grounded-sam2-box-seg`（`task=segmentation`，`supported_prompts=["bbox"]`，开放/非交互/`composition=atom`），`set_image` 一次、N 个父框共享 embedding 批量出多边形，每个结果回带 `parent_box_idx` 以便与上游框对齐合并。
- **协议 v2.2 `composition` 维度（纯加法）**：model 条目可声明 `composition: "atom" | "composite"`（缺省 `atom`），与 `visibility` 解耦，标识该能力是原子单元还是内置多步流程。平台 schema / service 全链路透传；模型市场目录加「原子 / 内置流程」徽标。
- **几何 prompt 批量入参（路径 B 下游链路）**：下游几何分割阶段接收整图 URL + N 个父框（归一化坐标）的批量入参（`tasks[].prompts[]`），worker 端 `_stage_input_mode` 依据下游 model 的 `supported_prompts` 自动判定 `geometry` / `crop` 投递模式。

### Changed

- **预标配置面板彻底 model-first 统一**：原文本路径（gsam2/sam3）以「输出形态开关」驱动、不带 model_id 的特例已取消。「模型任务」改为单一下拉选择器（`value` 直接绑 `model_id`，文案 = 模型市场卡片标题 `display_name`），doc / 几何 / 文本三路径共用同一套「选 model」交互与 `model_id + task_type + model_variants` wire。
- **gsam2 / sam3 批量按 model_id 路由**：detection model_id → 出框、segmentation model_id → `output||mask`，无 model_id 时回落 `ctx.output`（向后兼容）。onnxtools-backend 在纯分类原子（v0.18.9）之外再拆出独立的纯检测 model，使「检测 → 分类」可全部由 onnxtools 自身的两个原子组成；同时引入协议级 `visibility` 字段，把原「检测+分类一锅端」pipeline 标为内部能力——目录可见但不进任何对外选用入口。

### Added

- **onnxtools-backend 暴露纯检测 model（0.2.0 → 0.3.0）**：`/setup` 在一锅端 `vehicle-attr` 与纯分类 `vehicle-attr-classify` 之外新增 `vehicle-detect`（`[专用]车辆检测`，`task=detection`，复用常驻 pipeline 内的 `detector` 只跑 rtdetr、跳过 va 属性分类，纯出 bbox 不写 `attributes`，故不声明 `output_attribute_schema`）。`/predict` 按 `context.model_id` 增加纯检测路由（`model_version=onnxtools-rtdetr`）。至此 backend 暴露三 model：一锅端检测+属性、纯检测、纯分类。
- **能力可见性 `visibility` 字段（协议 v2.1）**：model 条目可声明 `visibility: "internal" | "public"`（缺省 `public`，老 backend 无字段即按对外开放处理）。`internal` 表示在能力目录可见但不对外开放选用。平台 schema / service 全链路透传（`ModelCapability` / `InstanceModelItem` 增字段，`_normalize_model` / `_shape_models` 透传）。

### Changed

- **一锅端 pipeline 转为内部能力**：`vehicle-attr`（rtdetr 检测 + va 分类一体）display_name 改为「[专用]车辆检测+属性」并标 `visibility=internal`。多阶段编排改用「纯检测（上游）+ 纯分类（下游）」两原子组合，一体管线保留备查。
- **对外选用入口过滤内部能力**：预标配置（默认模型 + 几何模型列表）、工作台多模型选择器、ML Backend 属性导入三处统一过滤 `visibility=internal`；模型市场目录仍展示该 model 并加「内部」徽标。

## [0.18.10] - 2026-06-24

0.18.x 跨 ML Backend 编排开放后的工作台语义收口：工作台 AI 悬浮面板明确为「当前题 AI 执行 + 候选审阅」，项目级 backend 从「默认 ML Backend」改称「项目主后端」，视频工作台保留显式选择工具并退役独立平移工具。方案见 [`docs/plans/2026-06-24-v0.18.10-workbench-ai-default-backend-video-tools.md`](docs/plans/2026-06-24-v0.18.10-workbench-ai-default-backend-video-tools.md)。

### Changed

- **工作台 AI 面板语义收口**：AI 浮层标题、运行按钮、候选筛选和 backend selector 文案改为当前题语义；候选筛选只描述当前题可见候选，不再暗示批量 pipeline 或全局编排。
- **项目主后端命名**：项目 ML 模型页、预标配置 selector、文档和快捷操作统一改为「项目主后端 / 主后端」，保留 `ml_backend_id` 作为初始选择 / fallback，不改变 API 或 DB schema。
- **视频工具栏退役 hand/pan**：视频 ToolDock 展示选择 `V`、矩形框 `B` 与轨迹 `T`；`V` / `Alt+3` 切选择工具，不再切换视频平移工具，`Esc` 不再回落到 hidden hand 状态。
- **视频默认画布交互补齐**：已有标注的选择、移动、resize 继续优先于空白创建；右键拖拽与 `Space`+拖拽可平移视频视图，`Space` 单按仍用于播放 / 暂停。

### Notes

- GSAM2 / grounded-sam2 这类 backend 内部复合 pipeline 的长期拆分或原子化不在本版处理，后续单独开 plan。

## [0.18.9] - 2026-06-24

多阶段预标注（路径 B）下游分类原子化：把 onnxtools-backend 从「只暴露一条完整检测+分类 pipeline」拆出独立的纯分类 model，并让平台多阶段编排的下游阶段自动用它。这样「检测（如 grounded-sam2）→ 裁 ROI → 分类（onnxtools）」是真正的跨 backend 原子编排，下游不再在已裁好的单车 ROI 上重复跑检测器（冗余 + 紧 crop 域偏移漏检）。

### Added

- **onnxtools-backend 暴露纯分类 model（0.1.0 → 0.2.0）**：`/setup` 在原 `vehicle-attr`（完整 rtdetr 检测 + va 分类）之外新增 `vehicle-attr-classify`（`task=classification`，复用同一常驻 pipeline 内的 `VehicleAttributeORT`，跳过 rtdetr，把整张输入 ROI 当一辆车直接出车型/颜色属性）。`/predict` 按 `context.model_id` 路由两条路径，两 model 共用同一份 `output_attribute_schema`。

### Changed

- **下游阶段优先纯分类 model**：`StageCard` 在所选 backend 暴露 `task=classification` 的 model 时，stage payload 自动改用该 model（覆盖 `buildArgs` 默认取的 `models[0]`，常为检测 model），并显式提示「下游模型：…（纯分类，跳过检测）」。无分类 model 时回落原行为。修复了「下游分类阶段会误用检测 model」的实际缺口。

### Notes

- 端到端实测（P-8 苏州图片，grounded-sam2 检测 + onnxtools 纯分类）：阶段 0 检出 32 框 → 阶段 1 目标 27 / 成功 27 / 几何跳过 5，属性 `{vehicle_type, color}` 正确写回各检测框，crop 经 presigned URL 投递（复用 v0.18.4 通用投递）。

## [0.18.8] - 2026-06-23

多阶段预标注（路径 B）编排 UI 美化：把功能优先搭起来的多阶段界面提到与全站 shadcn 设计体系一致的水准。纯前端视觉 / 交互层，不改编排语义、校验、请求体。方案见 [`docs/plans/2026-06-23-v0.18.8-staged-preannotate-ui-polish.md`](docs/plans/2026-06-23-v0.18.8-staged-preannotate-ui-polish.md)。

### Changed

- **StageCard 卡面升级**：裸描边块换成 `Card` 卡面 + 左侧角色轨，卡头为角色图标 + 角色 `Badge`（分类）+「阶段 N」+ 运行态 `Badge`（待运行 / 运行中 / 已完成 / 失败，语义色 + 暗色配对）。
- **运行态可视化升级**：逐阶段统计从纯文本行升为 `ProgressBar`（成功 / 目标比例）+ StatCard 风格计数块（目标 · 成功 · 失败 · 几何跳过），替换 v0.18.6 的自定义文本徽标。
- **流水线视觉隐喻**：源（检测）与下游分类卡之间加「↓ 对每个检测框裁 ROI 喂下游分类」连接线，多个并行兄弟显「并行 ×N」标，直观呈现单层扇出（仍非节点图）。
- **空态引导**：未加下游阶段时给一句「检测 → 分类」流水线示意文案。

### Notes

- 折叠/展开卡、加删卡过渡动效、候选属性审阅区（AIInspectorPanel）打磨为后续可分离的细化项，本期未含。
- 全量走语义 token + 暗色配对，过 `check-tw-tokens`。

## [0.18.6] - 2026-06-23

多阶段预标注（路径 B）运行态实时化：把逐阶段统计从「跑完才在底部出一条扁平文本」改成「跑批过程中实时下放到各阶段卡」。方案见 [`docs/plans/2026-06-23-v0.18.6-staged-preannotate-live-runstate.md`](docs/plans/2026-06-23-v0.18.6-staged-preannotate-live-runstate.md)。

### Changed

- **逐阶段统计实时化 + 下放到卡**：worker 跑批过程中按 5% 步长把逐阶段累加快照随进度推上 WS（复用现有项目预标通道，不新增通道）；前端实时消费，统计从底部脱节的扁平条移到各阶段卡上——源阶段显「检出 N 框」，每张下游卡显运行态徽标（待运行 / 运行中 / 已完成）+「目标·成功·失败·几何跳过」计数，并行兄弟各一条。运行中用实时快照，job 终态 / 重连回落 `result.pipeline_stages`（终态真值，不丢）。

### Notes

- 仍为同步顺序执行，只是把已有累加器中途也推一份；无新并发模型（chord 并行留后续版本）。
- crop 预览（展开看实际投递给下游的 ROI 缩略图）为可选诊断项，本期未实装，留待后续。

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
