# Plan：v0.6.7 · 项目管理员 BUG 收口 + 数据/分包/分派可见性

## Context

v0.6.6 之后项目管理员（owner）继续提了 4 项问题，集中在「项目骨架」与「任务流转可见性」两个方向：

- **B-13 medium · 退出重进任务又触发 500（B-6 回归）**
  路由 `/projects/.../annotate`；前端显示「该任务正被其他用户编辑」。v0.6.6 的 B-6 修复只解决了 `MultipleResultsFound → 500`（`scalar_one_or_none` 改 `first/all`），但没有处理「自己 release 后短时间重进，仍被遗留锁挡住」的场景，体感上仍是同一个 bug。

- **B-11 high · 新建项目流程过于初级**
  对比 `ProjectSettingsPage` 已有 7 块（基本信息 / 类别 / 属性 / 成员 / 批次 / 负责人 / 危险），但 `CreateProjectWizard` 仅 3 步（名称+类型+截止日期 / 类别字符串列表 / AI 模型）。创建后用户必须手动跳设置页补全 → 数据集 → 批次 → 成员，**4 个步骤无任何引导**，新手会直接卡住。

- **B-12 high · 数据分包/任务分派流程不可见**
  ① 关联数据集后看不到任何「分包进度」—— 默认全部任务进入 `B-DEFAULT`，但 `BatchesSection` 列表既不显示 `B-DEFAULT` 的内部分布（`apps/api/alembic/versions/0019_task_batches.py:62` 创建，前端不区分），也没有「按 N 拆分」入口的引导。② 已存在的 `task_batches.assigned_user_ids` JSONB 字段（model `apps/api/app/db/models/task_batch.py:9-33`，PATCH 端点 `apps/api/app/api/v1/batches.py:79` 已支持）**前端 BatchesSection 完全没暴露**，所以「把批次分派给标注员/审核员」无入口。③ 标注员/审核员侧也没有按批次过滤的视图。

- **B-10 medium · 取消关联数据集 = 静默危险操作**
  `apps/api/app/services/dataset.py:338-345` `unlink_project` 仅删 `ProjectDataset` 记录，**不删 Task、不减 `project.total_tasks`、不发审计**；前端 `DatasetsPage.tsx:249-251` 的「X」按钮无任何确认。结果：① 进度条显示永远停留 ② 孤儿 Task 留在项目里 ③ 关联→取消→再关联会 double-count。

目标：v0.6.7 一次收口这 4 项，让「新建项目 → 关联数据集 → 分包 → 分派 → 标注/审核」整条链路对项目管理员可见、可操作、可撤销。

---

## 范围与不做项

**做：**
- B-13 task_lock 鲁棒性修复 + 回归测试
- B-11 创建向导扩展为 6 步（含成员、数据集、初始分包）
- B-12-① 取消「分包流程藏在设置页」—— 关联数据集后 toast 引导 + 项目卡显示批次进度
- B-12-② BatchesSection 增 `assigned_user_ids` 编辑 UI + 标注员/审核员侧批次过滤
- B-10 unlink 二次确认 + 服务层补 task 清理 + 计数器同步

**不做（推迟）：**
- 「按 metadata / id_range 切分」的可视化入口（后端 `POST /batches/split` 已支持，前端先做最常用的 `random` 即可）
- 批次级 reviewer dashboard（v0.6.8）
- 数据集导入/上传流程改造
- 跨项目的批次模板复用

---

## 项 1 · B-13 · TaskLock 自重入鲁棒性

### 现状

`apps/api/app/services/task_lock.py:17-51 acquire()`：
- v0.6.6 修复后逻辑：先 `_cleanup_expired()` → `select all locks for task_id` → 找 `my_lock` → 有则续期+清同 task 他人重复行；无则若 `locks` 非空 → `return None` → 端点返回 409。
- 漏洞：`my_lock` 不存在 + 他人锁未过期 → 直接 409。这覆盖了「另一用户真的在编辑」的合法场景，但**也覆盖了** v0.6.6 修复前残留下来的脏数据（同 task 多用户行）—— `_cleanup_expired` 只按 `expire_at` 清，不清「孤儿用户」（如调试时直接 `DELETE FROM task_locks WHERE user_id = X` 留下别人的旧行）。

更现实的触发路径（B-13 用户的截图日志只有 `screenshot/upload-init`，没有 lock 错误码 → 推断是同一会话切走再回来）：
1. 用户 A 在 task T 编辑 → lock_A 写入
2. A 切到别的页面再回来 —— **前端 useTaskLock cleanup 异步调 DELETE**，下一次 mount 立即 POST acquire
3. 在并发情况下，DELETE 还没落库 acquire 已查询，看到 `lock_A`（自己），命中续期分支 → 正常 ✓

