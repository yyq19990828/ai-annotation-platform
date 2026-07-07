# v0.8.5 — fabric 清理 + 24-bar 直方图 + 测试基建升级

> 日期：2026-05-06 · 范围：ROADMAP「v0.7.x ~ v0.8.0 后续观察」`fabric.js dead dep 清理` + 「效率看板尾巴」AnnotatorDashboard 专注时段直方图 + 「测试 / 开发体验」前端单测推到 25% + E2E 写实。

## Context

v0.8.4 已落「效率看板 / 人员绩效 epic（L1+L2+L3）」，剩三个尾巴需要在 v0.8.5 收口：

1. **fabric.js dead dep**：`apps/web/package.json` 仍有 `fabric@^6.5.0`，但 `apps/web/src/` 全量 grep 零引用（`App.tsx:22` 仅有一条 lazy-load 注释提到名字）。每次 `pnpm install` 都装 ~150KB 无用库 + 一项 supply-chain 风险面。已在 ADR-0004 评估通过可删。
2. **AnnotatorDashboard 24-bar 专注时段直方图**：v0.8.4 已造好 `<Histogram>`（用于 AdminPeoplePage 抽屉），但个人 dashboard 仍未接 `task_events` 按小时的 24-bar 视图，导致标注员看不到自己的专注节律分布。
3. **前端单测 ≥25% + E2E 写实**：v0.8.3 把单测从 4.27% → 10.88% 并切硬阻断 10%，annotation/batch-flow 两个 E2E spec 仍是「最小 happy path（路由可达即过）」，覆盖率与执行深度都还没到能在 production 兜底回归的程度。

用户决策（已确认）：
- 单测目标 25%，**CI 阈值同步上调到 25%（激进）**
- E2E 在工作台业务组件加 **data-testid**（少量、稳定，不与文案耦合）
- 直方图范围 **仅当日 0-23 时**（与 `active_minutes_today` 同口径）

---

## Scope

### A. fabric.js 移除（5 分钟）

修改：
- `apps/web/package.json:26` — 删 `"fabric": "^6.5.0",`
- `apps/web/src/App.tsx:22` — 注释里把 `fabric` 字样删掉，保留 konva 描述
- `apps/web/pnpm-lock.yaml` — 由 `pnpm install` 自动重生，提交 lock 变化

验证：`pnpm install` + `pnpm build` 通过；`pnpm typecheck` + `pnpm test` 全绿。

### B. AnnotatorDashboard 专注时段 24-bar 直方图

#### 后端

`apps/api/app/api/v1/dashboard.py` `/dashboard/annotator` 端点（约第 400 行起，邻近 `active_minutes_today` 计算块）：

```python
# 24-bar 当日专注时段：按 EXTRACT(hour) GROUP BY，聚合 duration_ms 转分钟
hour_rows = await db.execute(
    select(
        func.extract("hour", TaskEvent.started_at).label("hour"),
        func.coalesce(func.sum(TaskEvent.duration_ms), 0).label("ms"),
    )
    .where(
        TaskEvent.user_id == current_user.id,
        TaskEvent.kind == "annotate",
        TaskEvent.started_at >= today_start,
        TaskEvent.started_at < today_start + timedelta(days=1),
    )
    .group_by(func.extract("hour", TaskEvent.started_at))
)
hour_map = {int(r.hour): int(r.ms // 60_000) for r in hour_rows}
hour_buckets = [hour_map.get(h, 0) for h in range(24)]
```

`apps/api/app/schemas/dashboard.py` `AnnotatorDashboardStats`：
- 新增 `hour_buckets: list[int] = Field(default_factory=lambda: [0] * 24, description="当日 0-23 时分钟数")`

#### 前端

`apps/web/src/api/dashboard.ts`（或 `hooks/useDashboard.ts` 类型定义处）：
- `AnnotatorDashboardStats` 接口加 `hour_buckets: number[]`

`apps/web/src/pages/Dashboard/AnnotatorDashboard.tsx`：
- 在「投入」section 之后、`MyBatchesCard` 之前插入新 Card：

