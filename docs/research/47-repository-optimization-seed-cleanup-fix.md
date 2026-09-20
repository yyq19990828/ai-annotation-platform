# 仓库优化 P9 修复：owned seed 清理 500（deadlock 竞争）

> 完成日期：2026-09-20 · 隶属计划：`docs/plans/1789880018_repository-optimization-plan.md`（P9 owned 夹具清理 / P10 验证通道）
> 候选与分支：候选 `dc972be08a42855c836023da178487469aae2fc9`（P9 冻结候选）→ 本修复分支 `worktree-agent-opt-p9-cleanup-fix`
> 证据图例：**[V]** 本工作树/自有一次性环境实测；**[PG]** PostgreSQL 服务端日志原证；**[REUSE]** 对字节一致输入复用既有证据

## 0. 结论

1. **根因确认 [V][PG]**：失败测试**自身尚未结束的** `POST /annotations` 与 teardown 的 `POST /seed/owned-cleanup` 竞争。pointcloud/视频任务的标注创建会在事务内调用 `heartbeat_task_lock_for_legacy_video` → `TaskLockService.heartbeat`（`UPDATE task_locks`，`apps/api/app/api/v1/tasks/annotations.py:417`），而清理在 `DELETE task_locks` → `DELETE tasks` → `DELETE projects`/`datasets`/`users`。两个事务在 `task_locks`/`tasks` 上以相反顺序持有并请求锁，触发 PostgreSQL **deadlock**。服务端日志直接给出双方语句：`Process 961835: DELETE FROM tasks WHERE project_id = ANY($1)` ↔ `Process 961864: UPDATE task_locks SET expire_at=... WHERE task_locks.id=$2`；同一循环随后反复出现在 `DELETE projects`/`datasets`/`users`，并伴随级联 FK 报错（`tasks_project_id_fkey`、`project_members_user_id_fkey`）。
2. **为何表现为“清理残差”**：`_try_delete` 逐表吞掉异常；deadlock 使事务/该 DELETEs 回滚后，后续 DELETE 因前置级联未完成而继续失败并被吞掉，严格的 residual 守卫最终抛出 `e2e_seed_cleanup_incomplete`（`users:3, projects:2`）。也就是说 500 是**竞争的下游症状**，不是持久外键缺陷。
3. **隔离对照 [V]**：对保留的残差行集，在自有的字节副本上用**完全相同的清理代码与 HTTP 路由**执行返回 `200`、零 `seed_cleanup skip`；说明该行集本身可被清理，缺陷是竞争/时序。
4. **修复 [V]**（均在授权范围内，无 actor/seed API 重构）：
   - **测试生命周期（主因）**：`apps/web/e2e/tests/workbench-pointcloud-tools.spec.ts:379` 改为登记并 **await 匹配的 POST RESPONSE**，断言响应成功与持久化的 annotation `id`/`geometry`，同时保留原有 request-geometry 与双击断言。teardown 因此在该写入及其 task-lock heartbeat 完成后才运行，竞争消失。
   - **共享前缀越界**：owned 清理不再匹配共享 `BUG-E2E-FILTER-%` 前缀（`_test_seed.py`），该前缀只在 `owned is None` 的共享清理中使用，避免任一命名空间误删共享过滤夹具的 bug 行。
   - **命名空间化 takeover actor**：新增 `takeover-<namespace>@e2e.test`（仍经**真实 invite → register** 路径创建，见 `video-issue-context.spec.ts`），并纳入 `_OwnedFixtureScope.all_user_emails`，使**精确 owned 清理**删除它而不是把共享全局账号留给全局 teardown。
   - **fail-fast 诊断**：`_try_delete` 对事务级中止错误（`40P01` deadlock / `40001` serialization）**重新抛出**，不再吞掉；`25P02`（事务已中止）只作为下游症状，不作为独立信号。良性逐表漂移仍按原样跳过。
5. **实测 [V]**：修复后 `workbench-pointcloud-tools.spec.ts:379` 单测 `--retries=0` → **1 passed (28.3s)**，无 deadlock/残差；`video-issue-context` G2-5 相关用例 → **3 passed (1.3m)**；`apps/api/tests/test_seed_owned.py` → **22 passed**（含 3 例新增回归）；`apps/web` `tsc --noEmit`、`eslint`（两个 spec）、`ruff check`/`ruff format --check` 均通过；自有 e2e 库运行后 `users=0 / projects=0`。

