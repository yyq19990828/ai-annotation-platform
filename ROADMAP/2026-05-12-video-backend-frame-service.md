# P1 · 视频后端帧服务 Epic

> 状态：**partial shipped（B1/B2/B3/B6/B7 第一版已落地，B4/B5 待开发）**。承载前端 `2026-05-12-video-workbench-rendering-optimization.md` 中 R5.3 / R10 / R11 三块的服务端依赖。
>
> 当前后端只暴露单一 `manifest.video_url`，让浏览器自己用 `<video>` 解码。这对于短视频 + 单人 + 单段是够用的，但要支持：长视频（>10 分钟）、4K、多人协同、AI tracker 流式补帧、精确帧导航，必须把"帧"作为一等资源在后端暴露和缓存。
>
> 本 epic 是后端独立工程，不涉及前端 UI 改造（前端改造见 R5 / R8-R11）。后端仍属 FastAPI + Celery + PostgreSQL + MinIO/S3 现有栈，**不引入新服务**。

---

## 1. 现状盘点

### 1.1 后端视频处理（apps/api/app/）

- 上传走 `/uploads`，存储到 MinIO/S3。
- `probe` 任务（Celery）：用 ffprobe 抽 fps / duration / 总帧数 / codec，结果写入 `DatasetItem.metadata.video`。
- `poster` 任务：抽首帧 / 中间帧做封面，输出到 storage。
- 标注落地：`Annotation` 表，按 `task_id / dataset_item_id + frame_index` 关联；`video_track` 用 JSON 字段存 keyframes。
- 协议：旧 task manifest 返回 `{ video_url, fps, total_frames, duration, poster_url }`；v0.9.25 起新增 `/api/v1/tasks/{task_id}/video/manifest-v2` 与 `/api/v1/videos/{dataset_item_id}/manifest`。

### 1.2 当前痛点（驱动本 epic）

1. **帧定位漂移**：前端只能 `video.currentTime = idx / fps`，浮点误差累计。
2. **大视频卡顿**：浏览器要先下载整段 MP4（或边下边播）才能 seek，跨段跳转白屏。
3. **协同冲突**：单条视频任务，多人同时编辑只能靠乐观锁 + 整体重试，颗粒度太粗。
4. **AI 推理无入口**：模型推理需要拿到指定帧 → 现在只能后端用 ffmpeg 抽一次，没有缓存复用。
5. **导出不一致**：导出走后端，前端 seek 走浏览器，两边帧号映射不一致时会出现"导出的标注帧 ≠ 用户在画面上看到的帧"。

---

## 2. 设计目标

- **G1 帧寻址**：后端定义统一的 `frame_index ↔ (chunk_id, offset, timestamp)` 映射，前端和后端共用一套帧号。
- **G2 chunk 服务**：按 N 秒 / N 帧切片，HTTP Range 友好，CDN 可缓存，浏览器 Worker 解码。
- **G3 帧缓存**：抽帧结果（PNG / JPEG / WebP）后端 LRU 缓存（MinIO 一层 + 内存一层），供 AI 推理、thumbnail、poster 共用。
- **G4 任务切片**：长视频自动切 segment，segment 是协同单位，可分配、可独立 lock。
- **G5 AI 推理桥**：模型推理任务能直接拿 `(dataset_item_id, frame_index)` 取帧，不重复抽帧。
- **G6 协议向后兼容**：旧 manifest 接口保留；新接口已采用 `/api/v1/tasks/{task_id}/video/manifest-v2` 与 `/api/v1/videos/{dataset_item_id}/manifest`。

---

## 3. 任务分解

### B1 · 帧时间表 `frame_timetable`（**必做，基础**）

> 解决 G1。前端 R1.2 直接依赖这个接口。

- **状态（v0.9.25）**：B1 第一版已完成。当前按 `DatasetItem` 存 `video_frame_indices(dataset_item_id, frame_index, pts_ms, is_keyframe, pict_type, byte_offset)`，并通过任务路由暴露；ETag / Cache-Control 已补，compact / 稀疏长视频策略后续再补。
- **B1.1 probe 任务增强**：用 `ffprobe -show_frames -select_streams v -of json` 抽每一帧的 `pkt_pts_time`、`pict_type`、`key_frame` 标记，存到 `VideoFrameIndex` 表（`dataset_item_id, frame_index, pts_ms, is_keyframe, pict_type, byte_offset`）。
  - v0.9.21 先对 probe 成功的视频全量存表；长视频稀疏采样（每 N 帧一行）后续再补。
  - I/B/P 帧分布在导出时也有用（避免在 B 帧上做精确 seek）。
