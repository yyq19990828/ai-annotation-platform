# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

## [0.9.33] - 2026-05-12

> **Video Frame Asset Retry — 视频资产失败列表与 media 队列重试.** 主线: ① 存储 API 汇总视频 `probe_error` / `poster_error` / `frame_timetable_error` 以及 chunk / frame cache 失败行；② 新增手动 retry 入口，复用既有 `generate_video_metadata`、`ensure_video_chunks`、`extract_video_frames` Celery media 任务；③ 存储管理页增加「视频资产失败」面板，可查看项目/任务、失败类型、错误摘要并重试。→ [plan](docs/plans/2026-05-12-v0.9.33-video-frame-asset-retry.md).

### Added

- **视频资产失败列表 API**：`GET /api/v1/storage/video-assets/failures` 返回 probe / poster / frame timetable / chunk / frame cache 的失败资产，包含 dataset item、task、project、错误信息和更新时间。
- **视频资产重试 API**：`POST /api/v1/storage/video-assets/retry` 根据 asset type 投递现有 media Celery 任务；chunk / frame 重试前会把失败行恢复为 `pending`。
- **存储页管理入口**：`/storage` 新增「视频资产失败」面板，管理员可直接看到失败视频资产并投递重试。

### Changed

- 视频 probe / poster / timetable 失败不再只能靠数据库或日志定位；管理侧有统一可见入口。
- chunk / frame cache 失败从被动等待下一次访问，扩展为可人工重试的运维动作。

## [0.9.31] - 2026-05-12

> **Video Observability Pack — 视频工作台性能回归与 BUG 诊断包.** 主线: ① 新增 `video:bench` 脚本与 720p/1080p/4K × 10/100/500 tracks 的基准矩阵；② 视频工作台维护当前 task 的诊断快照，覆盖 frame clock、最近 seek、J/K/L 播放状态、timeline mode 和 frame preview cache；③ BugReportDrawer 在视频工作台自动把诊断写入反馈描述和 structured console payload；④ docs-site 增加视频性能回归 how-to。→ [plan](docs/plans/2026-05-12-v0.9.31-video-observability-pack.md).

### Added

- **视频 bench 入口**：`pnpm --filter @anno/web video:bench` 生成本地 run manifest 和 PR 附件路径，矩阵固定为 3 组视频规格 × 3 档轨迹密度。
- **视频诊断快照**：`VideoStage` 暴露 `window.__videoWorkbenchDiagnostics`，包含当前 frame、timeline mode、播放速度、对象密度、FrameClock 诊断和 frame preview cache 状态。
- **BUG 反馈自动附带诊断**：视频工作台内提交反馈时自动追加 `Video Workbench Diagnostics` 描述块，并在 `recent_console_errors` 中加入结构化 JSON payload。
- **视频性能回归文档**：新增 docs-site how-to，记录 bench 运行、PR 附件和 BugReport 诊断读取方式。

### Changed

- `useFrameClock` 的 diagnostics 增加最近 seek 样本，便于定位快速 scrub / loop / 反向播放时的帧准备耗时。
- `useVideoFramePreview` 记录 cache hit/miss、prefetch、unsupported 和最近状态，用于判断 hover preview 是否命中后端单帧缓存。

## [0.9.29] - 2026-05-12

> **Video J/K/L Playback + Atomic Seek — 多速率播放与异步帧跳转.** 主线: ① `useFrameClock` 暴露 `seekToAsync`，连续 seek 时旧回调会被标记为 stale；② `VideoStage` 统一 timeline scrub、逐帧、关键帧跳转、bookmark 和跳转历史到同一 `seekFrameAsync` 原语；③ 视频模式新增 `J / K / L` 播放控制，支持 `0.25x / 0.5x / 1x / 2x / 4x`，反向播放不使用浏览器负 `playbackRate`，而是按帧步进；④ 播放 overlay 显示当前 jog 速度。→ [plan](docs/plans/2026-05-12-v0.9.29-video-jkl-playback-atomic-seek.md).

### Added

- **J/K/L 视频播放控制**：`L` 正向播放 / 加速，`K` 暂停，`J` 反向播放 / 减速；视频模式下接管这些快捷键，图片模式原有 `J / K` 框选择行为不变。
- **异步 seek 原语**：`useFrameClock.seekToAsync` 返回帧就绪结果，旧 seek 被新 seek 覆盖时返回 stale，避免快速 scrub / 跳转时旧回调覆盖新帧。
- **播放速度状态显示**：`VideoPlaybackOverlay` 在 jog 播放时显示 `1x / 2x / -1x` 等速度标签。

### Changed

- 时间轴拖动、逐帧、关键帧跳转、bookmark marker、跳转历史和 loop region 入口统一走 `VideoStage.seekFrameAsync`。
- 正向多速率播放复用浏览器 `<video>` 和 `playbackRate`；反向播放按帧调用 `seekFrameAsync`，不依赖不稳定的 `playbackRate = -1`。

## [0.9.27] - 2026-05-12

> **Video Timeline Hover Preview — 时间轴缩略图预览 + 单帧缓存预取.** 主线: ① 前端新增 task video frame API helper 与 `useVideoFramePreview`，消费 v0.9.25 后端 `frames/{frame_index}` / `frames:prefetch`; ② `VideoPlaybackOverlay` hover 时间轴时显示当前 frame、时间和 WebP/JPEG 缩略图，pending/error 状态降级为轻量文案；③ `VideoStage` 对选中 track keyframes、bookmarks、loop region 起止帧主动预取，提升回访体验；④ 缓存和请求去重保持在前端内存，不引入 ImageBitmap、chapter 或 WebCodecs。→ [plan](docs/plans/2026-05-12-v0.9.27-video-timeline-hover-preview.md).

### Added

- **时间轴 hover 缩略图**：`VideoPlaybackOverlay` 增加 preview popover，ready 状态显示 frame image，pending/error 状态保留 frame/time 上下文，不影响 seek。
- **单帧预览 hook**：新增 `useVideoFramePreview`，支持 120 条内存 LRU、pending 一次重试、400/404 自动禁用当前 task 的 frame preview。
- **预取 hint**：选中轨迹关键帧、书签帧和 loop region 起止帧会通过 `frames:prefetch` 提前触发后端单帧缓存。

### Changed

- 前端 `tasksApi` 增加 `getVideoFrame` / `prefetchVideoFrames`，并补齐 `VideoFrameOut` / `VideoFramePrefetchResponse` 类型。
- 本版只消费现有后端帧服务；chapter、已下载范围可视化、ImageBitmap 缓存和多速率播放继续保持独立候选切片。

## [0.9.26] - 2026-05-12

> **Video Loop Bookmark Navigation — 播放范围 + 书签 + 跳转历史.** 主线: ① 视频时间轴支持 `Shift+drag` 设定本地 loop region，播放越过范围末帧后回到起始帧；② loop region、书签和跳转历史按 task 存入 `sessionStorage`，不占用并行开发中的后端帧服务 v0.9.25 接口；③ `Ctrl+M` 添加/移除当前帧书签，书签 marker 可点击跳转；④ 显式 seek 记录最近 50 个位置，`Ctrl+[` / `Ctrl+]` 后退/前进，`Alt+L` 清除播放范围。→ [plan](docs/plans/2026-05-12-v0.9.26-video-loop-bookmark-navigation.md).

### Added

- **播放范围**：`VideoPlaybackOverlay` 新增 loop region 色带、拖选 preview、范围文案和清除按钮；`VideoStage` 播放时在范围末帧自动回到起始帧。
- **书签与跳转历史**：新增 `videoNavigationState.ts`，集中管理 loop、bookmark、jump history 的归一化、会话存储解析和最近 50 次显式 seek 导航。
- **视频导航快捷键**：视频模式新增 `Ctrl+M`、`Ctrl+[`、`Ctrl+]`、`Alt+L`，并接入统一 hotkey 分发和帮助面板数据源。

### Changed

- `VideoStageControls` 扩展为可按显式用户动作记录跳转历史，播放 tick 和自动 frame clock 更新不会污染历史栈。
- 本版只改前端本地导航状态；后端 frame service、chunk/cache、hover thumbnail 和多速率播放仍保持独立排期。

## [0.9.25] - 2026-05-12

> **Video Frame Service Wave B — chunk / frame cache / manifest v2.** 主线: ① 新增视频 chunk 与单帧缓存表，按 `DatasetItem` 存储后端帧服务资产；② task 路由和 `/videos/{dataset_item_id}` facade 同时暴露 manifest v2、chunks、frames、prefetch；③ Celery media worker 负责 H.264 fragmented MP4 chunk 生成、WebP/JPEG 单帧抽取和 TTL 清理；④ 补齐 Prometheus 指标、环境变量、协议文档和运维 runbook。→ [plan](docs/plans/2026-05-12-v0.9.25-video-frame-service-wave-b.md).

### Added

- **视频 chunk 服务**：新增 `VideoChunk` 表和 `GET /api/v1/tasks/{task_id}/video/chunks` / `/api/v1/videos/{dataset_item_id}/chunks`，缺失 chunk 懒投递 Celery，ready 后返回 signed URL。
- **单帧缓存服务**：新增 `VideoFrameCache` 表和 `GET .../frames/{frame_index}` / `POST .../frames:prefetch`，抽帧优先使用 B1 `pts_ms`，旧视频按 fps 估算。
- **Manifest v2**：新增 task 兼容路由和 videos facade，返回 `chunks_manifest_url`、`frame_timetable_url`、`frame_service_base` 和 `chunk_size_frames`。
- **观测与运维**：新增视频帧服务 Prometheus 指标、缓存 TTL 配置、Celery beat 清理任务和 `docs-site/ops/runbooks/video-frame-service.md`。

### Changed

- `frame-timetable` 接口补 `Cache-Control` / `ETag` 响应头。
- API/Celery 依赖增加 `numpy`，供内部 `get_frame_array()` 返回缓存帧数组。

### Deferred

- B4 segment 协同、B5 AI tracker 编排、GOP smart-copy、多码率转码、HLS/DASH 留到后续版本。

## [0.9.24] - 2026-05-12

> **Video Track Timeline Navigation — 单轨时间轴 + 全局密度条 + 关键帧跳转.** 主线: ① 选中 `video_track` 时，播放条显示 keyframe 圆点、outside 灰段、interpolated 虚线段和 prediction 标记；② 未选中轨迹时显示全局 keyframe 密度条；③ `Shift+←/→` 在选中轨迹时跳上/下可见 keyframe，未选中轨迹时保留原有 ±10 帧跳转；④ 新增 `videoTrackTimeline` helper，复用 effective outside 语义，避免插值段跨越 outside / legacy absent。→ [plan](docs/plans/2026-05-12-v0.9.24-video-track-timeline-navigation.md).

### Added

- **单轨时间轴模型**：新增 `videoTrackTimeline.ts`，输出选中轨迹的 keyframe、outside、interpolated segment 和可见 keyframe 导航目标。
- **全局密度条**：未选中轨迹时按固定 bin 聚合全部 track keyframe 密度，帮助定位有标注的帧段。
- **关键帧跳转**：`VideoStageControls` 增加 `seekToKeyframe(dir)`，视频快捷键接线支持选中轨迹时跳上/下可见 keyframe。

### Changed

- `VideoPlaybackOverlay` 在保留原 seekbar 和播放按钮的基础上，按选中状态切换单轨 timeline 或全局密度视图。
- `Shift+←/→` 在视频模式下变为上下文快捷键：选中 track 跳 keyframe，否则继续跳 10 帧。

## [0.9.23] - 2026-05-12

> **Video Outside Timeline Foundation — outside 段协议 + 时间轴语义 marker.** 主线: ① `video_track` 支持可选 `outside: [{ from, to, source }]` 闭区间，向后兼容旧 `keyframes[].absent`; ② 前后端渲染、导出和 track → `video_bbox` 转换统一走 effective outside 判断；③ 时间轴 marker 扩展 keyframe / prediction / outside segment 语义，现有悬浮播放条可轻量展示 outside 灰段；④ 用户标记当前帧消失时写 outside 单帧区间，写入可见关键帧时自动清理该帧 outside 覆盖。→ [plan](docs/plans/2026-05-12-v0.9.23-video-outside-timeline-foundation.md).

### Added

- **outside 段协议**：`video_track` geometry 新增可选 `outside` 区间，支持 manual / prediction 来源，并通过前后端 helper 归一化排序、合并和兼容 legacy `absent`。
- **Timeline markers**：`videoFrameBuckets` 扩展输出 keyframe marker 与 outside segment，供 R4 多轨时间轴继续复用。
- **后端 outside 导出语义**：Video Tracks JSON 保留显式 `outside` 字段，`video_frame_mode=all_frames` 和 track 转独立框都会跳过 outside 范围。

### Changed

- `resolveTrackAtFrame` 在前端先判断 effective outside，再解析 exact keyframe 或插值；旧 `absent=true` 仍作为单帧 outside 兼容输入。
- `VideoPlaybackOverlay` 保持原布局，但底层标记支持 prediction keyframe 和 outside 灰段。
- 轨迹侧栏“标记消失”不再写新的 `absent` keyframe，而是写 outside 单帧区间；复制/写入可见关键帧会移除当前帧 outside 覆盖。

### Fixed

- 导出和 track → `video_bbox` 转换不再把 outside 覆盖的帧当作可见 bbox。
- 显式 outside 与旧 absent 混用时，前端渲染、时间轴提示和后端展开逻辑保持一致。

## [0.9.22] - 2026-05-12

> **Video Rendering Surface — CVAT 对齐的渲染分层 + 时间轴分桶基建.** 主线: ① 视频 stage 拆为 Media / Bitmap / Grid / Objects / Text / Interaction / Attachment 七个逻辑层，保留 React + SVG + HTML video 技术栈；② bbox 命中测试从每个 SVG 节点事件迁到 Interaction 层统一 picker；③ 新增统一坐标转换 helper 与 `VideoStageMode` busy guard，拖拽/缩放期间不接受播放 tick 覆盖当前编辑状态；④ 新增 `videoFrameBuckets`，按 track keyframe 输出稳定 marker，为 R4 时间轴可视化铺数据。→ [plan](docs/plans/2026-05-12-v0.9.22-video-render-layering.md).

### Added

- **CVAT-aligned stage surface**：新增 `VideoStageSurface`、`VideoMediaLayer`、`VideoBitmapLayer`、`VideoGridLayer`、`VideoObjectsLayer`、`VideoTextLayer`、`VideoInteractionLayer` 和 `VideoAttachmentLayer`，明确视频工作台各层职责。
- **统一坐标转换与 picker**：新增 `videoStageCoordinates.ts` 和 `videoStagePicking.ts`，pointer 坐标统一走 `client -> video` 映射，顶层 bbox 命中由 Interaction 层计算。
- **Stage mode guard**：新增 `videoStageMode.ts`，在 draw / drag / resize 期间阻止 frame setup 覆盖编辑中的几何。
- **Frame buckets**：新增 `videoFrameBuckets.ts`，从 `video_track.keyframes[]` 生成 `Map<frame, trackId[]>` 和稳定 marker，记录 manual / prediction / absent 状态。

### Changed

- `VideoFrameOverlay` 不再把媒体、对象、label、handle、draft、ghost 和 pointer handler 混在同一个 SVG；对象层只渲染 committed geometry，拖拽态由 Interaction 层负责。
- `VideoStage` 视频元素改由 `VideoMediaLayer` 承载，播放/seek 仍由 v0.9.21 的 `useFrameClock` 驱动。
- 现有 `video_bbox` / `video_track` wire shape、后端 API、导出协议不变。

### Fixed

- 密集 bbox 场景下不再为每个 bbox 主体挂 `pointerdown` handler，降低 React diff 和事件绑定压力。
- 拖拽或缩放过程中，播放 tick / seek 回调不会把当前帧切走并覆盖编辑态。

## [0.9.21] - 2026-05-12

> **Video Frame Clock — 帧时间表 + 精确 seek 基础.** 主线: ① media worker 用 `ffprobe -show_frames` 生成视频帧时间表并写入 `video_frame_indices`；② 新增 `GET /tasks/{task_id}/video/frame-timetable`，旧视频无时间表时返回 estimated 降级；③ 前端新增 `frameTimebase` / `useFrameClock`，优先用 `requestVideoFrameCallback` 做 frame ↔ mediaTime 映射；④ `resolveTrackAtFrame` 改为 keyframe 索引 + 二分查找 + 1000 条插值 LRU；⑤ 开发环境记录视频帧时钟 seek/longtask 诊断。→ [plan](docs/plans/2026-05-12-v0.9.21-video-frame-clock-timetable.md).

### Added

- **视频帧时间表**：新增 `video_frame_indices` 表，按 `dataset_item_id + frame_index` 保存 `pts_ms`、关键帧标记、帧类型和可选 byte offset。
- **Frame timetable API**：`GET /api/v1/tasks/{task_id}/video/frame-timetable?from=&to=` 返回 ffprobe 帧时间表；无表时返回 `source="estimated"` 和空 `frames`。
- **前端 FrameClock**：`VideoStage` 播放、逐帧和 scrubber seek 统一走 `useFrameClock`，支持 `requestVideoFrameCallback`，并对快速连续 seek 丢弃过期回调。
- **帧时钟诊断**：开发环境暴露 `window.__videoFrameClockDiagnostics`，记录 seek 次数、过期回调、最近 frame-ready 来源和 long task 计数。

### Changed

- 悬浮时间轴的时间显示改用 `frameTimebase`，有真实 `pts_ms` 时不再直接用 `frame / fps`。
- `video_track` 插值解析改为 WeakMap keyframe 索引、二分查找和 1000 条结果 LRU；`absent=true` 阻断语义保持不变。
- 视频元数据增加 `frame_timetable_frame_count` / `frame_timetable_error`，probe 失败不会阻断现有 manifest。

### Fixed

- 快速拖动时间轴时，旧的 frame callback 不再覆盖最新目标帧。
- 密集轨迹场景下，暂停 scrub 重复计算同一 track/frame 的开销下降。

## [0.9.20] - 2026-05-11

> **Video Tool Semantics — 视频矩形框 / 轨迹工具分离 + track 转独立框.** 主线: ① 视频工作台新增独立 `videoTool`，`B` 画当前帧 `video_bbox`，`T` 创建 / 延续 `video_track`；② 视频拖框恢复图片侧“画完选类”流程，不再默认吞掉第一个类别；③ 选中视频对象后 `1-9` 可直接改类；④ 新增事务端点把 track 当前帧、关键帧或插值全帧转换为独立 `video_bbox`，支持 copy / split 双语义和 5000 条上限；⑤ 轨迹侧栏补 keyframe 列表、关键帧删除、复制 / 拆分入口。→ [plan](docs/plans/2026-05-11-v0.9.20-video-tool-semantics.md).

### Added

- **视频工具语义分离**：视频任务左侧工具栏只展示“矩形框”和“轨迹”，图片工作台工具模型不变。
- **`video_bbox` 创建入口**：矩形框工具在当前帧创建单帧独立框；轨迹工具才创建或延续 `video_track`。
- **视频 pending class picker**：VideoStage 拖框后复用 `ClassPickerPopover` 选类，Esc 明确取消绘制，点外部仍按 `__unknown` 兜底。
- **Track 转独立框 API**：`POST /tasks/{task_id}/annotations/{annotation_id}/video/convert-to-bboxes` 支持 `copy|split`、`frame|track`、`keyframes|all_frames`。
- **轨迹关键帧列表**：侧栏展示 keyframes，并提供复制为独立框、拆为独立框、删除关键帧、整条复制 / 拆分入口。

### Changed

- 视频模式 `1-9` 在有选中 `video_bbox` / `video_track` 时改选中对象类别；无选中时继续切换 active class。
- Video Tracks JSON 导出和 track 转独立框共用同一套后端插值 helper，`absent=true` 阻断语义保持一致。
- 标注详情里的 AI 待审 / 人工列表改为与轨迹列表一致的行式布局，采纳、驳回、改类、删除收敛为小图标操作。
- 图片 / 视频画布的框体标签字号、标签底色和 resize 控制点尺寸统一；视频选中 `video_bbox` 或 `video_track` 当前帧框后显示 8 个控制点，支持边角缩放、`Shift` 锁定纵横比和 `Alt` 中心缩放。

### Fixed

- 视频工作台不再把每次拖框都强制保存为轨迹。
- 新建视频标注不再静默使用当前 active class 或第一个类别，用户可以在落库前明确选类。
- 视频新建轨迹框 resize 后，悬浮播放条和隐藏态播放按钮不再拦截后续 resize 操作；选中框体的控制点层级高于时间轴。
- AI 预测列表经过置信度过滤后，采纳单个预测框仍使用原始 `shape_index`，不再把不同类别的预测保存成同一类别。
- 画完框后的类别选择中，Esc 不再落 `__unknown` 框；只有鼠标点外部才保留 `__unknown` 兜底。
- 视频工作台框体标签改为独立 HTML 覆盖层渲染，避免 SVG 文本在视频层上消失；列表选中框体或轨迹时同步 seek 视频画面到对应帧。
- 图片缩略图导航支持拖拽定位，并使用 grab / grabbing 光标，避免悬停时仍显示画框十字光标。

## [0.9.19] - 2026-05-11

> **Video Workbench Foundations — keyframe 撤销重做 + 离线兜底 + 悬浮时间轴.** 主线: ① `video_track` 关键帧编辑进入 track-aware history，单帧新增/修改/消失/遮挡可按 keyframe 粒度撤销/重做；② 视频创建、更新、重命名补齐网络断开 / 5xx 离线队列 fallback，409 冲突继续走现有 `ConflictModal`；③ `VideoStage` 底部固定时间轴改为画布内悬浮 playback overlay，保留关键帧 tick、帧号、时间和当前帧框数；④ 视频模式新增 `,` / `.` 上一帧 / 下一帧备用快捷键并同步帮助面板。→ [plan](docs/plans/2026-05-11-v0.9.19-video-workbench-foundations-overlay.md).

### Added

- **Keyframe 级 history**：新增 `videoKeyframe` history command，只替换目标 `frame_index` 的 keyframe，保留同一 track 其它关键帧。
- **视频离线 fallback**：`handleVideoCreate` / `handleVideoUpdate` / `handleVideoRename` 在网络断开或 5xx 时写入现有 offline queue。
- **悬浮时间轴**：新增 `VideoPlaybackOverlay`，将播放、逐帧、scrubber、关键帧 tick 和帧信息悬浮到视频画布底部。
- **视频逐帧备用键**：`,` / `.` 分别后退 / 前进 1 帧。
- **视频数据集媒体信息**：数据集文件列表新增媒体信息列，视频文件直接显示分辨率、fps、帧数与 codec。
- **已关联数据集追加文件同步**：数据集已关联项目后，后续上传、ZIP 导入或扫描导入的新文件会自动生成对应项目任务。
- **空帧轨迹参考框**：选中轨迹跳到无框帧时显示最近关键帧的虚线参考框，并支持拖动或「复制到当前帧」生成当前帧关键帧。

### Changed

- `VideoStage` 删除底部固定 playback bar，画布可用高度增加；播放控件在 hover 时显示，编辑拖拽时隐藏。
- `useAnnotationHistory` 增加可选 `updateVideoKeyframe` handler，图片工作台原有 create / update / delete / batch 行为不变。
- 视频数据集不再显示图片专属“回填维度”按钮，改为“补生成元数据”；上传完成后刷新数据集与文件列表。
- 数据集上传 / 扫描完成后同步刷新任务列表、项目列表和项目统计缓存。

### Fixed

- 视频关键帧编辑不再只能按整条 annotation geometry 粗粒度回滚。
- 视频更新失败时不再绕过现有离线队列；409 冲突不被误判为离线暂存。
- 修复已关联项目的数据集追加视频后，工作台任务列表不出现新任务，必须解绑重连才可见的问题。

