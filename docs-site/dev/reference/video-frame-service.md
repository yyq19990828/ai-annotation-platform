---
audience: [dev, ops]
type: reference
since: v0.9.25
status: stable
last_reviewed: 2026-05-21
---

# 视频后端帧服务

v0.9.25 把视频帧作为后端一等资源暴露，服务于长视频 chunk 拉取、单帧 thumbnail / AI 推理复用，以及 manifest v2。旧的 `GET /api/v1/tasks/{task_id}/video/manifest` 保持不变。

## 资源模型

- 物理视频仍是 `DatasetItem(file_type="video")`。
- `VideoFrameIndex` 保存 B1 生成的 `frame_index -> pts_ms` 时间表。
- `VideoChunk` 保存 chunk 元数据和 MinIO key。
- `VideoFrameCache` 保存单帧 WebP/JPEG 缓存元数据和 MinIO key。
- `VideoSegment` 保存视频内可分配 frame range、assignee 和短 TTL lock。
- `VideoTrackerJob` 保存交互式视频 tracker 的 job 状态、frame range、输入 prompt 和取消请求。
- `/api/v1/tasks/{task_id}/video/...` 是现有前端兼容入口。
- `/api/v1/videos/{dataset_item_id}/...` 是长期 facade；服务端必须找到当前用户可见的 video task，否则返回 404。

## Manifest v2

```http
GET /api/v1/tasks/{task_id}/video/manifest-v2
GET /api/v1/videos/{dataset_item_id}/manifest
```

响应包含：

- `video_url`：原始或转码后的整段视频 signed URL。
- `chunks_manifest_url`：chunk 列表入口。
- `frame_timetable_url`：帧时间表入口。
- `frame_service_base`：单帧接口前缀。
- `chunk_size_frames`：当前后端 chunk 粒度。
- `segments`：视频协作段列表；旧前端可忽略。

## Chunk

```http
GET /api/v1/tasks/{task_id}/video/chunks?from_frame=0&to_frame=120
GET /api/v1/videos/{dataset_item_id}/chunks?from_frame=0&to_frame=120
GET /api/v1/tasks/{task_id}/video/chunks/{chunk_id}
GET /api/v1/videos/{dataset_item_id}/chunks/{chunk_id}
```

首次请求缺失 chunk 时，API 创建 `VideoChunk(status="pending")` 并投递 `ensure_video_chunks` Celery 任务。单 chunk 未 ready 时返回 HTTP 202 和 `Retry-After`；ready 后返回 signed URL。

v0.9.38 起，media worker 会在源 codec 为 H.264 / H.265 且 chunk 起始帧 keyframe 对齐时优先尝试 ffmpeg stream copy；不满足条件或 smart-copy 失败时，自动 fallback 到既有 H.264 baseline fragmented MP4 重编码。API 行为保持兼容，只额外返回诊断字段：

```json
{
  "generation_mode": "smart_copy",
  "diagnostics": {
    "source_codec": "h264",
    "output_codec": "h264",
    "keyframe_aligned": true,
    "start_byte_offset": 100,
    "end_byte_offset": 9000,
    "smart_copy_eligible": true,
    "fallback_reason": null
  }
}
```

前端可用这些字段判断 WebCodecs / Worker 解码是否继续使用 chunk，或降级到整段视频 / frame service。

### Sample manifest（WebCodecs demux，v0.10.46）

chunk 生成时，media worker 会用 `ffprobe -show_packets` 扫一遍生成出的 chunk mp4，把每个 packet 的字节偏移 / 大小 / 时间戳 / 关键帧标记写进 `diagnostics["samples"]`（同时写 `codec_string` / `width` / `height`）。扫包失败（如 fragmented mp4 的 `pos` 缺失）时静默跳过，不影响 chunk 生成。

```http
GET /api/v1/videos/{dataset_item_id}/chunks/{chunk_id}/samples
```

返回 sample manifest；旧 chunk（`diagnostics` 无 `samples`）返回 404 `samples_not_available`。响应示例：

```json
{
  "dataset_item_id": "…",
  "chunk_id": 0,
  "codec_string": "avc1.4d001e",
  "width": 1920,
  "height": 1080,
  "samples": [
    { "frame_index": 0, "pts_ms": 0, "duration_ms": 33, "is_keyframe": true, "size_bytes": 45123, "offset_in_chunk": 1024 }
  ]
}
```