但若中间有第二个浏览器会话（管理员另开窗口），或开发期 StrictMode 双 mount，会出现 `(task_id, A)` + `(task_id, B)` 两行；A 重进时只读到 `lock_B`，于是 409。

### 修复

#### 1.1 `acquire()` 的 `my_lock` 缺失分支增加「他人锁是否「真活着」」判断

`apps/api/app/services/task_lock.py:17-51`：

```
if my_lock:
    ... (不变)
elif locks:
    # v0.6.7 新增：他人锁存在，但若距 expire_at 不到 TTL 一半（即 last_heartbeat > 150s 前）
    # 视为「悬挂锁」自动接管 —— 真活着的会话每 60s 续期，expire_at 永远 > now + 240s。
    threshold = datetime.now(timezone.utc) + timedelta(seconds=self.DEFAULT_TTL // 2)
    stale = [l for l in locks if l.expire_at < threshold]
    if len(stale) == len(locks):
        for l in stale:
            await self.db.delete(l)
        # 落到下面的「new lock」分支
    else:
        return None
# new lock 创建...
```

阈值取 TTL/2 = 150s：心跳每 60s 一次，活会话 `expire_at - now ∈ [240, 300]`；TTL/2 给两次心跳的容错窗。

#### 1.2 前端 `useTaskLock` cleanup 改用 `navigator.sendBeacon`

`apps/web/src/hooks/useTaskLock.ts` cleanup：当前 `fetch DELETE` 在快速 unmount → mount 时可能被浏览器取消。改为 `sendBeacon` 保证 release 落库（即使页面跳转）；fallback 走旧 fetch。Auth header 限制下若 `sendBeacon` 不带 token，则保留 fetch + `keepalive: true`。

#### 1.3 测试

`apps/api/tests/test_task_lock_dedup.py` 新增 2 例：
- 残留他人 stale 锁（expire_at = now + 60s，即 last activity ≥ 240s 前）→ acquire 接管，返回新锁
- 残留他人活锁（expire_at = now + 280s）→ 仍 409

### 关键文件

- `apps/api/app/services/task_lock.py:17-51`
- `apps/api/tests/test_task_lock_dedup.py`（追加）
- `apps/web/src/hooks/useTaskLock.ts`（cleanup 部分）

---

## 项 2 · B-11 · CreateProjectWizard 扩展为 6 步

### 现状 vs 目标

| 步骤 | 当前 | v0.6.7 目标 | 复用组件 |
|---|---|---|---|
| 1 类型 | name + type + due_date | 不变 | — |
| 2 类别 | string[] 简单列表 | **接入 ClassesSection 的 `classes_config`** —— 按钮颜色 + 别名 + 父子结构 | `pages/Projects/sections/ClassesSection.tsx` 抽 `ClassEditor` 子组件 |
| 3 属性（新增） | 无 | 接入 AttributesSection 的 `attribute_schema` —— 字段类型 / 必填 / hotkey / visible_if | `pages/Projects/sections/AttributesSection.tsx` 抽 `AttributeSchemaEditor` |
| 4 成员（新增） | 无 | 选择标注员 / 审核员（多选；可跳过） | `pages/Projects/sections/MembersSection.tsx` 抽 `MemberPicker` |
| 5 数据集 + 分包（新增） | 无 | ① 选已有数据集 link（多选） ② 「按 N 拆分」滑杆（默认 3） | `pages/Datasets/DatasetsPage.tsx` 抽 `DatasetPicker` + 调 `useSplitBatches` |
| 6 AI（原 step 3） | AI on/off + 模型 | 不变 | — |
| 7 完成（原 step 4） | 完成页 | 改文案：「项目已创建，已关联 N 个数据集，已分为 K 批」 | — |

### 后端

`POST /projects` 当前只接 7 个字段，需要扩 schema 还是连续调 4 个端点？

**选择连续调用**（更小风险）：向导 `submit()` 内顺序：
1. `POST /projects` → 拿到 project.id
2. 若 step3 attribute_schema 非空 → `PATCH /projects/{id}` 更新 `attribute_schema`
3. 若 step4 选了成员 → 循环 `POST /projects/{id}/members`（已存在端点）
4. 若 step5 选了数据集 → 循环 `POST /datasets/{ds_id}/link?project_id=...` + `POST /projects/{id}/batches/split`

任一步失败 → toast「步骤 N 失败，但项目已创建，可去设置页继续」+ 不阻断（项目已落库，避免回滚分布式状态）。

`classes_config` 在 step2 通过 `PATCH` 写。

### 前端

