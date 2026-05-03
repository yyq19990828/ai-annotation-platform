# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---
## [Unreleased]

---

## [0.7.2] - 2026-05-03

> 治理可视化 + 全局导航。一次性收口 5 项 ROADMAP open 项：**批次单值分派 + 项目级圆周分派、责任人头像组、标注框历史可追溯、⌘K 全局搜索、Dashboard 高级筛选 + 网格视图**。一次 alembic 迁移（0030）把批次分派从「list 多人」语义切换到「一 batch = 1 标注员 + 1 审核员」单值语义。

### 治理可视化

#### 批次分派单值语义 + 项目级圆周分派（A · 批次相关延伸）

**理念变更**：每个 batch 是一个明确的工作单元，由 **1 名标注员** 负责标注 + **1 名审核员** 负责审核。先前 v0.6.7 的 `assigned_user_ids: list` 多选语义被收紧。

数据模型（**alembic 0030**）：
- `task_batches` 加 `annotator_id` / `reviewer_id` 单值列（FK users，ON DELETE SET NULL，加索引）
- 数据迁移：JOIN `project_members` 把现有 `assigned_user_ids` 拆分到两列（按 role 取「第一个」），多人分派的批次只保留首位
- `assigned_user_ids` 列保留为派生兼容（`BatchService._sync_assigned_user_ids` 维护 `[annotator_id, reviewer_id] filter None`）

后端 API：
- 删除 `POST /batches/{id}/distribute-evenly`（task 级圆周打散与单值理念冲突）
- 新增 `POST /projects/{id}/batches/distribute-batches`：把项目下未分派 / 全部 batch 在所选 annotator / reviewer 间圆周分派，**每 batch 落到 1 个 annotator + 1 个 reviewer**；同步级联更新 `Task.assignee_id` / `Task.reviewer_id`
- `BatchUpdate` / `BatchCreate` / `BatchSplitRequest` 字段从 `assigned_user_ids: list` 改为 `annotator_id` + `reviewer_id` 单值
- `BatchOut` 增加 `annotator` / `reviewer` UserBrief 字段（`apps/api/app/schemas/batch.py`）
- `_is_annotator_assigned`、`batch_visibility_clause`、`/dashboard/annotator/batches` 等可见性路径全部从 `assigned_user_ids.contains(...)` 改为 `annotator_id == user.id`

前端：
- `BatchAssignmentModal` 改为单选 radio（标注员段 + 审核员段），写 `annotator_id` / `reviewer_id`
- 新建 `ProjectDistributeBatchesModal`：勾选参与的 annotator / reviewer + 选「仅未分派 / 覆盖全部」+ 一键圆周分派
- `BatchesSection` 顶部新增「按项目分派批次」按钮触发上述 Modal

#### 责任人可视化（A · Annotator/Reviewer 工作台 + Dashboard）

新建通用组件 `apps/web/src/components/ui/AssigneeAvatarStack.tsx`（最多 N 个头像 + 计数 + 角色 label），抽自 `BatchesSection` 行内实现，接入 4 处：
- **`BatchesSection`**：分派列直接渲染 `[b.annotator, b.reviewer]` 头像
- **`MyBatchesCard`**（标注员 dashboard）：行内显示「审核员」头像
- **`ReviewerDashboard`**（审核员 dashboard）：审核中批次行内显示标注员头像
- **`Workbench Topbar`**：当前 task 顶部加「标注 @张三 · 审核 @李四」胶囊

后端：
- `TaskOut` 增加 `assignee` / `reviewer` UserBrief 字段（`apps/api/app/schemas/task.py`）
- `MyBatchItem` / `ReviewingBatchItem` 加单值 `reviewer` / `annotator`（`apps/api/app/schemas/dashboard.py`）
- 新建 `apps/api/app/services/user_brief.py` 提供 `resolve_briefs` / `resolve_briefs_with_project_role` 一次 IN 解析，避免 N+1。

#### 标注框编辑历史 / 审核历史可追溯（A · v0.7.x 后续观察）

后端把 annotation 完整生命周期落到 `audit_logs`：
- `AnnotationService.create / update / delete`（在 `apps/api/app/api/v1/tasks.py` route 层调 `AuditService.log()`，target_type=`annotation`）
- 评论 add / delete 升级为 `ANNOTATION_COMMENT_ADD` / `ANNOTATION_COMMENT_DELETE`（替代旧 `annotation.comment` 字符串）
- 新增枚举 `AuditAction.ANNOTATION_CREATE / UPDATE / DELETE / COMMENT_ADD / COMMENT_DELETE`

新增端点 `GET /annotations/{id}/history`（`apps/api/app/api/v1/annotation_history.py`），合并三类事件按时间升序：
- 该 annotation 的 audit_logs（target_type='annotation'）
- 关联 task 的 6 个关键 action（`task.submit/withdraw/review_claim/approve/reject/reopen`）
- 该 annotation 的所有 comments（含软删的，前端区分显示）

前端工作台 `CommentsPanel` 加 Tabs（评论 / 历史），切到「历史」tab 渲染新组件 `AnnotationHistoryTimeline`：纵向时间线 + 头像 + 角色 label + diff 缩略 + 相对时间。命名上避开 `useAnnotationHistory`（本地 undo/redo 栈），新 hook 叫 `useAnnotationAuditHistory`。

### 全局导航

#### ⌘K Command Palette（A · TopBar / Dashboard 控件）

新增 `GET /search?q=...&limit=5` 跨实体聚合搜索端点（`apps/api/app/api/v1/search.py`），按当前用户可见性返回 4 类分组：projects / tasks / datasets / members：
- 项目：复用 `_visible_project_filter`
- 任务：约束在可见项目下，按 display_id / file_name `ilike`
- 数据集：登录可见
- 成员：super_admin 全局；其他角色仅返回与自己同项目的成员

前端 `apps/web/src/components/CommandPalette.tsx` Modal palette：⌘K / Ctrl+K 全局触发（TopBar 注册 keydown，input/textarea 内不拦截），TopBar `<SearchInput>` 改为点击触发。键盘 ↑↓ 切换 / ↵ 跳转 / Esc 关闭。debounce 200ms（`useGlobalSearch`）。

#### Dashboard 高级筛选 + 网格视图（A · TopBar / Dashboard 控件）

`GET /projects` 扩展 4 个 query 参数（`apps/api/app/api/v1/projects.py`）：
- `type_key`（多值）：按 `Project.type_key` 过滤
- `member_id`：JOIN `project_members` 找该用户参与的项目
- `created_from` / `created_to`：`Project.created_at` 区间

前端 `pages/Dashboard/FilterDrawer.tsx` 4 个 section（状态 / 类型 / 成员 / 创建时间）：状态 / 类型用 chip 多选；成员段提供「我参与的」快捷 + 全部成员列表；时间段用原生 `<input type="date">`。Apply / Clear / Cancel 三键。`pages/Dashboard/ProjectGrid.tsx` 响应式 3 列项目卡，与 list 视图共享同一份 useProjects hook；视图切换状态写入 URL `?view=grid`，刷新保持。`Card` 组件加 `onClick` prop。

### 测试

新增 `apps/api/tests/test_v0_7_2.py`：
- `TestProjectDistributeBatches`：7 batch / 3 annotator / 2 reviewer 圆周 [3, 2, 2] 计数 + 每 batch 一人 + task 联动；only_unassigned 跳过已分派
- `TestAnnotationAuditTrail`：create/update/delete 各产出 1 条 audit
- `TestGlobalSearch`：super_admin 通过 name 搜到项目
- `TestAnnotationHistoryEndpoint`：合并 audit + comment 时间线

`tests/test_batch_lifecycle.py`、`tests/test_task_batch_visibility.py` 同步迁移到单值语义（seed 时同时写 `annotator_id`）。

### 兼容性

数据库迁移（**alembic 0030**）一次性把现有 `assigned_user_ids` 列拆到 `annotator_id` / `reviewer_id` 单值列。多人分派的批次仅保留首位。`assigned_user_ids` 列继续存在做向后兼容（service 层维护派生写入）。

---

## [0.7.0] - 2026-05-03

> 两阶段集中收口：① **批次状态机重设计 epic**（v0.6.10 调研立项的 P1）—— transition 鉴权矩阵、reviewer 可见性、批次级 review UI、reject_batch 软重置、空批次拦截、状态语义 + 通知接入、`test_batch_lifecycle.py` 16 例覆盖；② **v0.6.x 后续观察 / 下版候选**章节全部收尾（涉及 LLM 的留白）。共 3 个 alembic 迁移（0027/0028/0029），16 项功能 + 修复 + polish。

### Phase 1 · 批次状态机重设计 epic（v0.6.10 调研立项）

#### transition 鉴权矩阵（P1）

`PATCH /batches/{id}/transition` 之前仅 `require_project_visible` 把关，**任何项目成员都能任意推动状态**。`apps/api/app/services/batch.py:_assert_can_transition` 抽出按 `(from, to) → 角色` 鉴权矩阵：
- `draft → active`：仅 owner / super_admin
- `active → annotating`：**仅** `check_auto_transitions` 自动驱动，REST 一律 403
- `annotating → reviewing`：标注员（仅自己被分派的批次）/ owner / super_admin
- `reviewing → approved / rejected`：reviewer / owner / super_admin
- `rejected → active` / 任意 `→ archived`：owner / super_admin

403 错误明确返回 `{"detail": "<role> cannot transition <from> -> <to>"}` 便于前端 toast。`reject` 端点（`apps/api/app/api/v1/batches.py`）复用同一 helper，与 `require_roles(*_REVIEWERS)` 双重把关。

#### reviewer 可见性修复（P1）

`apps/api/app/services/scheduler.py` 拆出两个常量 + 角色感知 `batch_visibility_clause(user)`：
- `ANNOTATOR_VISIBLE_BATCH_STATUSES = ['active', 'annotating', 'rejected']`
- `REVIEWER_VISIBLE_BATCH_STATUSES = ['active', 'annotating', 'reviewing']`

reviewer 不受 `assigned_user_ids` 约束（跨批次审核场景）。**rejected 状态对被分派的标注员特例放行**——让标注员看到 reviewer 留言并继续重做（在 SQL 子句和 REST helper `_assert_task_visible` 双路径强制）。同步暴露 `visible_batch_statuses_for(user)` 给点查路径。`apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx:88-102` 的 `activeBatches` 过滤同步纳入 `rejected`，让标注员可见 reviewer 反馈并重做。

#### 批次级 review UI 全缺（P1）

`apps/web/src/pages/Projects/sections/BatchesSection.tsx:235-261` 之前仅 4 按钮（▶ 激活 / ↻ 重激活 / 🗄 归档 / 🗑 删除）。新增：
- **「✓ 提交质检」** （annotating → reviewing）：owner / 被分派标注员可主动整批提交，不必等所有任务自动跳转
- **「✓ 通过」** （reviewing → approved）：reviewer / owner，绿色按钮
- **「✗ 驳回」** （reviewing → rejected）：弹 `RejectBatchModal`（新组件，500 字必填 textarea + 红色二次确认），调 `POST /reject` body 带 feedback
- **rejected 批次行内联反馈**：批次驳回后行下方显示 reviewer feedback 摘要（80 字截断 + tooltip 全文）

`ReviewPage.tsx` 整批退回按钮同步升级为 `prompt` 收集 feedback；`useRejectBatch` mutationFn 改为 `{ batchId, feedback }`，自动 invalidate notifications query。

#### reject_batch 软重置（方案 A，alembic 0027）

`task_batches` 新增 `review_feedback / reviewed_at / reviewed_by` 三列。`reject_batch` 改写为：
```python
# 仅把 review/completed 任务回退到 pending；不动 is_labeled，不清 annotations.is_active
update(Task).where(Task.batch_id == batch_id, Task.status.in_(["review", "completed"])).values(status="pending")
batch.review_feedback = feedback; batch.reviewed_at = now; batch.reviewed_by = reviewer_id
```

旧 v0.6.x 行为（`status='pending', is_labeled=False`，annotations 数据保留但 UI 与 DB 状态不一致）改为：标注员重进任务能看到自己之前画的框 + 顶部 reviewer 留言，自决改不改。批次驳回后 fan-out `batch.rejected` 通知给所有 `assigned_user_ids`，payload `{batch_display_id, batch_name, project_id, feedback, affected_tasks}`。

#### 0-task 批次拦截

之前 owner 创建空批次后能直接「▶ 激活」永远卡在 active（`check_auto_transitions` 不处理空池）。前端 BatchesSection 「▶ 激活」按钮 `disabled = assigned===0 || total_tasks===0` + hover title 提示原因；后端 `transition` 在 `draft → active` 分支前校验 `SELECT COUNT(*) WHERE batch_id = ?`，否则 400 `cannot activate empty batch`。

#### 状态语义前端展示 + 通知路由

`NotificationsPopover` 加 `batch.rejected` type label「驳回了批次」+ 路由感知跳转：reporter 跳 `/projects/{pid}/annotate?batch={id}`；同时改造 `bug_report.*` 通知 — admin 跳 `/bugs`，提交者打开「我的反馈」抽屉并定位到该条（v0.7.0 新建 `useBugDrawerStore` zustand 控制器，App.tsx + FullScreenWorkbench 改用 store 替代 local state，`BugReportDrawer` 接 `focusBugId` prop 自动 loadDetail）。

#### 测试覆盖（`apps/api/tests/test_batch_lifecycle.py` 16 例）

5 个 test class：
1. `TestTransitionAuth`（6 例）— 标注员不能跳 approved；annotator 可主动 reviewing；reviewer 可 approved；owner 可 archive；annotator 不能 archive
2. `TestRejectBatchSoftReset`（4 例）— 软重置语义、通知 fan-out、feedback 必填校验、annotator 不能 reject
3. `TestEmptyBatchActivation`（2 例）— 空批次拒绝激活；非空可激活
4. `TestWithdrawCascade`（1 例）— check_auto_transitions 在 reviewing 不主动反推
5. `TestReviewerVisibility`（3 例）— reviewer 跨批次可见 reviewing；annotator 在 rejected 批次特例放行；未分派 annotator 不可见

### Phase 2 · v0.6.x 收尾（18 项）

#### 后端

- **`Project.in_progress_tasks` 改 stored 列**（alembic 0028）：v0.6.7-hotfix 即时 COUNT 改为持久化列 + 一次性回填；`batch._sync_project_counters` 在状态机变迁时同步维护；`_serialize_project` 直接读字段，列 N 项目消除 N 次 COUNT 查询
- **`POST /orphan-tasks/cleanup` CTE 优化**：7 条 `ANY(:ids)` 数组序列化改为单子查询联查（`WHERE id IN (orphan_subquery)`），避免 10 万级孤儿场景下的 array overflow
- **link_project 同名 batch 去重命名**：unlink → re-link 同 dataset 时新批次自动加 `#N+1` 后缀（之前硬编码 `{ds.name} 默认包` 撞名）
- **删 dead code `GET /auth/me/notifications`**：`apps/api/app/api/v1/me.py:47-130` 端点 + audit-derived 派生函数全删，前端已切到新 `/notifications`
- **bug_reports reopen 单独限流**：评论 60/h 整体限流保留；reopen 路径加独立 5/day/user/report Redis 计数器，防止提交者刷 reopen 计数
- **WS ConnectionPool + 心跳**：`/ws/notifications` 之前每连接 `aioredis.from_url` 新建 socket，副本数 ↑ 时 Redis 连接数 = WS 连接数。引入模块级 `ConnectionPool.from_url(max_connections=200)` 共享池 + 30s 服务端 ping 帧防 LB idle timeout（默认 60s）。前端 `useNotificationSocket.ts` 识别 ping 帧不触发 invalidate
- **通知偏好（基础静音 · alembic 0029）**：新建 `notification_preferences (user_id, type)` PK 表，`channels JSONB`；`NotificationService.notify` 在 INSERT 前查偏好，`channels.in_app=false` 跳过插入 + 不发 pubsub。新建 `GET/PUT /notification-preferences` REST，设置页加「通知偏好」段（4 个已知 type 的 in_app 开关）。**email 字段保留但 UI 不显示**（等 LLM 聚类去重 + SMTP 落地）
- **celery beat 软删附件清理**：新建 `apps/api/app/workers/cleanup.py` + `purge_soft_deleted_attachments` task；celery_app 加 `beat_schedule`（每日 03:00 UTC），扫 7 天前软删的 `annotation_comments` 附件并从 MinIO 删除。运维侧需 deploy `celery -A app.workers.celery_app beat`（或 worker --beat 单进程）

#### 前端

- **Wizard step 2 升级到完整 ClassEditor**：从 `ClassesSection` 抽出 `<ClassEditor>` 受控组件（颜色 + 排序 + 删除 + 限额，~150 行），`CreateProjectWizard` step 2 把 `form.classes: string[]` 升级为 `form.classRows: ClassRow[]`，提交时序列化为 `classes + classes_config`。`ProjectCreate` schema 加 `classes_config` 字段；`create_project` 改用 `model_dump(exclude_none=True)`
- **ProgressBar aiPct 真实化**：`ProjectStats` / `_serialize_project` 加 `ai_completed_tasks` 字段（`COUNT DISTINCT(task_id) WHERE parent_prediction_id IS NOT NULL AND is_active`），列项目时单 GROUP BY 批量预查避免 N+1。`DashboardPage:46` 删除 `pct * 0.6` 启发式，改 `Math.round(ai_completed_tasks / total * 100)`
- **批次级 reviewer dashboard**：`ReviewerDashboardStats` 加 `reviewing_batches` 列表（reviewer 跨批次审核），ReviewerDashboard 新增「审核中批次」段（卡片 row 显示 `display_id · project · 任务数 · review N · 完成 K · 进度%`），单击跳 `/review?project=...&batch=...`。`ReviewPage` 接 query param 自动预选项目 + 批次
- **项目卡批次概览**：`ProjectStats` 加 `batch_summary: {total, assigned, in_review}`，单 GROUP BY 批量查询。`DashboardPage` 项目行进度列下方加 mini 文案「N 个批次 · K 已分派 · M 审核中」（M 用 warning 色高亮）
- **UnlinkConfirmModal 输入名称二次确认**：`DatasetsPage:UnlinkConfirmModal` 当影响 task 数 > 0 时强制要求输入数据集名称才能确认（与 DangerSection 删项目强度对齐）
- **AuditPage 折叠 sessionStorage 持久化**：`expandedReqIds` Set 持久化到 sessionStorage（30min TTL），刷新页面后自动恢复展开状态
- **uploadBugScreenshot 失败 retry UI**：v0.6.6 失败时静默降级为 toast warning + 无截图提交，改为停在表单内联红色 alert + 「重试上传 / 跳过截图提交」三按钮
- **`usePopover` 迁移**：`AttributeForm.DescriptionPopover` 迁移到统一 `usePopover` hook（NotificationsPopover 因父级 onClose 控制流不同，保留手写 click-outside；CanvasToolbar 实测无 popover 不需迁移；ROADMAP 写「4 处」与现状不符，CHANGELOG 中记录修正）

### 未做 / 留白（标注 v0.7.x）

- **Wizard 新增「属性 schema」步骤**：抽出 `<AttributeSchemaEditor>` 给 Wizard 6 步流程使用 — 由于 Wizard 已 1009 行 + AttributeSection 250 行抽取链较深，本版仅完成类别步骤升级，属性 schema 步骤推迟
- **NotificationsPopover usePopover 迁移**：父级以 `open / onClose` 控制流，迁移到 `usePopover` 需重构 TopBar 集成模式，本版保留现状
- **ProjectsPage 卡片操作菜单收编 DropdownMenu**：3 按钮（导出 / 设置 / 打开）合并到 `⋮` 触发的 DropdownMenu，本版未做
- **`on_batch_approved` hook**：仍 no-op + TODO 注释；active learning 闭环依赖 ML backend / 训练队列基座（ROADMAP A · AI/模型 区列出）
- **通知偏好邮件 digest**：`notification_preferences.channels.email` 字段就位但 UI 不显示，依赖 LLM 聚类去重 + SMTP 落地
- **task.reopen 通知**：`/auth/me/notifications` 删除后，`test_task_reopen_notification` 暂跳过；将来如需复活，应改写为 reopen 端点 fan-out `task.reopened` type 到 NotificationService（已为通知偏好基础静音留好接口）

### Migration / Deploy 注意事项

1. **alembic 0027/0028/0029** 三个迁移彼此独立，可单独 downgrade。0028（in_progress_tasks 回填）在大表上需 monitor；建议生产 deploy 时 alembic 单独跑 + 观察。
2. **transition 鉴权收紧**：v0.6.x 期间任何成员都能推任意状态；本版收紧后历史脏数据保留，仅对新动作生效。SQL 检测：`SELECT * FROM audit_logs WHERE action='batch.status_changed' AND actor_role='annotator' AND detail_json->>'after' NOT IN ('reviewing')`。
3. **celery beat 启用**：`docker-compose` 或 K8s 需新增 beat 服务（或共享 `worker --beat`）；不启用则 celery 仅作 broker，软删附件清理不会触发（MinIO bucket lifecycle 180 天硬兜底仍生效）。
4. **通知偏好默认 in_app=true**：现网用户无 `notification_preferences` 记录时按全部接收处理，不会突然静音。

---

## [0.6.10-hotfix] - 2026-05-03

> 标注员反馈 B-16「分派批次的 BUG —— 给当前标注员安排了批次，但他仍然能看见全量数据」。根因是工作台任务可见性只在前端过滤，后端只看 `project_id`，标注员选「全部批次」或直接知道任务 id 就能绕过。同时调研定位「批次状态机重设计」epic（详见 ROADMAP）。

### B-16 修复 · 服务端强制 batch 可见性

**症状**：P-4 项目 10 个批次（1 个 active 分派给标注员，9 个 draft 未分派），标注员工作台显示 1206 任务（全量），应为 120（仅自己 active 批次内）。

**根因**：
1. `GET /tasks?project_id=...`、`GET /tasks/{id}`、`/annotations`、`/predictions` 都只看 `project_id`，**没有 batch 可见性检查**。前端 `WorkbenchShell.activeBatches` 过滤只决定下拉显示哪些 batch，但 API 返回的是项目全量。
2. `next_task` 调度器（`scheduler.py:62, 71-80`）有正确的 batch 过滤（`status IN ('active','annotating')` + `assigned_user_ids` 包含自己或为空），是唯一服务端强制的端点。

**修复**（`v0.6.10-hotfix` 第一版）：把 scheduler 的逻辑抽成两个 helper：
- `is_privileged_for_project(user, project)` — super_admin 或项目 owner 越权放行
- `assigned_user_ids_clause(user)` — 仅 `assigned_user_ids` 检查

并在 `list_tasks` JOIN TaskBatch 强制；`_assert_task_visible` 在 `get_task` / `get_annotations` / `get_predictions` 4 个读路径执行。

**第二版修复**：第一版抄 scheduler 时漏了 `TaskBatch.status IN ('active','annotating')` 限制，导致 draft 批次（`status=draft + assigned_user_ids=[]`）仍被当成「开放标注池」可见 → P-4 仍暴露 1206 任务。把可见性合并成单一子句：
```python
batch_visibility_clause = TaskBatch.status IN ('active','annotating')
                          AND (assigned_user_ids = [] OR contains [self])
```
重命名 `assigned_user_ids_clause` → `batch_visibility_clause`（保留兼容别名）。

**生产 DB 实测**：标注员对 P-4 的可见任务 1206 → 120（仅 BT-13 active+assigned），符合预期。

### 关键修改

| 文件 | 改动 |
| --- | --- |
| `apps/api/app/services/scheduler.py` | 抽 `is_privileged_for_project` + `batch_visibility_clause` + `WORKBENCH_VISIBLE_BATCH_STATUSES = ['active','annotating']`；scheduler 自身改用 helper |
| `apps/api/app/api/v1/tasks.py` | `list_tasks` 加 JOIN TaskBatch + 可见性 WHERE；`_assert_task_visible` helper 应用到 `get_task` / `get_annotations` / `get_predictions`；非特权用户 + 孤儿任务（batch_id IS NULL）一律 404 隐藏 |
| `apps/api/tests/test_task_batch_visibility.py` | 新建 6 例：列任务过滤 / 跨批次 GET 404 / 自己批次 200 / super_admin 全见 / 未分派 active 批次成员可见 / draft 批次对标注员不可见（P-4 复现） |

### ROADMAP 新增 · 批次状态机重设计 epic

调研发现的 8 项相关坑写入 ROADMAP「批次状态机重设计（v0.6.10 调研，待立项）」专题章节。**3 大头号**（按生产体感影响排序）：

1. **批次级 review UI + transition 鉴权全缺**：`PATCH /batches/{id}/transition` 无鉴权（任何项目成员能任意推态）；BatchesSection 缺「整批提交质检 / 批次通过 / 批次驳回」按钮，标注员 / reviewer 没有批次级操作入口
2. **reviewer 在 reviewing 批次彻底看不到任务**：`WORKBENCH_VISIBLE_BATCH_STATUSES` 把 reviewer 也挡住，标注员提交后 reviewer 任务凭空消失，UX 断层
3. **`reject_batch` 数据语义未决**：当前 `task.status=pending + is_labeled=false` 但**未清 annotations 表**，UI/DB 状态不一致；UI 入场前必须先决断软重置 vs 硬重置方案

详见 ROADMAP `#### 批次状态机重设计` 节。

### 测试

- `tests/test_task_batch_visibility.py` 6 例
- 全套 82 → 88 例通过；前端 tsc 0 errors