`samples` 数组按解码顺序排列（满足 `VideoDecoder` 喂入要求），`frame_index` 按 pts 展示顺序（presentation rank）+ chunk `start_frame` 推算。前端实验 flag `?webcodecs=1`（或 localStorage `video.experimental.webcodecs`，默认关闭）开启时，`VideoStage` 按当前帧定位 chunk → 拉 samples → 从 chunk 字节切出「最近关键帧 → 目标帧」的 GOP → 构造 `EncodedVideoChunk[]` 交给 `useVideoChunkDecoder` 精确解码；找不到帧或解码失败时降级回 `<video>` 位图缓存。

manifest 还带 `description`（base64）：后端直读 chunk mp4 的 `avcC`/`hvcC` box，取出 `AVC/HEVCDecoderConfigurationRecord`（含 SPS/PPS），前端解码后填入 `VideoDecoderConfig.description`；`codec_string` 也由该 record 的字节派生（`avc1.PPCCLL` / `hvc1.…`），不再硬编码。这两项是 AVCC 长度前缀样本能被 `VideoDecoder` 正确解码的前提——缺 `description` 时浏览器按 Annex-B 解析必失败。旧 chunk（`diagnostics` 无 `description`）则降级。

MinIO key：

```text
videos/{dataset_item_id}/chunks/{chunk_id}.mp4
```

### Chunk warmup（v0.10.29）

`list_chunks` / `get_chunk` 命中某些 chunk 后，会向后 look-ahead 预解码相邻 chunk（逐帧导航多为向前推进），减少后续等待。受 `VIDEO_CHUNK_WARMUP_LOOKAHEAD` 控制（默认 1，设 0 关闭）。warmup 保守降级：只对**还没 ready 且没在 pending 进行中**的相邻 chunk 投递 `ensure_video_chunks`，不重复投递、不阻塞主请求。纯选择逻辑见 `video_frame_service.warmup_chunk_ids`。

## 单帧缓存

```http
GET /api/v1/tasks/{task_id}/video/frames/{frame_index}?format=webp&w=512
POST /api/v1/tasks/{task_id}/video/frames:prefetch
POST /api/v1/tasks/{task_id}/video/frames:retry
GET /api/v1/videos/{dataset_item_id}/frames/{frame_index}?format=jpeg&w=320
POST /api/v1/videos/{dataset_item_id}/frames:prefetch
POST /api/v1/videos/{dataset_item_id}/frames:retry
```

缓存命中返回 `status="ready"` 和 signed URL；未命中创建 `VideoFrameCache(status="pending")`，投递 `extract_video_frames`，并返回 HTTP 202。抽帧优先使用 B1 的 `pts_ms`，旧视频缺 timetable 时按 `fps` 估算。

`frames:retry` 默认只重投 `status="failed"` 的缓存行；传入 `frame_indices` 时只处理这些帧，未传时最多处理当前 `width + format` 下 500 条失败行。`force=true` 会重置指定帧的 storage key / byte size 并重新投递，适合源视频修复后刷新坏缓存。

MinIO key：

```text
videos/{dataset_item_id}/frames/{frame_index}_{width}.{format}
```

视频 metadata 任务生成 poster 时也写入同一套缓存：`frame_index=0,width=512,format=webp`。因此 `DatasetItem.thumbnail_path` 与 `metadata.video.poster_frame_path` 会指向 `videos/{dataset_item_id}/frames/0_512.webp`。

内部 AI worker 可调用 `app.services.video_frame_service.get_frame_array()` 读取已缓存帧，进程内 LRU 上限由 `VIDEO_FRAME_MEMORY_CACHE_ITEMS` 控制。

## 失败资产与重试

v0.9.33 起，管理侧通过存储 API 汇总视频资产失败状态：

```http
GET /api/v1/storage/video-assets/failures
POST /api/v1/storage/video-assets/retry
```

失败列表覆盖五类资产：

| asset_type | 来源 | 重试任务 |
|---|---|---|
| `probe` | `dataset_items.metadata["video"]["probe_error"]` | `generate_video_metadata` |
| `poster` | `dataset_items.metadata["video"]["poster_error"]` | `generate_video_metadata` |
| `frame_timetable` | `dataset_items.metadata["video"]["frame_timetable_error"]` | `generate_video_metadata` |
| `chunk` | `video_chunks.status = "failed"` | `ensure_video_chunks` |
| `frame` | `video_frame_cache.status = "failed"` | `extract_video_frames` |

`probe` / `poster` / `frame_timetable` 共用 metadata 任务，因此重试任一项都会重新跑视频 metadata 生成链路。`chunk` / `frame` 重试会先把对应行恢复到 `pending` 并清空 `error`，再投递 media 队列。

