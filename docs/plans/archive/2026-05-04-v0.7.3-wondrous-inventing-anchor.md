# 批次状态机扩展 + 多选批量操作 + 操作历史

## Context

当前批次状态机（`apps/api/app/db/enums.py:27-34`）是严格单向流转：`draft → active → annotating → reviewing → {approved, rejected} → archived`，仅 `rejected → active` 一条逆向边。Owner / 超管在误操作（错归档、漏审、误判）时**没有任何兜底路径**，只能走数据库直改，运维成本高且无审计。

同时 `BatchesSection.tsx` 仅支持单批次按钮操作；项目尾期清理、跨批次调岗、统一激活 draft 等场景下，操作员要点几十下，是已被反复反馈的痛点。

本次目标：

1. 引入 **3 条 Owner/超管专属逆向迁移**，附带数据一致性副作用与审计
2. 引入 **4 项多选批量操作**（归档 / 删除 / 改派 / 激活）
3. 复用现有 `AuditService` 串通**批次操作历史抽屉**，把现有零散的 audit 事件可视化

不在本期范围（写入 ROADMAP）：`* → draft` 终极重置、`annotating → active` 暂停（需 task 联动复位 + 调度器锁，复杂度独立成项）。

---

## 范围与决策

### A. 逆向迁移（3 条）

| From → To | 触发权限 | task 联动 | 字段清理 | 通知 |
|-----------|----------|-----------|----------|------|
| `archived → active` | Owner / 超管 | 不动 | 无 | 给 annotator + reviewer 发 `batch.unarchived` |
| `approved → reviewing` | Owner / 超管 | 不动 | 清空 `reviewed_at` / `reviewed_by` / `review_feedback` | 给 reviewer 发 `batch.review_reopened` |
| `rejected → reviewing` | Owner / 超管 | 不动（保留 pending 中的旧标注） | 不清反馈（reviewer 复审需看上次原因） | 给 reviewer 发 `batch.review_reopened` |

每次逆向迁移**强制要求 reason**（1-500 字），写入 `audit_log.detail_json.reason`。

### B. 批量操作（4 项）

| 操作 | 端点 | 权限 | 失败模式 |
|------|------|------|----------|
| 批量归档 | `POST /batches/bulk-archive` | Owner / 超管 | per-batch 结果列表（已 archived 的算 skipped） |
| 批量删除 | `POST /batches/bulk-delete` | Owner / 超管 | B-DEFAULT 必跳过；task 接管沿用单个删除策略 |
| 批量改派 | `POST /batches/bulk-reassign` | Owner / 超管 | 全量原子 |
| 批量激活 draft | `POST /batches/bulk-activate` | Owner / 超管 | per-batch 结果（无 annotator / 0 task → failed，原因写入返回） |

统一返回结构（参照 `distribute-batches` 的风格）：

```python
class BulkBatchActionResponse(BaseModel):
    succeeded: list[uuid.UUID]
    skipped: list[BulkBatchActionItem]   # {batch_id, reason}
    failed: list[BulkBatchActionItem]    # {batch_id, reason}
```

### C. 操作历史抽屉

复用现有 `AuditService` + `AuditLog` 表（`apps/api/app/services/audit.py`、`apps/api/app/db/models/audit_log.py`）。

- 新增 `GET /batches/{batch_id}/audit-logs?limit=50` 端点：按 `target_type='batch' AND target_id={id}` 过滤，倒序返回
- 抽屉入口：`BatchesSection.tsx` 行操作区加「📜」图标按钮，所有角色可点（与 `AuditLog.detail_json` 中敏感信息无关）
- 渲染：时间 / 操作人（昵称+角色徽章）/ 动作（i18n 映射）/ 详情（JSON 折叠）

---

## 实现计划

### 阶段 1：后端 — 逆向迁移

**修改 `apps/api/app/services/batch.py`**

1. `VALID_TRANSITIONS`（`:24-31`）增加 3 条：
   ```python
   BatchStatus.ARCHIVED: {BatchStatus.ACTIVE},
   BatchStatus.APPROVED: {BatchStatus.ARCHIVED, BatchStatus.REVIEWING},
   BatchStatus.REJECTED: {BatchStatus.ACTIVE, BatchStatus.ARCHIVED, BatchStatus.REVIEWING},
   ```