```tsx
<Card style={{ marginTop: 16 }}>
  <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>今日专注时段分布</h3>
    <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--color-fg-subtle)" }}>
      按小时聚合的标注分钟数（0-23 时）
    </p>
  </div>
  <div style={{ padding: "20px 16px" }}>
    <Histogram
      values={stats.hour_buckets ?? Array(24).fill(0)}
      height={80}
      xLabels={["00:00", ...Array(22).fill(""), "23:00"]}
    />
  </div>
</Card>
```

#### 测试

- `apps/api/tests/api/test_dashboard.py` 加 case：种 3 条不同小时的 `task_events`，断言 `hour_buckets` 长度 24、对应 hour 索引值正确、其他位为 0
- `apps/web/src/pages/Dashboard/AnnotatorDashboard.test.tsx`（新增）：mock `useAnnotatorStats` 返回带 `hour_buckets` 的 stats，断言渲染 24 个 bar（顺手贡献 1pp 覆盖率）

### C. 前端单测 10.88% → ≥25%（硬阻断 25%）

**新增 ~8-10 个测试文件，按价值排序**：

| 优先级 | 测试文件 | 覆盖目标 | 预期增量 |
|---|---|---|---|
| P0 | `pages/Dashboard/AnnotatorDashboard.test.tsx` | 加载状态 / 空项目 / formatMs 边界 / hour_buckets 渲染 | ~1.5pp |
| P0 | `pages/Dashboard/ReviewerDashboard.test.tsx` | 加载状态 / handleApprove / handleReject 异步 | ~1.5pp |
| P0 | `pages/Dashboard/AdminDashboard.test.tsx` | 加载状态 / wizard 入口 / 卡片网格 | ~2pp |
| P0 | `pages/Dashboard/DashboardPage.test.tsx` | 角色分派路由（admin/annotator/reviewer/viewer 各一组） | ~1.5pp |
| P0 | `components/users/InviteUserModal.test.tsx` | open=false 不渲染 / 角色权限映射 / submit 调用 mutation | ~1.5pp |
| P0 | `pages/Register/RegisterPage.test.tsx` | OpenRegisterForm 密码强度 / InviteRegisterForm 错 token / 提交流 | ~2pp |
| P1 | `utils/formatters.test.ts`（如不存在则就近抽出） | formatMs / formatDuration / 时间格式化等 pure 函数 | ~0.5pp |
| P1 | `pages/Projects/ProjectsPage.test.tsx` | 卡片网格 / 搜索过滤 / 排序 | ~2pp |
| P1 | `hooks/useDashboard.test.ts` | useAnnotatorStats / useReviewerStats / useAdminStats MSW 链路 | ~1.5pp |
| P2 | `components/ui/Histogram.test.tsx` | values 全 0 / xLabels / markers 渲染 | ~0.3pp |

合计预期增量 ~14pp，目标终值 ~24-25%（含安全边际）。**实际跑覆盖率后微调**：若不足 25% 再补 ProjectSettingsPage 或 WorkbenchShell 关键 hook 单测。

`apps/web/vite.config.ts:78-83` 阈值同步上调：

```ts
thresholds: {
  lines: 25,
  statements: 25,
  functions: 30,   // 当前 functions 已超 30%，维持
  branches: 60,    // 维持
},
```

`vite.config.ts:73-77` 注释更新：v0.8.5 推到 X.XX%（按实测填）+ 阈值 25% 切硬阻断。

### D. E2E 写实化

#### D.1 工作台 data-testid 注入（最小集）

只在 spec 用得到的 4 处加 `data-testid`，避免大面积侵入：

| 组件 | 位置 | testid |
|---|---|---|
| BBox 工具按钮 | `apps/web/src/pages/Workbench/shell/ToolDock.tsx` 工具循环渲染处 | `tool-btn-bbox`（含工具 id 模板字符串） |
| 画布 Stage 容器 | `apps/web/src/pages/Workbench/stage/Stage.tsx`（外层 div 而非 react-konva Stage） | `workbench-stage` |
| 提交/保存按钮 | `apps/web/src/pages/Workbench/shell/Topbar.tsx` 或 AnnotateSidebar | `workbench-submit`、`workbench-save` |
| 项目设置 → 批次 tab | `apps/web/src/pages/Projects/ProjectSettingsPage.tsx` | `settings-tab-batches` |

> testid 命名约定：`<scope>-<element>-<variant>`，全小写连字符。后续测试沿用同前缀。

