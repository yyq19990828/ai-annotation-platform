# 0008 — 批次 admin-locked 字段（soft hold，与状态机正交）

- **Status:** Accepted（实施完成于 v0.9.15，2026-05-11）
- **Date:** 2026-05-06
- **Deciders:** core team
- **Supersedes:** —

## Context

当前仓库里的批次状态机已经不是最初的 7 态，而是 8 态：

`draft → active → pre_annotated → annotating → reviewing → {approved, rejected} → archived`

其中真正会“自动推状态”的代码只有两处，且都在 `BatchService.check_auto_transitions`：

- `active | pre_annotated → annotating`：batch 内任一 task 进入 `in_progress` / `rejected`
- `annotating → reviewing`：batch 内不再存在 `pending` / `in_progress` / `rejected`

对应实现见：

- `apps/api/app/services/batch.py`
- `apps/api/app/db/enums.py`

问题仍然存在：项目 owner 想“临时叫停一个批次”时，单改 `batch.status = active` 没有意义。下一次 task 写入或下一次调度，`check_auto_transitions` 又会把它推回 `annotating`。

但仓库审查后可以确认，原 ADR 把“暂停”的落地范围写得过满了。当前真实入口至少有 4 类：

- 自动状态推进：`BatchService.check_auto_transitions`
- 下一题派发：`apps/api/app/services/scheduler.py:get_next_task`
- 任务可见性：`GET /tasks`、`GET /tasks/{id}` 只按 `batch.status` 做过滤
- 标注写入：`AnnotationService._update_task_stats` 会把 `task.status` 从 `pending` 推到 `in_progress`

因此，“只给 batch 加一个 bool，再在 `check_auto_transitions` 里短路”只能解决**状态被自动改回去**的问题，不能自动等价为“严格暂停整批工作”。

## Decision

引入 batch 级 `admin_locked` 维度，但**把本 ADR 明确定义为 soft hold，而不是 hard pause**。

本 ADR 在 v0.9.x 只承诺 3 件事：

1. **冻结 batch 自动状态推进**
   `check_auto_transitions` 遇到 `admin_locked=True` 直接返回，不再自动改 `batch.status`。
2. **阻断 `/tasks/next` 新派单**
   `scheduler.get_next_task` 不再从 `admin_locked=True` 的 batch 里选新任务。
3. **暴露可审计的锁元数据**
   owner / super_admin 可以锁定 / 解锁批次，前后端都能读取锁状态、锁定人、锁定时间、锁定原因。

反过来说，本 ADR **不承诺**下面这些“严格暂停”语义：

- 不保证 `GET /tasks` / `GET /tasks/{id}` 自动隐藏已锁批次的任务
- 不保证 annotation 写接口只允许“已在做的人继续做”
- 不保证 task 级锁与 batch admin lock 联动
- 不把已 `in_progress` 的 task 复位到 `pending`

如果产品最终要的是“暂停后任何新进入者都不能打开 / 编辑该 batch，只允许现有会话收尾”，那是另一个更重的设计题，需单独收敛任务可见性、task lock 归属校验和 annotation 写门禁；**不在本 ADR 范围内**。

## Data Model

在 `task_batches` 增加 4 个字段：

```sql
ALTER TABLE task_batches
    ADD COLUMN admin_locked BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN admin_lock_reason VARCHAR(500) NULL,
    ADD COLUMN admin_locked_at TIMESTAMPTZ NULL,
    ADD COLUMN admin_locked_by UUID NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX ix_task_batches_admin_locked
    ON task_batches(admin_locked)
    WHERE admin_locked = TRUE;
```

说明：

- `admin_lock_reason` 必须落库。只写 audit 不足以支撑批次列表 / 详情 tooltip。
- 不新增 `paused_status` 之类枚举，避免把“业务状态”和“管理开关”混成一个维度。

## API Contract

沿用现有批次路由风格，新增两个 owner 端点：

- `POST /projects/{project_id}/batches/{batch_id}/admin-lock`
- `POST /projects/{project_id}/batches/{batch_id}/admin-unlock`

