# v0.7.5 — 性能 & DX 收尾

## Context

v0.7.4「测试与文档体系一次性建齐」落地后留下若干"半成品 / 待激活"项：codecov 完全 informational 无 target、ruff-format 进 pre-commit 引发 121 文件 churn、CI 缺独立 typecheck、`prebuild` 每次都跑 codegen；同时 v0.6/v0.7 累积了几条没赶上版本的小型治理 / 性能项：`/health/celery` 缺、CORS 硬编码、predictions query cache 5min 默认 GC。

v0.7.5 把这些细节一次性收尾，让 v0.7.4 那波"封顶"，不引入新主题。

> **调研发现**：原方案二第 1 项「`Project.in_progress_tasks` 改 stored counter」**v0.7.0 alembic 0028 已完成**（`apps/api/app/db/models/project.py:50-52` 字段已加；`apps/api/app/services/batch.py:639-656` `_sync_project_counters()` 在 batch / task 状态变迁时维护四个 counter 列）。ROADMAP 描述滞后，本期顺手清理。

实际范围：**6 项 + ROADMAP 纠错 + CHANGELOG**。

---

## 范围

### 1. `/health/celery` 端点

**目标**：现有 `/health/{db,redis,minio}` 三件套补齐 celery，broker ping + active worker count。

**关键文件**：
- `apps/api/app/api/health.py:1-89`（追加 `_check_celery` + `/celery` 路由 + 进 `health_all`）
- `apps/api/app/workers/celery_app.py:5-10`（已有 `celery_app = Celery(..., broker=settings.effective_celery_broker)`，直接 import）
- `apps/api/tests/api/test_health.py`（mock `inspect.ping()` 加 2 个用例：有 worker / 无 worker）

**实现要点**：
- `celery_app.control.inspect(timeout=2).ping()` 拿活 worker 列表；返回 `{status, latency_ms, workers: ["celery@host"], active_count: N}`
- `inspect()` 在 ping 不到任何 worker 时返回 `None`（**不抛异常**），需判 `None` → status="error"
- `health_all` 把 celery 加入 checks dict，degraded 判定保持 `all(==ok)` 语义

**风险**：CI pytest 环境无 celery worker 跑，`/health/celery` 单测必须 mock；`/health` 聚合端点在 CI 不通 celery 时会 503，但 CI 不调 `/health` 聚合，可接受；docker-compose 整 stack 起来时 worker 在线，正常。

---

### 2. CORS 收紧

**目标**：`apps/api/app/main.py:71-82` 三个 localhost origin 硬编码 + `allow_origin_regex` 正则放行所有本机端口 → 走 settings，production 强制白名单不放 regex。

**关键文件**：
- `apps/api/app/config.py`（加 `cors_allow_origins: list[str]` + `cors_allow_origin_regex: str | None` + property `effective_cors_*`）
- `apps/api/app/main.py:71-82`（改读 settings；environment=="production" 时 regex 强制 None，origins 不允许空）
- `apps/api/.env.example`（加 `CORS_ALLOW_ORIGINS=...` 示例）

**实现要点**：
- `pydantic_settings` 读 list 字段需 JSON 格式或自定义 parser，参考已有 list 字段；若现 codebase 无先例，加 `@field_validator` split-on-comma
- dev 默认值保持当前三 origin + localhost regex（行为零变化）
- prod 启动时若 `cors_allow_origins` 为空 + environment=="production" → log warning 或直接 raise

**测试**：现有测试不受影响；新增 1 用例 mock production env 校验 regex 被禁。

---

### 3. OpenAPI codegen 加速

**目标**：`apps/web/package.json:8-13` 的 `prebuild: pnpm codegen` 每次 build 都跑 → 改 `if-changed`。同时把 `pnpm typecheck` 提到 CI lint job（snapshot 已由 `apps/api/tests/api/test_openapi_contract.py` 兜底契约）。

**前置约束**：`apps/web/src/api/generated/` 是 **gitignored**（`apps/web/.gitignore:2`），首次 install / clean build 必须跑 codegen，不能直接删 `prebuild`。

**关键文件**：
- `apps/web/package.json`：`prebuild` 替换为 `prebuild: node scripts/codegen-if-changed.mjs`；保留 `codegen` 直跑作手动入口
- `apps/web/scripts/codegen-if-changed.mjs`（新建，~30 行）：比较 `apps/api/openapi.snapshot.json` 与 `src/api/generated/types.gen.ts` mtime，前者较旧 + 后者存在 → skip；否则调 `openapi-ts`
- `.github/workflows/ci.yml:124-125`（lint job 末尾删注释，加独立 typecheck step：`pnpm typecheck`，需在 codegen 之后或复用 vitest job 的 build artifact）

**简化方案**：mtime 比较即可，无需 hash —— git checkout / pnpm install 都会刷新 mtime，达成"snapshot 变了就重生成"。

**typecheck CI 注意**：lint job 现无 generated 目录，需先 `pnpm install` 后 `pnpm codegen`（or `prebuild`）再 `pnpm typecheck`。

---

### 4. ruff-format 从 pre-commit 移到 CI

**目标**：`.pre-commit-config.yaml:20-21` 的 `ruff-format` hook 拖慢本地 commit + 与他人编辑器自动 format 冲突，移到 CI 单独 check。

**关键文件**：
- `.pre-commit-config.yaml:20-21`：移除 `ruff-format` hook 条目；保留 `ruff` lint hook（含 `--fix`）
- `.github/workflows/ci.yml:102-123` lint job：`ruff check` 之后追加 `ruff format --check apps/api/app apps/api/tests`（不带 `--check` 会原地修改，CI 必须用 check 模式只判断）