#### D.2 annotation.spec.ts 升级

完整 bbox 拖框流程（用 `page.mouse` 操纵 Konva Stage 的 DOM 坐标）：

```ts
test("annotator → 画 bbox → 选标签 → 提交 → 任务推进", async ({ page, seed }) => {
  const data = await seed.reset();
  await seed.injectToken(page, data.annotator_email);
  await page.goto(`/projects/${data.project_id}/annotate`);

  // 1. 切换到 bbox 工具（B 快捷键 或 testid）
  await page.getByTestId("tool-btn-bbox").click();

  // 2. 在 Stage 上拖框（坐标基于 boundingBox）
  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("stage not visible");
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 250, { steps: 10 });
  await page.mouse.up();

  // 3. 选类别（弹出的 LabelPicker，第 1 个标签）
  await page.getByRole("button", { name: /标识牌|车辆|人/ }).first().click();

  // 4. 提交任务
  await page.getByTestId("workbench-submit").click();

  // 5. 任务列表项数 -1 / 当前任务推进
  await expect(page.getByText(/已提交|完成/)).toBeVisible({ timeout: 5000 });
});
```

保留旧 case「路由可达」作为 smoke。

#### D.3 batch-flow.spec.ts 升级

多角色流转：annotator 标完 1 个任务 → reviewer 复审通过 → admin 看到批次状态变化。

```ts
test("annotator 提交 → reviewer 通过 → 批次状态推进", async ({ page, seed }) => {
  const data = await seed.reset();

  // Step 1. annotator 提交 1 个任务（复用 annotation.spec 的最小动作或调 API 直接置 task=submitted）
  await seed.injectToken(page, data.annotator_email);
  await page.goto(`/projects/${data.project_id}/annotate`);
  // ...画框 + 提交（同 D.2 简化版）

  // Step 2. reviewer 登录 → /review 看到任务 → 通过
  await page.context().clearCookies();
  await seed.injectToken(page, data.reviewer_email);
  await page.goto("/review");
  await page.getByRole("button", { name: /通过|批准/ }).first().click();

  // Step 3. admin 在项目设置 batches tab 看到 in_review 计数 -1
  await page.context().clearCookies();
  await seed.injectToken(page, data.admin_email);
  await page.goto(`/projects/${data.project_id}/settings`);
  await page.getByTestId("settings-tab-batches").click();
  await expect(page.getByText(/审核中|in_review/)).toBeVisible();
});
```

> 实施时若发现 reviewer UI / admin batches tab 路径与现状不符，按当前实现微调；保持「三角色串联」语义不变。

#### D.4 _test_seed 端点能力补充（可能需要）

如果 D.3 走 UI 路径太脆，给 `apps/api/app/api/v1/_test_seed.py` 加一个辅助端点：

- `POST /api/v1/__test/seed/advance_task {task_id, to_status, annotation?}` — 直接把 task 推进到 submitted/in_review/completed 状态，绕过 UI

这样 batch-flow.spec 可以专注验证「reviewer 通过」与「admin 视图状态正确」，不需要复读 D.2 的画框流程。

---

## 关键文件清单

### 修改

- `apps/web/package.json` — 删 fabric
- `apps/web/src/App.tsx:22` — 改注释
- `apps/web/vite.config.ts:78-83` — 阈值上调到 25
- `apps/web/src/pages/Dashboard/AnnotatorDashboard.tsx` — 加 Histogram Card
- `apps/web/src/api/dashboard.ts` 或 `hooks/useDashboard.ts` — `hour_buckets` 类型
- `apps/api/app/api/v1/dashboard.py` — `/dashboard/annotator` 加 SQL + 字段
- `apps/api/app/schemas/dashboard.py` — `AnnotatorDashboardStats.hour_buckets`
- `apps/web/src/pages/Workbench/shell/ToolDock.tsx`、`stage/Stage.tsx`、`shell/Topbar.tsx`、`pages/Projects/ProjectSettingsPage.tsx` — 4 处 data-testid
- `apps/web/e2e/tests/annotation.spec.ts` — bbox 拖框完整链
- `apps/web/e2e/tests/batch-flow.spec.ts` — 多角色串联
- `apps/api/app/api/v1/_test_seed.py` — 视实施情况加 advance_task 辅助端点

