# v0.7.0 — 批次状态机重设计 + v0.6.x 收尾

## Context

v0.6.10-hotfix 已修 B-16（服务端强制 batch 可见性），同时摸到批次状态机一整片体感问题：语法到位但鉴权不严、UI 不全、reviewer 视角断层、reject 数据语义未决。配合 v0.6.x 期间累计的写时观察项（共 18 条 polish），本版作为一次集中收口。

**目标：**
1. **完成批次状态机重设计 epic**：transition 鉴权、reviewer 可见性、批次级 review UI、reject_batch 软重置语义、空批次拦截、状态语义 + 通知接入、测试覆盖。
2. **v0.6.x 后续观察 / 下版候选** 章节全部收尾（涉及 LLM 的留白）。

**对齐要点（用户已确认）：**
- reject_batch 采用**方案 A 软重置**：仅 `task.status = pending`，不动 `is_labeled` 与 `annotations`，给批次贴 `rejected` + 写 `review_feedback`。
- 通知偏好做**基础静音**：`notification_preferences` 表 + 设置页 type 静音 UI + fan-out 时按偏好过滤；邮件 digest（依赖 LLM 聚类 + SMTP）留白。
- WorkbenchShell Topbar 拆分**已落**（`apps/web/src/pages/Workbench/shell/Topbar.tsx` 已是独立 130 行组件），CHANGELOG 中 close 该 P3 项。
- 0-task 批次：**前端 disable 激活按钮 + 后端 draft→active transition 校验 total_tasks > 0**。

---

## Phase 1 · 批次状态机重设计 epic（P1）

### 1.1 `/transition` 端点按转换分别鉴权

**文件**：`apps/api/app/api/v1/batches.py:125-184`

将单一 `require_project_visible` 替换为按 `from_status → to_status` 分发的鉴权矩阵，仍由 `require_project_visible` 解决项目可见性（保留 404 隐藏语义），在端点函数内根据 `(batch.status, data.target_status)` 二次校验角色：

| from → to | 允许角色 |
|---|---|
| `draft → active` | super_admin / project_admin（owner） |
| `active → annotating` | （仅 `check_auto_transitions` 自动驱动，REST 拒绝） |
| `annotating → reviewing` | 标注员（仅 `assigned_user_ids` 含自己的批次）/ owner / super_admin |
| `reviewing → approved` | reviewer / owner / super_admin |
| `reviewing → rejected` | reviewer / owner / super_admin |
| `rejected → active` | owner / super_admin（重激活） |
| 任意 `→ archived` | owner / super_admin |

实现：抽 `_assert_can_transition(user, batch, target_status)` helper（`apps/api/app/services/batch.py` 内），在端点和未来批量 transition 接口共用。403 错误明确返回 `{"detail": "role_x cannot transition <from> -> <to>"}` 便于前端 toast。

### 1.2 reviewer 视角可见性修复

**文件**：`apps/api/app/services/scheduler.py:26`、`apps/api/app/api/v1/tasks.py`、`apps/api/app/api/v1/reviews.py`

当前 `WORKBENCH_VISIBLE_BATCH_STATUSES = ['active','annotating']` 把 reviewer 也挡在 reviewing 批次外。改造：

1. 拆出两个常量：
   ```python
   ANNOTATOR_VISIBLE_BATCH_STATUSES = ['active', 'annotating', 'rejected']
   REVIEWER_VISIBLE_BATCH_STATUSES = ['active', 'annotating', 'reviewing']
   ```
2. `batch_visibility_clause(role)` helper 接受角色入参，按角色返回不同 IN 子句；owner / super_admin 不附加 batch 过滤。
3. **特例**：`rejected` 状态对**被分派的标注员**可见（让标注员看到 reviewer 留言并配合「重新激活」流程）。在 helper 中对 annotator 角色加 `OR (batch.status='rejected' AND :user_id = ANY(batch.assigned_user_ids))`。
4. ReviewPage（`apps/web/src/pages/Review/ReviewPage.tsx:85-92`）的前端过滤复用同一可见性 helper（避免一致性漂移）。

### 1.3 批次级 review UI 全缺

**文件**：`apps/web/src/pages/Projects/sections/BatchesSection.tsx:235-261`