**风险**：v0.7.4 刚完成存量 121 文件 ruff-format 化（commit `7856a6f`），CI 应通过；后续若开发者本地无 format hook，可能 PR 触发 CI 失败 → README/DEV.md 简短提示「编辑器装 ruff format on save 或 CI 前手动 `ruff format`」。

---

### 5. codecov target 软启用

**目标**：`.codecov.yml` 当前 target=auto + informational=true，纯被动；改后端 60% / 前端 30% target，仍 informational 观察 1-2 周。

**关键文件**：
- `.codecov.yml`：用 per-flag config 把 default 拆分

```yaml
coverage:
  status:
    project:
      backend:
        target: 60%
        threshold: 2%
        flags: [backend]
        informational: true
      frontend:
        target: 30%
        threshold: 2%
        flags: [frontend]
        informational: true
    patch:
      default:
        target: auto
        threshold: 5%
        informational: true
```

**说明**：threshold 从 5% 收到 2%（target 已固定，threshold 只控波动报告）；patch 仍 auto（diff coverage 评论用）。

---

### 6. usePredictions cache GC

**目标**：`apps/web/src/hooks/usePredictions.ts:18-19` 的 query key 含 `minConfidence`，调阈值产生新 key，旧 key 默认 5min GC（react-query v5 `gcTime`）→ 工作台调阈值频繁，内存涨。

**关键文件**：
- `apps/web/src/hooks/usePredictions.ts:18-29`：加 `gcTime: 30_000`
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx:227-244` 已有相邻题 prefetch effect —— **不动**（prefetch 用同一 key，gcTime 自然托管）

**取舍**：仅加 `gcTime` 而不主动 `removeQueries`。原因：① 切题时 prefetch effect 已重建相邻题缓存，主动 remove 会撞 prefetch；② gcTime 30s 已远小于阈值连续调整间隔，旧 key 无引用后 30s 自动回收；③ 单行改、风险最小。

`useAcceptPrediction:32-41` 的 `invalidateQueries(["predictions", taskId])` 不动（无 key 后续部分等同前缀匹配）。

---

### 附加

- **ROADMAP.md**：删除 A 节「`Project.in_progress_tasks` 改 stored counter」整段（已 v0.7.0 完成）；删除 B 节「OpenAPI codegen 加速」「ruff-format 移出 pre-commit」「覆盖率门槛软启用」三项（本期落地）；C / 其它项不动。
- **CHANGELOG.md**：写 v0.7.5 条目，按 6 项主题列。
- **`apps/api/app/main.py:62`** 的 `version="0.6.7"` 早已脱节（实际 v0.7.4），本期顺手改 `"0.7.5"`。

---

## 验证

**后端**：
- `cd apps/api && uv run pytest -q` 全 PASS（含新 `/health/celery` mock 用例 + CORS env 用例）
- `docker compose up` 后 `curl http://localhost:8000/health/celery` → 返回 `{status:"ok", workers:[...], active_count:N}`
- 临时 `ENVIRONMENT=production CORS_ALLOW_ORIGINS='["https://x.example"]'` 启动，浏览器从 localhost:5173 调 API 应被 CORS 拒；改回 dev 应通

**前端**：
- `pnpm typecheck` 本地通过；CI lint job 包含独立 typecheck step
- `pnpm build` 第一次跑 codegen，第二次（snapshot 未变）skip 并打印 "openapi snapshot unchanged, skipping codegen"
- DevTools React Query 面板：调置信度阈值 → 旧 key 30s 后从 cache 消失（之前 5min）

**CI**：
- lint job 包含 `ruff format --check` step
- pre-commit 本地 commit 不再触发 ruff-format（提速）
- codecov PR 评论显示 backend target 60% / frontend target 30%

**ROADMAP / CHANGELOG**：grep 确认过时条目已删，v0.7.5 release note 已写。

---

## 文件变更清单

```
apps/api/app/api/health.py             # +/celery 路由 + 加进 health_all
apps/api/app/config.py                  # +cors_allow_origins / cors_allow_origin_regex
apps/api/app/main.py                    # CORS 改读 settings；version 改 0.7.5
apps/api/.env.example                   # +CORS_ALLOW_ORIGINS 示例
apps/api/tests/api/test_health.py       # +celery mock 用例
apps/api/tests/...                      # +CORS prod env 用例（位置看现有 test 模块归属）
apps/web/package.json                   # prebuild 改 if-changed 脚本
apps/web/scripts/codegen-if-changed.mjs # 新建（~30 行）
apps/web/src/hooks/usePredictions.ts    # +gcTime: 30_000
.pre-commit-config.yaml                 # 移除 ruff-format hook
.github/workflows/ci.yml                # lint 加 ruff format --check + typecheck
.codecov.yml                            # target 60%/30% per-flag
ROADMAP.md                              # 删 4 条已完成项
CHANGELOG.md                            # +v0.7.5 条目
```

## 实施顺序（建议单 PR / 6 commit）

1. **CORS 收紧** — settings + main + .env.example + 1 test，dev 行为不变最安全先做
2. **`/health/celery`** — 独立新端点 + test，与上一项零耦合
3. **`usePredictions` gcTime** — 单行改前端
4. **codecov target + ci.yml typecheck + ruff format check** — CI 配置一波
5. **`prebuild` if-changed** — 加脚本 + 改 package.json
6. **ruff-format 移出 pre-commit** — 放最后，先确认 CI 兜底 OK
7. **ROADMAP / CHANGELOG / version** — 收尾

各 commit 主题清晰可独立 revert。