- 新文件：`apps/web/src/components/projects/wizard/`
  - `Step1Type.tsx`（搬现 Step1）
  - `Step2Classes.tsx`（接 `ClassEditor`）
  - `Step3Attributes.tsx`（接 `AttributeSchemaEditor`）
  - `Step4Members.tsx`（接 `MemberPicker`）
  - `Step5Datasets.tsx`（接 `DatasetPicker` + `BatchSplitConfig`）
  - `Step6AI.tsx`（搬现 Step3）
  - `Step7Success.tsx`（改文案）
- `CreateProjectWizard.tsx` 重构为 step 调度器；`Stepper` 数字 1-6（成功页不计）。
- 每步可跳过（除 step 1 + step 6）；底部「跳过此步」按钮。
- localStorage 草稿保存（`create_project_draft`），刷新不丢；提交成功后清。

### 关键文件

- `apps/web/src/components/projects/CreateProjectWizard.tsx`（重构）
- `apps/web/src/components/projects/wizard/*`（新增 7 文件）
- `apps/web/src/pages/Projects/sections/{Classes,Attributes,Members}Section.tsx`（抽小组件）
- `apps/web/src/pages/Datasets/DatasetsPage.tsx`（抽 `DatasetPicker`）

---

## 项 3 · B-12 · 分包 / 分派可见性

### 3.1 关联数据集后立即可见

`apps/api/app/services/dataset.py:286-336 link_project()`：
- 在创建任务后**自动创建一个名为「{dataset.name} 默认包」的 batch**（display_id 走 `next_display_id("batches")`，归属当前 project_id），将本批次 N 个 task 的 `batch_id` 写入新建 batch.id。
- 项目内已有 `B-DEFAULT` 仍保留作为「未归类」兜底，但新接入的数据集**不再倾倒进 `B-DEFAULT`**。
- 前端 `useDatasets.ts:79-90` invalidate 增 `["batches", projectId]` 让 BatchesSection 立即刷新。

后向兼容：现存项目里 `B-DEFAULT` 的 task 不动；只是未来新关联的数据集每次都建一个独立 batch。

### 3.2 BatchesSection 增 `assigned_user_ids` UI

`apps/web/src/pages/Projects/sections/BatchesSection.tsx`：
- 表格新增「分派」列：显示 `assigned_user_ids.length` 个头像 / 名字（`Avatar` 组件已在 `MembersSection` 用过），点击打开 `AssignmentModal`。
- `AssignmentModal`：从项目成员（`useProjectMembers(projectId)`）筛选 role ∈ {annotator, reviewer}，多选，按 role 分两栏。提交时 `useUpdateBatch` 调 `PATCH /projects/{pid}/batches/{bid}` 写 `assigned_user_ids`。
- 状态机文案补：`assigned_user_ids` 非空 → 状态 `draft → active` 时分派；为空时按钮 disabled + tooltip「请先分派成员」。

### 3.3 标注员侧按 batch 过滤任务队列

后端 `GET /tasks?project_id=...` 已支持 `batch_id` query（`apps/api/app/api/v1/tasks.py`，复用现成）。
前端 `apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx:29-31` 已接 `batches` + `selectedBatchId` —— 但 dropdown UI 要补：
- 在 `WorkbenchShell` 顶 toolbar 加 batch select（仅当 `batches.length > 1` 显示）；选中后 `useTasks` 的 query key 加 `batchId`，server 端按 `tasks.batch_id == batchId` 过滤。
- 标注员仅看到 `assigned_user_ids` 包含 self 的批次（前端先过滤 `batches.filter(b => b.assigned_user_ids.includes(meId))`，简单兜底；后端可后续加 `?for_me=true` 复用）。

### 3.4 项目卡显示批次概览

`apps/web/src/pages/Dashboard/DashboardPage.tsx:33-101 ProjectRow`：
- 当前进度条只显 `(completed_tasks / total_tasks) * 100%`。
- 增「N 个批次 · K 已分派」小字，点击跳设置页 `/projects/{id}/settings?section=batches`（ProjectSettingsPage 加 query 解析 → 默认 section）。

### 关键文件

- `apps/api/app/services/dataset.py:286-336`（link_project 自动建 batch）
- `apps/web/src/pages/Projects/sections/BatchesSection.tsx`（新增 AssignmentModal + 分派列）
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` + `TaskQueuePanel.tsx`（batch select dropdown）
- `apps/web/src/pages/Projects/ProjectSettingsPage.tsx`（query string section 解析）
- `apps/web/src/pages/Dashboard/DashboardPage.tsx`（ProjectRow 批次概览）
- 新增 `apps/web/src/components/projects/AssignmentModal.tsx`

---

## 项 4 · B-10 · 取消关联数据集二次确认 + 计数同步

### 4.1 后端 `unlink_project` 改造

`apps/api/app/services/dataset.py:338-345`：
```
async def unlink_project(self, dataset_id, project_id, *, drop_tasks: bool = True):
    # 1. 收集本次要删的 tasks（来自该 dataset 的 dataset_item_id 关联）
    # 2. 计 N_total / N_completed / N_review
    # 3. drop_tasks=True：DELETE FROM tasks WHERE project_id=? AND dataset_item_id IN (...)
    # 4. project.total_tasks -= N_total；completed_tasks -= N_completed；review_tasks -= N_review（用 max(0, ...)）
    # 5. DELETE FROM project_datasets WHERE ...
    # 6. AuditService.log(action="dataset.unlink", detail={dataset_id, dropped_tasks: N_total})