chunk 重试会清空旧的 `generation_mode` / `diagnostics`，下一次 worker 会重新判断 smart-copy eligibility。

## Timetable 重建

旧视频或 probe 异常视频可重建 B1 帧时间表：

```bash
cd apps/api
uv run python -m app.cli.video.rebuild_timetable --dataset-item-id <uuid>
uv run python -m app.cli.video.rebuild_timetable --dataset-id <uuid> --keep-going
uv run python -m app.cli.video.rebuild_timetable --all --limit 100
```

命令会下载源视频或 playback 视频，调用 `ffprobe -show_frames`，替换该视频的 `video_frame_indices` 行，并更新 `metadata.video.frame_timetable_frame_count`。失败时写入 `metadata.video.frame_timetable_error`。

### Sparse timetable（长视频，v0.10.29）

超长视频不必给每帧都存一行 `VideoFrameIndex`。`--sparse-stride <N>`（默认 1 = 全帧）让重建只持久化**锚点子集**：`select_sparse_anchor_rows` 取「stride 网格上的帧 ∪ 所有关键帧」（保留关键帧使 chunk smart-copy 的 keyframe 对齐判定不退化）。锚点仍写进现有 `video_frame_indices`，**不新增表**。

读取时 `frame_index → pts_ms` 对外语义不变：命中锚点用 DB 真值，否则由相邻锚点线性插值、范围外按 fps 外推（纯函数 `resolve_pts_ms_sparse`）。`frame_timetable_frame_count` 仍记源视频总帧数。旧的全帧 timetable 视频零行为变化。

### 帧采样网格 helper（v0.10.29）

项目级 `Project.video_sampling`（`{mode: none|fps|step, target_fps?, frame_step?}`）只约束**标注导航/打点网格**，不改 `VideoFrameIndex`、不生成新资产（决策 D1）；标注 geometry 的 `frame_index` 永远是源视频帧号（决策 D2）。后端 `video_frame_service` 提供与前端共用的纯函数：`derive_step(source_fps, sampling)` 派生步长、`derive_sampled_frames(frame_count, step)` 给出绝对网格（锚定 0：`[0, step, 2*step, …]`）。导出按采样网格重编号；MOT / KITTI / `yolo-frames-det` 都只输出网格帧，其中 `yolo-frames-det` 会把 `video_bbox` 与摊平后的 `video_track` 写成逐帧检测 label。逐帧导航语义见标注员手册「帧采样与软网格导航」。

## Segment 协同

```http
GET /api/v1/tasks/{task_id}/video/segments
GET /api/v1/videos/{dataset_item_id}/segments
POST /api/v1/tasks/{task_id}/video/segments/{segment_id}:claim
POST /api/v1/tasks/{task_id}/video/segments/{segment_id}:heartbeat
POST /api/v1/tasks/{task_id}/video/segments/{segment_id}:release
```

首次访问 manifest 或 segments 列表时，后端按 `VIDEO_SEGMENT_SIZE_FRAMES` 懒生成 `VideoSegment`。短视频默认单段；segment 是协作单位，chunk 仍是物理缓存单位，两者不要求对齐。

`claim` 会把未分配 segment 分配给当前用户并设置 `locked_by / lock_expires_at`。标注员只能 claim 未分配或分配给自己的 segment；锁未过期时其他非管理员用户 claim 返回 409。`heartbeat` 续约锁；`release` 释放锁但保留 assignee，方便用户稍后继续该段。

## Tracker Job

```http
POST /api/v1/tasks/{task_id}/video/tracks/{annotation_id}:propagate
GET /api/v1/video-tracker-jobs/{job_id}
DELETE /api/v1/video-tracker-jobs/{job_id}
```

v0.9.34 起，创建 job 后会投递 `app.workers.video_tracker.run_video_tracker_job`。v0.9.36 支持三类 `model_key`：

| model_key | 用途 |
|---|---|
| `mock_bbox` | 无 GPU contract adapter，复用输入 bbox 逐帧输出，供 CI / 前端对接使用。 |
| `sam2_video` | 调项目绑定的 connected ML Backend，发送 `context.type="video_tracker"`。 |
| `sam3_video` | 与 `sam2_video` 相同协议，供 v0.10.x SAM 3 backend 并存接入。 |

创建请求：

```json
{
  "from_frame": 0,
  "to_frame": 120,
  "model_key": "sam2_video",
  "direction": "forward",
  "segment_id": "optional-segment-uuid",
  "prompt": { "type": "bbox", "geometry": {} }
}
```

