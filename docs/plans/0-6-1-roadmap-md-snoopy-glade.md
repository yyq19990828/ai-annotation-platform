# v0.6.1 — 大数据集分包 / 批次工作流 (task_batch)

## Context

当前 `DatasetService.link_project()` 把数据集所有 items 一次性创建为 tasks（`dataset.py:305-316` 逐条 `db.add`），1 万+ 量级时项目经理无法按批次指派、审核员无法整批退回、ML 团队拿不到分批迭代节奏。本次新增 `task_batches` 表 + 全链路批次工作流，使 PM 能创建/切分批次 → 标注员按批领题 → 审核员整批通过/退回 → 按批导出。

**AI 预标注相关留白**：仅在 batch `approved` 时埋空 hook，不实现主动学习闭环。

---

## Phase 1: Migration + Model + Enum（后端基础）

### 1.1 Alembic Migration — `0019_task_batches.py`

**新文件**: `apps/api/alembic/versions/0019_task_batches.py`  
**前序**: `down_revision = "0018"`

**DDL**:

```sql
CREATE TABLE task_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dataset_id    UUID REFERENCES datasets(id) ON DELETE SET NULL,
  display_id    VARCHAR(30) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT DEFAULT '',
  status        VARCHAR(30) NOT NULL DEFAULT 'draft',
  priority      INTEGER DEFAULT 50,
  deadline      DATE,
  assigned_user_ids JSONB DEFAULT '[]',
  total_tasks      INTEGER DEFAULT 0,
  completed_tasks  INTEGER DEFAULT 0,
  review_tasks     INTEGER DEFAULT 0,
  approved_tasks   INTEGER DEFAULT 0,
  rejected_tasks   INTEGER DEFAULT 0,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ix_task_batches_project_id ON task_batches(project_id);
CREATE INDEX ix_task_batches_project_status ON task_batches(project_id, status);
```

**ALTER tasks**:
```sql
ALTER TABLE tasks ADD COLUMN batch_id UUID REFERENCES task_batches(id) ON DELETE SET NULL;
CREATE INDEX ix_tasks_batch_id ON tasks(batch_id);
```

**数据回填** (raw SQL in `upgrade()`):
- 对每个现存 project：INSERT 一个默认批次 `name="默认批次"`, `display_id="B-DEFAULT"`, `status="active"`, 计数器复制自 project
- UPDATE 该 project 下所有 tasks 设 `batch_id = <新批次 id>`

### 1.2 SQLAlchemy Model

**新文件**: `apps/api/app/db/models/task_batch.py`

遵循 `task.py` 的 `Mapped` + `mapped_column` 模式，class `TaskBatch`，`__tablename__ = "task_batches"`。

### 1.3 修改 Task Model

**文件**: `apps/api/app/db/models/task.py`

新增一行:
```python
batch_id: Mapped[uuid.UUID | None] = mapped_column(
    UUID(as_uuid=True), ForeignKey("task_batches.id", ondelete="SET NULL"),
    nullable=True, index=True,
)
```

### 1.4 注册 Model

**文件**: `apps/api/app/db/models/__init__.py`

添加 `from app.db.models.task_batch import TaskBatch` + `"TaskBatch"` 到 `__all__`。

### 1.5 BatchStatus Enum

**文件**: `apps/api/app/db/enums.py`

```python
class BatchStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ANNOTATING = "annotating"
    REVIEWING = "reviewing"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"
```

### 1.6 Audit Actions

**文件**: `apps/api/app/services/audit.py` — `AuditAction` 枚举新增:

```python
BATCH_CREATED = "batch.created"
BATCH_STATUS_CHANGED = "batch.status_changed"
BATCH_REJECTED = "batch.rejected"
BATCH_DELETED = "batch.deleted"
```

**验证**: `alembic upgrade head` → 表存在 → 每个老项目有默认批次 → 每个老 task 有 batch_id。

---

## Phase 2: Pydantic Schemas + BatchService（业务逻辑）

### 2.1 Schemas

**新文件**: `apps/api/app/schemas/batch.py`