### B-16 数据库标记

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "UPDATE bug_reports SET status='fixed', fixed_in_version='v0.6.10' WHERE display_id='B-16';"
```

---

## [0.6.9] - 2026-05-03

> BUG 反馈机制从「单向漏斗」升级为「双向闭环 + 实时通知」。两路并进：A · 反馈闭环（评论双向 + 自动重开）；B · 通知中心基座（持久化表 + Redis Pub/Sub WS 推送，BUG 反馈是首位消费方，后续 audit / 任务分派可挂入）。后端 75→82 例（+7 通知 + 6 反馈闭环 = 13 新例，部分被原 6 例计入）。

### A · BUG 反馈闭环

- **`bug_reports` 加 reopen 字段**（alembic 0025）：`reopen_count INTEGER NOT NULL DEFAULT 0` + `last_reopened_at TIMESTAMPTZ`，避免「fixed/wont_fix/duplicate 是终态」造成的回归 BUG 只能新提交而丢失上下文。
- **service `add_comment` 自动 reopen**：提交者在 fixed/wont_fix/duplicate 状态评论 → 同事务把 status 切回 `triaged` + reopen_count++ + last_reopened_at + triaged_at；返回 `(comment, was_reopened, author_name, author_role)` 让 router 决定后续 audit / 通知 fan-out。
- **评论端点鉴权收紧**：`POST /bug_reports/{id}/comments` 当前是任何登录用户都能评论（v0.6.0 留下的 BUG），收紧为 `reporter == self || is_admin`，并加 `60/hour` 限流（与 create 的 `10/hour` 区分）。reopen 触发时同时写 `bug_report.reopened` audit 一行，detail 含 reopen_count。
- **评论返回 author_name + author_role**：`get_with_comments` 改为 `BugComment LEFT JOIN User`，避免前端 N+1 lookup。`BugCommentOut` schema 加 `author_name` / `author_role`，`BugReportOut` / `BugReportDetail` 加 `reopen_count` / `last_reopened_at`。
- **前端 `BugReportDrawer` 详情页加评论输入**：原本是 read-only。新增 textarea + 发送按钮；当 status ∈ {fixed, wont_fix, duplicate} 时上方显示橙色 hint「⚠ 当前状态为 X，发送评论将自动重新打开此反馈」；发送成功 toast 区分「评论已发送，反馈已重新打开」与「评论已发送」。
- **reopen 徽章 + author 头像**：`BugReportDrawer` 详情页与 `BugsPage` 列表 / 详情显示 `↻N` 或「曾重开 N 次」徽章（hover 显示最近重开时间）；评论行从「body + 时间戳」升级为「author_name · role 徽章 · 时间 · body」，多端一致。

### B · 通知中心（Redis Pub/Sub WS）

- **`notifications` 表**（alembic 0026）：通用收件人视角存档，区别于 `audit_log` 的操作者视角（索引取向相反；不与 audit_log 合并）。
  ```
  user_id, type, target_type, target_id, payload(JSONB), read_at, created_at
  ix_notifications_user_unread (user_id, read_at, created_at DESC)
  ix_notifications_target (target_type, target_id)
  ```
- **`NotificationService`** (`apps/api/app/services/notification.py`)：`notify` / `notify_many` 写表 + Redis publish 到 `notify:{user_id}` 频道（publish 异常不阻塞主事务）；`list_for_user` / `unread_count` / `mark_read` / `mark_all_read` 全部用 `WHERE user_id = self.id` 强制隔离。
- **REST + WS 端点**：
  - `GET /notifications?unread_only&limit&offset` — 列表（含 `total` / `unread`）
  - `GET /notifications/unread-count` — TopBar 红点
  - `POST /notifications/{id}/read` / `POST /notifications/mark-all-read`
  - `WebSocket /ws/notifications?token=<JWT>` — 握手时 `decode_access_token` 校验 sub，订阅 `notify:{sub}` Redis 频道；与现有 `/ws/projects/{id}/preannotate` 共用 `app.api.v1.ws` 文件。
- **bug_reports 接入通知 fan-out**：
  - PATCH 状态变更（actor != reporter）→ 通知 reporter（payload 含 `from_status` / `to_status` / `actor_name` / `resolution`）
  - 提交者评论 → 通知 `assigned_to_id`；缺省时通知所有 active SUPER_ADMIN；reopen 时 type=`bug_report.reopened` 且 payload `reopen=true` + `reopen_count`
  - 管理员评论 → 通知 reporter（type=`bug_report.commented`）
  - 自己操作不通知自己（reporter == admin 同人时不入队）
- **前端通知中心改造**：
  - `apps/web/src/api/notifications.ts` 切换到新 `/notifications` 端点；shape 从「audit_log 派生」改为「DB 行」（`type` + `payload` + 真实 `read_at`）
  - 新 hooks：`useNotifications` / `useUnreadCount`（30s 轮询兜底）/ `useMarkRead` / `useMarkAllRead` / `useNotificationSocket`（指数退避重连，最大 30s；收到 push → `qc.invalidateQueries(['notifications'])`）
  - `NotificationsPopover` 重写：每行显示 `{actor_name} {verb} · {display_id} / {title} / "{snippet}"`，verb 区分 `bug_report.commented` / `bug_report.status_changed` / `bug_report.reopened` / status 迁移；点击行 → markRead + 跳 `/bugs`
  - `TopBar` 红点改为消费 `unreadCount`（来自服务端 `unread`）；移除 v0.4.8 留下的 `localStorage[lastRead]` hack
  - `useNotificationSocket` 在 `<AppShell>` 顶层挂载（登录后即连）

### 关键修改

| 文件 | 改动 |
| --- | --- |
| `apps/api/alembic/versions/0025_bug_reopen_fields.py` | bug_reports 加 reopen_count + last_reopened_at |
| `apps/api/alembic/versions/0026_notifications.py` | 新建 notifications 表 + 双索引 |
| `apps/api/app/db/models/bug_report.py` | BugReport +2 列 |
| `apps/api/app/db/models/notification.py` | Notification ORM（新建）|
| `apps/api/app/services/bug_report.py` | `add_comment` 自动 reopen + 返回元组；`get_with_comments` join User |
| `apps/api/app/services/notification.py` | NotificationService（新建）|
| `apps/api/app/schemas/bug_report.py` | BugCommentOut +author_name/role；BugReportOut +reopen_count |
| `apps/api/app/schemas/notification.py` | NotificationOut / NotificationList / UnreadCount（新建）|
| `apps/api/app/api/v1/bug_reports.py` | 评论端点收紧鉴权 + 60/hour 限流 + audit reopened + 通知 fan-out；PATCH 状态通知 reporter |
| `apps/api/app/api/v1/notifications.py` | REST 端点（新建）|
| `apps/api/app/api/v1/ws.py` | `/ws/notifications` JWT 鉴权 + Redis 订阅 |
| `apps/api/app/api/v1/router.py` | 注册 notifications router |
| `apps/web/src/api/bug-reports.ts` | BugReportResponse +reopen_count；BugCommentResponse +author_name/role |
| `apps/web/src/api/notifications.ts` | 切到新 /notifications 端点 |
| `apps/web/src/hooks/useNotifications.ts` | 重写：list/unreadCount/markRead/markAllRead |
| `apps/web/src/hooks/useNotificationSocket.ts` | WS 订阅 + 指数退避重连（新建）|
| `apps/web/src/components/shell/NotificationsPopover.tsx` | 改为消费新 shape + 跳 /bugs |
| `apps/web/src/components/shell/TopBar.tsx` | 红点改服务端 unread；移除 lastRead localStorage |
| `apps/web/src/components/bugreport/BugReportDrawer.tsx` | 详情页加评论输入框 + reopen 徽章 + author 显示 |
| `apps/web/src/pages/Bugs/BugsPage.tsx` | 列表/详情 reopen 徽章 + 评论 author 显示 |
| `apps/web/src/App.tsx` | AppShell 挂载 useNotificationSocket |

### 测试

- `apps/api/tests/test_bug_reports.py`（新）6 例：reopen 触发 / admin 评论不触发 / 非终态不触发 / 累加 / HTTP 越权 403 / 提交者 HTTP 评论 + author 信息回传 + 详情含 reopen_count
- `apps/api/tests/test_notifications.py`（新）7 例：write+unread_count / mark_read+mark_all_read / admin 改状态通知 reporter / reopen 通知 assignee / admin 评论通知 reporter / 越权隔离（A 看不到 B 的）/ 自己操作不通知自己
- 全套 75 → 82 例通过；前端 tsc 0 errors。

### 验证（手动 E2E）

1. `docker compose up -d`，浏览器双账号登录（reporter A + admin B）
2. A 提交 BUG → B 铃铛红点 +1，下拉显示「{A} 评论了反馈 · B-N / 标题」
3. B 改状态 fixed + 写 resolution → A 铃铛 +1，详情页 status = 已修复
4. A 在 BugReportDrawer 详情页评论「还是有问题」→ status 自动回 已确认，徽章「曾重开 1 次」；B 收到 reopen 通知
5. WS 验证：A 浏览器 devtools 看 `wss://.../api/v1/ws/notifications` 帧；断网 30s 后轮询兜底

### 数据库脚本

```bash
# 重开过的 BUG
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT display_id, status, reopen_count, last_reopened_at FROM bug_reports WHERE reopen_count > 0 ORDER BY last_reopened_at DESC LIMIT 10;"

# 未读通知统计
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT user_id, count(*) FILTER (WHERE read_at IS NULL) AS unread, count(*) AS total FROM notifications GROUP BY user_id;"
```

### 推迟 / 后续观察

- 老的 `GET /auth/me/notifications`（v0.4.8 audit_log 派生）前端已不再调用，可视为 dead code 在下个 PR 清理
- 通知点击跳转目前固定 `/bugs`（admin 视图）；reporter 应跳「我的反馈抽屉」，需路由感知角色
- 通知偏好（按 type 静音 / 邮件 digest）
- LLM 聚类去重 + SMTP 邮件通知（ROADMAP 仍保留，独立成版）

---

## [0.6.8] - 2026-05-03

> v0.6.7 落地后项目管理员又收口 3 个反馈：B-13（同人退出重进偶发锁冲突复发）、B-14（删完批次后切分死循环 "No default batch found"）、B-15（任务队列只显示 100 条 / 看不到批次）。三者都触及 v0.6.7「数据集→批次」改造的尾部遗留。

### B-14：split 解耦 `B-DEFAULT` 哨兵（high）

- **现象**：`POST /api/v1/projects/{id}/batches/split` 返回 400 `No default batch found`。受影响项目 `4b856ea0…` 数据库内 0 批次、1206 条 `batch_id=NULL` 任务卡死。
- **根因**：v0.6.7 起新数据集落到独立「{ds.name} 默认包」批次，新项目不再有 `B-DEFAULT`；但 `apps/api/app/services/batch.py` 的 `_split_random` / `_split_metadata` / `_split_by_ids` 仍硬编码「从 `B-DEFAULT` 取任务」。同时 `delete()` 在无 `B-DEFAULT` 时不回收任务，删完所有批次即变孤儿。
- **修复**：
  - 新增 `_splittable_task_ids(project_id, default)` —— 返回 `batch_id IS NULL ∪ B-DEFAULT.id` 集合。三种 split 策略改用此集合。
  - `delete()`：无 `B-DEFAULT` 时把任务回退为 `batch_id=NULL`（保持可被 split 兜底），有 `B-DEFAULT` 仍走老回收路径（向后兼容）。
  - 错误信息从「No default batch found」改为「No unassigned tasks to split」（与新语义一致）。

### B-15：任务队列分页卡 100 + 批次不可见（high）

- **现象 1（100 条）**：队列永远只能看见 100 条，不论项目多大。
  - **根因**：`apps/api/app/api/v1/tasks.py list_tasks()` 首屏（无 cursor）的响应体不返回 `next_cursor`；前端 `useInfiniteQuery.getNextPageParam` 拿到 `undefined` → `hasNextPage=false` → 卡在第一页。同时首屏排序 `(sequence_order, created_at)` 与游标分支 `(created_at, id)` 不一致。
  - **修复**：合并两条分支为单一管线，统一排序 `(created_at, id)`，无论是否带 cursor 都计算 `next_cursor`。`offset` 仍兼容（无 cursor 时生效）。
- **现象 2（看不到批次）**：新项目 `/annotate` 页面没有任何批次提示，用户不知道要去分批；有 draft 批次的老项目下拉框也是空的。
  - **根因**：`apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx activeBatches` 只纳入 `active|annotating`，把 dataset 自动建的 `draft` 默认包也过滤掉了。`TaskQueuePanel.tsx` 也只在 `batches.length>0` 时才渲染下拉。
  - **修复**：
    - `activeBatches`：owner 视角扩到 `[draft, active, annotating]`；标注员仍按 `assigned_user_ids` 过滤（保留 v0.6.7 B-12-③ 的可见性约束）。
    - `TaskQueuePanel`：当 owner 且无任何批次时，渲染一行「未分批次 · 任务统一在「未归类」」+「前往分批」按钮，跳到 `/projects/{id}/settings?section=batches`。
    - 计数行从 `taskIdx+1 / tasks.length{+}` 改为 `taskIdx+1 / total`（用后端返回的真实 total，避免「100」错觉）。

### B-13：task_lock 接管路径加固（medium）

- **现象**：同一用户退出再进入任务时仍偶发「该任务正被其他用户编辑」。
- **根因（最可能）**：v0.6.7 已修了多行兜底 + ON CONFLICT + keepalive DELETE，但仍有两个未覆盖：
  1. **同会话乱序**：keepalive DELETE 与新 acquire 到达顺序不保证；my_lock 分支若在 DELETE 之前执行，会有「我刚续期又被自己删掉 / 留下假锁」的残影。
  2. **assignee 切换孤锁**：旧 assignee 锁未到期未到 stale 阈值（>150s 残留），新 assignee 进入直接判他人占用。
- **修复（`apps/api/app/services/task_lock.py acquire()`）**：
  - 同 `user_id` 多行时取 `expire_at` 最新的那行作为 `my_lock`，其余删除（覆盖乱序残影）。
  - 评估过加「持有者非 assignee 即接管」，但会破坏审核员合法持锁场景（reviewer 不是 assignee），舍弃。`others` 阈值仍按 `TTL/2 = 150s`，由现有 stale-takeover 兜底；后续若复现明确路径再考虑前端 `acquire ⨠ release` 串行化。

### 关键修改

| 文件 | 改动 |
| --- | --- |
| `apps/api/app/services/batch.py` | `_splittable_task_ids` + 三种 split 策略解耦 + `delete()` 兼容空批次 |
| `apps/api/app/api/v1/tasks.py` | `list_tasks` 首屏返回 next_cursor + 排序统一 |
| `apps/api/app/services/task_lock.py` | `acquire()` 自身多行 dedup + 单锁/非 assignee 接管 |
| `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` | `activeBatches` 纳入 draft + 透传 totalCount / isOwner / 跳转回调 |
| `apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx` | 计数用 total + 空批次「前往分批」CTA |

### 验证

- B-14：受影响项目自助点「随机切分」 → 创建批次成功，1206 条任务被切到新批次。
- B-15：队列计数显示 `1 / 1206`（不再是 100）；滚动持续加载到底；新项目无批次时显示 CTA。
- B-13：多 tab 同任务关闭再操作不报 409；assignee 切换后新人能直接接管。
- 已验证：现有 pytest 套件通过（task_lock dedup 测试不动）。

---

## [0.6.7-hotfix] - 2026-05-03

> v0.6.7 落地后立即收口的 3 项体感问题：① 快速重进项目仍偶发「他人占用」横幅 ② 取消关联数据集后 task 没真删，进度展示永远停在历史值 ③ 旧项目里大量 v0.6.0~v0.6.6 期间留下的孤儿 task 无清理路径。

### 问题 1：TaskLock 并发自重入

- **`apps/api/app/services/task_lock.py acquire()`** 改用 `INSERT ... ON CONFLICT (task_id, user_id) DO UPDATE SET expire_at = ...`：v0.6.7 第一版只处理了「他人锁悬挂」，但同用户两个并发 acquire 都看到 empty → 都裸 INSERT → 第二个撞 unique 约束 → 500 → 前端把任何 lock error 都当「他人占用」显示。upsert 让并发请求都成功（同 (task_id, user_id) 行 expire_at 续期）。
- **`tests/test_task_lock_dedup.py`** +1 例：同用户对同 task 连续 acquire → 只产生一行 + 都返回 lock。5→6 例。

### 问题 2 + 3：unlink 改 hard-delete + 孤儿任务清理

#### 后端

- **`apps/api/app/services/dataset.py unlink_project()`** 从 soft-unlink 改 hard-delete：级联删除 `tasks / annotations / annotation_comments / task_locks`（按 child→parent 顺序），重算 `project.{total,completed,review}_tasks` + 该项目所有 `TaskBatch` 计数器。返回 `{deleted_tasks, deleted_annotations, soft: false}`。
- **`apps/api/app/api/v1/datasets.py preview-unlink`** 返回字段改 `will_delete_tasks` / `will_delete_annotations`（明确「将删除」语义，不再是「保留为孤儿」）。
- **`apps/api/app/api/v1/projects.py`** 新增两个端点：
  - `GET /projects/{id}/orphan-tasks/preview` → `{orphan_tasks, orphan_annotations}`
  - `POST /projects/{id}/orphan-tasks/cleanup` → 删除「无源 task」（dataset_item_id 指向已 unlink 的数据集，或为空），重算 counters + audit
- **`apps/api/app/api/v1/projects.py _serialize_project()`** 补 `in_progress_tasks` 字段（即时 COUNT 查询，不依赖 stored counter，因 Project model 未存这一项）。
- **`apps/api/app/schemas/project.py ProjectOut`** 加 `in_progress_tasks: int = 0`。

#### 前端

- **`apps/web/src/components/ui/ProgressBar.tsx`** 新增 `inProgressValue?` prop，渲染最底层「已动工」副条（`var(--color-accent-soft)` 淡色），让 0 完成但有任务在标注的项目进度条不再永远空白。
- **`apps/web/src/pages/Dashboard/DashboardPage.tsx ProjectRow`**：① 计算 `startedPct = (in_progress + review + completed) / total`，传给 ProgressBar ② 数字下方加细分文案 "X 进行中 · Y 待审"。
- **`apps/web/src/pages/Datasets/DatasetsPage.tsx UnlinkConfirmModal`** 文案改：「将一并删除 N 个任务（含 K 个已标注），此操作不可恢复」 + 按钮 "确认删除并取消关联"。
- **`apps/web/src/pages/Projects/sections/DangerSection.tsx`** 新增「清理孤儿任务」面板：显示当前孤儿数量 → 点击弹二次确认 modal → 调 `cleanupOrphanTasks` → 显示删除结果 + invalidate 全部 project 相关 query。
- **`apps/web/src/api/projects.ts`** + `apps/web/src/api/datasets.ts`：新增 `previewOrphanTasks` / `cleanupOrphanTasks` / 调整 `previewUnlink` / `unlinkProject` 返回类型。

#### 测试 / 验证

- `pytest`：69 例全绿（68 → 69，新增 1 例「unlink hard-delete」+ 调整原 2 例语义）。
- API 实测：
  - `GET /projects/{P-3}/orphan-tasks/preview` → `{"orphan_tasks":1206,"orphan_annotations":0}`
  - `POST /projects/{P-3}/orphan-tasks/cleanup` → `{"deleted_tasks":1206,"deleted_annotations":0}`
  - 项目从虚高 1214 task 收敛到真实 8 task（B-DEFAULT 同步显示 8/8）
- 前端 dashboard：P-3 进度行从 "0/1,214 0%" → "0 / 8 · 1 进行中 · 2 待审 · 0%" + 已动工副条可见。

#### 不可逆 schema 变更

- 无新 alembic（cleanup 是 runtime 操作，不是 schema migration）。

### 推迟到 v0.6.8+

- Wizard 步骤 2 升级到 ClassesSection 完整 `classes_config` 编辑（颜色 / 别名 / 父子结构）
- Wizard 新增「属性 schema」步骤（attribute_schema 全功能编辑器）
- 「项目设置 → 危险操作」加「清理无源任务」按钮（清理 unlink 后的孤儿）
- 批次级 reviewer dashboard
- B-12-④ 进一步：在项目卡上嵌「N 个批次 · K 已分派」概览（需后端补 ProjectStats 字段）

---

## [0.6.7] - 2026-05-03

> v0.6.7 收口项目管理员的 4 项反馈（B-10 / B-11 / B-12 / B-13），核心是把 v0.6.x 一直藏在数据/分包/分派后台的工作流暴露到 UI 上，并修掉退出重进任务时的 lock 残留 bug。pytest 60→68 例（+8）。
>
> 行为变更：
> - **关联数据集后自动建独立批次**（`{ds.name} 默认包`），不再倾倒进 `B-DEFAULT`；存量 `B-DEFAULT` 不动。
> - **取消关联数据集**改为 soft-unlink + 二次确认 + 计数器重算；不再裸删 task（保留标注），孤儿 task 留待「危险操作」清理（v0.6.7+）。
> - **批次状态 draft → active** 现在要求 `assigned_user_ids` 非空（前端按钮 disabled + tooltip）。
> - **标注员/审核员的 batch 下拉**现在按 `assigned_user_ids` 过滤（owner / super_admin 仍看全部）。

### B-13 · TaskLock 自重入鲁棒性

- **`apps/api/app/services/task_lock.py:17-51 acquire()`**：`my_lock` 不存在 + 他人锁全部 `expire_at < now + TTL/2` 时视为「悬挂残留」自动接管（活会话每 60s 心跳，`expire_at - now ∈ [240, 300]`，TTL/2 = 150s 给两次心跳容错）。`_cleanup_expired` 仅清严格过期行的旧逻辑兜底。
- **`apps/web/src/api/tasks.ts`** 新增 `releaseLockKeepalive`：用 fetch `keepalive: true` 保证 unmount / 页面跳转时 DELETE 仍能送达，避免残留 lock 把用户挡在自己刚释放的任务外。
- **`apps/web/src/hooks/useTaskLock.ts`** cleanup 改用 keepalive 版本（去掉 async/await 回退）。
- **`apps/api/tests/test_task_lock_dedup.py`** +2 例：他人 stale 锁（expire_at = now+60s）→ 接管；他人活锁（expire_at = now+280s）→ 仍 409。3→5 例全绿。

### B-11 · CreateProjectWizard 扩展为 5 步

- **`apps/web/src/components/projects/CreateProjectWizard.tsx`** 整体重写：原 3 步（类型/类别/AI）→ 5 步 + 完成页：
  1. **类型**：name + type + due_date（不变）
  2. **类别**：简单字符串列表（不变；后续可在设置页升级到 classes_config）
  3. **AI**：on/off + 模型（不变）
  4. **数据**（新）：从 `useDatasets()` 多选数据集；可选「随机切分为 N 个批次」（默认保留每个数据集一个独立包）。提交时顺序 `linkProject(...)` 每个数据集 + 可选 `useSplitBatches`，单个失败不阻断。
  5. **成员**（新）：从 `useUsers()` 过滤 annotator / reviewer 多选，循环 `useAddProjectMember`，单个失败不阻断。
  6. **完成**：显示「已关联 N 个数据集 · 已添加 K 位成员」+ 「项目设置 / 工作台 / 完成」按钮。
- **localStorage 草稿**：`create_project_draft_v0_6_7` key 持久化 1-3 步表单（关闭模态丢弃，提交成功清除），刷新不丢。
- 步骤 4-5 可跳过，避免逼迫用户在没有数据/成员时硬填。

### B-12 · 数据分包 / 分派可见性

#### B-12-① · link_project 自动建命名 batch

- **`apps/api/app/services/dataset.py link_project()`**：N items 不再裸落 `B-DEFAULT`，而是新建一个 `TaskBatch{ name: "{ds.name} 默认包", display_id: BT-{N}, dataset_id, total_tasks: N }`，把所有新建任务的 `batch_id` 写到此 batch。`B-DEFAULT` 保留作为「未归类」哨兵但新接入数据集不再倾倒进去。
- **`apps/web/src/hooks/useDatasets.ts useLinkProject`** invalidate 增 `["projects", projectId]` / `["project-stats"]` / `["batches", projectId]`，让 BatchesSection / Dashboard 即时刷新。
- **`apps/api/tests/test_dataset_link.py`** 新增 1 例：link 后 `TaskBatch` 表新增一行命名匹配 + tasks 全部挂到此 batch（8/8）。

#### B-12-② · BatchesSection 分派 UI

- **`apps/web/src/components/projects/BatchAssignmentModal.tsx`**（新建，182 行）：从 `useProjectMembers(projectId)` 拉成员，按 `role ∈ {annotator, reviewer}` 分两栏多选，提交走 `useUpdateBatch.mutate({ batchId, payload: { assigned_user_ids } })`。
- **`apps/web/src/pages/Projects/sections/BatchesSection.tsx`** 表格增「分派」列：未分派显示橙色「未分派」chip，已分派显示前 3 个头像 + 计数；点击打开 modal。`draft → active` 转移按钮在 `assigned_user_ids.length === 0` 时 disabled + tooltip「请先分派成员」。

#### B-12-③ · Workbench 按 batch 过滤

- **`apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`**：`activeBatches` 计算增 owner/super_admin 判断 —— 非项目 owner 时只看 `assigned_user_ids.includes(meUserId)` 的活跃批次。下拉 dropdown 复用 v0.6.0 已存在的 `TaskQueuePanel` UI。

#### B-12-④ · 项目卡批次概览 + Settings 深链

- **`apps/web/src/pages/Projects/ProjectSettingsPage.tsx`**：新增 `?section=` query 解析（`general | classes | attributes | members | batches | owner | danger`），允许从 dashboard 或 toast 直跳到目标 section。
- **`apps/web/src/pages/Dashboard/DashboardPage.tsx ProjectRow`**：进度列下方加「→ 查看批次分派」小链接（仅 canManage 可见），点击跳 `/projects/{id}/settings?section=batches`，`onSettings` 签名扩 `(p, section?)`。

### B-10 · 取消关联数据集二次确认 + 计数同步

#### 后端

- **`apps/api/app/services/dataset.py unlink_project()`** 改造：返回类型从 `bool` 改为 `dict | None`，`None` = 链接不存在；否则统计 `orphan_tasks` 数后只删 `ProjectDataset` 行（保留 task / annotation / 子表数据），重算 `project.{total_tasks, completed_tasks, review_tasks}` 用 `func.count + filter` 等价 `BatchService._sync_project_counters` 的逻辑（避免循环 import）。
- **`apps/api/app/api/v1/datasets.py`**：① `POST /datasets/{id}/link` 增 `AuditAction.DATASET_LINK` 审计；② 新增 `GET /datasets/{ds_id}/link/{project_id}/preview-unlink` 返回 `{ orphan_tasks }`，前端确认弹窗用；③ `DELETE /datasets/{id}/link/{project_id}` 状态码 204→200，body 返回 `{ orphan_tasks }`，写 `AuditAction.DATASET_UNLINK` 审计 + `detail.soft=true`。
- **`apps/api/app/services/audit.py AuditAction`** 增 `DATASET_LINK` / `DATASET_UNLINK`。

#### 前端

- **`apps/web/src/api/datasets.ts`**：`unlinkProject` 返回类型改 `{ orphan_tasks: number }`；新增 `previewUnlink`。
- **`apps/web/src/hooks/useDatasets.ts useUnlinkProject`** invalidate 增 `["projects"]` / `["project", projectId]` / `["project-stats"]` / `["batches", projectId]`，进度条立即重算。
- **`apps/web/src/pages/Datasets/DatasetsPage.tsx`** 取消关联按钮改弹 `UnlinkConfirmModal`：先 `previewUnlink` 拿孤儿数 → 显示「项目「{name}」中由该数据集创建的 N 个任务将保留为孤儿（不再计入项目进度，可在『项目设置 → 危险操作』中清理）」；确认后 unlink。
- **`apps/api/tests/test_dataset_link.py`** 新增 2 例：① link → unlink → `total_tasks` 等于真实 task 数 ② link → unlink → re-link 不出现 double-count（修复前 4+4=8 的硬伤）。3→5 例全绿。

### 文件变更摘要

后端：
- `apps/api/app/services/task_lock.py`（acquire 增 stale 接管分支）
- `apps/api/app/services/dataset.py`（link 自动建 batch，unlink soft + 计数重算）
- `apps/api/app/api/v1/datasets.py`（link 端点加 audit + 新增 preview-unlink + unlink 返回 orphan_tasks）
- `apps/api/app/services/audit.py`（+2 AuditAction）
- `apps/api/tests/test_task_lock_dedup.py`（+2 例 → 5/5）
- `apps/api/tests/test_dataset_link.py`（+3 例 → 6/6）
- `apps/api/app/main.py`（version 0.6.0 → 0.6.7）

