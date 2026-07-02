# Plan：标注 / 审核流程任务锁定

## Context

当前 task 状态机已存在 `pending → in_progress → review → completed` 五态（`apps/api/app/db/enums.py:19-24`），但**形同虚设**：
- 后端：`PATCH /tasks/{id}/annotations/...` 等编辑端点不检查 status；`POST /submit` 无防重；approve/reject 不写 `reviewer_id` / `reviewed_at`；reject reason 不持久化；无 audit。
- 前端：`ImageStage` (`stage/ImageStage.tsx:42`) 与 `AttributeForm` (`shell/AttributeForm.tsx:11`) 已有 `readOnly` prop，但 `WorkbenchShell` **从未根据 task.status 传递**；`handleDeleteBox` / `handleCommitMove` / `handleCommitResize` 在 `useWorkbenchAnnotationActions.ts` 也无任何 status guard。
- 无「撤回」与「重开」端点。

需求（用户确认）：
1. 标注员提交质检后 task 锁定；可"撤回"（仅在审核员未介入时）。
2. 审核员通过后 task 锁定；标注员可单方面"继续编辑"重开。
3. 重开/退回时 annotations 原地修改，不留快照（依赖现有 audit_logs 回溯）。

目标：让现有状态机真正生效，加上"撤回"和"重开"两条逆向路径，前后端编辑全链路防护，并补全审计 / 通知打点。

---

## 状态机（最终）

```
pending ──assign──▶ in_progress ──submit──▶ review ──approve──▶ completed
                         ▲                    │                    │
                         │                    │                    │
                         ├────withdraw────────┤  (reviewer 未 claim 才允许)
                         │                    │
                         ├────reject──────────┘  (持久化 reject_reason)
                         │
                         └────reopen──────────── (从 completed)
```

锁定语义：`status ∈ {review, completed}` → 标注员 readOnly + 编辑端点 403。

---

## 后端改造

### 1. Task 模型字段（`apps/api/app/db/models/task.py`）

新增 7 个字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `submitted_at` | `datetime \| null` | 最近一次 submit 时间 |
| `reviewer_id` | `UUID \| null` (FK users) | 第一个 claim 此任务的 reviewer，approve/reject 后保持 |
| `reviewer_claimed_at` | `datetime \| null` | 用于"撤回"门控 |
| `reviewed_at` | `datetime \| null` | approve/reject 落定时间 |
| `reject_reason` | `text \| null` | reject 时持久化（当前 reason 参数被丢弃） |
| `reopened_count` | `int default 0` | 重开次数 |
| `last_reopened_at` | `datetime \| null` | 最近一次 reopen 时间 |

withdraw / reopen 时清空 `reviewer_id` / `reviewer_claimed_at` / `reviewed_at` / `reject_reason`，回到 `in_progress`。

**Alembic migration**：新建一个 revision 加这 7 列 + `reviewer_id` FK。无数据回填。

### 2. AuditAction 枚举（`apps/api/app/db/models/audit_log.py`）

新增 6 个事件：`task_submit` / `task_withdraw` / `task_review_claim` / `task_approve` / `task_reject` / `task_reopen`。每个都通过 `services/audit.py` 写一行；reject 把 `reject_reason` 写进 detail。

### 3. 端点（`apps/api/app/api/v1/tasks.py`）

| 方法 | 路径 | 说明 |
|---|---|---|
| 改 | `POST /{task_id}/submit` | 加防重：status 必须 `in_progress` 否则 409；写 `submitted_at`；清空 reviewer_*；写 audit |
| **新** | `POST /{task_id}/withdraw` | 标注员撤回。前提：`status=review` AND `reviewer_claimed_at IS NULL` AND 当前用户 = `assignee_id`；否则 409；改回 `in_progress`；写 audit |
| **新** | `POST /{task_id}/review/claim` | reviewer 进入审核页时调用（幂等）。前提：`status=review`；写 `reviewer_id` + `reviewer_claimed_at`（若已被他人 claim 则返回当前 reviewer 信息但不覆盖）；写 audit |
| 改 | `POST /{task_id}/review/approve` | 写 `reviewer_id`（若未 claim 则用当前 user）+ `reviewed_at`；写 audit |
| 改 | `POST /{task_id}/review/reject` | 持久化 `reject_reason`；写 `reviewer_id` + `reviewed_at`；写 audit；回 `in_progress` |
| **新** | `POST /{task_id}/reopen` | 标注员重开。前提：`status=completed` AND 当前用户 = `assignee_id`；改回 `in_progress`；`reopened_count++`；写 `last_reopened_at`；清 reviewer_*（保留以前的 reviewer_id 用于通知，先读再清）；写 audit；触发通知给原 reviewer |

### 4. 编辑端点 status guard

抽一个 helper `assert_task_editable(task)` 放在 `services/tasks.py`，内部：

```
if task.status in ("review", "completed"):
    raise HTTPException(409, "task_locked", detail={"status": task.status})
```

挂到所有写入 annotation / 属性的端点入口（`apps/api/app/api/v1/annotations.py` 的 POST / PATCH / DELETE / 批量编辑）。

### 5. 通知（`apps/api/app/services/notifications.py`，若已存在则复用）

