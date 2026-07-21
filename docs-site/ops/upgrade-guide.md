---
title: 版本升级指南
audience: [ops]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-07-11
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

# 2. 对比“当前部署 commit”到新 HEAD，检查依赖 / Dockerfile / compose 变化
git diff <deployed-commit>..HEAD -- apps/api/pyproject.toml apps/api/uv.lock \
  apps/web/package.json pnpm-lock.yaml infra/docker apps/*-backend/Dockerfile \
  docker-compose*.yml

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
- 只有目标 migration 明确提供可逆 downgrade 时才能执行 `alembic downgrade`；数据归位、合并或候选暂存类迁移可能是 no-op downgrade 或会丢数据，回滚前必须先读 migration docstring
- 前端静态资源由 Vite 构建，版本号在文件名中，无缓存问题

## 重点注意事项

### 跨过工具单位退役与视频候选迁移

从较旧环境直接升级、迁移链包含 `0115`–`0117` 时，必须安排维护窗口并先做数据库备份：

- `0115` 新增项目级 `ai_interactive_enabled`，并把 annotation 中退役的 `ai_interactive` 按几何分批归位到 `region` / `bbox`。分批降低单事务持锁，但大表仍会产生读写压力。
- `0116` 分批归位 prediction，并把项目 / 模板 `tool_bindings.ai_interactive` 中的类别与属性合并到真实几何单位。冲突时保留目标单位配置；downgrade 是 no-op，无法恢复退役单位。
- `0117` 新增 `video_tracker_jobs.staged_result`。downgrade 会删除该列，所有尚未接受的视频追踪候选随之丢失；回滚前先处理 `pending_review` / 带候选的 `cancelled` job。
- `0134` 新增 `raster_mask_uploads`，用于 task 级匿名 Mask 上传归属和并发配额。downgrade 会丢失尚未认领对象的额度账本，但内容寻址对象仍由 24 小时引用扫描 GC 回收。

升级后先核对 migration head，再验证：旧项目的 region / bbox 类别仍完整、交互式 AI 总开关符合预期、视频追踪完成后进入待审且接受 / 丢弃可用。

### 视频媒体处理

视频元数据处理要求 API / Celery 镜像内有 `ffmpeg` 与 `ffprobe`。涉及 Dockerfile 或依赖变化时必须 rebuild API 与 Celery worker 镜像，不能只重启容器。

media worker 会为非 H.264 视频生成浏览器播放用的 `playback/*.mp4`。升级后如存量视频播放按钮无效，先 rebuild/restart Celery worker，再对相关 dataset 重新触发 media backfill。

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

### 视频标注类型

新建视频轨迹标注默认写 `video_track_bbox`，旧 `video_bbox` 继续可读。升级时重点检查 OpenAPI / 前端类型是否与后端同步，避免旧前端无法识别 `video_track_bbox` discriminator。

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