权限与现有 `require_project_owner` 对齐：仅 `super_admin` 或项目 owner。

请求 / 响应约束：

- `admin-lock`：body `{"reason": "..."}`，`reason` 必填，1-500 字
- `admin-unlock`：无 body
- 重复 lock 已锁批次 / 重复 unlock 未锁批次返回 `409`

`BatchOut` 需新增：

- `admin_locked: bool`
- `admin_lock_reason: str | null`
- `admin_locked_at: datetime | null`
- `admin_locked_by: UUID | null`

前端如果要显示“由谁锁定”，可先复用 ID；是否补 `UserBrief` 不在本 ADR 强制要求。

## Service Changes

### 1. Batch auto transition

`apps/api/app/services/batch.py`

```python
async def check_auto_transitions(self, batch_id: uuid.UUID | None) -> None:
    if not batch_id:
        return
    batch = await self.db.get(TaskBatch, batch_id)
    if not batch or batch.admin_locked:
        return
    # existing logic...
```

### 2. Task dispatch

真实派单入口是 `apps/api/app/services/scheduler.py:get_next_task`，不是旧 ADR 里写的 `BatchAssignmentService`。

candidate query 需要补一条：

```python
TaskBatch.admin_locked.is_(False)
```

这样 `/tasks/next` 不会继续把新任务送进已锁批次。

### 3. Batch mutations

`apps/api/app/api/v1/batches.py` 增加 lock / unlock 端点，并做：

- 字段写入
- `AuditService.log(...)`
- `NotificationService.notify_many(...)`

### 4. Read model

`apps/api/app/db/models/task_batch.py` 和 `apps/api/app/schemas/batch.py` 同步暴露新增字段。

## Audit And Notifications

原 ADR 里写的 `BATCH_ADMIN_LOCK`、`NotifType.BATCH_ADMIN_LOCK` 都不是现仓已有抽象。

按当前代码风格，新增两条 audit action：

- `batch.admin_lock`
- `batch.admin_unlock`

通知继续走字符串 type，建议：

- `batch.admin_locked`
- `batch.admin_unlocked`

通知接收方先收紧到最小可用集合：

- 批次 `annotator_id`
- 批次 `reviewer_id`
- 当前项目 owner（如与操作者不同）

是否 fan-out 到“项目所有成员”不是本 ADR 必需项。

## Frontend Impact

`BatchesSection` 当前已有批量归档 / 激活 / 改派 / 删除，但没有 lock / unlock。

本 ADR 对前端的最小要求是：

- 批次行显示 locked 徽标
- owner 看到“锁定 / 解锁”按钮
- 调新端点后刷新 `useBatches(project.id)` 缓存

批量锁 / 解锁不在本 ADR 范围；先把单批次链路打通。

## Verification Plan

实施时至少补以下测试：

1. `apps/api/tests/test_batch_lifecycle.py`
   验证 owner 可 lock / unlock，非 owner `403`，重复操作 `409`，audit / notification 落地。
2. `BatchService.check_auto_transitions`
   验证 `admin_locked=True` 时，`active -> annotating` / `annotating -> reviewing` 都不会发生。
3. `scheduler.get_next_task`
   验证 locked batch 中的 task 不会被 `/tasks/next` 选中。
4. `BatchOut`
   验证列表 / 详情 API 返回新增锁字段。

注意：当前仓库已经有 `test_batch_lifecycle.py`、`test_v0_7_6.py`、`test_batch_pre_annotated.py` 覆盖状态机主干，所以本版要补的是 **admin_locked 增量覆盖**，不是从零补 scheduler 测试。

## Consequences

正向：

- 解决“owner 改回 active 后又被自动推回 annotating”的核心问题
- 保持 `BatchStatus` 枚举稳定，不扩大状态机基数
- 落地成本可控，且与当前代码结构一致

负向：

