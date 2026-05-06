# v0.7.2 · 治理可视化 + 全局导航

## Context

ROADMAP 上 5 项 open 项已交叉影响日常使用：
- 批次分派只能逐个手选（`BatchAssignmentModal.tsx`），多人多批次场景操作量大；
- 项目卡 / 工作台 / Annotator·Reviewer Dashboard 看不到「这批的标注员是谁、审核员是谁」，分工不透明；
- annotation 的 create / update / delete 没写 `audit_logs`（`AnnotationService` 链路），单个标注框的修改与审核历史完全不可追溯；
- TopBar `<SearchInput kbd="⌘K">` 只有 placeholder，没有 `onChange`、没有 `/search` 端点；
- `DashboardPage.tsx:278-279` 的「筛选」「网格视图」两个 Button 无 `onClick`。

目标：一个版本（v0.7.2）一并补齐，分两个 PR 推：**治理可视化 PR**（批次分派批量动作 + 责任人头像组 + annotation audit + History tab）与**全局导航 PR**（⌘K palette + 高级筛选面板 + 网格视图）。

---

## 任务 1 · 批次级智能分派批量动作

**改动点**

- 后端 `apps/api/app/services/batch.py` — `BatchService.update()` 已支持 `assigned_user_ids` 整体替换，本次无需新端点；只在前端 modal 上加批量动作按钮。
- 前端 `apps/web/src/components/projects/BatchAssignmentModal.tsx`（已是双列多选）顶部新增工具条：
  - 「全选标注员」「全选审核员」（按 `useProjectMembers()` 返回的 role 过滤后整列勾选）
  - 「均匀分派」按钮：弹出 number input 选「每人分多少 task」，按列表顺序圆周分配到 `Task.assignee_id`（**注意：均匀分派是 task 级，不是 batch 级**；走另一个端点 → 见下）
- 后端新增 `POST /batches/{batch_id}/distribute-evenly`：
  - 参数：`{ user_ids: UUID[], strategy: "even" }`
  - 服务层把该 batch 下未分配 task 圆周写入各成员 `Task.assignee_id`，写一条 `audit_logs.action="batch.distribute_even"`，detail 记每人分到的数量
  - 复用 `BatchService._assign_tasks()` 已有的 task 级分派逻辑

**验证**：在含 ≥10 task 的 batch 上点「均匀分派 / 3 人」→ 检查 `Task.assignee_id` 分布为 ⌈10/3⌉、⌈10/3⌉、剩余；audit_logs 出现 1 条 `batch.distribute_even`。

---

## 任务 2 · 责任人可视化（标注员 / 审核员 头像组）

**后端**

- `apps/api/app/schemas/task.py` 的 `TaskOut` 增加 `assignee: UserBrief | None`（id/name/email/avatar_initial）。
- `apps/api/app/schemas/task_batch.py` 的 `BatchOut` 增加 `assignees: UserBrief[]`（按 role 拆 `annotators[]` / `reviewers[]`）。
- `apps/api/app/services/batch.py` 的 list_batches / get_batch 路径加 `selectinload(Batch.assigned_users)` 或一次 IN 查询补 user，避免 N+1。
- `apps/api/app/services/task.py` 的 list_tasks 同样补 assignee。

**前端复用 `Avatar` + `Badge`**（已存在 `BatchesSection.tsx:177-223` 的头像组样式，抽成 `<AssigneeAvatarStack count={3} users={...} role="annotator" />` 通用组件放 `components/ui/`）：

- `pages/Projects/ProjectsPage.tsx` 项目卡批次概览处加 stack（标注员一行、审核员一行）
- `pages/Annotator/AnnotatorDashboard.tsx` 待标任务卡：右侧加「审核员：@李四」chip
- `pages/Reviewer/ReviewerDashboard.tsx` 待审批次：左下加 annotator 头像组
- `pages/Workbench/shell/Topbar.tsx`：当前 task 右上加「标注 @张三 · 审核 @李四」胶囊