当前仅 4 按钮（▶ 激活 / ↻ 重激活 / 🗄 归档 / 🗑 删除）。新增：

| 按钮 | 显示条件 | 调用 | 鉴权位置 |
|---|---|---|---|
| ✓ 提交质检 | `status='annotating'` | `PATCH /transition` `target=reviewing` | owner / 标注员（被分派）|
| ✓ 通过 | `status='reviewing'` | `PATCH /transition` `target=approved` | reviewer / owner |
| ✗ 驳回 | `status='reviewing'` | 弹 modal 输入 `review_feedback` → `POST /reject` | reviewer / owner |

**驳回 modal**（新组件 `apps/web/src/pages/Projects/sections/RejectBatchModal.tsx`）：
- 必填 textarea（review_feedback，最大 500 字）。
- 二次确认 + 红色按钮（与 UnlinkConfirmModal 强度一致）。
- 提交后调 `POST /projects/{pid}/batches/{bid}/reject` 并把 `feedback` 作为 body 字段（端点签名同步扩展）。

**状态看板**（仅 owner 视角，新建 tab `批次看板`）：
- 用 `<DropdownMenu>` 风格的 7 列卡片墙（draft/active/annotating/reviewing/approved/rejected/archived）。
- 不做拖拽（避免与 transition 鉴权冲突），单击批次卡片即跳现有 BatchesSection 行操作。
- 与表格视图通过段头 toggle 切换；表格保留为默认。

### 1.4 reject_batch 软重置（方案 A）

**文件**：`apps/api/app/services/batch.py:394-416`、`apps/api/app/db/models/batch.py`

1. **schema 改造**：alembic 0027 — `task_batches` 表新增 `review_feedback TEXT NULL`、`reviewed_at TIMESTAMPTZ NULL`、`reviewed_by UUID NULL` 三列。
2. **reject_batch 函数体改写**：
   ```python
   async def reject_batch(self, batch_id, *, feedback: str, reviewer_id: UUID) -> tuple[TaskBatch, int]:
       batch = ...
       # 软重置：只把 review/completed 任务回退到 pending；
       # 不改 is_labeled，不动 annotations
       result = await self.db.execute(
           update(Task)
           .where(Task.batch_id == batch_id, Task.status.in_(["review", "completed"]))
           .values(status="pending")
       )
       affected = result.rowcount
       batch.status = BatchStatus.REJECTED
       batch.review_feedback = feedback
       batch.reviewed_at = datetime.utcnow()
       batch.reviewed_by = reviewer_id
       await self.db.flush()
       await self.recalculate_counters(batch_id)
       return batch, affected
   ```
3. **审计 + 通知**：API 端点层（`POST /batches/{id}/reject`）扩展：
   - audit_log 同步 v0.6.x 已有 `BATCH_REJECTED`，新增 `feedback` 入 detail。
   - 调 `NotificationService.notify_many` 给 `assigned_user_ids` 推 `batch.rejected` 类型通知，`payload={"batch_display_id", "feedback", "project_id"}`。

### 1.5 0-task 批次拦截

**文件**：`apps/web/src/pages/Projects/sections/BatchesSection.tsx`、`apps/api/app/services/batch.py`

1. **前端**：「▶ 激活」按钮 `disabled = batch.assigned_user_ids.length === 0 || batch.total_tasks === 0`；hover title 提示原因。`useBatches` 返回的 `batch` 对象需含 `total_tasks`（确认 BatchOut schema 已暴露；如未暴露，后端 schema 同步加）。
2. **后端**：`_assert_can_transition` 在 `draft → active` 分支内检查 `select(func.count()).where(Task.batch_id == batch_id)` > 0，否则 400 `{"detail": "cannot activate empty batch"}`。
3. `check_auto_transitions` 不变（`annotating → reviewing` 空批次自动跳转的现有行为保留——只有非空批次才会进入 annotating，逻辑上一致）。

### 1.6 状态语义在前端展示

**文件**：`apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx:88-102`、`apps/web/src/pages/Dashboard/AnnotatorDashboard.tsx`

