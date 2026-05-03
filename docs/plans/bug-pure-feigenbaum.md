# 项目管理员 BUG 收口 — B-13 / B-14 / B-15

## Context

项目管理员在 v0.6.7 上线后又提交了 3 个反馈：

| ID   | 严重度 | 标题                              | 现象                                                                 |
|------|--------|-----------------------------------|----------------------------------------------------------------------|
| B-13 | medium | 同一个人退出重进任务时又触发500BUG | 同一用户退出再进入任务时仍偶发「该任务正被其他用户编辑」           |
| B-14 | high   | 删除批次                          | 删除全部批次后，再次切分批次返回 400 「No default batch found」     |
| B-15 | high   | 任务队列                          | 任务队列永远只能看见 100 条，看不到批次信息也没分批提示             |

经数据库核对，受影响项目 `4b856ea0…` 当前有 **1206 条 batch_id=NULL 的任务、0 条批次** —— 印证了 B-14 的死锁状态。三个问题都触及 v0.6.7 引入的「数据集→批次」改造遗留尾部，需要一次性收口。

---

## B-14 — 删除全部批次后再切分会卡死（高优先级）

### 根因
- v0.6.7 之前：项目自动创建 `B-DEFAULT` 哨兵批次，新数据集任务写入 `B-DEFAULT`。`split` 流程从 `B-DEFAULT` 拆出新批次。
- v0.6.7 起 (`apps/api/app/services/dataset.py:309-329`)：新接入数据集改写到独立「{ds.name} 默认包」批次，**新项目不再创建 `B-DEFAULT`**。
- `apps/api/app/services/batch.py:51-58, 164-166, 212-214, 252-254`：split 三种策略仍写死从 `display_id == "B-DEFAULT"` 取任务，新项目命中即抛 400。
- `apps/api/app/services/batch.py:119-137`：删除非默认批次时，仅在 `B-DEFAULT` 存在时才把任务回收过去；否则任务变成 `batch_id=NULL` 孤儿。

→ 新项目用户删完最后一个批次：任务全部 NULL、`B-DEFAULT` 不存在 → split 任何策略都死。

### 修复策略
**核心原则：** 让「未归类任务」（`batch_id IS NULL`）成为可被 split 的合法源，而不是依赖 `B-DEFAULT` 哨兵存在。

**修改 1：`apps/api/app/services/batch.py`**
- 新增 `_get_splittable_task_ids(project_id, filter_q=None)`：返回 `batch_id IS NULL OR batch_id == B-DEFAULT.id` 的任务 id 列表（如果还有遗留 `B-DEFAULT`，一并算上，向后兼容老项目）。
- `_split_random` / `_split_metadata` / `_split_by_ids` 三个方法：删掉 `get_default_batch()` 强制校验；改用 `_get_splittable_task_ids`。空集合时返回 400「没有可切分的未归类任务」（更准确的错误信息）。
- `delete()`：当目标批次有任务、且项目内已无其它批次时，把任务回退为 `batch_id=NULL`（移除依赖 `B-DEFAULT` 的隐式回收）。原有「回收到 default」分支仅在 `B-DEFAULT` 还在时保留，作为老项目兼容。

**修改 2：前端可选** — `apps/web/src/pages/Projects/sections/BatchesSection.tsx` 文案 / 空态提示，让用户清楚「未归类任务可直接 split」。本次先不动文案，后端 fix 上线后即可正常 split。

### 数据修复（一次性）
受影响项目 `4b856ea0…` 已有 1206 条 NULL 任务。后端修复后再次 split 即可。**无须脚本回填**。

---

## B-15 — 任务队列只显示 100 条、看不到批次

### 根因（两个独立问题）

**(1) 分页中断 BUG —— 100 条上限**
- `apps/api/app/api/v1/tasks.py:107-115`：**首屏请求（无 cursor）的响应体不返回 `next_cursor`**。
- `apps/web/src/hooks/useTasks.ts:24`：`getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined` → 拿到 `undefined` → `hasNextPage = false` → infinite query 卡死在第一页。
- 同时首屏排序 `(sequence_order, created_at)` 与游标分支 `(created_at, id)` 不一致，即便修了 cursor，第二页之后会乱序。