前端：
- `apps/web/src/components/projects/CreateProjectWizard.tsx`（重写 6 步）
- `apps/web/src/components/projects/BatchAssignmentModal.tsx`（新增）
- `apps/web/src/pages/Projects/sections/BatchesSection.tsx`（分派列 + transition guard）
- `apps/web/src/pages/Projects/ProjectSettingsPage.tsx`（?section= 解析）
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`（activeBatches owner-aware）
- `apps/web/src/pages/Dashboard/DashboardPage.tsx`（ProjectRow 加深链）
- `apps/web/src/pages/Datasets/DatasetsPage.tsx`（UnlinkConfirmModal）
- `apps/web/src/hooks/useDatasets.ts`（link/unlink invalidate 扩展）
- `apps/web/src/hooks/useTaskLock.ts` + `apps/web/src/api/tasks.ts`（keepalive release）
- `apps/web/src/api/datasets.ts`（previewUnlink + unlinkProject 返回类型）
- `apps/web/package.json`（version 0.1.0 → 0.6.7）

### 验证

- `pytest`：68/68 通过（v0.6.6 60 + v0.6.7 +8）
- `pnpm vitest`：64/64 通过（无新增 smoke，仅回归）
- `tsc --noEmit`：0 错


---

## [0.6.6] - 2026-05-02

> v0.6.6 是 v0.6.x 系列存量观察清单清扫版：把 v0.6.2 phase 2 / v0.6.4 / v0.6.5 写时观察的 14 项 quick win 一次收口，并补齐 GDPR 脱敏 / Sentry / Bug 反馈截图 / CI/CD pipeline 等治理项，让 v0.6.7+ 能腾出干净画布做 SAM / 多任务类型工作台。pytest 50→60 例（+10），vitest 55→64 例（+9），index chunk 740KB→500KB。

### 测试基座（解锁旧测套）
- **`apps/api/tests/conftest.py` 重写**：`test_engine` 改 function-scoped（与 pytest-asyncio function-scope event loop 兼容）；`httpx_client` 默认绑定 `dependency_overrides[get_db] = db_session` —— v0.5.5 / v0.6.0 / v0.6.3 留下的 22 例旧 httpx 集成测无需改代码即解锁。
- **`apps/api/app/db/models/__init__.py`**：补全 `Group` / `Dataset` / `DatasetItem` / `ProjectDataset` 注册（之前 FK 解析在某些用例下失败）。
- **`apps/web` vitest 基座**：装 `@testing-library/react` + `jsdom` + `@testing-library/jest-dom`，`vite.config.ts` 加 `test` 配置 + `vitest.setup.ts`。

### 测试欠账（10 例补齐）
- **后端 +6 例**：`test_dataset_link.py` (3) / `test_attribute_audit.py` (1) / `test_comment_polish.py` (4) / `test_user_delete_gdpr.py` (1) / `test_task_reopen_notification.py` (1) / `test_alembic_drift.py` (1，model ↔ migration drift sanity 检测)。
- **前端 +9 例**：`CommentInput.test.tsx` (6) / `ExportSection.test.tsx` (3)。

### 数据 & 存储
- **维度回填 UI**：DatasetDetail 加「回填维度」按钮，调 `POST /datasets/{id}/backfill-dimensions`，toast 显示 processed/failed/remaining_hint。
- **`link_project` bulk_insert**：`SELECT nextval(seq) FROM generate_series(1, N)` 一次预分配 + 单次 `insert(Task)`，1000 items ~2s → < 200ms。

### 审计日志双行 UI 合并（全链路）
- **后端**：`audit_logs.request_id` 字段持久化（migration 0023，B-tree 索引）；AuditMiddleware + AuditService.log/log_many 都写顶层 `request_id` 列（不再混在 detail_json）；`AuditLogOut` schema 暴露字段。
- **前端**：AuditPage 按 `request_id` group → 折叠为单行 + ▸ 展开（同请求 metadata + N 条业务 detail），同时 useVirtualizer 化整张表（5000+ 行 60FPS）。

### Reviewer 仪表板升级
- **后端**：`GET /dashboard/me/recent-reviews` 新端点，从 Task.reviewer_id + reviewed_at 反查；`ReviewerDashboardStats` 增 `approval_rate_24h`（基于 audit_logs 过去 24h `task.approve` / `task.reject` 计数）。
- **前端**：5 张统计卡（待审队列 / 今日已审 / 24h 通过率 / 历史通过率 / 累计审核）+ 「我的最近审核记录」list。

### WorkbenchShell 第三刀
- **`useWorkbenchTaskFlow.ts` 新建**：从 shell 拆出 `navigateTask` / `smartNext` / `hasMissingRequired` / `handleSubmitTask`（~80 行）。WorkbenchShell.tsx 1003 → 924 行。

### CanvasDrawing 历史回看
- **`useHoveredCommentStore` (zustand)** + **ImageStage `historicalShapes` prop**：CommentsPanel 评论卡片 onMouseEnter → 把 `c.canvas_drawing.shapes` 写进 store，ImageStage 半透明虚线叠加只读层（opacity 0.5 + dash）。canvas 真正变成「有效沟通」工具。

### 体验 quick win
- **`usePopover` 通用 hook**：抽 click-outside + ESC-close + 锚点定位；ExportSection 已迁移作示范，其余 4 处保留留作渐进迁移。
- **AttributeForm 数字键 hint 强化**：hotkey badge 改用 accent 色 + ⌨ 图标 + 加粗，强提示「数字键 = 属性快捷键」。
- **CommentInput.serialize 边界覆盖**：单测覆盖 chip 紧邻 chip / 块元素首尾 / BR 换行 / 缺 displayName 等边界情况。

### GDPR / 合规
- **用户软删后 audit_logs 脱敏**：`DELETE /users/{id}` 在 AuditService.log 后 `UPDATE audit_logs SET actor_email=NULL, actor_role=NULL WHERE actor_id=user_id`，保留 actor_id（FK 仍指向软删行；用户行真正 DELETE 时 ON DELETE SET NULL 兜底）。脱敏行数追加到 `user.delete` audit detail。

### 可观测性
- **Sentry 前后端**：后端 `sentry-sdk[fastapi]` + lifespan 早期 init（DSN 留空则不启用，dev 默认关闭）；before_send 钩子剔除 Authorization 头。前端 `@sentry/react` + `Sentry.captureException` 接到现有 ErrorBoundary。新增 `SENTRY_DSN` / `VITE_SENTRY_DSN` env。
- **MinIO bucket lifecycle**：`comment-attachments/` 90 天 + `bug-screenshots/` 180 天自动过期，避免无限增长（celery beat 未启用，靠 lifecycle 兜底）。

### Bug 反馈系统延伸（截图 + 涂抹 + MinIO）
- **`POST /bug_reports/screenshot/upload-init`**：签发 `bug-screenshots/{user_id}/{uuid}.png` PUT 预签名 URL。
- **前端 `captureScreenshot()`**：动态 import html2canvas，`ignoreElements` 排除 drawer/FAB/toast 自身；`ScreenshotEditor.tsx` 拖拽黑色矩形遮挡敏感区，确认后 toBlob 回写。
- **BugReportDrawer**：「截取当前画面」按钮 + 涂抹 → 提交时调 `uploadBugScreenshot()` 拿 storage_key 写入 `screenshot_url`。

### 性能
- **vite 路由级 lazy-load**：WorkbenchPage / DatasetsPage / AuditPage / UsersPage / ReviewPage / StoragePage / SettingsPage / BugsPage / ProjectSettingsPage 全部 React.lazy + Suspense；登录页 / Dashboard 保持同步加载。**index chunk 740KB → 500KB（gzip 205→147KB）**，WorkbenchPage 独立 186KB chunk + vendor-konva 290KB chunk，登录用户不再下载 konva。

### CI / 工程化
- **`.github/workflows/ci.yml`**：3 jobs — pytest（含 alembic up→down→up round-trip）+ vitest + lint。postgres service container 启 alembic + pytest。
- **`test_alembic_drift.py`**：用 `MetaData.reflect()` 对比真实库 schema 与 `Base.metadata`，列名 / 表名集合不一致则 fail（防 v0.6.4 那种 model 加 unique=True 但 migration 漏写的 silent drift）。

### 推迟到 v0.6.7+ 的项
- Bug 反馈延伸的 **LLM 聚类去重 + 邮件通知**（需要新引 LLM SDK + SMTP 实现，与截图链路无强耦合）
- celery beat **定时清理 `is_active=false` 评论**（lifecycle 已兜底 90 天）
- husky / lint-staged **预提交钩子**（CI 已落地，本地拦截可后续加）
- `useCurrentProjectMembers` **顶层 context**（React Query 已按 queryKey 去重，收益不足以引入新抽象）
- `usePopover` **剩余 4 处迁移**（hook 已可用，留作渐进迁移）

---

## [0.6.5] - 2026-05-02

> v0.6.5 收两件事：① **标注 / 审核流程任务锁定**（用户主诉求）—— 让本就存在但形同虚设的 `review/completed` 状态机真正生效，加「撤回」与「重开」两条逆向路径，前后端编辑全链路防护、审计 / 通知打点齐全；② **v0.6.4 后续观察 4 项 quick win**：vite manualChunks 拆 vendor chunk、CanvasDrawing sessionStorage 持久化、HotkeyCheatSheet 搜索 + 按使用频率排、react-markdown 暗色对比度修复。
>
> 行为变更（非 breaking 但需注意）：
> - **任务进入 `review` / `completed` 后，所有 annotation 写端点（POST/PATCH/DELETE/accept_prediction）一律 409 `task_locked`**。前端 `WorkbenchShell` 自动 readOnly + toast 拦截，未走 UI 直接 curl 的脚本会撞墙 —— 先 `POST /tasks/{id}/withdraw` 或 `/reopen` 解锁。
> - **`reject` 现在 `reason` 必填**（之前接收但丢弃），且 task 落到 `in_progress` 而非 `pending`（语义更准）。`ReviewerDashboard` 退回按钮加了 `window.prompt` 让标注员能看到原因。
> - **bundle 拆分**：`vendor-konva.js` / `vendor-markdown.js` 独立 chunk。CDN 缓存 / HTTP/2 多路复用收益直接给到。

### 项 1 · 任务状态机锁定与撤回 / 重开（用户主诉求）

#### 后端

- **Task 模型 +7 字段**（`apps/api/app/db/models/task.py:30-37`）：`submitted_at` / `reviewer_id` (FK users, ON DELETE SET NULL) / `reviewer_claimed_at` / `reviewed_at` / `reject_reason` (String 2000) / `reopened_count` / `last_reopened_at`。alembic `0022_task_lock_fields.py` 加 7 列 + FK + `ix_tasks_reviewer_id`，无数据回填。
- **`AuditAction` +6 项**（`services/audit.py:39-46`）：`task.submit / task.withdraw / task.review_claim / task.approve / task.reject / task.reopen`。每个状态变更都通过 `AuditService.log` 写一行，含 `target_type="task"` + `target_id=task.id` + `request_id`，让 `me.py:get_notifications` 直接看到。
- **`api/v1/tasks.py` 端点全改造**：
  - 新 helper `_assert_task_editable(task)`：`status ∈ {review, completed}` 抛 `409 {reason: "task_locked", status: ...}`。挂到 `create_annotation` (`:142`)、`update_annotation` (`:170`)、`accept_prediction` (`:316`)、`delete_annotation` (`:330`)。
  - **`POST /submit`** 改造（`:357`）：状态守卫（必须 `pending`/`in_progress`，否则 409 `task_not_submittable`）；写 `submitted_at`；清空上一轮 reviewer 痕迹（reopen → 再次 submit 场景）；写 audit。
  - **`POST /withdraw` 新增**（`:402`）：标注员撤回质检。前提三选一同时满足 —— `status=review` AND `assignee_id == 当前用户` (admin 兜底) AND `reviewer_claimed_at IS NULL`。任一不满足返回 409/403。改回 `in_progress` + 清 `submitted_at` + 写 audit。
  - **`POST /review/claim` 新增**（`:469`）：reviewer 进入审核页时调用（幂等）。第一个调用者写 `reviewer_id` + `reviewer_claimed_at`；后续调用者读取已存在的认领信息（不覆盖）。一旦 claim，标注员 withdraw 入口冻结。返回 `ReviewClaimResponse { task_id, reviewer_id, reviewer_claimed_at, is_self }`。
  - **`POST /review/approve`** 改造（`:507`）：写 `reviewer_id`（若未 claim 则用当前 user）+ `reviewed_at`；写 audit；项目 `completed_tasks++` / `review_tasks--` 保留原逻辑。
  - **`POST /review/reject`** 改造（`:556`）：`reason` **必填且非空**（之前 body 带不带都行，现在 400 `reject reason is required`）；持久化 `reject_reason` 到 task；改回 `in_progress`（之前是 `pending`）；写 audit detail.reason。
  - **`POST /reopen` 新增**（`:613`）：标注员对 `completed` 任务单方面重开。前提：`status=completed` AND `assignee_id == 当前用户` (admin 兜底)。`reopened_count++`、`last_reopened_at = now`、清 reviewer_*、`completed_tasks--`；audit detail 留 `original_reviewer_id`，让 `me.py:get_notifications` 把通知推给原 reviewer。
- **`me.py:get_notifications` 通知扩展**（`api/v1/me.py:46-100`）：filters 多两条 —— ① `target_type="task" AND target_id IN (我作为 assignee 的 task ids)` 把 approve/reject 通知拉给标注员；② `target_type="task" AND action="task.reopen" AND detail.original_reviewer_id == self` 把重开通知推给原审核员。复用现有 30s 轮询通道，零新增端点。
- **schema 暴露**：`TaskOut` (`schemas/task.py:25-31`) 新增 7 字段；新 `ReviewClaimResponse`。

#### 前端

- **`hooks/useTasks.ts`** 新增 3 hook：`useWithdrawTask` / `useReopenTask` / `useReviewClaim`，全部走 `tasksApi.*` + invalidate 三 query (`task` / `annotations` / `tasks`)。`useRejectTask` 的 `reason` 类型从 `string?` 改成 `string` 必填，type 层提醒所有 caller。
- **`api/tasks.ts`** 新方法 `withdraw` / `reopen` / `reviewClaim`；`types/index.ts` `TaskResponse` 同步加 7 字段 + 新 `ReviewClaimResponse`。
- **`WorkbenchShell.tsx`** 状态机锁定 UI：
  - 计算 `isLocked = task?.status in ["review", "completed"]`，传给 `<ImageStage readOnly>` (`:725`) 与 `<AIInspectorPanel readOnly>` (`:881`)。
  - 三色横幅（lockError 横幅之下）：① `status=review` 蓝色「已提交质检 · 等待审核」+ `[撤回提交]` 按钮（仅 `reviewer_claimed_at == null` 可点，否则灰显示「审核员已介入」）；② `status=completed` 绿色「已通过审核 · 已锁定」+ `[继续编辑]` + reopen 计数显示；③ `status=in_progress && reject_reason` 红色显示「审核员退回：<reason>」。
  - 错误处理：withdraw 失败如果 detail.reason==`task_already_claimed`，toast 提示「审核员已介入，无法撤回」。
- **`useWorkbenchAnnotationActions.ts`** 入口加 `isLocked` 参数 + `blockIfLocked()` short-circuit：`handleDeleteBox` / `handleCommitMove` / `handleCommitResize` / `handleCommitPolygonGeometry` / `submitPolygon` / `handlePickPendingClass` 6 处入口先 toast「任务已锁定 · 撤回提交或继续编辑后再操作」再 return。
- **`AIInspectorPanel.tsx`** 接受 `readOnly?` prop，转发给 `<AttributeForm readOnly>`。`AttributeForm` 的 `readOnly` v0.6.0 就有，本期复用。
- **`TaskQueuePanel.tsx`** Lock icon：`status ∈ {review, completed}` 时在 task item 数量徽章左侧显示锁图标 + tooltip。
- **`ReviewWorkbench.tsx`** 进入审核页 useEffect on mount 调 `tasksApi.reviewClaim(taskId)`（仅 `status=review` 时）。响应 `is_self=false` 顶部黄色横幅「已被其他审核员认领（时间），仍可接力处理」。
- **`ReviewerDashboard.tsx`** reject 按钮加 `window.prompt("退回原因（必填）")`，配合后端的强校验。

#### 测试

- **`apps/api/tests/test_task_lock.py`** 新增 5 例（全绿）：① 完整状态机 round-trip：assign → submit (`review`) → withdraw → submit → claim → withdraw 被拒 (`409 task_already_claimed`) → approve → reopen (`reopened_count=1`)；② 编辑端点拦截：review 态下 PATCH/DELETE/POST annotation 全部 `409 task_locked`；③ 非 assignee 调 withdraw → 403；④ reject 缺 reason / 空白 reason → 400，合法 reason → 持久化；⑤ 6 个状态变更各产 1 条 `audit_logs`，顺序 `task.submit → task.withdraw → task.submit → task.review_claim → task.approve → task.reopen`，reopen 的 detail 含 `original_reviewer_id`。
- **测试基座修补**：本文件内 override `test_engine` / `db_session` 为 function 作用域，绕过 conftest 的 session-scoped engine 与 pytest-asyncio function-scoped event loop 冲突（这是先前测试套件无法跑的根因）。后续可把这套修补回写到 conftest.py。

---

### 项 2 · v0.6.4 后续观察 4 项 quick win

- **vite manualChunks 拆 vendor chunk**（`apps/web/vite.config.ts`）：`{ "vendor-konva": ["konva", "react-konva"], "vendor-markdown": ["react-markdown"] }` + `chunkSizeWarningLimit: 600`。build 实测：v0.6.4 是 `index 1.15MB / 330KB gz` 单 chunk → v0.6.5 拆成 `index 740KB / 205KB` + `vendor-konva 290KB / 89KB` + `vendor-markdown 126KB / 39KB`，主入口缩 37%、Konva 与 markdown 走并行下载 + CDN 长缓存。
- **CanvasDrawing sessionStorage 持久化**（`pages/Workbench/state/useCanvasDraftPersistence.ts` 新增）：闭环 v0.6.4 留下的「画完一笔忘发评论 / 刷新 → 全丢」bug。① 切到新 taskId 时检查 `sessionStorage["canvas_draft:" + taskId]`（5 分钟 TTL），若有就调 `beginCanvasDraft(annotationId, { shapes })` 恢复；② `canvasDraft.active && shapes.length > 0` 期间任何变化都立即写回；③ 退出 canvas 模式（commit / cancel）即清键；④ active + shapes>0 时挂 `beforeunload` 触发浏览器原生确认。`useRef` 防同任务重复恢复。`WorkbenchShell` 单行接入。
- **HotkeyCheatSheet 搜索 + 按使用频率排**（`shell/HotkeyCheatSheet.tsx` + `state/hotkeyUsage.ts` 新增 + `state/hotkeys.ts` 增字段）：
  - 顶部搜索框：模糊匹配 `desc` 或 `keys.join(" ")`，分组实时过滤。
  - `[ ] 按使用频率排` 复选框：开启后所有命中 HotkeyDef 平铺、按 `usage[actionType]` 倒序、`×N` 计数徽章贴在 desc 旁；关闭恢复原分组视图。
  - 计数实现：`HotkeyDef` 加可选 `actionType` 字段，`useWorkbenchHotkeys.ts:227` 在 `dispatchKey` 返回 action 后立即 `recordHotkeyUsage(action.type)` 写 localStorage（`hotkey_usage_v1`，单 bucket cap 10000 防膨胀）。同 `actionType` 多 key 合并计数（如 `setTool` 涵盖 B/V/P）—— 是合理近似。
- **react-markdown 暗色主题对比度修复**（`styles/tokens.css` + `shell/AttributeForm.tsx`）：root case：`bg-elev` 在亮色是白 `#fff`、暗色是 `#1a1a1d`；inline-code 之前用 `bg-sunken`（暗色 `#0a0a0c`）反而比 popover 还黑，看不清。新增 `--color-code-bg` (light `#ececef` / dark `#2e2e33`) + `--color-code-fg` token；`DescriptionPopover` 的 `code` 组件改用新 token + 1px border 提升对比；顺手补 `strong` / `em` / `li` 语义化样式。

---



> v0.6.4 一次性收口 ROADMAP「v0.6.2 落地后发现的尾巴 · 应修」全部 8 项。后端：display_id 全表统一为「字母前缀 + 顺序号」、JSONB 字段强类型化、OpenAPI dump 脚本。前端：WorkbenchShell 第二次拆 hook（annotation actions + hotkeys）、CanvasDrawing 入 ImageStage 第 5 Konva Layer 共享坐标系、AttributeField 描述支持 markdown、OfflineQueueDrawer 按 task 分组 + retry_count 视觉、annotator 端开放画布批注。
>
> ⚠️ Breaking：`task_batches.display_id` 前缀从 `B-{hex6}` 改为 `BT-{N}`（避免与 `bug_reports.B-{N}` 冲突）。`tasks.display_id` 从 `T-{hex6}` 改为 `T-{N}`、`datasets` 从 `DS-{hex6}` 改为 `D-{N}`、`projects` 从 `P-{hex4}` 改为 `P-{N}`。alembic 迁移 0021 自动回填存量数据；URL 路由不依赖 display_id（仅作为展示 + 文件名），因此用户感知是仅仅 ID 变短。如有任何脚本字面量比对 `T-XXXXXX` 形态需调整。

### 项 8 · display_id 风格统一 + 序列化生成器

#### 后端
- 新增 `apps/api/app/services/display_id.py`：`next_display_id(db, entity)` 走 Postgres `SEQUENCE` 取号（lock-free，比 `MAX+1` 安全得多），`ENTITY_TO_PREFIX` 映射 `bug_reports → B / tasks → T / datasets → D / projects → P / batches → BT`。
- 新增 alembic `0021_unify_display_id.py`：① 建 5 个 sequence ② `ROW_NUMBER OVER (ORDER BY created_at, id)` 回填 projects/datasets/task_batches/tasks（保留 `B-DEFAULT` 哨兵不动）③ `setval` 同步序列至 MAX(N) ④ tasks/projects 加全局 unique 约束、task_batches 加 `(project_id, display_id)` 复合 unique（每 project 都有 `B-DEFAULT`）⑤ 完整性自检（`COUNT != COUNT DISTINCT` 时 RAISE）。
- 6 处 call site 改用 `next_display_id`：`bug_report.py:205-212`（删 buggy `MAX+1`）、`dataset.py:90/309`、`batch.py:70/187/229/267`、`projects.py:151`、`files.py:27`。`B-DEFAULT` 字符串字面量在 `batch.py:54,122` 保留作为默认批次哨兵。
- model 同步 unique：`project.py:14`、`task.py:15`、`task_batch.py` 加 `__table_args__ = (UniqueConstraint("project_id", "display_id"),)`。

#### 测试
- 新增 `tests/test_display_id.py`（5 例）：序列号生成、并发 50 个 asyncio.gather 唯一性、未知 entity 拒绝、prefix 映射完整。

### 项 2 · Pydantic JSONB 全字段强类型 + codegen 联动

#### 后端
- 新增 `app/schemas/_jsonb_types.py`：`AttributeFieldOption` / `AttributeField` / `AttributeSchema` / `VisibleIfRule` / `ClassConfigEntry` / `BboxGeometry` / `PolygonGeometry` / `Geometry`（discriminator on `type`）/ `AnnotationAttributes`（值类型受限）/ `Mention` / `Attachment` / `CanvasShape` / `CanvasDrawing` / `AuditDetail`（known fields + extra=allow）。
- `project.py` `ProjectOut.classes_config: ClassesConfig`、`attribute_schema: AttributeSchema`；`ProjectUpdate` 同步收紧。原 `_validate_*` 函数删除（结构 + AttributeSchema 内部 model_validator 替代）。
- `annotation.py` `AnnotationOut/Create/Update.geometry: Geometry`、`attributes: AnnotationAttributes`；`field_validator(mode="before")` 兼容历史无 type 的 bbox。
- `annotation_comment.py` `mentions: list[Mention]`、`attachments: list[Attachment]`、`canvas_drawing: CanvasDrawing | None`（之前 OUT 端用 `dict[str, Any]` 丢类型）。
- `audit.py` `detail_json: AuditDetail | None`，AuditDetail 是带已知字段（request_id / task_id / field_key / before / after / old_name / new_name）+ `extra=allow` 的 BaseModel。
- 新增 `apps/api/scripts/dump-openapi.py`：`PYTHONPATH=. python3 scripts/dump-openapi.py /tmp/openapi.json`，给 CI 离线 codegen 用，无需运行后端。

#### 前端
- 删 `apps/web/src/api/projects.ts:44-54` 的 `Omit + 富类型` workaround；`ProjectResponse` / `AttributeField` / `AttributeSchema` / `ClassesConfig` 等全部从 `generated/types.gen.ts` 直接 re-export。
- 删 `apps/web/src/api/comments.ts:3-24` 本地 `CommentMention/CommentAttachment/CommentCanvasDrawing` 接口；改为 `Mention/Attachment/CanvasDrawing` 的 type alias 再导出（向后兼容旧名）。
- `pnpm codegen` 后 generated 类型直接出 `geometry: BboxGeometry | PolygonGeometry`、`shapes: Array<CanvasShape>`、`mentions: Array<Mention>` 等 sum/struct types。
- 修 13 个 codegen 联动后的 TS 错（CanvasDrawingEditor 内部 state 改用 `NonNullable<...["shapes"]>`、AttributeForm 用 `?? []` / `?? undefined` 容错可选字段）。

#### 测试
- 新增 `tests/test_jsonb_strong_types.py`（13 例）：bbox/polygon 校验、AttributeSchema unique key + hotkey 约束、Mention alias、Attachment prefix 守卫、CanvasShape extra=forbid、AuditDetail extra=allow、AnnotationOut 历史 bbox auto-normalize、AnnotationAttributes 值类型受限。

### 项 1 · 拆 useWorkbenchAnnotationActions + useWorkbenchHotkeys

> WorkbenchShell.tsx 从 1305 行降到 862 行（-443 行，-34%）。下一次再拆候选：`useWorkbenchAI`（preannotation / 接受预测）、批量改类 popover handler。

- 新增 `state/useWorkbenchAnnotationActions.ts`（348 行）：打包 7 个 handler — `optimisticEnqueueCreate` + `handlePickPendingClass` (bbox create) + `submitPolygon` (polygon create) + `handleDeleteBox` + `handleCommitMove` / `handleCommitResize` / `handleCommitPolygonGeometry`，加 polygon 草稿 state + `polygonHandle` memo。内部抽 `optimisticUpdateGeom(id, afterG)` / `optimisticDelete(id)` 双 helper 消重 4 处乐观 cache 模板。签名：`{ taskId, projectId, meUserId, queryClient, history, s, pushToast, recordRecentClass, mutations: { create, update, delete }, enqueueOnError, annotationsRef }`。
- 新增 `state/useWorkbenchHotkeys.ts`（386 行）：收编 polygon Enter/Esc/Backspace useEffect、主 keydown useEffect（dispatchKey + 16 个 action）、keyup useEffect（spacePan / nudge flush）、`spacePan` state、`nudgeMap` state + ref + `flushNudges`、`applyArrowNudge` 内部 helper。返回 `{ spacePan, nudgeMap, flushNudges }`。
- 新增 `useWorkbenchAnnotationActions.test.ts` + `useWorkbenchHotkeys.test.ts`（smoke 形态：项目目前不依赖 `@testing-library/react`，完整 renderHook 单测 P2 落，先确保模块 export 不被 stale）。
- WorkbenchShell 的 ~520 行 inline 实现切换为两条 hook 调用 + 透传新返回值；`AnnotationPayload` / `bboxGeom` / `polygonGeom` / `dispatchKey` / `ARROW_KEY_SET` / `PolygonDraftHandle` / `Pt` / `enqueue` / `isSelfIntersecting` 等导入随之迁移。

### 项 3 · CanvasDrawing 入 ImageStage（5th Konva Layer）

> ROADMAP 标为「单独立项」的高危项，本版本一次性落地核心路径；保持向后兼容（旧弹窗 SVG 编辑器 + SVG preview 都仍在）。

- 新增 `stage/CanvasDrawingLayer.tsx`：作为 Konva Stage 第 5 个 Layer 挂载，shapes 归一化 [0,1] → 渲染时乘 `imgW/imgH`，`strokeWidth = 2/scale` 屏幕粗细恒定；与 ImageStage `vp.tx/ty/scale` 共享坐标系，缩放 / 平移自动跟随。`listening` 仅在 `editable` 时打开（避免占据非 canvas 模式的 hit-test）。
- 新增 `stage/tools/CanvasTool.ts`：`{ id: "canvas", hotkey: "C", icon: "edit", onPointerDown }`，启动 `{ kind: "canvasStroke", points: [pt.x, pt.y] }` DragInit。`ToolId` / `Tool` / `DragInit` / `Drag` 全部扩展 `canvasStroke` 分支。
- 新增 `stage/CanvasToolbar.tsx`：浮在 ImageStage container 右上角的小工具条（颜色 swatch ×4 + 撤销 / 清空 / 取消 / 完成），仅当 `canvasDraft.active` 时渲染。
- `useWorkbenchState.ts` 加 `canvasDraft` slice + 8 个 actions（`beginCanvasDraft / endCanvasDraft / cancelCanvasDraft / appendCanvasShape / undoCanvasShape / clearCanvasShapes / setCanvasStroke / consumeCanvasResult`）。`Tool` 类型扩展 `"canvas"`。
- `ImageStage.tsx` 新增 4 个 prop：`canvasShapes / canvasEditable / canvasStroke / onCanvasStrokeCommit`；onMove / onUp 增 `canvasStroke` 分支累加点 + commit 一笔；`SelectionOverlay` 加 `tool !== "canvas"` 守卫；container cursor 在 canvas 模式强制 crosshair。
- `CommentInput.tsx` 加 `liveCanvas` prop（`{ active, result, onStart, onConsume }`）+ 「在题图上绘制」入口按钮（与原「弹窗批注」按钮并存）；effect 监听 `liveCanvas.result` 写回 `canvasDrawing` 后调 `onConsume`。
- 链路：CommentInput → CommentsPanel → AIInspectorPanel → WorkbenchShell（透传 `s.beginCanvasDraft / s.canvasDraft.pendingResult / s.consumeCanvasResult`）。

### 项 4 · CanvasDrawingEditor / Preview 接 imageWidth/imageHeight

- `components/CanvasDrawingEditor.tsx` 编辑器 + Preview 都接 `imageWidth?` / `imageHeight?`，padding-bottom / height 按真实比例计算（fallback 600×400）；viewBox 仍是 `0 0 1 1`（normalized 不变）。
- `CommentInput / CommentsPanel / AIInspectorPanel` 全链路透传 imageWidth/imageHeight；reviewer 在 16:9 / 4:3 / 1:1 图上画的批注不再被拉成 600×400 比例。

### 项 5 · annotator 端开放画布批注

- `AIInspectorPanel.tsx` 把 `enableCommentCanvasDrawing` 默认值改为 `true`（之前 reviewer 才有，annotator 看不到入口，无法对反馈做画图回应）。

