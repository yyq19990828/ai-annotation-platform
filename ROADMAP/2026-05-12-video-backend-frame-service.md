# P1 · 视频后端帧服务 Epic

> 状态：**proposal（2026-05-12）**。承载前端 `2026-05-12-video-workbench-rendering-optimization.md` 中 R5.3 / R10 / R11 三块的服务端依赖。
>
> 当前后端只暴露单一 `manifest.video_url`，让浏览器自己用 `<video>` 解码。这对于短视频 + 单人 + 单段是够用的，但要支持：长视频（>10 分钟）、4K、多人协同、AI tracker 流式补帧、精确帧导航，必须把"帧"作为一等资源在后端暴露和缓存。
>
> 本 epic 是后端独立工程，不涉及前端 UI 改造（前端改造见 R5 / R8-R11）。后端仍属 FastAPI + Celery + PostgreSQL + MinIO/S3 现有栈，**不引入新服务**。

---

## 1. 现状盘点

### 1.1 后端视频处理（apps/api/app/）

- 上传走 `/uploads`，存储到 MinIO/S3。
- `probe` 任务（Celery）：用 ffprobe 抽 fps / duration / 总帧数 / codec，结果写入 `Video.metadata`。
- `poster` 任务：抽首帧 / 中间帧做封面，输出到 storage。
- 标注落地：`Annotation` 表，按 `video_id + frame_index` 索引；`video_track` 用 JSON 字段存 keyframes。
- 协议：`/api/videos/{id}/manifest` 返回 `{ video_url, fps, total_frames, duration, poster_url }`。

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
- **G5 AI 推理桥**：模型推理任务能直接拿 `(video_id, frame_index)` 取帧，不重复抽帧。
- **G6 协议向后兼容**：旧 manifest 接口保留；新接口走 `/v2/videos/...` 或加 query flag。

---

## 3. 任务分解

### B1 · 帧时间表 `frame_timetable`（**必做，基础**）

> 解决 G1。前端 R1.2 直接依赖这个接口。

- **状态（v0.9.21）**：B1 第一版已完成。当前按 `DatasetItem` 存 `video_frame_indices(dataset_item_id, frame_index, pts_ms, is_keyframe, pict_type, byte_offset)`，并通过任务路由暴露；compact/ETag/稀疏长视频策略后续再补。
- **B1.1 probe 任务增强**：用 `ffprobe -show_frames -select_streams v -of json` 抽每一帧的 `pkt_pts_time`、`pict_type`、`key_frame` 标记，存到 `VideoFrameIndex` 表（`video_id, frame_index, pts, dts, is_keyframe, byte_offset`）。
  - v0.9.21 先对 probe 成功的视频全量存表；长视频稀疏采样（每 N 帧一行）后续再补。
  - I/B/P 帧分布在导出时也有用（避免在 B 帧上做精确 seek）。
- **B1.2 接口**：`GET /api/v1/tasks/{task_id}/video/frame-timetable?from=&to=` 返回 JSON 帧表；无表时返回 `source="estimated"` 和空 `frames`。
- **B1.3 ETag + Cache-Control**：内容只读不变，强缓存。（未完成）

**衡量**：1 小时 30fps 视频 timetable 压缩后 <500KB。

---

### B2 · Chunk 切片服务（**核心，前端 R5.3 依赖**）

> 解决 G2。对标 CVAT 的 chunk 概念。

- **B2.1 切片策略**：
  - 单位：默认每 chunk = 60 帧（30fps 即 2 秒），可配置。
  - 编码：原始视频如果是 H.264 / H.265 且 GOP 对齐良好，按 GOP 切分（无重编码，速度快）；否则后台 Celery 重编 H.264 baseline + 短 GOP（每 30 帧 1 keyframe）。
  - 容器：`.mp4` fragmented 形式，方便 MSE / WebCodecs 直接吃。
- **B2.2 存储布局**：`s3://annotation/videos/{video_id}/chunks/{chunk_id}.mp4`，索引表 `VideoChunk(video_id, chunk_id, start_frame, end_frame, byte_size, url, ready)`。
- **B2.3 懒切片**：首次访问触发 Celery，未 ready 时返回 202 + Retry-After；同时 fallback 到原始 `video_url`（前端 R5 自动降级）。
- **B2.4 接口**：
  - `GET /api/videos/{id}/chunks?from_frame=&to_frame=` 返回 chunk 列表 + 签名 URL。
  - `GET /api/videos/{id}/chunks/{chunk_id}` 重定向到 MinIO 预签名 URL（含 Range 支持）。
- **B2.5 GC**：长时间未访问的 chunk 删除，下次再生（标记表里只置 `ready=false`，不删元数据）。

**衡量**：1080p / 30fps / 1 小时视频，chunk 总数 ~1800，单 chunk <2MB，HTTP Range 命中率 >90%。

---

### B3 · 帧抽取与缓存服务（**配套，AI 与 thumbnail 共享**）

> 解决 G3 / G5。

- **B3.1 单帧接口**：`GET /api/videos/{id}/frames/{frame_index}?format=jpeg|webp&w=` 返回静态图。
  - 实现：先查 MinIO `s3://.../frames/{frame_index}_{w}.webp`，未命中走 Celery（`ffmpeg -ss <pts> -frames:v 1`），缓存后返回。
  - 用 PTS（B1 输出）而非 `frame / fps`，避免浮点误差。