---

## [0.9.18] - 2026-05-11

> **Video Export Loop — 视频导出闭环 + 快捷键中心化.** 主线: ① `video-track` 项目复用 `format=coco` 导出入口返回专用 Video Tracks JSON（`export_type="video_tracks"`），支持 `video_frame_mode=keyframes|all_frames`；② `all_frames` 按后端线性插值展开逐帧 bbox，`absent=true` 阻断跨段插值，缺少 `frame_count` 时用最大已标注帧兜底；③ Dashboard 表格 / 卡片视频项目只暴露 Video JSON 导出，图片项目 COCO / VOC / YOLO 行为不变；④ `VideoStage` 改为 `forwardRef` 暴露播放与逐帧控制，视频快捷键并入 `hotkeys.ts` / `useWorkbenchHotkeys` 与统一帮助面板。→ [plan](docs/plans/2026-05-11-v0.9.18-video-export-hotkeys.md).

### Added

- **Video Tracks JSON 导出**：`GET /api/v1/projects/{id}/export?format=coco` 在 `video-track` 项目返回 `*_video_tracks.json`，包含 project、categories、tasks、tracks、keyframes、legacy `video_bbox`、video_metadata 与导出时间。
- **视频帧模式参数**：新增 `video_frame_mode=keyframes|all_frames`，默认 `keyframes`；批次导出同样支持。
- **逐帧展开**：`all_frames` 导出按相邻有效关键帧线性插值；`absent=true` 不跨段展开。
- **视频快捷键帮助**：统一帮助面板新增视频分组，覆盖 Space、方向键、Shift+方向键、Delete/Backspace、Tab、Esc、1-9。

### Changed

- `include_attributes=false` 对视频 JSON 同样生效：不输出项目 attribute schema，也不输出 annotation / track / legacy bbox attributes。
- `format=yolo|voc` 对视频项目返回 400，并提示视频项目只支持通过 `format=coco` 获取 Video JSON。
- Dashboard 视频项目导出入口只显示 Video JSON；图片项目仍显示 COCO / VOC / YOLO 与“包含属性数据”。
- `VideoStage` 移除组件内部全局 `keydown` listener，由 `useWorkbenchHotkeys` 在 video mode 下分发播放、逐帧、删除、轨迹循环和类别切换。

### Fixed

- 视频快捷键不再绕过 `hotkeys.ts`，避免图片 nudge / SAM / polygon 快捷键与视频播放控制并存冲突。

---

## [0.9.17] - 2026-05-11

> **Video Track Keyframes — 轨迹模型 + 关键帧插值.** 主线: ① annotation schema 新增 compact `video_track`，用 `track_id + keyframes[]` 表达同一对象轨迹；② `VideoStage` 默认创建轨迹而不是逐帧 `video_bbox`，支持选中轨迹后在其它帧追加/更新关键帧；③ 当前帧 overlay 可显示手工关键帧、预测关键帧和线性插值框，并保留旧 `video_bbox` 兼容渲染；④ 轨迹列表支持显隐、锁定、类别重命名和当前帧状态；⑤ 支持 `absent` / `occluded` 标记，插值不会跨越目标消失段；⑥ 前端提示关键帧间隔过大、极小框、同帧同类高重叠等基础质检问题. → [plan](docs/plans/2026-05-11-v0.9.17-video-track-keyframes.md).

### Added

- **`video_track` geometry**：新增 `{type, track_id, keyframes[]}` schema；每个 keyframe 包含 `frame_index`、`bbox`、`source`、`absent`、`occluded`。
- **轨迹关键帧编辑**：视频工作台画框创建 track，选中 track 后在其它帧绘制或移动会更新同一条 annotation 的 keyframes。
- **线性插值显示**：相邻有效关键帧之间按帧距插值 bbox，插值框用虚线与手工关键帧区分。
- **轨迹列表**：展示类别 / track_id / 当前帧状态，并支持显隐、锁定和类别重命名。
- **视频质检提示**：提示关键帧间隔过大、极小框、同类高重叠框；编辑时 bbox clamp 到归一化范围。

### Changed

- 视频新建标注默认写 `annotation_type="video_track"`；v0.9.16 的 `video_bbox` 继续可读可显示。
- `WorkbenchShell` 的视频创建 / 更新路径改为保存完整 track geometry，继续复用现有 annotation API、history、乐观更新和冲突提示。
- 更新视频标注用户文档、开发概念文档、roadmap、OpenAPI snapshot 和前端生成类型。

### Fixed

- 无

---

## [0.9.16] - 2026-05-11

> **Video Workbench MVP — 视频数据底座 + 逐帧 bbox 工作台.** 主线: ① dataset 视频导入后由 media worker 调 `ffprobe` 写入 `metadata["video"]`，并用 `ffmpeg` 抽 poster；② `GET /tasks/{id}/video/manifest` 返回视频播放 URL、poster 和规范化元数据，`TaskOut` 透出 `video_metadata`；③ annotation schema 新增 `video_bbox`，用 `frame_index` 表达逐帧框；④ 前端新增 `VideoStage`，支持播放/暂停、逐帧定位、时间轴标记、当前帧 bbox 创建/移动/删除；⑤ 视频任务禁用 SAM / polygon / canvas 工具，继续复用 WorkbenchShell 的队列、提交、审核、评论、锁和离线队列；⑥ 文档新增视频标注用户手册和开发概念页. → [plan](docs/plans/2026-05-11-v0.9.16-video-workbench.md).

### Added

- **视频媒体处理**：`generate_video_metadata` Celery 任务解析视频 `duration_ms` / `fps` / `frame_count` / `width` / `height` / `codec`，并生成 poster 缩略图。
- **视频 manifest API**：`GET /tasks/{task_id}/video/manifest` 返回签名视频 URL、poster URL 和元数据。
- **`video_bbox` geometry**：新增逐帧 bbox schema `{type, frame_index, x, y, w, h}`。
- **`VideoStage`**：视频播放、暂停编辑、逐帧跳转、时间轴关键帧标记、当前帧 bbox 标注。
- **视频标注文档**：新增标注员操作页与开发者概念页。

### Changed

- API/Celery Docker image 安装 `ffmpeg`，因此部署该版本后需要 rebuild API/Celery image。
- `TaskOut` 增加 `video_metadata`；前端 `TaskResponse`、OpenAPI snapshot 和 codegen 同步更新。
- `WorkbenchShell` 对视频任务选择 `VideoStage`；图片任务仍走原 `ImageStage`。

### Fixed

- 无

---

## [0.9.15] - 2026-05-11

> **Sorted Mountain — 批次状态机二阶段：ADR-0008 admin-lock + bulk-approve/reject.** 0.9.x 终版. 主线: ① batch admin-lock (soft hold，ADR-0008 Accepted) — 4 字段 DB 列 + Alembic migration 0055 + `check_auto_transitions` 短路 + `get_next_task` 排除已锁批次 + owner 端点 admin-lock/unlock + 通知 + 审计日志; ② bulk-approve/reject (reviewer 级权限) — reviewing → approved / rejected + 任务软重置 (review/completed → pending) + shared feedback; ③ 前端 — BatchesSection lock/unlock 按钮 + 已锁徽标 + 批量通过/驳回操作栏 + AdminLockModal + BulkRejectModal; ④ Phase 1 门控 — `test_scheduler.py` 19 cases 覆盖 check_auto_transitions + get_next_task; ⑤ 全套测试 435 前端 / 19 scheduler / 10 TestAdminLock / 8 TestBulkApproveReject 全绿; ⑥ ADR-0008 Proposed→Accepted + 实施细节章节. 0.9.x 全部 P2 长尾清零，立即开 v0.10.0 sam3-backend. → [plan](docs/plans/roadmap-md-roadmap-0-9-y-md-0-9-15-sorted-mountain.md).

### Added

- **Batch admin-lock (ADR-0008)**: owner/super_admin 可通过 `POST /{batch_id}/admin-lock` 冻结批次自动状态推进和新任务派发；`POST /{batch_id}/admin-unlock` 解锁。锁定原因落 audit log 并通知标注员/审核员/项目 owner
- **Bulk approve**: `POST /batches/bulk-approve` — 批量将「审核中」批次通过（reviewer 级权限）
- **Bulk reject**: `POST /batches/bulk-reject` — 批量驳回「审核中」批次，任务软重置为 pending，共享 feedback（reviewer 级权限）
- **BatchesSection UI**: lock/unlock 按钮（owner-only）+ 已锁 warning badge + 批量通过/驳回操作栏按钮 + AdminLockModal + BulkRejectModal
- **test_scheduler.py**: 19 个 scheduler 单测覆盖 `check_auto_transitions` 和 `get_next_task` 批次过滤逻辑

### Changed

- `BatchService.check_auto_transitions`: `admin_locked=True` 时直接返回，不再推状态
- `scheduler.get_next_task`: 候选查询追加 `admin_locked.is_(False)` 过滤
- `BatchOut` schema: 新增 `admin_locked`、`admin_lock_reason`、`admin_locked_at`、`admin_locked_by` 字段
- ADR-0008 Status: `Proposed` → `Accepted`，追加实施细节章节

### Fixed

- 无

---

## [0.9.14] - 2026-05-09

> **Fluttering Wirth — mask 多连通域 / 空洞协议升级 + 前端单测覆盖率 25→30 + 文档收口.** 0.9.x 收尾三段第二版. 主线: ① mask→polygon 协议升级 — `mask_to_multi_polygon` (RETR_CCOMP 抓内外环树) + `PolygonGeometry.holes` 默认 [] 向后兼容 + 新 `MultiPolygonGeometry` discriminated union, predictor 智能选择三种 LS shape 字面 (单连通无 hole 字面与 v0.9.13 100% 一致, 老 fixture / 老前端不破); ② 前端 `transforms.geometryToShape` 处理 multi_polygon 分支降级取主外环 + 完整 polygons 透传 `multiPolygon` 字段供 v0.10.x 镂空渲染升级 (ImageStage Konva sceneFunc evenodd 留 v0.10.x sam3-backend 接入同窗口做, 避免二次破窗); ③ `scripts/eval_simplify.py` 双跑 single + multi, 输出加 `iou_multi@{tol}` / `multi_only_helps %` 列, 90 张合成 fixture 跑 tol=1.0: IoU≥0.95 占比 92.2% → 100%, multi_only_helps 8.9% (即多连通 / 带空洞长尾根因占比); ④ 前端单测 25→30 — 新增 GeneralSection (7 case) / DatasetsSection (7 case) / AuditPage (7 case) / BatchesSection smoke (3 case) + transforms multi_polygon 几何映射 (4 case), 实测 30.30%; ⑤ ai-models.md §1 部署章节展开 (compose profile + nvidia 资源预留 + 显存预算表 + dev/生产差异); ⑥ ADR-0013 加 v0.9.14 多连通域升级章节. **不在范围**: 系统设置 admin UI (调研发现实际已落地, ROADMAP 优先级表删除该项); ImageStage Konva 镂空渲染 (推 v0.10.x); v0.9.15 admin-locked + bulk-approve/reject. → [plan](docs/plans/2026-05-09-v0.9.14-fluttering-wirth.md).

### Added

- **`mask_to_multi_polygon` 算法** (`apps/_shared/mask_utils/src/mask_utils/polygon.py`):
  - `cv2.findContours(RETR_CCOMP, CHAIN_APPROX_NONE)` 抓两层环树 (顶层 = 各连通域外环, 二层 = hole), `hierarchy[i][3] == -1` 区分外环 vs hole, hole 通过 parent 索引归属对应外环.
  - 每个外环 + 每个 hole 各自走 `shapely.simplify(tolerance, preserve_topology=True)`, 共用同一 tolerance.
  - `min_area=4.0` 像素阈值过滤 1-2 像素噪声 hole; 形态学 closing 默认 off (避免吞掉小真实 hole).
  - 输出 `list[{exterior, holes}]`, 按外环面积降序排列 (与 mask_to_polygon 单环时返回最大者语义对齐).
  - 保留 `mask_to_polygon` 旧函数不动, predictor 在单连通无 hole 时仍走旧路径以保持向后兼容. 新增 `_simplify_contour` / `_polygon_signed_area` 辅助.
  - 新增 `apps/_shared/mask_utils/tests/test_multi_polygon.py` 10 测试 (donut / 两圆 / 单连通退化 / 噪点 hole / 排序 / 归一化 / bool dtype) 全绿.
- **`PolygonGeometry.holes` + `MultiPolygonGeometry` schema** (`apps/api/app/schemas/_jsonb_types.py`):
  - `PolygonGeometry` 加可选 `holes: list[list[list[float]]]` 字段 (默认 `Field(default_factory=list)`, 老存量 / 老前端反序列化默认 [] 不破), 加 `_check_holes` validator (顶点 < 3 时 422).
  - 新增 `MultiPolygonGeometry { type: "multi_polygon", polygons: list[PolygonGeometry] }` (`min_length=1`).
  - `Geometry` discriminated union 加新分支 `BboxGeometry | PolygonGeometry | MultiPolygonGeometry`.
  - `apps/api/app/schemas/prediction.py`: `PredictionShape.geometry` Union 加 `MultiPolygonGeometry`.
- **`to_internal_shape` 三 shape 解析** (`apps/api/app/services/prediction.py`):
  - LS `polygonlabels` 现在识别三种 value 字面: ① `{points}` 单连通无 hole (老路径, 字面与 v0.9.13 之前完全一致, 不写 holes 字段); ② `{points, holes}` 单连通带 hole; ③ `{polygons:[{points, holes?}]}` 多连通.
  - 老 fixture / 老 DB JSONB 字面零变化; 新 fixture 透传新字段, Pydantic 反序列化 PolygonGeometry.holes 默认 [] 兜底.
- **predictor 智能选择 LS shape** (`apps/grounded-sam2-backend/predictor.py`):
  - 新增 `_rings_to_polygon_label(rings, label, score)`: 单连通无 hole 输出 `{points, polygonlabels}` (字面零差异); 单连通带 hole 输出 `{points, holes, polygonlabels}`; 多连通输出 `{polygons:[{points, holes?}], polygonlabels}`.
  - 新增 `_maybe_warn_vertex_count`: 累加所有 ring 顶点数 (外环 + holes), > 200 触发 logger.warning, 同时打 `rings=N` 帮助运维定位多连通来源.
  - `_masks_to_results` (point/bbox 路径) + `predict_text` (text 路径) 两处统一走 `mask_to_multi_polygon` + `_rings_to_polygon_label`.
  - 新增 `apps/grounded-sam2-backend/tests/test_multi_polygon_output.py` 6 测试 (三种 shape 字面 + score 透传 + score=None 路径 + text 路径 hole).
- **前端 `MultiPolygonGeometry` 类型 + transforms** (`apps/web/src/types/index.ts`, `apps/web/src/pages/Workbench/state/transforms.ts`):
  - `PolygonGeometry` 加可选 `holes?: [number, number][][]`, 新增 `MultiPolygonGeometry`, `Geometry` union 加新分支.
  - `AIBox` 加可选 `holes?` / `multiPolygon?` 字段, transforms `geometryToShape` 处理 multi_polygon 分支: `multiPolygonBounds` 计算 union AABB + `pickPrimaryPolygon` 取顶点数最多的主外环作为 `polygon` 字段 (编辑路径兼容), 完整 polygons 数组挂在 `multiPolygon` 透传给 v0.10.x 镂空渲染.
  - `transforms.test.ts` 加 4 v0.9.14 用例 (polygon+holes / multi_polygon 主环选择 / annotationToBox 透传 / predictionsToBoxes donut), 18 测试全绿.
- **`scripts/eval_simplify.py` 升级评测**:
  - 同时跑 `mask_to_polygon` + `mask_to_multi_polygon`, 表加 `iou_multi@{tol}` / `verts_multi@{tol}` / `rings@{tol}` / `iou_diff@{tol}` 列.
  - 汇总段加「v0.9.14 · 多连通域 / 空洞升级评测」表, 含 `multi_only_helps %` (升级使 IoU 提升 ≥ 0.02 的样本占比).
  - 新增 `_multi_polygon_iou(rings, mask)`: 外环 fillPoly 1 + hole fillPoly 0 累加 → IoU 公平比较.
  - 90 张合成 fixture tol=1.0: 单 polygon IoU≥0.95 占比 92.2% → multi 100%, multi_only_helps 8.9% (即多连通 / 带空洞的长尾根因).
- **前端 v0.9.14 单测推到 30%** (实测 30.30%, 425 case):
  - `apps/web/src/pages/Projects/sections/GeneralSection.test.tsx` (新, 7 case): 渲染初值 / dirty 检测 / 类别 chip 添加+删除 / 空名校验 / 启用 AI / 保存 mutation 触发.
  - `apps/web/src/pages/Projects/sections/DatasetsSection.test.tsx` (新, 7 case): 加载态 / 空 linked / 已关联表 / 关联 modal 候选 / 链接 mutation / 无候选 disabled / 取消关联 modal 触发.
  - `apps/web/src/pages/Audit/AuditPage.test.tsx` (新, 7 case): 总数 / 数据渲染 / CSV 导出 / detail 键值联动 / URL actor_id 追溯 / 刷新 refetch / target_type 同步.
  - `apps/web/src/pages/Projects/sections/BatchesSection.test.tsx` (新, 3 case smoke): 加载态 / 空 batches / useBatchEventsSocket 透传 project.id. 完整交互 (创建/bulk/逆向迁移/看板) 推到 v0.9.15 与 admin-locked UI 测试合并写.
  - 阈值 `apps/web/vite.config.ts:99-103` lines/statements 25 → 30, functions 30 / branches 60 不动.
- **api schema 测试** (`apps/api/tests/test_prediction_schema_adapter.py`):
  - 新增 8 v0.9.14 用例: `polygonlabels` 含 holes / 含 polygons / 老路径无 holes 字面不变 / Pydantic PolygonGeometry holes 默认 [] / hole 顶点 < 3 拒绝 / Geometry union discriminator 路由 multi_polygon / multi_polygon polygons 不能为空. 43 测试全绿.

### Changed

- **`apps/_shared/mask_utils/src/mask_utils/__init__.py`**: 导出 `MultiPolygonRing` + `mask_to_multi_polygon`, `__version__` 0.1.0 → 0.2.0.
- **`apps/_shared/mask_utils/tests/fixtures/synthetic.py`**: 新增 `donut_mask` / `two_circles_mask` / `multi_polygon_iou` 辅助 (test_multi_polygon.py 用).
- **`docs-site/dev/architecture/ai-models.md` §1 部署拓扑**: 展开为 §1.1 (compose profile + nvidia 资源预留 + dev/生产差异表) / §1.2 (显存预算 + variant 选型, 4 类 GPU 推荐组合) / §1.3 (镜像基础 + checkpoint 同步). 通用模板写法, v0.10.x sam3-backend 接入时直接复用骨架.
- **`docs/adr/0013-mask-to-polygon-server-side.md`**: Status 加 v0.9.14 注记, 新增「v0.9.14 update — mask 多连通域 / 空洞升级」章节 (触发 / 算法 / 协议 / 评测 / 前端落点 / 升级触发条件).
- **`apps/web/src/pages/AIPreAnnotate/components/ProjectDetailPanel.test.tsx`**: 加 `useUpdateProject` mock (v0.9.13 起 ProjectDetailPanel 调用持久化 chips/threshold) + `useBatchEventsSocket` noop mock (v0.9.13 起 mount 时发起 ws upgrade, MSW 没装 ws handler 时 libuv stream assert 致 worker crash). 修复 v0.9.13 落地遗留 10 个 fail test.

### Removed

- 无 (向后兼容, 老路径全保留).

### Operational notes

- **协议向后兼容承诺**: PolygonGeometry 加 `holes` 字段是纯加字段, 默认 []. MultiPolygonGeometry 是新 discriminator 分支. 老存量 DB JSONB / 老 fixture / 老前端字面零变化. predictor 在单连通无 hole 时永远输出旧 shape, 即使前端没合也不破.
- **前端 ImageStage Konva 镂空渲染降级**: v0.9.14 协议 + 类型 + transforms 已就位, 但 ImageStage 的 Konva `<Line>` 渲染层暂不变 (仅渲染主外环, holes 字段忽略). 客户场景里 8.9% 多连通 / 带空洞样本目前显示主外环 + 无镂空, 与 v0.9.13 之前可视一致, 不破回归. v0.10.x sam3-backend 接入时一并升级 sceneFunc evenodd 路径 (避免二次破窗).
- **用户 accept multi_polygon prediction 转 annotation**: 取主外环 (编辑路径单环假设), 丢 hole / 其余 ring. 客户反馈需要保留多 ring 时再扩 (与 PolygonTool 编辑器画 hole 同窗口做).
- **GPU 真实 SAM 50 张验收待补**: ROADMAP P3 `真实 SAM mask 50 张 simplify tolerance 验收` 仍开. 当前 90 张合成 fixture 量化 multi_only_helps 8.9%, 真实 SAM 长尾形态可能更显著 (mask 边界更碎). GPU 时窗到位时跑 `python scripts/eval_simplify.py --masks-dir <real_sam_dir>` 观察 multi_only_helps 是否 > 15%.
- **形态学 closing 默认 off**: 客户反馈「polygon 边界锯齿严重」时再开 (新增 `Context.morph_close=true` body 覆盖). 默认 on 会吞掉小真实 hole (甜甜圈中心半径 < 5 像素填实), 与「准确还原 mask」目标冲突.

---

## [0.9.13] - 2026-05-09

> **Eager Karp — 收尾 BUG 簇 + dev experience.** 0.9.x 三段收尾的第一版, 7/8 条收口. 主线: ① batch.status 变更 WS 广播 (`/ws/batches/project/:id` + `BatchEventPublisher.publish_batch_status_change` + 前端 `useBatchEventsSocket`, 接入 ProjectDetailPanel / BatchesSection / WorkbenchShell 三处 useBatches 消费方), B-15 第二症状端到端验证 100% 通过 (admin POST transition → redis pub/sub → 浏览器 WS 收 `batch.status_changed` 帧, multi-tab 实时同步); ② ProjectDetailPanel 加 alias chips 点击 toggle / 一键重填 + ThresholdRow (box/text slider 显式保存避免拖动 N 次 PATCH); ③ MlBackendFormModal 加 `max_concurrency` number input (1-32, 留空走默认 4) + RegisteredBackendsTab 行 `≤N 并发` chip; ④ 3 个 WS hook smoke 测试 (useGlobalPreannotationJobs / usePreannotation / useMLBackendStats, 16 case 全绿) 兜底 v0.9.11 「14 个月没人发现 URL 写错」类 bug; ⑤ `apps/api/app/main.py` lifespan + `apps/api/app/api/v1/ws.py:close_redis_pool()` (`asyncio.wait_for(timeout=2s)` 兜底) 缓解 uvicorn `--reload` 长 WS 卡 `Waiting for background tasks to complete`; ⑥ `apps/web/src/lib/wsHost.ts:getWsHost()` / `buildWsUrl()` 抽出收口 4 处 hook 重复的 `import.meta.env.DEV ? "localhost:8000" : window.location.host` 拼接 (vite proxy `/ws` 多并发卡死的绕法保留, 上游 minimal repro issue 留 follow-up); ⑦ docs-site/dev/architecture/ai-models.md §4.5 追加注册表单 UI 暴露说明. 截图 fixture 4 张空白态推迟 (用户已对齐, 不侵入 dev seed.py). → [plan](docs/plans/2026-05-09-v0.9.13-eager-karp.md).

### Added

