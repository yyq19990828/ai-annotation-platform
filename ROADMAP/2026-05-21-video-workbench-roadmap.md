# 视频工作台总路线图（导入采样 / 轨迹工具 / 导出）

> 从 [ROADMAP.md](../ROADMAP.md) 抽离的**视频专项独立 epic**。原 §C.5（前端剩余）/ §C.6（后端帧服务剩余）/ 优先级表 P0-P1 视频两行、以及散落在 §A 的视频相关条目，全部按执行顺序并入本文；主 ROADMAP 只保留一行指针。
>
> 性质：**长程 epic 规划**，不是"等触发"。当前 v0.10.x 主线收尾后按 Phase 顺序推进；每个 Phase 收尾配套精简本文 + 回写 CHANGELOG。
>
> 上游已收尾基座（不在本文范围，仅作前置说明）：帧服务三层索引（`VideoFrameIndex` / `VideoChunk` / `VideoFrameCache`）、按帧渲染图片接口、ffprobe 元数据、`video_tracker_jobs` 协议桥与 adapter MVP、chunk smart-copy、SAM video 协议桥（v0.9.36）、关键帧 + 前端线性插值、`split_track` / `merge_tracks` 后端服务、AAP JSON v1.1 信封。

---

## 0. 三项已拍板的架构决策（贯穿全文）

这三项在 2026-05-21 讨论中确定，是后续所有 Phase 的设计前提，违反即推倒重来：

| #      | 决策                                                             | 反面（不要走）                           | 理由                                                                                                                                        |
| ------ | ---------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **抽帧 = 逻辑采样，不物理重采样、不取代原视频**                  | ffmpeg 重新编码出低 fps 新 mp4 替换/并存 | 帧服务本就按 `frame_index` 渲染单帧图片，原视频 fps 不影响标注体验；逻辑采样零成本、可逆、随时改密度                                        |
| **D2** | **标注 geometry 的 `frame_index` 永远存原视频帧号**              | 存采样后的帧号                           | 改采样密度不破坏旧标注；tracker / 插值都在源帧空间算；与决策底线"内部稳定 ID"一致。导出 MOT 时再按采样网格重编号                            |
| **D3** | **AAP 不按 image/video/lidar 拆分，保持单一信封 + 模态判别字段** | 拆成三套 schema / 三个 importer          | 单 envelope 靠 `media_type` + 多态 geometry 区分；拆分 = 维护 3 个 schema_version，正踩"别自己维护 25 种格式"反模式（决策底线"格式适配"行） |

> **采样配置归属**：项目级（不是数据集级）。数据集 = 原始资产（一个 mp4 是 ground truth，全 fps，存一份）；同一视频不同项目可要不同采样率，采样是项目/任务的标注策略。可在数据集级留一个 `default_fps_hint` 供建项目时预填。

---

## Phase 1 · 导入与帧采样（D1 + D2 落地）

> 已于 v0.10.29 落地，详见 [CHANGELOG v0.10.29](../CHANGELOG.md)。软网格语义（绝对网格锚定 0、`←/→` 跳网格、暂停吸附、`Shift+←/→` 逃生口微调 ±1 源帧、`Alt+←/→` 关键帧跳）是后续 Phase 的设计前提，保留于此供参考。
>
> **进展**：WebCodecs 精确帧解码链路（mp4 demux、`EncodedVideoChunk` 构造、有状态 GOP 会话、字节预算缓存、Konva 显示与当前帧 JPEG 同源）已接通，默认按客户端能力尝试并安全降级。Apple Silicon 原生有头 Chrome 已完成 key / P / B / GOP / VFR 像素，以及 1080p/30、1080p/60、4K/30 的 VideoToolbox strict、5,000 次稳定操作、60 秒真实播放、资源 plateau 和 fallback 资格；静态 GPU profile 只作诊断。后续只保留 Edge / Safari 实机矩阵。解码发生在运行网页的客户端浏览器，Linux 服务端部署不要求本机具备浏览器硬解能力。
>
> **明确不做（D1）**：物理重采样 / 生成低 fps 新 mp4 / 从视频抽成独立图片数据集。