### 新增

- `apps/web/src/pages/Dashboard/AnnotatorDashboard.test.tsx`
- `apps/web/src/pages/Dashboard/ReviewerDashboard.test.tsx`
- `apps/web/src/pages/Dashboard/AdminDashboard.test.tsx`
- `apps/web/src/pages/Dashboard/DashboardPage.test.tsx`
- `apps/web/src/components/users/InviteUserModal.test.tsx`
- `apps/web/src/pages/Register/RegisterPage.test.tsx`
- `apps/web/src/pages/Projects/ProjectsPage.test.tsx`
- `apps/web/src/hooks/useDashboard.test.ts`
- `apps/web/src/components/ui/Histogram.test.tsx`
- `apps/api/tests/api/test_dashboard.py` 加 hour_buckets case（如文件已存在则合并）

---

## 复用的现有资产

- `apps/web/src/components/ui/Histogram.tsx` — props 已支持 `xLabels` / `markers`，无需改组件本身
- `apps/api/app/db/models/task_event.py` — `started_at` / `duration_ms` / `kind='annotate'` 字段就位
- `apps/web/e2e/fixtures/seed.ts` — `SeedAPI.reset()` / `injectToken()` 已可用，新 spec 直接复用
- `apps/web/src/mocks/handlers.ts` — MSW baseline 就位，新单测按需 `server.use()` 临时注入
- `apps/web/src/pages/Workbench/state/*.test.ts` — 10 个现有测试可参考组织风格

---

## 验证

### 本地

```bash
# 前端
cd apps/web
pnpm install                    # 验证 fabric 移除后 lock 干净
pnpm typecheck
pnpm test:coverage              # 必须 ≥25% lines，否则不通过
pnpm build                      # 验证 bundle 不再含 fabric
pnpm test:e2e                   # 三个 spec 全绿，annotation/batch-flow 不再是 smoke

# 后端
cd ../api
pytest tests/api/test_dashboard.py -k hour_buckets -v
```

### 手动 UI 验证

1. 启动本地（`make dev` 或 docker-compose）
2. 用 annotator 账号登录 → Dashboard：「今日专注时段分布」卡片应展示 24 个柱（无数据时全为 1px 占位）
3. 在 `/annotate` 标几道题 → 回 Dashboard 看对应小时柱抬升
4. 关闭 docker postgres 模拟空数据，确认 dashboard 不崩

### CI

- `vitest` job 阈值升到 25 后须绿
- `e2e` job 三 spec 全绿（含 bbox 拖框 + 多角色串联）
- bundle size action（如有）应观察到 fabric 移除后 ~150KB 减少

---

## CHANGELOG / ROADMAP 更新

提交前更新 `CHANGELOG.md`：新增 `## v0.8.5 — fabric 清理 / 24-bar 专注时段 / 单测 25% 硬阻断 / E2E 写实化` section，列以下要点：
- 删除 fabric@^6.5.0 dead dep（ADR-0004 评估通过）
- AnnotatorDashboard 新增「今日专注时段分布」24-bar 直方图
- 前端单测 lines 覆盖率推到 ≥25%（实际填具体值）+ CI 硬阻断 25%
- E2E annotation.spec / batch-flow.spec 写实化（含工作台关键 data-testid）
- E2E 工作台引入 4 处 data-testid（tool-btn-bbox / workbench-stage / workbench-submit / settings-tab-batches）

`ROADMAP.md` 同步标记完成（移到 CHANGELOG）：
- A 区「fabric.js dead dep 清理」整条删除
- B 区「AnnotatorDashboard 24-bar 专注时段直方图」整条删除
- B 区「前端单元测试 — 页面级覆盖」更新当前覆盖率与下个目标（如果继续推到 40%）
- B 区「E2E spec 深度写实」整条删除
- 优先级表 P1「E2E spec 深度写实」标完成

---

## 工作量估算

| 任务 | 估时 |
|---|---|
| A. fabric 清理 | 10min |
| B. 24-bar 直方图（后端 + 前端 + 测试） | 1.5h |
| C. 9 个新单测文件（25%） | 5-6h |
| D. E2E + data-testid + advance_task | 3-4h |
| 文档（CHANGELOG / ROADMAP） | 30min |
| **合计** | ~10-12h |