- **batch.status 变更 WS 广播**:
  - `apps/api/app/services/progress.py`: 新增 `publish_batch_status_change(project_id, batch_id, from_status, to_status)`, 频道 `project:{project_id}:batch`, 消息体 `{type, batch_id, from, to, at}`. 一次性 `aioredis.from_url` instance + close (与 ProgressPublisher 同模式). 广播失败 log.warning 不阻塞业务事务.
  - `apps/api/app/api/v1/ws.py:batch_events_socket`: 新增 `/ws/batches/project/{project_id}` 端点, 复用 `_get_redis_pool()` + `_heartbeat_loop()` 心跳, 鉴权与 `/ws/projects/{id}/preannotate` 一致 (无 token, batch 状态非机密 + 项目内成员均需感知).
  - `apps/api/app/services/batch.py`: `BatchService.transition()` + `check_auto_transitions()` (ANNOTATING / REVIEWING 两条转态) 在 `db.flush()` 之后 emit, `from_status != to_status` 守卫避免无变化广播.
  - `apps/web/src/hooks/useBatchEventsSocket.ts` (新): 复用 `useReconnectingWebSocket`, 收 `batch.status_changed` 事件 invalidate `["batches", projectId]` + `["projects"]`. 心跳 ping 帧不触发 invalidate.
  - 接入: `ProjectDetailPanel.tsx` (项目详情面板) / `BatchesSection.tsx` (项目设置批次列表) / `WorkbenchShell.tsx` (标注工作台) 三处. 闭环 B-15 第二症状: useBatches 无 refetchInterval, useNotificationSocket 不会因 batch.auto_transition 触发 (该路径不写 notification 表).
- **alias chips + threshold UI (ProjectDetailPanel)**:
  - `apps/web/src/pages/AIPreAnnotate/components/ProjectDetailPanel.tsx`: prompt textarea 上方插入一行 alias chips (按预标频率排序, 复用 `aliasChipStyle` / `aliasChipActiveStyle` from `styles.ts`), 点击 chip 通过 `toggleAlias()` 添加 / 移除 (复用 PromptComposer.tsx 同款逻辑). 行末加「重填」按钮一键拼回所有 alias.
  - 新增 `ThresholdRow` 子组件: box_threshold / text_threshold 两个 range slider (step 0.05, 0-1), 拖动跟手, 脏检查 + 显式「保存」按钮提交 `useUpdateProject` (避免拖动过程触发 N 次 PATCH).
  - 项目级 `text_threshold` / `box_threshold` 字段已在 `apps/api/app/schemas/project.py:25-26,82-83` 就绪 (v0.9.2 GroundingDINO 阈值), `apps/web/src/pages/Projects/sections/GeneralSection.tsx:72-73` 已有同字段 UI; v0.9.13 把快捷调节路径搬到 `/ai-pre`, 让 admin 跑预标时无需切「项目设置」就能调阈值.
- **`max_concurrency` 注册表单 UI**:
  - `apps/web/src/components/projects/MlBackendFormModal.tsx`: 「认证方式」与「高级 extra_params」之间插入「最大并发」number input (min=1 / max=32 / placeholder「默认 4」). 提交时合并到 `extra_params.max_concurrency` (覆盖 textarea JSON 同名键, 避免双源真相). edit 模式从 `backend.extra_params.max_concurrency` 回填 + 从 textarea 视图剔除避免重复.
  - `apps/web/src/pages/ModelMarket/RegisteredBackendsTab.tsx`: 类型列「交互式 / 批量」Badge 旁加 `≤N 并发` outline chip, 仅当 `extra_params.max_concurrency` 存在时渲染 (缺省值不显示避免列表噪音). 包一层 span 加 `title` (Badge 组件不支持 title prop).
- **WS hook smoke 测试 (3 文件)**:
  - `apps/web/src/hooks/__tests__/useGlobalPreannotationJobs.test.tsx` (新, 6 case): admin + token URL 拼接 / 无 token 不建连 / 非 admin 不建连 / running 消息 → runningJobs 反映 / ping 帧不触发 state / 卸载主动 close.
  - `apps/web/src/hooks/__tests__/usePreannotation.test.tsx` (新, 4 case): projectId URL 拼接 / projectId 空不建连 / 收消息 setProgress / 卸载主动断.
  - `apps/web/src/components/PerfHud/__tests__/useMLBackendStats.test.tsx` (新, 6 case): visible+token URL / 不可见不建连 / 无 token 不建连 / backends 帧 → snapshots 反映 / ping 帧不触发 / 卸载主动 close.
  - 共 16 case 全绿. MockWebSocket 加 `static readonly CONNECTING/OPEN/CLOSING/CLOSED` 静态常量, 让 `useReconnectingWebSocket` 的 `ws.readyState === WebSocket.OPEN` 卸载逻辑能在测试环境触发.
- **WS host helper**:
  - `apps/web/src/lib/wsHost.ts` (新): 导出 `getWsHost()` (dev 直连 `localhost:8000`, prod 走 `window.location.host`) + `getWsProtocol()` + `buildWsUrl(path, params?)` 一站式 ws/wss + host + path + query 拼接.
- **lifespan close pool**:
  - `apps/api/app/api/v1/ws.py:close_redis_pool()` (新): 用 `asyncio.wait_for(_REDIS_POOL.disconnect(inuse_connections=True), timeout=2.0)` 强断 in-use 连接, 即便 pubsub.listen() 协程未及时收到 cancellation 也 2s 超时释放; 任何异常都不阻塞 shutdown (进程退出后内核会回收 socket).
  - `apps/api/app/main.py` lifespan yield 后 `await _close_ws_redis_pool()` (异常 try/except 兜底, uvicorn 会捕获后转 ERROR 日志并继续退出).

### Changed

- **`apps/web/src/hooks/useNotificationSocket.ts:48`** + **`useGlobalPreannotationJobs.ts:52`** + **`usePreannotation.ts:25`** + **`apps/web/src/components/PerfHud/useMLBackendStats.ts:69`**: 4 处硬编码 `import.meta.env.DEV ? "localhost:8000" : window.location.host` 全部迁移到 `import { buildWsUrl } from "@/lib/wsHost"`. `grep localhost:8000 apps/web/src/` 残留只剩 helper 内部 2 行.
- **`apps/api/app/services/progress.py`**: 模块级加 `logger` (供 publish_batch_status_change 错误处理用).
- **`apps/api/app/services/batch.py:20`**: 加 `from app.services.progress import publish_batch_status_change` import.
- **`docs-site/dev/architecture/ai-models.md` §4.5**: 末尾追加「注册表单 UI 暴露 (v0.9.13)」段, 说明 number input + chip 渲染规则 + 不再需要手改 DB JSONB.

### Fixed

- **B-15 第二症状闭环**: v0.9.12 已加 INFO/DEBUG 日志诊断「标注员开始标注 batch 未转 annotating」, 但 root cause 不是日志缺位 — 是前端无 invalidate 路径 (useBatches 无 refetchInterval, useNotificationSocket 仅监听 `["notifications"]`, batch.auto_transition 不写 notification 表). v0.9.13 加 batch.status WS 广播 + 前端 useBatchEventsSocket invalidate `["batches", projectId]` 闭环.
- **`apps/web/src/pages/ModelMarket/RegisteredBackendsTab.tsx:275`**: max_concurrency chip 原打算用 `<Badge variant="outline" title="...">`, 但 BadgeProps 不支持 title (`Type '{ children: ...; variant: "outline"; title: string; }' is not assignable to type 'IntrinsicAttributes & BadgeProps'`). 改为外层 `<span title="...">` 包 Badge.

### Operational notes

- **lifespan shutdown 仍可能 hang (剩余风险)**: v0.9.13 实测中遇到一次 lifespan 卡死 (API 不响应需手动重启), 已加 `asyncio.wait_for(timeout=2s)` 兜底但不能 100% 杜绝; 如再发, 考虑给 uvicorn 启动加 `--timeout-graceful-shutdown 5`. 详见 `docs-site/dev/how-to/debug-websocket.md` (待补).
- **vite 上游 ws upgrade 卡死 issue**: v0.9.13 抽 helper 不追根因, dev 直连 `localhost:8000` 绕法保留. minimal repro issue 还没提到 vitejs/vite, 留 v0.9.13 落地后新发现 ② 跟踪.
- **截图 fixture 推迟**: ROADMAP 原表 #8 用户已对齐推迟 — 不侵入 dev `apps/api/scripts/seed.py` (会污染开发数据), 留 v0.9.14+ 决策侵入 vs 新增独立 `screenshot_fixture.py` 路径.
- **rtk token-killer 代理 curl stdout 截断**: 验证脚本里发现 `rtk` (Rust Token Killer) 把 curl 输出截断到 ~500 字节. 后续大 JSON 测试要用 `/usr/bin/curl` 绕开 (已写入 v0.9.13 落地经验).
- **未删除文件**: 4 个 v0.9.7 stepper 子组件 (`PreannotateStepper` / `ProjectBatchPicker` / `PromptComposer` / `RunPanel`) + `usePreannotateDraft` 仍 orphan, 等「精细单批次预标 modal」回归时复用; v0.9.13 chips/threshold UI 是搬到 ProjectDetailPanel 不动 PromptComposer.

---

## [0.9.12] - 2026-05-09

> **Humming Roaming Oasis — `/ai-pre` 工作流再设计 + BUG B-14~B-17 收尾.** Admin 反馈簇 4 条一并落地: ① B-17 IA 重构 `/ai-pre` 主页从 stepper 改为「项目卡片网格 (`ProjectCardGrid`) → 项目详情面板 (`ProjectDetailPanel`)」两层信息架构, 主视图仅渲染接了 ml_backend 的项目, 进入项目后多选 batch + 串/并行预标 + 已就绪 HistoryTable; ② B-16 HistoryTable 加 checkbox 多选 + 浮窗批量「重激活 (predictions_only)」/「重置 draft (reset_to_draft)」, 复用 BatchesSection 同款 BulkActionResponse 模式; ③ B-15 `BatchService.reset_to_draft` 加 4 条级联清理 (NULL `annotations.parent_prediction_id` → DELETE `prediction_metas` → DELETE `predictions/failed_predictions` → DELETE `prediction_jobs`), `check_auto_transitions` 加 INFO 日志诊断「标注员开始标注后 batch 未转 annotating」第二症状; ④ B-14 删除 `/model-market?tab=failed` (失败预测已迁到 `/ai-pre/jobs`), 老书签 `?tab=failed` 自动 redirect 到 `/ai-pre/jobs?status=failed`. 同时收口: ① `ml_backends.extra_params.max_concurrency` 接通 per-backend `asyncio.Semaphore` 限速 (默认 4 兼容 worker concurrency); ② v0.9.11 修了 URL 但漏更新的 `useNotificationSocket.test.tsx` stale 测试同步修. → [plan](docs/plans/2026-05-09-v0.9.12-ai-pre-workflow-redesign.md).

### Added

- **`/ai-pre` 项目卡片网格 (B-17)**:
  - `apps/web/src/pages/AIPreAnnotate/components/ProjectCardGrid.tsx` (新): grid 布局 (auto-fill minmax 280px), 卡片元素 = 项目名 + type chip + ml_backend 状态 chip (灰=disconnected/黄=mismatch/绿=ready) + 三个数字徽章 (待预标 / 已就绪 / 近期失败) + 最近 job 时间 + max_concurrency 标识. 空态提示「先在模式市场注册 backend」.
  - `apps/web/src/pages/AIPreAnnotate/components/ProjectDetailPanel.tsx` (新): 进入项目后的详情面板, 头部含「返回项目列表」按钮 + 项目名 + ml_backend chip + 历史 job 跳转链接 + max_concurrency 提示. 主体 = 待预标 batches 多选列表 + (≥1 选中时) Prompt textarea + 输出形态 TabRow + (≥2 选中时) 串/并行单选 + Run 按钮; 下方 `<HistoryTable items={projectQueue} />` 复用 Phase 4 多选基建.
  - 串/并行调度: 串行 = `for...await trigger.mutateAsync({batch_id})`; 并行 = `Promise.all(ids.map(...))`. 后端由 v0.9.12 新增的 per-backend `asyncio.Semaphore` 实际护盾, 前端只发请求.
- **后端 `/admin/preannotate-summary` 项目维度聚合**:
  - `apps/api/app/api/v1/admin_preannotate.py:list_preannotate_project_summary`: 仅返回 `EXISTS (SELECT 1 FROM ml_backends WHERE project_id = projects.id)` 的项目, 含 ready_batches / active_batches / last_job_at / recent_failures (排除 dismissed) / ml_backend_max_concurrency. 同项目多 backend 时优先选 `Project.ml_backend_id` 指向的那条.
  - `PreannotateProjectSummary` Pydantic 子模型 + `PreannotateProjectSummaryResponse`.
- **后端 `/admin/preannotate-queue/bulk-clear` 多选批量端点 (B-16)**:
  - `apps/api/app/api/v1/admin_preannotate.py:bulk_clear_preannotate`: body `{batch_ids: [uuid], mode: "predictions_only" | "reset_to_draft", reason}`, project_admin 越权进 `skipped[reason=forbidden]`, 不阻断其他成功项, 返回 `BulkClearResponse {succeeded, skipped, failed}`.
  - `predictions_only` 模式: 仅清 prediction / failed_prediction / prediction_jobs / prediction_metas, 同时把 batch.status 从 `pre_annotated` 回 `active` (避免 "PRE_ANNOTATED 状态但 prediction 已空" 矛盾态).
  - `reset_to_draft` 模式: 复用 `BatchService.reset_to_draft` (Phase 1 落地的级联清理).
  - `AuditAction.PREANNOTATE_BULK_CLEAR` 新枚举 + audit detail 含 mode / reason / 各计数 / `cascade` 累计.
- **`max_concurrency` per-backend 限速 (B-17)**:
  - `apps/api/app/services/ml_client.py`: 模块级 `_semaphores: dict[backend_id, asyncio.Semaphore]` 缓存 + `MLBackendClient.__init__` 读 `extra_params.max_concurrency` (默认 4), `predict()` / `predict_interactive()` 在 `async with await self._acquire():` 信号量护盾内.
  - 信号量按 backend_id 永久缓存 (改 max_concurrency 需 worker 重启), 工时 vs 简洁性的取舍.
- **HistoryTable 多选 + 浮窗 + 批量操作 (B-16)**:
  - `apps/web/src/pages/AIPreAnnotate/components/HistoryTable.tsx`: 加 `selectedIds: Set<string>` state + 表头全选 checkbox (当前页) + 每行 checkbox + 选中行高亮 + `<BulkActionBar>` 浮窗 (sticky bottom) 含「批量重激活」/「批量重置 draft」按钮 + Modal 确认表单 (≥10 字 reason 校验) + 部分失败时切到 `<BulkResultView>` 展开 failed/skipped 详情.
  - 选中状态按 batch_id 索引, 跨折叠 / 翻页 / 项目分组保留.
  - `apps/web/src/hooks/useBulkPreannotateActions.ts` (新): `useBulkPreannotateClear` mutation hook + `useAIPreProjectSummary` query hook, mutation 成功后 invalidate `preannotate-queue` / `preannotate-summary` / `batches` / `preannotate-jobs`.
- **API client + types**:
  - `apps/web/src/api/adminPreannotate.ts`: 加 `BulkClearMode` / `BulkClearRequest` / `BulkClearItem` / `BulkClearResponse` / `PreannotateProjectSummary` / `PreannotateProjectSummaryResponse` 类型 + `bulkClear` / `summary` API method.
- **测试覆盖**:
  - `apps/api/tests/test_v0_7_6.py`: 加 2 case (`test_reset_to_draft_cascades_predictions` / `test_check_auto_transitions_pre_annotated_to_annotating`).
  - `apps/api/tests/test_admin_preannotate.py`: 加 3 case (bulk-clear 单 batch + 越权 / preannotate-summary 过滤无 ml_backend 项目).
  - `apps/api/tests/test_ml_client_metrics.py`: 加 2 case (max_concurrency=2 实测 peak ≤ 2 / 默认 cap=4).
  - `apps/web/src/pages/AIPreAnnotate/components/HistoryTable.test.tsx` (新): 6 case (空选中 / 单选 / 全选 / 批量重激活 reason 校验 / 部分失败结果视图).
  - `apps/web/src/pages/AIPreAnnotate/components/ProjectCardGrid.test.tsx` (新): 4 case (空态 / 加载态 / 渲染元素 / onSelect).
  - `apps/web/src/pages/AIPreAnnotate/components/ProjectDetailPanel.test.tsx` (新): 8 case (header / 多选 prompt 显隐 / 串行 mutateAsync 调用顺序 / 并行 Promise.all / 未绑定 backend 警告 / onBack).

### Changed

- **`apps/api/app/services/batch.py:reset_to_draft`**: 返回签名升级为 `(batch, affected_tasks, cascade_counts)`. 调用方 `apps/api/app/api/v1/batches.py:432` 同步, audit detail 加 `cascade` 字段.
- **`apps/api/app/services/batch.py:check_auto_transitions`**: 加 INFO/DEBUG 日志覆盖 `pre_annotated → annotating` / `active → annotating` / `annotating → reviewing` 三条转换路径, 后续端到端定位 admin 反馈的 "标注员开始标注未转 annotating" 真因.
- **`apps/web/src/pages/AIPreAnnotate/AIPreAnnotatePage.tsx`**: 354 行 stepper 主体 + 内嵌 `<FailedPredictionsTab />` 简化为 ~70 行壳 (ProjectCardGrid + ProjectDetailPanel 切换). 旧 v0.9.7 拆出的 4 个 stepper 子组件 (PreannotateStepper / ProjectBatchPicker / PromptComposer / RunPanel) + `usePreannotateDraft` hook 文件保留, 等 v0.9.13+ 「精细单批次模式」复用 (走 modal 入口).
- **`apps/web/src/pages/ModelMarket/ModelMarketPage.tsx`**: 删 tab 容器逻辑 (TABS 数组 + tab nav UI + `useFailedPredictions` 徽章), 直接渲染 `<RegisteredBackendsTab />`. `?tab=failed` 自动 redirect 到 `/ai-pre/jobs?status=failed` 兼容老书签.
- **`apps/web/src/pages/AIPreAnnotate/AIPreAnnotateJobsPage.tsx`**: `statusFilter` 初始值从 URL `?status=` 读取, 支持 ModelMarket redirect 直接落到失败筛选.
- **`apps/web/src/pages/Dashboard/AdminDashboard.tsx:179`**: 失败预测入口 `navigate("/model-market?tab=failed")` 改为 `navigate("/ai-pre/jobs?status=failed")`.
- **`apps/api/app/services/audit.py`**: 新增 `AuditAction.PREANNOTATE_BULK_CLEAR = "preannotate.bulk_clear"`.

### Fixed

- **`apps/api/app/services/batch.py:reset_to_draft` 缺级联清理 (B-15)**: 之前 reset 后 `predictions` / `failed_predictions` / `prediction_jobs` 仍残留, `/ai-pre` HistoryTable 仍渲染该 batch 已就绪卡片. 加 4 条 delete (含 `annotations.parent_prediction_id` NULL → `prediction_metas` 先删 → `predictions/failed_predictions` → `prediction_jobs`), 删除顺序遵循 projects.py:416-434 同款.
- **`/model-market?tab=failed` 与 `/ai-pre/jobs` 双源真相漂移 (B-14)**: 删 ModelMarket 失败预测 tab, 唯一入口收口到 `/ai-pre/jobs?status=failed`.
- **`apps/web/src/hooks/__tests__/useNotificationSocket.test.tsx:85` stale 测试**: v0.9.11 修了 URL `/api/v1/ws/notifications` → `/ws/notifications` 但漏更新此测试断言, v0.9.12 同步修复 (期望 `/ws/notifications` + `not.toMatch(/api/v1/ws/notifications/)`).

### Operational notes

- **`max_concurrency` 改后需重启 worker**: per-backend Semaphore 按 backend_id 永久缓存; 改 `ml_backends.extra_params.max_concurrency` JSONB 字段后须 `docker compose restart api celery-worker`. 工时 vs 简洁性的取舍, 见 `docs-site/dev/architecture/ai-models.md`.
- **`predictions_only` mode 语义**: 删 prediction 后 batch 同时回 `active` (避免 PRE_ANNOTATED 状态但 prediction 已空的矛盾态); 与 `reset_to_draft` 全量重置区分明确.
- **B-15 第二症状诊断**: `check_auto_transitions` 日志已加 (INFO 级触发转换, DEBUG 级未触发), 但代码逻辑本身覆盖 `pre_annotated → annotating`. 后续端到端跑实际触发点定位真因; 若结论是 30s refetch 延迟感知误差, 留 follow-up 加 batch.status 变更 WS 广播 (`/ws/batches/project/:id`).
- **未删除文件**: 旧 stepper 4 个子组件 + `usePreannotateDraft` 文件保留 (orphan 但被 plan §5 标注 "v0.9.13+ 复用"); 不计入 bundle (vite tree-shake).

---

## [0.9.11] - 2026-05-09

> **Modular Star — CSP nonce 收紧 + GPU PerfHud 浮窗 + v0.9.8 schema/cost gap 收口.** 三块并行: ① CSP `script-src` 从 `'unsafe-inline'` 收紧为 nonce-based (Nginx `sub_filter` 替换 `__CSP_NONCE__` 占位符为 `$request_id`, vite plugin build 时给 `<script>` + `<meta>` 注入占位符, FastAPI middleware 同步收紧 API 响应路径; `style-src 'unsafe-inline'` 仍保留待 v0.10.x ProjectSettingsPage 重构同窗口收紧 ~2600 处内联 style); ② GPU/ML backend 实时监控浮窗 PerfHud (后端 `pynvml` + `psutil` 扩 `/health.gpu_info` util/温度/功耗 + `host` 容器 CPU/RAM, API `/ws/ml-backend-stats` admin-only WS + Celery beat 1s pull/publish + Redis 订阅者计数门控, 前端 280×180 浮窗 4 progress bar + 60s sparkline, 全局 `Ctrl+Shift+P` + TopBar activity icon admin only); ③ v0.9.8 遗留 gap 收口 — 后端 `PredictionShape` Pydantic 模型 (geometry 复用 `_jsonb_types.{Bbox,Polygon}Geometry`), `PredictionOut.result` 类型从 `list[dict]` 收紧到 `list[PredictionShape]`, 前端 `apps/web/src/types/index.ts` 切 codegen 派生; `prediction_jobs.total_cost` 接通 `PredictionMeta.total_cost` 累加 (worker 循环内汇总, job 完成时写 `Decimal(10,4)`).

### Added

- **CSP nonce 基础设施**:
  - `apps/web/vite-plugins/csp-nonce.ts`: 自定义 vite plugin, `transformIndexHtml.post` 给所有 `<script>` 加 `nonce="__CSP_NONCE__"` + `<head>` 内插 `<meta name="csp-nonce" content="__CSP_NONCE__">`.
  - `infra/docker/nginx.conf`: `sub_filter '__CSP_NONCE__' $request_id` (sub_filter_once off, sub_filter_types text/html), 同时 `add_header Content-Security-Policy "...script-src 'self' 'nonce-$request_id' https://challenges.cloudflare.com..."`. CSP / X-Frame-Options / HSTS / Referrer-Policy 全套头在 location / 出站. /assets / 不动.
  - `apps/web/index.html`: 加 `<meta name="csp-nonce" content="__CSP_NONCE__">`.
  - `apps/web/src/lib/turnstile.ts`: 动态 script 注入读 meta 设 `script.nonce`. 加 2 个 vitest case.
  - `apps/api/tests/test_security_headers.py` (新): 3 case 验 API 路径 CSP `script-src` 不含 `'unsafe-inline'` / `style-src` 仍保留 / 其他安全头不变.