| Schema | 用途 |
|--------|------|
| `BatchCreate` | name, description, dataset_id?, priority(0-100), deadline?, assigned_user_ids[] |
| `BatchUpdate` | 所有字段可选 |
| `BatchOut` | 全列映射 + `progress_pct: float` 计算字段, `from_attributes = True` |
| `BatchSplitRequest` | `strategy: Literal["metadata","id_range","random"]` + 策略专用字段 + 公共字段(name_prefix, priority, deadline, assigned_user_ids) |
| `BatchTransition` | `target_status: str` |

### 2.2 BatchService

**新文件**: `apps/api/app/services/batch.py`

构造器模式同 `AnnotationService`：`__init__(self, db: AsyncSession)`。

**状态机**:
```
draft → active
active → annotating, archived
annotating → reviewing, archived
reviewing → approved, rejected
approved → archived
rejected → active, archived
```

**核心方法**:

| 方法 | 说明 |
|------|------|
| `list_by_project(project_id, status?)` | ORDER BY priority DESC, created_at |
| `get(batch_id)` | 单条查询 |
| `create(project_id, data, created_by)` | 生成 display_id `B-{uuid[:6]}`, 默认 draft |
| `update(batch_id, data)` | 名称/描述/优先级/截止/指派人 |
| `transition(batch_id, target_status, actor_id)` | 校验状态机 + 审计日志; approved 时调 `on_batch_approved()` |
| `split_by_metadata(project_id, key, value, params)` | 按 DatasetItem.metadata JSONB 过滤对应 tasks |
| `split_random(project_id, n_batches, params)` | 取默认批次未分配 tasks → shuffle → 均分 N 批 |
| `split_by_ids(project_id, item_ids, params)` | 按 dataset_item_id 列表过滤 |
| `assign_tasks_to_batch(batch_id, task_ids)` | UPDATE tasks SET batch_id + 重算计数 |
| `recalculate_counters(batch_id)` | COUNT tasks by status → 更新批次 + 项目级计数器 |
| `check_auto_transitions(batch_id)` | active + 有 in_progress task → annotating; annotating + 全部 completed/review → reviewing |
| `reject_batch(batch_id, actor_id)` | transition → rejected + 重置全部 tasks 为 pending + 清 is_labeled |
| `delete(batch_id, actor_id)` | tasks.batch_id 移回默认批次 → DELETE batch → 审计 |
| `on_batch_approved(batch_id)` | **空 hook**, 仅 logger.info |

### 2.3 集成现有 Task 状态变更

**文件**: `apps/api/app/api/v1/tasks.py`

在以下三个端点的状态修改之后，添加 `BatchService(db).check_auto_transitions(task.batch_id)` + `recalculate_counters`:
- `submit_task` (line 305)
- `approve_task` (line 330)
- `reject_task` (line 354)

**验证**: 单元测试状态机合法/非法转移。

---

## Phase 3: API 端点（CRUD + 批量操作）

### 3.1 路由模块

**新文件**: `apps/api/app/api/v1/batches.py`

嵌套路径 `/projects/{project_id}/batches`（同 `ml_backends` 模式）。