---

## Phase 2 · 轨迹工具对齐 CVAT（核心生产力）

> **2.1–2.8（v0.10.30）+ 2.10 侧栏外操作入口（v0.10.32）已落地**，详见 [CHANGELOG](../CHANGELOG.md) / [v0.10.30 plan](../docs/plans/archive/2026-05-21-v0.10.30-phase2-tracks-plan.md) / [v0.10.32 plan](../docs/plans/archive/2026-05-22-v0.10.32-track-ops-out-of-sidebar.md)。建立的轨迹模型是 Phase 5/6 底座：`semantic_label` + `track_number` 确定性派生（`track_id` uuid 只读）、`outside`/`occluded` 两态（对齐 CVAT）、track/帧级属性、split/merge/join/propagate、关键帧导航、`O`/`Q`/`H`/`L`/`Ctrl+B` track 快捷键（侧栏/快捷键/浮动条共享同组 actions）。

### 2.9 多几何 track（polygon / polyline / mask）（**已落地**；原 R9）

- polygon / polyline 采用平行 `video_track_polygon` / `video_track_polyline` geometry，完成绘制、按周长 / 弧长参数化插值、渲染、编辑与普通导出。polyline AI 因现有模型不原生追踪开放折线、mask 骨架化启发式价值不足而取消；保留明确 400，不再作为缺口。
- 真·栅格 mask 使用平行 `video_track_mask` geometry 与内容寻址 COCO RLE 对象，完成 hold 解析、逐像素渲染 / 选择、笔刷编辑、tracker 原始 mask 候选、AAP 无损迁移、COCO RLE 与 DAVIS 导出。实施合同见 [栅格 mask track 计划](../docs/plans/archive/2026-07-12-v0.22.0-raster-mask-track-davis.md)。

### 2.11 采样下 propagate「N 帧」单位对齐导航网格（**v0.10.35 落地**）

- 已落地（设计前提保留供后续 Phase 参考）：采样开启时 propagate 对话框「N」改以网格格子为单位、tracker 只回填 `frame_index % step == 0` 的网格帧（底层仍逐源帧算、`frame_index` 存源帧，D2）。详见 [CHANGELOG v0.10.35](../CHANGELOG.md) / [v0.10.35 计划](../docs/plans/archive/2026-05-22-v0.10.35-video-tracker-backend-and-sampling-units.md) §A。

---

## Phase 3 · 真实 tracker / 自动标注

### 3.1 真实 SAM 2/3 video backend（原 C.6 P0）

> **gsam2 `sam2_video` 已于 v0.10.35/36 落地**（独立显存池 + `/health.video_pool` 观测 + 模型市场 image/video 模态拆分 + sam_variant 选择）。详见 [CHANGELOG](../CHANGELOG.md)、[v0.10.35 计划](../docs/plans/archive/2026-05-22-v0.10.35-video-tracker-backend-and-sampling-units.md)、[ml-backend-protocol.md](../docs-site/dev/reference/ml-backend-protocol.md) `type=video_tracker`。

**遗留待续**：

- **跨窗有状态续追**：SAM2 / SAM3 当前均用上一窗末帧 geometry 作下一窗 seed 的无状态近似，边界可能轻微漂移；后续可上 session/context-token 让 backend 跨窗保 memory bank 状态。

### 3.2 Tracker 选择 / 展示（原 R23「Tracker Registry UI」）

- **关键决策——不做 tracker 注册表 UI，勿走回头路**：原 R23 设想管理员手工「注册 / 启停 tracker adapter」（对应写死的 [`_REGISTRY`](../apps/api/app/services/video_tracking/adapters.py)）；[能力协商 epic](archive/2026-05-22-ml-backend-modality-and-ai-preannotate-redesign.md) 改为 backend `/setup` 自报能力、平台动态发现，无需人工注册表，「启停」即 backend 暂停/恢复。
- **已落地**：能力只读展示（v0.10.37，`supported_trackers` 列）+ sam_variant 尺寸选择（v0.10.36，propagate 对话框 → adapter context → video 池）。视频 AI 入口是 `VideoTrackerPropagateDialog`（Shift+T）；图片工作台悬浮 AI 面板对视频任务**显式禁用 by design**（[`WorkbenchShell.tsx`](../apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx) `aiPopover.open = aiPopoverOpen && !isVideoTask`）。