后端校验：

- task 必须是当前用户可见的视频 task。
- `annotation_id` 必须属于该 task 且未删除。
- `from_frame/to_frame` 必须在视频帧范围内，且不能反向。
- 非管理员用户必须先持有覆盖该 frame range 的有效 segment lock；跨 segment 请求会被拒绝。

响应中的 `event_channel` 形如 `video-tracker-job:{job_id}`。前端可订阅：

```http
WS /api/v1/ws/video-tracker-jobs/{job_id}?token=<access-token>
```

事件类型：

- `job_started`
- `frame_result`：`{ frame_index, geometry, confidence, outside, source }`
- `job_progress`：`{ current, total }`
- `job_completed`
- `job_failed`
- `job_cancelled`

当前状态机为 `queued -> running -> completed | failed | cancelled`；`DELETE` 对 queued/running job 标记 `cancel_requested_at` 并进入 `cancelled`，对 terminal job 幂等返回当前状态。worker 会保留人工 `video_track` keyframe，不用 prediction keyframe 覆盖 manual 结果。

SAM video adapter 会调用项目绑定的 ML Backend `/predict`：

```json
{
  "task": {
    "id": "<task_id>",
    "file_path": "<signed-video-url>",
    "dataset_item_id": "<dataset_item_id>",
    "file_name": "clip.mp4",
    "file_type": "video"
  },
  "context": {
    "type": "video_tracker",
    "model_key": "sam2_video",
    "job_id": "<job_id>",
    "task_id": "<task_id>",
    "project_id": "<project_id>",
    "dataset_item_id": "<dataset_item_id>",
    "annotation_id": "<annotation_id>",
    "from_frame": 0,
    "to_frame": 299,
    "direction": "forward",
    "prompt": { "type": "bbox", "geometry": {} },
    "source_geometry": {}
  }
}
```

Backend 响应沿用交互式 `/predict` 响应，其中 `result` 是逐帧数组：

```json
{
  "result": [
    {
      "frame_index": 1,
      "geometry": { "type": "bbox", "x": 10, "y": 20, "w": 40, "h": 50 },
      "confidence": 0.91,
      "outside": false
    }
  ]
}
```

长区间会按 `VIDEO_TRACKER_WINDOW_SIZE_FRAMES` 分窗多次调用 backend；整体 job 仍只发布同一个事件流。`confidence` 低于 `VIDEO_TRACKER_LOW_CONFIDENCE_OUTSIDE_THRESHOLD` 的结果会按 outside prediction range 写回，不生成 prediction keyframe。

## 配置与指标

| 配置 | 默认值 | 用途 |
|---|---:|---|
| `VIDEO_CHUNK_SIZE_FRAMES` | 60 | chunk 帧数 |
| `VIDEO_CHUNK_WARMUP_LOOKAHEAD` | 1 | chunk warmup look-ahead，命中 chunk N 时顺带预解码 N+1..N+K；设 0 关闭 |
| `VIDEO_FRAME_CACHE_TTL_DAYS` | 14 | 单帧缓存 TTL |
| `VIDEO_CHUNK_CACHE_TTL_DAYS` | 30 | chunk 缓存 TTL |
| `VIDEO_FRAME_MEMORY_CACHE_ITEMS` | 64 | 进程内 frame array LRU 上限 |
| `VIDEO_SEGMENT_SIZE_FRAMES` | 18000 | 协作 segment 帧数 |
| `VIDEO_SEGMENT_LOCK_TTL_SECONDS` | 300 | segment lock 心跳 TTL |
| `VIDEO_TRACKER_WINDOW_SIZE_FRAMES` | 300 | tracker 调 ML Backend 的单次 frame window 上限 |
| `VIDEO_TRACKER_LOW_CONFIDENCE_OUTSIDE_THRESHOLD` | 0.15 | 低置信度 tracker 结果写 outside 的阈值 |

Celery route：

- `app.workers.video_tracker.run_video_tracker_job` -> `gpu` queue

Prometheus 指标：

- `video_chunk_requests_total{status}`
- `video_chunk_generation_seconds{outcome}`
- `video_frame_cache_total{result,format}`
- `video_frame_extraction_seconds{outcome,format}`
- `video_frame_asset_bytes{asset_type}`

## 运维注意

修改 `apps/api/app/workers/media.py` 或 `apps/api/app/workers/video_tracker.py` 后必须重启 Celery worker；修改依赖或 Dockerfile 后需要 rebuild API/Celery 镜像。开发环境 worker 需要订阅 `gpu` 队列。