1. **owner 批次表行**：BatchesSection 现有 7 态 Badge variant 已正确（`STATUS_VARIANTS` 行 32-40 完整），保持。
2. **标注员 dashboard「我的批次」分组**（AnnotatorDashboard 新增小节）：分 `active/annotating`、`reviewing`、`rejected` 三组；`rejected` 组每条显示 reviewer feedback 摘要。
3. **rejected 通知接入**：v0.6.9 通知中心 fan-out（在 1.4 已实现）。NotificationsPopover.handleRowClick 增加 `batch.rejected` target_type 路由 → 跳 `/projects/{pid}/annotate?batch={bid}`（与下方 2.10 通知路由感知一并实现）。

### 1.7 测试覆盖（新增 `apps/api/tests/test_batch_lifecycle.py`）

5 个 test class：

1. `TestTransitionAuth` — 各角色调 `/transition` 的 401/403 矩阵；核心：标注员不能直推 approved、不能跨态。
2. `TestRejectBatchSoftReset` — `reject_batch` 后：① `task.status='pending'` 但 `is_labeled` 保持原值；② `annotations.is_active` 不变；③ batch 上有 `review_feedback / reviewed_at / reviewed_by`；④ 标注员能查到通知。
3. `TestEmptyBatchActivation` — 0-task 批次 `draft→active` 返回 400；导入 1 task 后能正常激活。
4. `TestWithdrawCascade` — 标注员 withdraw 触发 reviewing → annotating 反推（v0.6.x 已有正确实现，本测试固化）。
5. `TestReviewerVisibility` — reviewer 在 `reviewing` 批次的可见性；annotator 在 `rejected` 批次的可见性（特例放行）。

复用 `test_task_batch_visibility.py` 的 seed 函数（行 21-85），fixture 已就位。

### 1.8 留白：`on_batch_approved` hook（依赖 ML backend / 训练队列基座）

**文件**：`apps/api/app/services/batch.py:420-421`

保留 `logger.info(...)` no-op，添加 TODO 注释指向 v0.7.x 后续（active learning 闭环依赖 ML backend 训练队列基座，A · AI/模型 区列出，v0.7.0 不做）。

---

## Phase 2 · v0.6.x 收尾项

### 后端

#### 2.1 `Project.in_progress_tasks` 改 stored 列

**文件**：`apps/api/app/db/models/project.py`、`apps/api/app/api/v1/projects.py:63-69`、所有 `task.status = ...` 写点

1. alembic 0028：`projects` 表新增 `in_progress_tasks INTEGER NOT NULL DEFAULT 0` 列；同迁移内一次性 `UPDATE projects SET in_progress_tasks = (SELECT COUNT(*) FROM tasks WHERE tasks.project_id = projects.id AND tasks.status = 'in_progress')` 回填。
2. 在 task service 状态机变迁处（grep `task.status = "in_progress"` / `task.status = "review"` / etc.）维护增减，封装 `_bump_project_in_progress(db, project_id, delta)`。关键写点位于 `apps/api/app/services/task.py`、`apps/api/app/services/scheduler.py`（lock_acquire）。
3. 删 `_serialize_project` 内即时 COUNT 查询，直接读字段。

#### 2.2 `POST /orphan-tasks/cleanup` 大批量优化

**文件**：`apps/api/app/api/v1/projects.py:450-506`

7 条 `ANY(:ids)` 合并为单事务 + CTE：先 `WITH orphan_ids AS (SELECT id FROM tasks WHERE project_id=:pid AND batch_id IS NULL)`，下游 DELETE / UPDATE 全部联查 CTE 而非传 array。10万级孤儿规模下避免 array 序列化开销。

#### 2.3 link_project 同名 batch 去重命名

**文件**：`apps/api/app/services/dataset.py:309-326`

`name=f"{ds.name} 默认包"` 改为查询同 project 现有同名 batch 数 `n`，命名 `f"{ds.name} 默认包" + (f" #{n+1}" if n > 0 else "")`。同时把 display_id 后缀从 B-DEFAULT 改为 next_display_id（v0.6.8 已解耦，本步仅清理硬编码）。

#### 2.4 dead code 删除：`GET /auth/me/notifications`

**文件**：`apps/api/app/api/v1/me.py:47-130`

直接删端点 + 路由注册；同时清理 audit-derived 派生函数（grep 引用确认无其它消费）。前端已切换至 `/notifications` 新端点。