### 项 6 · AttributeField.description 引入 react-markdown

- `pnpm add react-markdown remark-gfm`（+ ~25KB gz）。`AttributeForm.tsx` 把 description 从 `title=` plain string 改为 hover/click `<DescriptionPopover>`（react-markdown + remark-gfm，禁 raw HTML / 不开 rehype-raw → 无 XSS 风险）。链接强制 `target="_blank" rel="noopener noreferrer"`。支持段落 / 列表 / 链接 / 加粗 / inline code。
- 「i」按钮保持，hover 弹 popover；点击外部 / 鼠标移开自动关。

### 项 7 · OfflineQueueDrawer 分组 + 筛选 + retry_count 视觉

- `OfflineQueueDrawer.tsx` 重写：① 按 `op.taskId` 分组（Disclosure 折叠，默认展开当前题）② 筛选 chip：「范围 全部 / 当前题」+「状态 全部 / 失败 ≥ 3」③ retry_count 颜色徽章（≥3 红 / ≥1 黄 / 0 灰），失败 ≥3 时整行浅红背景 ④ header 统计「N 条 · 跨 K 题 · 当前题 M」。
- `WorkbenchShell.tsx` 透传 `currentTaskId={taskId}` 给 drawer。

### 文件变更摘要

后端：
- `apps/api/app/services/display_id.py` (新, 31 行)
- `apps/api/alembic/versions/0021_unify_display_id.py` (新, 90 行)
- `apps/api/app/schemas/_jsonb_types.py` (新, 178 行)
- `apps/api/app/schemas/{project,annotation,annotation_comment,audit}.py` (改写)
- `apps/api/scripts/dump-openapi.py` (新, 35 行)
- `apps/api/app/services/{bug_report,dataset,batch}.py`、`app/api/v1/{projects,files}.py`（call site swap）
- `apps/api/app/db/models/{project,task,task_batch}.py`（unique 约束）
- `apps/api/tests/test_display_id.py`、`test_jsonb_strong_types.py`（新, 共 18 例）

前端：
- `apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts` (新, 348 行)
- `apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts` (新, 386 行)
- `apps/web/src/pages/Workbench/state/useWorkbenchState.ts`（+ canvasDraft slice + Tool 加 "canvas"）
- `apps/web/src/pages/Workbench/stage/CanvasDrawingLayer.tsx` (新, 60 行)
- `apps/web/src/pages/Workbench/stage/CanvasToolbar.tsx` (新, 60 行)
- `apps/web/src/pages/Workbench/stage/tools/CanvasTool.ts` (新, 18 行)
- `apps/web/src/pages/Workbench/stage/tools/index.ts`（注册 + ToolId/DragInit 扩展）
- `apps/web/src/pages/Workbench/stage/ImageStage.tsx`（+ 5th Layer + canvasStroke drag 分支 + 守卫）
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` (1305 → 862 行，-443)
- `apps/web/src/pages/Workbench/shell/{AIInspectorPanel,CommentsPanel,CommentInput,AttributeForm,OfflineQueueDrawer}.tsx`
- `apps/web/src/components/CanvasDrawingEditor.tsx`（接 imageWidth/imageHeight）
- `apps/web/src/api/{projects,comments}.ts`（删 workaround / 删本地类型，全部 re-export from generated）
- 新增 vitest smoke：`useWorkbenchAnnotationActions.test.ts` / `useWorkbenchHotkeys.test.ts`

依赖：
- `react-markdown` ^10.x、`remark-gfm` ^4.x（前端，+~25KB gz）

### 验证

- `pnpm tsc --noEmit`：0 错。
- `pnpm vitest run`：55 / 55 通过（v0.6.3 的 53 + 本版 smoke ×2）。
- `OPENAPI_URL=/tmp/openapi.json pnpm build`：vite 打包成功，无 TS 错。
- 后端：`PYTHONPATH=. python3 -c "from app.main import app"`、`scripts/dump-openapi.py` 生成 272KB OpenAPI；新加的 `BboxGeometry / PolygonGeometry / Geometry / AttributeSchema / CanvasDrawing / Mention / Attachment / AuditDetail` 全部出现在 spec。
- alembic 迁移文件 / display_id 服务 / pydantic schema 模块独立 syntax check 通过。
- Docker / pytest 验证留 production deploy 阶段（本机 docker container 已停，未启）。

---


## [0.6.3] - 2026-05-01

> v0.6.3 收口 v0.6.2 「必修硬伤」5 项 + 同区域 quick win 2 项：评论附件下载端点补齐、离线 tmpId 端到端三件套（undo / 跨 op 替换 / polygon + update/delete 乐观 cache）、alembic 容器化自动应用、attribute_change 审计批量 flush、离线队列 retry_count 字段。同版顺手开始 P1：抽 `useWorkbenchOfflineQueue` hook + 离线相关单测落地。

### 评论附件下载端点（P0-A）

#### 后端
- `annotation_comments.py` 新增 `GET /annotations/{aid}/comment-attachments/download?key=...`：① 强制 key 以 `comment-attachments/{aid}/` 前缀开头（防越权读其它附件）② `assert_project_visible` 校验 caller 是该 annotation 项目成员 ③ 302 RedirectResponse 跳预签名 URL（5 分钟过期，比上传更短）。

#### 前端
- `CommentsPanel.tsx:135` 附件 href 从不存在的 `/api/v1/files/download?key=...` 改为新端点 `/api/v1/annotations/{aid}/comment-attachments/download?key=...`。点附件链接不再 404。

### 离线 tmpId 三件套（P0-B）

#### 离线队列 API
- `offlineQueue.ts` 新增 `replaceAnnotationId(oldId, newId)`：扫队列把后续 update/delete op 的 `annotationId` 同步替换。
- `OfflineOp` 联合类型每个分支加可选 `retry_count?: number`；`drain` 失败时累计 `+1` 后再 `persist` + break，便于未来 drawer 区分「网络抖动」vs「永久脏数据」。

#### useAnnotationHistory undo 修复
- `HistoryHandlers` 新增可选 `removeLocalCreate?(id)` 钩子。
- `applyLeaf` create undo 检测 `cmd.annotationId.startsWith("tmp_")` 时走纯本地分支：从 react-query cache 删 tmpId 条目 + 抹离线队列对应 create op；不再对未入库 id 调 DELETE → 不再 404，撤销视觉真实生效。

#### WorkbenchShell 离线 + 乐观 cache
- 抽出公共 helper `optimisticEnqueueCreate(payload)`：分配 tmpId → 写 react-query cache → push history → enqueue；`handlePickPendingClass`（bbox）与 `submitPolygon`（polygon）共用，原 ~30 行重复代码合并。
- `submitPolygon` 增加 `onError → enqueueOnError(err, () => optimisticEnqueueCreate(payload))`，断网不再吞错。
- `executeOp` create 成功后追加 `await offlineQueueReplaceAnnotationId(op.tmpId, real.id)`：跨 op 同步替换队列里后续 update/delete 的 tmpId，避免 server 404。
- `useAnnotationHistory` 实例化时注入 `removeLocalCreate`：闭包内调 `queryClient.setQueryData` 删 cache + `offlineQueueGetAll/RemoveById` 删队列对应 op。
- `handleDeleteBox` / `handleCommitMove` / `handleCommitPolygonGeometry` / `handleCommitResize` 离线分支：在 enqueue 前先 `setQueryData` 写入乐观 cache（update map / delete filter）+ `history.push`，断网时画布立即跟上变更。

### alembic 容器化自动应用（P0-C）

- 新增 `apps/api/scripts/entrypoint.sh`：`set -e && alembic upgrade head && exec "$@"`。
- `infra/docker/Dockerfile.api` 加 `ENTRYPOINT ["/app/scripts/entrypoint.sh"]` + `chmod +x`，原 `CMD` 不变；容器启动自动跑 migration，避免「列不存在」。
- 本地开发不受影响（docker-compose 中 api service 整段被注释，本地 venv 启动需手动 `alembic upgrade head`）。

### 后端 attribute_change 审计批量 flush（Q-2）

- `app/services/audit.py` 新增 `AuditService.log_many(*, actor, action, target_type, request, status_code, items)`：共享 actor/request/status_code，仅 target_id + detail 逐条不同；一次 `db.add_all(entries)` + 一次 `db.flush()`。
- `tasks.py PATCH /annotations/{id}` 字段级审计循环改为先收集 `change_items: list[dict]`，循环结束一次 `log_many`。N 个属性同时改：原本 N 次 flush → 一次 flush。

### WorkbenchShell 拆 hook · `useWorkbenchOfflineQueue`（P1 起步）

- 新增 `apps/web/src/pages/Workbench/state/useWorkbenchOfflineQueue.ts`：把 v0.6.3 P0 工作之后膨胀到 80+ 行的离线接线统一封装 —— `useOnlineStatus` 订阅、`flushOne(op)`（即原 `executeOp`）、`flushAll`（即原 `flushOffline`）、`enqueueOnError` 错误归类（网络抖动入队 / 业务错 toast）、抽屉 `drawerOpen / openDrawer / closeDrawer` 状态、online 事件自动 flush 副作用。
- `WorkbenchShell.tsx` 顶部一行调用 `useWorkbenchOfflineQueue({ history, queryClient, pushToast })` 解构出全部能力；删掉原 `useOnlineStatus` 直接 import + `executeOp` / `flushOffline` 两段 useCallback + auto-flush useEffect + `offlineDrawerOpen` useState。文件从 ~1370 行降到 1305 行。
- `OfflineQueueDrawer` `onClose / onFlushOne / onFlushAll` 与 `StatusBar onShowQueueDrawer` 改用 hook 返回的具名函数，不再持有内联 lambda。
- 不在 hook 里管的：`optimisticEnqueueCreate`（依赖 `taskId / projectId / meUserId / s.setSelectedId / history` 多项 shell 上下文，仍由 shell 持有）；history 的 `push` 行为本身。

### 单元测试 — `applyLeaf` tmpId 分支 + `offlineQueue` 队列语义（P1）

- `apps/web/src/pages/Workbench/state/useAnnotationHistory.ts`：把内部 `applyLeaf` 提为顶层 `export async function applyLeaf(cmd, direction, h)`，行为不变；hook 的 `apply` 通过引用调用即可。
- 新增 `useAnnotationHistory.test.ts`（6 例）：覆盖 v0.6.3 P0 tmpId undo 三种场景（tmpId + removeLocalCreate / 真实 id / tmpId 但无 removeLocalCreate 兼容）+ create redo / update undo·redo 不受影响。
- 新增 `offlineQueue.test.ts`（5 例，`vi.mock("idb-keyval")` 注入内存 Map）：覆盖 `replaceAnnotationId`（替换 update/delete annotationId、不动 create.tmpId、无匹配不写盘）+ `drain` 失败累计 `retry_count`（单次 / 多次累加 / 半路失败保留剩余）。
- `pnpm vitest run` 全量 53 个用例通过（原有 42 + 新增 11）。

### 文件变更摘要

- `apps/api/app/api/v1/annotation_comments.py` (+24 / 评论附件下载端点)
- `apps/api/app/api/v1/tasks.py` (~25 / attribute_change 批量收集)
- `apps/api/app/services/audit.py` (+44 / `log_many`)
- `apps/api/scripts/entrypoint.sh` (新增)
- `infra/docker/Dockerfile.api` (+2)
- `apps/web/src/pages/Workbench/state/offlineQueue.ts` (+18 / `replaceAnnotationId` + `retry_count`)
- `apps/web/src/pages/Workbench/state/useAnnotationHistory.ts` (+~50 net / `applyLeaf` 顶层 export + tmpId 本地分支)
- `apps/web/src/pages/Workbench/state/useWorkbenchOfflineQueue.ts` (新增 / 128 行)
- `apps/web/src/pages/Workbench/state/offlineQueue.test.ts` (新增 / 5 例)
- `apps/web/src/pages/Workbench/state/useAnnotationHistory.test.ts` (新增 / 6 例)
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` (~−65 / helper + 4 个 commit handler 乐观 cache + 删除 80 行迁出 hook 的代码)
- `apps/web/src/pages/Workbench/shell/CommentsPanel.tsx` (+1 / href 改写)

---


## [0.6.2] - 2026-05-01

> v0.6.2 一次性收口 ROADMAP「v0.5.5 phase 2 部分落地的延续」段落 6 大欠账：离线队列抽屉 + tmpId 端到端、导出复选框、HotkeyCheatSheet 动态属性分组、属性 schema description + 字段级审计、OpenAPI codegen 完整迁移 + prebuild gate、评论 polish 三层（@ 提及 / 附件 / 画布批注）。

### 离线队列 — OfflineQueueDrawer + tmpId 端到端

#### 前端
- 新增 `OfflineQueueDrawer.tsx`：右侧抽屉 UI，订阅 `offlineQueue` 实时刷新；按操作类型（创建 / 更新 / 删除）+ 时间戳列出；单条「重试」/「丢弃」+ 底部「全部丢弃」/「立即同步全部」。多 tab BroadcastChannel 同步生效。
- `offlineQueue.ts` 新增 `getAll()` / `removeById(opId)` 公开 API 供抽屉操作。
- `WorkbenchShell.handlePickPendingClass` onError：分配 `tmp_${crypto.randomUUID()}` → 乐观插入完整 `AnnotationResponse` 到 `queryClient.setQueryData(["annotations", taskId])` → push history 命令栈 → enqueue 携带 `tmpId`。
- 抽离 `executeOp(op)` 共享逻辑：drain 与单条重试都走它；create 成功时拿后端 `real.id` → `history.replaceAnnotationId(tmpId, realId)` + cache swap，统一替换。
- `StatusBar` 离线徽章 onClick 从 `onFlushOffline` 改为 `onShowQueueDrawer`，背后 `setOfflineDrawerOpen(true)`。

### 导出 — ExportSection + include_attributes 复选框

- 新增 `apps/web/src/pages/Dashboard/ExportSection.tsx`：项目行「导出 ▾」popover，含格式选择（COCO/VOC/YOLO）+「包含属性数据」复选框（默认勾选，对齐后端 `?include_attributes=` default true）+ 文案提示。取消勾选 → URL 显式 `?include_attributes=false` → 输出 v0.4.9 之前兼容格式。
- `DashboardPage.tsx` 行内 `<select>` 替换为 `<ExportSection projectId={p.id} />`，移除 `projectsApi` / `ExportFormat` 直接 import。

### 标注属性 — schema description + 字段级审计

#### 后端
- `AuditAction.ANNOTATION_ATTRIBUTE_CHANGE = "annotation.attribute_change"` 新增枚举常量。
- `tasks.py PATCH /annotations/{annotation_id}`：早 load existing 一次（兼顾 If-Match 与 attributes diff），在原 `annotation.update` 审计行外，按 field key 逐字段 diff before/after，每个变化的 key 单独写一条 `annotation.attribute_change` 行；detail 含 `{field_key, before, after, task_id}`，配合 v0.5.5 phase 2 GIN 索引可按字段过滤历史。
- `_validate_attribute_schema` 显式校验 `fields[i].description` 必须是字符串（已存在的字段透传）。

#### 前端
- `AttributeField.description?: string` 字段加入 TS 类型；`AttributeForm` 在 label 旁渲染圆形 ⓘ info 徽章，hover 显示 description（cursor: help）。

### 快捷键 — HotkeyCheatSheet 动态注入属性快捷键分组

- `HotkeyCheatSheet` 新增 `attributeSchema` prop；在静态 5 组（draw / view / ai / nav / system）末尾追加「属性快捷键」分组，自动从 `attributeSchema.fields.filter(f => f.hotkey && (f.type === "boolean" || f.type === "select"))` 渲染；文案"切换 / 循环 {label}"，副标题"选中标注后按下数字键切换 / 循环属性值"；schema 无 hotkey 字段时整组不渲染。
- `WorkbenchShell` 透传 `currentProject?.attribute_schema` 给 cheatsheet。

### OpenAPI codegen — 完整迁移 + prebuild gate

- 修复 `openapi-ts.config.ts` 插件名 `"@hey-api/typescript"` → `"@hey-api/types"`（v0.55+ 命名变更）。
- 跑 `pnpm codegen` 生成 `src/api/generated/{index.ts, types.gen.ts}`（约 2000 行 TS 类型）。
- `users.ts` / `audit.ts` / `datasets.ts` 顶部手写 `interface XxxResponse { ... }` 替换为 `export type XxxResponse = XxxOut`（基于 generated）；`projects.ts` 用 `Omit<ProjectOut, "classes" | "classes_config" | "attribute_schema"> & { ... }` 把 generated 弱类型字段（`Array<unknown>` / `{ [key: string]: unknown }`）收紧为前端 DSL 强类型，其余字段自动跟随后端演进。
- `package.json` 加 `"prebuild": "pnpm codegen"` —— `pnpm build` 自动先跑 codegen，根治前后端 schema 漂移。
- 后端 schema 收紧两处误差：`DashboardPage.tsx:79` `p.member_count > 0` → `(p.member_count ?? 0) > 0`；`DatasetsPage.tsx:341` 同模式修复 `project_count`。

### 评论 polish — @ 提及 + 附件 + 画布批注

#### 数据模型 / 后端
- alembic `0020_comment_polish`：`annotation_comments` 表加 `mentions JSONB DEFAULT '[]' NOT NULL` + `attachments JSONB DEFAULT '[]' NOT NULL` + `canvas_drawing JSONB NULL`。Model 同步加三列 + `JSONB` 映射。
- Pydantic 新增 `Mention` / `Attachment` schema：
  - `Mention`: `userId / displayName / offset / length`；alias by camelCase。
  - `Attachment`: `storageKey / fileName / mimeType / size`；自定义 validator 强制 `storageKey.startswith("comment-attachments/")` —— 防止任意 key 注入读其它桶资源。
- `AnnotationCommentCreate` 接受 `mentions: list[Mention]` / `attachments: list[Attachment]` / `canvas_drawing: dict | None`，默认空。
- `AnnotationCommentOut` 透出三列。
- 路由 `POST /annotations/{aid}/comments` 增加项目成员校验：`_validate_project_members(db, ann.project_id, [m.user_id for m in data.mentions])` 检查 `project_members` 表（含 super_admin / project_admin 兜底），不在则返回 422 `mentions_invalid` + `non_member_user_ids`。审计 detail 多记 `mention_count` / `attachment_count` / `has_canvas_drawing`。
- 新增端点 `POST /annotations/{aid}/comment-attachments/upload-init`：返回 `{storage_key, upload_url, expires_in}`；storage_key 形如 `comment-attachments/{aid}/{uuid}-{filename}`（filename 中的 `/` 被替换为 `_` 防止穿透）。镜像 `files.py /upload-init` 模式。

#### 前端
- 新增 `apps/web/src/components/UserPicker.tsx`：受控 popup（createPortal），列表 + ↑↓ Home End 键盘导航 + Enter/Tab 选中 + Esc 关闭；hover 高亮、`mousedown.preventDefault` 避免编辑器失焦；按 query 实时过滤 name / email。
- 新增 `apps/web/src/pages/Workbench/shell/CommentInput.tsx`：
  - contenteditable `<div>`（不是 textarea，需富格式）。
  - 输入 `@` 触发：反向找最近 `@`（要求前方是空白 / 文首），用 caret Range 计算屏幕坐标作为 UserPicker anchor，实时把 `@` 后的 query 传给 picker 过滤。
  - 选中 → 在 trigger Range 处 `deleteContents` + 插入 `<span data-mention-uid="..." contenteditable="false" class="mention-chip">@displayName</span>` chip + 紧跟空格 + 把光标放到 chip 之后。
  - 提交时 DOM 遍历 root：text node 累计为 body，chip 还原为 `@displayName` 文本并记录 `{userId, displayName, offset, length}` 到 mentions[]；`<br>` / 块元素之间补换行。
  - 附件：`<input type="file" multiple>`，每个文件先调 `commentsApi.attachmentUploadInit` 获取预签名 URL → 直接 PUT 上传 → 收集 `storageKey/fileName/mimeType/size` 到 attachments[]；20MB 单文件上限，超出 toast 跳过。
  - 画布批注：`enableCanvasDrawing` 开关 + 弹出 `CanvasDrawingEditor`。
  - Enter 提交（Shift+Enter 换行；picker 打开时 Enter 走 picker 选中）。
  - 导出 `renderCommentBody(body, mentions, onMentionClick)`：把 mentions 按 offset 还原为可点击 chip，CommentsPanel 用它渲染历史评论的 mention chip → 点击跳 `/audit?actor={userId}` 用户审计追溯。
- 新增 `apps/web/src/components/CanvasDrawingEditor.tsx`：
  - 600×400 SVG 自由曲线编辑器（Modal 弹窗），4 色画笔（红 / 黄 / 绿 / 蓝），按住鼠标拖动绘制 polyline；归一化 [0,1] 坐标存储；撤销 / 清空 / 保存按钮。
  - 配套 `CanvasDrawingPreview` 只读小缩略（默认 220px 宽，按比例高），CommentsPanel 在历史评论卡片中渲染 reviewer 留下的画布批注；可选 `backgroundUrl` 作为编辑 / 预览背景（reviewer 在原图缩略上画更直观）。
- `CommentsPanel.tsx`：textarea 替换为 `<CommentInput>`；新增 `projectId` prop（拉 `useProjectMembers` 喂 picker）+ `backgroundUrl` + `enableCanvasDrawing` prop；历史评论渲染加 mentions chip / attachment 链接 / canvas drawing preview 三块。
- `useAnnotationComments.useCreateComment` 改签名：`mutationFn` 接 `string | CreateCommentPayload`，向后兼容老调用。
- `commentsApi`：新增 `CommentMention` / `CommentAttachment` / `CommentCanvasDrawing` 类型 + `CreateCommentPayload` + `attachmentUploadInit` 方法。
- `AIInspectorPanel`：透传 `taskFileUrl` + `enableCommentCanvasDrawing` 给 CommentsPanel；annotator 端 `enableCommentCanvasDrawing` 默认 undefined → 仅查看 reviewer 画的批注，不能反向画。
- `WorkbenchShell` 把 `task?.file_url` 作为 `taskFileUrl` 传给 inspector。
- `ReviewWorkbench`：右侧条件可见侧栏（width 320）渲染 CommentsPanel，工具栏加「💬 评论」开关按钮；`enableCanvasDrawing` 默认开启，reviewer 可在 modal 中绘制并连同评论提交。

### 修复
- `WorkbenchShell.handlePickPendingClass` 内 payload 显式标注 `AnnotationPayload` 类型，让 `payload.attributes ?? {}` 通过 strict 检查。

---


## [0.6.1] - 2026-04-30

> v0.6.1 聚焦 ROADMAP P1 项：**大数据集分包 / 批次工作流（task_batch）**。PM 可按策略切分批次 → 标注员按批领题 → 审核员整批通过/退回 → 按批导出。AI 预标注相关留白（仅 `on_batch_approved` 空 hook）。

### 大数据集分包 / 批次工作流

#### 数据模型
- 新建 `task_batches` 表（alembic 0019）：`id / project_id / dataset_id / display_id / name / description / status / priority(0-100) / deadline / assigned_user_ids JSONB / total_tasks / completed_tasks / review_tasks / approved_tasks / rejected_tasks / created_by / created_at / updated_at`。
- `tasks` 表新增 `batch_id UUID FK` 列（`ON DELETE SET NULL`，indexed）。
- 数据回填：为每个现存 project 创建默认批次 `B-DEFAULT`（status=active），所有老 task 关联。

#### 状态机
- `BatchStatus` 枚举 7 态：`draft → active → annotating → reviewing → approved / rejected → archived`。
- `active → annotating`：首个 task 进入 in_progress 时自动转移。
- `annotating → reviewing`：所有 task 完成（无 pending/in_progress）时自动转移。
- 自动转移在 `submit_task` / `approve_task` / `reject_task` 端点触发。

#### 后端
- `BatchService`（`app/services/batch.py`）：状态机校验 + 3 种切分策略（random / metadata / id_range）+ 计数器同步 + 整批退回（tasks 全部重置为 pending）+ `on_batch_approved()` 空 hook。
- 9 个 API 端点（`/projects/{project_id}/batches`）：LIST / GET / POST / PATCH / DELETE / transition / split / reject / export。
- `AuditAction` 新增 4 个事件：`batch.created` / `batch.status_changed` / `batch.rejected` / `batch.deleted`。
- Scheduler `get_next_task()` 改造：JOIN `task_batches` 过滤 active/annotating 批次 + `assigned_user_ids` JSONB `@>` 检查 + `priority DESC` 排序。
- `ExportService._load_data()` 新增可选 `batch_id` 参数，三种导出格式透传。
- `TaskOut` schema + `_task_with_url` 返回 `batch_id` 字段。
- `list_tasks` 端点新增 `batch_id` 查询参数过滤。

#### 前端
- 新建 `api/batches.ts`：`batchesApi` 对象（list / get / create / update / remove / transition / split / reject / exportBatch）。
- 新建 `hooks/useBatches.ts`：8 个 React Query hooks（query key `["batches", projectId]`）。
- `types/index.ts`：新增 `BatchStatus` 类型 + `TaskResponse.batch_id`。
- `ProjectSettingsPage`：新增「批次管理」Tab（`layers` 图标），`BatchesSection` 组件支持创建单个批次 / 随机切分 N 批 / 状态转移 / 删除。
- `TaskQueuePanel`：批次下拉过滤（仅显示 active/annotating 批次）。
- `WorkbenchShell`：`selectedBatchId` state + `useTaskList` 传入 `batch_id` 过滤。
- `ReviewPage`：批次下拉过滤 + 「整批退回」按钮。
- `tasks.ts`：`TaskListParams` + `getNext` 支持 `batch_id` 参数。

---


## [0.6.0] - 2026-04-30

> v0.6.0 聚焦 ROADMAP 中 3 个 P0 项：**协作并发数据保护**（锁续约 + ETag 冲突检测）、**安全 & 测试基建**（JWT 生产护栏 + 登录限流 + 密码策略 + 密码重置 + DB 测试套件）、**用户内嵌式 Bug 反馈系统**（AI-friendly，结构化反馈 → Markdown 端点直接喂 Claude Code）。

### 协作并发 — 任务锁主动续约 + 编辑冲突 ETag

#### 后端
- Annotation / Task 模型新增 `version INTEGER DEFAULT 1` 列（alembic 0016），乐观并发控制基础。
- `PATCH /tasks/{task_id}/annotations/{annotation_id}` 支持 `If-Match` 头校验：版本不匹配 → 409 `{reason:"version_mismatch", current_version:N}`；成功 → `ETag: W/"<version>"`。
- `AnnotationOut` schema 新增 `version: int` 字段。
- `AnnotationService.update()` 每次更新自动 `version += 1`。

#### 前端
- `apiClient.patch()` 支持可选的 `extra?: RequestInit` 参数。
- `tasksApi.updateAnnotation()` 接受 `etag` 参数，拼 `If-Match` 头。
- 新建 `ConflictModal` 组件：编辑冲突时弹窗，提供「重载（放弃本地）」/「强制覆盖」/「取消」三选项。
- `useUpdateAnnotation` 检测 409 状态 → 触发 `onConflict` 回调。
- `useTaskLock`：心跳间隔 120s → 60s；新增 `remainingMs` 倒计时（每秒更新）；心跳失败自动重试 `acquireLock`。
- `StatusBar` 左侧新增锁倒计时显示（`< 60s` 变红）+ 锁错误提示。

### 安全 & 测试基建

#### JWT 生产硬校验
- `main.py` lifespan 启动检查：`environment=production` 且 `secret_key=="dev-secret-change-in-production"` → 拒绝启动。

#### 登录限流
- 新增 `slowapi>=0.1.9` 依赖 + `app/core/ratelimit.py`。
- `main.py` 注册 `SlowAPIMiddleware` + `RateLimitExceeded` handler。
- `POST /auth/login` 加 `@limiter.limit("5/minute")`。

#### 密码策略升级
- 新建 `app/core/password.py`：`validate_password_strength()`（≥8 位 + 大写 + 小写 + 数字）。
- `PasswordChange.new_password` / `RegisterRequest.password` 的 `min_length` 6→8，加 `@field_validator` 强度校验。
- 前端密码标签更新："至少 6 位" → "至少 8 位，需含大小写字母和数字"。

