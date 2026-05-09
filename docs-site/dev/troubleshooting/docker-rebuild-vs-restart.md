---
audience: [dev]
type: how-to
since: v0.1.0
status: stable
last_reviewed: 2026-05-09
---

# Docker rebuild vs restart：Celery 不会热重载

## 症状

改了 `apps/api/app/workers/tasks.py` 里的 task 代码（比如新增/重命名参数），重启浏览器、改 dispatcher 入参，结果运行时仍报 `TypeError: batch_predict() got an unexpected keyword argument 'xxx'`，磁盘上的源代码看起来明明已经更新。

最早可见症状：B-1 反馈「AI 预标注点击后没反应/卡住」，根因即 worker 拉的是上一次 image 里的 stale code。

## 复现

```bash
# 修改 worker task 签名
vi apps/api/app/workers/tasks.py

# API 容器自动 reload（uvicorn --reload），看似一切正常
curl http://localhost:8000/health  # OK

# 触发预标注 → worker 执行 batch_predict 时报 TypeError
```

## 根因

| 服务 | 是否热重载 |
|---|---|
| `apps/api`（FastAPI / uvicorn） | ✅ `--reload` 监听挂载卷 |
| 前端 vite | ✅ HMR |
| **Celery worker** | ❌ **没有任何自动重载机制** |

dev `docker-compose.yml` 把 `apps/api/app/**` 挂卷到 worker 容器里，所以源文件**看起来**是新的，但 Celery 进程已经把旧版 task 加载进解释器，挂载只影响下次进程启动后的导入。

## 修复 / 规避

**业务代码改动 → 仅 restart：**

```bash
docker restart ai-annotation-platform-celery-worker-1
```

**依赖 / Dockerfile / 镜像层改动 → rebuild：**

```bash
docker compose build celery-worker && docker compose up -d celery-worker
```

**rebuild 触发条件清单**（CLAUDE.md §7）：
- `pyproject.toml` / `uv.lock` / `requirements.txt`
- `package.json` / `pnpm-lock.yaml`
- `Dockerfile` / `.dockerignore`
- 基础镜像版本（`FROM python:3.x`）
- `docker-compose.yml` 的 `build:` 块、build args、`COPY` 路径

**验证 worker 是否拿到新代码：**

```bash
docker exec ai-annotation-platform-celery-worker-1 \
  python -c "import inspect, app.workers.tasks as t; print(inspect.signature(t.batch_predict))"
```

如果签名仍是旧的，再次 `docker restart`。

## 长效防御

`apps/api/app/workers/tasks.py` 里的 `_BatchPredictTask.on_failure` 现在会把任何未捕获异常推到 WS `project:{id}:preannotate` 频道，前端 `progress.error` 分支可见——避免再出现「已排队后无响应」的体感 BUG（commit `4bf5bf6`）。

## 相关

- commit: `4bf5bf6` fix(B-1): 预标 worker 异常推 WS + Docker rebuild/restart 规则
- 文档：[`CLAUDE.md` §7](https://github.com/yyq19990828/ai-annotation-platform/blob/main/CLAUDE.md)
- How-to：[调试 Celery](../how-to/debug-celery)