- **B1.2 接口**：`GET /api/v1/tasks/{task_id}/video/frame-timetable?from=&to=` 返回 JSON 帧表；无表时返回 `source="estimated"` 和空 `frames`。
- **B1.3 ETag + Cache-Control**：内容只读不变，强缓存。（v0.9.25 已补第一版）

**衡量**：1 小时 30fps 视频 timetable 压缩后 <500KB。

---

### B2 · Chunk 切片服务（**核心，前端 R5.3 依赖**）

> 解决 G2。对标 CVAT 的 chunk 概念。

- **状态（v0.9.25）**：B2 第一版已完成。当前按 `DatasetItem` 存 `video_chunks`，task 路由与 `/api/v1/videos/{dataset_item_id}` facade 双入口暴露；缺失 chunk 懒投递 Celery media 任务，第一版统一 H.264 baseline fragmented MP4 重编码，GOP smart-copy 后续再补。

- **B2.1 切片策略**：
  - 单位：默认每 chunk = 60 帧（30fps 即 2 秒），可配置。
  - 编码：v0.9.25 先统一后台 Celery 重编 H.264 baseline + 短 GOP；原始视频 H.264 / H.265 且 GOP 对齐良好时 smart-copy 后续再补。
  - 容器：`.mp4` fragmented 形式，方便 MSE / WebCodecs 直接吃。
- **B2.2 存储布局**：`s3://datasets/videos/{dataset_item_id}/chunks/{chunk_id}.mp4`，索引表 `VideoChunk(dataset_item_id, chunk_id, start_frame, end_frame, byte_size, storage_key, status)`。
- **B2.3 懒切片**：首次访问触发 Celery，未 ready 时返回 202 + Retry-After；同时 fallback 到原始 `video_url`（前端 R5 自动降级）。
- **B2.4 接口**：
  - `GET /api/v1/tasks/{task_id}/video/chunks?from_frame=&to_frame=` 返回 chunk 列表 + 签名 URL。
  - `GET /api/v1/videos/{dataset_item_id}/chunks/{chunk_id}` 返回 MinIO 预签名 URL 元数据（含 Range 友好对象）。
- **B2.5 GC**：长时间未访问的 chunk 删除，下次再生（标记表里只置 `ready=false`，不删元数据）。

**衡量**：1080p / 30fps / 1 小时视频，chunk 总数 ~1800，单 chunk <2MB，HTTP Range 命中率 >90%。

---

### B3 · 帧抽取与缓存服务（**配套，AI 与 thumbnail 共享**）

> 解决 G3 / G5。

- **状态（v0.9.25）**：B3 第一版已完成。当前按 `DatasetItem` 存 `video_frame_cache`，支持 WebP/JPEG 单帧查询和批量 prefetch；内部 `get_frame_array()` 可复用 ready 缓存并带进程内 LRU。thumbnail/poster 与失败重试复用仍留后续。

- **B3.1 单帧接口**：`GET /api/v1/tasks/{task_id}/video/frames/{frame_index}?format=jpeg|webp&w=` / `GET /api/v1/videos/{dataset_item_id}/frames/{frame_index}` 返回静态图元数据。
  - 实现：先查 MinIO `s3://.../frames/{frame_index}_{w}.webp`，未命中走 Celery（`ffmpeg -ss <pts> -frames:v 1`），缓存后返回。
  - 用 PTS（B1 输出）而非 `frame / fps`，避免浮点误差。
- **B3.2 LRU + TTL**：MinIO 上没有原生 LRU，写一个轻量 housekeeping 任务（Celery beat 每天扫描 `last_accessed_at`，淘汰超时 + 容量），元数据存到 `VideoFrameCache` 表。
- **B3.3 批量预取**：`POST /api/v1/tasks/{task_id}/video/frames:prefetch { frame_indices: [...] }`，前端 R5.1 / R5.2 可主动 hint。
- **B3.4 AI 推理钩子**：内部 Python API `frame_service.get_frame_array(dataset_item_id, frame_index) -> np.ndarray`，模型 worker 直接调用，与 HTTP 层共享同一缓存（避免双倍抽帧）。

**衡量**：thumbnail / poster / AI / 前端预取，**任何一处缺帧时一次抽帧、四处复用**。

---

### B4 · Segment 与协同（**前端 R11 依赖**）

> 解决 G4。