- **PerfHud (GPU MVP)**:
  - `apps/grounded-sam2-backend/observability.py`: 新增 5 个 Gauge (`gpu_utilization_percent` / `gpu_temperature_celsius` / `gpu_power_watts` / `container_cpu_percent` / `container_memory_percent`) + `init_perfhud_collectors` / `shutdown_perfhud_collectors` / `sample_perfhud()` (pynvml + psutil 同步采样, 异常降级返回 None).
  - `apps/grounded-sam2-backend/main.py`: lifespan startup 调 `init_perfhud_collectors`, shutdown 调 cleanup; `/health` 调 `sample_perfhud()` 扩 `gpu_info` util/温度/功耗 + 新增 `host` 段.
  - `apps/grounded-sam2-backend/pyproject.toml`: 加 `pynvml>=11.5` + `psutil>=5.9`.
  - `apps/api/app/schemas/ml_backend.py`: 新增 `GpuInfo` / `HostInfo` / `CacheStats` / `HealthMeta` / `MLBackendStatsSnapshot` Pydantic 子模型 (前端 codegen 派生); `MLBackendOut.health_meta` 类型从 `dict` 收紧到 `HealthMeta`.
  - `apps/api/app/services/ml_client.py:health_meta`: 透传 `host` 段到 `ml_backends.health_meta`.
  - `apps/api/app/api/v1/ws.py:/ws/ml-backend-stats`: admin-only (super_admin / project_admin) WebSocket. accept 时 `INCR ml-backend-stats:subscribers`, close 时 `DECR` (异常退出走 `max(0, ...)` 防漂移). 30s 心跳保活. 订阅 redis `ml-backend-stats:global` channel.
  - `apps/api/app/workers/ml_health.py:publish_ml_backend_stats`: 新 Celery task. 1s 触发: 读订阅者计数 → 0 时 skip, > 0 时拉所有 `state != 'disconnected'` backend 的 `health_meta()` → publish 单帧 list 到 `ml-backend-stats:global`.
  - `apps/api/app/workers/celery_app.py`: 新增 `publish-ml-backend-stats` beat schedule (`timedelta(seconds=1)`).
  - `docker-compose.yml`: 新增独立 `celery-beat` service (复用 `Dockerfile.api` image, command `celery ... beat -l info --schedule=/tmp/celerybeat-schedule`). worker / beat 解耦 — worker 可 scale 多副本, beat 必须单实例避免 schedule 重复触发. PerfHud 1s 推送 + audit partition 月度任务 + ml health 60s 等都依赖此进程.
  - `apps/grounded-sam2-backend/Dockerfile`: 硬编码 pip install 列表加 `pynvml>=11.5` + `psutil>=5.9` (Dockerfile 不读 pyproject.toml, 必须显式列出).
  - `apps/web/src/components/PerfHud/`: 新组件目录. `PerfHud.tsx` (280×180 fixed top-right 浮窗, 4 progress bar 阈值变色 < 70% 绿 / 70-90% 黄 / > 90% 红, 展开后 60s sparkline `apps/web/src/components/ui/Sparkline.tsx` 复用, 底部 device_name / temp / power / cache hit rate / model_version, 多 backend select 切换); `useMLBackendStats.ts` (visible 时建 WS, 关闭即断, 60 帧 ring buffer × 4 metrics); `usePerfHudStore.ts` (zustand visibility store).
  - `apps/web/src/App.tsx`: 全局 `Ctrl+Shift+P` keydown listener (input/textarea/contenteditable 内不拦截) + `<PerfHud />` 挂载.
  - `apps/web/src/components/shell/TopBar.tsx`: activity icon button (super_admin / project_admin only) toggle perfhud store.
  - `docs-site/dev/architecture/perfhud.md` (新): 数据流图 + 关键文件 + 性能开销 + 待扩展. `docs-site/dev/monitoring.md` 加交叉引用.
- **PredictionShape codegen + total_cost 接通**:
  - `apps/api/app/schemas/prediction.py`: 新增 `PredictionShape` Pydantic 模型 (`type: str`, `class_name: str`, `geometry: BboxGeometry | PolygonGeometry | dict[str, Any]`, `confidence: float`). `PredictionOut.result` 类型从 `list[dict]` 收紧到 `list[PredictionShape]`. 复用 `_jsonb_types.{Bbox,Polygon}Geometry`.
  - `apps/api/openapi.snapshot.json` + `apps/web/src/api/generated/types.gen.ts`: 重导后含新 `PredictionShape` / 收紧 `PredictionOut.result`.
  - `apps/web/src/types/index.ts`: 删手写 `PredictionShape` / `PredictionResponse`, 改 re-export generated 类型 + 对 geometry 做轻度窄化 (剔除 dict fallback) 兼容 `transforms.ts` 强类型消费.
  - `apps/api/app/services/ml_client.py:PredictionResult`: 加 `meta: dict | None` 字段 (LLM-backed backend 透传 token/cost 用; grounded-sam2 走 None).
  - `apps/api/tests/test_prediction_jobs_worker.py:test_run_batch_accumulates_total_cost` (新): mock `MLBackendClient` 返回带 `meta.total_cost=0.0012` × 2, 验证 `job.total_cost == Decimal("0.0024")`.

### Changed

- **`apps/api/app/middleware/security_headers.py`**: API 响应路径 CSP `script-src` 删除 `'unsafe-inline'` (改为 `'self' https://challenges.cloudflare.com`). HTML 路径 CSP 由 Nginx 注入 nonce, 中间件不再处理 nonce. `style-src 'unsafe-inline'` 保留 (前端 ~2600 处内联 style 留 v0.10.x 迁移).
- **`apps/api/app/api/v1/tasks.py:get_predictions`**: read 路径重构. 之前 `PredictionOut.model_validate(p)` 直读 DB 上的 LabelStudio raw shapes, 然后覆盖 `out.result = shapes`; v0.9.11 因 `result` 类型收紧到 `list[PredictionShape]` 直读会失败, 改为 `to_internal_shape()` 转换后再用显式 dict 构造 `PredictionOut.model_validate({...})`.
- **`apps/api/app/workers/tasks.py:_run_batch`**: 加 `running_total_cost` 累加器, 每条 prediction `meta.total_cost` 累加; job 完成时 `job.total_cost = Decimal(running_total_cost.4f)`. 空任务 job 也写 `Decimal("0.0000")` (与正常路径一致, 避免 NULL 残留).
- **`docs/adr/0010-security-headers-middleware.md`**: 加 v0.9.11 update 段, 状态从 Accepted (baseline) 升到 Accepted (script-src nonce). Follow-up 1 改为只剩 style-src 迁移.
- **`docs-site/dev/architecture/api-schema-boundary.md`**: v0.9.8 ⚠ 状态改 ✅ "v0.9.11 codegen 迁移完成", 标注 PredictionShape / PredictionResponse 已切派生.

### Fixed

- **`apps/web/src/hooks/useNotificationSocket.ts:45`**: URL 从错误的 `/api/v1/ws/notifications` 改回 `/ws/notifications` (`ws_router` 在 `apps/api/app/main.py:108` 是 `app.include_router(ws_router)` 无 prefix 注册). v0.6.9 起就写错的隐性 bug — 通知 WS 实时推送一直返回 404 立即关闭, 标注员通知红点徽章纯靠 v0.7.0 加的 30s `useNotifications` refetchInterval 兜底拿到, 误以为 WS 在工作. v0.9.11 PerfHud 联调时 console 一并暴露此 bug 并修.
- **`apps/web/` 4 处 WS hook (`useMLBackendStats` / `useNotificationSocket` / `useGlobalPreannotationJobs` / `usePreannotation`)**: dev 模式 (`import.meta.env.DEV`) 直连 `localhost:8000` 绕过 vite proxy `/ws`. 触发: 多个 WS hook 在同一会话并发建立时, vite 内部 http-proxy ws-mode 偶发卡 CONNECTING 永不返回 (单 WS 时 OK; 浏览器看不到 onerror/onclose 回调 → 浮窗永远显示"正在连接"). production 走 nginx 反向代理 `/ws/` location 不受影响 (`infra/docker/nginx.conf` 已就绪).
- **`apps/api/app/workers/celery_app.py:32-44`**: `task_routes` 补 `publish_ml_backend_stats` + `check_ml_backends_health` 显式路由到 `default` queue. worker 订阅 `default,ml,media` 但缺路由的 task 默认走 celery 队列, 触发 65 条 task 堆积无人消费. 历史 `check_ml_backends_health` 也漏在路由表外, 同步补上.
- **`apps/api/app/workers/ml_health.py:_publish_stats_async`**: 改用 per-task `create_async_engine` + `async_sessionmaker` (与 `tasks._run_batch` 一致), 替换全局 `async_session()`. Celery prefork pool concurrency=2 + 1s 高频触发时全局 engine 在 fork worker 间共享触发 asyncpg `InterfaceError: cannot perform operation: another operation is in progress`. per-task engine 单次 < 50ms, dispose 干净.

### Operational notes (运维提示, 非代码改动)

- **uvicorn `--reload` + 长 WS 连接 = reload 永卡死**: 改 `app/workers/celery_app.py` 触发 `WatchFiles detected changes ... Reloading`, 老 worker 进入 graceful shutdown 等所有 background tasks 完成 → 浏览器持有的 WS 长连接永远不"完成" → 老进程死锁在 `Waiting for background tasks to complete (CTRL+C to force quit)`, 新代码永不加载. 临时绕法: `kill -9 <pid>` 强杀 + 重启. 长期看可考虑启动时加 `--ws-max-size` / 自定义 lifespan close-on-reload, 留 follow-up.
- **docker celery-worker / celery-beat 必须分别 build**: image 用 `COPY` 而非 volume mount, `apps/api/app/workers/*.py` 改后必须 `docker compose build celery-worker && docker compose up -d celery-worker celery-beat` (重启不够 — 见 CLAUDE.md §7 "Docker rebuild vs restart"). v0.9.11 拆出独立 `celery-beat` service (worker / beat 解耦, beat 单实例避免 schedule 重复触发, 与 Celery 最佳实践对齐).

---

## [0.9.10] - 2026-05-08

管理员反馈第二轮 BUG 修复 (B-10 ~ B-13) + AI 置信度链路修复:

- **B-10** `/ai-pre` 默认勾选所有 alias, chip 切换添加/移除 + 全选/清空
- **B-11** 采纳/驳回后紫框消失 (按 prediction+shapeIndex 双键过滤); `accept_prediction` 反查 `classes_config` 把 alias 映射回原类别名
- **B-12** 工作台"一键预标注"自动用项目所有 alias 拼 prompt, 避免 DINO 422
- **B-13** 类别管理支持重命名 (新端点原子改 `classes_config` + 迁移 `annotations.class_name`)
- **AI 置信度链路**: `predictor.py` 此前丢弃 DINO box logits（box 模式硬编码 `score=1.0`, mask 模式用 SAM mask 质量分），改为回填真实 DINO 检测置信度；画布 label 用户框不再显示 100%，AI 框追加 `%` 单位
- **accept_prediction 拆 shape 级**: 避免一个 prediction 含多 shape 时采纳一个就把同 prediction 其它框全采纳；"全部采纳"与前端 `confThreshold` 同步
- 置信度阈值 UI 加澄清: 仅前端过滤展示, 不重跑模型

## [0.9.9] - 2026-05-08

修复管理员反馈的一系列 BUG (B-2 ~ B-8):

- **B-2** AI 工作流闭环: 失败预测 (FailedPredictionsTab) 从 `/model-market` 平移到 `/ai-pre`; HistoryTable 改成项目→批次两级折叠
- **B-3** 超管入口语义: sidebar 上 super_admin 拆出"平台概览" + "项目总览"两条; `/dashboard?view=projects` 让超管也能看到与 project_admin 一致的项目列表
- **B-4** bug 反馈截图迁到独立 MinIO 桶 `bug-reports` (180 天 lifecycle), 与标注桶 `annotations` 解耦
- **B-5** AI 相关审计日志: 新增 `ai.preannotate.triggered` / `ml_backend.created` / `ml_backend.updated` / `ml_backend.deleted`; 前端 auditLabels 同步翻译
- **B-6** 项目设置未保存提示: 新增 `useUnsavedWarning` hook + 黄色 dirty 徽章 (General/Classes/Attributes 三个 section)
- **B-7** AI 模型语义统一: GeneralSection 把"实际 ML Backend"提到主选项, PRESET 模型名 hint 折叠到 details (仅未绑定时使用); 保存时 ai_model 优先派生自 backend.name
- **B-8** 工作台 AI 一键预标: 修掉 `ml_backend_id=""` 空字符串导致的 dispatch 报错, 未绑定时给出明确 toast 引导用户去项目设置
## [0.9.8] - 2026-05-08

> **Fluffy Cosmos — Prediction Job 历史 + v0.9.7 端到端跑通后暴露的隐性 bug 收口.** 主线 6 块: ① `prediction_jobs` 表 + worker 写入开始/结束/失败 3 时点 (含 success/failed 计数 + duration_ms + celery_task_id 反查); ② `GET /admin/preannotate-jobs` cursor 翻页端点 (与 `/preannotate-queue` 区分: 前者全量历史含已重置批次, 后者当前 pre_annotated 快照); ③ `/ai-pre/jobs` 子路由 + Layout (顶部 tab 切「执行 / 历史」), 新建 `AIPreAnnotateJobsPage` 列状态/时长/失败计数 + 状态/搜索过滤 + cursor 翻页; ④ 利用既有 `@hey-api/openapi-ts` codegen 把新 `PredictionJobOut` 派生自 `types.gen.ts` (枚举 status 收紧 union) + 加 `predictionsToBoxes` 5 黄金样本 vitest + 后端 `to_internal_shape` idempotent / 双 schema 共存边界 3 case + 新增 `docs-site/dev/architecture/api-schema-boundary.md` (3 层 schema 边界图 + adapter 责任 + 何时跑 codegen); ⑤ `MLBackendCreate.url` / `MLBackendUpdate.url` Pydantic field_validator 拒绝 loopback host (localhost / 127.0.0.1 / 0.0.0.0 / ::1), 错误信息提示用 docker bridge IP / service DNS, 配套 v0.9.6 placeholder; ⑥ WS 多项目可见性: `_publish_progress` 在 job 开始/结束/失败 3 时点同时发到全局 channel `global:prediction-jobs`, 新 `/ws/prediction-jobs` admin-only 鉴权 token + RBAC 过滤, 前端 `useGlobalPreannotationJobs` hook + Topbar 紫色 `PreannotateJobsBadge` (0 个 job 时隐身, 点击 popover 列项目名 + 进度条 + 跳转), `AIPreAnnotatePage` 切项目时若旧项目仍有 in-flight job 弹 warning toast 提示 Topbar 徽章可回跳.

### Added

- **`apps/api/alembic/versions/0052_prediction_jobs.py`**: `prediction_jobs` 表 (UUID PK / project_id × batch_id × ml_backend_id 三 FK / prompt TEXT / output_mode VARCHAR(30) / status running|completed|failed CHECK / total/success/failed counts / started_at default now / completed_at / duration_ms / total_cost NUMERIC(10,4) NULL (worker 暂未聚合 PredictionMeta.total_cost, v0.9.9+) / error_message / celery_task_id VARCHAR(64) — 用于 `_BatchPredictTask.on_failure` 反查行写错误). 3 个索引 (project+status+started_at desc / status+started_at desc 全局 in-progress 查询 / celery_task_id).
- **`apps/api/app/db/models/prediction_job.py`**: SQLAlchemy `PredictionJob` 模型 + `PredictionJobStatus` enum. `db/models/__init__.py` 导出.
- **`apps/api/app/api/v1/admin_preannotate_jobs.py`**: `GET /admin/preannotate-jobs?project_id=&status=&from=&to=&search=&cursor=&limit=` 端点. cursor 复合 `(started_at DESC, id DESC)` base64-json 编码, 复用 v0.9.7 alias-frequency 风格. PROJECT_ADMIN / SUPER_ADMIN gated. 8 个端到端测试 (空 / 403 / 基础列举 / project_id 过滤 / status 过滤 / search prompt ILIKE / from-to 范围 / 三页 cursor 翻页 / 非法 status 422).
- **`apps/web/src/pages/AIPreAnnotate/AIPreAnnotateLayout.tsx`**: 顶部水平 tab nav「执行预标 / 完整历史」+ `<Outlet />`. App.tsx 路由 `/ai-pre` 改为嵌套 (index → AIPreAnnotatePage, jobs → AIPreAnnotateJobsPage).
- **`AIPreAnnotateJobsPage.tsx`**: 拉 `/admin/preannotate-jobs` 渲染 10 列表 (项目 / 批次 hash / prompt 截断 50ch + tooltip / outputMode / 状态徽章 ai-running 紫 / success 绿 / danger 红 / 总数 / 失败 Badge / duration friendly format / started_at relative / 跳工作台). 状态 select 过滤 + prompt 搜索 + cursor 上/下翻页 (cursorStack 维护历史栈).
- **`apps/web/src/api/adminPreannotateJobs.ts`**: `PredictionJobOut` 类型从 `generated/types.gen.ts` 派生 + status 收紧成 `"running" | "completed" | "failed"` union (后端 Literal codegen 折成 string). `adminPreannotateJobsApi.list(params)` 客户端.
- **`apps/api/app/api/v1/ws.py:/ws/prediction-jobs`**: 全局 prediction job 进度通道. JWT token 校验 + role admin 守卫 (其他角色 1008). 订阅 redis `global:prediction-jobs` channel, 接续 message → WS forward, 30s 心跳保活.
- **`apps/web/src/hooks/useGlobalPreannotationJobs.ts`**: 维护 `Map<job_id, JobProgress>` 全局 in-progress 状态. 用 `useReconnectingWebSocket` 退避重连. 完成 / 失败 1.5s 后从 Map 移除 (allow Topbar 短暂显示「刚完成」状态后退场). `byProject[project_id]` 索引最新 in-progress job 给切项目 toast 用.
- **`PreannotateJobsBadge.tsx`** (`components/shell/`): Topbar 紫色徽章 + popover. 0 个 job 时不渲染 (隐身). 点击展开 popover, 列每个 job: 项目名 / `current/total · pct%` / 进度条 / 整行点击跳 `/ai-pre?project_id=X`. 4 vitest case (0 job 隐身 / 数字徽章 / popover 列出 + 排序 / 进度百分比).
- **`docs-site/dev/architecture/api-schema-boundary.md`**: 新建 3 层 schema 边界文档 (DB JSONB → API Pydantic → 前端 codegen + 手写). adapter 责任 + idempotent 不变量 + codegen 何时跑 + 故障注入提示 (Sentry 空 box 比例告警 / 后端 unknown type counter).
- **黄金样本测试**:
  - `apps/web/src/pages/Workbench/state/transforms.test.ts` 增 5 case (空 result / 多 prediction 多 shape id 索引 / polygon bounds / confidence=0 不丢失 / class_name 空字符串).
  - `apps/api/tests/test_prediction_schema_adapter.py` 增 3 case (idempotent 二次调用 / `geometry` + `value` 双存时 geometry 优先 / pass-through 不丢非标字段).
  - `apps/api/tests/test_prediction_jobs_worker.py` (新, 6 case): ORM round-trip / CHECK constraint / celery_task_id 反查 / `_mark_job_failed` 写 error_message / 已 completed 行不被覆盖 / `_BatchPredictTask.on_failure` 调用 helper.
  - `apps/api/tests/test_ml_backend_schemas.py` 增 11 case (5 loopback host 拒绝 + 4 非 loopback 接受 + Update 拒绝 loopback + Update url=None 允许).

### Changed

- **`apps/api/app/workers/tasks.py:_publish_progress`**: 加 `job_meta` 可选参数, 仅在开始/结束/失败 3 时点同时发到 `global:prediction-jobs` channel (不发中间高频帧, 避免塞爆全局通道). 单项目 channel `project:{id}:preannotate` 不变.
- **`apps/api/app/workers/tasks.py:_run_batch`**: 加 `celery_task_id` 入参; 入口 INSERT `prediction_jobs (status='running', total_tasks, celery_task_id)` 取 `job.id`; task 主循环维护本地 `success_count` / `failed_count` 计数; 结束时 UPDATE `status='completed', completed_at, duration_ms, success_count, failed_count`; total=0 短路也写完整 row. 全局 channel meta 含 `job_id / project_name / batch_id / 计数 / duration_ms`.
- **`apps/api/app/workers/tasks.py:_BatchPredictTask.on_failure`**: 除原推 WS 错误外, 新走 `_mark_job_failed` async helper (`asyncio.run` 包裹), 通过 `celery_task_id` 反查 `prediction_jobs` row → UPDATE `status='failed', error_message[:2000], completed_at, duration_ms` (仅当行 status='running' 时, 已 completed 的不覆盖).
- **`apps/api/app/schemas/ml_backend.py`**: `MLBackendCreate.url` + `MLBackendUpdate.url` 加 `field_validator` 拒绝 loopback host. 共用 `_validate_ml_backend_url` 函数 + `_LOOPBACK_HOSTS` 常量集. Update 仅当 url 非 None 时校验.
- **`apps/api/app/api/v1/router.py`**: 注册 `admin_preannotate_jobs.router` (与 `admin_preannotate.router` 区分).
- **`apps/web/src/App.tsx`**: `/ai-pre` 路由从单页改为嵌套 layout + 子路由. 加 `AIPreAnnotateLayout` / `AIPreAnnotateJobsPage` lazy import.
- **`AIPreAnnotatePage.tsx:133-155`**: 切项目 useEffect 加 `useGlobalPreannotationJobs.byProject[oldId]` 检测; 旧项目仍跑预标时弹 warning toast (`项目「X」仍在跑预标 (i/N)`) 与原 info toast 共存.
- **`components/shell/TopBar.tsx`**: NotificationsPopover 左侧插入 `<PreannotateJobsBadge />`.

### Fixed

- **schema adapter 黄金样本不变量补全**: v0.9.7 临时塞进去的 `to_internal_shape` 在 v0.9.8 单测里固化 3 条隐性约定 (idempotent / geometry 优先于 value / 非标字段无损), 防 ML backend 输出格式漂移再次撞前端 dark drop. 同步在 dev 文档 §兼容旧 schema 的最小不变量节明示.

### Internal

- **OpenAPI snapshot 刷新** (`apps/api/openapi.snapshot.json` + `docs-site/api/openapi.json`): 新 `PredictionJobOut` / `PredictionJobsResponse` schema + `MLBackendCreate.url` validator 描述生成. `pnpm codegen` 已重跑 `src/api/generated/types.gen.ts`.

### Tests

- 后端: `pytest tests/test_prediction_jobs_worker.py tests/test_admin_preannotate_jobs.py tests/test_prediction_schema_adapter.py tests/test_ml_backend_schemas.py tests/test_preannotate_text.py tests/test_admin_preannotate.py tests/test_ml_health_worker.py` — 58 tests pass.
- 前端: `pnpm test --run src/pages/Workbench/state/transforms.test.ts src/components/shell/__tests__/PreannotateJobsBadge.test.tsx` — 18 tests pass; `pnpm typecheck` 全过.

### Migration / Rebuild 注意

- DB: `alembic upgrade head` 跑 `0052_prediction_jobs`.
- Celery worker: 改了 `app/workers/tasks.py`, **必须** `docker restart ai-annotation-platform-celery-worker-1` (CLAUDE.md §7 — celery 不会 `--reload`).
- Frontend: `pnpm install` (新 hook + 组件无新依赖, openapi-ts 已存在); `pnpm codegen` (snapshot 已刷新); `pnpm dev` HMR 即可.
- 已存在 `localhost` URL 的 ml_backends 不会被强制迁移 (validator 仅作用于新 Create/Update); 升级时建议手动检查 `SELECT id, url FROM ml_backends WHERE url ILIKE '%localhost%'`.

### Known gaps / 留 v0.9.9 + v0.10.x