**(2) 批次信息不可见**
- `apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx:159` 仅在 `batches.length > 0` 时渲染下拉，新项目（如 `4b856ea0…`）显示空。
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx:91-97` 又把 `draft` 状态批次过滤掉，所以即使数据集自动创建了「默认包」（`status=draft`），用户还是看不到。
- 任务条目本身从不显示所属批次（`TaskQueuePanel.tsx:73-94` 仅展示 `display_id` / `file_name` / 状态）。

### 修复策略

**修改 1：后端首屏分页对齐 `apps/api/app/api/v1/tasks.py`**
- 把首屏排序改为 `(created_at, id)`，与 cursor 分支对齐。
- 首屏响应同样产出 `next_cursor`（当 `len(tasks) == limit` 时）。
- 移除 `offset` 参数路径或保留但不再使用（前端只用 cursor）。

**修改 2：前端任务计数兜底 `apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx`**
- 计数行 (line 187-189)：用后端返回的 `total` 替换 `tasks.length`，显示 `{taskIdx+1} / {total}`，避免「100」错觉。需要 WorkbenchShell 把 `taskListData.pages[0].total` 透传进来。

**修改 3：前端批次提示**
- `WorkbenchShell.tsx:91-97`：`activeBatches` 增量纳入 `draft` 状态批次（自动创建的「默认包」），仅对 owner 可见；标注员仍按 assigned_user_ids 过滤。
- `TaskQueuePanel.tsx:159`：当 `batches` 长度为 0 且当前用户是 owner 时，渲染一行提示「未创建批次 — 前往「项目设置 / 批次」分批」，带跳转按钮（route 已知 `/projects/{id}/settings?section=batches`）。

---

## B-13 — 同一用户退出重进偶发锁冲突（medium）

### 根因（最可能的场景）
v0.6.7 已加：
- 多行残留兜底（同 task 多行不抛 MultipleResultsFound）
- `INSERT … ON CONFLICT DO UPDATE` 防并发 INSERT 冲突
- `keepalive: true` 提交 DELETE，确保 unmount 也能发出
- 全部「即将过期 (>TTL/2 = 150s 未心跳)」时自动接管

**仍未覆盖的场景：**
- DELETE / acquire **乱序到达**：keepalive DELETE 的提交时间不保证早于新页面的 acquire。若 acquire 先到、释放 DELETE 后到，会出现「我刚 refresh 又被自己删掉」，下一次操作（如 submit / heartbeat）报 409。
- **历史 assignee 残留锁**：任务被重新分配但前一个 assignee 的锁未到期未到 stale 阈值（仍有 > 150s 残留）→ 新 assignee 进入直接判他人占用。

### 修复策略
**修改 `apps/api/app/services/task_lock.py:18-74`**

1. **同会话乱序保护**：`acquire()` 拿到 `my_lock` 后，把刷新写入与 `_cleanup_expired` 放在同一事务，并把 `commit` 时机交给路由（已是默认）。在 `release()` 里添加：若入参 `task_id, user_id` 当前没有行，**直接返回 True**（幂等），不报警。**但更关键：在 acquire 我已持有分支后，立刻把 `(task_id, user_id)` 维度的所有 *其他* `created_at` 更早的行删除（避免乱序删了「真锁」留下「假锁」）**——当前实现已 dedup「他人」而不是 dedup「我自己」的多行；补一个对自己 user_id 多行的 dedup 即可（取 `unique_id` 较新的那行）。
2. **缩短「他人锁」接管窗口**：`stale_threshold` 从 `now + TTL/2 (150s)` 调到 `now + (TTL - 2*heartbeat) = 180s`，**并改判定「任一」非心跳即视为 stale**：从 `all(...)` 改为「锁数量 == 1 且该锁 expire_at < threshold」时接管。多锁存在时仍保守。
3. **将「锁持有者不在任务 assignee 列表 / batch 分派列表」纳入接管条件**（防御 assignee 变更后的孤锁）。需要 join `Task.assignee_id` 判断；加在 acquire 第二段。

> 由于 B-13 复现路径不明（API 日志只有截图上传调用，没有 lock 调用），先做上述三项保守增强。**若日志注入更详细的锁路径后仍偶发，再考虑前端「acquire 先 await DELETE」的串行化方案。**

---

## 其它

- **CHANGELOG.md**：新增 v0.6.8 条目，分别列出 B-13 / B-14 / B-15 的修复点 + 「分页 cursor 首屏修复」「split 不再依赖 B-DEFAULT」「锁接管窗口收紧」三个治理项。
- **数据库当前状态**：`4b856ea0-1690-4fc8-ae25-d67c2f763b51` 项目的 1206 条任务保持 `batch_id=NULL`，后端 fix 上线后用户自助 split 即可恢复。

---

## 关键文件清单

**后端：**
- `apps/api/app/services/batch.py` — split 解耦 `B-DEFAULT`、delete 兼容空批次场景
- `apps/api/app/api/v1/tasks.py` — list 首屏排序 + next_cursor
- `apps/api/app/services/task_lock.py` — 自身 dedup + stale 阈值 + 非 assignee 接管

**前端：**
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` — activeBatches 纳入 draft / total 透传
- `apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx` — 计数显示 total / 空批次提示行

**变更记录：**
- `CHANGELOG.md`

---

## 验证方案

**B-14**
1. 在受影响项目 `4b856ea0…`（已无批次） 上点「随机切分」 → 应成功创建新批次，1206 条任务被切到新批次。
2. 老项目（仍有 `B-DEFAULT`）切分链路保持原样。
3. `pytest apps/api/tests/`（如存在 batch service 测试）。

**B-15**
1. 项目 `4b856ea0…` 进入 `/annotate` → 队列计数显示 `1 / 1206`（不是 `1 / 100+`）。滚到底自动加载下一页直至 1206。
2. 切到老项目 → 批次下拉正常显示，draft 自动创建的「{ds} 默认包」也出现。
3. 新项目无任何批次时，队列下拉位置显示「未创建批次」提示行 + 跳转设置按钮。

**B-13**
1. Chrome 多标签同任务：第一个 tab 打开 → 第二 tab 打开 → 关闭第一个 tab → 在第二 tab 提交标注，不应 409。
2. 单 tab 快速「返回总览 → 重新打开」往返 5 次：每次都能成功获取锁，无 409。
3. 模拟 assignee 切换（手工 SQL 改 `tasks.assignee_id`）→ 旧 assignee 锁仍在 → 新 assignee 进入应直接接管。
4. `docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c "SELECT * FROM task_locks;"` 确认无残留。

**整体回归**
- 启动 dev：`docker compose up -d` + `pnpm dev` (apps/web) + uvicorn (apps/api)。
- 用 owner 账号走完「上传数据集 → 自动创建默认包 → 切分 → 标注 → 审核」全链路。