- **B4.1 Segment 模型**：`VideoSegment(id, dataset_item_id, segment_index, start_frame, end_frame, assignee_id, status, locked_by, locked_at, lock_expires_at)`。
  - 短视频默认 1 segment（与 video 1:1）。
  - 长视频上传完成后 Celery 自动按 N 分钟切（与 chunk 解耦，segment 是逻辑单位，chunk 是物理单位）。
- **B4.2 分配 API**：先走 task 兼容入口 `POST /api/v1/tasks/{task_id}/video/segments/{sid}:claim` / `:release` / `:heartbeat`，长期补 `/api/v1/videos/{dataset_item_id}/segments/...` facade。
- **B4.3 Lock 协议**：进入工作台获取行级 `lock`，TTL 5 分钟，心跳续约；过期他人可抢。
- **B4.4 Annotation 表加 segment_id 索引**：导出按 segment 聚合，跨段合并按 frame_index 排序。
- **B4.5 Presence（轻量）**：Redis pub/sub 广播 `{dataset_item_id, segment_id, user_id, frame_index}`，WebSocket 推前端。不做实时编辑同步。

**衡量**：1 小时视频切 6 段，3 人并行标注，零冲突。

---

### B5 · AI Tracker 任务编排（**前端 R10 依赖**）

> 解决 G5。

- **B5.1 任务接口**：`POST /api/v1/tasks/{task_id}/video/tracks/{annotation_id}:propagate { from_frame, to_frame, model_key, direction, segment_id? }` 创建 tracker job，返回 `job_id`。
- **B5.2 流式输出**：第一版复用 Redis pub/sub + WebSocket 推送 `{ frame_index, geometry, confidence, outside }`，前端逐帧累加；SSE 可作为后续 facade。
- **B5.3 中断与续跑**：`DELETE /api/v1/video-tracker-jobs/{job_id}` 请求取消；中断后剩余区间标记为 "未传播"，前端 UI 可二次发起。
- **B5.4 模型适配层**：内部 `tracker_registry`，先支持 SAM 2 video predictor / Cutie / DEVA / 简单 KCF，统一 input: 起始帧 + bbox/mask + 帧范围；output: per-frame geometry + confidence + outside_flag。
  - 推理 worker 调 B3.4 拿帧，避免重复抽帧。
- **B5.5 GPU 队列**：单独 `gpu` Celery queue，按显存动态并发；失败重试 1 次后落 `failed` 状态，写入 V5 失败列表（共享 `2026-05-12-video-workbench-rendering-optimization.md` V5 重试 UI）。

**衡量**：30s / 30fps 视频，SAM 2 全段传播 P95 <30s。

---

### B6 · 协议与导出一致性（**贯穿**）

> 解决 G6。

- **状态（v0.9.25）**：B6.1 / B6.3 第一版已完成。manifest v2 暴露在 `/api/v1/tasks/{task_id}/video/manifest-v2` 与 `/api/v1/videos/{dataset_item_id}/manifest`；协议文档见 `docs-site/dev/reference/video-frame-service.md`。B6.2 rebuild 命令后续再补。

- **B6.1 manifest v2**：`/api/v1/tasks/{task_id}/video/manifest-v2` 与 `/api/v1/videos/{dataset_item_id}/manifest` 返回：
  ```jsonc
  {
    "video_url": "...",          // 原始整段，向后兼容
    "chunks_manifest_url": "...", // B2 chunk 列表
    "frame_timetable_url": "...", // B1 时间表
    "fps": 29.97,
    "total_frames": 1798,
    "duration_ms": 60003,
    "segments": [...],            // B4
    "frame_service_base": "/api/v1/tasks/{task_id}/video/frames"
  }
  ```
  旧 task manifest 保留至少 6 个月。
- **B6.2 导出帧号一致性**：导出走 B1 timetable，frame_index 与前端看到的一致；为旧任务建迁移命令 `python -m app.cli.video.rebuild-timetable`。
- **B6.3 协议文档**：写入 `docs-site/dev/reference/video-frame-service.md`，覆盖 timetable / chunk / frame / segment / tracker job 五个接口族。

---

### B7 · 观测与运维（**必做**）

- **状态（v0.9.25）**：B7 第一版已完成。新增 chunk / frame cache 指标、缓存 TTL 配置和 `docs-site/ops/runbooks/video-frame-service.md`；AI tracker GPU OOM runbook 内容等 B5 落地时补全。