- **`PredictionShape` 仍手写**: 后端 `Prediction.result` 是 JSONB, Pydantic schema 仅 `list[dict]`, codegen 拿不到内部字段. 留 v0.9.9 加 `app/schemas/prediction.py:PredictionShape` Pydantic 模型 + 前端切换 (api-schema-boundary.md §v0.9.8 codegen 迁移现状已注明).
- **`prediction_jobs.total_cost` 未聚合**: worker 暂未把 `PredictionMeta.total_cost` 累加进 job 行. 留下版接通 (字段已就位, `Numeric(10, 4) NULL` 兼容).
- **WS 跨多项目订阅**: 当前 RBAC 仅 admin 全收, 普通项目成员的「自家项目预标进度」可见性留 v0.10.x.

## [0.9.7] - 2026-05-08

> **Virtual Lynx — AIPreAnnotatePage 信息架构重构 + 视觉精修 + 交互打磨; 同步清掉 v0.9.6 4 项遗留欠账.** 主线两块：① **AI 预标注页面深度优化** — 478 行单文件拆 6 子组件 (`PreannotateStepper / ProjectBatchPicker / PromptComposer / OutputModeSelector / RunPanel / HistoryTable`) + `styles.ts` 共享样式 token + `usePreannotateDraft` localStorage 草稿持久化 hook; 顶部水平 4 步 stepper 引导 + 卡片头 borderBottom 分隔 + chip hover/active/频率角标 + 进度卡大号百分数 + WS connection 徽章; 交互打磨: `⌘/Ctrl+Enter` 提交 + 切项目草稿保留 + 空 alias 引导卡 + 历史表搜索/列排序/客户端分页 (20 行/页) / 空状态居中提示. ② **v0.9.6 遗留 4 项**: alias 频率排序 (`GET /admin/projects/:id/alias-frequency` JSONB GROUP BY 端点 + 前端按 count desc 排) + Wizard step 4 backend 复用 dropdown (`GET /admin/ml-integrations/all` 全局去重列表 + 项目创建时复制 backend row) + 用户手册 v0.9.7 段同步 + scenes.ts 加 4 个 v0.9.7 截图场景 (实跑 PNG 留 maintainer).

### Added

- **`apps/web/src/pages/AIPreAnnotate/` 子目录**：6 个组件 (`PreannotateStepper.tsx` / `ProjectBatchPicker.tsx` / `PromptComposer.tsx` / `OutputModeSelector.tsx` / `RunPanel.tsx` / `HistoryTable.tsx`) + `styles.ts` 共享 inline style + `hooks/usePreannotateDraft.ts` 草稿持久化. 旧 478 行单文件 `AIPreAnnotatePage.tsx` 重写为 ~250 行外壳 (状态编排 + stepper 状态推导).
- **`PreannotateStepper.tsx`**：4 步水平 stepper, 圆形数字徽章 + 连接线 + 状态色 (pending 灰 / active accent / complete `Icon name="check"` 紫底白). 点徽章 `scrollIntoView({ behavior: "smooth" })` 滚到对应 anchor section, scroll-margin-top 80 避免 sticky topbar 遮挡.
- **`HistoryTable.tsx`**：内置搜索框 (按 batch_name / project_name 子串过滤) + 列头点击排序 (total_tasks / prediction_count / failed_count / last_run_at) + 客户端分页 (20 行/页, 上一页/下一页) + 居中空状态 (sparkles + 文案); 时间戳用 `formatRelative` 渲染 N 秒/分/小时/天前.
- **`usePreannotateDraft.ts`**：按 projectId 分桶 (`wb:ai-pre:draft:{projectId}`) localStorage 持久化, debounce 300ms 写入; `usePreannotateDraftAutosave` hook 监听 prompt 变更; `readDraft / writeDraft / clearDraft` 函数式 API. 切项目自动 read 新 + write 旧, 跑成功后清空.
- **`Ctrl/Cmd + Enter` 提交快捷键**：`PromptComposer.tsx` 输入框 `onKeyDown`, meta/ctrl + Enter 触发 `onRun`. 卡片头小字提示 `⌘/Ctrl + Enter 跑预标`.
- **空 alias 引导卡**：项目类别已配置但全无 alias 时, PromptComposer 渲染 inline 灰色卡 + Icon info + Link 跳 `/projects/:id/settings#class-config`.
- **后端 `GET /admin/projects/:id/alias-frequency`**：`apps/api/app/api/v1/admin_alias_freq.py` 用 PG `jsonb_array_elements` 展开 `predictions.result` 数组, COALESCE `value.labels[0]` 与 `value.class` 双 fallback, GROUP BY label COUNT desc LIMIT 200; project_id FK 已索引无需 JOIN. PROJECT_ADMIN / SUPER_ADMIN gated. 7 个端到端测试 (403 / 404 / 空 / polygon labels 聚合 / rectangle class fallback / 混合类型 merge / 非数组 result 守卫).
- **后端 `GET /admin/ml-integrations/all`**：`admin_ml_integrations.py` JOIN MLBackend × Project 列所有 backend, `seen_urls` 去重保留最新 health 一份, 返回 `GlobalBackendItem` 含 `source_project_id / source_project_name`. 4 个端到端测试 (403 / dedupe / project create with source clones row / invalid source 400).
- **后端 `ProjectCreate.ml_backend_source_id`**：`schemas/project.py` 新字段; `projects.py` `create_project` 端点先校验 source 存在性 → INSERT project row + flush (满足 ml_backends FK) → `_clone_backend_to_new_project` 复制 row (保留 url/auth_method/auth_token/extra_params/is_interactive/name, 重置 state="disconnected" + 清空 health_meta + last_checked_at) → set `project.ml_backend_id` 到新 row + 同步 `ai_model = source.name`.
- **`CreateProjectWizard` Step 4 backend dropdown**：新增内嵌 `BackendSourceSelect` 组件; 启用 AI 后拉 `adminMlIntegrationsApi.listAll()` 显示 dropdown (含来源项目名 + state); FormState 加 `mlBackendSourceId` 字段, submit 时携带 `ml_backend_source_id` 到 ProjectCreatePayload. dropdown 选中后底部 hint 显示「将复制 X 到新项目, 含 auth 配置, state 重置为 disconnected」.
- **`apps/web/src/api/aliasFrequency.ts`**：新建 `aliasFrequencyApi.byProject(id)` 客户端; `AIPreAnnotatePage` useQuery 5 分钟 staleTime, 切项目自动重拉.
- **`apps/web/src/api/adminMlIntegrations.ts` 扩展**：加 `GlobalBackendItem` / `GlobalBackendListResponse` 类型 + `listAll()` 方法.
- **scenes.ts 加 4 个 v0.9.7 场景**：`ai-pre/stepper` / `ai-pre/history-search` / `ai-pre/empty-alias` / `wizard/step4-backend`. PNG 实跑留 maintainer 在完整启动栈下 `pnpm --filter web screenshots`.

### Changed

- **`AIPreAnnotatePage.tsx` 重写**：478 行 inline style 单文件 → ~250 行外壳, 子组件全部 props in / callback out 纯展示风格, 状态全部由外壳持有 (避免子组件间隐式耦合). aliases `useMemo` 改读 `freqQ.data.frequency` 计算 `count`, 排序条件 `b.count - a.count || a.alias.localeCompare(b.alias)`. 切项目 `useEffect` 加草稿读写 + toast 提示 (kind=`""` info 风格).
- **进度卡视觉重构** (`RunPanel.tsx`)：顶部行 `批次进度 + 大号 24px 百分数 (accent / danger 色) + current/total 张数`; ProgressBar 视觉保留; 状态徽章移到卡片头 (`WS · {connection} · {status}`); 完成态 ✓ + Icon check + CTA 按钮 default 尺寸. 比旧版扁平 layout 信息层级更清晰.
- **chip 视觉**: aliasChip 加 hover/active 态 (active 用 `aliasChipActiveStyle` 紫底 + inset accent 边条), 角标 `×N` (frequency > 0 时显示, 灰色 9px tabular-nums).
- **`docs-site/user-guide/projects/ai-preannotate.md`**：加 v0.9.7 段说明 stepper / 频率排序 / Ctrl+Enter / 草稿 / 历史表搜索分页 / wizard backend 复用; 标题更新为 v0.9.5 / v0.9.6 / v0.9.7. job 历史追踪推迟备注从「v0.9.7」改为「v0.10.x」.

### Tests

- 后端：`tests/test_admin_alias_freq.py` (7 case) + `tests/test_admin_ml_integrations_global.py` (4 case) — 全过. `tests/test_projects_ml_backend_binding.py` 回归无破坏 (6 case 全过).
- 前端：`pnpm tsc --noEmit` 无错; LSP 偶发显示 `Cannot find module '@/api/...'` 是缓存假警, 实跑 typecheck 全过.

### Fixed (端到端跑通暴露的隐性 bug)

> 同一会话用户首次端到端真实跑预标后暴露 3 条 v0.9.6 / v0.9.4 phase 1 引入但未暴露的隐性 bug, 一并修复纳入 v0.9.7.

- **B-1 fix · 预标 worker 异常推 WS**（已先于本版本 commit `4bf5bf6`，本版本验证生效）：`_BatchPredictTask.on_failure` dispatch 阶段或 body 内未捕获异常都推到 `project:{id}:preannotate` channel, 前端进度卡 `progress.error` 分支可见, 解决「已排队后无响应」体感 bug. CLAUDE.md 第 7 节加 Docker rebuild vs restart 判定速查 (Celery worker 不会 `--reload` 这个具体陷阱).
- **`apps/api/app/config.py` `parents[3]` 越界守卫**：v0.9.6 引入 `_REPO_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"` 假设宿主机布局, 容器内 `/app/app/config.py` 只 3 层 parents → `IndexError: 3` celery-worker rebuild 后 crash loop. 改为 `_PARENTS[3] / ".env" if len(_PARENTS) > 3 else Path("/nonexistent/.env")` —— 容器内 env vars 由 docker-compose `environment:` 直接注入, 找不到 `.env` 是正常的, pydantic-settings 接受不存在的 `env_file` 路径.
- **`apps/api/app/services/prediction.py:to_internal_shape` schema adapter（核心 bug）**：v0.9.4 phase 1 后端真正接通 SAM/DINO 后, worker 把 LabelStudio 标准 `{type:"rectanglelabels", value:{x,y,width,height,rectanglelabels:[...]}, score}` 原样存入 `predictions.result`; 但前端 `predictionsToBoxes` (`apps/web/src/pages/Workbench/state/transforms.ts:51`) 期望内部 `{type, class_name, geometry:{type:"bbox",x,y,w,h}, confidence}` —— schema gap 一直未被发现 (前端工作台未真实跑过预标 → 渲染候选). 本会话端到端跑预标后暴露：32 条 prediction 落地 DB 但工作台一无所有.
  - 新增 `to_internal_shape` adapter 在 read path: `tasks.py:get_predictions` 序列化时 + `annotation.py:accept_prediction` accept 落 annotation 前. DB 维持 LabelStudio 标准 (导出 / CVAT 兼容).
  - LabelStudio 字段名 self-referential: `value.{type}[0]` 取 label (rectanglelabels → `value.rectanglelabels[0]`); 老格式 `value.labels[0]` / `value.class` 双 fallback. score / confidence 双向兼容.
  - 10 个 adapter 单测覆盖 LabelStudio / 老 `value.labels` / 老 `value.class` / 已是内部 schema pass-through / score↔confidence fallback / 非法输入.
- **`admin_alias_freq.py` SQL 修正**：v0.9.7 主线我写的 SQL 假设 `value.labels[0]`, 但 LabelStudio 标准是 `value.{type}[0]` (self-referential field name); 改为三层 COALESCE `value -> type ->> 0` / `value.labels[0]` / `value.class`. 7 个 alias-freq 测试全过, chip 角标 `×N` 准确.

### Known gaps / 留 v0.9.8 主线

> 提前自 v0.10.x — 用户首次真实跑预标后明确需求, ROADMAP 已加 v0.9.8 切片.

- **完整 prediction job 历史**：`prediction_jobs` 表 + worker 写入 + `GET /admin/preannotate-jobs` 端点 (含已结束/重置批次的 prompt/cost/duration) + 前端 `/ai-pre/jobs` 子页面.
- **`MLBackendCreate` URL validator**：拒绝 host == `localhost`/`127.0.0.1`, 提示用 `172.17.0.1` / docker bridge IP / service DNS, 与 v0.9.6 `ML_BACKEND_DEFAULT_URL` placeholder 配套. 本会话端到端跑预标时撞到 (worker 容器内连不上宿主机 `localhost:8001`), 临时手改 DB URL 到 `172.17.0.1:8001` 通了.
- **WS 进度多项目订阅可见性**：`usePreannotationProgress(projectId)` 仅订阅当前项目, 跑完切项目就丢 progress; 候选 ① AdminDashboard / Topbar 全局 badge ② 切项目 toast 提示「项目 X 仍在跑预标 (i/N)」+ 一键回跳.
- **预标 schema 端到端类型同步**：codegen `predict.result` 类型 + 前端 transforms.ts 单测 + 用户手册说明 DB schema vs 前端 schema 边界, 防下次 ML backend 改输出格式再撞.

### Known gaps / 留 v0.10.x

- **截图 22 张实跑**：scenes.ts 18 (v0.8.7) + 4 (v0.9.7) = 22 个场景配置就位, PNG 文件需 maintainer 在完整启动栈下 `pnpm --filter web screenshots` 实跑; 部分场景 (history-search / empty-alias) 需先在 `apps/api/scripts/seed.py` prepare 钩子里造 fixture 数据.
- **mask→polygon 多连通域 / 空洞**：v0.9.4 phase 3 长尾分析项, 留 v0.10.x 与 sam3-backend 共做复用 mask_utils.

## [0.9.6] - 2026-05-08

> **Agile Kernighan — v0.9.5 Async Oasis 落地后非长尾欠账一次性收口.** 主线三块：① **工具栏 P2-b 可用性重构** — 自定义 Tooltip 组件 + hotkey 角标 + 激活态 inset 边条 + 分组分隔线 + SAM 子工具栏改右抽屉 + AI 推理 spinner overlay + 备用 `Alt+1/2/3/4` 切工具 (避免与单数字键 1-9 切类别冲突); ② **v0.9.5 落地 5 条新发现** — 类别 alias schema 自动 lower/strip/折叠规范化 (前后端 + sessionStorage 防重复 toast) + Wizard step 4 暴露 `text_output_default` (共享 `TextOutputDefaultSelect` 组件) + `BatchStatusBadge` 新建 + Kanban COLUMNS 加 `pre_annotated` 紫色列 + 工作台 Topbar `pre_annotated` 紫徽章 + AIPreAnnotatePage chips 限高滚动 + 搜索筛选; ③ **ML backend 注册体验** — 后端 `POST /admin/ml-integrations/probe` 无 DB 副作用端点 + `ML_BACKEND_DEFAULT_URL` settings + `GET /admin/ml-integrations/runtime-hints` + Modal 表单内「测试连接」按钮 + URL placeholder 默认值预填; **健康聚合** — `ml_backends.health_meta JSONB` 列 + `check_health` 缓存 gpu_info/cache/model_version + RegisteredBackendsTab 行内副信息显示; **AIPreAnnotate 闭环** — `GET /admin/preannotate-queue` 端点 + 跑完 prominent CTA「打开标注工作台 →」+ 历史表 (项目/批次/总数/已预标/失败/操作 列, 失败行跳模型市场重试).

### Added

- **`Tooltip.tsx` 组件**：`apps/web/src/components/ui/Tooltip.tsx` portal 实现, hover 200ms 延迟 + focus 立即, blur/leave/Esc 关闭; 三行内容 (name 粗 + desc 灰 + hotkey kbd 徽); ToolDock 主工具栏与 SAM 子工具栏全用上.
- **`SamSubToolbar.tsx`**：`apps/web/src/pages/Workbench/shell/SamSubToolbar.tsx` 从 ToolDock 拆出, 改 SAM 主按钮右侧 absolute 抽屉锚定 (左 100% + margin 8px), 子工具激活背景从 10% 提到 20% accent + inset 2px 左侧 accent 边条; polarity 圆形按钮也迁入抽屉.
- **`BatchStatusBadge.tsx`**：`apps/web/src/components/badges/BatchStatusBadge.tsx` 统一 batch 状态徽章; pre_annotated 紫色 + sparkles icon + "AI 预标已就绪" label.
- **`TextOutputDefaultSelect.tsx`**：`apps/web/src/components/projects/shared/TextOutputDefaultSelect.tsx` 抽出 4 项下拉为共享组件, GeneralSection + Wizard Step4 共用.
- **后端 `POST /admin/ml-integrations/probe`**：`apps/api/app/api/v1/admin_ml_integrations.py` 无 DB 副作用 health 探测; payload `{url, auth_method, auth_token}` → 返回 `{ok, latency_ms, status_code, error, gpu_info, cache, model_version}`. 5 个新单测 (ok / timeout / 403 / runtime-hints set+null) 全过.
- **后端 `GET /admin/ml-integrations/runtime-hints`**：暴露 `ml_backend_default_url` 给前端 modal 启动时一次性查 (cache forever).
- **`settings.ml_backend_default_url`**：`apps/api/app/config.py` 加 env `ML_BACKEND_DEFAULT_URL`; `.env.example` + `DEV.md` 注释更新, dev 推荐 `http://172.17.0.1:8001`.
- **`ml_backends.health_meta JSONB` 列**：迁移 `0051_ml_backends_health_meta.py`; `MLBackendService.check_health` 用新 `MLBackendClient.health_meta()` 拉 ok+meta, 把 `gpu_info / cache / model_version` 缓存到列; `MLBackendOut` schema 暴露字段.
- **后端 `GET /admin/preannotate-queue`**：`apps/api/app/api/v1/admin_preannotate.py` 列出 `pre_annotated` 状态批次 + JOIN tasks 聚合 prediction_count / failed_count (排除 dismissed) + last_run_at; PROJECT_ADMIN/SUPER_ADMIN gated. 3 个端到端测试 (空 / 403 / 仅含 pre_annotated 不含 active).
- **AIPreAnnotatePage 二阶段 UX**：跑完 prominent「打开标注工作台 →」CTA (`/projects/:id/annotate?batch=X`); 页面下方「AI 预标已就绪批次」表 (项目/批次/总数/已预标/失败/操作); 失败行加跳「模型市场失败列表」重试链接.
- **AI 推理 spinner overlay**：`tokens.css` `@keyframes spin` + `.spin` 类; Icon 加 `loader2: Loader2`; Topbar / AIInspectorPanel / SamTextPanel 一键预标按钮 running 时换 loader2 + spin (取代 wandSparkles).
- **数字键 `Alt+1/2/3/4` 副 hotkey 切工具**：`apps/web/src/pages/Workbench/state/hotkeys.ts` 加 Alt+digit 分支 (在 ctrl/meta 之后, 数字键 setClassByDigit 之前); 4 个 hotkeys.test.ts case (Alt+1-4 / Alt+5 仍切类别 / Alt+Ctrl+1 走 ctrl 分支). 解决 ROADMAP P2-b 数字键冲突.
- **`docs-site/user-guide/projects/ai-preannotate.md`**：管理员视角全流程 (前置 / batch 选 / prompt+alias chips / outputMode / WS 进度 / 跑完 CTA / 历史表 / 常见问题).

### Changed

- **`ToolDock.tsx` UX 重整**：主工具按钮加 hotkey 右下角标 (8px 字母, 不靠 hover 即可见); 激活态加 inset 2px 左侧 accent 边条; native `title` 替为 `Tooltip` 组件; `Polygon` 与 `Hand` 之间加 1px 分组分隔; SAM 主按钮激活时 SAM 子工具栏改右侧 absolute 抽屉.
- **`hotkeys.ts` HOTKEYS 数组**：4 行 Alt+digit 副 hotkey 提示并入 `?` 帮助面板; 与 v0.9.5 `S` 循环切子工具说明保持一致.
- **`ClassConfigEntry.alias` schema**：加 `field_validator(alias, mode="before")` 自动 lower/strip + 折叠多重空格/逗号 + 去首尾逗号 + 空字符串到 None; 6 个新单测 case (Person→person / RIPE APPLE→ripe apple / 空白 trim / 多重空格折叠 / 多重逗号折叠 / 首尾逗号去除 / 空字符串到 None).
- **`ClassEditor.tsx` 前端 alias 输入**：onBlur 自动规范化 (与后端等价的 `normalizeAlias` 函数); 首次规范化触发 sessionStorage 标记 `cfg:aliasNormHinted` 防重复 toast; 输入非 ASCII 时 `cfg:aliasAsciiHinted` toast 一次.
- **`CreateProjectWizard` Step 4**：启用 AI 后增加 inline `text_output_default` 4 项下拉 (复用 `TextOutputDefaultSelect`); submit payload 携带 `text_output_default`; `ProjectCreatePayload` 类型扩展 (codegen 旧版未含).
- **`BatchesKanbanView` COLUMNS**：加 `pre_annotated` 紫色列 (variant: ai); VALID_TRANSITIONS 镜像同步加 `active → pre_annotated` 与 `pre_annotated → annotating/active/archived`.
- **`WorkbenchShell`**：ownerStatuses + memberStatuses 加 `pre_annotated`; 计算 `currentBatchStatus` 传入 Topbar; `pre_annotated` 状态时 Topbar 显示紫色「AI 预标已就绪」徽章.
- **`AIPreAnnotatePage` chips 容器**：限高 96px + overflowY auto + 类别>6 时显示搜索框过滤 (substring match alias/name).
- **`RegisteredBackendsTab` 行内深度指标**：状态 badge 下方追加 `model_version` / GPU `used_mb/total_mb` / cache hit_rate% (字段缺失灰显 "—"); `MLBackendItem` 接口扩 `health_meta`.
- **`MlBackendFormModal`**：URL 输入 placeholder 走 `runtime-hints.ml_backend_default_url`; 加「测试连接」按钮 (调 `/probe`) + inline 状态显示 (✓ 已连接 / ✗ 无法连接); URL onChange 时清 probe 结果防 stale 显示.
- **`MLBackendClient.health_meta()`**：`apps/api/app/services/ml_client.py` 新方法返 `(ok, meta?)`; service 层 `check_health` 改用它一次性写入 health_meta.

### Migrations

- **`0051_ml_backends_health_meta.py`**：`ml_backends.health_meta JSONB NULL` 列, ALTER TABLE ADD COLUMN IF NOT EXISTS, downgrade DROP COLUMN IF EXISTS.

### Tests

- **后端**：新增 `test_jsonb_strong_types` 6 case (alias 规范化) + `test_admin_ml_integrations` 5 case (probe ok/timeout/403, runtime-hints set+null) + `test_admin_preannotate` 3 case (empty/403/仅 pre_annotated) — 共 +14 case 全绿.
- **前端**：新增 `hotkeys.test.ts` 4 case (Alt+1-4 切工具, Alt+5 fallback, Alt+Ctrl+1 走 ctrl) — 共 +4 case 全绿; tsc `--noEmit` 0 error.

### Known Gaps（推迟到 v0.9.7）

- **D.3 CreateProjectWizard backend 绑定 dropdown**：当前 ml_backends 表项目级, wizard 在创建项目前无法列「全局可选 backend」; 需新建全局聚合端点或重构表结构. 与 v0.8.6 F3 「项目创建后到设置页绑定」既定流程一致, 不阻塞使用.
- **F.3 截图自动化 18 张实跑回填**：scenes.ts 4 个新场景 (`/ai-pre`, cost-display, alias-chips, preannotate-queue) 与 seed.py 6 个 prepare 钩子需 maintainer 在完整启动栈下 `pnpm --filter web screenshots` 实跑出图; 框架就绪.
- **完整预标 job 历史追踪**：当前 `/admin/preannotate-queue` 仅返 `pre_annotated` 状态批次 + counts; 跑完后被 owner reset 回 active 的批次不在列表; 完整 job 历史需新建 `prediction_jobs` 表 + worker 写入.
- **AIPreAnnotatePage 类别 alias chips 频率排序**：需后端 GROUP BY predictions 聚合, 推迟到 v0.9.7 chip.

