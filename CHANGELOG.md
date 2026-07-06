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

### Changed
- 视频时间轴退役播放头「圆点」：原生 range thumb 圆点既与 AI 预测/关键帧密度条视觉重叠、又与轨道填充右缘冗余，现隐藏 thumb、保留原生进度填充（填充右缘即当前帧位置）。seek 拖拽/键盘不受影响（拖拽走时间轴指针捕获、键盘走 range onChange，均不依赖 thumb 命中）。

### Fixed
- **「当前题 AI」待审数不再莫名抖动（100→500→100）**：`aiBoxes` 未按 id 去重 + header 待审数对视频取全帧总数（下方候选列表却按当前帧过滤），叠加预测 offset 分页重取期相邻页 shape 重叠，跑一次 AI 后待审数会瞬时冲高再回落、且与列表口径不一致。现 `aiBoxes` 在源头按 id 去重（下游列表/计数/时间轴密度全继承唯一 id），视频 header 待审数改按**当前帧**过滤计数（与候选列表一致）。
- **视频工作台「当前题 AI」面板恢复单帧检测能力**：视频项目下该面板的模型下拉此前被写死只剩整段 tracker（工作台调用共享配置 hook 时漏传 `executionUnit`），选不到图像检测模型；点「运行当前题」发给 tracker 产出 `video_track_bbox`，又被单帧 reshaper 丢弃 → 静默「新增 0 个候选」，等于点了没用。现工作台恒传 `executionUnit="frame"`，面板放开 YOLO 检测模型、单帧检测正确落 `video_bbox` 候选（后端零改动）。面板加一句指引：整段目标追踪走 Shift+T 种子追踪或「AI 预标」批量页。

## [0.21.9] - 2026-07-05

### Added
- **committed 轨迹里 AI 追出的关键帧常态可辨**：已采纳的视频轨迹里，AI 追出的关键帧（`source=prediction`）此前在常态编辑态与人工帧渲染完全一致，采纳后回看分不清哪些帧是自己画的、哪些是 AI 补的。现补两处常态视觉线索——① 画布上当前帧是 AI 追帧时，框左上角加一枚 amber 角标（区别于插值帧虚线、人工帧实线）；② 右栏轨迹清单行新增「关键帧来源迷你条」（沿帧区间 bucket 化，紫=AI 追、灰=人工），不展开即可看出 AI 补了哪几段。（时间轴关键帧点、选中卡关键帧表本就按来源着色。）
- **画布 AI 层渲染检测式轨迹候选（`video_track_bbox`）**：检测式追踪产生的轨迹候选此前只在右栏侧列表可见、画布上不画框，采纳前无法在画布直观审阅。现画布 AI 候选层用 `resolveTrackAtFrame` 解出轨迹在当前帧的框，与逐帧 `video_bbox` 候选同款虚线视觉逐帧渲染，可在画布上核对后再采纳。
- **视频时间轴新增 AI 预测密度轨 +「跳到下一个/上一个有预测的帧」**：逐帧预标把每帧都落了 `video_bbox` 预测，但这些帧此前在时间轴上无任何标记，审阅时只能一帧帧翻找。现时间轴叠加一条独立的 amber 预测密度轨（bucket 化，与人工密度条不同层），播放控制条新增两枚带 sparkle 的预测帧导航按钮，可在有预测的帧之间直接跳转（`video_bbox` 取帧号、`video_track_bbox` 取关键帧号，去重升序）。
- 视频工作台右栏「轨迹」分组头新增折叠/展开：点击头收起下方全部轨迹行（计数常驻）。折叠态随账号持久（走 workbench.layout 服务端偏好），刷新/换设备保留，与「AI 待审」「人工」分组同一套管道。

### Changed
- 视频工作台右栏「轨迹」分组头样式与「AI 待审」「人工」对齐：统一卡片外观（圆角/边框/内边距）、加折叠箭头、标题字重与计数样式统一，「新建轨迹」+ 按钮移至右侧计数旁并收窄以对齐分组头高度。

### Fixed
- 编排画布输入节点的「数据源」标题在视频项目下被源类型 + 执行单位徽标挤压成逐字竖排（数\据\源）：节点头改为徽标过多时换行、标题不换行、运行态圆点绝对定位到右上角（不再靠标题 flex 撑开），标题恢复正常横排。

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.21.x 版本段累积在本区；进入 0.22.x 后整体移到 docs/changelogs/0.21.x.md。
-->

## [0.21.8] - 2026-07-05

### Changed
- **逐帧批量预标注改两阶段 fan-out，消除段级重复下载**：v0.21.7 逐帧模式下每个视频 task 的帧被切成若干段，**每段各下载一次整段视频**（335 帧 = 12 段 = 12 次全量下载，视频越大越痛）。现拆为两阶段——阶段 A `extract_frames_task` **每视频只下载一次**源视频、抽全部计划帧落 `VideoFrameCache`（跨视频并行，走 media 队列）；阶段 B 段任务退化为**纯预测、只读缓存帧**（零下载）。实测 tracking_car（335 帧）下载 12→1，段任务零下载。