## 1. 复现与证据

- **自有隔离复现 [V]**：本工作树自有 e2e 模式 `aap_wt_c2820af87ec94679_e2e`，命令
  `pnpm dev:worktree -- exec --mode e2e -- bash -lc 'cd apps/web && pnpm exec playwright test e2e/tests/workbench-pointcloud-tools.spec.ts --project=pointcloud -g "多边形双击" --retries=1 --reporter=line'`
  修复前：attempt 0 失败、attempt 1 通过（flaky），错误 `seed/owned-cleanup failed: 500 ... users:3, projects:2`，与 P9 domain 运行一致。
- **API 侧 traceback [V]**：`asyncpg.exceptions.DeadlockDetectedError: deadlock detected`，SQL 为 `UPDATE task_locks SET expire_at=$1 ... WHERE task_locks.id = $2`，调用链 `create_annotation → heartbeat_task_lock_for_legacy_video → TaskLockService.heartbeat → db.flush()`。
- **PostgreSQL 服务端日志 [PG]**（同集群）：
  - `Process 961864: UPDATE task_locks ...` ↔ `Process 961835: DELETE FROM tasks WHERE project_id = ANY($1)`；
  - 随后 `DELETE FROM projects` / `DELETE FROM datasets` / `DELETE FROM users` 依次 deadlock，并出现 `tasks_project_id_fkey`、`project_members_user_id_fkey` 级联报错。
- **隔离对照 [V]**：把残差行集按字节复制到自有库（只读 dump + restore），直接调用 `_cleanup_e2e_fixtures` 与经 HTTP 调用 `/seed/owned-cleanup` 均返回 `200`、无 skip。
- **P9 原始结果保留**：`/tmp/aap-p9-domain-raw/pointcloud.json`、`/tmp/aap-p9-domain-status/*`、`/tmp/aap-opt-p9-domain-report.md` 未改动；未要求重跑整套 campaign。

## 2. 变更文件

| 文件                                                    | 变更                                                                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/e2e/tests/workbench-pointcloud-tools.spec.ts` | 379 用例：`waitForRequest` → `waitForResponse`，断言响应成功 + 持久化 `id`/`annotation_type`/`geometry`；保留 request-geometry/doubleclick 断言 |
| `apps/web/e2e/tests/video-issue-context.spec.ts`        | takeover 账号改为命名空间化 `takeover-<ns>@e2e.test`，仍走真实 invite → register 路径                                                           |
| `apps/api/app/api/v1/_test_seed.py`                     | `takeover_email` 属性 + 纳入 `all_user_emails`；`BUG-E2E-FILTER-` 前缀仅 `owned is None`；`_is_transaction_abort` + `_try_delete` fail-fast     |
| `apps/api/tests/test_seed_owned.py`                     | 3 例回归：命名空间 takeover actor 清理 + 邻居存活；owned 清理不匹配共享 BUG 前缀；事务中止错误识别                                              |

## 3. 边界与限制

- 只修复授权范围内的文件；未重跑整套 P9 campaign、未改 CI/planner、未 push、未用全局管理员或 `reset()` 绕过隔离。
- 远程 CI 未运行（无 push）；所有结论来自本工作树自有一次性环境与同集群 PostgreSQL 服务端日志。
- `_try_delete` 仍保留良性的逐表跳过（表/列漂移不应中断整个有序清理）；严格 residual 守卫保持不变，仍是最终闸门。
- 本次不做更广的 actor/seed API 重构；`takeover` 仍由真实邀请路径创建，只是命名空间化。

## 4. 复发防护口径

- **行为回归**：新增 `test_seed_owned.py` 用例固定「精确 owned 清理必须删掉命名空间 takeover actor 且不触碰邻居」与「owned 清理不得匹配共享 `BUG-E2E-FILTER-` 前缀」。
- **诊断回归**：`_is_transaction_abort` 只识别 `40P01`/`40001`，明确不把 `25P02` 当作独立可重试原因；deadlock/serialization 不再被吞成误导性 residual。
- **浏览器侧**：涉及写请求的用例必须 await 对应 **response**（成功 + 持久化断言），避免 teardown 与自身写入竞争；本次只改被授权的 `pointcloud-tools:379`。