2. `assert_can_transition()`（`:53-96`）增加分支：
   ```python
   REVERSE_TRANSITIONS = {
       (BatchStatus.ARCHIVED, BatchStatus.ACTIVE),
       (BatchStatus.APPROVED, BatchStatus.REVIEWING),
       (BatchStatus.REJECTED, BatchStatus.REVIEWING),
   }
   if (from_status, to_status) in REVERSE_TRANSITIONS:
       if not _is_owner(user, project):
           raise PermissionError(...)
       if not reason:
           raise ValueError("reason required for reverse transition")
   ```

3. 新增辅助 `clear_review_metadata(batch)`：清空 `reviewed_at` / `reviewed_by` / `review_feedback`，仅在 `approved → reviewing` 调用。

**修改 `apps/api/app/api/v1/batches.py`**

4. `/transition` 端点（`:154`）请求体增加可选字段 `reason: str | None`；当迁移属于 REVERSE_TRANSITIONS 时校验非空 + 长度 1-500。
5. 调用 `audit.log()` 时把 `reverse=True, reason=...` 写入 `detail_json`。

**修改 `apps/api/app/services/notification.py` 调用方**

6. 在 transition 端点根据迁移方向分发：
   - `→ active` 且 from=archived：通知 annotator + reviewer，type=`batch.unarchived`
   - `→ reviewing` 且 from in {approved, rejected}：通知 reviewer，type=`batch.review_reopened`

**调度器风险**

`scheduler.check_auto_transitions()`（`scheduler.py:553-580`）在 `archived → active` 后会因 task 仍是 `pending/in_progress/review` 把 batch 立刻推到 `annotating` 或 `reviewing`。这是**期望行为**：admin 撤销归档后由调度器接管自然回到正确阶段。无需额外加锁。

### 阶段 2：后端 — 批量操作

**新增 `apps/api/app/services/batch.py` 服务函数**

7. `bulk_archive(session, project_id, batch_ids, actor)` — 逐个调 `transition(..., archived)`，捕获失败收集到 result。已 archived 算 skipped。
8. `bulk_delete(session, project_id, batch_ids, actor)` — 逐个调用现有删除逻辑，B-DEFAULT 跳过。
9. `bulk_reassign(session, project_id, batch_ids, annotator_id, reviewer_id, actor)` — 单事务内更新所有匹配批次的 `annotator_id` / `reviewer_id`（任一可为 None 表示不改）。原子。
10. `bulk_activate(session, project_id, batch_ids, actor)` — 逐个 transition `draft → active`，前置失败（无 annotator / 0 task）收集到 failed。

**新增 `apps/api/app/api/v1/batches.py` 端点**

11. 4 个 `POST /batches/bulk-*` 端点，统一 `require_project_owner` 依赖，统一返回 `BulkBatchActionResponse`。
12. 每个端点写一条聚合 audit：`action=BULK_*, target_type='project', target_id=project_id, detail_json={batch_ids, succeeded, failed, skipped}`。新增 `AuditAction.BULK_BATCH_ARCHIVE / DELETE / REASSIGN / ACTIVATE`。

### 阶段 3：后端 — 审计端点

13. 新增 `GET /batches/{batch_id}/audit-logs` —— 单文件改动，依赖 `require_project_visible`。

### 阶段 4：前端 — 多选 + 批量按钮

**修改 `apps/web/src/api/batches.ts`**

14. 新增 4 个 bulk API 方法 + `getAuditLogs(projectId, batchId)` + `transition()` 增加可选 `reason` 参数。

**修改 `apps/web/src/pages/Projects/sections/BatchesSection.tsx`**

15. 表头第一列加全选 Checkbox，每行加多选 Checkbox。`selectedIds: Set<string>` 用 `useState`，参考 `useWorkbenchState.ts:44-51` 的 `selectedIds` 模式但改用 Set 提速。
16. 选中后表格上方出现**浮层操作条**：`已选 N 条 | 归档 | 删除 | 改派 | 激活 | 取消选择`。仅 `useIsProjectOwner(project)` 为 true 时渲染浮层。
17. 各按钮点击弹现有风格的确认 Modal（参考 `RejectBatchModal`）：
    - **归档 / 删除 / 激活**：仅二次确认 + 调 API
    - **改派**：复用 `BatchAssignmentModal` 风格做一个 `BulkReassignModal`，单选 annotator + 单选 reviewer
18. 操作完成后展示「成功 N / 跳过 M / 失败 K（点击展开原因）」，沿用 `useToastStore` 的 toast，失败列表用 inline 折叠面板而非 toast。

### 阶段 5：前端 — 逆向迁移按钮 + 历史抽屉

