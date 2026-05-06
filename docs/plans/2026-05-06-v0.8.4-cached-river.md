# v0.8.4 — 效率看板 / 人员绩效（L1+L2+L3）

> 计划文件路径由 plan-mode 指定（未含 yyyy-mm-dd 前缀），实际工作日：2026-05-06。

## Context

ROADMAP「效率看板 / 人员绩效（新 · P1）」是当前唯一 P1 用户主诉：

- AdminDashboard 完全无人员维度（[apps/web/src/pages/Dashboard/AdminDashboard.tsx](apps/web/src/pages/Dashboard/AdminDashboard.tsx) 仅 4 张总量 StatCard）。
- AnnotatorDashboard / ReviewerDashboard 全部 count 类指标，[apps/api/app/api/v1/dashboard.py:286-383](apps/api/app/api/v1/dashboard.py) 从未消费已落库的 `submitted_at` / `reviewer_claimed_at` / `reviewed_at`（v0.6.5 状态机字段）。
- AnnotatorDashboard `weeklyTarget = 200` 硬编码（[AnnotatorDashboard.tsx:36](apps/web/src/pages/Dashboard/AnnotatorDashboard.tsx:36)）。
- 工作台 [useSessionStats.ts](apps/web/src/pages/Workbench/state/useSessionStats.ts) 20 样本环形 buffer 仅本地展示，未持久化。

**目标**：标注员/审核员能自查产能/质量/投入；管理员有卡片网格 + 抽屉下钻看全员效率。

**本期范围**：L1 数据沉淀 + L2 个人 dashboard 强化 + L3 管理员人员看板，含 `mv_user_perf_daily` 按小时 refresh。

**显式不做**（依赖另一 session）：
- `User.last_seen_at` + `POST /me/heartbeat` + Celery beat offline 扫描。
- 因此「今日活跃时长」「专注时段直方图」「连续标注 streak」三项指标本期 graceful degrade 显示 `—`，等心跳合并后接通（仅前端读取层做兼容判断，无需重新发版）。

---

## L1 · 数据沉淀（后端）

### 1.1 迁移 0038 — `Task.assigned_at`

- 文件：`apps/api/alembic/versions/0038_task_assigned_at.py`
- 字段：`Task.assigned_at: datetime | None`，索引 `(assignee_id, assigned_at DESC)`。
- 写入点：[apps/api/app/services/batch.py:247-255](apps/api/app/services/batch.py) `_cascade_task_assignee()` 同步设 `assigned_at = func.now()`。其它直接 set `assignee_id` 的位置全量 grep 一次（含 batch.update / scheduler）。
- 老数据 NULL → 个人指标计算端「assigned_at IS NOT NULL」过滤后取中位/p95，前端展示「样本不足」。

### 1.2 迁移 0039 — `task_events` 表

- 文件：`apps/api/alembic/versions/0039_task_events.py`
- 模型：`apps/api/app/db/models/task_event.py`
  ```
  task_events(
    id UUID PK,
    task_id UUID FK,
    user_id UUID FK,
    project_id UUID FK,           -- denormalized for filter
    kind VARCHAR(16) NOT NULL,    -- 'annotate' | 'review'
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    duration_ms INT NOT NULL,
    annotation_count INT DEFAULT 0,
    was_rejected BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
  ```
- 索引：`(user_id, started_at DESC)`、`(project_id, started_at DESC)`、`(kind, started_at DESC)`。
- 月分区预留：本期不分区，参考 [docs/adr/0006-predictions-partition-by-month.md](docs/adr/0006-predictions-partition-by-month.md) 两阶段法，新建 ADR-0009 记录 task_events 月分区 Stage 2 触发条件（行数 > 1M 或单月 INSERT > 100k）。

### 1.3 后端批量写入 `POST /me/task-events:batch`

- 路由：`apps/api/app/api/v1/me.py` 新增 endpoint，body 为 `{ events: [...] }`，限制单批 ≤ 200。
- 异步路径：复用 [apps/api/app/workers/audit.py:21-37](apps/api/app/workers/audit.py) 模式，新增 `apps/api/app/workers/task_events.py:persist_task_events_batch(payload_list)`，受 `settings.audit_async`（或新 flag `TASK_EVENTS_ASYNC`）切换；sync fallback。
- 鉴权：登录用户只能写自己的 user_id（路由层 override）。

