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