详细计划：[`docs/plans/2026-05-08-v0.9.6-agile-kernighan.md`](docs/plans/2026-05-08-v0.9.6-agile-kernighan.md)。

---

## [0.9.5] - 2026-05-08

> **Async Oasis — `/ai-pre` 文本批量 UI + 类别英文 alias + Batch pre_annotated + chip 包.** v0.9.x 系列收尾绿洲，把 SAM 接通后暴露的零散问题一次性收齐，进入 v0.10.x SAM 3 之前不留尾巴。三块主轴：① `/ai-pre` 完整页面替 PlaceholderPage，文本批量预标 → batch 自动转 `pre_annotated` → AdminDashboard / Sidebar 接真数据；② 类别英文 alias 字段（不引入运行时 LLM 翻译，alias chips 直填 SAM prompt）；③ chip 包（cost 单条透传 / text_output_default 持久化 / GeneralSection 绑定 UX 解耦 / 9 处 sparkles 重整）+ M5 收口（backend `/health` 显存 + ADR-0012/0013 + deploy.md GPU 章节）。

### Added

- **`AIPreAnnotatePage` 文本批量预标完整页**：`apps/web/src/pages/AIPreAnnotate/AIPreAnnotatePage.tsx` 替 PlaceholderPage，项目下拉 → active batch → Prompt 输入（含 alias chips）→ outputMode segmented → WS 实时进度。
- **Batch 状态机加 `pre_annotated`**：`BatchStatus.PRE_ANNOTATED` + `VALID_TRANSITIONS` `ACTIVE → PRE_ANNOTATED`（auto-driven）+ `PRE_ANNOTATED → ANNOTATING/ACTIVE/ARCHIVED`；`PRE_ANNOTATED → ACTIVE` 入 `REVERSE_TRANSITIONS`；`check_auto_transitions` 把 `PRE_ANNOTATED` 也推进到 ANNOTATING。零迁移（`status` 是 `String(30)` 非 enum）。`AdminDashboardStats.pre_annotated_batches` 字段 + Sidebar `ai-pre` ai 徽章 + AdminDashboard 「N 批待接管」点击卡。
- **类别英文 alias**：`ClassConfigEntry.alias` 字段（ASCII-only `^[a-zA-Z0-9 ,_\-]+$` max=50，零 DB 迁移）；ClassEditor 表格 + CreateProjectWizard 第 2 步 + SamTextPanel + AIPreAnnotatePage 上方 alias chips（点击直填 prompt）。把双语映射推到数据层而非运行时 LLM 翻译。
- **`/projects/{id}/preannotate` 端点扩参**：加 `prompt` / `output_mode` / `batch_id`；指定 batch 时校验归属 + `active` 状态，返回 `total_tasks` + `channel`。`batch_predict` Celery task 同步扩参，prompt 非空时透传 context；末尾自动 `active → pre_annotated`。
- **AI 助手「本题花费」单条透传**：`PredictionOut.inference_time_ms` / `total_cost`；`/tasks/{id}/predictions` outerjoin `PredictionMeta` 一次性聚合；`WorkbenchShell` 算 `taskAiMeta` 传给 `AIInspectorPanel`，「本次效率」段下方加「本题：¥0.xxxx · XXXms (N 次)」一行。
- **`text_output_default` 项目级字段**：`projects.text_output_default VARCHAR(10) NULL` + 迁移 `0050` + CHECK；`GeneralSection` 加下拉「自动按类型 / 框 / 掩膜 / 全部」；`samTextOutput.resolveInitialOutputMode` 优先级改为「项目级 → sessionStorage → type_key」，把 v0.9.4 phase 2 的 sessionStorage 兜底转持久化。
- **GeneralSection AI 绑定 UX 解耦**：`MlBackendsSection` 列表行加「绑定到本项目」按钮 + 已绑定标记，免回基本信息 tab 手选。
- **backend `/health` 加显存 + cache**：`apps/grounded-sam2-backend/main.py:73` 返回 `gpu_info: {device_name, memory_used_mb, memory_total_mb, memory_free_mb}` + `cache: {size, max_size, hits, misses}`，旧字段 backward-compat。
- **ADR-0012 / ADR-0013**：`0012-sam-backend-as-independent-gpu-service.md`（独立 GPU 服务决策）+ `0013-mask-to-polygon-server-side.md`（mask→polygon 后端化）。
- **`docs-site/dev/deploy.md` §8.5 GPU 节点部署**：`profiles: ["gpu"]` + `ML_BACKEND_STORAGE_HOST` + `/health` 字段示例 + ADR 链接。
- **`docs-site/dev/icon-conventions.md`**：图标语义规范，钉死 9 类 AI 图标的语义（wandSparkles 操作 / bot 身份 / messageSquareText 文本输入 / sparkle 装饰 / circleDot 状态）。
- **Icon 组件扩 6 个新 name**：`brain` / `circleDot` / `messageSquareText` / `sparkle` / `type` / `wandSparkles`。

### Changed

- **9 处 sparkles 按 icon-conventions 重整**：Topbar 智能切题 / Topbar 一键预标 / AIInspectorPanel 一键预标 / AIPreAnnotatePage 跑预标 / AdminDashboard 队列卡 → `wandSparkles`；AIInspectorPanel 标题 → `bot`；ToolDock SAM 文本子工具 / SamTextPanel 标题 → `messageSquareText`；BoxListItem / BoxRenderer AI 框装饰角标 → `sparkle`；StatusBar AI 待审 → `circleDot`。Sidebar 导航徽标保留 `sparkles`（装饰性 vs 操作性区分）。
- **`MLBackendClient.predict()` 扩 context 参数**：`apps/api/app/services/ml_client.py:44` 批量端点支持可选 context dict 透传，与 backend `BatchPredictRequest.context` 对齐。
- **`PredictionOut` schema 加字段**：`inference_time_ms` / `total_cost`，前端 generated types 同步刷新。
- **`AdminDashboardStats` schema 加字段**：`pre_annotated_batches`，Sidebar / AdminDashboard 共用。

### Migrations

- **`0050_project_text_output_default.py`**：`projects.text_output_default VARCHAR(10) NULL` + CHECK in box/mask/both/NULL。

### Tests

- **后端 303/303 全绿**：新增 `test_jsonb_strong_types` 4 case（alias None/ASCII/中文拒绝/超长拒绝）+ `test_batch_pre_annotated` 8 case（状态机迁移合法性）+ `test_preannotate_text` 5 case（端点参数校验四主路径 + 422 拒绝）+ OpenAPI snapshot 重新生成。
- **前端 vitest 347/347 + tsc 0 error**。

### Known Gaps（留 v0.9.6）

- 工具栏 Tooltip 组件 + hotkey 角标 + 激活态强化 + 分组分隔（独立 epic）
- 数字键 1/2/3/4 直跳工具（与 `setClassByDigit` 1-9 切类别冲突，需 `target.tagName` 区分调研）
- SAM 子工具栏改右展开抽屉
- 截图自动化 14 张实跑回填（依赖 docker + uvicorn + seed 完整启动栈）

详细计划：[`docs/plans/2026-05-08-v0.9.5-async-oasis.md`](docs/plans/2026-05-08-v0.9.5-async-oasis.md)。

---

## [0.9.4 phase 3] - 2026-05-08

> **Polished Contour — mask→polygon 共享化 + simplify tolerance 注入 + SAM E2E.** v0.9.x SAM 一期最后一刀 — 不引入用户可见新功能, 但是 v0.10.x sam3-backend 落地的硬前置 (共享 mask_utils 包) + 后续 SAM 体验调优的基础设施 (tolerance 可调 + E2E 守卫). 三件事: ① `apps/grounded-sam2-backend/predictor.py` 内嵌 `_mask_to_polygon` 删除, 改 import `apps/_shared/mask_utils` 共享包; docker-compose context 升到 `apps/`, Dockerfile 加 `COPY _shared/mask_utils + pip install -e`. ② `Context.simplify_tolerance` 字段 + `DEFAULT_SIMPLIFY_TOLERANCE = 1.0` 常量 + 顶点 > 200 `logger.warning`. ③ `_test_seed/reset` 加 ml_backend 工厂 (`E2E SAM Mock`) + annotation.spec.ts 新增 SAM 工具子工具栏 + `page.route` 拦截 `/interactive-annotating` 用例.

### Added

- **`apps/_shared/mask_utils/` 接入 grounded-sam2-backend**：删 `predictor.py:352-385` 内嵌 `_mask_to_polygon` 静态方法，所有调用点（`_masks_to_results` for point/bbox + `predict_text` mask/both 分支）改 `from mask_utils import mask_to_polygon` + `mask_to_polygon(mask, tolerance=eff_tol, normalize_to=(w, h))`。共享包 `polygon.py` 补 try/except 拓扑兜底（self-intersecting contour 时降级到原始 contour 而非返回空，与旧 inline 实现鲁棒性对齐）；`normalize.py` `normalize_coords` 输出 `round(x/w, 6)` 6 位精度（与平台 BboxAnnotation / PolygonAnnotation value 字段对齐，预防迁移后协议字段分辨率漂移）。新增 2 个 mask_utils 单测 case：`test_normalized_coords_rounded_to_6_decimals`、`test_self_intersecting_contour_falls_back_to_raw_coords`（共 9 case 全绿）。
- **`Context.simplify_tolerance: float | None` + `DEFAULT_SIMPLIFY_TOLERANCE = 1.0`**：`schemas.py` Context 加字段（与 `output` / `box_threshold` 同位）；`predictor.py` 顶层定义 `DEFAULT_SIMPLIFY_TOLERANCE = 1.0` + `VERTEX_COUNT_WARN_THRESHOLD = 200` 常量；`predict_point` / `predict_bbox` / `predict_text` / `_masks_to_results` 全部加 `simplify_tolerance: float | None = None` 参数转发。`main.py` `_run_prompt` 读 `ctx.simplify_tolerance` 校验 float + ≥0 后透传；非法值返回 422。
- **顶点 > 200 `logger.warning` 运维信号**：`_masks_to_results` 与 `predict_text` mask 分支拿到 polygon 后若 `len(poly) > 200` 记 `logger.warning("polygon vertex count %d > %d (tolerance=%.2f, mask area=%d, prompt=...)")`。非阻塞，仅运维信号 — 大物体 + 极低 tolerance 触发，提示调高 tolerance 或样本异常。
- **`scripts/eval_simplify.py`**：mask png 目录 × 5 档 tolerance 跑 IoU + 顶点数表 → markdown 报告。argparse CLI（`--masks-dir / --tolerances / --out`），用 `mask_utils.mask_to_polygon` 把 mask 转 polygon，再 `cv2.fillPoly` 反栅格化算 IoU。报告含数据来源说明（合成占位 vs 真实 SAM mask）+ 汇总表（mean/median/p95 IoU + 顶点数 + IoU≥0.95%）+ 逐样本明细 + 复现命令。`apps/_shared/mask_utils/tests/fixtures/real_sam_masks/`（6 张合成占位 mask: 圆 / 椭圆 / 半月 / 三角 / organic blob，覆盖凸 / 凹 / 复杂边界）+ README 注释采集流程。
- **`docs/research/13-simplify-tolerance-eval.md`**：评测报告（84 张真实 SAM mask + 6 张合成占位 = 90 张 × 5 档 tolerance）。**评测结论**：tolerance=1.0 在真实 SAM mask 上 **IoU mean 0.98、IoU≥0.95 占比 92.2%、顶点数中位 102** — 接近 95% 验收线但未达，但 IoU mean 已 ≥ 0.95，**默认值合理**。跨 tolerance 趋势健康（顶点数 273→27 大降，IoU mean 仅微降 0.032）。`scripts/eval_simplify.py` 渲染加"数据驱动结论"三档判定：① ≥95% 完全达标推荐档；② 85%~95% 且 IoU mean ≥ 0.95 → 近达标 + 长尾分析（保持默认 + follow-up 长尾结构性问题）；③ < 85% + IoU spread < 0.05 → 结构性根因不调 tolerance；④ 其它 → 推荐最优档。84 张真实 mask 通过 host MinIO `local/datasets/cpc0-R_000_root-02/` → docker SAM 容器 **DINO+SAM text 模式（"car" / "person" / "building" 三 prompts × 30 帧）**采集，每张图 1-3 个 mask（DINO 找不到时 skip），SAM scores 0.85-0.97。commit 进 `apps/_shared/mask_utils/tests/fixtures/real_sam_masks/`（516KB）。`docs/research/README.md` 索引加 12 / 13 两行。
- **mask→polygon 多连通域 / 空洞支持 follow-up**（ROADMAP §A AI/模型 + 优先级表 P2，新建）：基于 13 评测的长尾分析（< 15% 样本 IoU 落 [0.5, 0.95) 区间），`apps/_shared/mask_utils.mask_to_polygon` 取最大连通域 + `RETR_EXTERNAL` 的两个隐藏假设需 follow-up（multi_polygon 输出 + `RETR_CCOMP` 内外环编码 + morphological closing）。**不阻塞 phase 3 收口**（大头 IoU≥0.95 + IoU mean 0.98 已可用），作为 v0.9.5 候选或 v0.10.x 与 sam3-backend 一并做。
- **`apps/grounded-sam2-backend/tests/test_simplify_tolerance_injection.py`**：4 case mock 出 `_masks_to_results` 注入路径 + WARN 触发：① tolerance 高低顶点数差异（圆 mask 0.5 vs 2.0）；② 默认 tolerance（None → DEFAULT）不抛错；③ 圆 mask + tolerance=0.0 → ~564 顶点 → WARN；④ 同 mask + tolerance=2.0 → ~32 顶点 → 无 WARN。共 23 backend test 全绿。
- **`_test_seed.seed_reset` 加 ml_backend 工厂**：fixture 项目创建后顺手造 `MLBackend(name="E2E SAM Mock", url="http://mock-sam.e2e:9999", state="connected", is_interactive=True, extra_params={"e2e_mock": True})` 绑到项目；同时把 `project.ai_enabled=True` + `project.ml_backend_id=mock_backend.id`。`SeedReset` 响应 + 前端 `SeedData` 类型加 `ml_backend_id: str` 字段。url 不会被真请求（page.route 拦截）。
- **`annotation.spec.ts` SAM 工具用例**：`page.route(/\/interactive-annotating/)` 拦截返回固定单 polygon 候选（中心 0.4×0.4 → 0.6×0.6 矩形 polygon, score 0.95）。验证：① `tool-btn-sam` 可激活 + `sam-subtoolbar` 可见；② `sam-sub-point/bbox/text` 三按钮可见；③ 子工具切换 aria-pressed 互斥（point ↔ bbox）；④ point 模式点击 stage → useInteractiveAI 80ms 防抖后 dispatch → page.route 至少命中 1 次（验证整链路：前端 → 平台 API → mock backend → resp 解析）。E2E 不验证 polygon 在 Konva canvas 上的实际渲染（canvas 内部, DOM 不可断言），由 vitest + backend pytest 协同保证。

### Changed