#### 2.5 bug_reports reopen 单独限流

**文件**：`apps/api/app/api/v1/bug_reports.py:234-281`

评论端点 60/h 整体限流保留；`reopen` 路径加独立限流：在 `BugReportService.add_comment()` 检测到 `was_reopened=True` 时，先查 Redis 计数器 `bug:reopen:{user_id}:{report_id}:day`，超过 5/day 拒绝并返回 429。

#### 2.6 WS 多副本 + 心跳

**文件**：`apps/api/app/api/v1/ws.py:33-72`

1. 引入 `redis.asyncio.ConnectionPool`，模块级单例 `_REDIS_POOL = ConnectionPool.from_url(settings.redis_url, max_connections=200)`；WS 端点改用 `Redis(connection_pool=_REDIS_POOL)`。
2. 服务端心跳：每 30s 通过 `await websocket.send_json({"type":"ping"})`；客户端不需响应（仅防 LB idle timeout）。`asyncio.create_task(_heartbeat_loop())` 与 pubsub listen 并行。
3. 客户端：`apps/web/src/hooks/useNotificationsWs.ts`（或现有路径）增加 ping 帧识别（不渲染、不入队）。

#### 2.7 通知偏好（基础静音）

**文件**：alembic 新表 + `apps/api/app/db/models/notification.py`、`apps/api/app/services/notification.py:70-93`、`apps/web/src/pages/Settings/SettingsPage.tsx`

1. alembic 0029：`notification_preferences (user_id UUID PK, type VARCHAR(60) PK, channels JSONB DEFAULT '{"in_app":true,"email":false}')`。
2. `NotificationService.notify_many` 改造：在 INSERT 前按 `(user_id, type)` 查 preferences；`channels.in_app=false` 跳过插入（且不发 pubsub）。无记录默认 in_app=true。
3. 设置页新增 `NotificationPreferencesSection`（路径在 SettingsPage section 注册表加 `"notifications"`）：列出当前已知的 5 个 type（`bug_report.commented` / `bug_report.reopened` / `bug_report.status_changed` / `batch.rejected` / `batch.approved`），每条一个 toggle（in_app 静音）。
4. 邮件 digest 留白：channels.email 字段保留，UI 暂不显示 email 开关，标记 TODO `// 等 LLM 聚类去重 + SMTP 落地后启用`。

### 前端

#### 2.8 Wizard step 2 升级到完整 ClassesSection

**文件**：`apps/web/src/components/projects/CreateProjectWizard.tsx:431-524`、`apps/web/src/pages/Projects/sections/ClassesSection.tsx`

1. 从 ClassesSection 抽 `<ClassEditor>` 子组件（颜色编辑、上下移、删除、父子结构），约 90 行。改为受控组件接受 `value: ClassConfig[] / onChange`。
2. ClassesSection 改为 `<ClassEditor>` + 顶部「保存」按钮的薄外壳。
3. CreateProjectWizard step 2 把 `form.classes: string[]` 升级为 `form.classes_config: ClassConfig[]`，复用 `<ClassEditor>`。提交时序列化为 ProjectCreate.classes_config。
4. 后端 `POST /projects` 已支持 classes_config（schema 检查），仅前端串通即可。

#### 2.9 Wizard 新增「属性 schema」步骤

**文件**：`apps/web/src/components/projects/CreateProjectWizard.tsx`、`apps/web/src/pages/Projects/sections/AttributesSection.tsx`

1. 从 AttributesSection 抽 `<AttributeSchemaEditor>`（字段类型 / 必填 / hotkey / visible_if / applies_to / select 选项 / min/max），约 150 行受控组件。
2. Wizard 步骤增加为 6 步：类型 → 类别 → **属性** → AI 接入 → 数据 → 成员；属性步骤可跳过（默认空 schema）。
3. ProjectCreate schema 的 `attributes_schema` 字段串通；后端写入项目设置。

#### 2.10 通知点击跳转角色感知

**文件**：`apps/web/src/components/shell/NotificationsPopover.tsx:142-151`

