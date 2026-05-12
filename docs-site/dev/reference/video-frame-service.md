---
audience: [dev, ops]
type: reference
since: v0.9.25
status: stable
last_reviewed: 2026-05-12
---

# 视频后端帧服务

v0.9.25 把视频帧作为后端一等资源暴露，服务于长视频 chunk 拉取、单帧 thumbnail / AI 推理复用，以及 manifest v2。旧的 `GET /api/v1/tasks/{task_id}/video/manifest` 保持不变。

## 资源模型

- 物理视频仍是 `DatasetItem(file_type="video")`。
- `VideoFrameIndex` 保存 B1 生成的 `frame_index -> pts_ms` 时间表。
- `VideoChunk` 保存 chunk 元数据和 MinIO key。
- `VideoFrameCache` 保存单帧 WebP/JPEG 缓存元数据和 MinIO key。
- `VideoSegment` 保存视频内可分配 frame range、assignee 和短 TTL lock。
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

首次请求缺失 chunk 时，API 创建 `VideoChunk(status="pending")` 并投递 `ensure_video_chunks` Celery 任务。单 chunk 未 ready 时返回 HTTP 202 和 `Retry-After`；ready 后返回 signed URL。第一版 chunk 使用 H.264 baseline fragmented MP4 重编码，后续再补 GOP smart-copy。

MinIO key：

```text
videos/{dataset_item_id}/chunks/{chunk_id}.mp4
```

## 单帧缓存

```http
GET /api/v1/tasks/{task_id}/video/frames/{frame_index}?format=webp&w=512
POST /api/v1/tasks/{task_id}/video/frames:prefetch
GET /api/v1/videos/{dataset_item_id}/frames/{frame_index}?format=jpeg&w=320
POST /api/v1/videos/{dataset_item_id}/frames:prefetch
```

缓存命中返回 `status="ready"` 和 signed URL；未命中创建 `VideoFrameCache(status="pending")`，投递 `extract_video_frames`，并返回 HTTP 202。抽帧优先使用 B1 的 `pts_ms`，旧视频缺 timetable 时按 `fps` 估算。

MinIO key：

```text
videos/{dataset_item_id}/frames/{frame_index}_{width}.{format}
```

内部 AI worker 可调用 `app.services.video_frame_service.get_frame_array()` 读取已缓存帧，进程内 LRU 上限由 `VIDEO_FRAME_MEMORY_CACHE_ITEMS` 控制。

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

## 配置与指标

| 配置 | 默认值 | 用途 |
|---|---:|---|
| `VIDEO_CHUNK_SIZE_FRAMES` | 60 | chunk 帧数 |
| `VIDEO_FRAME_CACHE_TTL_DAYS` | 14 | 单帧缓存 TTL |
| `VIDEO_CHUNK_CACHE_TTL_DAYS` | 30 | chunk 缓存 TTL |
| `VIDEO_FRAME_MEMORY_CACHE_ITEMS` | 64 | 进程内 frame array LRU 上限 |
| `VIDEO_SEGMENT_SIZE_FRAMES` | 18000 | 协作 segment 帧数 |
| `VIDEO_SEGMENT_LOCK_TTL_SECONDS` | 300 | segment lock 心跳 TTL |

Prometheus 指标：

- `video_chunk_requests_total{status}`
- `video_chunk_generation_seconds{outcome}`
- `video_frame_cache_total{result,format}`
- `video_frame_extraction_seconds{outcome,format}`
- `video_frame_asset_bytes{asset_type}`

## 运维注意

修改 `apps/api/app/workers/media.py` 后必须重启 Celery worker；修改依赖或 Dockerfile 后需要 rebuild API/Celery 镜像。