### Added
- **逐帧预标 job 跑中实时进度落库**：段任务把 Redis 已完成帧计数按 `done/total` 折算写回 `async_job.progress_pct`（max 防回退，跑中封顶 99、留 100 给收尾）。此前该字段跑中恒 0、到点直接跳 100%，读 DB 的 `/ai-pre/jobs` 列表看不到进度（只 SSE 有）；现列表跑中显真实百分比。

### Fixed
- 逐帧预标段任务遇个别帧瞬时失败（如后端高并发下 predict 报错）时，依赖段级幂等断点续跑补齐：重跑同 job 跳过已落库帧、只补失败/未跑帧，最终全帧覆盖。注：两阶段化去掉了 per-段抽帧的天然错峰，峰值并发升高，个别帧瞬时失败概率略增，靠上述断点续跑收敛。

## [0.21.7] - 2026-07-03

### Added
- **单帧分支批量逐帧预标注（execution_unit=frame）**：视频项目现在可以让**图像检测 backend（YOLO det/seg）在整段视频逐帧跑**，每帧落 `VideoBboxGeometry` 单帧框——区别于整段追踪（tracker，跨帧轨迹 video_track）与单题工作台单帧 AI（同步、单帧）。这是把「执行单位」维度落进批量预标的一环：pipeline 从「per-task 一次执行」升级为「per-frame N 次执行」。
  - **输入节点执行单位顶层分叉**：视频项目的输入节点新增「执行单位」选择器——**整段序列**（源模型只列 tracker，做多目标追踪）/ **逐帧**（源模型只列图像检测，逐帧跑）。选择成为源模型类型的顶层分叉（母计划「输入节点的对等分叉」），据此过滤源模型下拉。全局编排库的输入节点也改为**显式声明** data_type + execution_unit（取代此前从源模型 `supported_inputs` 反推），据声明过滤可选源模型。
  - **二级 Celery fan-out 执行引擎**：逐帧模式下，每个视频 task 抽全帧后按段（frame chunk）拆成 Celery 子任务，`chord(group(段任务), finalize)` 聚合。段任务抽本段帧（复用帧缓存、幂等）→ 逐帧检测 → `video_bbox(frame_index)` 落库；**段级幂等支持断点续跑**（跳过已落库帧）、段边界 cancel、每任务帧数上限（`FRAME_PREANNOTATE_MAX_FRAMES`，默认 900）+ 每帧框数上限 + 段级 soft 超时护栏；Redis 计数聚合分布式进度，chord 回调收尾 async_job。首版为源单阶段检测（frame × pipeline-depth 多阶段与 frame × track 同属组合爆炸，不在范围）。

## [0.21.6] - 2026-07-03

### Added
- **检测式视频追踪接入编排画布**：视频项目的编排源模型现在可以直接选 `tracker`（detect-then-track）。此前 `task=tracker` 的模型（`supported_inputs=['video']`）被源模型下拉的两道整图门（`supportsFullImageInput` + `GEOMETRIC_TASKS`）挡在外面，只能靠后端手拼 payload 触发；现在视频项目把 tracker 纳入几何路径的可选模型——变体（series × size）、参数（conf / iou / max_det / 追踪算法 bytetrack/botsort）、类别白名单与检测同构，`buildArgs` 自然发 `task_type='tracker'`。图像项目不受影响（tracker 只对 `data_type` 含 video 的项目放行）。

### Changed
- **编排「输入节点」收敛为纯数据源，源模型下沉为其子阶段（母计划终态）**：接续 v0.21.5——输入节点此前同时承载「数据源描述」和「源检测模型配置」两职。现彻底拆分：输入节点是深度 0 的纯数据源（只带 `source:{data_type,execution_unit}`，不配模型、不入后端 stage），源检测/追踪模型下沉为输入节点的子阶段（`SOURCE_SID`，后端 stage 0），下游从它继续挂。这让「图像跑检测 / 视频跑追踪 / 视频跑单帧检测」成为输入节点的对等分叉，而非写死在源节点里。受限 DAG 深度模型随之调整：输入节点不再计入模型层（深度 0），一条链的模型阶段为深度 1..3。图像项目编排行为零回归（源模型阶段等价旧「源阶段」，下游加子/改父/键冲突判据不变），旧持久化编排（stage 0 为源模型）加载时按此结构回填。
- **含 tracker 阶段的批量预标注加 soft 超时**：detect-then-track 整段跑帧耗时远超逐帧检测，新增 `TRACKER_SOFT_TIME_LIMIT_SECONDS`（默认 1800s）——仅对含 tracker 阶段的 job 施加 Celery `soft_time_limit`，与后端 `YOLO_TRACKER_MAX_FRAMES` 帧上限构成双保险，防单个追踪 job 长时间占住 worker。

## [0.21.5] - 2026-07-03