| 端点 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/` | GET | project visible | 列表 + ?status 过滤 |
| `/{batch_id}` | GET | project visible | 单条 |
| `/` | POST | project owner | 创建批次 |
| `/{batch_id}` | PATCH | project owner | 更新元数据 |
| `/{batch_id}` | DELETE | project owner | 删除(tasks 移回默认批次) |
| `/{batch_id}/transition` | POST | owner(大多数) / reviewer(approve/reject) | 状态转移 |
| `/split` | POST | project owner | 切分策略创建 1~N 个批次 |
| `/{batch_id}/reject` | POST | reviewer+ | 整批退回(tasks 全部重置) |
| `/{batch_id}/export` | GET | project visible | 按批次导出 ?format=coco\|yolo\|voc |

### 3.2 注册路由

**文件**: `apps/api/app/api/v1/router.py`

```python
from app.api.v1 import batches
api_router.include_router(batches.router, prefix="/projects/{project_id}/batches", tags=["batches"])
```

### 3.3 修改现有端点

**文件**: `apps/api/app/api/v1/tasks.py`

- `list_tasks`: 新增可选 `batch_id: uuid.UUID | None = None` 查询参数，过滤 `Task.batch_id == batch_id`
- `_task_with_url`: 返回 dict 新增 `"batch_id": task.batch_id`

**文件**: `apps/api/app/schemas/task.py`

- `TaskOut`: 新增 `batch_id: uuid.UUID | None = None`

**验证**: curl 全部 CRUD + 审计日志出现。

---

## Phase 4: Scheduler 改造（批次感知调度）

**文件**: `apps/api/app/services/scheduler.py`

`get_next_task(user_id, project_id, db, batch_id=None)`:

1. 新增可选 `batch_id` 参数
2. 候选 query 新增 JOIN `task_batches`:
   - 只选 status IN ('active', 'annotating') 的批次
   - 如指定 `batch_id` 则精确过滤
   - 过滤 `assigned_user_ids`：空数组 = 任何人；非空 = `@>` 包含当前 user_id
3. ORDER BY 加入 `TaskBatch.priority DESC` 前置（高优先级批次先发）

**文件**: `apps/api/app/api/v1/tasks.py` — `next_task` 端点新增 `batch_id` 可选参数传递。

**文件**: `apps/web/src/api/tasks.ts` — `getNext` 接受可选 `batchId`。

**验证**: 两个批次分配给不同用户 → 各自只拿到自己批次的 tasks。

---

## Phase 5: Export 改造

**文件**: `apps/api/app/services/export.py`

`_load_data(self, project_id, batch_id=None)`:
- 如 `batch_id` 提供 → tasks query 加 `Task.batch_id == batch_id`
- annotations 已按 task_id 关联，自动限定范围

三个 export 方法签名加 `batch_id=None` 透传到 `_load_data`。

现有 `GET /projects/{id}/export` 不变（全项目导出）。批次导出由 Phase 3 的 `/{batch_id}/export` 端点调用。

**验证**: 批次导出仅含该批次 tasks；项目导出仍含全部。

---

## Phase 6: 前端实现

### 6.1 API Client

**新文件**: `apps/web/src/api/batches.ts`

`batchesApi` 对象：list / get / create / update / remove / transition / split / reject / exportBatch

### 6.2 React Query Hooks

**新文件**: `apps/web/src/hooks/useBatches.ts`

`useBatches(projectId, status?)` / `useBatch` / `useCreateBatch` / `useUpdateBatch` / `useDeleteBatch` / `useTransitionBatch` / `useSplitBatches` / `useRejectBatch`

Query key: `["batches", projectId, status?]`

### 6.3 Types

**文件**: `apps/web/src/types/index.ts`

- 新增 `BatchStatus` 类型 + `BatchResponse` 接口
- `TaskResponse` 加 `batch_id: string | null`

### 6.4 BatchesSection（项目设置新 Tab）

**新文件**: `apps/web/src/pages/Projects/sections/BatchesSection.tsx`

模式同 `MembersSection`：Card + 表格(批次名/状态/优先级/截止/进度/操作) + "创建批次"按钮。

创建 Modal 含:
- 策略选择器 (tabs): "按元数据" / "按 ID 范围" / "随机切分"
- 策略特定表单字段
- 公共字段：名称、优先级 slider(0-100)、截止日期、指派用户多选

### 6.5 注册到 ProjectSettingsPage

**文件**: `apps/web/src/pages/Projects/ProjectSettingsPage.tsx`

- `SectionKey` 加 `"batches"`
- `SECTIONS` 数组加 `{ key: "batches", label: "批次管理", icon: "layers" }`（插在 members 后、owner 前）
- 条件渲染加 `{section === "batches" && <BatchesSection project={project} />}`

### 6.6 TaskQueuePanel — 批次下拉

**文件**: `apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx`

任务队列标题上方加 `<select>` 下拉（来自 `useBatches(projectId)` 的 active/annotating 批次），默认"全部批次"。

### 6.7 WorkbenchShell — 批次状态管理

**文件**: `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`

- 新增 `selectedBatchId` state
- `useTaskList` 传入 `batch_id` 过滤
- `getNext` 传入 `batch_id`
- 传递 batch 数据到 TaskQueuePanel

### 6.8 Task API — batch_id 参数

**文件**: `apps/web/src/api/tasks.ts`

- `TaskListParams` 加 `batch_id?: string`
- `listByProject` 中 `if (params?.batch_id) q.set("batch_id", params.batch_id)`
- `getNext` 接受可选 `batchId`

### 6.9 DashboardPage — 批次进度

**文件**: `apps/web/src/pages/Dashboard/DashboardPage.tsx`

`ProjectRow` 中：
- 项目有 >1 批次时，拆 ProgressBar 为分段显示各批次进度
- 仅默认批次时保持原单进度条（向后兼容）

实现方式：`ProjectResponse` 扩展 `batches_summary` 字段（后端在 list_projects 时附带），避免 N+1 查询。

### 6.10 ReviewPage — 批次分组

**文件**: `apps/web/src/pages/Review/ReviewPage.tsx`

- 批次下拉过滤器
- 按批次分组显示 section headers
- 每组加"整批通过" / "整批退回"按钮（调 `batchesApi.transition` / `batchesApi.reject`）

**验证**: 手动 UI 测试全流程。

---

## 文件清单

### 新文件 (8)
| 文件 | 说明 |
|------|------|
| `apps/api/alembic/versions/0019_task_batches.py` | Migration |
| `apps/api/app/db/models/task_batch.py` | Model |
| `apps/api/app/schemas/batch.py` | Schemas |
| `apps/api/app/services/batch.py` | Service + 状态机 |
| `apps/api/app/api/v1/batches.py` | Router |
| `apps/web/src/api/batches.ts` | 前端 API client |
| `apps/web/src/hooks/useBatches.ts` | React Query hooks |
| `apps/web/src/pages/Projects/sections/BatchesSection.tsx` | 设置页 UI |

### 修改文件 (13)
| 文件 | 改动 |
|------|------|
| `apps/api/app/db/models/task.py` | +batch_id 列 |
| `apps/api/app/db/models/__init__.py` | +TaskBatch 导入 |
| `apps/api/app/db/enums.py` | +BatchStatus 枚举 |
| `apps/api/app/services/audit.py` | +4 个 batch audit action |
| `apps/api/app/services/scheduler.py` | batch 感知调度 |
| `apps/api/app/services/export.py` | `_load_data` +batch_id 可选过滤 |
| `apps/api/app/api/v1/router.py` | +batches 路由注册 |
| `apps/api/app/api/v1/tasks.py` | +batch_id 过滤 + 自动转移调用 |
| `apps/api/app/schemas/task.py` | TaskOut +batch_id |
| `apps/web/src/types/index.ts` | +BatchStatus, BatchResponse, TaskResponse.batch_id |
| `apps/web/src/api/tasks.ts` | +batch_id 参数 |
| `apps/web/src/pages/Projects/ProjectSettingsPage.tsx` | +batches section |
| `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` | +batch 状态 + 过滤 |
| `apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx` | +batch dropdown |
| `apps/web/src/pages/Dashboard/DashboardPage.tsx` | +batch 分段进度 |
| `apps/web/src/pages/Review/ReviewPage.tsx` | +batch 分组 + 整批操作 |

---

## 验证计划

1. **Migration**: `alembic upgrade head` → 检查表结构 → 回滚 `alembic downgrade 0018` → 再升级
2. **默认批次回填**: 老项目有且仅有一个默认批次，老 task 全部关联
3. **状态机**: 合法转移成功 / 非法转移 400
4. **切分策略**: 随机切 3 批 → 总 task 数不变，各批 ±1；元数据切 → 仅匹配项进入
5. **调度器**: 两用户分属不同批次 → 各拿各批次 task；优先级高的批次先发
6. **计数器**: 标注/审核后批次+项目计数器准确；`recalculate_counters` 幂等
7. **导出**: 批次导出仅含该批 tasks；项目导出含全部
8. **向后兼容**: 无显式批次管理的项目（仅默认批次）功能不变
9. **审计**: 所有批次生命周期事件出现在 audit_logs
10. **UI E2E**: 创建批次 → 工作台按批过滤 → 审核页整批操作 → Dashboard 分段进度
