# v0.8.3 开发计划：心跳 + 审计 trigger 测试 + 测试/DX 收紧

## Context

ROADMAP.md 中 v0.8.2 之后的四块 P1/P2 一次性落：

1. **在线状态心跳机制**（A · UsersPage）：当前 `user.status` 仅 login/logout 切换，关浏览器 / token 过期 / 网络断开会停留 `online`；`UsersPage.tsx:150` 的「本周活跃」基于 `status === "online"` 是错的。要落 `last_seen_at` 列 + `/me/heartbeat` 端点 + Celery beat 扫表 + 前端 7 日窗口聚合，为下一版「效率看板 P1.投入 维度」共建数据基础。
2. **审计日志不可变 trigger 测试覆盖**（B · 治理合规）：v0.7.8 已落 PG `deny_audit_log_mutation` trigger + `app.allow_audit_update` GUC 豁免，但无独立测试。`security.md` 已宣称该机制可靠，需测试兜底以防回归（迁移分区时尤其脆弱）。
3. **前端单测 ≥ 25% + 切硬阻断**（B · 测试/DX）：v0.7.6 baseline 8.68%（13 个测试文件 / 1095 LOC）；需补 hooks 与页面级 3 个，达标后把 `codecov.yml` frontend `informational: true` 切为 `false`。
4. **E2E spec 写实 + 去 `continue-on-error`**（B · 测试/DX）：当前三个 spec（auth/annotation/batch-flow）共 39 行 .skip 占位；本期至少把 `auth.spec.ts` 写实 + 加 `e2e/fixtures/seed.ts` 后端造种子链路，annotation/batch-flow 留 1-2 条最小 happy path。CI job 的 `continue-on-error: true` 在 auth 跑稳后摘掉。

预期产出：v0.8.3 release notes + CHANGELOG 条目 + ADR-0008 状态保持 Proposed（不在本期实施）。

## 范围与不做

- **做**：心跳基础设施全链路、trigger 三条测试、前端单测推到 ≥ 25% 切阻断、E2E 三 spec 写实并摘 continue-on-error。
- **不做**：效率看板 Layer 1/2/3（依赖心跳但工作量独立，留给 v0.8.4+）；ADR-0008 admin-locked 实施；OAuth/CAPTCHA；fabric.js 清理。

---

## 模块 1：在线状态心跳机制

### 1.1 后端 schema 与端点

**新增迁移**：`apps/api/alembic/versions/0038_user_last_seen_at.py`
- 加 `User.last_seen_at: Mapped[datetime | None]`（带索引 `ix_users_last_seen_at`，用于 7 日窗口聚合扫描）
- 老数据 NULL → 前端 graceful degrade「本周活跃」分母不含 NULL

**模型**：`apps/api/app/db/models/user.py:28` 在 `status` 后追加 `last_seen_at`。

**心跳端点**：`apps/api/app/api/v1/me.py` 新增
```
POST /me/heartbeat → 204
  body: 无
  逻辑: user.last_seen_at = utcnow(); user.status = "online"; commit
  rate_limit: 不加（30s 自然限流）
```

**login 增量改动**（`auth.py:100`）：登录成功时同步置 `last_seen_at = utcnow()`。
**logout/logout_all 增量改动**（`auth.py:255,278`）：保持 status="offline"，**不重置 last_seen_at**（last_seen_at 是「最后活跃时间」，登出仍是活跃）。

### 1.2 Celery beat 扫描任务

**新文件**：`apps/api/app/workers/presence.py`
```python
@celery_app.task(name="workers.presence.mark_inactive_offline")
def mark_inactive_offline():
    threshold = utcnow() - timedelta(minutes=OFFLINE_THRESHOLD_MIN)
    UPDATE users SET status='offline'
      WHERE status='online' AND (last_seen_at IS NULL OR last_seen_at < threshold)
```

**注册**：`apps/api/app/workers/celery_app.py:38-58` beat_schedule 新增
```python
"mark-inactive-offline": {
  "task": "workers.presence.mark_inactive_offline",
  "schedule": crontab(minute="*/2"),  # 每 2 分钟
}
```