### Added
- **视频项目可进入预标注编排画布**：视频项目不再在 AI 预标入口被引导卡片挡在编排之外，而是进入与图像项目统一的编排画布，输入节点显示「视频」源类型 + 「整段序列」执行单位徽标。这是把「源类型 + 执行单位」维度落进编排模型的地基——后续检测式视频追踪接入编排即基于此。本版仅开放 `execution_unit=video` 单分支；逐帧（frame）分支 UI 与 tracker 派发接线为后续。

### Changed
- **编排画布的「源」收敛为一等「输入节点」**：此前源是画布/序列化层合成的「第 0 号 root 阶段」，靠 `ROOT_SID` 哨兵、`kind:"source"` 节点类型、`deriveSourceShape` 反推等五套散落特判维系。现统一为受限 DAG 内一条 `parentSid=null` 的普通节点，携带 `source:{kind,data_type,execution_unit}` 数据源描述：画布不再有 source/stage 两种节点类型（入 handle 由 `parentSid` 决定），源类型（图像 / 视频）与执行单位改由输入节点显式携带而非从模型反推，项目侧 / 全局编排库 / Inspector 的序列化与反序列化统一走输入节点。图像项目编排行为零回归（输入节点等价旧「源阶段」，下游加子 / 改父 / 键冲突判据不变）。旧持久化的项目 / 命名编排模板（stage 0 无 `source` 字段）加载时按输入节点识别，不受影响。

## [0.21.4] - 2026-07-03

### Added
- **视频工作台单题 AI 预标注**：视频工作台现在可对**当前帧**直接调用图像检测后端（YOLO / grounded-sam2 / sam3 等），把候选落成该帧的框预标注、人工采纳入库。此前视频项目进不了当前题 AI（工具栏 AI 按钮与浮层对视频禁用），因为所有推理路径都在服务端从 task 派生图 URL，而视频 task 的 URL 是整段 mp4、图像后端取不到帧。现新增一条「客户端供图帧」推理路：前端把当前帧解码成 JPEG 随 multipart 上传（`POST /projects/{id}/ml-backends/{backend_id}/predict-frame`），服务端转存对象存储换成后端可拉取的 URL（通用 http URL，不走仅部分后端支持的 data: 捷径）后投递，返回的检测框逐个改写成单帧 `video_bbox`（带 `frame_index`）落一条预测，采纳复用既有 `/predictions/{id}/accept` 机制写成 `VideoBboxGeometry`。候选进右侧 AI 面板列表（支持「当前帧 / 全部」过滤），并**像图片工作台一样直接画在视频画布上**——只在候选所属帧渲染（虚线 + 类色候选框），select 工具下点选候选即弹「采纳 / 忽略」贴框快捷条，采纳落成该帧 `VideoBboxGeometry`、忽略驳回，与图片工作台的画布采纳/驳回一致。区别于整段视频批量预标（投 signed URL 走 worker）与交互式 SAM 视频追踪，这是同步、单帧、客户端供图的即时预标。首版限检测框（`video_bbox`）；分割 / 分类等无对应单帧几何的输出暂跳过。

### Added
- **检测式视频追踪（detect-then-track）**：视频源经检测模型 + ByteTrack / BoT-SORT 全自动多目标追踪，落成一批轨迹预标注。yolo-backend `/setup` 新增 `track` 模型（`task=tracker`、仅接受 `video` 输入、自报 `bytetrack` / `botsort`，复用检测权重矩阵与 COCO 类别表——追踪不加载新权重，只在推理时外挂关联算法）；`/predict` 的 `type=tracker` 分支用 ultralytics `model.track` 逐帧关联，返回每条已聚合轨迹（原生 track id + 逐帧 0-1 归一 bbox），支持 `conf` / `iou` / 追踪算法 / 类别白名单，首版单次整段追踪并对超长视频按帧数上限截断。平台侧把轨迹落成 `VideoTrackGeometry` 预标注：投递沿用现有批量链路（视频 task 投 signed URL），入库时把后端原生整型 track id 映射成稳定的 `trk_<uuid>` + 语义标签（如 `car_3`），读取路径把嵌套轨迹重塑成逐帧关键帧几何（每帧标记来源为预测）。区别于既有的交互式 SAM 视频追踪（人在环、单对象种子传播），这是无种子、多对象、离线批量的另一条链。

### Removed
- **标注编组（Ctrl+G / Ctrl+Shift+G)持久化下线**：此前「把 ≥2 个框绑成一个持久组」的能力（`group_id` 平等分组、重开仍是一组、同色虚线外圈）语义弱、场景罕见——相关关系已由父子（parent）、跨帧 track（ADR-0045）、同类 class 三态覆盖。现移除 `POST /annotations/group`、`/annotations/ungroup` 端点与对应 service/schema、前端 Ctrl+G 快捷键与接线、侧栏 group 卡片分桶与画布同色虚线外圈渲染。**批量编辑（选中多框一次改 class/属性/锁定/隐藏）保留**,退化为前端临时多选（`bulk-update`,不再落 `group_id`)。数据结构一并清理：删除 `annotations.group_id` 列及其索引、`tasks.next_group_seq` 列、全局序列 `cross_frame_group_seq`（跨帧对象标识已全部迁移到 `annotations.track_id`）。

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
