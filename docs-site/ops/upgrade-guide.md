---
title: 版本升级指南
audience: [ops]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-05-11
---

# 版本升级指南

本文描述将平台从一个版本升级到下一个版本的标准流程。

## 升级前准备

1. **阅读 CHANGELOG**：查看目标版本的 Breaking Changes 和 Migration Notes
2. **备份数据库**：
   ```bash
   docker exec ai-annotation-platform-postgres-1 pg_dump -U user annotation > backup-$(date +%Y%m%d).sql
   ```
3. **备份 MinIO**（如有重要标注数据）
4. **通知用户**：计划维护窗口

## 标准升级步骤

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 检查是否有依赖变更
git diff HEAD~1 apps/api/pyproject.toml apps/web/package.json

# 3a. 若有依赖变更 → 重新构建镜像
docker compose build api web celery-worker

# 3b. 若无依赖变更 → 仅重启容器
docker compose up -d

# 4. 运行数据库迁移
docker exec ai-annotation-platform-api-1 alembic upgrade head

# 5. 验证服务正常
curl -f http://localhost:8000/api/v1/health
curl -f http://localhost:5173
```

## 迁移相关说明

- 数据库迁移通过 Alembic 自动管理，每次升级必须执行 `alembic upgrade head`
- 若迁移失败，可回滚：`alembic downgrade -1`（回退一个版本）
- 前端静态资源由 Vite 构建，版本号在文件名中，无缓存问题

## 版本注意事项

### 升级到 v0.9.16+

v0.9.16 引入视频元数据处理，API / Celery 镜像内需要 `ffmpeg` 与 `ffprobe`。该版本修改了 `infra/docker/Dockerfile.api`，升级时必须 rebuild API 与 Celery worker 镜像，不能只重启容器。

v0.9.17+ media worker 还会为非 H.264 视频生成浏览器播放用的 `playback/*.mp4`。升级后如存量视频播放按钮无效，先 rebuild/restart Celery worker，再对相关 dataset 重新触发 media backfill。

```bash
docker compose build api celery-worker
docker compose up -d api celery-worker
```

验证镜像内依赖：

```bash
docker exec ai-annotation-platform-api-1 ffprobe -version
docker exec ai-annotation-platform-celery-worker-1 ffmpeg -version
```

如果视频导入后没有 `video_metadata` 或 poster，优先检查 `media` 队列 worker 日志：

```bash
docker logs ai-annotation-platform-celery-worker-1 --tail 200
```

### 升级到 v0.9.17+

v0.9.17 新建视频标注默认写 `video_track`，旧 `video_bbox` 继续可读。该版本不新增数据库表；重点检查 OpenAPI / 前端类型是否与后端同步，避免旧前端无法识别 `video_track` discriminator。

## 回滚步骤

```bash
# 回滚代码
git checkout <previous-tag>

# 回滚数据库（若迁移已执行）
docker exec ai-annotation-platform-api-1 alembic downgrade <previous-revision>

# 重启服务
docker compose up -d
```

## 零停机升级（高级）

当前版本不支持滚动升级（同时运行两个 API 版本）。建议在低流量时段进行升级，停机时间约 1–3 分钟。

## 版本查询

```bash
# API 版本
curl http://localhost:8000/api/v1/health | jq .version

# 数据库迁移版本
docker exec ai-annotation-platform-api-1 alembic current
```