**配置**：`apps/api/app/core/config.py` 新增 `OFFLINE_THRESHOLD_MINUTES: int = 5`（30s 心跳 × 10 容差）。

### 1.3 前端 hook 与挂载

**新文件**：`apps/web/src/hooks/useHeartbeat.ts`
- `setInterval(() => meApi.heartbeat(), 30_000)`
- 仅在已登录（有 token）+ `document.visibilityState === 'visible'` 时跑
- 切 tab / 隐藏 → 暂停；返回 → 立即打一次再恢复
- 静默失败（401 触发现有刷 token；其他错忽略，不打扰用户）

**meApi 扩展**：`apps/web/src/api/me.ts` 加 `heartbeat()` 方法。

**挂载点**：`apps/web/src/App.tsx`（认证子树根附近，与 useMe 同层）调用一次 `useHeartbeat()`。

### 1.4 UsersPage 「本周活跃」改造

**后端**：`apps/api/app/api/v1/dashboard.py` 或 users 列表端点的统计返回值，把现有 active_count 改为
```sql
SELECT COUNT(*) FROM users WHERE last_seen_at >= now() - interval '7 days'
```

**前端**：`apps/web/src/pages/Users/UsersPage.tsx:150` 改为消费后端 `weekly_active_count` 而非本地 `filter(status==="online")`。

### 1.5 验证

- 单测：`tests/test_presence.py`（新）
  - login 写 last_seen_at
  - heartbeat 端点更新 last_seen_at
  - mark_inactive_offline 把 6 分钟前 online 用户置 offline
  - 6 分钟内 online 不动
- 手测：登录 → 浏览器关闭 → 6 分钟后 UsersPage 显示 offline；本周活跃数符合预期

---

## 模块 2：审计日志不可变 trigger 测试覆盖

**新文件**：`apps/api/tests/test_audit_immutability.py`

复用 `conftest.py` 的 `db_session` fixture（SAVEPOINT 隔离）+ 已有 `test_audit_partition.py` 的造数模式。

### 三条 case

```python
async def test_update_blocked_without_exemption(db_session):
    # 写一条 audit_log → 直接 UPDATE → pytest.raises(Exception, match="immutable")

async def test_delete_blocked_without_exemption(db_session):
    # 写一条 audit_log → 直接 DELETE → pytest.raises(Exception, match="immutable")

async def test_set_local_exemption_allows_mutation(db_session):
    # SET LOCAL "app.allow_audit_update" = 'true'
    # UPDATE audit_logs SET resource_id='redacted' WHERE id=...
    # 断言：1 行受影响
    # 提交事务（或 ROLLBACK 再开新事务）→ 验证后续 UPDATE 仍被阻断（豁免不泄漏）

async def test_copy_bypasses_row_trigger(db_session):
    # 用 COPY audit_logs (...) FROM STDIN 写入 → 不抛错
    # （asyncpg 的 copy_to_table 或 raw psql via subprocess）
    # 断言：行写入成功，无需豁免
```

**第四条 COPY case 备选方案**：若 asyncpg copy_to_table 在测试环境繁琐，改用 `INSERT ... ON CONFLICT DO NOTHING` 模拟 pg_restore 路径不现实——直接用 `conn.copy_to_table('audit_logs', records=[...], columns=[...])`（asyncpg 原生支持）。

### 验证
- `uv run pytest apps/api/tests/test_audit_immutability.py -v` 全绿
- 故意改 trigger 函数注释豁免逻辑 → 确认 case 3 失败（红绿验证）

---

## 模块 3：前端单测推到 ≥ 25%

### 3.1 基线测算

先本地跑 `cd apps/web && pnpm test:coverage`，记录当前 lines/branches/functions/statements 四项；写入计划进度笔记，避免无的放矢。

### 3.2 新增测试清单（按 ROI 排序）

