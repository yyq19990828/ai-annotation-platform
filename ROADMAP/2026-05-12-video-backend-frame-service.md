# P1 · 视频后端帧服务 Epic

> 状态：**进行中**。B1/B2/B3/B4/B6/B7 第一版已落地，B5 tracker job 壳、adapter/worker MVP、SAM video 协议桥与 GPU 分窗已分别在 v0.9.32 / v0.9.34 / v0.9.36 落地，chunk smart-copy 与诊断字段已在 v0.9.38 落地。当前剩余重点是：真实 SAM video backend、长视频 timetable compact / sparse、segment 导出聚合，以及视频专属导出 / 质量评估的后端底座。
>
> 本 epic 承载前端 [`2026-05-12-video-workbench-rendering-optimization.md`](2026-05-12-video-workbench-rendering-optimization.md) 中 R5.3 / R10 / R11 / R20 / R21 / R22 / R24 的服务端依赖。后端仍属 FastAPI + Celery + PostgreSQL + MinIO/S3 现有栈，**不引入独立 video service**。

---

## 1. 已完成基线

### 1.1 帧服务与缓存

| 项目 | 版本 | 结果 |
| --- | --- | --- |
| B1 Frame Timetable | v0.9.21 / v0.9.25 | `video_frame_indices` 保存 `frame_index -> pts_ms`，task 路由暴露 frame-timetable，并补 ETag / Cache-Control |
| B2 Chunk Service Wave B | v0.9.25 | `video_chunks`、task/videos facade、懒投递 Celery media 任务、H.264 baseline fragmented MP4 第一版 |
| B3 Frame Cache | v0.9.25 / v0.9.30 | WebP/JPEG 单帧缓存、prefetch、retry、`get_frame_array()` 进程内 LRU、poster 复用 frame cache |
| B6 Manifest v2 | v0.9.25 / v0.9.30 | `/tasks/{task_id}/video/manifest-v2` 与 `/videos/{dataset_item_id}/manifest` 返回 chunk / timetable / frame service / segments |
| Timetable repair CLI | v0.9.30 | `python -m app.cli.video.rebuild_timetable` 支持按 item / dataset / all 重建旧视频帧表 |
| Video asset retry | v0.9.33 | 存储管理 API 汇总并重试 probe / poster / timetable / chunk / frame cache 失败资产 |
| Chunk Smart-Copy | v0.9.38 | keyframe 对齐 chunk 优先 stream copy，失败 fallback transcode，并暴露 codec/keyframe/byte offset 诊断 |

### 1.2 协同与 tracker

| 项目 | 版本 | 结果 |
| --- | --- | --- |
| B4 Segment 协作基线 | v0.9.28 | `video_segments`、短视频默认单段、manifest v2 segments、claim / heartbeat / release 短 TTL lock |
| B5 Tracker Job Shell | v0.9.32 | 独立 `video_tracker_jobs` 表，创建 / 查询 / 取消 API，frame range + segment lock 校验，`event_channel` |
| Tracker Adapter MVP | v0.9.34 | `mock_bbox` contract adapter、`gpu` queue worker、状态机、Redis/WebSocket 事件、`video_track` prediction keyframes 写回 |
| SAM video 协议桥 | v0.9.36 | `sam2_video` / `sam3_video` model key，调用项目绑定 ML Backend 的 `context.type="video_tracker"`，长区间分窗 |
| 低置信度 outside 写回 | v0.9.36 | `VIDEO_TRACKER_LOW_CONFIDENCE_OUTSIDE_THRESHOLD` 低于阈值时写 outside prediction range，不生成 prediction keyframe |

### 1.3 观测与文档

| 项目 | 版本 | 结果 |
| --- | --- | --- |
| B7 基础指标 | v0.9.25 | chunk / frame cache QPS、生成耗时、cache hit/miss、资产容量指标 |
| Video frame service reference | v0.9.25+ | `docs-site/dev/reference/video-frame-service.md` 覆盖 timetable / chunk / frame / segment / tracker job |
| Runbook | v0.9.25+ / v0.9.36 | `docs-site/ops/runbooks/video-frame-service.md` 覆盖 Celery、MinIO、chunk/frame 失败、tracker GPU OOM |
| Env reference | v0.9.25+ / v0.9.36 | chunk/cache/segment/tracker 分窗和低置信度阈值同步到 `.env.example` 与 env-vars |

---

## 2. 当前未完成 Backlog

### P0 · 真实 SAM Video Backend

**目标**：把 v0.9.36 的平台侧 `sam2_video` / `sam3_video` 协议桥接到真实模型服务。