**验证**：分派 batch 后刷新 ProjectsPage，相应卡片头像组显示；分派 task 后 Workbench 顶部胶囊显示。

---

## 任务 3 · 标注框 audit 接入 + History tab

**后端 — 补 audit 打点**

`apps/api/app/services/annotation.py` 三处接 `AuditService.log()`，target_type="annotation"：

- `create()` (L17-50)：action=`annotation.create`，detail = `{ class_name, geometry_type, attributes }`
- `update()` (L93-115)：action=`annotation.update`，detail = `{ before: {class_name, attributes}, after: {…}, version }`，仅记发生变化的字段
- `delete()` (L84-91)：action=`annotation.delete`，detail = `{ soft: true }`

`apps/api/app/services/annotation_comment.py` 的 create/delete 也补 `annotation.comment_add` / `annotation.comment_delete`。

`apps/api/app/services/audit.py` 已存在 `log()` / `log_many()`，无需新增工具。

**新增端点**：`GET /annotations/{annotation_id}/history` —— 返回该 annotation 的合并时间线：
- audit_logs 中 `target_type='annotation' AND target_id=:id`
- 该 annotation 上的 `annotation_comments`（统一映射成 `{ kind: "comment", actor, created_at, body }`）
- 关联 task 的 `task.approve` / `task.reject` 事件（按 `task_id` 汇入，标注框最终命运依赖 task 审核结果）
- 按 `created_at` 升序合并

**前端 — Workbench History tab**

- `apps/web/src/pages/Workbench/shell/CommentsPanel.tsx`：把现有内容包到 `<Tabs>`（评论 / 历史），评论保留原行为。
- 新建 `components/AnnotationHistoryTimeline.tsx`：纵向时间线（圆点 + actor + 动作 + diff 缩略 + 相对时间），不同 kind 用 Badge variant 区分（create=accent、update=neutral、approve=success、reject=danger、comment=secondary）。
- 新增 `apps/web/src/hooks/useAnnotationHistory.ts`（**注意命名冲突**：现有 `pages/Workbench/state/useAnnotationHistory.ts` 是本地 undo/redo 栈；新文件放 `hooks/`，命名为 `useAnnotationAuditHistory` 避免冲突）。

**验证**：在工作台改某个框的类别 → 切到「历史」tab → 看到 `张三 改类别 车 → 卡车 · 10:25`；reviewer 通过 task 后历史加新行 `李四 通过审核`。

---

## 任务 4 · 全局搜索 ⌘K Palette

**后端**

新建 `apps/api/app/api/v1/search.py`：`GET /search?q=...&limit=5`，返回：

```json
{ "projects": [...], "tasks": [...], "datasets": [...], "members": [...] }
```

每类调现有 service 的 search 方法：
- 项目：`ProjectsService.list()` 已支持 `search`（apps/api/app/api/v1/projects.py:116）
- 数据集：`DatasetService.list()` 已支持 `search`（apps/api/app/api/v1/datasets.py:37）
- 任务：补 `TaskService.search_by_id_prefix()`（按 task display_id 前缀匹配）
- 成员：复用 `UserService.list()`，加 `search` 参数（`User.name.ilike` + `User.email.ilike`）

权限：每个分类各自走 `_visible_*_filter` —— 只返回当前用户可见范围。

**前端**

- 新建 `apps/web/src/components/CommandPalette.tsx`：基于现有 `Modal` + 内部 list，键盘 ↑↓ 切换 / ↵ 跳转 / Esc 关闭。
- `apps/web/src/layouts/MainLayout.tsx`（或 TopBar 父级）注册全局 `keydown` 监听：`(e.metaKey || e.ctrlKey) && e.key === 'k'` → 打开 palette。
- TopBar `SearchInput` 点击时也打开 palette（替代当前死的占位）。
- 新增 `apps/web/src/api/search.ts` + `hooks/useGlobalSearch.ts`，debounce 200ms。

**验证**：任意页面按 ⌘K → 弹 palette → 输入「标识」→ 看到项目/任务/数据集/成员分组结果 → ↵ 跳转到选中项详情。