19. `BatchesSection.tsx` 行操作区为 Owner 增加：
    - `archived` 行：「↩️ 撤销归档」
    - `approved` 行：「↩️ 重开审核」
    - `rejected` 行额外加：「↩️ 直接复审」（与现有「重新激活」并列）
    每个按钮点击弹「请填写原因」Modal（textarea 1-500 字），与 `RejectBatchModal` 同款。

20. 行操作区增加「📜」图标按钮 → 打开 `BatchAuditLogDrawer`（新组件，`apps/web/src/pages/Projects/sections/BatchAuditLogDrawer.tsx`）。

### 阶段 6：测试 + 文档

21. **后端测试**（`apps/api/tests/test_batch_lifecycle.py` 增补）：
    - 3 条逆向迁移：owner 成功 / 非 owner 拒绝 / 缺 reason 拒绝 / 字段清理正确
    - 4 个 bulk 端点：成功路径 + partial-success + 权限拒绝
    - 审计：每条逆向 + 每次 bulk 都生成 audit_log
22. **CHANGELOG** 增补本期条目；**ROADMAP.md** 写入延后项：「批次状态机增补：`* → draft` 终极重置、`annotating → active` 暂停（需调度器锁机制设计）」。

---

## 关键文件清单

**修改：**
- `apps/api/app/services/batch.py` — VALID_TRANSITIONS 表、auth 函数、bulk 服务、字段清理 helper
- `apps/api/app/api/v1/batches.py` — `/transition` 增加 reason、4 个 bulk 端点、audit logs 端点
- `apps/api/app/services/audit.py` — 新增 4 个 BULK_* AuditAction
- `apps/web/src/api/batches.ts` — bulk API + audit logs API + transition reason
- `apps/web/src/pages/Projects/sections/BatchesSection.tsx` — 多选 UI、浮层操作条、逆向按钮、抽屉入口
- `apps/api/tests/test_batch_lifecycle.py` — 测试增补
- `CHANGELOG.md`、`ROADMAP.md`

**新增：**
- `apps/web/src/pages/Projects/sections/BulkReassignModal.tsx`
- `apps/web/src/pages/Projects/sections/ReverseTransitionModal.tsx`（reason 输入复用）
- `apps/web/src/pages/Projects/sections/BatchAuditLogDrawer.tsx`

**复用（不改）：**
- `apps/api/app/services/audit.py:73` `AuditService.log()`
- `apps/api/app/services/notification.py:48-87` `notify_many()`
- `apps/api/app/services/scheduler.py:553-580` `check_auto_transitions()`（撤销归档后由它自动接管推进）
- `apps/web/src/components/ui/Toast.tsx` `useToastStore`
- `apps/web/src/hooks/useIsProjectOwner.ts`
- `apps/web/src/pages/Projects/sections/RejectBatchModal.tsx`（reason 输入风格参考）

---

## 验证

**单元/集成测试**

```bash
docker compose exec api pytest apps/api/tests/test_batch_lifecycle.py -v
```

必须覆盖：3 条逆向 × (success / non-owner reject / missing reason)；4 个 bulk × (success / partial / non-owner reject)。

**端到端手测（dev 环境）**

1. **逆向迁移**：以 super_admin 登录 → 找一个 archived 批次 → 点「撤销归档」→ 填原因「测试」→ 提交 → 列表刷新看到状态变 active；30 秒内（或新一次 task 操作触发后）调度器把它推回正确阶段；annotator / reviewer 收到通知。
2. **批量归档**：选 3 个 active 批次 → 浮层「归档」→ 确认 → toast「成功 3」→ 列表全部变 archived；audit_log 表多 1 条 BULK_BATCH_ARCHIVE 聚合记录 + 3 条 BATCH_STATUS_CHANGED。
3. **批量激活的 partial-success**：选 2 个 draft（一个有 annotator+task，一个没有）→ 浮层「激活」→ 看到「成功 1 / 失败 1」，失败原因为「未指派标注员或任务为空」。
4. **改派**：选 5 个跨状态批次 → 浮层「改派」→ 选新 annotator → 提交 → 5 个批次的 `annotator_id` 同步更新；annotator workbench 列表能立刻看到。
5. **历史抽屉**：任意批次点「📜」→ 抽屉展示完整事件流（创建 / 状态迁移 / 拒绝 / 改派 / 归档），含上述操作的 reason 字段。

**回归**

- 旧的单批次按钮路径全部不受影响（手测：创建 → 激活 → 提交 → 通过 → 归档）
- 标注员、质检员的工作台可见性矩阵无变化（`scheduler.py:23-57` `batch_visibility_clause` 未改）
