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

## 指标

重点观察：

- `video_frame_cache_total{result="hit"}` / `miss`：命中率过低说明前端预取范围或 TTL 不合适。
- `video_chunk_generation_seconds{outcome="error"}`：持续增加说明转码失败。
- `video_frame_asset_bytes{asset_type}`：容量预算与清理是否生效。
- `celery_queue_length{queue="media"}`：media 队列积压。

## 相关文档

- [视频后端帧服务](/dev/reference/video-frame-service)
- [Runbook：Celery Worker 卡死](/ops/runbooks/celery-worker-stuck)