- **B3.2 LRU + TTL**：MinIO 上没有原生 LRU，写一个轻量 housekeeping 任务（Celery beat 每天扫描 `last_accessed_at`，淘汰超时 + 容量），元数据存到 `VideoFrameCache` 表。
- **B3.3 批量预取**：`POST /api/videos/{id}/frames:prefetch { frame_indices: [...] }`，前端 R5.1 / R5.2 可主动 hint。
- **B3.4 AI 推理钩子**：内部 Python API `frame_service.get_frame_array(video_id, frame_index) -> np.ndarray`，模型 worker 直接调用，与 HTTP 层共享同一缓存（避免双倍抽帧）。

**衡量**：thumbnail / poster / AI / 前端预取，**任何一处缺帧时一次抽帧、四处复用**。

---

### B4 · Segment 与协同（**前端 R11 依赖**）

> 解决 G4。

- **B4.1 Segment 模型**：`VideoSegment(id, video_id, start_frame, end_frame, assignee_id, status, locked_by, locked_at)`。
  - 短视频默认 1 segment（与 video 1:1）。
  - 长视频上传完成后 Celery 自动按 N 分钟切（与 chunk 解耦，segment 是逻辑单位，chunk 是物理单位）。
- **B4.2 分配 API**：`POST /api/videos/{id}/segments/{sid}:assign { user_id }`、`POST /.../release`。
- **B4.3 Lock 协议**：进入工作台获取行级 `lock`，TTL 5 分钟，心跳续约；过期他人可抢。
- **B4.4 Annotation 表加 segment_id 索引**：导出按 segment 聚合，跨段合并按 frame_index 排序。
- **B4.5 Presence（轻量）**：Redis pub/sub 广播 `{video_id, segment_id, user_id, frame_index}`，WebSocket 推前端。不做实时编辑同步。

**衡量**：1 小时视频切 6 段，3 人并行标注，零冲突。

---

### B5 · AI Tracker 任务编排（**前端 R10 依赖**）

> 解决 G5。

- **B5.1 任务接口**：`POST /api/videos/{id}/tracks/{tid}/propagate { from_frame, to_frame, model, direction }` 创建 Celery job，返回 `job_id`。
- **B5.2 流式输出**：SSE `GET /api/jobs/{job_id}/events` 推送 `{ frame_index, geometry, confidence }`，前端逐帧累加。
- **B5.3 中断与续跑**：`DELETE /api/jobs/{job_id}` 立即停；中断后剩余区间标记为 "未传播"，前端 UI 可二次发起。
- **B5.4 模型适配层**：内部 `tracker_registry`，先支持 SAM 2 video predictor / Cutie / DEVA / 简单 KCF，统一 input: 起始帧 + bbox/mask + 帧范围；output: per-frame geometry + confidence + outside_flag。
  - 推理 worker 调 B3.4 拿帧，避免重复抽帧。
- **B5.5 GPU 队列**：单独 `gpu` Celery queue，按显存动态并发；失败重试 1 次后落 `failed` 状态，写入 V5 失败列表（共享 `2026-05-12-video-workbench-rendering-optimization.md` V5 重试 UI）。

**衡量**：30s / 30fps 视频，SAM 2 全段传播 P95 <30s。

---

### B6 · 协议与导出一致性（**贯穿**）

> 解决 G6。

- **B6.1 manifest v2**：`/api/v2/videos/{id}/manifest` 返回：
  ```jsonc
  {
    "video_url": "...",          // 原始整段，向后兼容
    "chunks_manifest_url": "...", // B2 chunk 列表
    "frame_timetable_url": "...", // B1 时间表
    "fps": 29.97,
    "total_frames": 1798,
    "duration_ms": 60003,
    "segments": [...],            // B4
    "frame_service_base": "/api/videos/{id}/frames"
  }
  ```
  v1 保留至少 6 个月。
- **B6.2 导出帧号一致性**：导出走 B1 timetable，frame_index 与前端看到的一致；为旧任务建迁移命令 `python -m app.cli.video.rebuild-timetable`。
- **B6.3 协议文档**：写入 `docs-site/dev/reference/video-frame-service.md`，覆盖 timetable / chunk / frame / segment / tracker job 五个接口族。

---

### B7 · 观测与运维（**必做**）

- **B7.1 指标**：每个接口暴露 Prometheus metrics（QPS / P50/P95 / cache hit）。
- **B7.2 容量预算**：上线前算清 chunk 存储 = 原视频体积 × (1 + GOP 重编系数 ~0.3)；frame cache ~ 平均访问帧数 × 单帧 ~50KB。
- **B7.3 Runbook**：写到 `docs-site/ops/runbooks/video-frame-service.md`，覆盖：Celery 卡死、MinIO 空间满、chunk 切片失败、AI tracker GPU OOM 四个常见场景。

---

## 4. 优先级与建议顺序

```
Wave A · 与前端 Wave 1-2 并行
  B1 frame_timetable (1 周, 与前端 R1 同步上线)
  B7 监控接入 (随时)

Wave B · 与前端 Wave 3 配套
  B2 chunk 切片服务 (2-3 周)
  B3 帧抽取与缓存 (1-2 周, 与 B2 并行)
  B6 manifest v2 (1 周)

Wave C · 与前端 Wave 5 同步
  B4 segment 协同 (2 周)
  B5 AI tracker 编排 (3-4 周, 依赖模型评估)
```

- B1 单独可以先做，立刻解决帧号漂移这一最痛点。
- B2 + B3 是双胞胎，最好同期做（共享 ffmpeg 调用层）。
- B4 + B5 必须先与前端 R10 / R11 对齐协议再动工。

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
- 协议文档（待写）：`docs-site/dev/reference/video-frame-service.md`
- 现有协议：`docs-site/dev/reference/ml-backend-protocol.md`（B5 需对齐）
- ADR：上线前补一份 `docs/adr/00xx-video-frame-service.md` 记录"为什么自建 chunk 而不用 HLS"