- 这只是 **soft hold**，不是严格意义上的“全链路暂停”
- 若后续要禁止手动打开 locked batch 的 task，还需继续改 `GET /tasks`、`GET /tasks/{id}`、task lock 和 annotation 写路径
- 需要同步修正文档，避免用户手册继续把“暂停 / 恢复”写成已上线能力

## Alternatives Considered

### A. 新增 `PAUSED` 枚举值

不选。原因不变：暂停语义是管理开关，不是业务推进状态；塞进 `BatchStatus` 会污染现有查询和前端看板。

### B. 一次性做 hard pause

暂不选。按现仓结构，这会同时牵涉：

- task 可见性查询
- task lock 归属判定
- annotation 写门禁
- 现有“开始标注即自动把 pending 推成 in_progress”的副作用

这已经不是“加一个 batch 字段”的量级，单独开 ADR 更清楚。

### C. 锁批次时把 `in_progress` task 全部复位到 `pending`

不选。它会直接踢断现场工作，而且与“暂停不丢上下文”的运营诉求冲突。

## Notes

不在本 ADR 范围：

- 批量 lock / unlock
- 自动超时解锁
- locked batch 的严格只读 / 不可见语义
- 为 `admin_locked_by` 补 `UserBrief` 展示层优化

引用：

- `apps/api/app/services/batch.py`
- `apps/api/app/services/scheduler.py`
- `apps/api/app/services/annotation.py`
- `apps/api/app/api/v1/batches.py`
- `apps/api/app/schemas/batch.py`

## 实施细节（v0.9.15，2026-05-11）

### 关键文件

| 文件 | 变更 |
|---|---|
| `apps/api/alembic/versions/0055_batch_admin_lock.py` | Migration：4 列 + 部分索引 |
| `apps/api/app/db/models/task_batch.py` | 4 mapped_column |
| `apps/api/app/schemas/batch.py` | BatchOut 4 字段 + AdminLockRequest + BulkBatchApprove/Reject |
| `apps/api/app/services/batch.py` | admin_lock/unlock + bulk_approve/reject + check_auto_transitions 短路 |
| `apps/api/app/services/scheduler.py` | 候选查询加 `admin_locked.is_(False)` |
| `apps/api/app/services/audit.py` | 4 AuditAction：batch.admin_lock/unlock、batch.bulk_approve/reject |
| `apps/api/app/api/v1/batches.py` | 4 端点：admin-lock/unlock、bulk-approve/reject |
| `apps/api/tests/test_scheduler.py` | 新建：19 个 scheduler 测试（Phase 1 门控） |
| `apps/api/tests/test_batch_lifecycle.py` | TestAdminLock（10 cases）+ TestBulkApproveReject（8 cases） |
| `apps/web/src/api/batches.ts` | 4 字段 + 4 API 方法 |
| `apps/web/src/hooks/useBatches.ts` | 4 hooks |
| `apps/web/src/pages/Projects/sections/BatchesSection.tsx` | lock/unlock 按钮 + badge + bulk approve/reject 操作栏 |
| `apps/web/src/pages/Projects/sections/AdminLockModal.tsx` | 新建 |
| `apps/web/src/pages/Projects/sections/BulkRejectModal.tsx` | 新建 |

### 同时完成的 bulk-approve/reject（Phase 3）

v0.9.15 同步实施了 bulk approve/reject，权限为 reviewer 级（reviewer / project_admin / super_admin）：

- `POST /projects/{project_id}/batches/bulk-approve`：reviewing → approved，locked 批次 fail gracefully
- `POST /projects/{project_id}/batches/bulk-reject`：reviewing → rejected + 任务软重置（review/completed → pending）+ 共享 feedback

audit actions：`batch.bulk_approve`、`batch.bulk_reject`

### 测试覆盖

```
pytest apps/api/tests/test_scheduler.py -v    # 19 passed
pytest apps/api/tests/test_batch_lifecycle.py::TestAdminLock -v    # 10 passed
pytest apps/api/tests/test_batch_lifecycle.py::TestBulkApproveReject -v  # 8 passed
pnpm --filter web exec vitest run  # 435 passed
```