- 在 `grounded-sam2-backend` 或后续 `sam3-backend` 实现 `/predict context.type="video_tracker"`。
- 输入消费 `task.file_path`、`from_frame/to_frame`、`direction`、`prompt`、`source_geometry`。
- 输出逐帧 `{ frame_index, geometry, confidence, outside }`，与平台 worker 写回契约一致。
- GPU profile 覆盖 30s / 30fps、10min、长 segment 分窗三类场景。
- OOM / timeout / backend 5xx 失败要能让 `video_tracker_jobs.error_message` 可诊断。

**不做**：不把 SAM 2 / SAM 3 predictor 加进 `apps/api` 进程；仍遵循 ADR-0012 的独立 GPU service 边界。

### ✅ P0 · Chunk Smart-Copy 与 R5.3 后端加固

**目标**：让前端 WebCodecs / Worker 解码不再完全依赖重编码 fallback。

- ✅ H.264 / H.265 且 GOP 对齐良好的源视频走 smart-copy。
- ✅ chunk 元数据补足 codec / keyframe / byte range 诊断字段，便于前端降级判断。
- ✅ chunk 失败 retry 与 V5 失败列表联动保持可见。
- ⏳ 评估 chunk warmup：在 manifest / timeline 预取命中热点 range 时提前投递 media 任务。

**不做**：不上 DASH / HLS / adaptive bitrate；标注场景优先帧精度和可缓存 chunk。

### P1 · Timetable Compact / Sparse

**目标**：长视频帧表在 1h / 30fps 量级下仍保持轻量可缓存。

- 对长视频按 keyframe + fixed stride 存 sparse timetable，短视频继续 full table。
- API 保持 `frame_index -> pts_ms` 查询语义，缺口由服务端估算或插值。
- 导出与 worker 使用同一套 timetable helper，避免前后端帧号漂移。
- 重新校准目标：1 小时 30fps timetable 压缩后 <500KB。

### P1 · Segment 导出聚合与 Overlap 底座

**目标**：让 segment 不只是 lock 单位，也能参与导出和后续 overlap 质检。

- `Annotation` 查询 / 导出按 `segment_id` 或 frame range 聚合。
- 跨 segment 合并按 `frame_index` 排序，outside / prediction keyframe 不丢。
- overlap 区间元数据为前端 R21 / IAA / IDF1 报告预留。
- Presence 继续可选；不做实时编辑同步。

### P1 · FrameStep / Chapter 后端原语

**目标**：支撑前端 R13 / R20 的长视频导航与抽样标注。

- 项目或任务级 `frameStep` 配置，导出时明确 sampled / interpolated / held frame 来源。
- `VideoChapter` 或轻量 chapter metadata：`start_frame/end_frame/title/color/metadata`。
- segment 边界可按 step 对齐，避免跨段首尾帧语义混乱。

### P2 · 视频专属导出

**目标**：补齐 CVAT / MOT 场景常用互操作格式。

- MOT 16/17/20 CSV。
- KITTI Tracking。
- DAVIS mask 序列。
- Video Tracks JSON 继续作为内部稳定格式。
- outside / absent / occluded / prediction source 在各格式中有明确映射。

### P2 · Track 级质量评估

**目标**：为前端 R24 和长期质量审计提供后端 worker。

- MOTA / IDF1 / HOTA 评估 worker。
- 按 track / segment / chapter 输出错误定位。
- 与 overlap 区和标注质量 AI 审计长期线打通。

---

## 3. 建议顺序

```text
Wave 0 · 后端帧服务基线
  ✅ B1 Frame Timetable (v0.9.21 / v0.9.25)
  ✅ B2 Chunk Service Wave B (v0.9.25)
  ✅ B3 Frame Cache / Retry / Poster Reuse (v0.9.25 / v0.9.30)
  ✅ B6 Manifest v2 / Protocol Docs (v0.9.25 / v0.9.30)
  ✅ B7 Metrics / Runbook (v0.9.25+)

Wave 1 · 协同与 tracker 编排
  ✅ B4 Segment MVP (v0.9.28)
  ✅ B5 Tracker Job Shell (v0.9.32)
  ✅ Tracker Adapter / Worker MVP (v0.9.34)
  ✅ SAM video protocol bridge / GPU windowing (v0.9.36)

Wave 2 · AI 模型深化
  → 真实 SAM 2 / SAM 3 video backend
  → GPU profile / OOM 演练 / 端到端性能基准

Wave 3 · R5.3 解码体验
  ✅ Chunk smart-copy (v0.9.38)
  → chunk warmup / retry 可视化加固
  → timetable compact / sparse

Wave 4 · 长视频协同
  → segment 导出聚合
  → overlap 区元数据
  → frameStep / chapter 后端原语

Wave 5 · 数据互操作
  → MOT / KITTI / DAVIS 导出

Wave 6 · 质量评估
  → MOTA / IDF1 / HOTA worker
```