| # | 目标 | 文件 | 估算 LOC | 难度 |
|---|---|---|---|---|
| 1 | `useSessionStats` ring buffer | `pages/Workbench/state/__tests__/useSessionStats.test.ts` | ~80 | 低（纯函数） |
| 2 | `replaceAnnotationId` | `pages/Workbench/state/__tests__/replaceAnnotationId.test.ts` | ~60 | 低 |
| 3 | `InviteUserModal` 状态机 | `components/users/__tests__/InviteUserModal.test.tsx` | ~120 | 中（角色权限分支） |
| 4 | `RegisterPage` 三态（公开 / 邀请 / 密码强度） | `pages/Register/__tests__/RegisterPage.test.tsx` | ~150 | 中 |
| 5 | `DashboardPage` smoke + 角色路由分支 | `pages/Dashboard/__tests__/DashboardPage.test.tsx` | ~100 | 中（mock 三 dashboard hook） |
| 6 | `ProjectsPage` 列表 + 筛选 | `pages/Projects/__tests__/ProjectsPage.test.tsx` | ~120 | 中 |
| 7 | `WorkbenchShell` 极简 smoke（render with mock task） | `pages/Workbench/shell/__tests__/WorkbenchShell.test.tsx` | ~80 | 高（依赖深，先 stub Konva） |

参考样板：现有 `ExportSection.test.tsx` (58 行) + `CommentInput.test.tsx` (80 行) + `offlineQueue.test.ts` (103 行)。

### 3.3 切硬阻断

`codecov.yml` frontend section：
```yaml
frontend:
  target: 25%
  informational: false
  threshold: 1%  # 允许小幅波动
```

同时 `apps/web/vite.config.ts` coverage 配置加 `thresholds: { lines: 25, branches: 20 }` 用于本地早期失败。

### 3.4 验证

- `pnpm test:coverage` 报 ≥ 25%
- 故意删掉一个测试文件 → CI 红（验证 informational=false 真生效）

---

## 模块 4：E2E spec 写实 + 去 `continue-on-error`

### 4.1 后端 seed 链路

**新文件**：`apps/api/tests/factory.py`（roadmap 提到的，目前不存在）
- `make_user(role, **)` / `make_project()` / `make_task()` / `make_batch()`
- 复用 `conftest.py:_make_user`，提取为 module-level 可复用函数

**新文件**：`apps/api/app/api/v1/_test_seed.py`
- 仅当 `settings.ENV == "test"` 时挂载 router（main.py 条件导入）
- `POST /__test/seed/reset` → truncate + 重建固定 fixture（admin/annotator/reviewer 各 1 + 1 项目 + 5 task）
- `POST /__test/seed/login` → 跳过密码直接发 JWT（仅 ENV=test）
- 安全：检测 `settings.ENV != "test"` 时 router 注册时抛错，禁止 production 漂移

### 4.2 三个 spec 写实

**`apps/web/e2e/tests/auth.spec.ts`**（**主目标**，必须跑通）
1. 登录页 → 输入 admin@test / 正确密码 → 跳 dashboard，断言顶栏 username
2. 错密码 → toast「用户名或密码错误」，仍在登录页
3. JWT 过期模拟（删除 localStorage token）→ 访问受保护路由 → 跳登录

**`apps/web/e2e/tests/annotation.spec.ts`**（最小 happy path）
- seed 一个 image-det 任务 → 工作台打开 → 按 `B` 选 bbox → 拖框 → 按 `Enter` 提交 → 断言 task 状态变为 submitted

**`apps/web/e2e/tests/batch-flow.spec.ts`**（极简验证）
- seed 一批次 → annotator 提交 1 个 task → reviewer approve → 批次状态变化断言

### 4.3 CI 收紧

`.github/workflows/ci.yml` e2e job：
- 加 `services: postgres + redis`（如未启）
- step：`pnpm api:migrate && pnpm api:start &`（后台）+ `playwright test`
- 删除 `continue-on-error: true`（line ~165）
- auth.spec.ts 跑稳后再删；若 annotation/batch-flow 仍不稳，单独标 `.skip` 但保留代码

### 4.4 验证

- 本地 `pnpm e2e` 三 spec 全绿
- CI 一次完整 run 不依赖 continue-on-error

---

## 实施顺序（建议）