- **B7.1 指标**：每个接口暴露 Prometheus metrics（QPS / P50/P95 / cache hit）。
- **B7.2 容量预算**：上线前算清 chunk 存储 = 原视频体积 × (1 + GOP 重编系数 ~0.3)；frame cache ~ 平均访问帧数 × 单帧 ~50KB。
- **B7.3 Runbook**：写到 `docs-site/ops/runbooks/video-frame-service.md`，覆盖：Celery 卡死、MinIO 空间满、chunk 切片失败、AI tracker GPU OOM 四个常见场景。

---

## 4. 当前基线与后续开发顺序

### 4.1 当前基线（截至 v0.9.28）

- **已落地**：B1 frame timetable、B2 chunk service、B3 frame cache、B4 segment 协同 MVP、B6 manifest v2 / 协议文档、B7 基础指标与 runbook。
- **仍需补齐**：B1 compact / 稀疏时间表、B2 GOP smart-copy、B3 poster / thumbnail 重试复用、B6.2 rebuild timetable 命令、B7 AI tracker GPU OOM runbook。
- **下一条主线**：先做 B4 segment 协同，再做 B5 AI tracker 编排。原因是 tracker 的流式输出、任务取消和结果落库都需要明确 frame range / segment 边界，否则会把多人协作与模型传播的冲突处理混在一起。

### 4.2 建议交付切片

| 切片 | 范围 | 交付 | 验证 |
| --- | --- | --- | --- |
| S1 · Segment 只读基线 | B4.0 Segment 只读基线 | `video_segments` 表、短视频默认 1 段、manifest v2 返回 `segments`、task / videos facade 查询接口 | **v0.9.28 已完成** |
| S2 · Segment 分配与锁 | B4.1 Segment 分配与锁 | segment claim / heartbeat / release API、TTL lock、权限与审计 | **v0.9.28 已完成第一版**；导出按 segment 聚合后续补 |
| S3 · Timetable / Frame Cache 补齐 | B6.2 + B3 补齐 | `python -m app.cli.video.rebuild_timetable`、poster / thumbnail 重试复用 B3、失败重试入口的后端 API | 旧视频 rebuild 测试、失败 frame cache 重试测试、docs-site build |
| S4 · Tracker Job 壳 | B5.0 Tracker job 壳 | `video_tracker_jobs` 或扩展 `prediction_jobs` 的决策落地、创建 / 查询 / 取消 job、Redis pub/sub 或 WS 事件通道 | job 状态机单测、取消幂等测试、OpenAPI 快照 |
| S5 · Tracker Adapter MVP | B5.1 Tracker adapter MVP | `tracker_registry`、先接一个最小 adapter（建议从 bbox propagation / KCF mock 起步，再接 SAM video）、逐帧结果写入 `video_track.outside` / prediction keyframes | adapter contract 单测、worker eager 集成测试、前端 R10 对接样例 |
| S6 · GPU / 模型深化 | B5.2 GPU / 模型深化 | SAM 2 / SAM 3 video predictor、GPU 队列容量控制、OOM runbook、长视频分段续跑 | GPU profile 手测、runbook 演练、端到端性能基准 |

### 4.3 B4 最小可用实现细化

**目标**：让后端先能表达"一条视频被切成多个可分配 frame range"，并且短视频不改变现有工作流。

- **数据模型**：新增 `VideoSegment(dataset_item_id, segment_index, start_frame, end_frame, assignee_id, status, locked_by, locked_at, lock_expires_at)`；`dataset_item_id + segment_index` 唯一；`dataset_item_id + start_frame + end_frame` 建索引。
- **生成策略**：probe / media 回填完成后按配置 `VIDEO_SEGMENT_SIZE_FRAMES` 生成；短视频或 metadata 未 ready 时懒生成单段；segment 与 chunk 解耦。
- **manifest v2**：新增 `segments: [{ id, segment_index, start_frame, end_frame, status, assignee_id, locked_by, lock_expires_at }]`，旧前端忽略该字段。
- **API**：先走 task 兼容入口：`GET /api/v1/tasks/{task_id}/video/segments`、`POST /segments/{segment_id}:claim`、`POST /segments/{segment_id}:heartbeat`、`POST /segments/{segment_id}:release`；长期 facade 再补 `/api/v1/videos/{dataset_item_id}/segments`。
- **权限**：复用任务可见性；annotator 只能 claim 未分配或分配给自己的 segment；project_admin / super_admin 可强制 release / reassign。
- **不做**：不拆 Task，不把 scheduler 改成 segment 调度器；第一版仍以 task 为入口，segment 只是 task 内部协作单位。

### 4.4 B5 最小可用实现细化

**目标**：先把 tracker 编排协议、job 状态机和事件流跑通，模型质量后置。