- **`docker-compose.yml` grounded-sam2-backend build context 升级到 apps/**：原 `context: ./apps/grounded-sam2-backend` → `context: ./apps + dockerfile: grounded-sam2-backend/Dockerfile`，让 Dockerfile 能 COPY 兄弟目录 `_shared/mask_utils`。Dockerfile 内所有 COPY 路径加 `grounded-sam2-backend/` 前缀。**注意：历史 `docker build apps/grounded-sam2-backend/` 命令不再可用**，必须走 `docker compose --profile gpu build grounded-sam2-backend` 或 `docker build -f apps/grounded-sam2-backend/Dockerfile apps/`。
- **`apps/grounded-sam2-backend/Dockerfile`**：COPY 列表加 `_shared/mask_utils/ /app/mask_utils/` + `RUN pip install --no-build-isolation -e /app/mask_utils`，让容器内 `mask_utils` 模块从共享包加载（与 v0.10.x sam3-backend 单一来源共用）。
- **`apps/grounded-sam2-backend/pyproject.toml` `[tool.pytest.ini_options].pythonpath`**：`["."]` → `[".", "../_shared/mask_utils/src"]`。本地 `uv run --extra dev pytest` 通过 pythonpath 直接定位共享包 src/，避免开发时强制 pip install -e。
- **`docs-site/dev/ml-backend-protocol.md` §2 Context schema**：加 `simplify_tolerance: number` 字段说明（仅 mask/both 路径生效；大物体调高 2-3 减顶点、精细物体调低 0.3-0.5 保细节；项目级常量化未实现，触发条件：客户提需求；后端顶点 > 200 时 logger.warning）。

### Removed

- **`apps/grounded-sam2-backend/predictor.py:352-385` `_mask_to_polygon` 静态方法**：内嵌的 cv2.findContours + shapely.simplify 实现迁到 `apps/_shared/mask_utils/src/mask_utils/polygon.py:mask_to_polygon`，行为差异：CHAIN_APPROX_NONE 替换 CHAIN_APPROX_SIMPLE（顶点更多但 simplify 后形状更精确）；`buffer(0)` 拓扑修复路径与 try/except 兜底保留。

### Notes

- **API 单测 16/16 通过**（test_seed_router + test_ml_backend_schemas + test_projects_ml_backend_binding）；mask_utils 9/9；grounded-sam2-backend 23/23（含 4 新 simplify_tolerance case）。
- **不在范围内（明确推迟）**：① 前端 ProjectSettings 暴露 `simplify_tolerance` UI（YAGNI，运维 / dev 通过 ctx 注入足够）；② query string `?simplify_tolerance=` 兼容（schema body 字段已能表达）；③ sidecar fastapi mock backend（page.route 已覆盖 phase 3 验证目标）；④ 自动化 fixture 采集脚本（maintainer 一次性手工）。
- **真实 SAM mask 采集已完成**：84 张真实 SAM mask（30 张 cpc0-R 1920×1080 沙盘视频帧 × 3 文本 prompts "car"/"person"/"building"）via MinIO `local/datasets/` → docker SAM 容器 **DINO+SAM text 模式**采集，DINO scores 0.85-0.97 高质量。fixture 516KB commit 进库（与早期 6 张合成占位共存到 90 张样本集）。**评测结论**：默认 tolerance=1.0 IoU mean **0.98**、IoU≥0.95 92.2%、顶点中位 102 — 接近 95% 验收线但未达，但 IoU mean ≥ 0.95，**默认值合理保持不动**。长尾 < 15% 样本 IoU 落 [0.5, 0.95) 区间，根因 multi-polygon / 空洞结构问题，已建 P2 follow-up（ROADMAP §A AI/模型）。
- **采集策略复盘**：首次采用 "中心 60% bbox prompt" 是错的 — 1920×1080 中心 60% 覆盖了车 + 地面 + 建筑物混合，SAM 拿到杂乱混合物（IoU mean 仅 0.54、IoU≥0.95 16.7%、顶点中位 326）。换成 **DINO+SAM text 模式**（DINO 先找紧框 → SAM 段）后数据完全正常，与工作台 `S` 工具 text 模式真实使用对齐。未来 follow-up：本机 fixture 采集脚本（`scripts/dump_sam_masks.py`，承袭 `dump_text.py` + 加 CLI）以便 maintainer 一键回放。
- **下一步**：v0.9.x SAM 一期收口完成，进入 v0.9.5（M4 + M5 合并）`/ai-pre` 文本批量预标 UI + 运维收口（ADR-0012/0013 + 部署文档 + backend 显存监控）。

详细计划：[`docs/plans/2026-05-08-v0.9.4-phase3-polished-contour.md`](./docs/plans/2026-05-08-v0.9.4-phase3-polished-contour.md)。

---

## [0.9.4 phase 2] - 2026-05-08

> **Crystal Compass — SAM UX 完善 + text 模式 box/mask/both 输出选择。** v0.9.4 phase 1 真接通 SAM 后第一次实跑暴露两个紧密耦合的 UX 痛点：① `S` 工具点击 / 拖动隐式分流 prompt 类型（单击=点 / Alt+点击=negative / 拖框=bbox），新人不可见；文本走 AI 助手面板完全脱节。② text 模式永远输出 polygon —— 对 image-det 项目（标注员要 bbox）反而是负担,SAM mask 步骤 GPU 时间贵。本 phase 同时落 SAM 子工具栏拆分 + text 输出三选一,**共用 T 文本子工具的 UI 改动**(同窗口落代价最优).

### Added

- **SAM 子工具栏（`<ToolDock>` 嵌入 + 数据模型扩 `samSubTool`）**：S 工具激活后 ToolDock 内嵌出 `[· 点 (1)] [□ 框 (2)] [T 文本 (3)]` 三个子按钮 + 仅 sam-point 子工具下额外露 `[+/−]` polarity 切换；`samSubTool: "point" | "bbox" | "text"` 与 `samPolarity: "positive" | "negative"` 加进 `useWorkbenchState`，`samTextFocusKey` 计数器让切到 text 子工具时 SamTextPanel 自动 `focus()`。
- **`SamTool.ts` 拆三模式分发**：`onPointerDown` 按 `ctx.samSubTool` 决定行为 —— point 子工具单击产生 positive point（Alt 或 polarity=negative 转 negative）；bbox 单击不响应、拖框产生 bbox prompt；text 子工具不响应画布事件。`DragInit.samProbe` 加 `mode: "point" | "bbox"` 字段，`ImageStage:546-558` 删除"按拖动距离 < 0.5% 隐式分流"逻辑，改为按 `d.mode` 直接 dispatch。
- **`S` 键循环切子工具**：`useWorkbenchHotkeys` 拦 `setTool tool="sam"` —— 当前不在 sam → 进入 sam（保留上次 samSubTool）；当前 sam·point → 切 bbox；sam·bbox → 切 text（同时 `bumpSamTextFocus()`）；sam·text → 退出 SAM 回 box。`hotkeys.ts` 新增 `samPolarity` action（`=` / `+` 切 positive、`-` 切 negative，仅在 sam-point 下被消费端 gate）。
- **`SamTextPanel` segmented control（`<TabRow>` 复用）**：文本输入框上方新增 `[□ 框] [○ 掩膜] [⊕ 全部]` 三选一切换。`outputMode` state 智能默认按项目 `type_key`（image-det → `box`，其它 → `mask`）；用户切换写 sessionStorage `wb:sam:textOutput:{projectId}`（跨切题保留、跨 project 不串扰，TTL 同 session 生命周期）。新增 helper `apps/web/src/pages/Workbench/state/samTextOutput.ts`（`defaultOutputMode` / `resolveInitialOutputMode` / `readStoredOutputMode` / `writeStoredOutputMode` 四个纯函数 + `SAM_OUTPUT_STORAGE_PREFIX` 常量）。
- **`PendingCandidate` 加 type discriminator**：原本只支持 `polygonlabels` polygon；现加 `type: "polygonlabels" | "rectanglelabels"` + `bbox?: { x, y, width, height }` 字段。`useInteractiveAI.normalizeResult` 按 backend 返回 `result[i].type` 分别填充对应几何字段。`<ImageStage>` 候选叠加层按 type 分发渲染：rectanglelabels → 紫虚线矩形（`<Rect>`）；polygonlabels → 紫虚线多边形（`<Line>`）。`<WorkbenchShell>` `handleSamCommitClass` Enter 接受时按 type dispatch：rectanglelabels → 调 `s.setPendingDrawing()` + `handlePickPendingClass(cls)` 走 BboxAnnotation 创建路径（与用户手画框 + 选类等价）；polygonlabels → 走原 `submitPolygon()`。
- **后端 `Context.output` 字段 + `predict_text` 三分支**（`apps/grounded-sam2-backend/`）：`schemas.py` `Context` 加 `output: Literal["box","mask","both"] = "mask"`（默认 mask 老前端兼容）+ `box_threshold` / `text_threshold` 字段（v0.9.2 已透传，schema 显式化）。`predictor.py` `predict_text` 重写：`box` 完全跳过 `_sam_predictor.set_image / predict / cache.put + _mask_to_polygon`（仅 DINO 出 boxes 直接归一化为 rectanglelabels，**cache 不读不写**，恒返回 `cache_hit=False`）；`mask` 当前行为；`both` 同 instance 配对返回 `[rectanglelabels, polygonlabels, ...]` 严格交错。新增 helper `_box_to_rect_label` / `_poly_to_polygon_label`。`main.py` `_run_prompt` text 分支读 `ctx.output` 透传给 `predict_text`，缺省 `"mask"` 兼容老前端；非法值返回 422。
- **`/setup` 自描述协议**：返回 dict 加 `supported_prompts: ["point","bbox","text"]` + `supported_text_outputs: ["box","mask","both"]`。前端可据此动态渲染子工具栏 + segmented control（老 backend 缺字段时前端走兜底列表，本版未消费但协议留好钩子）。
- **`apps/grounded-sam2-backend/tests/test_predict_text_output_modes.py`**：4 个 case mock dino + sam 验证 box/mask/both 三分支 + 默认 mask 兼容性。`test_box_mode_skips_sam_calls_and_cache_writes` 严格断言 `_sam_predictor.set_image / predict` 与 `embedding_cache.put` 全未被调用（box 模式核心动机）。
- **`docs-site/dev/ml-backend-protocol.md`**：§2.2 Context schema 加 `output` enum 字段 + 三模式性能对比 + 老 backend / 老前端兼容性说明；§4 `/setup` 加 `supported_prompts` + `supported_text_outputs` 字段说明。
- **截图自动化新增 2 个 scene**：`sam/subtoolbar`（按 S 进 SAM 模式截 ToolDock 子工具栏特写）+ `sam/text-three-modes`（连按 S 三次到 text 子工具截 SamTextPanel TabRow + 输入框）；PNG 实跑由 maintainer 在 `pnpm --filter web screenshots` 时回填（与 v0.8.7 已建立的截图流程一致）。
- **`apps/grounded-sam2-backend/Dockerfile`** COPY 列表补 `embedding_cache.py observability.py` + `tests/`（之前漏 COPY 测试目录导致容器内 pytest 收集不到 test，本版顺手收口）。

### Changed

- **`SamTextPanel.onRun` 签名**：`(text: string) => void` → `(text: string, outputMode: TextOutputMode) => void`，每次发起请求带当前 segmented control 选择的 mode。
- **`useInteractiveAI.runText` 签名**：加可选 `outputMode: TextOutputMode = "mask"` 参数；payload `context` 加 `output` 字段透传。
- **`ImageStage.samCandidates` props 类型**：`{ id, points }[]` → 加 `type` discriminator 与 `bbox` 字段。

### Notes

- **协议向后兼容**：① 老前端不传 `Context.output` 时 backend 走 `"mask"` 默认；② 老 backend 不识别 `output` 字段时 pydantic 因为 `extra = "ignore"` 默认（实际 v0.9.4 phase 2 之前 backend 用 `pydantic.BaseModel` 默认 `extra = "ignore"`）忽略未知字段照旧走 mask；③ 老前端不识别 `rectanglelabels` 候选 → ImageStage 旧版本因为 `c.points` 为 undefined 在 `for ([x,y] of c.points)` 处会抛错，新版按 type 分发先行 type 检查再读字段，**前端必须升到 v0.9.4 phase 2** 才能吃 backend 返回的 rectanglelabels。
- **box 模式 cache 行为**：box 路径**完全不读不写** SAM image embedding cache（`predictor.py:if output == "box": return [...], False`），避免污染 cache（image-det 项目大批量跑 box 预标时同张图未来可能切 mask 再跑，不希望 box 模式抢占 cache 槽位）。mask / both 模式 cache 行为不变（共享同一路径）。
- **+/= 与 -**：与「切换类别」`1-9` 数字键完全独立，仅在 `tool === "sam" && samSubTool === "point"` 下被 `useWorkbenchHotkeys.samPolarity` 消费；其它情境作普通字符忽略。
- **测试**：`pnpm --filter web typecheck` 0 errors；前端单测无回归（候选渲染按 type 分发的 vitest case 留作 phase 3 与 SAM E2E 一并补，本 phase 仅落代码 + 后端 4 个新 pytest case）。
- **下一步**：v0.9.4 phase 3 抽 `mask_to_polygon` 到 `apps/_shared/mask_utils/` + IoU 评估调 tolerance + SAM E2E 完整路径。

详细计划：[`docs/plans/2026-05-08-v0.9.4-phase2-sam-subtools-and-text-output.md`](./docs/plans/2026-05-08-v0.9.4-phase2-sam-subtools-and-text-output.md)。

---

## [0.9.4 phase 1] - 2026-05-08

> **Bridged Pasture — 后端真正接通 SAM。** v0.9.3 phase 3 让 PROJECT_ADMIN 能注册 backend 后，第一次实跑 `S` 工具单击立刻 500：根因是 `ml_backends.py` 把 `task.file_path`（MinIO 对象 key，如 `cpc0-R_.../xxx.jpg`）**直接透传**给 SAM backend，而 SAM 协议要求 `file_path` 是 `http(s)://` URL；同时 SAM 容器在 docker compose 网内**访问不到** host 进程的 `localhost:9000`。本 phase 把对象 key → presigned URL → host 重写一条龙做完，让 `S` 工具单击 / 拖框 / 文本三种 prompt 都能走通。

### Added

- **`apps/api/app/api/v1/ml_backends.py` `_resolve_task_url(task)` helper**：调用 `StorageService.generate_download_url()` 拿 presigned URL（按 `task.dataset_item_id` 自动选 `datasets` / `annotations` bucket）→ 若 `settings.ml_backend_storage_host` 非空，把 URL host 替换为 docker bridge gateway 地址。`predict-test` + `interactive-annotating` 两处 `file_path: task.file_path` 同步改为 `_resolve_task_url(task)`。
- **`Settings.ml_backend_storage_host: str = ""`**（`apps/api/app/config.py`）：新增配置项，dev 默认 `172.17.0.1:9000`（Linux docker-bridge gateway）；macOS / Windows Docker Desktop 用 `host.docker.internal:9000`；生产（API / SAM / MinIO 同 K8s 网）留空透传。

### Changed

- **`Settings.Config.env_file` 改为 repo root .env 绝对路径**（`apps/api/app/config.py`）：原本 `env_file = ".env"` 是相对 cwd —— 当 uvicorn 从 `apps/api/` 起时，pydantic-settings 找不到 repo root `.env`，新增字段必须靠 shell env 注入才生效（极易踩坑）。改为 `Path(__file__).resolve().parents[3] / ".env"` 后，从任何 cwd 起 uvicorn 都能正确加载。
- **`.env.example` 加 `ML_BACKEND_STORAGE_HOST=172.17.0.1:9000`** + 三平台注释说明（Linux / macOS / 生产）。
- **`.env` 同步加上**（dev 默认值）。

### Notes

- **改动范围严格限定在 ML backend 调用路径**：浏览器加载图片仍走 `_public_url()`（受 `MINIO_PUBLIC_URL` 控制），与本 phase 互不干扰。
- **生产侧**：当 API / SAM / MinIO 共网（同 docker-compose 或同 K8s namespace）时 `ML_BACKEND_STORAGE_HOST` 留空即可，`generate_download_url` 直接生成 internal endpoint URL，SAM 用 internal DNS 访问。
- **协议契约不变**：SAM backend 端 `_fetch_image()` 始终接受 `http(s)://` URL（`apps/grounded-sam2-backend/main.py:114-122`）；本 phase 是**调用方**修复，不动协议。
- **测试**：本 phase 是 dev 环境基础设施修复，本地端到端实跑通过（SAM 200 OK + 工作台紫虚线候选 polygon）；后端单测无对应 case 覆盖（`_resolve_task_url` 仅做路径拼接 + URL host 替换，单元价值低；E2E 留作后续 v0.9.5 SAM 测试 fixture 收口）。

---

## [0.9.3 phase 3] - 2026-05-07

> **Happy Meadow — 前端接通 ML Backend 注册能力。** 后端 `POST /projects/{pid}/ml-backends` CRUD 五件套自 v0.8.6 起就位（权限 `SUPER_ADMIN | PROJECT_ADMIN`），但前端**没有任何创建 / 编辑 / 删除 UI**：`ProjectSettingsPage` 只有「选择已有 backend」下拉，`/model-market` 的 `RegisteredBackendsTab` 是只读总览。`GeneralSection.tsx:301` + `CreateProjectWizard.tsx:586` 的「先在『ML 模型』选项卡添加」提示文案指向**不存在**的选项卡（commit `e81eb3e` ROADMAP 标记的 bug）。本版同时在两个入口接通注册能力，让 PROJECT_ADMIN 自服务接入 ML、让 SUPER_ADMIN 跨项目运维直接编辑。

### Added

- **`apps/web/src/pages/Projects/sections/MlBackendsSection.tsx`**（新文件）：项目设置新增「ML 模型」选项卡（icon `bot`，位于「批次管理」之后、「负责人」之前）。承载本项目作用域 backend 的 list / create / edit / delete / health-check；空态卡片 + CTA；写操作按 `usePermissions().role` 门控（`viewer / annotator / reviewer` 进来后所有写按钮 disabled + tooltip 提示需 PROJECT_ADMIN）。
- **`apps/web/src/components/projects/MlBackendFormModal.tsx`**（新文件）：注册 / 编辑共用 Modal。字段：`name` / `url`（http(s):// 前缀校验）/ `is_interactive` / `auth_method`（none / token）/ `auth_token`（仅 token 时可见，编辑模式留空表示保留原值，避免覆盖为空）/ `extra_params`（高级折叠区，JSON 解析错误阻断提交）。提交错误从 `error.response.data.detail` 取并 inline alert。
- **`useUpdateMLBackend(projectId)` / `useDeleteMLBackend(projectId)` hooks**：补齐 `useMLBackends.ts` 缺的两个 mutation；`create / update / delete / health` 四个 mutation 的 `onSuccess` 统一走 `invalidateBackendQueries(qc, projectId)` 同时刷新 `["ml-backends", projectId]` + `["admin", "ml-integrations", "overview"]`，让两个入口写后视图同步。
- **`MLBackendUpdatePayload` 类型**（`apps/web/src/api/ml-backends.ts`）：`Partial<MLBackendCreatePayload>`，替代原 `update()` 签名里的内联 `Partial<...>`。

### Changed

- **`/model-market` RegisteredBackendsTab 由只读 → 可写**：每个 ProjectGroup header 加「+ 注册」按钮（打开 `MlBackendFormModal`，projectId 取自 `group.project_id`）；每行追加「操作」列含「健康检查 / 编辑 / 删除」三个按钮，复用同一 Modal + 同一 hooks。「打开项目设置 →」链接现在带 `?section=ml-backends` 直达对应 tab。
- **`ProjectSettingsPage`**：`SectionKey` 联合扩 `"ml-backends"`、`SECTIONS` 数组同插一项（icon literal type 同步加 `"bot"`）、`VALID_SECTIONS` 同步、条件渲染分支同插。
- **`GeneralSection.tsx:301` + `CreateProjectWizard.tsx:586` 文案保留**：tab 落地后两处「先在『ML 模型』选项卡添加」/「项目设置 → ML 模型」提示从指向不存在的目标变为有效引导，无需改动。

### Notes

- **范围限定**：本版仅做项目作用域 CRUD。后端表 `ml_backends.project_id` 为 NOT NULL FK，**不存在全局 backend 概念**；SUPER_ADMIN 的「跨项目编辑」是通过在每个项目的 backend 上点编辑按钮实现，而非引入全局 scope。
- **删除二次确认**：用浏览器原生 `window.confirm()`，与 `MembersSection` 移除成员一致；轻量。
- **测试**：`pnpm --filter web typecheck` 0 errors；`pnpm --filter web test --run` 346 pass / 0 fail（覆盖率不变，本版不为新组件单独写 test —— form 行为是 `useState` 直绑、删除走 `confirm()`，关键路径 E2E 验证更合适，留作后续）。

详细计划：[`docs/plans/2026-05-07-v0.9.3-phase3-ml-backend-registration.md`](./docs/plans/2026-05-07-v0.9.3-phase3-ml-backend-registration.md)。

---

## [0.9.3 phase 2] - 2026-05-07

> **Merged Market — 三页合二，激活模型市场占位。** Phase 1 刚把 `/admin/ml-integrations` 拆出来作为超管 ML 集成总览页时，与既有 `/storage` 的 Bucket / 对象 StatCard 实质上重复；同时 `/admin/failed-predictions` 自 v0.8.6 起就是个完整分页页面，但失败条目通常 < 10 条，单独路由超规格；侧边栏「智能 → 模型市场」自始是 `PlaceholderPage`。本版把这三块捏成一个 ModelMarketPage：删 `/admin/ml-integrations`（其 storage 部分早被 `/storage` 覆盖；其 ML Backend 部分搬到模型市场 Tab 1），删 `/admin/failed-predictions`（整体折成模型市场 Tab 2），保留所有原有交互（retry / dismiss / restore + 60s refetch）。`/storage` 完全未动。

### Added

- **`apps/web/src/pages/ModelMarket/ModelMarketPage.tsx`**（新页）：Tabs 容器，URL `?tab=backends|failed` 同步（`useSearchParams` + `replace: true` 不污染历史栈）；默认 tab 为 `backends`；Tab 标题处对失败预测条数 > 0 渲染红色 `danger` 数字徽章（`99+` 上限）。
- **`RegisteredBackendsTab.tsx`**（搬迁自旧 `MLIntegrationsPage.tsx`）：保留 `adminMlIntegrationsApi.overview()` + 60s `refetchInterval` + `ProjectGroup` 项目分组卡片；StatCard 由原本的「对象总数 / 存储占用 / ML Backend」精简为「ML Backend / 使用项目」两张 — 存储 StatCard 与 `/storage` 同源已重复，去掉。Bucket 健康表整段删除（在 `/storage` 已有完整实现）。
- **`FailedPredictionsTab.tsx`**（搬迁自旧 `FailedPredictionsPage.tsx`）：完整保留分页 / `includeDismissed` 切换 / 三种 mutation（retry / dismiss / restore）/ `data-testid` 套件；外层标题段去掉，改成简短 hint 行（避免 Tab 内嵌套二级标题）。
- **Sidebar 模型市场动态徽章**：`useFailedPredictions(1, 1, false, hasAnyPermission("ml-backend.manage"))` 在侧边栏顶层调一次（`enabled` 由权限门控避免普通用户 401），> 0 时给 `model-market` 项渲染 `danger` 徽章「N 失败」+ tooltip；同步删掉 `ai-pre` 项硬编码的 mock 徽章「3 运行中」（v0.9.4 接 grounded-sam2-backend 文本批量后会接真数据）。

### Changed

- **AdminDashboard 跳转重定向**：失败预测卡片 onClick 由 `/admin/failed-predictions` → `/model-market?tab=failed`；ML 后端·预测成本卡片右上「集成总览」按钮由 `/admin/ml-integrations` → `/model-market`。
- **`useFailedPredictions` 加 `enabled` 参数**（默认 `true`，向后兼容）：把 react-query 的 `enabled` 暴露出来，让 Sidebar 在权限不足时彻底不发请求。
- **`App.tsx` `<PlaceholderPage title="模型市场" />`** 替换为 `<ModelMarketPage />`（lazy import）。

### Removed

- 路由 `/admin/ml-integrations` 与 `/admin/failed-predictions`。
- `apps/web/src/pages/Admin/MLIntegrationsPage.tsx` / `FailedPredictionsPage.tsx` / `__tests__/FailedPredictionsPage.test.tsx`。
- `PageKey` 联合中的 `admin-ml-integrations` 与 `admin-failed-predictions`；`ROLE_PAGE_ACCESS.super_admin` / `ROLE_PAGE_ACCESS.project_admin` 移除对应键；`UnauthorizedPage` 的 `PAGE_PATH` map 同步清理。
- 后端 `adminMlIntegrationsApi.overview` / `failed-predictions` 系列 API 端点完全不动 —— 只是前端不再有独立路由门面。

### Notes

- **`/storage` 完全未动**：它的角色权限广（admin / annotator / viewer 都能看），不适合塞 ML Backend 这类管理视角内容；Bucket + 数据集分布是它已胜任的职责。
- **未做 catalog tab**：v0.10.x sam3-backend 落地后再补「内置模型卡片 + 启用到项目」第 3 个 tab，本版只激活到能容纳现有两块内容的最小骨架。
- **测试**：`pnpm exec tsc --noEmit` 0 errors；`pnpm exec vitest run` 346 pass / 0 fail。`FailedPredictionsPage.test.tsx` 整体删除（旧路由不存在）；列表交互与分页改造未触及 hook 层（`useFailedPredictions` / `useRetryFailedPrediction` / `useDismissFailedPrediction` / `useRestoreFailedPrediction` 全保留），既有 hook 与 ws 通知测试覆盖率不变。

详细计划：[`docs/plans/2026-05-07-v0.9.3-phase2-merged-market.md`](./docs/plans/2026-05-07-v0.9.3-phase2-merged-market.md)。

---

## [0.9.3 phase 1] - 2026-05-07

> **Refactored Lighthouse — 前端杂项收口（4 项）。** v0.9.x SAM 主线 M3 起需要 GPU backend 联调，趁手头是 Mac 的窗口，把 ROADMAP §A/§B/§C 里"现在可做 / 纯前端" 的 4 项一次清完：① UsersPage「API 密钥」从 disabled 占位到端到端可用（后端 `api_keys` 表 + ak_ token 走 `get_current_user`，前端 ApiKeysModal 含一次性明文显示 + revoke），② 超管侧加 `/admin/ml-integrations` 只读总览页（聚合 storage health + 跨项目 ml_backends），③ 登录页 progressive CAPTCHA（同 IP 失败 ≥ 5 次后下次登录强制 Turnstile，正常用户零打扰），④ IoU 计算引入 `rbush` 同类分桶空间索引（千框场景预热），⑤ DropdownMenu 加 `content` 自定义槽，把 ExportSection / NotificationsPopover 两处自实现浮层收编到通用骨架。

### Added

- **API 密钥（程序化访问）**：新增 `api_keys` 表（user_id FK / key_prefix / bcrypt(key_hash) / scopes JSONB / last_used_at / revoked_at），alembic `0049_api_keys`；token 形如 `ak_<32 url-safe>`，前 12 字符做 prefix 索引。`/me/api-keys` CRUD（list / create 一次性返 plaintext / revoke 软删）；`get_current_user` 识别 `ak_` 前缀走 `api_key_service.resolve_token` 走候选行 bcrypt verify，命中刷新 `last_used_at` 并 commit。`scopes` 字段先入库不强制拦截，后续版本启用 `require_scopes` 工厂。
- **超管 ML 集成总览**：`GET /admin/ml-integrations/overview`（仅 super_admin）聚合 `storage.summarize_bucket(annotations / datasets)` + 跨项目 `ml_backends` 列表，按 project 分组返回 `{storage, projects[], total_backends, connected_backends}`；前端 `/admin/ml-integrations` 路由 + `MLIntegrationsPage`（StatCard × 3 + Bucket 表格 + ProjectGroup 卡片，60s refetchInterval）；`AdminDashboard` ML 卡片 header 加「集成总览」跳转按钮。
- **登录页 progressive CAPTCHA**：`apps/api/app/services/login_failed_counter.py`（Redis `login_failed:{ip}` INCR + EXPIRE 3600s + 成功 DEL，broker 故障 fail-open）；`auth.login` 入口先取计数，≥ `login_captcha_threshold`（默认 5）时强制 `verify_turnstile_token`，401 响应加 `X-Login-Failed-Count` header；`LoginRequest` 加可选 `captcha_token` 字段。前端 `ApiError.headers` 白名单透传 `x-login-failed-count`，`LoginPage` 失败 5 次后渲染 `<Captcha>`，提交时透传 token + 成功后清零。dev 模式 `turnstile_enabled=False` 时 `verify_turnstile_token` short-circuit 返 True 完全无感。
- **IoU 空间索引**：`apps/web/src/pages/Workbench/stage/iou-index.ts` `buildIoUIndex` 按 `cls` 分桶 RBush，`candidatesForBox` 仅返回同类 + 包围盒相交的候选；`WorkbenchShell` `dimmedAiIds` 改用候选裁剪 + iouShape 精确判定 + some() 早退保留。polygon 形状用顶点 bbox 入索引。`pnpm add rbush @types/rbush`。
- **DropdownMenu content 槽**：通用组件加 `content?: ({close}) => ReactNode`（与 `items` 互斥），content 模式下跳过列表键盘导航但保留 outside-click + Esc；`disablePanelPadding` / `panelStyle` 让 NotificationsPopover 等需要更宽 / 自管 padding 的场景沿用同一骨架。trigger ctx 也增加 `close`，业务确认后能主动关。
- **ExportSection / NotificationsPopover 收编**：两处自实现浮层删掉对 `usePopover` 的直接依赖，全部改用 `<DropdownMenu content={...}>`；视觉与改造前一致（导出弹窗格式选择 + 复选框 + 提交按钮；通知列表 header「全部已读」+ 行点击跳转 `/bugs` 或工作台批次）。`usePopover` 仅剩 `AttributeForm` 一处使用，保留。
- **测试**：后端新增 `test_api_keys.py`（3 case：CRUD + ak_ token 鉴权 + 跨用户隔离 + 失效 ak_ 401）、`test_admin_ml_integrations.py`（2 case：super_admin 200 / annotator 403 + 多项目分组聚合）、`test_login_progressive_captcha.py`（4 case：失败头部回填 / 阈值后 captcha_required / 成功重置计数 / dev short-circuit）；前端新增 `iou-index.test.ts` 4 case + DropdownMenu content 模式 2 case。
- **页权限**：`PageKey` 增 `admin-ml-integrations`，`ROLE_PAGE_ACCESS.super_admin` 加该项；`UnauthorizedPage` PAGE_PATH 也补齐。

### Changed

- `LoginRequest` 新增可选 `captcha_token`（向后兼容）。
- `auth.login` 凭据校验失败时审计 detail 多记 `ip_failed_count`。
- `ApiError` 加 `headers?: Record<string,string>`（白名单 `x-login-failed-count` 等），便于场景化读取。
- `DropdownMenu` trigger ctx 加 `close` 字段；现有 4 处 `{open, toggle, ref}` 解构调用方零改动。

### Roadmap 同步

- §A "UsersPage API 密钥 + 存储与模型集成对接" → 拆为「API 密钥（已落 v0.9.3）」+「存储与模型集成」过期清理（面板早期版本已删除，超管视角改放独立 `/admin/ml-integrations` 页）。
- §A "登录页 progressive CAPTCHA" → 已落。
- §C.1 "IoU rbush 加速" → 已落（保留触发条件描述以备后续 worker 化优化）。
- §C.2 "DropdownMenu 第 3+ 收编" → 全部完成（ExportSection + NotificationsPopover 共两处）。

详细计划：[`docs/plans/2026-05-07-v0.9.3-phase1-refactored-lighthouse.md`](./docs/plans/2026-05-07-v0.9.3-phase1-refactored-lighthouse.md)。

---

## [0.9.2] - 2026-05-07

> **Grounded-SAM-2 接入 M2 — 工作台 `S` 工具 + 文本入口 + DINO 阈值项目级 override（Luminous Canvas）。** v0.9.0 / v0.9.1 把 backend 容器化 + embedding 缓存铺好后，标注员仍然没有任何入口能触发 SAM；本版把后端能力下沉到工作台：新工具 `S` 让标注员**点 / Alt+点 / 拖框** 都能 < 50ms（命中缓存）拿到 polygon 候选，AI 助手在 S 模式下露出**文本提示**输入框（"person" 这样的英文 prompt 一键全图召回）；候选以**紫虚线**叠加 Konva 画布，`Enter` 接受 / `Esc` 取消 / `Tab` 切候选。同窗口把 GroundingDINO 的 box / text 阈值做成 ProjectSettings 项目级旋钮（默认 0.35 / 0.25），不同业务图（车牌 / 商品 / 卫星）可独立调参。

### Added

- **`apps/web/src/pages/Workbench/state/useInteractiveAI.ts`**（新 hook）：所有 prompt 都走 `mlBackendsApi.interactiveAnnotate`；`runPoint` 80ms 防抖合并连续点击（最后一次为准），`runBbox` / `runText` 不防抖；`inflightRef` 单调计数让晚到的过期请求不会覆盖最新候选；mlBackendId 缺失守卫 + toast「项目未绑定 ML Backend」；返回 `candidates` / `activeIdx` / `cycle` / `consume` / `cancel` / `isRunning`。
- **`apps/web/src/pages/Workbench/stage/tools/SamTool.ts`**（新工具）：`id="sam"` / `hotkey="S"` / `icon="sparkles"`；`onPointerDown` 返回新的 `samProbe` DragInit（保留 evt.altKey 给 negative point），与 BboxTool 完全隔离避免互相污染。
- **`ImageStage` SAM 路径**：DragInit / Drag union 加 `samProbe`；松手时按几何尺寸分流 — `dx<0.005 && dy<0.005` 视为单击 → `onSamPrompt({kind:"point", pt, alt})`；否则 → `onSamPrompt({kind:"bbox", bbox})`；拖框过程中渲染**紫色虚线预览框**（与候选 polygon 视觉同源）。新增 `samCandidates` / `samActiveIdx` props，候选 polygon 以 `Konva.Line(closed, dash, fill α=0.18 当前 / 0.06 其它)` 叠加，当前候选 stroke 加粗 2.5x、其它 1.4x、opacity 0.55 半透。
- **WorkbenchShell SAM 接受流**：捕获阶段（`window.addEventListener("keydown", ..., true)`）拦 `Enter` / `Esc` / `Tab` —— S 工具 + 候选非空时介入，否则透传给主 dispatcher；接受时锁定 `samPendingAccept = { idx }`，按候选 polygon AABB（`polygonBounds`）锚 `ClassPickerPopover`，DINO 短语恰好匹配项目类别时作为默认值；`handleSamCommitClass` 复用 `submitPolygon` 落库 + `sam.consume(idx)` 出队；切题（`taskId` 变化）和退出 SAM（`s.tool` 改非 sam）都自动 `sam.cancel()`，避免残留紫虚线。
- **`AIInspectorPanel` SAM 文本入口**（`SamTextPanel` 子组件，仅 `tool === "sam"` 时渲染）：「SAM 文本提示」区段，输入框 + 「找全图」按钮 + 候选数 chip + 「英文 prompt 召回最佳」hint；输入框 Enter 直接触发 `onRunSamText(trimmed)`，推理中按钮置灰显「推理中…」。
- **快捷键**：`hotkeys.ts` `setTool` union 加 `"sam"`；`HOTKEYS` 列表加 `S` 键（group "ai"）；`RESERVED_LETTERS` 加 `s/S` 防止落到 `setClassByLetter`；`HotkeyCheatSheet` 自动从 SoT 渲染。
- **Project 阈值字段**：`Project.box_threshold` / `text_threshold` `REAL NOT NULL DEFAULT 0.35 / 0.25`，CHECK `0..1`；`ProjectCreate` / `ProjectUpdate` / `ProjectOut` 全部加字段；`GeneralSection.tsx` 新增两条 range 滑块（step 0.05），`dirty` 检测 + `onSave` payload 一并透传。
- **`/ml-backends/{bid}/interactive-annotating` 阈值注入**：`type=text` 时读 project 字段写入 `context.box_threshold` / `text_threshold`；客户端如已显式给阈值则尊重客户端（`setdefault` 语义）；point / bbox 不注入（DINO 不参与，避免污染缓存键 / 协议噪声）。
- **`apps/grounded-sam2-backend` 阈值 override**：`predictor.predict_text(box_threshold, text_threshold)` 关键字参数，None 回退到 instance 默认（来自 backend env）；`main.py::_run_prompt` 从 `ctx` 读取并透传。
- **测试**：`useInteractiveAI.test.ts` 10 case（point / bbox / text 路由 + Alt 极性 + 防抖合并 + 守卫 + 失败 toast + 空结果提示 + cycle wrap + cancel）；`hotkeys.test.ts` 加 `S → setTool sam` 断言；`apps/api/tests/test_interactive_threshold_inject.py` 3 case（text 注入 / 客户端显式覆盖 / point 不注入）。
- **Alembic `0048_project_dino_thresholds`**：DO 块幂等加 NOT NULL 列 + 0..1 CHECK 约束；downgrade 反向干净。

### Changed

- **OpenAPI snapshot 重生**：`apps/api/openapi.snapshot.json` + `docs-site/api/openapi.json` 一并刷新（`scripts/export_openapi.py`），前端 `apps/web/src/api/generated/types.gen.ts` 经 `pnpm codegen` 加入 `box_threshold` / `text_threshold`。
- **ToolDock 顺序**：`ALL_TOOLS = [Bbox, Sam, Polygon, Hand]`，`SamTool` 排在矩形 / polygon 之间，强调它是 AI 加速的"高级矩形"；`canvas` 工具不入 ToolDock（仅评论批注用，从入口语义切走）。

### Notes

- **不做翻译**：v0.9.x §5 待决问题决策 1 — 后端尚无 LLM client，引入会挤压 6 天预算；改在文本框旁加 hint「英文 prompt 召回最佳」。后续如客户反馈强烈，单开 micro-feature 走平台 LLM 网关。
- **E2E 推迟**：完整 SAM E2E 需要 `/_test_seed` 加 `seed_ml_backend` 工厂（属于 E2E 基础设施扩展），范围超出 M2；vitest（349 全过）+ pytest（277 全过）已守住核心链路。E2E 在 v0.9.3 / M3 收口前补。
- **协议契约**：`ml-backend-protocol.md` 不动；`context` 仍是开放 dict，`box_threshold` / `text_threshold` 是 backend 可选感知字段（缺省走 backend env 全局值）。

详细计划：[`docs/plans/2026-05-07-v0.9.2-luminous-canvas.md`](docs/plans/2026-05-07-v0.9.2-luminous-canvas.md)。

---

## [0.9.1] - 2026-05-07

> **Grounded-SAM-2 接入 M1 — SAM 2 image embedding LRU 缓存 + Prometheus 观测。** 工作台 `S` 工具的典型动作是同图反复点击/拖框；v0.9.0 每次都跑完整 `set_image()` ≈ 1.5 s（4060 / tiny），全是 image encoder 重复花费。本版给 `apps/grounded-sam2-backend/` 加 LRU 缓存、Prometheus `/metrics`、人类可读 `/cache/stats`，让同图 N+1 次 point/bbox 操作直降到 < 50 ms，为 v0.9.2 工作台 `S` 工具铺路。范围严格限定在 backend 容器内：协议契约不动、平台 API 不感知、ml-backend-protocol.md 不改。

### Added

- **`apps/grounded-sam2-backend/embedding_cache.py`**（新模块）：基于 `collections.OrderedDict` + `threading.Lock` 的线程安全 LRU；`compute_cache_key(file_path, sam_variant)` 用 `urllib.parse.urlsplit` 取 `scheme://netloc/path` 拼 variant 后做 sha1，**剥掉 query string** —— MinIO presigned URL 的 `X-Amz-Signature` / `X-Amz-Date` 跨 TTL 滚动不应让缓存失效（同一对象逻辑身份恒定）；`get` / `put` / `peek`（不计 hits/misses 的 main 层短路用）/ `clear` / `stats` / `size` 接口；默认 `capacity=16`（`EMBEDDING_CACHE_SIZE` env 可调，4060 16、3090 32、A100 64）。
- **`apps/grounded-sam2-backend/observability.py`**（新模块）：`prometheus_client` 集中注册 4 个 metric — `embedding_cache_hits_total{prompt_type}` / `embedding_cache_misses_total{prompt_type}` / `embedding_cache_size` / `inference_latency_seconds{prompt_type,cache}`（bucket `[0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]`，专为 hit 毫秒尾巴 + miss 秒级长尾打的两段）；helper `record_cache(prompt_type, hit)` / `record_inference(prompt_type, cache_status, duration)` / `update_cache_size(size)` 风格对齐 `apps/api/app/observability/metrics.py`。
- **`predictor.py` snapshot/restore SAM 内部状态**：新增 `_snapshot_sam(w,h)` / `_restore_sam(entry)` 读写 `SAM2ImagePredictor` 的 `_features` / `_orig_hw` / `_is_image_set` / `_is_batch`（vendor `IDEA-Research/Grounded-SAM-2` commit `b7a9c29` 的内部 API；sync_vendor.sh 升级时必须人肉跑 5-clicks 集成验收）。SAM 2 image encoder 输出的 GPU tensor 直接存引用、不 deepcopy，内存上限由 LRU 容量物理保证。
- **三种 prompt 路径全部接缓存**（`predict_point` / `predict_bbox` / `predict_text` 加 `cache_key` 关键字参数；返回签名变成 `(results, cache_hit)`）：point/bbox 命中跳过 SAM `set_image()` + 跳过 main.py `_fetch_image()`（image=None 也允许）；text 命中跳过 SAM `set_image()`，但 DINO 仍需原图（caption 每次不同），所以 text 路径不省 fetch。
- **`GET /metrics`**：`prometheus_client.generate_latest()` 原始 exposition；scrape 配置见 `docs-site/dev/architecture/ai-models.md` §4.3。`embedding_cache_size` Gauge 在每次 `/predict` 完成 + 每次 `/metrics` 抓取时同步当前 size（懒采样、避免 LRU 内 lock 持有过久）。
- **`GET /cache/stats`**：人类可读 JSON `{size, capacity, hits, misses, hit_rate, variant}`，运维排错或快速验收用；不进 ml-backend-protocol（backend 内部端点）。
- **`docs-site/dev/architecture/ai-models.md`**（新文档）：v0.9.x grounded-sam2 + v0.10.x sam3 并存的部署拓扑、三种 prompt 路由表、cache key 设计 + 命中/未命中收益矩阵、容量与显存预算表（`tiny`/`small`/`base_plus`/`large` 四档）、vendor 内部 API 升级风险提示、Prometheus 指标表 + scrape 配置 + 关键 PromQL 查询。
- **`apps/grounded-sam2-backend/tests/test_embedding_cache.py`**（新单测文件，15 case）：`compute_cache_key` query string 剥离 / 路径区分 / variant 区分 / 本地路径覆盖；`EmbeddingCache` put/get 往返、miss 计数、hit 计数、LRU 淘汰顺序、容量上限、同 key 更新值且提到最近、`peek` 不动 LRU 不计数、`clear` 重置、非法 capacity、`hit_rate` 0.7 舍入、4 线程并发 200 次 put/get 锁安全。无需 GPU，纯逻辑；接 pyproject `[project.optional-dependencies] dev` + `[tool.pytest.ini_options]`。

### Changed

- **`apps/grounded-sam2-backend/main.py` `/predict` 流程重构**：取出 `file_path` 后先算 `cache_key`，对 point/bbox 走 `_cache.peek()`（不计 hits/misses 的纯存在性查询）决定要不要 `_fetch_image()`；text 始终拉图。完成后 `_observe(prompt_type, hit, started)` 一次性更新 `embedding_cache_hits|misses_total` + `inference_latency_seconds` + `embedding_cache_size`。批量分支同样按图记录 hit/miss，单图失败降级时记 miss。
- **`apps/grounded-sam2-backend/pyproject.toml`**：版本 `0.9.0` → `0.9.1`；新增 `prometheus-client>=0.20`；新增 `[project.optional-dependencies] dev = ["pytest>=8"]` + `[tool.pytest.ini_options] testpaths=["tests"], pythonpath=["."]`；`py-modules` 加入 `embedding_cache` / `observability`。
- **`apps/grounded-sam2-backend/main.py`** `FastAPI(version=...)` 同步 `0.9.1`；startup 日志多打 `cache_size`。
- **`apps/grounded-sam2-backend/README.md`**：`v0.9.0 (M0)` → `v0.9.1 (M1)` 头部声明；目录结构补 `embedding_cache.py` / `observability.py` / `tests/`；端点速查表新增 `/metrics` + `/cache/stats`；环境变量表新增 `EMBEDDING_CACHE_SIZE`；性能参考段从「M0 不实现 LRU」改为命中策略说明 + 链回 `ai-models.md`；后续切片标 v0.9.1 ✅。

### Notes

- **何时升缓存容量**：observability 给 `embedding_cache_size` Gauge + 命中率 PromQL，长期看到命中率 < 30% 可能是 capacity 过小或工作台流量分散到太多图；< 30% 同时 size 长期顶到 capacity 的，把 `EMBEDDING_CACHE_SIZE` 调大。`large` 变体下不要超 16，否则单缓存就能 ~400 MB 起跳。
- **vendor 升级清单**：`scripts/sync_vendor.sh` 后做两件事 —— ① 在 `predictor.py` 内 grep `_features` / `_orig_hw` / `_is_image_set` / `_is_batch`，确认上游属性名未改；② 跑 README §性能参考的 5-clicks 集成验收（同图连点 5 次，第 1 次 ≤ 500ms，第 2-5 次 ≤ 50ms）。
- **协议契约 / 平台 API 零改动**：缓存对 `apps/api` 透明，`docs-site/dev/ml-backend-protocol.md` 完全不动；后续 v0.10.x sam3-backend 可复用同一缓存模块（M3 抽 `mask_utils` 到 `apps/_shared/` 时一并把 `embedding_cache` 也搬过去）。

详细计划：[`docs/plans/2026-05-07-v0.9.1-declarative-feather.md`](docs/plans/2026-05-07-v0.9.1-declarative-feather.md)。

---

## [0.9.0] - 2026-05-07

> **Grounded-SAM-2 接入 M0 — backend 容器化。** v0.9.x AI 基座主轴启动；本版只做「把服务跑起来 + 协议 4 端点 + docker-compose 接入 + ProjectSettings 测试连接绿灯」，M1 embedding 缓存 / M2 工作台 `S` 工具 / M3 polygon 调参 / M4 `/ai-pre` UI / M5 运维收口都在 v0.9.1 ~ v0.9.5 单独切片。新服务 `apps/grounded-sam2-backend/` 是独立 GPU 容器（`docker compose --profile gpu` 启动，dev 笔记本无 GPU 默认不拉起），底层链路 GroundingDINO + SAM 2.1 → mask → polygon，三种 prompt（point / bbox / text）共用同一 `/predict` 端点按 body shape 自动分流。

### Added

- **`apps/grounded-sam2-backend/`**（新服务）：基于 `pytorch/pytorch:2.3.1-cuda12.1-cudnn8-devel`（与官仓 `IDEA-Research/Grounded-SAM-2/Dockerfile` 对齐 — Python 3.10 + torch 2.3.1 + torchvision 0.18.1 + CUDA 12.1 + gcc-10/g++-10；GroundingDINO Deformable Attention CUDA 算子需 nvcc 现场编译，故必须 devel 而非 runtime）；`TORCH_CUDA_ARCH_LIST="7.0;7.5;8.0;8.6;8.9;9.0"` 覆盖 V100 / T4 / A100 / RTX 30 / RTX 40 (Ada) / H100；FastAPI 单 worker（GPU 模型不可多进程共享显存），暴露 `/health` `/setup` `/versions` `/predict` 4 端点；`/predict` 按 `task+context` vs `tasks[]` 自动分流交互式 / 批量；返回 polygonlabels（mask→polygon: `cv2.findContours(RETR_EXTERNAL)` + `shapely.simplify(tolerance=1.0)` + 顶点归一化 [0,1]）。
- **三种 prompt 路由**（`predictor.py`）：`type=point` / `type=bbox` 跳过 DINO 直接 SAM image_predictor；`type=text` 走 GroundingDINO（caption 强制小写 + 末尾 `.`）→ boxes（cxcywh→xyxy 像素）→ SAM 2.1 多框 batch → mask 数组 → 多 polygon。
- **vendor 形态决策**：vendored copy + `scripts/sync_vendor.sh <commit-sha>`（git clone --filter=blob:none → checkout → rsync → 删 .git → 写 `.commit`）；不用 submodule（上游 demo 脚本结构常变，CI 无需额外 init 步骤）。Dockerfile build 期检测 `vendor/grounded-sam-2/` 为空则 fail-fast；分两步 editable install — 仓库根 `pip install -e .` 装 `sam2` 包，`grounding_dino/` 子目录 `pip install --no-build-isolation -e .` 装 `groundingdino` + 编译 Deformable Attention CUDA 算子。
- **checkpoints 启动时下载**（`scripts/download_checkpoints.py`）：幂等检查 `sam2.1_hiera_{tiny,small,base_plus,large}.pt` + `groundingdino_swin{t_ogc,b_cogcoor}.pth` 是否落盘；缺失时 `huggingface_hub.hf_hub_download` 拉到 `/app/checkpoints` (volume `gsam2_checkpoints`)，任一失败 sys.exit(1) 让容器启动失败避免半残上线。
- **变体可配置**（env 覆盖）：`SAM_VARIANT=tiny|small|base_plus|large`（默认 tiny，4060 8GB 友好）+ `DINO_VARIANT=T|B`（默认 T）+ `BOX_THRESHOLD=0.35` + `TEXT_THRESHOLD=0.25`；切换后重启容器生效（v0.9.x 不做运行时多变体共存）。
- **docker-compose service `grounded-sam2-backend`**（`profiles: ["gpu"]`）：`deploy.resources.reservations.devices` 锁 nvidia/count=1/capabilities=[gpu]，healthcheck `start_period=120s`（首次冷启动权重下载缓冲）；新增 volumes `gsam2_checkpoints` + `gsam2_hf_cache`（HF_HOME=`/app/.cache/huggingface`）。
- **`.env.example`**：加 `SAM_VARIANT` / `DINO_VARIANT` / `BOX_THRESHOLD` / `TEXT_THRESHOLD` / `GSAM2_LOG_LEVEL` 注释行。
- **`apps/grounded-sam2-backend/README.md`**：含能力盘点、目录结构、vendor 同步流程、本地启动 3 步、变体配置表、端点速查、性能参考、排错段、后续切片。

### Changed

- `docker-compose.yml`：补 GPU profile service + 2 个命名 volume（`gsam2_checkpoints` / `gsam2_hf_cache`）。dev 默认 profile 不启动 GPU service，无 GPU 笔记本不受影响。

### Fixed

实跑（RTX 4060 8GB / driver 580 / docker 29 + CDI nvidia）排查中暴露并修复的 4 个 bug，全部为 vendor 接入侧而非协议侧问题，未来 v0.9.x 各小版迭代时若再 bump vendor commit 需复核：

- **SAM 2 hydra config 路径漏 `configs/sam2.1/` 前缀**（`predictor.py:35-40`）：`build_sam2(cfg_name, ...)` 走 `pkg://sam2` hydra search path，必须给到 `configs/sam2.1/sam2.1_hiera_t.yaml` 完整相对包路径而非裸文件名（与 vendor 内 `grounded_sam2_local_demo.py:20` 对齐）。
- **vendor 内 GroundingDINO `inference.py` 把 vendor 根当顶层包名**（`predictor.py` 模块顶部）：上游代码 `import grounding_dino.groundingdino.datasets.transforms as T` 依赖 demo 运行时 cwd 隐式提供 sys.path，本 backend 显式 `sys.path.insert(0, "/app/vendor/grounded-sam-2")` 兜底。
- **httpx 默认不跟 301**（`main.py:_fetch_image`）：MinIO presigned URL / CDN 直链常带 redirect，`httpx.Client(follow_redirects=True)` 必加。
- **transformers 5.x 与 torch 2.3.1 backends 检测不兼容**（`Dockerfile` + `pyproject.toml`）：原约束 `transformers>=4.40` 拉到最新 5.8.0，`BertModel.from_pretrained` 触发 `BertModel requires PyTorch library` 假阳性；pin `transformers>=4.40,<5` + 顺手 pin `huggingface_hub>=0.23,<1.0`（1.x 移除了 vendor 依赖的旧 API）。

### Verified

实跑端到端（公交车样图 https://raw.githubusercontent.com/ultralytics/yolov5/master/data/images/bus.jpg，RTX 4060 / SAM tiny + DINO-T 默认变体）：

| Prompt | 耗时 | 结果数 | polygon 顶点 | score | 备注 |
|---|---|---|---|---|---|
| `bbox [0.05,0.05,0.95,0.7]` | 2408ms | 1 | 469 pts | 0.82 | 框选公交车上半 |
| `text "person"` | 3559ms | **4** | 125/85/71/52 | 0.98 | 4 个人全召回，label 透传 |
| `point (0.5, 0.5)` | 1602ms | 1 | 437 pts | 0.84 | 中心点定位单对象 |

顶点偏多（400+）是预期，M3 调 `simplify` tolerance 时降到 ~50-150。M1 加 LRU embedding cache 后同图二次点击预期 < 50ms。

### Notes

- **M0 范围边界**：本版**不做** LRU embedding 缓存（M1）/ 工作台 `S` UI（M2）/ polygon tolerance 调参评估（M3，本期用默认 1.0 inline 在 predictor.py，M3 抽到 `apps/_shared/mask_utils/`）/ 中→英翻译层（M2 一起做）/ 显存监控 / ADR-0010 / ADR-0011（M5）。
- **协议 §2.2 `text` 类型 docstring** v0.8.6 已扩，本版只在 backend 侧实现该 type 的实际处理；协议文档**未改**。
- **vendor 进仓策略**：`apps/grounded-sam2-backend/.gitattributes` 把 `vendor/**` 标 `linguist-vendored=true linguist-generated=true`，GitHub PR diff 默认折叠 + 仓库语言统计排除 + git blame UI 跳过；vendored copy（不用 submodule）让任何人 clone 后零 setup `docker build`，CI / 离线机器同理。当前固定 commit：`b7a9c29f196edff0eb54dbe14588d7ae5e3dde28`（IDEA-Research/Grounded-SAM-2 main HEAD @ 2026-05-07）。
- **maintainer 接入步骤**（首次部署）：① `bash apps/grounded-sam2-backend/scripts/sync_vendor.sh <commit-sha>` 同步 vendor + 选定 commit 写入 `README.md`；② `docker compose --profile gpu up --build grounded-sam2-backend`（首次冷启动 ~30 min，base image cuda12.1-devel ~9GB + apt + pip + GroundingDINO Deformable Attention 编译 ~3.7 min + image export ~3 min）；③ `/admin/ml-backends` 新建 backend 指向 `http://grounded-sam2-backend:8001` → 测试连接绿灯。
- **权重落 docker named volume**：`pensive-brown-3a8e41_gsam2_checkpoints` (~811MB) + `pensive-brown-3a8e41_gsam2_hf_cache`；compose project name 决定 volume 名，跨 worktree / 切回 main 后会创建新 volume，建议仓库根 `.env` 固定 `COMPOSE_PROJECT_NAME=ai-annotation-platform` 一次性消除复用问题。
- **`MLBackendClient` / 健康检查 / ProjectSettings 测试连接** v0.8.6 + v0.8.7 已就位，本版**未改任何 platform 侧代码**，复用现有链路；故意停容器后红灯 ≤ 70s（健康检查周期 60s + 抖动）。

---


<!-- v0.9.0 起的版本变更直接追加到本节；当开始开发0.10版本后再移到 docs/changelogs/0.9.x.md -->

---