### 1.4 工作台埋点（前端）

- 扩展 [useSessionStats.ts](apps/web/src/pages/Workbench/state/useSessionStats.ts)：
  - 现有 ring buffer 旁边再维护 `pendingEvents: TaskEvent[]`。
  - 每次 task 切换 / submit 时 push 一条 `{task_id, kind: 'annotate'|'review', started_at, ended_at, duration_ms, annotation_count, was_rejected}`。
  - flush 触发：`pendingEvents.length >= 20` 或 WorkbenchShell unmount（`navigator.sendBeacon` 兜底）或显式 submit。
  - flush via `apiClient.post("/me/task-events:batch", { events })`，新文件 `apps/web/src/api/me.ts`。

### 1.5 物化视图 `mv_user_perf_daily`

- 迁移 `0040_mv_user_perf_daily.py`：
  ```sql
  CREATE MATERIALIZED VIEW mv_user_perf_daily AS
  SELECT
    user_id,
    date_trunc('day', started_at)::date AS day,
    SUM(annotation_count) FILTER (WHERE kind='annotate') AS throughput,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS median_duration_ms,
    SUM(CASE WHEN was_rejected THEN 1 ELSE 0 END) AS rejected_n,
    SUM(duration_ms)/60000 AS active_minutes,
    COUNT(*) AS event_count
  FROM task_events
  GROUP BY user_id, day;
  CREATE UNIQUE INDEX ON mv_user_perf_daily (user_id, day);
  ```
- Celery beat：`apps/api/app/workers/cleanup.py` 增加 `refresh_user_perf_mv()`，crontab `minute=5`（每小时第 5 分钟）`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_perf_daily`。
- 端点优先读视图，跨当天 last-hour 数据用「视图 ∪ 直查 task_events 当日」联合（视图 lag ≤ 1h 可接受 / 当日热数据走实时）。

---

## L2 · 个人 Dashboard 强化（前端）

### 2.1 AnnotatorDashboard 5 卡 → 9 卡三段

文件：[AnnotatorDashboard.tsx](apps/web/src/pages/Dashboard/AnnotatorDashboard.tsx)

- 新增 `<SectionDivider>` 原子组件（`apps/web/src/components/ui/SectionDivider.tsx`），仅一个 label + hr。
- 三段：
  - **产能**：今日完成 / 本周完成（带断点） / 平均单题耗时（中位 + tooltip 解释 vs 均值） / 累计完成
  - **质量**：原创比例 / 被退回率 / 重审次数 avg
  - **投入**：今日活跃时长 `—`（占位）/ 连续标注 streak `—`（占位）
- 每卡统一带 `↑/↓ 周环比`（StatCard 已有 trend prop，扩展支持 percentage delta）+ 7 日 Sparkline。
- 「专注时段分布」24-bar 直方图：本期占位组件 `<Histogram>` 渲染 + 「需在线状态心跳合并后启用」提示文字（依赖另一 session）。
- `weeklyTarget`：从 `useUserPreferences()` 读取，新增 `apps/web/src/api/me.ts:getMyPreferences()`，后端 `User.weekly_target_default INT`（迁移 0041）+ `ProjectMembership.weekly_target` 覆盖；fallback 200。

### 2.2 ReviewerDashboard 类比

文件：[ReviewerDashboard.tsx](apps/web/src/pages/Dashboard/ReviewerDashboard.tsx)

- 三段：产能（今日审核数 / 平均审核耗时 = `reviewed_at - reviewer_claimed_at` 中位 / 待审趋势）、质量（通过率 / 退回率 / 二次返修率 = 自己 approve 的 task 后又被 reopen 比例）、投入（占位）。
- 二次返修率：从 audit_logs 反查 `task.approve` followed by `task.reject` 同 task；后端 endpoint 新增 `reopen_after_approve` 字段。

### 2.3 后端端点扩展

文件：[dashboard.py:124-383](apps/api/app/api/v1/dashboard.py)