1. **Day 1-2** · 模块 2（trigger 测试，最小风险，独立）+ 模块 1.1/1.2（迁移 + 心跳端点 + Celery）
2. **Day 3** · 模块 1.3/1.4（前端 hook + UsersPage 改造）+ 模块 1 端到端验证
3. **Day 4-5** · 模块 3（单测推到 ≥ 25%）
4. **Day 6-7** · 模块 4（factory + seed + 三 spec + CI 收紧）
5. **Day 7** · 文档：CHANGELOG.md 加 v0.8.3 条目；ROADMAP.md 划掉对应行；docs-site/dev/testing.md 补 e2e seed 用法

## 关键文件清单

**后端新增**：
- `apps/api/alembic/versions/0038_user_last_seen_at.py`
- `apps/api/app/workers/presence.py`
- `apps/api/app/api/v1/_test_seed.py`
- `apps/api/tests/test_audit_immutability.py`
- `apps/api/tests/test_presence.py`
- `apps/api/tests/factory.py`

**后端修改**：
- `apps/api/app/db/models/user.py`（+last_seen_at）
- `apps/api/app/api/v1/me.py`（+/heartbeat）
- `apps/api/app/api/v1/auth.py`（login 写 last_seen_at）
- `apps/api/app/workers/celery_app.py`（beat schedule 注册）
- `apps/api/app/main.py`（条件挂载 _test_seed router）
- `apps/api/app/core/config.py`（OFFLINE_THRESHOLD_MINUTES）

**前端新增**：
- `apps/web/src/hooks/useHeartbeat.ts`
- `apps/web/src/pages/Workbench/state/__tests__/useSessionStats.test.ts`
- `apps/web/src/pages/Workbench/state/__tests__/replaceAnnotationId.test.ts`
- `apps/web/src/components/users/__tests__/InviteUserModal.test.tsx`
- `apps/web/src/pages/Register/__tests__/RegisterPage.test.tsx`
- `apps/web/src/pages/Dashboard/__tests__/DashboardPage.test.tsx`
- `apps/web/src/pages/Projects/__tests__/ProjectsPage.test.tsx`
- `apps/web/src/pages/Workbench/shell/__tests__/WorkbenchShell.test.tsx`

**前端修改**：
- `apps/web/src/App.tsx`（挂 useHeartbeat）
- `apps/web/src/api/me.ts`（heartbeat）
- `apps/web/src/pages/Users/UsersPage.tsx:150`（本周活跃读后端 weekly_active_count）
- `apps/web/vite.config.ts`（coverage thresholds）
- `apps/web/e2e/tests/{auth,annotation,batch-flow}.spec.ts`（写实）
- `apps/web/e2e/fixtures/seed.ts`（新）

**根目录**：
- `codecov.yml`（frontend informational → false, target 25%）
- `.github/workflows/ci.yml`（去 continue-on-error）
- `CHANGELOG.md` / `ROADMAP.md`

## 验证矩阵

| 模块 | 验证方式 | 期望 |
|---|---|---|
| 心跳 | 登录 → 等 6 分钟 → 检查 status 自动 offline | ✓ |
| 心跳 | 浏览器开着多账户 7 天 → UsersPage 本周活跃 ≥ 1 | ✓ |
| trigger | `uv run pytest apps/api/tests/test_audit_immutability.py -v` | 4 case 全绿 |
| 单测 | `pnpm test:coverage` lines | ≥ 25% |
| 单测 | 改 codecov.yml informational=false → CI red on coverage drop | 真阻断 |
| E2E | `pnpm e2e` 本地 + CI（无 continue-on-error） | auth 全绿；annotation/batch-flow 至少 happy path 绿 |

## 风险与备选

- **Celery beat 频率 2 分钟**：若负载敏感，降到 5 分钟，offline 阈值同步从 5 → 8 分钟。
- **WorkbenchShell 单测复杂度**：若 Konva mock 成本超 200 LOC，砍掉换成 `WorkbenchTopbar` 等更小组件凑覆盖率。
- **E2E batch-flow 跨角色登录**：seed.ts 提供「按角色直接拿 JWT」的 helper 减少 UI 登录 fan-out 时间。
- **覆盖率达不到 25%**：先合 hooks + 4 个组件，覆盖率到 ≈ 18-20% 时评估是否切阻断到 18%（保守）或继续推。底线是切阻断（哪怕 18%），不切阻断这件事不能延期。