```

注意：tasks 上挂着 annotations / audit / locks，需级联清理或拒绝（已有 annotation 的任务不能裸删 → 检测 `annotation_count > 0` 时返回 `409 has_annotations`，强迫前端二次确认中显示「N 个任务已有标注，将一并删除」）。

更稳妥：先实现 **soft-unlink** —— 不删 task，但把 `project.total_tasks` 等用 `_sync_project_counters`（`apps/api/app/services/batch.py:321-337`，已存在）调一次重算。这样进度条至少是真的，孤儿 task 留作 `dataset_item_id IS NULL` 由后续 batch 删除清理。

**推荐方案 A（soft-unlink）**：
- 取消关联只删 ProjectDataset link 记录
- 立即调 `_sync_project_counters(project_id)` 重算计数（不依赖 task 是否还在）
- 前端 invalidate `["projects"]` + `["project", id]` + `["project-stats"]` + `["batches", id]`
- audit `dataset.unlink` 记录 `{ dataset_id, dropped_tasks: 0, soft: true }`

孤儿 task 的清理放到「设置页 → 危险操作」加新按钮「清理无源任务」（v0.6.7+）。

### 4.2 前端 unlink 确认弹窗

`apps/web/src/pages/Datasets/DatasetsPage.tsx:249-251`：
- 当前直接 `onClick → unlinkMutation.mutate(p.id)` 改为 `onClick → setConfirmUnlink({ project, dataset })`。
- 复用 BatchesSection 已有的 `Modal` 二次确认模板，文案：「确认取消关联？项目「{name}」中由该数据集创建的 {N} 个任务将变为孤儿（保留但不再计入进度）。可在『项目设置 → 危险操作』中清理。」
- 进度数 N 通过新端点 `GET /datasets/{ds_id}/projects/{pid}/preview-unlink` 返回（或直接查 task count）。

### 4.3 测试

`apps/api/tests/test_dataset_link.py`（已存在 3 例）追加 2 例：
- link → unlink → project.total_tasks 重算正确（不再 stale）
- 同一 dataset 在同 project link → unlink → re-link 不出现 double-count

### 关键文件

- `apps/api/app/services/dataset.py:338-345`
- `apps/api/app/api/v1/datasets.py`（unlink 端点 + audit）
- `apps/api/tests/test_dataset_link.py`（+2 例）
- `apps/web/src/pages/Datasets/DatasetsPage.tsx:249-251`
- `apps/web/src/hooks/useDatasets.ts:79-90`（invalidate 增 `["projects"]` 系列）

---

## 验证

### 单测

- `pytest apps/api/tests/test_task_lock_dedup.py` — 旧 4 例 + 新 2 例全绿
- `pytest apps/api/tests/test_dataset_link.py` — 旧 3 例 + 新 2 例全绿
- `pytest apps/api/tests` — 60 → 64 例，无回归
- `pnpm vitest run` — 64 → 68 例（CreateProjectWizard 重构补 smoke）

### 端到端（手动 + chrome MCP）

每条都开浏览器跑一遍：
1. **B-13** —— 用 owner 账号开 task → 切走 → 立即返回 → **不再出现** 「该任务正被其他用户编辑」红 banner
2. **B-11** —— 新建项目走完 6 步 → 落地后 settings 页 7 块全部已填，无需再补 → 项目卡进度条已显
3. **B-12** —— ① 关联新数据集 → BatchesSection 立刻出现「{ds.name} 默认包」 ② 点新批次「分派」→ 选 2 个标注员 + 1 个 reviewer → save → 列表显示 3 个头像 ③ 用被分派的标注员账号登录 workbench → toolbar 看到 batch select，选中后队列被过滤
4. **B-10** —— 取消关联弹二次确认 → 取消则不变；确认则进度条立即重算，刷新后不回弹

### 数据库自检

```bash
# unlink 后 stale 计数检查
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT p.id, p.total_tasks, COUNT(t.id) AS real_total
   FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
   GROUP BY p.id HAVING p.total_tasks != COUNT(t.id);"
# 期望：0 行
```

### 升版

- `CHANGELOG.md` 加 [0.6.7] 章节
- `apps/api/app/main.py` version 0.6.6 → 0.6.7
- `apps/web/package.json` version 同步
