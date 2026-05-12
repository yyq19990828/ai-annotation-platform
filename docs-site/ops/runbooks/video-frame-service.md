---
title: Runbook：视频帧服务
audience: [ops]
type: how-to
since: v0.9.25
status: stable
last_reviewed: 2026-05-12
---

# Runbook：视频帧服务

## 症状

- 视频 chunk 或单帧接口持续返回 202。
- 时间轴 hover / 预取图片一直不可用。
- segment claim 后很快丢锁，或同一段持续显示被他人占用。
- tracker job 长时间 queued/running，或前端收不到逐帧事件。
- MinIO 空间增长明显。
- Celery media 队列积压。

## 快速诊断

```bash
docker logs ai-annotation-platform-celery-worker-1 --tail 100
docker exec ai-annotation-platform-redis-1 redis-cli llen media
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT status, count(*) FROM video_chunks GROUP BY status;"
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT status, count(*) FROM video_frame_cache GROUP BY status;"
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT status, count(*) FROM video_segments GROUP BY status;"
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT status, count(*) FROM video_tracker_jobs GROUP BY status;"
```

## Chunk 一直 pending

1. 查看 worker 日志里是否有 `ffmpeg chunk extraction failed`。
2. 确认运行容器内存在 ffmpeg：

```bash
docker exec ai-annotation-platform-celery-worker-1 ffmpeg -version
```

3. 如果刚改过 `apps/api/app/workers/media.py`，重启 worker：

```bash
docker compose restart celery-worker
```

4. 如果改过依赖、Dockerfile 或 `pyproject.toml`，rebuild：

```bash
docker compose build celery-worker
docker compose up -d celery-worker
```

## 单帧缓存失败

查看失败原因：

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT frame_index, width, format, error FROM video_frame_cache WHERE status='failed' ORDER BY updated_at DESC LIMIT 20;"
```

常见原因：

- 源视频对象不存在：检查 `dataset_items.file_path` 和 MinIO。
- 视频 metadata 未生成：重新触发媒体回填。
- ffmpeg 超时：先确认视频是否损坏或码流异常。

修复源视频或 metadata 后，可通过 API 重投失败帧：

```bash
curl -X POST "$API/api/v1/tasks/$TASK_ID/video/frames:retry" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"width":512,"format":"webp"}'
```

只刷新指定帧并丢弃旧缓存：

```bash
curl -X POST "$API/api/v1/videos/$DATASET_ITEM_ID/frames:retry" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"frame_indices":[0,30,60],"width":512,"format":"webp","force":true}'
```

## 帧时间表缺失或漂移

先确认该视频是否有 B1 表：

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT count(*) FROM video_frame_indices WHERE dataset_item_id = '<dataset_item_id>';"
```

旧视频可在 API/Celery 镜像内重建：

```bash
docker exec ai-annotation-platform-api-1 \
  python -m app.cli.video.rebuild_timetable --dataset-item-id <dataset_item_id>
```

批量数据集重建建议加 `--keep-going`，避免单个损坏视频阻断整批：

```bash
docker exec ai-annotation-platform-api-1 \
  python -m app.cli.video.rebuild_timetable --dataset-id <dataset_id> --keep-going
```

## MinIO 空间增长

视频帧服务通过 Celery beat 每天清理未访问缓存。先确认 beat 正常：

```bash
docker logs ai-annotation-platform-celery-beat-1 --tail 100
```

临时降低 TTL 可设置：

```env
VIDEO_FRAME_CACHE_TTL_DAYS=7
VIDEO_CHUNK_CACHE_TTL_DAYS=14
```

更新 env 后执行：

```bash
docker compose up -d celery-worker celery-beat
```

## Segment 锁异常