- **Job 模型选择**：优先新增 `VideoTrackerJob`，不要硬塞进现有 `PredictionJob`。现有 `prediction_jobs` 是批量预标注历史，字段强依赖 `project_id / batch_id / ml_backend_id / total_tasks`；tracker 是交互式、frame range、可取消、可流式，独立表能减少迁移风险。
- **状态机**：`queued -> running -> completed | failed | cancelled`；事件流包含 `job_started`、`frame_result`、`job_progress`、`job_completed`、`job_failed`、`job_cancelled`。
- **API**：`POST /api/v1/tasks/{task_id}/video/tracks/{annotation_id}:propagate` 创建 job；`GET /api/v1/video-tracker-jobs/{job_id}` 查询；`DELETE /api/v1/video-tracker-jobs/{job_id}` 取消；事件先复用 WebSocket / Redis pubsub，SSE 可后补。
- **输入契约**：`from_frame`、`to_frame`、`direction`、`model_key`、`prompt`（bbox / mask / point）、可选 `segment_id`。后端必须校验 frame range 不跨越用户无锁 segment。
- **输出契约**：逐帧输出 `{ frame_index, geometry, confidence, outside, source="prediction" }`；低置信度结果优先写 outside 段，不直接覆盖 manual keyframe。
- **模型 adapter**：`TrackerAdapter.propagate(ctx) -> Iterator[TrackerFrameResult]`；第一版允许 mock / KCF 作为 contract test，SAM video 接入遵循 ADR-0012 的独立 GPU service 原则。
- **取消**：API 写 `cancel_requested_at`，worker 每 N 帧检查一次；已产出的 prediction keyframes 保留，未完成区间不落库。

### 4.5 每次开发前的固定检查

1. 写实施 plan 到 `docs/plans/yyyy-mm-dd-<topic>.md`；如果实施时 release version 已确定，再使用 `docs/plans/yyyy-mm-dd-vx.y.z-<topic>.md`。
2. 对照 `docs-site/dev/reference/video-frame-service.md`、`docs-site/dev/reference/ml-backend-protocol.md`、`docs-site/ops/runbooks/video-frame-service.md` 判断是否同步。
3. 若改 API，运行 OpenAPI 导出并检查 `docs-site/api/` 生成物。
4. 若改 Celery media / tracker worker，开发环境只需重启 worker；改依赖 / Dockerfile 才 rebuild。
5. 验证至少覆盖：`pytest apps/api/tests/test_video_frame_service.py`、新增 segment / tracker 测试、`pytest apps/api/tests/test_alembic_drift.py`、`pnpm --filter @anno/docs-site build`。

---

## 5. 不做 / 暂缓

- **不引入新服务（如独立 video service）**：所有任务跑在现有 Celery worker，分队列即可。
- **不上 WebRTC / DASH / HLS**：复杂度远高于收益，对标注场景帧精度更重要。
- **不做实时编辑同步（OT / CRDT）**：与前端 R11 保持一致，行级锁足够。
- **不做端侧 GPU 推理**：所有 AI 走后端 GPU 队列。
- **不做视频转码到多分辨率（adaptive bitrate）**：标注场景只需要原画质 + chunk，不需要多档码率。

---

## 6. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| ffprobe 抽 frame 表对 1h 视频耗时 ~5min | probe 任务长 | B1 异步任务化，进度可见；前端用 v1 协议降级 |
| chunk 切片爆 MinIO | 存储成本上升 | GC 任务 + 容量预警；非热点视频走 cold storage |
| WebCodecs 浏览器矩阵 | Firefox 弱 | 前端 R5 自动降级到 video 标签 |
| AI tracker GPU 排队 | UX 卡顿 | 优先级队列 + 显示队列位置 |
| 旧 video / 旧 annotation 帧号不一致 | 数据迁移痛 | B6.2 提供 rebuild 命令；新接口与旧并存 |

---

## 7. 关联文档

- 前端：`ROADMAP/2026-05-12-video-workbench-rendering-optimization.md`（R5.3 / R10 / R11）
- 功能：`ROADMAP/2026-05-12-video-workbench-rendering-optimization.md`（V5 probe / poster 重试共享 B3）
- 协议文档：`docs-site/dev/reference/video-frame-service.md`
- 现有协议：`docs-site/dev/reference/ml-backend-protocol.md`（B5 需对齐）
- ADR：B4/B5 开发前补一份 `docs/adr/00xx-video-frame-service.md` 记录"为什么自建 chunk 而不用 HLS / 为什么 tracker job 独立于 prediction_jobs"
