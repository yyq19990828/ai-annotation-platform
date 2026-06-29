---
audience: [dev, ops]
type: how-to
since: v0.15.17
status: stable
last_reviewed: 2026-06-12
---

# 开发部署（本地）

> 适用读者：第一次在本机把平台跑起来做开发 / 联调的人。
>
> 开发态的核心特征：**基础设施进容器，API / Web 跑宿主机进程，源码热更新**。它和生产部署在「方式」与「严谨性」上刻意不同——生产见[生产部署](/ops/deploy/docker-compose)，两态差异的原理见[运行环境形态](/dev/concepts/runtime-environments)。

---

## 1. 一句话形态

`docker-compose.yml` 只起**基础设施 + Celery**（PG / Redis / MinIO / mailpit / worker / beat）。API 和 Web **不在任何 compose 文件里**，由你在宿主机直接跑，改码即时生效：

- API：`uvicorn --reload`，改 Python 业务码自动重载
- Web：`vite` dev server，HMR 热替换
- Celery：容器内但挂载了 `./apps/api:/app` 源码，改 worker 业务码后 `docker restart` 即可（Celery 无 `--reload`）

```
┌─ 宿主机进程 ──────────────┐   ┌─ docker compose 容器 ─────────┐
│ uvicorn  :8000 (--reload) │──▶│ postgres :5432                │
│ vite     :5173 (HMR)      │   │ redis    :6379                │
│   └ /api,/ws → 127.0.0.1:8000 │ minio    :9000 / :9001        │
└───────────────────────────┘   │ mailpit  :1025 / :8025        │
                                 │ celery-worker / -export / beat│
                                 └───────────────────────────────┘
```

> 开发态默认端口全绑在本机，**不要**把它们对公网开——端口暴露的风险见[端口暴露与网络安全](/ops/deploy/network-security)。

---

## 2. 启动步骤

### 2.1 起基础设施

```bash
docker compose up -d
```

默认（不带 `--profile`）拉起 9 个容器：postgres / redis / minio / mailpit / celery-worker / celery-worker-gpu / celery-worker-cpu / celery-worker-export / celery-beat。GPU ML backend（profile `gpu` / `gpu-sam3` / `gpu-yolo`）与监控（profile `monitoring`）默认不启动，按需单独开。

### 2.2 跑数据库迁移

```bash
cd apps/api
uv sync
uv run alembic upgrade head
```

### 2.3 起 API（宿主机，热更新）

```bash
pnpm dev:api
# 等价于 cd apps/api && uv run uvicorn app.main:app --reload --port 8000
```

`--reload` 监听 `apps/api/**` 改动自动重启。`ENVIRONMENT` 默认 `development`，享受宽松 CORS、`/_test_seed` 路由等开发后门（见[运行环境形态](/dev/concepts/runtime-environments)）。

### 2.4 起 Web（宿主机，HMR）

```bash
pnpm install
pnpm dev:web
```

vite 跑在 `:5173`，把 `/api` `/ws` 反代到 `127.0.0.1:8000`（`apps/web/vite.config.ts`）。前端 API base 是硬编码同源相对路径 `/api/v1`，**不读 `VITE_API_URL`**，所以无需配后端地址。

> 多 worktree 并行（各分支后端跑不同端口）时，用 `API_PROXY_TARGET=http://127.0.0.1:8010 pnpm dev:web` 覆盖代理目标。

### 2.5 首个 super_admin

平台没有「第一个用户自动当管理员」的逻辑，第一次部署后手动跑一次：

```bash
cd apps/api
ADMIN_EMAIL=dev@example.com \
ADMIN_PASSWORD='set-a-strong-one' \
ADMIN_NAME='本地管理员' \
uv run python -m scripts.bootstrap_admin
```

之后用浏览器打开 `http://localhost:5173` 登录。

---

## 3. 改了东西要不要重启？

完整规则见 CLAUDE.md §8 与[升级指南](/ops/upgrade-guide)，开发态高频场景速查：

| 改动 | 操作 |
|---|---|
| `apps/api/app/**` 业务码（API 进程） | 自动 reload，无需手动 |
| `apps/api/app/workers/**` worker 码 | `docker restart ai-annotation-platform-celery-worker-1`（Celery 无 reload） |
| 新增 alembic 迁移 | `uv run alembic upgrade head`（worker 改码同样 restart） |
| `apps/web/src/**` | HMR 自动 |
| `.env` 运行期变量 | 重启对应进程 / `docker compose up -d` 重建容器 |
| `pyproject.toml` / `uv.lock` | `uv sync`；worker 容器需 `docker compose build` |
| `package.json` / `pnpm-lock.yaml` | `pnpm install` |

---

## 4. dev 环境用 SDK / CLI

本机 SDK 直连 host 上的 API 即可，明文 HTTP 在本地无所谓：

```bash
aap login --url http://localhost:8000 --api-key ak_...
# 或环境变量
export AAP_BASE_URL=http://localhost:8000
export AAP_API_KEY=ak_...
```

API Key 在 web 端「我的 API Keys」或 `aap` 登录后生成，写入 `~/.config/ai-annotation/config.toml`（`0600`）。

> ⚠️ **不在本机、要从另一台机器连**就完全是另一回事了——必须走 HTTPS、确认 presigned URL 对外可达。详见[端口暴露与网络安全](/ops/deploy/network-security)。

---

## 5. 关停

```bash
docker compose down          # 停容器，保留数据卷
docker compose down -v       # 连数据卷一起删（清空 PG / MinIO，慎用）
```

宿主机的 `pnpm dev:api` / `pnpm dev:web` 直接 Ctrl-C。

---

## 相关

- [运行环境形态](/dev/concepts/runtime-environments) —— 开发 / staging / 生产三态差异原理
- [生产部署](/ops/deploy/docker-compose) —— 容器化 + 反代 + TLS 的生产形态
- [端口暴露与网络安全](/ops/deploy/network-security) —— 端口该不该对外、SDK 远程访问安全
