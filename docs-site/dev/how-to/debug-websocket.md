# How-to：调试 WebSocket

> v0.9.11 落地 PerfHud 时一并修了 4 处 WS hook 的历史 bug 与 dev 环境陷阱。本文档记录每一类问题的现象、根因、定位手法，让以后 WS 出问题时不再像 v0.6.9-v0.9.10 间通知 WS 静默 404 那样 14 个月没人发现。

## WS 拓扑总览

后端 WS 端点全部注册在 `apps/api/app/api/v1/ws.py` 的 `router = APIRouter()`，由 `apps/api/app/main.py:108` `app.include_router(ws_router)` **无 prefix** 挂载。所以浏览器侧 URL 必须是 `/ws/<name>`，**不要写 `/api/v1/ws/<name>`**：

| 端点 | 用途 | 鉴权 | 前端 hook |
|---|---|---|---|
| `/ws/notifications` | 单用户通知推送 | JWT token | `useNotificationSocket.ts` |
| `/ws/prediction-jobs` | 全局预标 job 进度 (admin only) | JWT + role | `useGlobalPreannotationJobs.ts` |
| `/ws/projects/{id}/preannotate` | 单项目预标进度条 | 无（路径绑项目） | `usePreannotation.ts` |
| `/ws/ml-backend-stats` | PerfHud GPU/容器实时指标 (admin only) | JWT + role | `useMLBackendStats.ts` |

