---
title: 版本升级指南
audience: [ops]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
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