- `GET /dashboard/annotator` 新增字段：`median_duration_ms`、`rejected_rate`、`reopened_avg`、`weekly_compare_pct`、`sparkline_7d`、`active_minutes_today`（暂返 null）、`streak_days`（暂返 null）。
- `GET /dashboard/reviewer` 新增字段：`median_review_duration_ms`、`reopen_after_approve_rate`、`weekly_compare_pct`、`sparkline_7d`。
- 优先读 `mv_user_perf_daily`，当日数据兜底直查。

---

## L3 · 管理员人员看板（前端 + 后端）

### 3.1 新路由 `/admin/people`

- 路由文件：[App.tsx](apps/web/src/App.tsx) 增加 `<Route path="/admin/people" element={<AdminPeoplePage />} />`，权限同 AdminDashboard。
- AdminDashboard 顶部加「成员绩效 →」入口卡（次要导航，避免该页过长）。
- 页面文件：`apps/web/src/pages/Admin/AdminPeoplePage.tsx`。

### 3.2 顶部筛选栏（sticky）

- 角色 chip / 项目多选 / 时间窗口（今日/本周/本月/自定义）/ 在线状态（暂只渲染 disabled，待心跳）/ 排序 / 搜索框。
- 状态保存到 URL search params（便于分享 / 刷新保留）。

### 3.3 卡片网格（响应式 4/5/6 列）

- 新原子组件：
  - `apps/web/src/components/ui/RadialProgress.tsx` — 综合分圆环（SVG，不引图表库）。
  - `apps/web/src/components/ui/Histogram.tsx` — 详情页耗时分布（仿 [AdminDashboard.tsx:282-346](apps/web/src/pages/Dashboard/AdminDashboard.tsx) `RegistrationSourceCard` 风格）。
- 卡片内部：Avatar + 角色徽章 + 主指标大字（标注员=本周完成 / 审核员=本周审核） + 周环比 + 三条 mini bar（产能/质量/活跃，团队分位 0-100） + 7 日 Sparkline + 告警 chip（被退回率 > 15% 或周环比降 > 30%）。
- 响应式断点：`< 1280px` 4 列 / `≥ 1280px` 5 列 / `≥ 1600px` 6 列。

### 3.4 抽屉个人详情

- 复用现有 Drawer 模式（参考 NotificationsPopover / BugReportDrawer 实现）。
- 内容：4 hero KPI + 4 周趋势折线（多指标可叠加） + 项目分布饼图 + 任务耗时直方图（p50/p95 标注线） + 与团队中位数 diverging bar + 最近 50 条 timeline（audit_logs 反查） + super_admin 运营操作（重置周目标 / 移除项目权限，复用 UsersPage 现有动作）。

### 3.5 后端端点

文件：[dashboard.py](apps/api/app/api/v1/dashboard.py) 新增三个 super_admin-only 端点：

- `GET /dashboard/admin/people?role=&project=&period=7d&sort=throughput&q=`
  - 返回每人：基础信息 + 三个分位值（throughput / quality / active 0-100，与团队中位数比） + sparkline 7 点 + 告警 flags。
  - 主体 SQL 走 `mv_user_perf_daily` JOIN `users` JOIN `project_memberships`。
- `GET /dashboard/admin/people/{user_id}?period=4w`
  - 趋势点数组、耗时直方图 buckets（10 桶）、timeline 分页。
- `GET /dashboard/admin/people/leaderboard?period=4w`
  - 可选 Tab，本期占位返回 501 / 不在 UI 暴露。

### 3.6 隐私 / 工会风险

- 标注员 dashboard（L2）只展示自己 + 团队中位数对比，不展示具体排名。
- L3 排名 / 完整人员视图仅 super_admin 可见（路由 + endpoint 双重 RBAC）。

---

## 关键文件清单

### 新建
- `apps/api/alembic/versions/0038_task_assigned_at.py`
- `apps/api/alembic/versions/0039_task_events.py`
- `apps/api/alembic/versions/0040_mv_user_perf_daily.py`
- `apps/api/alembic/versions/0041_user_weekly_target.py`
- `apps/api/app/db/models/task_event.py`
- `apps/api/app/workers/task_events.py`
- `apps/web/src/pages/Admin/AdminPeoplePage.tsx`
- `apps/web/src/components/ui/{SectionDivider,RadialProgress,Histogram}.tsx`
- `apps/web/src/api/me.ts`
- `docs/adr/0009-task-events-table-and-partition.md`
- `tests/test_task_events_batch.py`、`tests/test_dashboard_people.py`