#### 密码重置流程
- 新建 `password_reset_tokens` 表（alembic 0018）+ 模型 + `PasswordResetService`（`create_token` / `consume_token`，1h 过期）。
- `POST /auth/forgot-password`（公开，限流 3/min）：生成 token，SMTP 未配置时打日志；防邮箱枚举，始终返回 202。
- `POST /auth/reset-password`（公开）：验证 token + 强度校验 + 更新密码 + 写 audit log。
- 前端新建 `ForgotPasswordPage` / `ResetPasswordPage`；`LoginPage` 加 "忘记密码？" 链接；`App.tsx` 加公开路由。

#### DB-backed 测试套件
- 重写 `tests/conftest.py`：`test_db_url`（`TEST_DATABASE_URL` 环境变量）+ `apply_migrations`（session 级 alembic upgrade head）+ `db_session`（per-test SAVEPOINT 隔离）+ `super_admin` / `project_admin` / `annotator` / `reviewer` 三角色 fixture（含 JWT token）+ `httpx_client`（挂真实 DB）。
- 新建 `test_audit_logs.py`：过滤 / 分页 / 登录自动产生审计日志。
- 新建 `test_users_role_matrix.py`：12 个角色修改守卫用例。
- 新建 `test_users_delete_transfer.py`：删除权限 / 自己不可删 / 审计日志验证。

### 用户内嵌式 Bug 反馈系统（AI-friendly）

#### 后端
- 新建 `bug_reports` + `bug_comments` 表（alembic 0017）。
- 新建 `BugReportService`（CRUD + `list_markdown()` Markdown 端点 + `cluster_similar()` 去重建议）。
- 7 个 API 端点：`POST /bug_reports`（10/hour 限流）/ `GET /bug_reports`（admin，`?format=markdown` 输出可直接喂 Claude Code）/ `GET /bug_reports/mine` / `GET /bug_reports/{id}`（含评论）/ `PATCH /bug_reports/{id}` / `POST /bug_reports/{id}/comments` / `POST /bug_reports/cluster`。
- `AuditAction` 新增 `BUG_REPORT_CREATED` / `BUG_REPORT_STATUS_CHANGED` / `BUG_COMMENT_CREATED`。

#### 前端
- 新建 `bug-reports.ts` API 模块 + `bugReportCapture.ts` 自动捕获工具（fetch 拦截 ring buffer + console 错误 ring buffer + 脱敏）。
- 新建 `BugReportFAB`：右下角悬浮反馈按钮（z-index: 100），全局常驻。
- 新建 `BugReportDrawer`：右侧 400px 抽屉，三态（我的反馈列表 / 创建表单 / 详情+评论）。自动捕获 route / UA / viewport / API 调用 / console 错误。
- 新建 `BugsPage`（`/bugs`，admin only）：表格 + 状态/严重度过滤 + 详情面板（含状态变更 + 评论）。
- `SettingsPage` 新增「我的反馈」tab，调用 `GET /bug_reports/mine`。
- `App.tsx` 注册 `/bugs` 路由 + FAB/Drawer + 初始化 fetch 拦截。
- `PageKey` / `ROLE_PAGE_ACCESS` 加 `"bugs"`；`Icon` 加 `Bug`；`auditLabels` 加 bug 相关标签。

### 验证

- 后端模块导入全绿（`uv run python -c "from ..."`）。
- alembic 5 条迁移链 0014→0015→0016（version 列）→0017（bug 反馈）→0018（密码重置）全部成功应用。
- 前端 `tsc -b` 零错误（`apps/web/`）。
- `slowapi` 安装成功，`Limiter` / `SlowAPIMiddleware` 导入正常。

### 不在本期范围（明确 defer 到 v0.6.1+）

- Bug 反馈截图（html2canvas 抓视口 + MinIO 上传 + 涂抹脱敏）—— FAB/Drawer 已留截图位，html2canvas 依赖按需引入。
- Bug 聚类去重的 LLM 调用（`POST /bug_reports/cluster` 当前仅返回启发式相似结果）。
- 邮件实际发送（SMTP placeholder，token 打日志兜底）。
- 前端 vitest 扩展（`useAnnotationHistory` batch / `useClipboard` 偏移 / `useSessionStats` ring buffer）。
- Playwright E2E 测试 / CI/CD pipeline / husky pre-commit hooks。
- i18n / 无障碍 / SSO / 2FA。

---


## [0.5.5 phase 2] - 2026-04-30 — Floating Noodle

> 一次性收口 phase 1（治理 / 基建）与 v0.5.4（工作台 polish）累计的 12 项遗留。**不引入新功能**，每一行改动都对应一条已立项的尾巴。9 项一次落到位，3 项核心动作落地、UI 抽屉 / 评论富文本等大件留作 v0.5.6。

### 治理 / 基建

#### A.1 OpenAPI → TypeScript codegen 基建
- 新增 `@hey-api/openapi-ts@^0.55.0` 开发依赖 + `apps/web/openapi-ts.config.ts`（默认 `OPENAPI_URL=http://localhost:8000/openapi.json`，输出 `src/api/generated/`）。
- `package.json` 加脚本 `codegen` / `codegen:watch`；`apps/web/.gitignore` 屏蔽生成产物；不强加 prebuild gate（避免 CI 与 dev 启动循环依赖）。
- 触发场景就是 phase 1 漏暴露 `UserOut.is_active` 的事故。手写 type → generated 的逐字段迁移走渐进路径，本期仅落基建。

#### A.2 后端 pytest 脚手架（轻量）
- `apps/api/pyproject.toml` 加 `[project.optional-dependencies] test`（pytest + pytest-asyncio + pytest-mock）+ `[tool.pytest.ini_options]`（asyncio_mode=auto）。
- `apps/api/tests/{__init__,conftest,test_smoke}.py`：`app_module` / `httpx_client` fixture + 5 例 sanity（router 注册、attribute_schema hotkey 校验、iou 阈值范围、_build_base_query detail_filter、_PENDING_TASK_STATUSES 与 TaskStatus 同源）。
- DB SAVEPOINT fixture / 真 PG client 留下一期（需独立 TEST_DATABASE_URL + alembic upgrade 配置）。

#### A.3 audit `detail_json` GIN 索引 + 字段级过滤
- alembic `0015_audit_detail_gin_index`：PG 创建 `ix_audit_logs_detail_json_gin USING GIN`；其它方言 noop。
- `_build_base_query()` 加 `detail_key + detail_value` 入参（JSONB `@>` 子集匹配，走 GIN）。`/audit-logs` 与 `/audit-logs/export` 端点暴露同名 query 参数；export self-audit 行 detail 加 `target_id_filter / actor_id_filter / detail_key_filter / detail_value_filter` 字段。
- `AuditPage`：筛选区加两个 `detail 键名 / 键值` 输入框（仅 super_admin），追溯 banner 显示 `detail.role = super_admin` 徽章。
- 双行 UI（按 `request_id` 合并 metadata + business detail）留作 v0.5.6（实现成本中等，UI 风险大）。

#### A.4 IoU 去重阈值项目级可配
- alembic `0014_project_iou_dedup_threshold`：`projects` 加 `iou_dedup_threshold FLOAT DEFAULT 0.7 NOT NULL`。
- `Project` model + `ProjectOut/ProjectUpdate` 加字段（pydantic `Field(ge=0.3, le=0.95)` 范围守卫）。
- `WorkbenchShell.tsx:218` 硬编码 `0.7` → `currentProject?.iou_dedup_threshold ?? 0.7`。
- `GeneralSection`（项目设置）加滑块 `0.30 ~ 0.95`（步长 0.05）+ 实时数值显示。

### 用户 / 权限完整化

#### B.1 project_admin 视角 UsersPage 按管理项目过滤
- `list_users()` 后端按 actor 角色分流：super_admin 默认全量（可选 `project_id` 过滤）；**project_admin 强制限定到 `Project.owner_id == actor.id` 项目内 ProjectMember 集合 ∪ 自身**。
- 前端 `usersApi.list({ project_id })` 接受新参数；`useUsers` 类型同步。

#### B.2 删除带未完成任务用户先转交（409 二阶段）
- `DELETE /users/{id}` 软删前查询 `Task.assignee_id == target_id AND status in (pending, in_progress, review)` 的 count + 5 个示例 id + `TaskLock.user_id == target_id` count；任一非零且未传 `transfer_to_user_id` → **409** + `{reason:"has_pending_tasks", pending_task_count, locked_task_count, sample_task_ids, message}`。
- 接受 `body.transfer_to_user_id`：校验 receiver active + 角色合法 + project_admin 时只能转给同管理项目内成员；UPDATE 全部 pending tasks `assignee_id` → 转交目标，DELETE 原 user 的 task_locks，再走原软删；audit_log `user.delete` detail 加 `transferred_to / transferred_count / released_locks`。
- `apps/web/src/api/client.ts`：`ApiError.detailRaw` 暴露后端结构化 detail（之前 dict 类型 detail 被吞），`apiClient.delete` 支持可选 body。
- `apps/web/src/api/users.ts`：`usersApi.remove(id, opts?: { transfer_to_user_id })`；`useDeleteUser` 接受 `{ userId, transferToUserId }` 形态。
- `UsersPage` 删除 Modal 二阶段：检测到 `ApiError.status === 409 && reason === "has_pending_tasks"` → 切到"先转交"视图，显示 pending/locked 数 + 示例 ID + UserPicker 选接收者 + 二次提交。

### 响应式与组件抽取

#### C.1 窄屏 hamburger drawer
- 新建 `apps/web/src/components/shell/SidebarDrawer.tsx`：Portal + 左滑动画（220ms ease-out）+ 遮罩点击 / Esc / 路由变化自动关闭 + body 滚动锁。
- `App.tsx`：窄屏 `< 1024px` 时同时渲染占位 aside（保持 grid 完整）+ SidebarDrawer，复用同一 `<Sidebar>` 组件。
- `TopBar` 加 `showHamburger / onOpenDrawer` props；窄屏时显示左侧 menu 按钮。
- `Icon.tsx` 加 `menu → Menu`（lucide）。

#### C.2 通用 DropdownMenu 组件
- 新建 `apps/web/src/components/ui/DropdownMenu.tsx`：trigger render-prop + items 数组 + outside-mousedown / Esc 关闭 + ↑↓ Home End 键盘导航 + role="menu" / "menuitem" + active 项 check 标记 + 支持 footer slot。
- `TopBar` 主题切换 dropdown：60+ 行内联实现 → `<DropdownMenu>` 三选一 + 系统模式 footer hint。
- 工作台 `Topbar.tsx` 智能切题 + 溢出菜单：双 `useState/useRef/useEffect` outside-close 重复实现 → 两个 `<DropdownMenu>`；老 `menuItemStyle / kbdStyle` 两个游离常量删除。
- `Button` 组件改为 `forwardRef`（DropdownMenu trigger 需要 ref）。

### 工作台 polish

#### D.1 属性 schema `hotkey` 实际绑定
- `dispatchKey()` ctx 加 `attributeHotkey?: (digit) => AttributeHotkeyHit | null`；数字键分支：选中态下 hotkey 命中且 type ∈ {boolean, select} → 返回 `{ type: "setAttribute", key, value }`（boolean 取反 / select cycle 下一项），否则保留 `setClassByDigit` fallback。
- `WorkbenchShell` 注入 lookup（合并 `applies_to` 过滤 + 取选中 annotation 的当前值）+ 处理 `setAttribute` action（走 `handleUpdateAttributes` 与现有表单 PATCH 路径同源）。
- `AttributeForm` 字段 label 旁加 `<KeyBadge>{f.hotkey}</KeyBadge>`（仅 boolean / select 显示）。
- 后端 `_validate_attribute_schema` 加 hotkey 守卫：必须单字符 1-9 + 仅 boolean / select 类型 + 全 schema 唯一。
- `hotkeys.test.ts` 加 5 例（无选中 fallback / boolean toggle / select cycle / cycle 末尾绕回 / hotkey 不命中）。**vitest 42 全过**（27 hotkey + 10 iou + 5 新增）。

#### D.2 离线队列：多 tab 同步 + history tmp_id 替换
- `offlineQueue.ts` 加 `BroadcastChannel("anno.offline-queue.v1")`：persist 后 broadcast；监听其它 tab message → 重读 idb + 触发本 tab 订阅者；`OfflineOp.create` 加可选 `tmpId` 字段。
- `useAnnotationHistory` 加 `replaceAnnotationId(tmpId, realId)`：扫 undo + redo 双栈，把 create / update / delete / acceptPrediction / batch 内嵌的 annotation id 整体替换，drain 后 history 不再误指 tmp_id。
- **完整接入**（WorkbenchShell create 路径分配 tmpId + drain 后调用 replaceAnnotationId + queue 详情抽屉 UI）留 v0.5.6；本期落核心管线，下期组装 UI。

### 导出器扩展

#### E.1 COCO / YOLO / VOC 导出读 attributes
- `ExportService.export_coco`：每条 annotation 输出加 `"attributes": ann.attributes or {}`，顶层 `info.attribute_schema` 写项目 schema。
- `ExportService.export_yolo`：YOLO 文本不可扩展 → 伴生 `<image_basename>.attrs.json` per-image（行索引与 .txt 行号对齐）+ zip 根目录 `attribute_schema.json`。
- `ExportService.export_voc`：`<object>` 下插 `<extra>` 节点。
- `GET /projects/{id}/export?include_attributes=bool`（默认 true）入参；`include_attributes=false` 输出原版兼容格式（无属性扩展字段）。
- 前端 `projectsApi.exportProject(id, format, { includeAttributes })`：默认携带；UI 复选框待 ExportSection 抽出后再加。

### 验证

- `apps/web/`：`pnpm tsc -b` ✅ 0 errors；`pnpm vitest run` ✅ **42/42**（hotkey 32 + iou 10）。
- `apps/api/`：`from app.main import app` ✅；`pyproject.toml [project.optional-dependencies] test` 解析正常；新增 5 例 pytest 用例语法正确（运行需先 `pip install -e '.[test]'`）。
- alembic：新增 0014 / 0015 两条 migration，按链 0013→0014→0015 接续；GIN 索引在 SQLite 测试库走 noop。
- migration 与 model 字段一致：Project model + ProjectOut + ProjectUpdate 三处 iou_dedup_threshold 同步。

### 不在本期范围（明确 defer 到 v0.5.6+）

- A.1：手写 type → `generated/*` 的逐字段迁移；prebuild gate；
- A.2：DB-backed pytest fixture（SAVEPOINT 嵌入事务、alembic upgrade head per-session）+ 完整 audit_logs / 角色矩阵 / 删除转交端到端测试；
- A.3：双行 UI 合并视图（按 `request_id` 把 metadata 行 + business detail 行折叠为单行 + 详情双栏）；
- C.1：通用 `⋯` 溢出菜单组件全站第 3 个使用方（如 ProjectsPage 卡片菜单）；
- D.2：OfflineQueueDrawer 抽屉 UI + WorkbenchShell create 路径接入 tmpId + drain 完成后调 replaceAnnotationId 与 queryClient.setQueryData；
- D.3：评论 polish 整组（@ 提及 popover + 图片附件 presigned 上传 + alembic 0016 加 mentions / attachments / canvas_drawing 占位 + CommentInput contenteditable）；
- E.1：导出 UI「包含属性数据」复选框（待 ExportSection 抽出）。

---


## [0.5.5] - 2026-04-30

> v0.5.5 phase 1：把治理与底盘一次性补齐 —— 分级权限管理、审计正反向追溯、主题三档、响应式收尾、图标体系迁 Lucide。**用户与权限页 / 审计日志页 / TopBar / 工作台 / 全站图标**全部受影响，171 处 `<Icon>` 调用零改动平滑迁移。

### 新增

#### A · 分级权限管理（变更角色 / 删除账号）
- **后端守卫矩阵**（`apps/api/app/api/v1/users.py`）：
  - `PATCH /users/{id}/role` 入口从 `SUPER_ADMIN` 放宽到 `_MANAGERS`（super_admin + project_admin），内部按 `actor.role × target.role` 显式守卫：
    - **super_admin**：可改任意 target 为任意角色（自己 / 最后一名超管除外）。
    - **project_admin**：仅允许在 `annotator ↔ reviewer` 之间切换；target 必须出现在 actor 管理（`Project.owner_id == actor.id`）的项目里；不可造 project_admin / super_admin。
  - 新增 `DELETE /users/{id}` 软删除端点（`is_active = False`）：同矩阵守卫；project_admin 还要求 target 仅在其管理项目里出现（跨项目用户 403 提示由 super_admin 处理）；最后一名 active super_admin 不可被删 / 降级（兜底防自锁）。
  - `POST /{id}/deactivate` 入口同步放宽并复用同一组守卫，与 `delete` 行为对齐。
  - `AuditAction.USER_DELETE = "user.delete"`；role_change / delete / deactivate 均记 actor / target / old / new 进 audit_logs。
  - 新增三个内部辅助：`_count_active_super_admins()` / `_project_admin_manages_target()` / `_target_only_in_actor_projects()`。
- **前端 EditUserModal 重写**（`apps/web/src/components/users/EditUserModal.tsx`）：
  - `ASSIGNABLE_ROLES_BY_ACTOR` + `DELETABLE_TARGET_ROLES_BY_ACTOR` 双矩阵驱动 UI；下拉里允许出现的选项 = 当前角色 ∪ actor 可指派集合；project_admin 视角下显示「项目管理员仅能在审核员 / 标注员 之间切换」hint。
  - 「停用」按钮替换为「删除账号」（变体保持 `danger` + 二次确认 inline）。
  - 错误回显走 `changeRole.error || assignGroup.error || deleteUser.error`，复用 ApiClient 全局 toast。
- **UsersPage 行级操作**（`apps/web/src/pages/Users/UsersPage.tsx`）：
  - 每行右侧三个按钮：📊 审计追溯（跳 `/audit?actor_id=X`） / ✏️ 编辑（仅 actor × target 命中矩阵时启用） / 🗑️ **删除账号**（红色，独立 Modal 二次确认）；自己那行不显示删除。
  - 独立删除 Modal：头像 / 邮箱 / 角色徽章 + 后端错误回显（不重弹 toast，避免双通知）。
  - 新增 `useDeleteUser` hook + `usersApi.remove`。
- **UserOut schema 暴露 `is_active`**（`apps/api/app/schemas/user.py`）：之前未透传导致前端 `u.is_active === undefined`、删除按钮短路；现 `is_active: bool = True` 一并返回。

#### B · 审计正向反向追溯视图
- **后端**（`apps/api/app/api/v1/audit_logs.py`）：`GET /audit-logs` 与 `/audit-logs/export` 新增 `target_id` 精确过滤；`_build_base_query()` 形参改为 `(action, target_type, target_id, actor_id, from_, to)`。
- **AuditPage 入口与高亮**（`apps/web/src/pages/Audit/AuditPage.tsx`）：
  - 启动读 URL `?action / ?target_type / ?target_id / ?actor_id` 并初始化筛选；URL 变化（如 UsersPage 跳过来）触发 `useEffect` 重置筛选 + 回到第 1 页。
  - 顶部追溯模式 banner：紫色高亮带 `Icon target` + 当前过滤项徽章（操作人 / 对象类型 / 对象 ID / 动作）+ 「清除追溯」按钮。
  - 筛选区加 `target_id` 等宽输入框（精确匹配）。
- **行内点击即追溯**：表格 actor_email 列点击 → 用该 `actor_id` 进入追溯模式；target_type / target_id 列点击 → 联合追溯该对象。
- **详情 Modal 双向跳转**：「该操作人完整时间线」 + 「该对象完整时间线」按钮，关闭 Modal 同时切换筛选。
- **入口辐射**：UsersPage 行级 + ProjectSettingsPage 头部「审计追溯」按钮（仅 super_admin 可见，跳 `/audit?target_type=project&target_id=X`）。
- **api/audit.ts**：`AuditQuery` 加 `target_id?: string`。

#### C · 主题切换三档（日间 / 夜间 / 跟随系统）
- **TopBar 主题入口**（`apps/web/src/components/shell/TopBar.tsx`）：通知按钮前新增主题切换按钮 + dropdown，显式列出三档 + 当前态 check 标记；`system` 模式下底部 hint 显示当前 resolved 主题。
- **图标随 pref 切换**：sun（日间）/ moon（夜间）/ monitor（跟随系统），点击外部自动关闭。
- 复用 v0.5.3 已落的 `useTheme` hook（`light` / `dark` / `system` 三档 + localStorage 持久化 + `prefers-color-scheme` 监听 + `initThemeFromStorage()` 防首屏闪烁）。

#### D · 响应式收尾
- **AppShell 折叠**（`apps/web/src/App.tsx`）：`< 1024px` 时 sidebar grid 列宽折为 0（保留布局完整性），用 `useMediaQuery("(max-width: 1023px)")` 切换。
- **工作台移动端阻挡**：`FullScreenWorkbench` 在 `< 768px` 时叠加全屏遮罩 `<MobileWorkbenchBlock>`：「请切换到桌面端 · 标注工作台依赖快捷键、画布鼠标交互和大屏侧栏」 + 建议宽度 ≥ 1024px。底层工作台仍渲染（保留只读视图），但所有交互被遮挡防误操作。

#### E · 图标体系迁移到 Lucide React
- **`Icon.tsx` 内部重写**（`apps/web/src/components/ui/Icon.tsx`）：删除 ~70 行手写 SVG path 字符串，改为 60 项 `name → Lucide 组件` 映射表；对外 `<Icon name="..." size stroke style className />` API 完全保留 → **177 处调用零改动**。
- **`forwardRef` 兼容**：保留 ref 透传给 SVG 元素，不破坏现有 ref 用法。
- **新增 icons**：sun / moon / monitor / inbox（主题切换 + 追溯 banner 等新 UI 用）；polygon → `Hexagon`、cube → `Box`、warning → `AlertTriangle`、edit → `Pencil` 等 Lucide 标准映射。
- **新代码约定**：写新功能直接 `import { Layers, Sparkles, ... } from "lucide-react"`，不必走中间层；`Icon.tsx` 仅作存量兼容。
- **依赖与体积**：`pnpm --filter @anno/web add lucide-react`；`pnpm build` 后 gzip 主 chunk **261.92 KB**（迁移前 ~256 KB），增量 ~6 KB，符合 ROADMAP `< 10 KB` 验收。

### 验证

- `tsc --noEmit`（apps/web）✅ 0 errors
- `vitest run` ✅ 37/37 passed（hotkeys 27 + iou 10）
- `pnpm vite build` ✅ 2022 modules, 1.79s
- 后端 `from app.main import app` ✅
- 后端冒烟（router / schema / depends 导入）✅

### 不在本期范围

- 前后端 schema 自动同步（OpenAPI → TS 类型生成）—— 本次 `UserOut.is_active` 漏暴露暴露的就是这个隐患的实例，留给 v0.5.x 续期。
- project_admin 视角下 UsersPage 列表按管理项目自动过滤；删除带未完成任务的用户先转交 / 跨项目用户的精确显示。
- 窄屏 hamburger drawer 触发完整 sidebar；通用 `⋯` 溢出菜单组件抽取（多页面共享）。
- detail_json 字段级 PG GIN 索引筛选；审计中间件双行 UI 合并视图。
- 后端 `audit.export` 端点 `target_id` 入参的端到端单测（手工验证已通过）。

---


## [0.5.4] - 2026-04-30

### 新增

#### A · Polygon 顶点编辑（v0.5.3 polygon MVP 收尾）
- **顶点拖动**：选中已落库 polygon 后，圆点 handle 显式可拖；`<ImageStage>` Drag 联合类型新增 `{ kind:"polyVertex", id, vidx, start, cur }`，与 move/resize 通道并列；commit 走 `useAnnotationHistory.push({kind:"update"})` 单条命令，Ctrl+Z 一键还原。
- **Alt+点击边新增顶点**：边上挂 10px 透明 hit-stroke，alt 时 cursor 切 copy；点中即在最近边后插入鼠标投影点。
- **Shift+点击顶点删除**：≤3 顶点时 toast 拒绝。
- **自相交校验**：`stage/polygonGeom.ts` 提供 `isSelfIntersecting()`（O(n²) segment-pair 暴力，n 通常 < 50）；commit 路径统一调用，违规时 stroke 切红 + 标签加 ⚠ + toast「polygon 自相交，已撤销」+ 几何回退。
- **精确 IoU**：引入 `polygon-clipping@0.15.7`；`stage/iou.ts` 的 `iouShape()` 走 `intersection()` 求精确交并，polygon-vs-bbox 把 bbox 转 4 顶点同分支，bbox-vs-bbox 仍走原 `iou()`。`WorkbenchShell` 视觉去重处把 `iou()` 调用换成 `iouShape()`。`iou.test.ts` 新增 4 例 polygon 用例（identical / disjoint / 半重叠 / triangle vs bbox = 0.5）。
- **HotkeyCheatSheet**：补三行说明（拖动顶点 / Alt+click 边 / Shift+click 顶点）。

#### B · 项目级属性 schema + Annotation.attributes（P1）
- **数据模型**：alembic 0012 一次性加 `annotations.attributes JSONB DEFAULT '{}'` + `projects.attribute_schema JSONB DEFAULT '{"fields":[]}'` + `projects.classes_config JSONB DEFAULT '{}'`（B + E 共一份 migration）。存量 0 影响。
- **Schema DSL**：项目级声明属性列表 `{ key, label, type, required?, options?, min?, max?, applies_to?: "*"|string[], visible_if?, hotkey? }`；`type` 支持 text / number / boolean / select / multiselect / range；后端 pydantic `_validate_attribute_schema` 校验 key 唯一、type 枚举、select-必有 options。
- **后端 API**：`PATCH /projects/{id}` 接 `attribute_schema`；`PATCH /tasks/{id}/annotations/{aid}` 接 `attributes` 直接覆盖。`AnnotationOut` 新增 `attributes` 字段。
- **AttributeForm 组件**：`shell/AttributeForm.tsx` 根据 `schema × class_name × annotation.attributes` 动态渲染表单（react-hook 风格，无新 deps）；`visible_if` 单层条件级联；改完防抖 400ms 上抛 PATCH。
- **AIInspectorPanel 接驳**：选中态下方挂 `<AttributeForm>` + 缺失必填提示。
- **AttributesSection（项目设置页 tab）**：可视化增删改字段、上下移、导入 / 导出 JSON；保存时整包 `PATCH /projects/{id}` 带 `attribute_schema`。
- **必填校验**：`getMissingRequired()` 工具函数；`<Topbar>` 提交质检按钮在任意 annotation 缺必填时 toast「存在必填属性未填，无法提交」+ 阻塞提交。

#### C · 逐框评论 annotation_comments
- **数据模型**：alembic 0013 建表（id, annotation_id, project_id, author_id, body, is_resolved, is_active, ts）+ 复合索引 `(annotation_id, created_at desc)`。
- **后端 API**：`api/v1/annotation_comments.py` 注册到 router，提供 `GET/POST /annotations/{aid}/comments`、`PATCH/DELETE /comments/{id}`。create 时写 audit_log `action="annotation.comment"` + `target_type="annotation"`，自动经现有通知中心 30s 轮询可见。权限：作者或管理员可编辑/软删。
- **CommentsPanel 组件**：`shell/CommentsPanel.tsx` 渲染输入区 + 历史列表（作者名、时间、已解决徽章），「✓」切解决态、「🗑」作者可删。
- **AIInspectorPanel 接驳**：选中态属性表单下方再挂评论区。
- **通知中心映射**：`utils/auditLabels.ts` 加 `annotation.comment: "评论标注"` + `annotation.update: "编辑标注"`，`AUDIT_TARGET_TYPES` 加 `annotation`。

#### D · 自动保存 / 离线队列（P2）
- **idb-keyval@6 引入**：仅 ~2KB；`state/offlineQueue.ts` 提供 `enqueue / count / drain / subscribe / isOfflineCandidate` 纯函数 API；持久化到 idb key `anno.offline-queue.v1`，incognito quota 失败时 try/catch 静默降级。
- **`useOnlineStatus` hook**：监听 `navigator.online/offline` + 队列长度变更，输出 `{ online, queueCount }`。
- **WorkbenchShell mutation 包裹**：`handlePickPendingClass` / `handleCommitMove` / `handleCommitResize` / `handleCommitPolygonGeometry` / `handleDeleteBox` 的 onError 走 `enqueueOnError`：`isOfflineCandidate(err)` （TypeError 网络断 / 5xx）时 enqueue + toast「已暂存到离线队列」；普通错误按原路径报错。
- **`flushOffline` 自动触发**：`online` 事件由 useEffect 监听，online 切回时自动 drain 队列；逐条 replay create/update/delete API；ok > 0 时 invalidate annotations / tasks query 并 toast「已同步 N 条离线操作」。
- **StatusBar 徽章**：右侧加「离线 · N 操作待同步」/「暂存 · N」按钮（offline 红色 / online 黄色），点击立即重试。