### 3.3 图片 / 视频 tracker 协议统一收口（原 I20.4，跨模态）

- 已抽为 [能力协商 epic](archive/2026-05-22-ml-backend-modality-and-ai-preannotate-redesign.md) 并落地阶段 1（v0.10.37）：能力快照落 `health_meta["capabilities"]`、按 `data_type` 校验、`is_interactive`/modality 派生，动态读取替代写死 `_REGISTRY`。

---

## Phase 4 · 视频导出（D3 落地）

> **4.1 + 4.2 导出端 + 4.3 + 4.4 + 4.7 已于 v0.10.31 落地**，详见 [CHANGELOG](../CHANGELOG.md) / [v0.10.31 plan](../docs/plans/archive/2026-05-21-v0.10.31-phase4-video-export-plan.md)：视频并入异步 zip 管线、AAP schema 升 1.2（task 层 `media_type` + `video` 子块、`video_track` 无损透传，envelope 不拆 D3）、MOT 16/17/20 + KITTI Tracking 2D 导出（整数 id 按采样网格重编号 D2、附 `fetch_frames.py` 抽帧不物理打包 D1）。**v0.10.44 追加 `yolo-frames-det`**：按采样网格抽帧，合并单帧 `video_bbox` 与摊平后的 `video_track`，导出传统检测训练用 YOLO labels。
>
> **统一映射约定**（已落地于 [exporting/video.py](../apps/api/app/services/exporting/video.py) 顶部，保留供后续格式扩展参考）：MOT 省略 outside 帧 / occluded 仍输出；KITTI 用 occluded 列；帧号 MOT 1-based、KITTI 0-based。

### 4.2 导入端（**已落地**）

- AAP JSON 标注导入已能恢复 bbox / polygon / polyline / OBB / keypoint / mask 视频单帧几何与轨迹；mask 内容由 `mask_objects` 携带并在入库时重建内容寻址引用。
- AAP JSON 预测导入能把 `video_bbox` 与 bbox / polygon / polyline / mask 视频轨迹写为外部候选；工作台按当前帧显示并逐 shape 接受或驳回，接受后才形成正式标注。预测与标注导入仍使用各自独立的入口。

### 4.5 DAVIS mask 序列（原 R22 + C.6 P2，**已落地**）

- 导出标准 `Annotations/Full-Resolution/{sequence}/{frame:05d}.png` palette PNG、对应 JPEG 抽帧 manifest 与 `ImageSets/2017/val.txt`；对象 id、255 void、overlap、outside / occluded 和每序列 254 目标上限均有固定合同与回归测试。

### 4.6 Segment 导出聚合（后端，原 C.6 P1）

- `Annotation` 查询 / 导出按 `segment_id` 或 frame range 聚合；跨 segment 合并按 `frame_index` 排序，outside / prediction keyframe 不丢；overlap 区间元数据为 Phase 5 / IAA / IDF1 预留。
- Video Tracks JSON 作内部稳定格式，MOT/KITTI/DAVIS 从它派生。

---

## Phase 5 · 长视频协同与 overlap（原 R11 / R21 + C.6 P1 Segment 底座）

- segment 切换 UI、单段单人 lock 只读提示、overlap 区 IAA / IDF1 报告；Presence 可选，**不做 OT / CRDT**。
- 后端 segment 导出聚合（Phase 4.6）为本 Phase 提供 overlap 元数据底座。

---

## Phase 6 · Track 级质量评估（原 R24 + C.6 P2 worker）

- MOTA / IDF1 / HOTA 评估 worker，按 track / segment / chapter 输出错误定位；时间轴错误定位 UI。
- 与 Phase 5 overlap 和长期规划 L15「标注质量 AI 审计」打通。