- `task_rejected` → 通知 assignee
- `task_approved` → 通知 assignee
- `task_reopened` → 通知原 reviewer（若 `reviewer_id` 非空）
- `task_submitted` → 通知项目内 reviewer 角色（项目级广播，可复用现有邀请 / 待审清单的 query）

---

## 前端改造

### 1. WorkbenchShell（`apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`）

- 计算 `const isLocked = task?.status === "review" || task?.status === "completed"`
- 传给 `<ImageStage readOnly={isLocked} />`（line 730 附近）和所有 `<AttributeForm readOnly={isLocked} />`
- topbar 下方加锁定横幅（条件渲染）：
  - `status=review`：「已提交质检 · 等待审核」+ `[撤回提交]` 按钮（仅在 `reviewer_claimed_at == null` 显示，否则灰文案"审核员已介入，无法撤回"）
  - `status=completed`：「审核通过 · 已锁定」+ `[继续编辑]` 按钮

### 2. useWorkbenchAnnotationActions（`apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts`）

入口加 guard：`handleDeleteBox`、`handleCommitMove`、`handleCommitResize`、`handleCommitPolygonGeometry`、`optimisticEnqueueCreate` 全部 `if (isLocked) { pushToast({msg:"任务已锁定", kind:"warning"}); return; }`。`isLocked` 通过 hook 入参或从 store 读。

### 3. TaskQueuePanel（`apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx:73`）

`status === "review" || "completed"` 时，标注数 Badge 旁加 Lock icon（lucide-react）+ tooltip。

### 4. 新 hooks（`apps/web/src/hooks/useTasks.ts`）

加 `useWithdrawTask` / `useReopenTask`，与现有 `useSubmitTask` / `useApproveTask` 同模板，invalidate `tasks` query。

### 5. ReviewWorkbench（`apps/web/src/pages/Review/ReviewWorkbench.tsx`）

进入时（`useEffect` on mount）调 `tasksApi.reviewClaim(taskId)`（幂等）。响应里返回的 `reviewer_id` 不等于当前 user → 顶部提示"已被 X 认领"（仍允许接力，但提醒）。

### 6. ReviewPage 通过 / 退回反馈

reject 表单加 reason 必填校验（当前 ReviewPage:141-197 已有 reason 字段，确保上送）。

---

## 关键文件改动清单

后端：
- `apps/api/app/db/models/task.py` — +7 字段
- `apps/api/alembic/versions/<new>_task_lock_fields.py` — 新 migration
- `apps/api/app/db/models/audit_log.py` — AuditAction +6 项
- `apps/api/app/api/v1/tasks.py` — 改 submit/approve/reject + 新 withdraw/review-claim/reopen
- `apps/api/app/api/v1/annotations.py` — 所有写端点接 `assert_task_editable`
- `apps/api/app/services/tasks.py` — 新 `assert_task_editable` helper
- `apps/api/app/services/notifications.py` — 4 个事件类型
- `apps/api/tests/test_task_lock.py` — 新增

前端：
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` — 计算 isLocked + 横幅 + 传 readOnly
- `apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts` — guard
- `apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx` — Lock icon
- `apps/web/src/pages/Review/ReviewWorkbench.tsx` — claim on mount
- `apps/web/src/hooks/useTasks.ts` — useWithdraw / useReopen
- `apps/web/src/api/tasks.ts`（或 codegen 后端 schema）— 新端点 client
- 跑 `pnpm codegen` 同步 OpenAPI schema

---

## 已存在可复用的工具

- `useToastStore.push()`（`components/ui/Toast.tsx:18`）— 锁定提示直接复用
- `TaskLockService.release()`（已有，`services/task_lock.py`）— 提交时释放编辑锁的逻辑保持
- `services/audit.py` 的 `log` / `log_many`（v0.6.3 后基线）— 状态流转打点
- `ImageStage.readOnly` / `AttributeForm.readOnly`（已实现，无需改）
- `useToastStore` warning kind 4.5s TTL — 锁定 reject 提示语

---

## 验证

后端（pytest 新增 `test_task_lock.py`）：
1. 状态流转：assign → submit (201, status=review) → withdraw (200, status=in_progress) → submit → review-claim (200) → withdraw (409 task_already_claimed) → approve (200, status=completed) → reopen (200, status=in_progress, reopened_count=1)
2. 编辑拦截：status=review 时 PATCH annotation → 409 task_locked
3. 权限：非 assignee 调 withdraw / reopen → 403
4. reject 持久化：reject 后查 task 应有 `reject_reason`
5. audit：每个动作各产 1 条 audit_log，metadata 含 request_id

前端（手动 + vitest smoke）：
1. 标注员标完点提交 → topbar 出现"已提交质检"横幅 + 撤回按钮 → 画布所有交互失效（toast 提示）→ 点撤回 → 解锁
2. reviewer 打开同一任务 → 标注员侧撤回按钮变灰
3. reviewer approve → 标注员侧出现"审核通过"横幅 + 继续编辑按钮 → 点击 → 解锁，可重新提交
4. reject 走通：标注员看到 reject_reason

dev server 跑通：`docker compose up postgres redis minio`、`pnpm --filter api dev`、`pnpm --filter web dev`，浏览器跑一遍上面 4 步。