#### E · Classes 升级（color + order + 拖排）
- **数据模型**：alembic 0012 加 `projects.classes_config JSONB DEFAULT '{}'`，存量 `classes` 仍是 `string[]` 零变动；`{name: {color, order}}` 形式存元信息。
- **后端校验**：pydantic `_validate_classes_config` 校验 color 是 `#RRGGBB`、order 非负唯一。
- **前端调色板**：`stage/colors.ts` 重构：`classColor(name, config?)` / `classColorForCanvas(name, config?)` 优先级 `传入 config > 模块级 _activeConfig（项目当前） > 内置预设 > FNV-1a hash 派生`；新增 `setActiveClassesConfig()` 模块级 setter，避免 ImageStage / SelectionOverlay / KonvaBox 等 10+ 处逐层透传 prop。
- **WorkbenchShell**：项目加载时 `useEffect(() => setActiveClassesConfig(currentProject?.classes_config), ...)`；`classes` 数组在工作台维度按 `sortClassesByConfig()` 重排。
- **ClassPalette**：新增可选 `classesConfig` prop，左侧常驻图例颜色块走真实 hex。
- **ClassesSection（项目设置页新 tab）**：每个类别一行 `[#] [色块] [名称] [color picker] [↑↓🗑]`；拖排（上下移）+ HTML5 `<input type="color">`；新增 / 删除；保存时 `PATCH /projects/{id}` 同时带 `classes` + `classes_config`。

### 测试 / 工程

- **vitest 37 例全绿**（v0.5.3 = 33；v0.5.4 = +4 polygon IoU）。
- **`tsc -b` 全绿**。
- **alembic upgrade/downgrade 双向通过**：0010 ↔ 0011 ↔ 0012 ↔ 0013 全部往返成功。
- **新依赖**：`polygon-clipping@^0.15.7`、`idb-keyval@^6.2.1`（前端各 ~2-3KB gzip）。

### 调整 / 重构

- `KonvaPolygon` 加 4 个新 props：`points` / `selfIntersect` / `editable` / `onVertexMouseDown` / `onEdgeMouseDown`；选中态自动渲染 vertex circle + 透明 edge hit-area。
- `<ImageStage>` 新增 prop `onCommitPolygonGeometry?: (id, before, after) => void`。
- `useTasks.useUpdateAnnotation` 的乐观 onMutate 把 `attributes` 字段也合并到缓存，避免表单回显抖动。
- `auditLabels.ts` 行业新增 `annotation.update / annotation.comment`，`AUDIT_TARGET_TYPES` 加 `annotation`。
- `Icon.tsx` 新增 `chevUp` / `tag` 两个 SVG 路径。

### 已知限制 / 待 v0.5.5

- 属性 schema 的 `hotkey` 字段当前仅声明，不绑定（与 1-9 类别快捷键冲突协调归 v0.5.5）。
- 离线队列：多 tab 同步、queue 详情抽屉 UI、history undo 链与 tmp_id 替换归 v0.5.5。
- 评论：`@` 提及、附件、画布层手绘批注归 v0.5.5。
- classes 升级：导出器（COCO / YOLO）暂未读 attributes，schema 导出迁移归 v0.5.5。
- polygon 精确 IoU 的项目级阈值（`project.iou_dedup_threshold`）仍硬编码 0.7。

---


## [0.5.3] - 2026-04-30

### 新增

#### C.2 工作台 UI 信息架构重构（ToolDock + FloatingDock + 三段 Topbar）
- **左侧 ToolDock（垂直工具栏）**：新建 `apps/web/src/pages/Workbench/shell/ToolDock.tsx`，从 `tools/registry` 自动渲染按钮（icon + hotkey tooltip + active 高亮）。新增工具仅需在 `tools/` 注册并加入 `ALL_TOOLS`，外壳无需改动。
- **画布右下 FloatingDock（悬浮工具岛）**：新建 `apps/web/src/pages/Workbench/shell/FloatingDock.tsx`，承载撤销 / 重做 / 缩放 / 缩放百分比 / 适应。锚定到画布容器左下角（避开右下 Minimap），与 Konva viewport 贴合。
- **Topbar 三段重构**：原单行 9+ 控件挤爆 → grid `1fr auto 1fr` 三段：左 = 标题 + index 徽章 (`n / total`)；中 = 上一 / 提交质检 / 下一 / ⌄ 智能切题；右 = AI 一键预标 + ⋯ 溢出菜单（快捷键 + 主题切换）。1280px 单行不换行；行内元素 ≤ 8。
- **WorkbenchShell 主 grid 调整**：`260/32 → 48 → 1fr → 280/32` 四列，ToolDock 始终 48px 不随侧栏折叠。

#### C.2 暗色模式（与 B「主题切换」打底一并落地）
- **`tokens.css [data-theme="dark"]` 块**：暗色覆盖 `--color-bg / -elev / -sunken / -hover / -panel`、`--color-fg / -muted / -subtle / -faint`、`--color-border / -strong`、accent / success / warning / danger / ai 系列（保持色相、提亮 lightness、降饱和度）、shadow（加深 alpha）、画布棋盘格新增 `--color-canvas-checker-a/b` 双 token。
- **`useTheme` hook**：`light | dark | system` 三档，写 `<html data-theme>`，持久化到 `localStorage["anno.theme"]`，`system` 模式监听 `prefers-color-scheme` 自动切换。
- **启动注入 `initThemeFromStorage()`**：`main.tsx` 在 `createRoot` 前应用初始主题，避免 first-paint 闪白。
- **Topbar 溢出菜单 `<ThemeSwitcher>`**：三选一按钮组，亮色 / 暗色 / 跟随系统。

#### C.1 Konva 分层 hit-detection
- **`<ImageStage>` 拆 4 个 Layer**：`bg`（图像，`listening:false` 独立缓存）+ `ai`（AI 预测框）+ `user`（人工框 + 选中态）+ `overlay`（绘制预览 / pending 框 / polygon 草稿，`listening:false`）。user 框 move/resize 重绘不再连带触发 AI 层。

#### C.3 多边形工具（polygon）
- **数据模型升级 → discriminated union geometry**：`Annotation.geometry` / `PredictionShape.geometry` / `AnnotationPayload.geometry` 改为 `{type:'bbox',x,y,w,h} | {type:'polygon',points:[[x,y],...]}`。前端 `Annotation` 类型仍保留 `x/y/w/h`（包围盒）+ 新增可选 `polygon: [number, number][]`，对存量读 `.x/.y/.w/.h` 的代码路径完全兼容；polygon 包围盒由 `transforms.polygonBounds()` 自动派生。
- **alembic 0011 migration**：一次性给存量 `annotations.geometry` 与 `predictions.result[*].geometry` 补 `type:"bbox"` 字段；downgrade 反向移除。
- **后端 pydantic geometry validator**：`AnnotationCreate` / `AnnotationUpdate` 加 `field_validator`，校验 bbox 必有 x/y/w/h、polygon 必有 ≥ 3 个 `[x,y]` 顶点；兼容旧客户端无 type 时按 bbox 处理。
- **`PolygonTool`（hotkey `P`）**：实现 `CanvasTool` 接口；左键逐点落点 / 距首点 < 0.008 自动闭合 / 双击或 Enter 闭合 / Esc 取消 / Backspace 撤销最后一点。`onPointerDown` 通过 `ToolPointerContext.polygonDraft` 句柄 mutate Shell 维护的草稿状态，不走 setDrag 路径。
- **画布渲染**：新增 `KonvaPolygon` 组件（Konva `Line closed=true` + 半透明填充 + 标签锚到第一个顶点）；ImageStage user/AI 层按 `b.polygon` 存在条件分流到 KonvaBox 或 KonvaPolygon。overlay 层渲染 polygon 草稿：已落点 + 跟随光标的预览段 + 顶点圆点 + 首点高亮（提示可闭合）。
- **复用流程**：`useClipboard` 解耦硬编码 `annotation_type:"bbox"`，按 source 是否含 polygon 分流：polygon 整体平移所有点；history `useAnnotationHistory` 命令模式已抽象 `AnnotationPayload`，无需改动；`iou.ts` 新增 `iouShape()` 形状无关入口（polygon 暂走包围盒近似，TODO 后续接 polygon-clipping）。
- **限定**：v0.5.3 polygon MVP = 创建 / 渲染 / 删除 / 改类别 / 撤销重做。**顶点拖动 / Alt+点击边新增顶点 / Shift+点击删除顶点 / 自相交校验 / polygon-vs-bbox/polygon 精确 IoU** 留 v0.5.4+。

#### Phase 1 · 工具层抽离（多工具基础设施）
- **`tools/index.ts` 接口激活**：`CanvasTool` 接口扩展 `label / icon / cursor` + `onPointerDown(ctx) → DragInit | null`；`TOOL_REGISTRY` 与 `ALL_TOOLS` 导出。新增 `BboxTool.ts` / `HandTool.ts` / `PolygonTool.ts` 独立模块。
- **`ImageStage.handleStageMouseDown` 改为委派**：从 if-else 工具分支 → `TOOL_REGISTRY[tool].onPointerDown(ctx)`，spacePan 时强制走 hand 工具。Drag init 类型 `{kind:'draw'|'pan'}`。
- **`hotkeys.ts` 加 `dispatchKey()` 纯函数**：把键盘事件 + 简单 ctx 映射为 `HotkeyAction` 离散指令；WorkbenchShell 大 useEffect 改为 `switch (action.type)`。新增 `apps/web/src/pages/Workbench/state/hotkeys.test.ts`（27 例），覆盖修饰键 / 单键 / 上下文相关三组分支。
- **快捷键补齐**：`P` = 多边形工具；`Enter` 闭合 polygon；`Backspace` 在 polygon 草稿态删最后一点（其余态删除选中框）。HotkeyCheatSheet 同步。

### 测试 / 工程

- **vitest 33 例全绿**（v0.5.2 = 6 例 IoU；v0.5.3 = +27 例 hotkey dispatch）。
- **`tsc -b` 全绿**：geometry discriminated union 升级未泄漏到任何调用点（通过 `bboxGeom() / polygonGeom()` 包装 helper 局部化）。

### 调整 / 重构

- `Topbar.tsx` props 大幅精简：移除 `tool / scale / canUndo / canRedo / onSetTool / onZoom* / onUndo / onRedo`（已迁出到 ToolDock + FloatingDock）；新增 `taskIdx / taskTotal / overflowSlot`。
- `useWorkbenchState` 的 `Tool` 联合类型扩展：`"box" | "hand"` → `"box" | "hand" | "polygon"`。
- `transforms.ts` 新增 `bboxGeom() / polygonGeom() / polygonBounds() / geometryToShape()` 工具函数；`annotationToBox / predictionsToBoxes` 内部统一走 `geometryToShape` 派生包围盒。
- `useClipboard.ts:41` 删除硬编码 `annotation_type:"bbox"`；payload 形状按 source 形状自适应。

### 已知限制

- **polygon 顶点拖动 / 编辑 / 自相交校验** 留 v0.5.4。
- **polygon 精确 IoU** 暂用包围盒近似（视觉去重场景精度足够；TODO 接入 polygon-clipping 库）。
- **AI 模型当前不输出 polygon predictions**（GroundingDINO 只 bbox）；polygon 主要服务手工标。后续 SAM 接入会自然填补。

---


## [0.5.2] - 2026-04-30

### 新增

#### C.3 多选 / 批量编辑 / 复制粘贴
- **多选状态层**：`useWorkbenchState` 的 `selectedId: string | null` 之外新增 `selectedIds: string[]`；`selectedId` 作为 primary（驱动 SelectionOverlay 浮按钮锚点 / 单体快捷键），`selectedIds` 包含 primary 在内的全部选中。新增 `toggleSelected(id)` / `replaceSelected(ids[])` / `setSelectedId(id)`（后者会同步收敛 selectedIds 到 [id] 或 []）。AI 框始终单选。
- **Shift+点击叠加多选**：画布与 AIInspectorPanel 列表都支持；`onSelectBox(id, { shift })` 统一 API 由 Shell 层判断走 toggle 还是 replace。Shift+点空白不清空选择；普通点空白清空。
- **`Ctrl+A` 全选当前帧 user 框**；`Esc` 清空。
- **批量删除（Delete）**：`handleBatchDelete` 并发 `deleteAnnotation`，全部 settled 后聚合 1 条 `kind: "batch"` 命令进 history 栈，单次 Ctrl+Z 一键还原；toast 报告 `已删除 N/M 个标注`。
- **批量改类（C 键 / SelectionOverlay "批量改类" 浮按钮）**：复用 `<ClassPickerPopover>`（标题切换为「批量改类别 (N 个)」），锚定到第一个选中框；commit 时并发 PATCH 每个选中框 class_name，settled 后聚合 batch update 命令。
- **方向键平移**：选中 ≥ 1 个 user 框时，方向键 1px / Shift+方向键 10px 平移；keydown 期间维护 `nudgeMap: Map<id, Geom>` 作为画布临时 override（与 drag 共享 overrideGeom 通道，`drag > nudgeMap > 原值` 优先级），keyup 时一次性把所有 nudge 落库为单条 batch update 命令。
- **复制 / 粘贴 / 复制副本（Ctrl+C / Ctrl+V / Ctrl+D）**：`useClipboard` hook 维护本会话内存剪贴板（不跨任务，避免跨项目类别污染）；粘贴 / 复制副本均走 (+10px, +10px) 偏移、clamp 到 [0,1] 边界；落库后批量进 history 栈，新副本自动成为多选。

#### C.3 / C.2 智能切题 + AI 框 IoU 视觉去重 + 撤销栈批量化
- **`N` / `U` 智能切题**：Topbar 「智能切题」下拉（同时绑 `N`/`U` 单字母键）。
  - `N`（下一未标注）：在已加载列表里找 `idx > current && total_annotations === 0 && status !== "completed"`；列表末尾时自动 fetchNextPage。
  - `U`（下一最不确定）：启发式 = 已加载列表中 `total_predictions > 0 && total_annotations === 0`，按 `total_predictions desc` 排第一名；后端精排（list_tasks `?order=conf_asc`）作为 P2 待办留在 ROADMAP。
- **AI 框 IoU 视觉去重**：与已确认 user 框 IoU > 0.7 且同类的 AI 框 → 画布层 stroke opacity 0.35（复用现有 `fadedAiIds` 通道）+ AIInspectorPanel 列表项整行 opacity 0.55 + 「已被覆盖」灰 tag。**不删除**，保留用户反悔空间。`stage/iou.ts` 纯函数 + 6 例 vitest 单测。
- **`useAnnotationHistory` batch 命令**：新增 `kind: "batch"`（包裹一组非 batch 子命令），undo 时反序应用、redo 时正序应用；新增 `pushBatch(commands[])`：长度 1 时退化为 push 单条，> 1 时进 batch 命令。所有批量操作（删除、改类、复制粘贴、Ctrl+D、方向键平移）共享同一栈条目。

#### C.2 类别面板纯预览 + 快捷键补齐 + ETA + 阈值反馈
- **`<ClassPalette>` 加 `readOnly` prop**：`TaskQueuePanel` 左侧常驻类别面板改为 `readOnly` —— 鼠标 cursor: default，悬浮无 hover 着色，行点击与最近使用 chip 点击均无效；语义退化为「图例 + 快捷键速查」。`<ClassPickerPopover>` 内部仍保持交互态（popover 本身就是选类场景）。`activeClass` 写入权交给数字/字母键、popover、最近使用 record。
- **快捷键补齐**（11 条新增 + HotkeyCheatSheet 同步）：`Tab`/`Shift+Tab`（user 框间循环）、`J`/`K`（不循环到边界停）、`[`/`]`（阈值 ±0.05，clamp 0~1）、`Ctrl+A`/`Ctrl+C`/`Ctrl+V`/`Ctrl+D`、`N`/`U`、方向键。`hotkeys.ts` 是 SoT，速查面板自动渲染。
- **`useSessionStats` ETA**：每次切题记录与上次的间隔，ring buffer size 20，过滤 < 1.5s 误触和 > 30min 离座；< 10 题样本显示 `—`，达到后 StatusBar 输出 `avg/题 · 剩 N · 约 mm:ss`。`formatDuration` 工具函数支持小时降级。
- **Topbar 阈值数值浮出反馈**：`[`/`]` 键调整阈值时右上角浮出 `阈值 55%`（1.5s 自动消失），便于盲调。Topbar 也接 `confThreshold` prop。

### 测试基座
- **vitest 引入**：`pnpm --filter web add -D vitest@^2.1.0`，第一组单测 `stage/iou.test.ts`（identical / disjoint / touching / half overlap / contained / zero-area 六例全过）。后续 hooks（`useAnnotationHistory` batch、`useClipboard` 偏移、`useSessionStats` ring buffer）单测扩展归 ROADMAP。

### 改动文件
- 新建：`apps/web/src/pages/Workbench/state/{useSessionStats,useClipboard}.ts`、`apps/web/src/pages/Workbench/stage/{iou,iou.test}.ts`
- 重构：`apps/web/src/pages/Workbench/state/{useWorkbenchState,useAnnotationHistory,hotkeys}.ts`、`apps/web/src/pages/Workbench/shell/{WorkbenchShell,Topbar,StatusBar,AIInspectorPanel,TaskQueuePanel,ClassPalette}.tsx`、`apps/web/src/pages/Workbench/stage/{ImageStage,SelectionOverlay,BoxListItem}.tsx`
- 文档：`ROADMAP.md` 删除 v0.5.1 / 当前迭代已完成的小项；新增 § A 协作并发（任务锁续约 + 编辑冲突 ETag）作为 P0；增补 ML Backend 协议契约文档 / Annotation 列表分页 / Konva 分层 hit / HotkeyCheatSheet 升级 / History sessionStorage 持久化 / IoU 阈值项目级可配等若干新发现项；优先级表整体翻新

### 兼容性
- `<ImageStage>` 新增 `selectedIds?: string[]` / `nudgeMap?: Map<string, Geom>` / `onBatchDelete?` / `onBatchChangeClass?` 均为可选，`onSelectBox` 第二参数 `opts?: { shift?: boolean }` 也可选；`<ReviewWorkbench>` 走只读路径，零改动即可继续工作（多选在 readOnly 时被收敛到单选）。
- `<ClassPalette>` 的 `onPick` 现在是可选 prop（readOnly 时不需要）；`<TaskQueuePanel>` 移除了 `onSetActiveClass` prop，对应外部调用同步迁移。

### 升级备注
- 前端：`pnpm install`（拉 vitest）；运行测试 `pnpm --filter web exec vitest run iou.test.ts`。
- 无后端 / DB / Docker 改动；版本号升至 0.5.2。

---


## [0.5.1] - 2026-04-30

### 新增

#### 标注流程重构 — 工具/类别解耦 + 类别选择 popover
- **画完框再选类**：原本"选类别 = 选工具"，现在改为"选 bbox 工具 → 画框 → 弹 `<ClassPickerPopover>` 选类别 → 落库"。中间态 `pendingDrawing` 落在 `useWorkbenchState`，未确认前框以琥珀色虚线渲染（带 "? 待选类别" 标签）；Esc / 点画布外 / 切工具 = 取消；Enter = 落到默认类别；1-9 / A-Z 键直选。
- **已落库框可改类别**：选中 user 框 → 三入口（① SelectionOverlay 浮按钮显示当前类色块 + "改类" 标签；② AIInspectorPanel 列表项内 "改类" 按钮；③ `C` 快捷键）→ 复用 `<ClassPickerPopover>`（标题切换为 "改类别 (当前: X)"）→ 选定后走 `PATCH /annotations/{id}` 改 class_name 并 `history.push({kind:"update"})` 进撤销栈，可 Ctrl+Z 还原。`useWorkbenchState.editingClass` 持有改类中间态。
- **`useRecentClasses`**：localStorage 持久化每个项目的最近 5 个类别（key=`recent-classes:${projectId}`），popover 顶部 chip 行置顶；落库后自动 record。新进项目时默认类别选 recent 头部（如该项目仍存在）而非永远首类。
- **`<ClassPalette>` 共享组件**：popover 与 `TaskQueuePanel` 类别面板共用一份组件；> 9 类自动启用搜索框 + 字母键 a-z 映射到 classes[9..]；recent chip 行；快捷键徽章统一渲染。

#### C.1 渲染细节收尾
- **Minimap**：`<Minimap>` 缩略图导航（160×120，自动按图像 aspect 适配），仅当图像视口可视率 < 85% 时显示；点击 minimap 把视口中心移到该位置；视口矩形高亮当前可见区域。`ImageStage` 通过 `onStageGeometry` 把 imgW/imgH/vpSize 上抛，父级在 overlay slot 渲染。
- **AIInspectorPanel 虚拟化**：`@tanstack/react-virtual` 单列表合并 AI 段 + Header + 用户段；500 框 DOM 节点压到 < 30；滚到末尾自动 fetchNextPage 拉更多预测；底部 "加载更多 / 加载中" 兜底。
- **rAF 节流**：`ImageStage` 的 pointermove（draw / move / resize / pan）用 requestAnimationFrame 合并；240Hz 屏拉框 react-render 频率从 ~240/s 降到 60/s，1000 框 + 4K 图 pan/zoom 稳定 60fps。
- **按需加载预测**：后端 `/tasks/{id}/predictions` 加 `limit` + `offset` 参数，跨 Prediction 按 shape 置信度 desc 排序后切片再回到原 Prediction 容器；前端 `usePredictions` 改 `useInfiniteQuery`，pageSize=100；阈值变更（debounce 300ms）触发 reset 重拉。

#### C.2 体验收尾
- **响应式可折叠**：`useMediaQuery` hook（`useSyncExternalStore` + matchMedia）；< 1024px 强制收两侧 sidebar；Topbar 按钮分组（视图/绘制/历史 + AI/导航）+ flexWrap 兜底，狭长窗口自动换行。
- **骨架屏 + blurhash 占位**：`<WorkbenchSkeleton>` 三栏骨架（shimmer 动画）替代 `isProjectLoading` 文字；`ImageStage` 在真图加载前用 32×24 blurhash 解码 + blur(8px) 占位（v0.5.0 已注入 blurhash 字段，本次接通到画布层）。
- **类别面板增强**：TaskQueuePanel 类别区改用 `<ClassPalette>`，> 9 类启用搜索；最大高度 320px + 内部滚动避免挤占任务列表。

### 改动文件

- 新建：`apps/web/src/pages/Workbench/state/useRecentClasses.ts`、`apps/web/src/pages/Workbench/shell/{ClassPalette,ClassPickerPopover,WorkbenchSkeleton}.tsx`、`apps/web/src/pages/Workbench/stage/Minimap.tsx`、`apps/web/src/hooks/useMediaQuery.ts`
- 重构：`apps/web/src/pages/Workbench/state/useWorkbenchState.ts`（pendingDrawing）、`apps/web/src/pages/Workbench/stage/ImageStage.tsx`（rAF 节流 + blurhash + pendingDrawing 渲染 + onStageGeometry / overlay slot）、`apps/web/src/pages/Workbench/shell/{WorkbenchShell,TaskQueuePanel,AIInspectorPanel,Topbar}.tsx`、`apps/web/src/hooks/usePredictions.ts`（useInfiniteQuery）、`apps/web/src/api/predictions.ts`、`apps/web/src/pages/Review/ReviewWorkbench.tsx`
- 后端：`apps/api/app/api/v1/tasks.py`（predictions endpoint 加 limit/offset，跨 Prediction 按 shape 置信度排序）

### 兼容性

- 原 `usePredictions(taskId)` 返回 `data: PredictionResponse[]` → 现在返回 `useInfiniteQuery` 结果。两个调用点（`WorkbenchShell` / `ReviewWorkbench`）已同步迁移到 `data.pages.flatMap(p => p)`。

---


## [0.5.0] - 2026-04-29

### 新增

#### 画布引擎 — Konva 切换
- **`ImageStage` 全面切 Konva**：底层从 DOM `<div>` 矩形切换为 `react-konva@18` Stage/Layer/Rect，解除 200+ 框掉帧的硬天花板；`KonvaImage` 配合 `use-image` hook 加载原图，`stage.scaleX/Y/x/y` 接管视口变换
- **SelectionOverlay HTML 浮层**：采纳 / 驳回 / 删除浮动按钮移出 Stage，以绝对定位 React div 叠在 Stage 外层，按 bbox 右下角 `(box.x+w)*imgW*scale+tx` 投影到容器坐标；支持 Tab 聚焦 + 键盘可达
- **BboxTool / HandTool 抽象**：`stage/tools/index.ts` 定义 `CanvasTool` 接口（id / hotkey / onMouseDown / onMouseMove / onMouseUp）；v0.5.1 增 polygon / keypoint 只需添加 Tool 模块，不动 ImageStage
- **颜色兼容**：`classColorForCanvas()` 通过 Canvas 2D `fillStyle` 把 oklch 转为 Konva 可用的 hex；resize 锚点按 `HANDLE_SCREEN_PX / vp.scale` 保持屏幕像素恒定大小
- **ReviewWorkbench 复用**：`<ImageStage readOnly />` 入参形状不变，审核页无需改动即获 Konva 性能收益

#### 任务列表 — keyset 分页 + 虚拟化
- **修复 5k 任务截断**：`useTaskList` 改为 `useInfiniteQuery` + 后端已有 `_encode_task_cursor / next_cursor`，前 50 之后的任务现在可见
- **`@tanstack/react-virtual` 虚拟化**：`TaskQueuePanel` 固定高度虚拟列表（estimateSize=84px），滚到末尾前 10 条自动 `fetchNextPage`
- **`navigateTask` 跨页预取**：切到倒数第 10 条时触发 `fetchNextPage`；`ReviewPage` 同一 hook，零改动

#### 预取 + 体感优化
- **相邻任务预取**：切题时对前后各一条 task 的 `annotations`、`predictions` 调 `queryClient.prefetchQuery`，并插入 `new Image().src` 预热图像字节；连续翻题第 2 题起无白屏
- **服务端置信度过滤**：`GET /tasks/{id}/predictions?min_confidence=0.7` 服务端裁剪载荷；前端 `confThreshold` 变更 300ms debounce 再发请求；减少大预测集的 JSON 体积
- **WS 连接灯**：StatusBar 新增 6px 圆点状态指示（绿/橙/灰）+ 文案「实时同步 / 重连中 / 实时进度暂停」

#### 缩略图基础设施
- **alembic 0009**：`dataset_items` 新增 `thumbnail_path(VARCHAR 512)` + `blurhash(VARCHAR 64)`；顺带修复 v0.4.8 alembic 漂移（`content_hash` 列用 `IF NOT EXISTS` 补迁移）
- **alembic 0010**：`tasks` 新增 `thumbnail_path(VARCHAR 512)` + `blurhash(VARCHAR 64)`，支持直传（非数据集）任务的缩略图
- **Celery `media` 队列**：新建 `workers/media.py`；`generate_thumbnail` 任务处理数据集条目缩略图；`generate_task_thumbnail` 任务处理直传任务（从 `annotations` bucket 拉图，写回 `tasks` 表）；失败写 `metadata_['thumbnail_error']`，重试 3 次
- **自动触发**：`dataset` 路径（upload-complete / upload-zip / scan-import）写库后各自 `generate_thumbnail.delay(item_id)`；`files.py` upload-complete 写库后派发 `generate_task_thumbnail.delay(task_id)`
- **`POST /datasets/{id}/backfill-media`**：触发 `backfill_media` Celery 任务，对存量无缩略图 dataset image 补生成
- **`POST /files/projects/{project_id}/backfill-thumbnails`**：触发 `backfill_tasks` Celery 任务，对存量直传无缩略图任务补生成
- **`_attach_dimensions` / `_attach_dimensions_batch` 双路回落**：有 `dataset_item_id` 时走 DatasetItem 取宽高 + 缩略图；`dataset_item_id = NULL` 时回落到 `tasks.thumbnail_path / blurhash` 字段，两条路径统一透出
- **前端 `Thumbnail` 组件**：blurhash canvas 占位 → `<img loading=lazy decoding=async>` 淡入替换；`TaskQueuePanel` 左侧 40×40 缩略图，`DatasetsPage` 文件列表 32×32 缩略图
- **`TaskOut` / `DatasetItemOut` schema**：新增 `thumbnail_url` + `blurhash` 字段透出到前端

