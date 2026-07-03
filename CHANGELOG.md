# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.20.x | [docs/changelogs/0.20.x.md](docs/changelogs/0.20.x.md) |
| 0.19.x | [docs/changelogs/0.19.x.md](docs/changelogs/0.19.x.md) |
| 0.18.x | [docs/changelogs/0.18.x.md](docs/changelogs/0.18.x.md) |
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

## [Unreleased]

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.21.x 版本段累积在本区；进入 0.22.x 后整体移到 docs/changelogs/0.21.x.md。
-->

### Added
- **检测式视频追踪（detect-then-track）**：视频源经检测模型 + ByteTrack / BoT-SORT 全自动多目标追踪，落成一批轨迹预标注。yolo-backend `/setup` 新增 `track` 模型（`task=tracker`、仅接受 `video` 输入、自报 `bytetrack` / `botsort`，复用检测权重矩阵与 COCO 类别表——追踪不加载新权重，只在推理时外挂关联算法）；`/predict` 的 `type=tracker` 分支用 ultralytics `model.track` 逐帧关联，返回每条已聚合轨迹（原生 track id + 逐帧 0-1 归一 bbox），支持 `conf` / `iou` / 追踪算法 / 类别白名单，首版单次整段追踪并对超长视频按帧数上限截断。平台侧把轨迹落成 `VideoTrackGeometry` 预标注：投递沿用现有批量链路（视频 task 投 signed URL），入库时把后端原生整型 track id 映射成稳定的 `trk_<uuid>` + 语义标签（如 `car_3`），读取路径把嵌套轨迹重塑成逐帧关键帧几何（每帧标记来源为预测）。区别于既有的交互式 SAM 视频追踪（人在环、单对象种子传播），这是无种子、多对象、离线批量的另一条链。

### Removed
- **标注编组（Ctrl+G / Ctrl+Shift+G)持久化下线**：此前「把 ≥2 个框绑成一个持久组」的能力（`group_id` 平等分组、重开仍是一组、同色虚线外圈）语义弱、场景罕见——相关关系已由父子（parent）、跨帧 track（ADR-0045）、同类 class 三态覆盖。现移除 `POST /annotations/group`、`/annotations/ungroup` 端点与对应 service/schema、前端 Ctrl+G 快捷键与接线。**批量编辑（选中多框一次改 class/属性/锁定/隐藏）保留**,退化为前端临时多选（`bulk-update`,不再落 `group_id`)。

### Changed
- 预标注流水线画布的**源阶段渲染改为按模型任务派生**，不再把「源 = 检测 = 整图」写死：源节点的角色名（目标检测 / 视频追踪）、产物（检测框 / 轨迹）、计数标签与源类型徽标（图像 / 视频）均从模型能力与受控词表推导。为后续检测式视频追踪（video 源）接入铺路——此前六处硬编码会把视频源错误显示成「检测 / 整图」。
- **跨帧同一对象标识统一到 `track_id`**（ADR-0045）：此前「同一物体跨多帧」用两套 id——静态 box_3d 借 `group_id` 高位段、视频轨迹用 geometry 内 `track_id`。现在统一为 annotation 级的通用 `track_id`（几何类型无关）：跨帧延续（propagate）、关键帧区间插值、3D 工作台的跨帧高亮 / 邻帧叠加 / 逐目标点云对齐、以及导出全部改按 `track_id` 认链。**导出格式随之调整**：COCO `attributes.__group_id` → `__track_id`；LiDAR / nuScenes 的 `instance_token` 按 `track_id` 归并同一实例（MOT / KITTI 早已用 track_id，不变）。存量跨帧链已迁移回填，新链只写 `track_id`。

## [0.21.0] - 2026-07-02

### Added

- **项目预标注编排升级为可命名模板库**：新增 `project_pipelines` 表与 `/project-pipelines`、`/projects/{project_id}/pipelines/apply` 接口，支持 private / organization / public 作用域、copy-on-write 套用、项目默认编排切换和未启用 backend 提前拦截，原有项目内保存的 `preannotate_pipeline` 会回填为项目默认编排。
- **AI 预标面板接入命名编排库**：项目详情里可以把当前 DAG 保存为命名编排、从可见编排库套用为项目默认，并在套用失败时直接提示缺少启用的 backend；工作台「按项目编排运行当前题」优先读取项目默认命名编排，旧项目列只作为兼容兜底。
- **智能编排库新增全局 backend/model 池**：`/ai-pre/pipelines` 可直接从 `/ml-capabilities/instances` 的全局模型池选择源模型和下游模型，右侧复用 DAG 画布预览后保存为公共命名编排；项目预标注入口只负责把编排库里的模板套用为当前项目默认，探测失败的 backend 会保留展示但禁用选择。
- **全局编排页对齐项目编排能力**：`/ai-pre/pipelines` 现在支持多层 DAG（受限 `MAX_DEPTH=3`，可加子/改父/级联删）、右列常挂参数 Inspector 可以配 `roi.pad` / `write.keys` / `label`、模型变体（version/size/lang 轴），以及类别相关字段——源阶段类别白名单从 model 自报 `classes` 勾选、下游父框类别从上游 model 类名勾选、写回属性键从 model `output_attribute_schema` 勾选（均与项目侧同源、均支持自由文本兜底），而 `roi.mode` / `input.mode` / `write.target` 与项目侧一样由所选模型的任务内生派生、只读展示不可手选，保存前预警属性键冲突；可见范围支持公共 / 组织；页面下方新增「命名编排库」列表，展示 `scope in {public, organization}` 编排的 `usage_count`，支持「加载编辑」把 stages 回填画布或删除；项目页可见范围新增「组织」选项。推理阈值 `params` 因不在全局能力池下发，留待编排套用到项目后由项目侧配置。共用画布状态机通过 `usePipelineComposer(context)` 提取、通用 chip 多选提取为 `ChipMultiSelect`，两页保持行为一致。
- **能力协议新增统一输入类型词表**：`supported_inputs` 现在有后端、共享协议和前端生成物共用的受控词表，并新增 `video` 预留输入类型与 `default_input_type` 字段，后续全局编排选择器和视频检测追踪可以用同一套输入判据。

### Changed

- **多阶段预标注的源阶段成为执行字段来源**：触发预标注时不再让顶层兼容字段覆盖流水线源阶段，源阶段的 backend、模型、任务类型、参数、variant 和类别过滤会一并派生到执行 payload，避免项目主 backend 或旧调用参数成为第二真值。
- **全局能力实例响应补齐编排所需定位字段**：`/ml-capabilities/instances` 现在返回 `backend_id` 与 `state`，全局编排选择器可以用 registry id 落 `pipeline_stages.ml_backend_id`，并把 `state=error` 的 backend 展示为不可选择而不是静默消失。