---

## 任务 5 · Dashboard 高级筛选面板 + 网格视图

**后端 GET /projects 扩展**（`apps/api/app/api/v1/projects.py`）：

- `type`（多值）：按 `Project.dimension`（已有列）过滤
- `member_id`：JOIN `project_members` WHERE `user_id = :member_id`
- `created_from` / `created_to`：`Project.created_at` 区间
- `status` 已支持，无需改

**前端**

- `pages/Dashboard/DashboardPage.tsx:278` 「筛选」按钮 onClick → 打开 `<FilterDrawer>`：
  - 类型 multi-select（chip 列表）
  - 成员 picker（复用 `UserPicker.tsx`）+「我参与的」快捷
  - 时间区间（用原生 `<input type="date">` × 2，省得新加 datepicker 依赖）
  - 状态选项也并入面板，把现有 TabRow 状态筛选与 drawer 同步（共用同一份 url state）
- 「网格视图」按钮 onClick → 切换 `viewMode` 状态（`useSearchParams` 写 `view=grid|list`）
- 新建 `pages/Dashboard/ProjectGrid.tsx`：响应式 3 列卡片网格，复用现有 `ProjectRow` 拆出来的 cell（项目名 / 状态 / 进度 / 责任人头像组 / 数量），与 list 视图共享数据 hook
- url 同步所有筛选参数，便于刷新与分享

**验证**：选择「类型 = image-det + 成员 = 张三 + 创建时间近 7 天」→ 列表只剩匹配项目；切换网格视图后筛选保持。

---

## 关键复用资源

| 资源 | 路径 |
|---|---|
| `Avatar` / `Badge` | `apps/web/src/components/ui/Avatar.tsx` / `Badge.tsx` |
| 头像 stack 现样式参考 | `BatchesSection.tsx:177-223`（抽成通用 `AssigneeAvatarStack`） |
| `UserPicker` | `apps/web/src/components/UserPicker.tsx` |
| `Modal` / `DropdownMenu` | `apps/web/src/components/ui/` |
| `AuditService.log/log_many` | `apps/api/app/services/audit.py:62-139` |
| `useSearchParams` | react-router-dom，已用于 wizard `?new=1` |
| `_visible_project_filter` | `apps/api/app/api/v1/projects.py:34-43` |
| `_serialize_project` 含批次概览 | `apps/api/app/api/v1/projects.py`（批次 GROUP BY 单查询，扩字段时复用） |

## 数据库迁移

- 无需 schema 变更。`audit_logs` 字段已够；assignee 序列化只补响应层 schema；筛选用现有列。
- 唯一例外是若任务 4 的「截止时间」需求落地需补 `Project.due_date` —— 本计划中**不补**，仅按 `created_at` 过滤；如后续要 due_date 再单独迁移。

## 测试

后端 pytest：
- `test_batch_distribute_even`：3 人 10 任务的圆周分配
- `test_annotation_audit_trail`：create/update/delete 各产出 1 条 audit
- `test_search_endpoint_visibility`：B 用户搜不到 A 项目的 task
- `test_projects_filter_by_member`：member_id 过滤生效

前端 vitest：
- `AnnotationHistoryTimeline.test.tsx`：合并 5 类事件按时间排序
- `CommandPalette.test.tsx`：⌘K 触发 + ↑↓ 导航 + ↵ 跳转

E2E（手动）：登录 → 创建项目 → 分派 batch（含均匀分派）→ 看到头像组 → 改 annotation 类别 → History tab 出新行 → ⌘K 跳到另一项目 → 高级筛选切网格视图。

## PR 拆分

- **PR-1（治理可视化）**：任务 1 + 2 + 3
- **PR-2（全局导航）**：任务 4 + 5

合并后写 v0.7.2 CHANGELOG 条目并更新 ROADMAP「全局搜索 / Dashboard 高级筛选 / 批次智能分派 / 责任人可视化 / 标注历史」5 个条目移入已完成。