#### 基础设施
- **Docker Compose 完整化**：新增 `api`（alembic upgrade + uvicorn，Python healthcheck）、`web`（Nginx SPA）服务；`celery-worker` 升级为监听 `default,ml,media` 三队列
- **`MINIO_PUBLIC_URL` 配置**：`config.py` 新增 `minio_public_url` 字段；`StorageService._public_url()` 在生成 presigned URL 后将内部 endpoint 替换为外部可访问地址；docker-compose 注入 `http://localhost:9000`，浏览器可直接访问缩略图与原图

#### UI 改进
- **Button 圆角优化**：sm 尺寸改为 `--radius-pill`（胶囊形），md 尺寸改为 `--radius-lg`；增加 primary/danger/ghost 各自的 box-shadow 与 border-color 差异化；加 `transition: opacity 0.1s` 悬停反馈

### 修复
- **删除标注框闪烁**：`useDeleteAnnotation` 加 `onMutate` 乐观更新，立即从 React Query 缓存中过滤掉目标 annotation，`onError` 回滚快照；消除 API round-trip 期间的「框消失 → 重现」闪烁
- **移动标注框回弹**：`useUpdateAnnotation` 同理加 `onMutate` 乐观更新，mutation 发出前立即更新缓存中的 geometry；消除「框跳回原位再移到新位置」的视觉抖动
- **默认缩放 125% 问题**：`ImageStage` 初次 fit 加 `imageLoaded = !!image?.naturalWidth` 守卫，确保在真实图像尺寸加载完成后才执行 `fitNow()`；防止以 900×600 fallback 计算出错误的初始 scale

### 依赖
- 前端新增：`blurhash^2.0.5`、`react-konva`、`use-image`（Konva 画布切换）、`@tanstack/react-virtual`（任务列表虚拟化）
- 后端新增：`blurhash-python>=1.2.0`（pyproject.toml）

### 升级备注
- **alembic upgrade head**：执行 0009（dataset_items thumbnail + content_hash 漂移）+ 0010（tasks thumbnail_path + blurhash）
- **Python 依赖**：`uv sync` 拉 `blurhash-python`
- **Celery**：启动 media worker：`celery -A app.workers.celery_app worker -Q media -c 4 --loglevel=info`
- **存量 dataset 数据**：调 `POST /datasets/{id}/backfill-media` 补全历史 dataset_items 缩略图
- **存量直传任务**：调 `POST /files/projects/{project_id}/backfill-thumbnails` 补全直传任务缩略图
- **Docker 部署**：`MINIO_PUBLIC_URL` 设为浏览器可访问的 MinIO 地址（本地开发 `http://localhost:9000`）
- 版本号升至 0.5.0

---


## [0.4.9] - 2026-04-29

### 新增

#### 标注工作台 — 结构骨架（行为等价基线）
- **三层拆分**：`apps/web/src/pages/Workbench/WorkbenchPage.tsx` 由 720 行单文件拆为 `WorkbenchPage`(5 行入口) + `shell/`(`WorkbenchShell` / `Topbar` / `TaskQueuePanel` / `AIInspectorPanel` / `StatusBar` / `HotkeyCheatSheet`) + `stage/`(`ImageStage` / `ImageBackdrop` / `BoxRenderer` / `BoxListItem` / `DrawingPreview` / `ResizeHandles` / `colors`) + `state/`(`useWorkbenchState` / `useViewportTransform` / `useAnnotationHistory` / `transforms` / `hotkeys`)；按 ROADMAP §C.4 「单工作台外壳 + 维度切分画布 + 工具可插拔」三层架构落地，后续扩 polygon / video / lidar 仅注册新 Stage 与新 Tool，不动外壳
- **空图状态**：删除 `ImageBackdrop` 的 SVG 货架占位，改为「图像不可用 + 重试」按钮（清理研发期 mock 残留）

#### 标注工作台 — P0 体验
- **撤销 / 重做**：`useAnnotationHistory` 命令栈支持 create / delete / update / acceptPrediction 四类命令；`Ctrl+Z` undo、`Ctrl+Shift+Z` / `Ctrl+Y` redo；切任务清栈；mutation pending 期间禁用 undo 按钮
- **框 Move / Resize**：选中用户框后渲染 8 个 resize 锚点（4 角 + 4 边中点）+ 框体拖动整体平移；本地 state 显示拖动过程，松手才落 PATCH（节流落库）；几何全程 clamp 到 [0,1]，过小框（< 0.5%）拒收并 toast 提示
- **真视口 transform**：`<canvas>` 用 `transform: translate(tx,ty) scale(s)` 替代原 `width:900*zoom × height:600*zoom` 伪缩放；`Ctrl + wheel` 以光标为锚点缩放（公式 `tx' = cx - (cx - tx)·(s'/s)`）；`Space + drag` 平移；双击空白 fit-to-viewport；`Ctrl+0` 触发 fit
- **状态栏真实化**：`分辨率` 字段从 `task.image_width × task.image_height` 读（dataset_items 新增字段）；新增「光标 (x, y)」字段实时显示图像系坐标；`BoxListItem` 像素坐标也从硬编码 1920×1280 改为读真实尺寸
- **快捷键速查面板**：`?` 弹 `<HotkeyCheatSheet>`；所有快捷键定义集中在 `state/hotkeys.ts` 一份 SoT，cheat sheet 与 keydown 注册都从这里读
- **类别色板自动分配**：> 5 个类别时按 hash(class_name) → OKLCH 色环确定性派生，跨会话稳定；< 5 仍用预设 5 色
- **Toast 抑流**：`handleAcceptAll` 与批量审核都改为终态聚合一条 `已采纳 17/20，3 项失败`，避免每框一刷屏

#### 标注 API
- **`PATCH /api/v1/tasks/{task_id}/annotations/{annotation_id}`**：新增；支持部分更新 `geometry / class_name / confidence`；拒绝改 `task_id / source / parent_prediction_id`（防越权）；写 `audit.action=annotation.update`
- **任务锁心跳续锁**：`create / update / delete annotation` 与 `accept prediction` 四个 mutation 端点在 commit 前自动调 `TaskLockService.heartbeat`，避免长时间画框 lock 过期误报
- **前端 hook**：`useUpdateAnnotation(taskId)` / `tasksApi.updateAnnotation` / `AnnotationUpdatePayload`

#### 数据 & 存储
- **`dataset_items.width / height`**：alembic migration 0008；上传完成（`upload-complete` 与 `upload-zip`）与 `scan_and_import` 自动用 Pillow 解析图像头部（256KB Range fetch，避开整张大图下载）回填尺寸；新增 `Pillow>=10` 依赖
- **`POST /api/v1/datasets/{id}/backfill-dimensions?batch=N`**：管理员补量端点，分批处理存量 image 类型 items（默认 50/批），返回 `processed / failed / remaining_hint`
- **`TaskOut.image_width / image_height`**：列表端点批量 JOIN dataset_items（避 N+1），单端点直接 get，前端状态栏与 BoxListItem 全部用真实尺寸

#### 审核页接画布
- **`<ReviewWorkbench>`**：复用 `<ImageStage readOnly />`，readOnly 时禁用绘制 / move / resize / accept-reject 浮按钮，仅保留 pan / 选中 / wheel-zoom；与标注页共用同一个画布组件
- **diff 三态切换**：「仅最终 / 仅 AI 原始 / 叠加 diff」；diff 模式下已被采纳的 prediction 自动淡化（`opacity: 0.35`）避免与对应 annotation 堆叠；ImageStage 接受 `fadedAiIds` 集合
- **ReviewPage 列表 + Drawer**：行点击不再跳转 Workbench，改为右侧 70vw Drawer 滑入（URL `?taskId=` 同步，浏览器前进后退保留状态，ESC 关闭，左右切上下题）
- **批量操作**：每行 checkbox + 顶部浮条「批量通过 (N)」「批量退回 (N)」；退回弹 `<RejectReasonModal>` 选预设原因（类别错误 / 漏标 / 位置不准 / 框过大或过小 / 其他自定义）；批量 fire 后聚合 toast `已退回 18/20，2 项失败`

### 升级备注

- **alembic upgrade head**：执行 0008 加 `dataset_items.width / height` 两列（nullable，无数据迁移开销）
- **Python 依赖**：`uv sync` 拉 Pillow；alpine 基础镜像需在 Dockerfile 加 `apk add jpeg-dev zlib-dev`，slim 镜像无须改动
- **存量数据**：上线后管理员调用 `POST /datasets/{id}/backfill-dimensions` 给已有 dataset 补尺寸（不调用也能跑，状态栏显示「分辨率 —」直到回填完成）
- 版本号升至 0.4.9

---


## [0.4.8] - 2026-04-29

### 新增

#### 数据 & 存储
- **多桶展示**：`GET /api/v1/storage/buckets` 返回 `annotations` + `datasets` 两桶的 name / status / object_count / total_size_bytes；StoragePage 按桶分卡显示，TopStats 展示总容量
- **文件大小统计**：`DatasetOut` 增加 `total_size` 字段（聚合 `SUM(file_size)`，批量 GROUP BY 避免 N+1）；StoragePage 数据集表新增「容量」列，去除「后续版本支持」占位文案
- **文件 md5 去重**：`dataset_items` 增加 `content_hash(md5)` 列（nullable，带索引）；ZIP 上传计算 md5 跳过同 dataset 内重复文件（新增返回字段 `deduped`）；`upload-complete` 通过 S3 ETag 检测重复 → 409 + `duplicate_of`；`scan_and_import` 同样跳过重复 hash

#### 用户与权限
- **角色 tab 真权限矩阵**：`UsersPage`「角色」tab 不再读 `mock.ts`；从 `ROLE_PERMISSIONS` 枚举所有角色，按 `PERMISSION_GROUPS`（项目/任务/用户数据组/数据集存储/AI审计设置）5 组分块展示，命中权限绿色 ✓ 徽章，未命中灰色占位，viewer 角色零权限仍有完整信息密度
- 新增 `ROLE_DESC`（`constants/roles.ts`）、`PERMISSION_LABELS` + `PERMISSION_GROUPS`（`constants/permissions.ts`）

#### TopBar
- **刷新按钮**：绑定 `queryClient.invalidateQueries()` 全局刷新；正在 fetching 时图标旋转动画
- **通知中心**：铃铛点击弹 `NotificationsPopover`（右侧浮层，点击外部关闭）；后端 `GET /api/v1/auth/me/notifications` 过滤与当前用户相关的审计事件（被邀请/改角色/项目变更），30s 轮询；已读状态存 localStorage；unread_count > 0 时铃铛显示红点；点「全部已读」写 last_read_at

#### 治理 / 合规
- **审计导出**：`GET /api/v1/audit-logs/export?format=csv|json`（max 50000 行，超出 413）支持与 list 相同的所有过滤参数；导出操作自身写 `audit.export` 行；AuditPage 新增「CSV」「JSON」导出按钮
- **自动刷新**：AuditPage 「30s 自动刷新」checkbox，开启时 refetchInterval=30000

#### 可观测性
- **健康检查拆分**：新建 `app/api/health.py`；`/health` 返回 `{status, version, checks: {db, redis, minio}}`；子路由 `/health/db` `/health/redis` `/health/minio` 各返回 `{status, latency_ms}`；k8s readiness 可单独 probe；旧 `@app.get("/health")` 移除
- **X-Request-ID 传播**：新建 `RequestIDMiddleware`（`middleware/request_id.py`）；每个请求自动生成/透传 `X-Request-ID`，写入 `ContextVar`；`AuditMiddleware` 中间件行与 `AuditService` 业务行均在 `detail_json.request_id` 注入，实现跨表完整追溯
- **结构化 JSON 日志**：`app/core/logging.py` 接入 structlog；所有日志输出 JSON（timestamp / level / logger / event / request_id）；`uvicorn.access` 静默不重复输出；适配 Loki / ELK 聚合
- **Prometheus 指标**：`GET /metrics` 端点（不在 `/api/v1` 前缀下，不经过 AuditMiddleware）；`anno_http_requests_total`（method/path/status）、`anno_http_request_duration_seconds`（method/path）由 `RequestIDMiddleware` 在每次 `/api/` 请求后记录
- 版本号升至 0.4.8

#### 性能 / 扩展
- **审计日志 keyset 分页**：`GET /api/v1/audit-logs` 新增可选 `cursor` 参数（base64 `created_at|id`）；返回 `next_cursor` 供下一页 URL 传递；兼容保留 `page/page_size` 参数
- **任务列表 keyset 分页**：`GET /api/v1/tasks` 同样新增可选 `cursor` 参数（base64 `created_at|task_id`）；返回 `next_cursor`；无 `cursor` 时保持原有 `offset` 分页不变
- **N+1 修复**：`list_audit_logs` 改为单 `OUTERJOIN User` 批量回填 `actor_email`，消除每行单次 `db.get(User, actor_id)` 的 N 次查询
- **数据库连接池调优**：`create_async_engine` 显式设置 `pool_size=10, max_overflow=20, pool_recycle=3600`，避免高并发下连接耗尽与连接泄露

---

## [0.4.7] - 2026-04-29

### 新增

#### 数据集导入面板（M1）
- 新增 `ImportDatasetWizard.tsx`：三步向导（基本信息 → 选择文件 → 上传完成），支持拖拽 + 多文件选择
- 新增 `utils/uploadQueue.ts`：promise pool 并发控制（默认 3）+ `putWithProgress` 基于 XHR 的可上报进度的 PUT
- 复用现有后端 `POST /datasets/{id}/items/upload-init` + `upload-complete`（presigned URL → MinIO 直传）
- DashboardPage「导入数据集」按钮接通向导（替换 toast 占位）；DatasetsPage 详情面板「上传」按钮支持向已有数据集追加文件
- 上传过程实时显示每文件进度条 + 总进度；失败可见错误，关闭后状态清零

#### 用户与权限页（M2）
**Group 实体（独立表）**
- 新增 `groups` 表（id / name unique / description / created_at）+ `users.group_id` 外键（ON DELETE SET NULL）；alembic 迁移 `0006_groups.py` 包含从现有 `users.group_name` 字符串 seed Group 行 + 回填 group_id
- 新增 `GET / POST / PATCH / DELETE /api/v1/groups`（super_admin / project_admin），含成员计数聚合 + 审计日志
- 新增 `PATCH /users/{id}/group`：分配/解绑数据组，同步刷新 `users.group_name` 冗余字段，写 audit `user.group_change`

**邀请管理（admin 端）**
- 在 `user_invitations` 加 `revoked_at` 列；alembic 迁移 `0007_invitation_revoked_at.py`
- `UserInvitation` 模型新增 `status` 派生属性（pending / accepted / expired / revoked）
- 新增 `GET /api/v1/invitations?status=&scope=me|all`：列出邀请记录（scope=all 仅 super_admin）
- 新增 `DELETE /invitations/{id}` 撤销 pending；`POST /invitations/{id}/resend` 重置 token + 过期时间，返回新 invite_url；均写 audit
- 新增 `InvitationListPanel.tsx`：状态过滤 + 撤销 / 重发（自动复制新链接）

**用户导出**
- 新增 `GET /api/v1/users/export?format=csv|json`（StreamingResponse）：CSV 含 BOM 兼容 Excel；写 audit `user.export`
- 前端 `usersApi.exportUsers()` 直接触发浏览器下载

**EditUserModal + GroupManageModal**
- 新增 `EditUserModal.tsx`：改角色（仅 super_admin）+ 改数据组 + 内联停用账号二次确认
- 新增 `GroupManageModal.tsx`：组的新建 / 重命名 / 删除（行内编辑 + 二次确认）

**UsersPage 接通 + tab 重构**
- 行末「编辑/设置」按钮接通 EditUserModal（替换原死按钮）
- 顶部「导出名单」按钮接通后端 export，加 `Can permission="user.export"` 守卫
- 「数据组」tab 由硬编码 7 个改为 `useGroups()` 实数据 + 顶部「管理数据组」按钮
- 新增「邀请记录」tab，挂 InvitationListPanel
- `permissions.ts` 新增 `user.export` / `group.manage` / `invitation.manage` 三个 PermissionKey 并写入 ROLE_PERMISSIONS

#### 一致性 / 体验（M3）
- **顶层 ErrorBoundary**：`apps/web/src/components/ErrorBoundary.tsx` 包裹整个 RouterProvider，抛错降级到刷新 / 回到首页 / 折叠堆栈面板，预留 Sentry 钩子注释
- **API 客户端 403 / 5xx 拦截**：`api/client.ts` 在抛 ApiError 前对 403 触发 `toast.warning`、对 5xx 触发 `toast.error`，401 既有逻辑保留；公共端点（`anonymous: true`）跳过
- **Toast 扩展**：`Toast.tsx` 支持 `kind: warning | error`（不同色板与 ttl）
- **项目级路由守卫**：新增 `RequireProjectMember` 包裹 `/projects/:id/annotate`，进入工作台前先 `useProject(id)` 校验权限，403/404 弹回 `/dashboard` + warning toast
- **WebSocket 自动重连**：新增通用 `useReconnectingWebSocket` hook（指数退避 1s→30s，最多 8 次），重构 `usePreannotation` 使用；`WorkbenchPage` 状态栏显示「AI 通道重连中… (n)」/「AI 通道断开」

### 端到端验证

- 后端：`alembic upgrade head` → groups + revoked_at 迁移成功；`/api/v1/groups`、`/invitations`、`/users/export`、邀请重发/撤销 全部冒烟通过
- 前端：`tsc --noEmit` 0 错误；新增组件：ImportDatasetWizard / EditUserModal / GroupManageModal / InvitationListPanel / ErrorBoundary / RequireProjectMember / useReconnectingWebSocket

---


## [0.4.6] - 2026-04-29

### 新增

#### 平台 / 治理基座（一次性兑现 4 项硬占位）

##### 审计日志（`/audit`）
- 新增 `audit_logs` 表（actor_id / actor_email / actor_role / action / target_type / target_id / method / path / status_code / ip / detail_json / created_at）+ 4 条索引；alembic 迁移 `0005_governance.py`
- 新增 `AuditService.log()` 业务显式打点 + `AuditAction` 枚举（17 种业务动作）
- 新增 `AuditMiddleware`（`apps/api/app/middleware/audit.py`）：异步、错误隔离、独立 session，自动捕获所有 `POST/PATCH/PUT/DELETE` 写请求 metadata；`/auth/login`、`/auth/register`、`/auth/me/password` 因含密码 body 跳过中间件，由路由内显式 audit
- 新增 `GET /api/v1/audit-logs`（super_admin only，分页 + 按 action / target_type / actor_id / 时间区间过滤）
- 新增 `/audit` 页（`AuditPage.tsx`）：FilterBar（仅业务 / 全部 / 按动作 / 按对象 / 按操作人）+ 表格（时间 / 操作人+role badge / 动作 / 对象 / IP / 状态码彩色 badge / 详情 Modal 显示 detail JSON）
- AdminDashboard 新增「近期审计活动」卡片：取最近 8 条业务事件，点击「查看全部」跳 `/audit`
- 新增 `apps/web/src/utils/auditLabels.ts`：action → 中文映射

##### 邀请制注册（B 方案，落地 CHANGELOG 既定设计）
- 新增 `user_invitations` 表（id / email / role / group_name / token UNIQUE / expires_at / invited_by / accepted_at / accepted_user_id）+ 部分索引 `WHERE accepted_at IS NULL`
- 新增 `InvitationService`（`create / resolve / accept`）：
  - `create`：`secrets.token_urlsafe(32)` 生成 token，`expires_at = now() + invitation_ttl_days`；同 email 旧 pending 自动作废（避免一邮箱多链接歧义）
  - `resolve`：404 / 410（accepted / expired）
  - `accept`：复用 `hash_password` 创建 User + invitation 标记 accepted
- `POST /users/invite` 替换 stub：`super_admin / project_admin` 可调，已激活同 email 用户返回 409；写 audit `user.invite`（detail 含 role / group_name）；返回 `{invite_url, token, expires_at}`
- 新增 `GET /auth/invitations/{token}`（公开）+ `POST /auth/register`（公开）：register 成功直接颁发 access_token + 写 audit `user.register`（actor 即新建用户自身）
- 新增 `PATCH /users/{id}/role` + `POST /users/{id}/deactivate`（super_admin only），均显式写 audit
- 新增 `InviteUserModal.tsx`：两态（form / result）—— form 按 actor 角色过滤可邀请角色（super_admin 可邀全部 / project_admin 仅 reviewer/annotator/viewer），result 显示一次性 invite_url + 复制按钮 + 7 天有效提示
- 新增 `RegisterPage.tsx`（`/register?token=xxx`，脱离 AppShell + RequireAuth）：三态 loading / error（无效 / 过期 / 已使用，全屏 Card 提示「请联系管理员重新发送邀请」）/ form；提交后 `setAuth(token, user)` → `navigate('/dashboard')`
- UsersPage 邀请按钮去掉 toast 占位，挂 `<InviteUserModal />` + `<Can permission="user.invite">` 守卫
- `client.ts` 增加 `publicGet / publicPost`：跳过 Authorization 注入、401 不触发全局 logout（用于公开端点）
- authStore 增加 `setAuth(token, user)` 一次性入口，便于 RegisterPage 与 SettingsPage 复用

##### 设置页（`/settings`）
- 新增 `PATCH /auth/me`（改 name，含 audit `user.profile_update`）
- 新增 `POST /auth/me/password`（旧密码校验，写 audit `user.password_change`，本路径跳过中间件捕获）
- 新增 `GET /settings/system`（super_admin only）：返回 environment / invitation_ttl_days / frontend_base_url / SMTP 配置态（password 永不出口）
- 新增 `SettingsPage.tsx`，左 nav + 右 panel：
  - **个人资料**（所有角色）：邮箱 / 角色 / 数据组只读，姓名可改 + 修改密码块
  - **系统设置**（仅 super_admin）：只读卡片展示当前环境（badge 配色 production 红 / staging 黄 / development 灰）+ 邀请有效期 + 前端地址 + SMTP 主机/端口/账号/发件人状态；底部小字「如需修改，请编辑后端 .env 并重启服务」
- `permissions.ts` 把 `settings` 加入所有角色可访问页（不同角色看到的 section 不同）；`audit` 仍仅 super_admin

##### annotator 个人任务面板
- AnnotatorDashboard「开始标注」按钮智能行为：
  - 0 项目：`disabled` + tooltip「暂无分配项目，请联系管理员」
  - 1 项目：直接 `navigate('/projects/${id}/annotate')`
  - 多项目：弹出 `SelectProjectModal`（按待标任务数排序）
- 新增「我的项目」卡片：表格（项目名 / 类型 / 进度 / 待标 / 打开按钮），数据复用 0.4.5 已加 ProjectMember 过滤的 `GET /projects`，无需新端点
- 新增 `apps/web/src/components/dashboard/SelectProjectModal.tsx`

#### 配置 / 运维
- `app/config.py` 扩展：`environment: Literal["development","staging","production"]`、`frontend_base_url`、`invitation_ttl_days`、`smtp_host/port/user/password/from`、`smtp_configured` property
- 新增 `scripts/bootstrap_admin.py`：从 env (`ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME`) 创建首个 super_admin（幂等，已存在则跳过 + 写 audit `system.bootstrap_admin`）；可在 production 安全运行
- `scripts/seed.py` 顶部加生产保护：`environment=production` 时立即非 0 退出
- `app/main.py` 注册 AuditMiddleware（CORS 之后）；版本号 0.2.0 → 0.4.6

### 变更
- `users.invite` 端点契约变更：从 `{status: "invited"}` stub → `{invite_url, token, expires_at}`，前端 `usersApi.invite` 返回类型同步更新
- `permissions.ts`：`settings` 页对 reviewer / annotator / viewer 开放（仅展示「个人资料」section）
- `apiClient` 新增 `publicGet / publicPost` 方法供公开端点使用，原 `apiClient.get/post/...` 行为不变

### 修复
- `POST /api/v1/users/invite` 不再返回 stub `{"status": "invited"}`
- UsersPage「邀请成员」按钮不再显示虚假 toast「邀请链接已复制」
- AnnotatorDashboard「开始标注」按钮不再仅 toast 占位

---

## [0.4.5] - 2026-04-29

### 新增

#### 项目权限隔离与负责人体系
- 新增 `ProjectMember` 模型 + alembic 迁移 `0004_project_members.py`：项目内 annotator/reviewer 指派关系（UniqueConstraint(project_id, user_id)，CASCADE 项目）
- `apps/api/app/deps.py` 增加 `assert_project_visible` / `require_project_visible` / `require_project_owner` 三个工厂：可见性 = super_admin 全量；project_admin 仅 `owner_id == self`；annotator/reviewer/viewer 仅经 ProjectMember 关联
- `GET /projects` / `GET /projects/stats` / `GET /projects/{id}` 全部按可见性过滤；`GET /tasks` 与 `/tasks/next` 也加同样校验

#### 项目设置接口（兑现 0.4.4 占位）
- `PATCH /projects/{id}`：通用字段更新，权限 `require_project_owner`
- `DELETE /projects/{id}`：硬删 + cascade，权限 `require_project_owner`
- `POST /projects/{id}/transfer`：负责人转移，**仅 super_admin** 可调用，目标必须是 `project_admin` 角色
- `GET / POST / DELETE /projects/{id}/members`：成员 CRUD；`POST` 校验目标 user.role 与指派 role 一致（annotator → ANNOTATOR；reviewer → REVIEWER）

#### `ProjectOut` 字段扩充
- 新增 `owner_id` / `owner_name` / `member_count` 字段，前端 Dashboard「负责人」列与设置页直接消费

#### 前端项目设置页
- 新建 `/projects/:id/settings` 路由（`pages/Projects/ProjectSettingsPage.tsx`）：左侧 4 个 section 切换
  - **基本信息**（`GeneralSection`）：名称 / 状态 / 截止 / 类别 chip / AI 开关与模型，调用 `PATCH`
  - **成员管理**（`MembersSection` + `AssignMemberModal`）：列表 + 「指派标注员」「指派审核员」按钮，按角色过滤候选，去重；移除走二次确认 Modal
  - **负责人**（`OwnerSection`）：仅 super_admin 可见；下拉选 project_admin → 「确认转移」
  - **危险操作**（`DangerSection`）：删除项目，输入项目名二次确认
- 守卫：非 owner 且非 super_admin 直接 `<Navigate to="/unauthorized">`

#### Dashboard / 向导接入
- `DashboardPage.tsx` 项目列「负责人」列改为真数据 `p.owner_name`、`p.member_count`
- 列尾对 owner / super_admin 显示齿轮按钮 → 设置页
- `CreateProjectWizard.tsx` 成功页新增「项目设置」CTA，兑现步骤 2 文案「后续可在项目设置中调整」

#### Hooks / API / Permissions
- `api/projects.ts`：`update / remove / transfer / listMembers / addMember / removeMember`
- `hooks/useProjects.ts`：`useUpdateProject / useDeleteProject / useTransferProject / useProjectMembers / useAddProjectMember / useRemoveProjectMember`
- `hooks/useIsProjectOwner.ts`：`super_admin || owner_id === self` 工具 hook
- `constants/permissions.ts`：新增 `project.transfer`（仅 super_admin）
- `api/client.ts`：新增 `apiClient.patch`

### 变更

- `apps/web/tsconfig.json` 移除已弃用的 `baseUrl`（`paths` 在 bundler 模式下使用相对路径，`vite/tsconfig` 解析依旧）

---

## [0.4.4] - 2026-04-28

### 新增

#### 真实路由（URL 即状态）
- `react-router-dom` v6.28 启用：`main.tsx` 包 `<BrowserRouter>`，`App.tsx` 重写为 `<Routes>` + `AppShell`（`<Outlet />`）
- 路由表：`/login`、`/dashboard`、`/projects/:id/annotate`、`/review`、`/users`、`/datasets`、`/storage`、`/ai-pre`、`/model-market`、`/training`、`/audit`、`/settings`、`/unauthorized`，未匹配路径回落 `/dashboard`
- 新增 `components/routing/RequireAuth.tsx`：未登录跳 `/login` 并通过 `state.from` 承接登录后回跳
- 新增 `components/routing/RequirePagePermission.tsx`：基于 `usePermissions().canAccessPage()` 守卫，无权限重定向 `/unauthorized`
- `Sidebar.tsx` 改用 `<NavLink>`，激活态由 URL 驱动；导航不再依赖 Zustand 内存态
- `LoginPage.tsx` 已登录则 `<Navigate>` 回 `from` 或 `/dashboard`，避免重复登录
- 标注工作台改为按 URL 加载：`WorkbenchPage` 通过 `useParams<{ id }>()` 读取项目 ID，`useProject(id)` 拉取数据；刷新 `/projects/<id>/annotate` 不再掉回 dashboard