```tsx
function handleRowClick(item) {
  const role = useAuthStore.getState().user?.role;
  if (item.target_type === "bug_report") {
    if (role === "super_admin" || role === "project_admin") navigate("/bugs");
    else { openMyFeedbackDrawer(item.target_id); }  // 走 BugReportDrawer 控制器
  } else if (item.target_type === "batch") {
    const projectId = item.payload?.project_id;
    navigate(`/projects/${projectId}/annotate?batch=${item.target_id}`);
  }
}
```

需要新建 BugReportDrawer 全局控制器（zustand store `useBugDrawerStore`），允许从任何位置打开抽屉并定位到指定 report_id。

#### 2.11 ProgressBar aiPct 真实化

**文件**：`apps/web/src/pages/Dashboard/DashboardPage.tsx:46`、`apps/api/app/schemas/project.py:71-77`

1. ProjectStats 后端新增 `ai_completed_tasks` 字段：`SELECT COUNT(DISTINCT task_id) FROM annotations WHERE project_id=:pid AND parent_prediction_id IS NOT NULL AND is_active`.
2. 前端 `aiPct = p.total_data > 0 ? Math.round(p.ai_completed_tasks / p.total_data * 100) : 0`，删除 `pct * 0.6` 启发式。
3. ProgressBar 接受 aiValue 已支持，无需改组件。

#### 2.12 批次级 reviewer dashboard

**文件**：`apps/web/src/pages/Dashboard/ReviewerDashboard.tsx`

新增「按批次分组」段：
- 调 `useBatches(projectId)` 查 reviewing 状态批次。
- 每批次显示：`batch.display_id · 任务数 · review 中 N · 已通过 K · 进度条`。
- 单击批次跳 `/review?project={pid}&batch={bid}`，ReviewPage 接受 query param 直接预选批次。

#### 2.13 项目卡批次概览

**文件**：`apps/web/src/pages/Dashboard/DashboardPage.tsx:104-124`、`apps/api/app/schemas/project.py`、`apps/api/app/api/v1/projects.py`

1. ProjectStats 新增 `batch_summary: { total: int, assigned: int, in_review: int }`，由 `_serialize_project` 一次性聚合查询提供（避免 N+1：用 `func.count(case(...))` 一条 SQL 拿三个数）。
2. DashboardPage 进度列「→ 查看批次分派」深链旁加一行 mini 文案：`{total} 个批次 · {assigned} 已分派 · {in_review} 审核中`，灰色 11px。

#### 2.14 UnlinkConfirmModal 输入名称二次确认

**文件**：`apps/web/src/pages/Datasets/DatasetsPage.tsx:313-368`

加 `<input>` 让用户输入 dataset 名称；按钮 `disabled={input !== datasetName}`；与 DangerSection 删项目（确认强度对照）保持一致体感。文案保留现有「将一并删除 N 任务（含 K 已标注）」。

#### 2.15 AuditPage 折叠 sessionStorage 持久化

**文件**：`apps/web/src/pages/Audit/AuditPage.tsx:109`

`expandedReqIds` 改用自定义 hook `useSessionPersistedSet('audit:expanded', 30 * 60 * 1000)`；30min TTL，写入 sessionStorage。在 AuditPage 内部新建 hook（不必通用化）。

#### 2.16 uploadBugScreenshot 失败 retry UI

**文件**：`apps/web/src/components/bugreport/BugReportDrawer.tsx:76-85`

把 try/catch 内的 toast 降级行为改为：失败时弹「截图上传失败」内联 alert + 「重试」「跳过截图提交」「取消」三按钮。本地 state `screenshotUploadState: 'idle'|'uploading'|'failed'`。重试调用同 `uploadBugScreenshot` 不需改 API 层。

#### 2.17 `usePopover` 剩余迁移

**文件**：`apps/web/src/components/shell/NotificationsPopover.tsx:217-225`、`apps/web/src/pages/Workbench/shell/AttributeForm.tsx:213-225`

NotificationsPopover 内部 `useState(false)` + click-outside 改用 `usePopover`；AttributeForm DescriptionPopover 同。CanvasToolbar 实测无 popover（已确认无需迁移）；TopBar 智能切题菜单已迁移到 DropdownMenu。

> 实际剩余 2 处（ROADMAP 写「4 处」与现状不符，CHANGELOG 中记录修正）。