查看当前锁：

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT id, dataset_item_id, segment_index, assignee_id, locked_by, lock_expires_at FROM video_segments WHERE locked_by IS NOT NULL ORDER BY lock_expires_at DESC LIMIT 20;"
```

常见原因：

- 前端未按 TTL 发送 heartbeat：检查 `VIDEO_SEGMENT_LOCK_TTL_SECONDS` 和浏览器网络请求。
- 用户异常退出后锁未过期：等待 TTL 到期，或由项目管理员调用 release 接口释放。
- segment 切分过粗：降低 `VIDEO_SEGMENT_SIZE_FRAMES` 后，新视频会按更小粒度生成；已有 segment 需人工迁移或重建。

## Tracker Job 无法创建或取消

查看最近 job：

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT id, task_id, annotation_id, segment_id, status, from_frame, to_frame, cancel_requested_at FROM video_tracker_jobs ORDER BY created_at DESC LIMIT 20;"
```

常见原因：

- 返回 409：当前用户没有持有覆盖 frame range 的有效 segment lock。先调用 segment claim，再发起 tracker job。
- 返回 400：frame range 越界、反向，或跨越多个 segment。第一版要求单 job 在一个 segment 内。
- job 长时间停留 `queued`：确认 worker 订阅了 `gpu` 队列。开发 compose 默认命令应包含 `-Q default,ml,media,gpu`。
- job 进入 `failed`：查看 `error_message`。`Unsupported tracker model` 通常表示前端传了后端 registry 尚未支持的 `model_key`；`sam2_video` / `sam3_video` 需要项目绑定的 ML Backend 处于 `connected`。
- 取消后仍看到部分结果：worker 会保留已发布或已写回的 prediction keyframes，未完成区间不落库。

## Tracker GPU OOM / 长视频分窗

`sam2_video` / `sam3_video` 不在平台 API 进程内加载模型，而是由 GPU Celery worker 调项目绑定 ML Backend。worker 会按 `VIDEO_TRACKER_WINDOW_SIZE_FRAMES` 把长区间拆成多个 `/predict context.type=video_tracker` 请求。

常见现象：

- job 进入 `failed`，`error_message` 含 OOM、CUDA out of memory、HTTP 5xx 或 timeout。
- GPU 后端容器重启，平台侧 job 停在 `running` 后转 failed。
- `gpu` queue 堆积，但 `media/default` 正常。

排查步骤：

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT id, status, model_key, from_frame, to_frame, error_message FROM video_tracker_jobs ORDER BY created_at DESC LIMIT 20;"
```

```bash
docker logs ai-annotation-platform-grounded-sam2-backend-1 --tail 200
docker compose ps celery-worker grounded-sam2-backend
```

缓解：

1. 降低单次分窗，例如：

```env
VIDEO_TRACKER_WINDOW_SIZE_FRAMES=120
```

2. 重启 worker 让配置生效：

```bash
docker compose restart celery-worker
```

3. 如果 OOM 发生在 backend 容器，降低 `SAM_VARIANT` 或减少该 backend 的 `extra_params.max_concurrency`，再重启 GPU backend。
4. 已失败 job 可由前端重新发起；已完成的 prediction keyframes 保留，低置信度结果会写入 outside range。

## Tracker Job 事件缺失

前端订阅：

```bash
ws "$API_WS/api/v1/ws/video-tracker-jobs/$JOB_ID?token=$TOKEN"
```

排查：

1. 确认 Redis 可用，worker 和 API 使用同一个 `REDIS_URL`。
2. 查看 job 是否有 `event_channel=video-tracker-job:<job_id>`。
3. worker 日志里查 `video tracker event publish failed`。
4. 如果刚改过 `apps/api/app/workers/video_tracker.py` 或 adapter 代码，重启 worker：

```bash
docker compose restart celery-worker
```

## 指标

重点观察：

- `video_frame_cache_total{result="hit"}` / `miss`：命中率过低说明前端预取范围或 TTL 不合适。
- `video_chunk_generation_seconds{outcome="error"}`：持续增加说明转码失败。
- `video_frame_asset_bytes{asset_type}`：容量预算与清理是否生效。
- `celery_queue_length{queue="media"}`：media 队列积压。

## 相关文档

- [视频后端帧服务](/dev/reference/video-frame-service)
- [Runbook：Celery Worker 卡死](/ops/runbooks/celery-worker-stuck)