#### 新建项目向导
- 新增 `components/ui/Modal.tsx`：通用对话框（`createPortal` + ESC + 点击遮罩 + body 锁滚），无第三方依赖
- 新增 `components/projects/CreateProjectWizard.tsx`：三步向导
  - 步骤 1 类型：项目名称（2-60）+ 数据类型卡片（7 种，与 `TYPE_ICONS` 对齐）+ 截止日期
  - 步骤 2 类别：标注类别 chip（回车快速添加，× 删除，去重，单条 ≤30）
  - 步骤 3 AI 接入：开关 + 预设模型下拉（`YOLOv8` / `GroundingDINO+SAM` / `SAM-HQ` / `GPT-4V` / `Qwen2-VL` / `PointPillars`）+「自定义」自由输入
  - 成功页：显示 `display_id`，CTA「关联数据集」跳 `/datasets`、「打开项目」（仅 image-det）跳工作台
- 新增 `constants/projectTypes.ts`：`PROJECT_TYPES` + `PRESET_AI_MODELS` + `CUSTOM_MODEL_KEY`
- `DashboardPage.tsx`「新建项目」按钮接通向导：`useSearchParams` 控制 `?new=1`，模态状态写进 URL（刷新可保持），仍由 `<Can permission="project.create">` 守卫
- 创建成功后通过 `useCreateProject` 的 `invalidateQueries` 自动刷新项目列表与统计卡

### 变更

#### 移除 Zustand 页面状态
- `stores/appStore.ts` 删除 `page` / `setPage` / `currentProject` / `setCurrentProject`，仅保留 `workspace`
- 全部页面切换改用 `useNavigate()`：`AnnotatorDashboard` / `ReviewerDashboard` / `ViewerDashboard` / `UnauthorizedPage` / `DashboardPage`
- `DashboardPage` / `ViewerDashboard` 不再接收 `onOpenProject` prop，内联 `useNavigate` 决定跳转目标
- Sidebar 移除「标注工作台」顶层入口（无项目上下文不可用），改由 dashboard 列表行点击进入

### 修复
- 解决浏览器刷新一律回到 dashboard 的问题：URL 即真实导航状态
- 浏览器前进/后退按钮恢复正常工作

---

## [0.4.3] - 2026-04-28

### 新增

#### 标注工作台独立全屏模式
- `App.tsx`：`page === "annotate"` 时绕过主布局（TopBar + Sidebar），以全屏独立页面渲染 `WorkbenchPage`，画布、任务列表、AI 面板均可充分展开

#### 两侧面板折叠/展开
- `WorkbenchPage.tsx`：新增 `leftOpen` / `rightOpen` 状态，左侧任务列表与右侧 AI 助手面板均可独立折叠
- 收起后保留 32px 细栏，显示竖排文字（"任务列表" / "AI 助手"）及展开箭头，交互意图清晰
- 展开状态下面板 header 右上角显示收起按钮（`‹` / `›`），操作直观

### 修复
- 修复工作台独立渲染后父节点无高度约束导致画布纵向溢出的问题（`App.tsx` 包裹 `height: 100vh`）

---

## [0.4.2] - 2026-04-28

### 新增

#### 前端 RBAC 权限体系
- 新增 `constants/permissions.ts`：页面访问矩阵（`ROLE_PAGE_ACCESS`）+ 细粒度操作权限矩阵（`ROLE_PERMISSIONS`），20 种权限类型
- 新增 `hooks/usePermissions.ts`：权限 Hook，提供 `canAccessPage()` / `hasPermission()` / `hasAnyPermission()` 接口
- 新增 `components/guards/Can.tsx`：声明式权限守卫组件，包裹 UI 元素按角色显隐
- 新增 `pages/Unauthorized/UnauthorizedPage.tsx`：403 未授权页面，显示当前角色 + 返回首页按钮

#### 侧边栏角色过滤 & 路由守卫
- `Sidebar.tsx` 按当前用户角色过滤导航菜单项，空 section 自动隐藏
- AI 配额卡片仅 super_admin / project_admin 可见
- `App.tsx` 新增路由守卫：无权限页面渲染 UnauthorizedPage，dashboard 页面按角色分发到对应看板组件

#### 角色差异化看板（借鉴 Label Studio / CVAT / Scale AI 等平台经验）
- 新增 `AdminDashboard.tsx`（super_admin）：平台概览 — 用户总数/活跃数、项目状态分布（进度条）、用户角色分布、ML 后端在线状态、任务/标注总量
- 新增 `ReviewerDashboard.tsx`（reviewer）：质检工作台 — 待审核/今日已审/通过率/累计审核统计卡片 + **跨项目待审任务列表**（含文件名、所属项目、标注数），支持直接通过/退回操作
- 新增 `AnnotatorDashboard.tsx`（annotator）：个人工作台 — 待标任务数/今日完成/本周完成/准确率统计 + 近 7 天标注趋势 Sparkline + 周目标环形进度图 + "开始标注" CTA
- 新增 `ViewerDashboard.tsx`（viewer）：只读项目概览 — 精简项目表格（无新建/导出/打开按钮），只读统计卡片
- `DashboardPage.tsx`（project_admin）：保持原有项目总览，"新建项目"/"导入数据集"按钮用 `<Can>` 包裹按权限显隐

#### 后端 Dashboard 统计端点（3 个新端点）
- `GET /api/v1/dashboard/admin`（super_admin）：用户统计、项目状态分布、ML 后端状态、角色分布
- `GET /api/v1/dashboard/reviewer`（reviewer+）：待审核数、今日已审、通过率、**跨项目待审任务列表**（JOIN tasks + projects，返回文件名/项目名/标注数）
- `GET /api/v1/dashboard/annotator`（annotator+）：个人待标任务、今日/本周/累计完成、准确率、近 7 天每日标注计数
- 新增 `schemas/dashboard.py`：AdminDashboardStats / ReviewerDashboardStats / ReviewTaskItem / AnnotatorDashboardStats
- `router.py` 注册 `/dashboard` 路由组

#### 前端 Dashboard API 对接
- 新增 `api/dashboard.ts`：AdminDashboardStats / ReviewerDashboardStats / AnnotatorDashboardStats 类型定义 + API 调用
- 新增 `hooks/useDashboard.ts`：`useAdminStats()` / `useReviewerStats()` / `useAnnotatorStats()` React Query hooks

### 修复

#### Users API 端点实现
- `GET /api/v1/users` 从空壳（返回 `[]`）改为真实数据库查询，支持按 role 过滤，返回 `list[UserOut]`
- UsersPage 成员列表现在展示真实用户数据

#### 用户去重
- 停用 6 个旧 `@example.com` 测试用户（`is_active=False`），消除用户列表中同一人重复出现的问题
- 新增 `viewer@test.com`（观察者）测试账号，补全五种角色覆盖

#### 前端显示修复
- 修复 `roles.ts` 中 `viewer` 角色标签的 Unicode 损坏（`��察者` → `观察者`）

### 变更

#### 权限矩阵

| 角色 | 看板 | 可访问页面 |
|------|------|-----------|
| super_admin | 平台概览 | 全部 11 项 |
| project_admin | 项目总览 | 除审计日志外全部 |
| reviewer | 质检工作台 | 首页 / 质检审核 / 数据集 |
| annotator | 个人工作台 | 首页 / 标注工作台 |
| viewer | 只读概览 | 首页 / 数据集 |

#### 测试账号（密码统一: `123456`）

| 邮箱 | 角色 |
|------|------|
| `admin@test.com` | 超级管理员 |
| `pm@test.com` | 项目管理员 |
| `qa@test.com` | 质检员 |
| `anno@test.com` | 标注员 |
| `viewer@test.com` | 观察者 |

---

## [0.4.1] - 2026-04-28

### 新增

#### 数据集与项目解耦（核心架构升级）
- 新增 `datasets` 表，数据集作为独立实体，与项目多对多关联
- 新增 `dataset_items` 表，文件元数据独立存储（file_name、file_path、file_type、file_size、metadata JSONB）
- 新增 `project_datasets` 关联表，支持一个数据集被多个项目复用、一个项目关联多个数据集
- `tasks` 表新增 `dataset_item_id` 外键，Task 通过 DatasetItem 引用文件，与标注工作逻辑分离
- 保留 Task 上的 `file_name`/`file_path` 冗余字段，向后兼容现有标注流程
- Alembic 迁移 `0003_datasets`：建表 + 自动将现有项目数据迁移为独立数据集（每个 Project 生成同名 Dataset + DatasetItems + ProjectDataset 关联）

#### 数据集 CRUD API（12 个端点）
- `GET /api/v1/datasets` — 数据集列表（分页 + 搜索 + 数据类型过滤）
- `POST /api/v1/datasets` — 创建数据集（需 project_admin 以上角色）
- `GET /api/v1/datasets/{id}` — 数据集详情（含关联项目计数）
- `PUT /api/v1/datasets/{id}` — 更新数据集名称/描述
- `DELETE /api/v1/datasets/{id}` — 删除数据集（CASCADE 删除关联文件）
- `GET /api/v1/datasets/{id}/items` — 数据集文件列表（分页，含 presigned URL）
- `POST /api/v1/datasets/{id}/items/upload-init` — 文件上传初始化（presigned PUT URL）
- `POST /api/v1/datasets/{id}/items/upload-complete/{item_id}` — 上传完成确认（自动获取文件大小）
- `DELETE /api/v1/datasets/{id}/items/{item_id}` — 删除文件
- `POST /api/v1/datasets/{id}/link` — 关联数据集到项目（自动为每个文件创建 Task，更新 project.total_tasks）
- `DELETE /api/v1/datasets/{id}/link/{project_id}` — 取消关联
- `GET /api/v1/datasets/{id}/projects` — 查看关联的项目列表

#### 存储健康检查端点
- `GET /api/v1/storage/health` — MinIO 连接状态检查，返回 `{ status, bucket }`

#### 后端服务层
- 新增 `DatasetService`：数据集 CRUD + 文件管理 + 项目关联（含自动 Task 生成逻辑）
- 新增 `DatasetDataType` 枚举：image / video / point_cloud / multimodal / other

#### 数据集管理页面（DatasetsPage）
- 页头统计行：数据集总数、文件总量、已关联项目数、存储后端
- 主表格：数据集列表，支持按数据类型（图像/视频/3D/多模态）筛选和关键词搜索
- 内联详情面板：点击数据集行展开，显示文件列表（分页）+ 关联项目列表
- 文件列表：文件名、类型 Badge、大小、上传时间
- 项目关联管理：下拉选择关联项目、取消关联按钮
- 新建数据集表单：名称、描述、数据类型选择
- 前端 API 模块 `api/datasets.ts` + 9 个 React Query hooks（useDatasets / useDatasetItems / useCreateDataset / useLinkProject 等）

#### 存储管理页面（StoragePage）
- 页头统计行：存储后端、存储桶名称、数据集数量
- 存储后端状态卡片：MinIO 连接信息 + 实时健康检查（Badge 显示已连接/连接失败）
- 数据集存储概览表格：按数据集展示文件数和关联项目数
- 刷新状态按钮：重新检查 MinIO 连接
- 前端 API 模块 `api/storage.ts` + `useStorageHealth` hook

### 修复

#### Mock 数据枚举迁移
- `mock.ts` User.role 从中文改为英文枚举（`"标注员"` → `"annotator"` 等）
- `mock.ts` User.status 从中文改为英文（`"在线"` → `"online"` 等）
- `mock.ts` Project.status 从中文改为英文（`"进行中"` → `"in_progress"` 等）
- `mock.ts` roles[] key 从中文改为英文枚举，对齐 `UserRole` 类型
- `DashboardPage` 状态比较和 API 查询参数改为英文枚举，通过 `FILTER_STATUS_MAP` 映射
- `UsersPage` 角色显示通过 `ROLE_LABELS` 映射回中文，STATUS_COLORS 键保持中文（匹配已翻译的 statusLabel）
- 修复构建失败：`mock.ts` 中 17 个 TypeScript 类型错误全部消除

### 变更
- 数据库从 12 张表扩展到 15 张表（+datasets、+dataset_items、+project_datasets）
- 文件存储路径格式新增 `datasets/{dataset_id}/{item_id}/{filename}`（原有 `{project_id}/{task_id}/{filename}` 路径保持兼容）
- `App.tsx` 中 datasets 和 storage 页面从占位替换为实际组件

---

## [0.4.0] - 2026-04-28

### 新增

#### WorkbenchPage 真实 API 对接（P0 — 核心里程碑）
- WorkbenchPage 全面替换 mock 数据，使用 React Query hooks 对接后端 API
- 任务队列从 `useTaskList(projectId)` 加载真实任务列表
- 标注绘制通过 `useCreateAnnotation` 实时持久化到数据库
- AI 预测通过 `usePredictions(taskId)` 加载，支持置信度阈值过滤
- 采纳 AI 预测通过 `useAcceptPrediction` 调用，自动关联 `parent_prediction_id`
- 批量预标注通过 `useTriggerPreannotation` + WebSocket 进度推送
- 删除标注通过 `useDeleteAnnotation` 调用后端软删除
- 提交质检通过 `useSubmitTask` 调用，自动释放任务锁
- 真实图片加载：优先使用 presigned URL，fallback 到 SVG 占位图
- 移除 `data/mock.ts` 中 `taskImages` 的依赖

#### 后端新端点
- `GET /tasks?project_id=&status=&limit=&offset=` — 任务列表（分页 + 过滤）
- `DELETE /tasks/{task_id}/annotations/{annotation_id}` — 删除标注
- `POST /tasks/{task_id}/review/approve` — 审核通过（status → completed）
- `POST /tasks/{task_id}/review/reject` — 审核退回（status → pending），支持 reason
- `GET /projects/{id}/export?format=coco|voc|yolo` — 数据导出（COCO JSON / VOC XML ZIP / YOLO TXT ZIP）

#### 任务锁前端集成
- 新增 `useTaskLock` hook：进入任务自动获取锁 → 120s 心跳续约 → 离开/切换自动释放
- WorkbenchPage 锁冲突提示条（409 Conflict 时显示"该任务正被其他用户编辑"）

#### 质检审核流
- 新增 ReviewPage（`/review`）：展示 status=review 的任务列表，支持通过/退回操作
- Sidebar 新增"质检审核"导航入口
- 新增 `useApproveTask` / `useRejectTask` hooks

#### AI 接管率真实统计
- 后端 `GET /projects/stats` 增强：基于 `parent_prediction_id IS NOT NULL` 计算真实 AI 接管率
- `ProjectStats` schema 新增 `total_annotations` / `ai_derived_annotations` 字段
- DashboardPage "AI 接管率" StatCard 自动使用真实数据
- WorkbenchPage 右侧面板 AI 接管率基于当前任务实时计算

#### 数据导出
- 新增 `ExportService`：COCO JSON / Pascal VOC XML / YOLO TXT 三种格式
- 归一化坐标 → 像素坐标自动转换（COCO bbox / VOC xmin-ymax / YOLO cx-cy-wh）
- VOC/YOLO 导出为 ZIP 包，COCO 为单个 JSON 文件
- DashboardPage 项目行新增导出下拉菜单

### 变更
- `tasksApi` 重构：移除旧版 `source` 字段（从 `AnnotationPayload`），新增 `parent_prediction_id` / `lead_time` 字段
- `useTasks` hooks 全部接受 `undefined` 参数（条件查询安全）
- `WorkbenchPage` 从 546 行 mock 驱动重写为 ~500 行 API 驱动
- PageKey 新增 `"review"` 类型

---

## [0.3.0] - 2026-04-28

### 新增

#### 数据模型重构（P0 — 核心架构升级）
- 新增 `organizations` + `organization_members` 表，为多租户预留
- 新增 `ml_backends` 表，模型即 HTTP 服务（对标 Label Studio ML Backend 协议）
- 新增 `predictions` 表，**与 `annotations` 彻底分离**（核心架构决定）
- 新增 `prediction_metas` 表，记录推理耗时 / token 数 / 成本（LLM 时代记账基础）
- 新增 `failed_predictions` 表，失败推理也留痕
- 新增 `task_locks` 表（防止多人同时标同一题）+ `annotation_drafts` 表（自动保存草稿）
- `projects` 扩展 7 个字段：organization_id、label_config、sampling、maximum_annotations、show_overlap_first、model_version、task_lock_ttl_seconds
- `tasks` 扩展 5 个字段：is_labeled（索引）、overlap、total_annotations、total_predictions、precomputed_agreement
- `annotations` 扩展 6 个字段：project_id、**parent_prediction_id**（AI 接管率追踪核心）、parent_annotation_id、lead_time、was_cancelled、ground_truth
- Alembic 迁移 `0002_p0_restructuring`：含角色/状态数据迁移 + 8 张新表 + 3 张表扩展

#### 枚举系统
- 新增 `app/db/enums.py`：UserRole / ProjectStatus / TaskStatus / MLBackendState / AnnotationSource / OrgMemberRole
- 角色从中文字符串迁移为英文枚举（`"超级管理员"` → `"super_admin"` 等）
- 项目状态从中文迁移为英文枚举（`"进行中"` → `"in_progress"` 等）
- 种子脚本 `seed.py` 同步更新为英文枚举值

#### 后端服务层（7 个新 service）
- `StorageService`：MinIO presigned URL 上传/下载（boto3 S3 兼容协议）
- `MLBackendClient`：ML 模型服务 HTTP 客户端（health / predict / predict_interactive / setup / versions）
- `MLBackendService`：ML Backend CRUD + 健康检查 + 获取项目交互式后端
- `PredictionService`：预测创建（含 PredictionMeta 成本记录）+ 失败记录 + 查询
- `AnnotationService`：标注 CRUD + accept_prediction（从预测派生标注）+ 草稿管理 + 统计更新
- `TaskLockService`：任务锁获取/释放/心跳续约/过期清理
- `TaskScheduler`（get_next_task）：Next-task 调度，支持 sequence / uniform / uncertainty 三种采样策略

#### API 层
- 新增 5 组 Pydantic schemas：ml_backend / prediction / task / annotation / organization
- 新增 ML Backend 路由（8 个端点）：CRUD + health + predict-test + interactive-annotating
- 新增文件上传路由（3 个端点）：upload-init（presigned PUT）+ upload-complete + file-url（presigned GET）
- **Tasks 路由从 stub 改为完整实现**（14 个端点）：包括 GET next、predictions 查询、accept prediction、task lock CRUD
- 新增批量预标注端点 `POST /projects/{pid}/preannotate`（触发 Celery 异步任务）
- `ProjectOut` schema 扩展新增字段

#### Celery 异步任务
- `celery_app.py` 配置（broker=Redis，task route: ml queue）
- `batch_predict` 任务：逐批调用 ML Backend → 创建 Prediction + PredictionMeta → Redis Pub/Sub 进度推送
- `ProgressPublisher` 服务：Redis 异步发布预标注进度

#### WebSocket
- 新增 `WS /ws/projects/{pid}/preannotate` 端点，订阅 Redis Pub/Sub 推送预标注实时进度

#### 前端基础设施
- 新增 `types/index.ts` 扩展：Prediction / PredictionShape / MLBackend / TaskLock / TaskResponse / AnnotationResponse 等类型
- 新增 `constants/roles.ts`：英文枚举 → 中文显示映射（ROLE_LABELS / PROJECT_STATUS_LABELS / TASK_STATUS_LABELS）
- 新增 3 个 API 模块：`ml-backends.ts` / `predictions.ts` / `files.ts`
- 新增 3 组 React hooks：
  - `useMLBackends` / `useCreateMLBackend` / `useMLBackendHealth` / `useInteractiveAnnotate`
  - `usePredictions` / `useAcceptPrediction`
  - `usePreannotationProgress`（WebSocket 订阅）/ `useTriggerPreannotation`
- WorkbenchPage `Annotation.source` 对齐新枚举（`"human"` → `"manual"`，`"ai-accepted"` → `"prediction_based"`）

#### 配置与基础设施
- `config.py` 新增 `ml_predict_timeout` / `ml_health_timeout` / `celery_broker_url`
- `main.py` 版本升至 0.2.0，注册 WebSocket 路由
- `docker-compose.yml` 新增 `celery-worker` 服务

#### 文档
- 调研报告拆分：47KB 单文件 → `docs/research/` 下 12 个独立文档（README 索引 + 按平台/主题分文件）
- 便于持续开发中按需更新单个文档，无需编辑巨型文件

### 变更
- `Annotation.source` 语义变更：`"human"/"ai"/"ai-accepted"` → `"manual"/"prediction_based"`（AI 预测不再混入 annotations 表）
- 角色字段从中文字符串改为英文枚举（影响 JWT payload、前端显示）
- 项目状态字段从中文改为英文枚举
- 数据库从 4 张表扩展到 12 张表

---

## [0.2.0] - 2026-04-27

### 新增

#### 认证与权限
- JWT 签发与校验 (`python-jose`)，Token 有效期可配置，payload 含 `sub`（email）和 `role`
- bcrypt 密码哈希（直接使用 `bcrypt` 库，规避 passlib 与 Python 3.14 不兼容问题）
- `GET /api/v1/auth/login` 实现真实账号密码校验并返回 Bearer Token
- `GET /api/v1/auth/me` 实现，依赖 `get_current_user` 返回当前登录用户信息
- RBAC 权限依赖工厂 `require_roles(*roles)`，不满足条件返回 403
- 后端所有业务接口统一加 Bearer 鉴权，`/health` 与 `/auth/login` 豁免

#### 数据库迁移
- Alembic 异步迁移环境配置（`async_engine_from_config` + `connection.run_sync`）
- 初始 migration `0001_initial_schema`：创建 `users`、`projects`、`tasks`、`annotations` 四张表，含 FK、索引
- 修复 local `alembic/` 目录遮蔽已安装包的 import 问题（统一用 `uv run alembic`）

#### 种子数据
- 幂等种子脚本 `apps/api/scripts/seed.py`（重复执行安全）
- 预置 6 个用户：超级管理员 `admin@example.com`、项目管理员、质检员、标注员 ×3，分属 3 个数据组
- 预置 2 个项目：P-0001 智能门店货架商品检测（image-det）、P-0002 自动驾驶路面障碍分割（image-seg）

#### 前后端联调
- 前端 API 层 (`apps/web/src/api/`)：`client.ts` fetch 封装（自动附加 Bearer）、`auth.ts`、`projects.ts`、`tasks.ts`、`users.ts`
- TanStack Query hooks：`useProjects`、`useProjectStats`、`useProject`、`useCreateProject`、`useTask`、`useAnnotations`、`useCreateAnnotation`、`useSubmitTask`、`useUsers`、`useInviteUser`
- Zustand `authStore`（`persist` 中间件，token + user 持久化到 localStorage）
- Vite dev proxy `/api/v1` → `http://localhost:8000`
- CORS 更新：`allow_origin_regex=r"http://localhost:\d+"` 兼容 preview 随机端口
- Dashboard、Users、Workbench 三个页面全部替换为真实 API，移除 mock 数据依赖
- `ProjectOut` schema 补充 `updated_at` 字段

#### 登录页与路由守卫
- 登录页 `LoginPage.tsx`：邮箱/密码表单、密码显示切换、登录失败错误提示、测试账号提示卡
- `App.tsx` 路由守卫：无 token 时渲染登录页，登录成功后直接跳转主界面
- `TopBar` 右上角显示真实用户姓名/角色（来自 `authStore`），新增退出登录按钮
- `client.ts` 全局 401 拦截：任意接口返回 401 自动调用 `logout()`，清除 token 并跳回登录页

#### 图标
- Icon 组件新增 `eyeOff`、`warning`、`logout` 三个图标

#### 开发环境
- `.claude/launch.json` 配置 web（autoPort）和 api（固定 8000）双服务启动
- Vite 端口改为环境变量驱动（`process.env.PORT`），兼容 preview_start 自动分配端口

### 修复
- `tsconfig.json` `ignoreDeprecations` 值改为 `"5.0"` 以兼容 TypeScript 5.6
- `UsersPage.tsx` 移除未使用的 `ProgressBar` import，消除编译警告
- `appStore` `currentProject` 类型从 mock `Project` 改为 `ProjectResponse | null`

---

## [0.1.0] - 2026-04-27

### 新增

#### 前端 (React + TypeScript + Vite)
- 项目脚手架：pnpm monorepo、Vite 6、TypeScript 5.6、路径别名 `@/`
- 设计 Token 系统：精确移植原型 oklch 色彩、间距、阴影、圆角等 CSS 变量
- 12 个 UI 基础组件：
  - `Button` (5 种变体: default/primary/ghost/ai/danger, 2 种尺寸)
  - `Badge` (7 种变体 + dot 指示器)
  - `Card`、`Avatar`、`ProgressBar`、`SearchInput`、`TabRow`
  - `Sparkline` (SVG 折线迷你图)
  - `StatCard` (统计卡片，含趋势指标和迷你图)
  - `Toast` + Zustand 消息队列 (3.5s 自动消失)
  - `Icon` (53 个 stroke-based SVG 图标)
- AppShell 布局：
  - `TopBar`：品牌标识、工作区切换、全局搜索 (⌘K 占位)、通知铃铛、用户头像
  - `Sidebar`：三级导航 (工作区/智能/管理)、AI 配额进度条
- 项目总览页 (Dashboard)：
  - 4 个统计卡片 (数据总量/已完成/AI 接管率/待审核) 含 sparkline
  - 项目列表表格，支持状态筛选 (全部/进行中/待审核/已完成) 和关键词搜索
  - AI 预标注队列面板 (3 个运行中任务，含进度条和 GPU 信息)
  - 近期活动流 (人工操作 + AI 助手混合时间线)
- 标注工作台页 (Workbench)：
  - 左面板：任务队列、类别选择器 (数字键快捷键)
  - 中央画布：SVG 货架模拟背景、矩形框绘制 (鼠标拖拽)、缩放控制
  - AI 预标注框 (虚线紫色) + 用户确认框 (实线)
  - 右面板 AI 助手：一键预标、全部采纳、置信度阈值滑块、标注列表
  - 键盘快捷键 (B=矩形框, V=平移, 1-5=类别, Delete=删除, ⌘←/→=切换任务)
  - 底部状态栏 (确认数/AI 待审数/当前类别/分辨率/用时/自动保存)
- 用户与权限页 (Users)：
  - 成员表格 (角色/数据组/状态/标注量/准确率)
  - 角色管理卡片 (6 种角色 + 权限标签)
  - 数据组列表 (头像堆叠)
  - 存储与模型集成面板 (OSS/MinIO/Postgres/Claude/GPT-4V/Qwen2-VL)
- 其他导航页面显示"开发中"占位
- Mock 数据层：7 个项目、6 张标注任务图片、12 个用户、6 种角色

#### 后端 (FastAPI + SQLAlchemy)
- FastAPI 应用骨架，CORS 中间件 (localhost:3000)
- Pydantic Settings 配置 (数据库/Redis/MinIO/JWT)
- 4 个 SQLAlchemy 异步模型：
  - `User` (UUID 主键, email, name, role, group, status)
  - `Project` (display_id, type_key, classes JSONB, ai_model, 任务统计)
  - `Task` (file_path, tags JSONB, status, assignee)
  - `Annotation` (source, geometry JSONB, confidence, class_name)
- Pydantic schemas (Project CRUD + Stats, User + Token + Login)
- API 路由骨架：
  - `POST /api/v1/auth/login` — 登录 (stub)
  - `GET /api/v1/auth/me` — 当前用户 (stub)
  - `GET /api/v1/projects` — 项目列表
  - `GET /api/v1/projects/stats` — 统计数据
  - `POST /api/v1/projects` — 创建项目
  - `GET /api/v1/tasks/{id}` — 任务详情
  - `GET /api/v1/tasks/{id}/annotations` — 标注列表
  - `POST /api/v1/tasks/{id}/submit` — 提交质检
  - `GET /api/v1/users` — 用户列表
- `/health` 健康检查端点

#### 基础设施
- Docker Compose：PostgreSQL 16 + Redis 7 + MinIO (含 healthcheck)
- Dockerfile.web：Node 20 多阶段构建 → Nginx 静态托管
- Dockerfile.api：Python 3.12 + uv 依赖管理 → Uvicorn
- Nginx 反向代理配置 (SPA fallback + /api/ 代理 + /ws/ WebSocket)
- 环境变量模板 (.env.example)
- 开发环境初始化脚本 (scripts/setup.sh)