### 修改
- [apps/api/app/db/models/task.py:9-72](apps/api/app/db/models/task.py)（+ assigned_at）
- [apps/api/app/db/models/user.py:9-49](apps/api/app/db/models/user.py)（+ weekly_target_default）
- [apps/api/app/services/batch.py:247-255](apps/api/app/services/batch.py)（cascade 写 assigned_at）
- [apps/api/app/api/v1/dashboard.py](apps/api/app/api/v1/dashboard.py)（扩展三 endpoint + 新增 admin/people 三 endpoint）
- [apps/api/app/api/v1/me.py](apps/api/app/api/v1/me.py)（task-events:batch + preferences）
- [apps/api/app/workers/cleanup.py](apps/api/app/workers/cleanup.py)（hourly REFRESH MV）
- [apps/web/src/pages/Workbench/state/useSessionStats.ts](apps/web/src/pages/Workbench/state/useSessionStats.ts)（pendingEvents + flush）
- [apps/web/src/pages/Dashboard/AnnotatorDashboard.tsx](apps/web/src/pages/Dashboard/AnnotatorDashboard.tsx)（5 → 9 卡三段）
- [apps/web/src/pages/Dashboard/ReviewerDashboard.tsx](apps/web/src/pages/Dashboard/ReviewerDashboard.tsx)（三段）
- [apps/web/src/pages/Dashboard/AdminDashboard.tsx](apps/web/src/pages/Dashboard/AdminDashboard.tsx)（顶部「成员绩效 →」入口）
- [apps/web/src/App.tsx](apps/web/src/App.tsx)（+ /admin/people 路由）
- [CHANGELOG.md](CHANGELOG.md)、[ROADMAP.md](ROADMAP.md)（v0.8.4 收口条目 + P1 行划掉）

---

## 验证

后端：
- `uv run alembic upgrade head` 三/四个迁移依次成功；`uv run pytest apps/api/tests/test_task_events_batch.py apps/api/tests/test_dashboard_people.py -v`。
- 手动：登录 super_admin → `GET /dashboard/admin/people` 返回非空 + 三 endpoint 200。
- 物化视图：`uv run celery -A app.workers beat` 启动后 1 小时内观察日志 `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_perf_daily` 成功；手动触发 `psql -c "REFRESH ..."` 验证 SQL 正确。

前端：
- `pnpm --filter web dev` → 三个 dashboard 视觉回归（Annotator 9 卡三段对齐 / Reviewer 类比 / Admin 入口卡）。
- `/admin/people` 卡片网格在 1280 / 1600 断点切列；筛选 / 排序 / 搜索 url-sync；点击卡片抽屉展开 4 hero + 趋势 + 直方图 + timeline。
- `pnpm --filter web test` 新增 RadialProgress / Histogram / SectionDivider 单测；AdminPeoplePage filter state 单测。
- E2E 占位：`e2e/admin-people.spec.ts.skip` 留空（与 ROADMAP「E2E 写实」P1 共建）。

文档：
- `pnpm docs:build` 通过（CI gate v0.8.2 已上）。
- ADR-0009 状态 = Proposed。

---

## 风险与取舍

- **老数据 `assigned_at` NULL**：迁移前已有 task 的中位耗时计算需 `WHERE assigned_at IS NOT NULL`，前端展示「样本 < 30，参考价值低」提示。
- **MV 当日 lag**：用「MV ∪ 当日 task_events 直查」联合，单租户量级实测应 < 100ms；监控 `slow_query_log`，触发再优化。
- **task_events 高频写**：单标注员每分钟 ~1-2 条（task 切换粒度），1 万标注员/日峰值 ~14M 行 → 1 月 ~420M。本期不分区是临时方案，ADR-0009 锁定 1M 行 / 100k 单月 INSERT 阈值；监控触发执行 Stage 2。
- **心跳依赖**：活跃时长 / streak / 专注时段三项 graceful degrade 到 `—`，前端硬编码 null 检查；待另一 session 合并后无需改前端，仅后端 endpoint 切真实计算。
- **L3 卡片网格性能**：1 次请求 5 列 × 10 行 = 50 张卡 × 7 点 sparkline，payload ~30KB；可接受，无需虚拟化。