#### 2.18 ProjectsPage 卡片操作菜单收编

**文件**：`apps/web/src/pages/Dashboard/DashboardPage.tsx:144-159`

把「导出 / 设置 / 打开」三按钮收入单一 `<DropdownMenu>`（hover 触发的 `⋮` 入口），与 v0.6.6 phase 2 风格一致。ExportSection 作为 Dropdown 内嵌子菜单。

### 治理

#### 2.19 celery beat 定时清理软删评论附件

**文件**：`apps/api/app/workers/celery_app.py:1-26`、新建 `apps/api/app/workers/cleanup.py`

1. celery_app.conf.update 增加：
   ```python
   beat_schedule={
       "cleanup-soft-deleted-comment-attachments": {
           "task": "app.workers.cleanup.purge_soft_deleted_attachments",
           "schedule": crontab(hour=3, minute=0),  # 每日 03:00 UTC
       },
   },
   ```
2. 新建 task：扫 `annotation_comments WHERE is_active=false AND deleted_at < now() - interval '7 days'`，对每条调 MinIO `delete_object`。批量 100 一档处理避免长事务。
3. docker-compose 需启用 celery beat 服务（新增 service 或共享 worker --beat 模式，CHANGELOG 中说明运维侧需 redeploy）。

---

## CHANGELOG / ROADMAP 更新

完成上述工作后：

1. **CHANGELOG.md** 新增 `v0.7.0` 段，按上方两阶段列清单。
2. **ROADMAP.md** 删除整个「v0.6.x 后续观察 / 下版候选」章节（包括三大 sub-section）。
3. **ROADMAP.md** 删除「批次状态机重设计（v0.6.10 调研，待立项）」章节。
4. **ROADMAP.md** 优先级表删除已完成行；新增 `on_batch_approved hook` 作为 v0.7.x 候选（依赖 ML backend），保留通知偏好邮件 digest 在 LLM 聚类一节。

---

## 关键文件总览

### 后端
- `apps/api/app/services/batch.py` — VALID_TRANSITIONS、reject_batch 软重置、_assert_can_transition helper
- `apps/api/app/services/scheduler.py` — REVIEWER/ANNOTATOR 可见性常量、batch_visibility_clause
- `apps/api/app/api/v1/batches.py` — transition 鉴权、reject 端点扩展（feedback 入参）
- `apps/api/app/api/v1/projects.py` — orphan-tasks CTE 优化、batch_summary、stored in_progress_tasks
- `apps/api/app/api/v1/me.py` — 删 dead code
- `apps/api/app/api/v1/ws.py` — ConnectionPool + 心跳
- `apps/api/app/api/v1/bug_reports.py` — reopen 单独限流
- `apps/api/app/services/notification.py` — 偏好过滤
- `apps/api/app/services/dataset.py` — link_project 同名去重
- `apps/api/app/db/models/batch.py` — review_feedback / reviewed_at / reviewed_by
- `apps/api/app/db/models/project.py` — in_progress_tasks 列
- `apps/api/app/db/models/notification.py` — preferences 表
- `apps/api/app/workers/celery_app.py` + `cleanup.py` — beat schedule
- alembic：0027（batch review fields）、0028（project in_progress stored）、0029（notification_preferences）

### 前端
- `apps/web/src/pages/Projects/sections/BatchesSection.tsx` — 新按钮、状态看板 toggle
- `apps/web/src/pages/Projects/sections/RejectBatchModal.tsx`（新）
- `apps/web/src/pages/Projects/sections/ClassesSection.tsx` + `<ClassEditor>` 抽出
- `apps/web/src/pages/Projects/sections/AttributesSection.tsx` + `<AttributeSchemaEditor>` 抽出
- `apps/web/src/components/projects/CreateProjectWizard.tsx` — 6 步 + 复用编辑器
- `apps/web/src/pages/Dashboard/DashboardPage.tsx` — aiPct 真实化、batch_summary 概览、卡片菜单收编
- `apps/web/src/pages/Dashboard/AnnotatorDashboard.tsx` — 我的批次分组
- `apps/web/src/pages/Dashboard/ReviewerDashboard.tsx` — 按批次分组
- `apps/web/src/pages/Review/ReviewPage.tsx` — 复用可见性 helper、接 batch query
- `apps/web/src/pages/Datasets/DatasetsPage.tsx` — UnlinkConfirmModal 输入名称
- `apps/web/src/pages/Audit/AuditPage.tsx` — sessionStorage 持久化
- `apps/web/src/pages/Settings/SettingsPage.tsx` + NotificationPreferencesSection（新）
- `apps/web/src/components/shell/NotificationsPopover.tsx` — 角色感知跳转、usePopover 迁移
- `apps/web/src/components/bugreport/BugReportDrawer.tsx` — 截图重试 UI
- `apps/web/src/pages/Workbench/shell/AttributeForm.tsx` — usePopover 迁移
- `apps/web/src/store/useBugDrawerStore.ts`（新） — 全局抽屉控制器