---

## 执行顺序与优先级

| Phase | 主题                  | 原 ROADMAP 对应                                         | 优先级 | 备注                                                                      |
| ----- | --------------------- | ------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| 1 ✅  | 导入与帧采样（D1/D2） | R20 / C.6 P1(timetable/frameStep/chapter/warmup) / R5.3 | P0/P1  | v0.10.29 落地；WebCodecs demux 接入延后                                   |
| 2 ✅  | 轨迹工具对齐 CVAT     | R16 / R9 + 新增 2.1/2.6/2.7/2.8                         | P0/P1  | bbox / polygon / polyline / mask 平行轨迹均已落地；polyline AI 明确不做   |
| 3 ◑   | 真实 tracker backend  | C.6 P0 / R23 / I20.4                                    | P0     | SAM2 / SAM3 video tracker 与动态能力协商已落地；跨窗仍是无状态续追        |
| 4 ◑   | 视频导出（D3）        | R22 / C.6 P2 / §A AAP video_track 导入                  | P1     | AAP 标注 / 预测导入、逐帧 YOLO / COCO、DAVIS 已落地；4.6 Segment 聚合延后 |
| 5     | 长视频协同 overlap    | R11 / R21 / C.6 P1 segment                              | P1     | 不做 OT/CRDT                                                              |
| 6     | Track 质量评估        | R24 / C.6 P2 worker                                     | P2     | 与 L15 打通                                                               |

> **不做清单**（与决策底线一致）：物理重采样新视频（D1）、AAP 拆三格式（D3）、predictor 进 apps/api（ADR-0012）、OT/CRDT 协同、ffmpeg.wasm/Broadway.js、Skeleton 无限嵌套、自维护 25 种格式（新格式走 datumaro 中转）。

---

## 关键文件索引（开工锚点）

| 关注点          | 文件                                                           | 说明                                                       |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| 视频元数据      | `apps/api/app/schemas/task.py:9`                               | `fps/frame_count/duration_ms/...`                          |
| 帧服务模型      | `apps/api/app/services/video_frame_service.py`                 | `VideoFrameIndex`/`VideoChunk`/`VideoFrameCache`           |
| 媒体 worker     | `apps/api/app/workers/media.py:566`                            | timetable 生成                                             |
| track geometry  | `apps/api/app/schemas/_jsonb_types.py:337-371`                 | `VideoTrackKeyframe`/`VideoTrackGeometry`                  |
| track 服务      | `apps/api/app/services/annotation.py:629`                      | `split_track`/`merge_tracks`/`aggregate_bboxes`            |
| tracker job     | `apps/api/app/db/models/video_tracker_job.py:20`               | `from_frame/to_frame/direction/prompt`                     |
| tracker adapter | `apps/api/app/services/video_tracking/adapters.py`             | `propagate()` 协议                                         |
| 视频导出        | `apps/api/app/services/exporting/service.py`                   | `export_video_tracks`（裸 JSON，待并入 zip）               |
| AAP schema      | `apps/api/app/schemas/aap_json.py:33`                          | `schema_version 1.1`，待加 `media_type`                    |
| 导入适配        | `apps/api/app/services/predictions_import.py`                  | `internal_geometry_to_ls_shape`（video_track 进 errors[]） |
| 前端 stage      | `apps/web/src/pages/Workbench/stage/VideoKonvaStage.tsx`       | Konva 画布 + 精确帧 / `<video>` 双源                       |
| track 类型      | `apps/web/src/pages/Workbench/stage/videoStageTypes.ts`        | `VideoTrackAnnotation`/`VideoTrackPreview`                 |
| 插值            | `apps/web/src/pages/Workbench/stage/videoStageGeometry.ts:131` | 线性插值 + LRU                                             |
| 时间轴          | `apps/web/src/pages/Workbench/stage/videoTrackTimeline.ts`     | keyframes/outside/interpolated/density                     |
| 导出 UI         | `apps/web/src/pages/Dashboard/ExportSection.tsx:94`            | video-track 强制 Video JSON                                |