production：4 个端点都走 nginx `/ws/` location 反代到 `api:8000`（[infra/docker/nginx.conf](https://github.com/anthropics/ai-annotation-platform/blob/main/infra/docker/nginx.conf)）。

## 常见问题

### 1. 浮窗一直显示"正在连接 /ws/...", DevTools Network 看 ws 请求 "已完成 0.0kB"

**根因**：WS 在 server accept 之前 close（鉴权失败 / 路径 404）。Starlette 在 accept 前 close 会以 HTTP 403/404 拒绝握手，浏览器 onclose code 是 1006（abnormal closure），看不到具体原因。

**定位**：

```js
// 在浏览器 DevTools Console 跑（替换 token 取自 localStorage）
const token = localStorage.getItem('token');
console.log('exp:', JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp,
            'now:', Math.floor(Date.now()/1000));
// 直连 :8000 绕 vite proxy
const ws = new WebSocket(`ws://localhost:8000/ws/ml-backend-stats?token=${encodeURIComponent(token)}`);
ws.onopen = () => console.log('OPEN');
ws.onmessage = e => console.log('msg:', e.data.slice(0,200));
ws.onclose = e => console.log('CLOSED code=', e.code, 'reason=', e.reason);
```

观察 `exp` vs `now`：差为正且 token 已过期是最常见原因。

**修复**：

- token 过期 → logout / 清 `localStorage.token` 重新登录
- role 不匹配（admin-only 端点）→ 切 admin 账号
- URL 写错 → 检查 `/ws/<name>` 不带 `/api/v1` 前缀

### 2. WS 卡 CONNECTING 永不返回 onopen / onclose

**根因**：vite 6 的 `/ws` proxy 在多个 ws hook 并发 upgrade 时偶发卡死（vite 内部 http-proxy ws 模式 race condition），单个 WS 通常 OK，2+ 个并发就有概率重现。

**定位**：

```bash
# 直连后端 :8000 绕过 vite proxy 验证后端 OK
curl -s http://127.0.0.1:8000/health  # API 在线
# Console 跑上面的直连脚本（端口 8000 而非 3000）
```

如果直连 :8000 能拿到 OPEN + msg，但通过 :3000 vite proxy 卡 CONNECTING，就是 vite proxy 问题。

**修复**：4 处 WS hook 已 v0.9.11 改为 dev 模式直连 :8000：

```ts
const host = import.meta.env.DEV ? "localhost:8000" : window.location.host;
const url = `${proto}://${host}/ws/<name>?token=...`;
```

新增 ws hook 时**沿用此模式**，不要直接用 `window.location.host`。

### 3. uvicorn `--reload` 改完 .py 后卡住不重启

**症状**：编辑 `app/workers/celery_app.py` 等文件后，uvicorn 终端打印：

```
WARNING:  WatchFiles detected changes in '...'. Reloading...
INFO:     Shutting down
INFO:     connection closed
INFO:     Waiting for background tasks to complete. (CTRL+C to force quit)
```

然后无限期卡在最后一行，新代码永不加载。

**根因**：uvicorn graceful shutdown 等所有 background tasks 完成。浏览器持有的 WS 长连接是 background task，永远不会"完成"。

**修复**（临时绕法）：

```bash
ss -lntp | grep :8000           # 找老 uvicorn worker pid
kill -9 <pid>                    # 强杀
cd apps/api && uv run uvicorn app.main:app --reload --port 8000  # 重启
```

**长期方案**（待 follow-up）：自定义 lifespan close-on-reload 主动断 WS，或起 uvicorn 时加 `--timeout-graceful-shutdown 5`。

### 4. 后端 WS 端点 def 改完了但调不到（404）

**根因**：docker celery-worker / api 容器 image 用 `COPY` 而不是 volume mount 源码（[infra/docker/Dockerfile.api](../../../infra/docker/Dockerfile.api)），改代码必须 rebuild image：

```bash
docker compose build api celery-worker celery-beat   # rebuild
docker compose up -d                                  # restart
```

**dev 推荐路径**：本地 uvicorn `--reload` 跑 api（前提：注意问题 3）+ celery worker 跑 docker（worker 路径不常改，改了再 build）。docker-compose.yml 里 `api` service 默认注释掉就是这个原因（仓库根 v0.9.11 之前没单独的 celery-beat service，v0.9.11 拆出独立 celery-beat 服务）。

详见 [CLAUDE.md §7 Docker rebuild vs restart](../../../CLAUDE.md)。

### 5. Celery beat 发任务但 worker 不消费

**症状**：`docker logs celery-beat` 看到 `Sending due task ...` 每秒一次，但 `docker logs celery-worker` 没有 `received` / `succeeded`。Redis `LLEN celery` 很大，`LLEN default` 是 0。

**根因**：task 没在 `task_routes` 显式声明，默认进 `celery` 队列；但 worker 启动 `-Q default,ml,media` 不订阅 `celery`，task 永远卡在队列里。

**修复**：

```python
# apps/api/app/workers/celery_app.py
task_routes = {
    "app.workers.ml_health.publish_ml_backend_stats": {"queue": "default"},
    "app.workers.ml_health.check_ml_backends_health": {"queue": "default"},
    # 其他显式列出
}
```

每加新 task 必须配套加 task_routes 一行。或者改 worker 启动为 `-Q default,ml,media,celery`（但容易引入 stale 队列堆积无人消费的旧任务）。

### 6. asyncpg `cannot perform operation: another operation is in progress`

**根因**：Celery prefork pool（`--concurrency=N` N>1）+ 全局 `async_session` engine 共享。fork 子进程继承父进程 engine 后 connection 被多 worker 同时使用触发 asyncpg 内部断言。

**修复**：高频 / 并发 task 用 per-task engine 模式（与 `tasks._run_batch` 一致）：

```python
async def _my_async_task():
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with SessionLocal() as db:
            ...
    finally:
        await engine.dispose()
```

低频 task（每分钟以下 + concurrency=1 工人）可继续用全局 `async_session()`。

## 检查清单：新增 WS 端点时

后端：
- [ ] `apps/api/app/api/v1/ws.py` 注册路径用 `/ws/<name>` 形式
- [ ] accept 之前 close 走 1008，避免无 close frame 的 abnormal close
- [ ] 长连接里不持有全局 DB engine（per-task engine 或 NullPool）

前端：
- [ ] hook 用 `import.meta.env.DEV ? "localhost:8000" : window.location.host` 切换
- [ ] URL 是 `/ws/<name>` 不带 `/api/v1`
- [ ] onclose code 1008 / 1006 区分鉴权失败 vs 网络断；不要静默兜底（v0.6.9 通知 bug 教训）
- [ ] 加 e2e 或 hook 单测覆盖 URL 派发，避免 14 个月无人发现的二次重演

运维：
- [ ] nginx.conf 的 `location /ws/` 已含 Upgrade / Connection header（见 v0.9.11 nginx.conf）
- [ ] 改完 docker COPY 的 .py 文件后 `docker compose build` 不只是 restart

## 相关 ADR / 文档

- 后端 ws 端点协议 → [架构文档 frontend-layers.md](../architecture/frontend-layers.md)
- PerfHud 的 WS 实时推送架构 → [架构文档 perfhud.md](../architecture/perfhud.md)
- 通知系统设计 → 评估 v0.6.9 通知 WS / 30s 兜底 fallback 设计文档（暂无独立 ADR）