### 测试
- `apps/api/tests/test_batch_lifecycle.py`（新）— 5 个 test class
- 现有 `test_task_batch_visibility.py` 保持

---

## Verification

### 端到端验证（按顺序执行）

1. **后端起服务**：`docker-compose up -d`；alembic upgrade head 验证 0027/0028/0029 落地。
2. **批次状态机闭环**：
   ```
   super_admin 建项目 → owner 创建 batch（导 task）→ 激活 → 标注员标注 →
   「✓ 提交质检」 → reviewer 看到批次 → 「✗ 驳回（带 feedback）」 →
   标注员收到通知 + 看到 rejected 批次 + 看到 feedback → 重做 →
   再次提交 → reviewer 「✓ 通过」 → 批次 approved
   ```
3. **0-task 拦截**：建空 batch → 「▶ 激活」按钮 disabled；用 curl 直调 `/transition` → 400。
4. **鉴权矩阵**：
   - 标注员调 `PATCH /transition target=approved` → 403
   - reviewer 调 `target=approved` 但项目无成员关系 → 404
5. **reject 软重置**：
   - 标注 5 框 → 提交质检 → reviewer 驳回
   - DB 检查：`task.status='pending'`、`task.is_labeled=true`（保持）、`annotations.is_active=true`（保持）
   - 标注员重进任务：5 框仍在画布上、状态显示 pending、顶部 banner 显示 reviewer feedback
6. **通知偏好**：
   - 设置页关闭「批次驳回」类型通知 → 重新驳回 → 不进通知中心 + 不推 WS
   - 重新打开 → 再次驳回 → 收到
7. **WS 心跳**：浏览器 devtools Network 看 WS 帧；30s 周期 ping 帧；nginx 60s idle 不会断。
8. **Wizard 升级**：新建项目走完 6 步；step 2 / step 3 数据落库后开 ProjectSettings 看到 ClassesSection / AttributesSection 已填。
9. **测试**：`pytest apps/api/tests/test_batch_lifecycle.py -v`、`vitest run`。
10. **Lint + tsc**：`pnpm -w lint`、`pnpm -w tsc --noEmit`、`ruff check apps/api`。

### 留白确认

- `on_batch_approved` 仍 no-op（仅 logger，等 ML backend 训练队列）
- 通知 channels.email 字段存在但 UI 不显示（等 LLM 聚类 + SMTP）
- LLM 聚类去重 / 邮件 digest / SMTP 链路本版完全不动

---

## 风险与回滚

- **alembic 0027/0028/0029**：三个迁移彼此独立，可单独 downgrade。0028（in_progress_tasks 回填）在大表上需 monitor；建议生产 deploy 时单独跑 + 观察。
- **reject_batch 软重置**：旧逻辑下被 reject 过的批次，`is_labeled` 已是 false 状态——本版改造后**对旧数据无副作用**（新拒批走新路径，旧 batch 保持原 reject 历史）。
- **transition 鉴权收紧**：v0.6.x 期间任何成员都能推任意状态，可能存在脏数据（标注员手工把 active → archived 等）。本版收紧后历史脏数据保留，仅对新动作生效。CHANGELOG 中说明并附 SQL 检测脚本（grep audit_log 中 `BATCH_TRANSITION` action 由 annotator 角色发起的记录）。
- **通知偏好默认 in_app=true**：现网用户无 preferences 记录时按全部接收处理，不会突然静音。