---

## 4. 硬约束 / 暂缓

- 不引入独立 video service；所有后端任务继续跑在现有 FastAPI + Celery 架构内，按 queue 隔离。
- 不在 `apps/api` 内加载 torch / CUDA / SAM predictor；GPU 模型遵循 ADR-0012 独立 ML Backend。
- 不上 WebRTC / DASH / HLS；本阶段只做原视频 fallback + fragmented MP4 chunk。
- 不做 adaptive bitrate；标注场景需要原画质和帧精度，不需要多档码率。
- 不做 OT / CRDT；多人协同优先用 segment lock + 乐观重试。
- 不把 scheduler 改造成 segment 调度器；第一版仍以 task 为入口，segment 是 task 内部协作单位。
- 不为旧视频强制迁移；旧视频通过 rebuild timetable / lazy chunk / retry 入口渐进修复。

---

## 5. 关键文件

| 模块 | 文件 | 当前状态 |
| --- | --- | --- |
| 视频帧 API | `apps/api/app/api/v1/tasks.py` / `apps/api/app/api/v1/videos.py` | task 兼容入口 + videos facade 已承载 manifest / chunk / frame / segment / tracker |
| 帧服务核心 | `apps/api/app/services/video_frame_service.py` | timetable、chunk、frame cache、manifest v2、frame array LRU |
| media worker | `apps/api/app/workers/media.py` | probe / poster / timetable / chunk / frame extraction / cleanup |
| 数据模型 | `apps/api/app/db/models/dataset.py` | `VideoFrameIndex` / `VideoChunk` / `VideoFrameCache` / `VideoSegment` |
| tracker job | `apps/api/app/db/models/video_tracker_job.py` / `apps/api/app/services/video_tracker_job_service.py` | job 持久化、创建 / 查询 / 取消、segment lock 校验 |
| tracker worker | `apps/api/app/workers/video_tracker.py` / `apps/api/app/services/video_tracker_runner.py` | `gpu` queue、状态机、事件流、分窗、结果写回 |
| tracker adapters | `apps/api/app/services/video_tracker_adapters.py` | `mock_bbox`、`sam2_video`、`sam3_video` registry |
| ML Backend client | `apps/api/app/services/ml_client.py` | `/predict` 调用、per-backend concurrency、metrics |
| 协议文档 | `docs-site/dev/reference/video-frame-service.md` / `docs-site/dev/reference/ml-backend-protocol.md` | frame service 与 `context.type="video_tracker"` 契约 |
| Runbook | `docs-site/ops/runbooks/video-frame-service.md` | chunk/frame 失败、segment lock、tracker queue / GPU OOM |

---

## 6. 每次开发前固定检查

1. 写实施 plan 到 `docs/plans/yyyy-mm-dd-<topic>.md`；若 release version 已确定，用 `docs/plans/yyyy-mm-dd-vx.y.z-<topic>.md`。
2. 对照 `docs-site/dev/reference/video-frame-service.md`、`docs-site/dev/reference/ml-backend-protocol.md`、`docs-site/ops/runbooks/video-frame-service.md` 判断是否同步。
3. 若改 API，运行 OpenAPI 导出并检查 `docs-site/api/` 生成物。
4. 若改 Celery media / tracker worker，开发环境只需重启 worker；改依赖 / Dockerfile 才 rebuild。
5. 验证至少覆盖：`pytest apps/api/tests/test_video_frame_service.py`、新增 segment / tracker 测试、`pytest apps/api/tests/test_alembic_drift.py`、`pnpm --filter @anno/docs-site build`。

---

## 7. 关联 Roadmap

- [`2026-05-12-video-workbench-rendering-optimization.md`](2026-05-12-video-workbench-rendering-optimization.md)：前端 R5.3 / R10 / R11 / R20 / R21 / R22 / R24。
- [`2026-05-12-image-workbench-optimization.md`](2026-05-12-image-workbench-optimization.md)：viewport / minimap / bitmap cache 的共享设计来源。
- [`0.10.x.md`](0.10.x.md)：SAM 3 backend、tracker registry、模型并存窗口。
- [`2026-05-12-long-term-strategy.md`](2026-05-12-long-term-strategy.md)：L15 标注质量 AI 审计与 Track 级质量评估。
