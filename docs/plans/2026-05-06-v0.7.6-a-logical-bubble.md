# v0.7.6 实施计划 — Wizard 升级 / 批次重置 / 性能基建 / 测试与覆盖率门槛

## Context

v0.7.5 把 CORS / health/celery / codecov flag / CI lint format check 等 DX 与基建收尾后，
v0.7.6 进入"功能补缺 + 治理深化"主轴：

1. **A 节项目模块**：CreateProjectWizard 仍用简单字符串列表配类别，且无属性 schema 步骤；
   settings 页面已有完整 `ClassEditor` / `AttributesSection`，需要让两边复用同一组件并一次配齐属性 schema。
2. **A 节批次状态机增补 · 二阶段**：本期仅做 **Reset → draft 终极重置**（低风险候选）；
   `annotating → active 暂停` 与 `bulk approve/reject` 因调度器死锁 + UX 未定，本期暂搁。
3. **v0.7.x 写时观察**：v0.7.0 起累积 5 项小观察（NotificationsPopover usePopover 迁移 /
   ProjectsPage 卡片 DropdownMenu / `task.reopen` fan-out / Kanban 看板 / batch_summary stored 列）一次清掉。
4. **B 节性能/扩展（全部）**：AuditMiddleware 同步 INSERT 改 Celery 异步；
   `/tasks/{id}/annotations` 全量返改 keyset 分页；predictions 表完整迁移到 RANGE(created_at) 月分区。
5. **B 节测试/开发体验（全部）**：前端 vitest 从 ~10% 拉到 30%（hooks + 三个页面级单测），
   E2E 三个 spec 写实并去掉 `continue-on-error`，codecov.yml 落地后端 60% / 前端 30% 硬阻断（去 informational）。

预计 PR 序列 10-12 个，迭代约 3 周。

---

## 子任务清单（按合并顺序）

### S1 · CreateProjectWizard step 2/3 升级 + 新增"属性 schema"步骤

**问题**：当前 wizard 5 步（类型 / 类别 / AI / 数据 / 成员）+ 成功屏；step 2 用裸 `ClassRow{name,color}` 与 settings `ClassEditor` 已收敛但未升级颜色/排序的体验差异；后端 `ProjectCreate` 不接收 `attribute_schema`，必须先到 settings 页面 PATCH，新人 onboarding 体验断裂。

**方案**：扩为 6 步。新 step 3 = 属性 schema（可跳过）。

| 关键点 | 文件 | 备注 |
|---|---|---|
| 抽 `<AttributeSchemaEditor>` | `apps/web/src/pages/Projects/sections/AttributeSchemaEditor.tsx`（新建） | 从 `AttributesSection.tsx` L34-248 抽取纯编辑 UI（不含 PATCH 调用），props `{ value: AttributeSchema, onChange }`；保留 type/required/options/applies_to/visible_if/hotkey 全部能力 |
| `AttributesSection` 改造 | `apps/web/src/pages/Projects/sections/AttributesSection.tsx` | 内部仅保留 save 按钮 + `useUpdateProject`，编辑器全部委托给抽出的组件 |
| Wizard 新 step 3 | `apps/web/src/components/projects/CreateProjectWizard.tsx` | 步骤数组 +1，step indicator UI 同步，跳过按钮 = `attribute_schema = { fields: [] }` |
| 提交 payload 扩展 | 同上 L122-132 + `apps/api/app/schemas/project.py` `ProjectCreate` | 后端 schema 加 `attribute_schema: AttributeSchema \| None = None`，service 写入 `project.attribute_schema` |
| 类型生成 | `pnpm --filter @ai-annotation/web types:gen` | OpenAPI snapshot 契约会更新（v0.7.4 已有 snapshot 测试） |

**验证**：`pnpm vitest --filter web` + 手动开 wizard 跑全 6 步 + settings 页面打开同一项目验证 schema 显示一致。

---

### S2 · Reset → draft 终极重置

**问题**：v0.7.3 已落 3 条 owner 逆向迁移 + 4 条 bulk 端点，但任意状态强制重置回 draft 仍空白。下游 `on_batch_approved()` 仅占位 hook（batch.py L898 TODO），无 training_queue / frozen_snapshot 表引用，**实际下游影响很小**，可放心做。

**方案**：

1. **Service 层**：`apps/api/app/services/batch.py` 新增 `reset_to_draft(batch_id, actor, reason) -> TaskBatch`。
   - 复用 `reject_batch()` (L719-735) 中"task 状态全 → pending、保留 annotation 与 is_active"模式
   - 释放标注员锁：删除 `task_locks` 中 `task_id IN (该 batch)` 的所有记录（参考 `app/db/models/task_lock.py`）
   - 状态强制设 `BatchStatus.DRAFT`（绕过 `VALID_TRANSITIONS` 字典，直接路径 + 显式 reason）
   - 写 audit：action=`batch.reset_to_draft`、`detail_json={ from_status, reason, affected_task_count }`
2. **API 层**：`apps/api/app/api/v1/batches.py` 加 `POST /batches/{batch_id}/reset` (owner-only，body `{ reason: str }`，reason 必填且 ≥10 字符)。
3. **前端**：BatchesSection 卡片新增"重置到草稿"按钮 + 二次确认 modal（输入 reason + 显示影响 task 数 + 大字号警告"将释放所有标注员锁，但保留已标注内容"）。

**关键文件**：
- `apps/api/app/services/batch.py:719-735`（reject 模板）
- `apps/api/app/api/v1/batches.py:195-273`（单批次 transition 形参参考）
- `apps/web/src/pages/Projects/sections/BatchesSection.tsx`（新增按钮）

**Alembic**：无新迁移。仅 service / API / UI 改动。

**测试**：新增 `apps/api/tests/test_batch_reset.py` 覆盖 6 个起始状态 → draft 的成功路径 + 非 owner 拒绝 + reason 缺失校验。

---

### S3 · v0.7.x 写时观察一次清

#### S3.1 · NotificationsPopover usePopover 迁移
- 文件：`apps/web/src/components/shell/NotificationsPopover.tsx` + `TopBar.tsx`
- 改造：组件内部用 `usePopover()` hook（已存在 `apps/web/src/hooks/usePopover.ts`）替换父级 `open/onClose` 控制，TopBar 简化为只暴露 trigger ref。
- 测试：新增 `NotificationsPopover.test.tsx` 覆盖 click outside / Escape / trigger 切换。

#### S3.2 · ProjectsPage 卡片操作菜单收编 DropdownMenu
- 文件：`apps/web/src/pages/Dashboard/ProjectGrid.tsx` L121-133
- 改造：将"导出 / 设置 / 打开"三按钮中的次级动作（导出 / 设置 / 删除）合并到 `⋮` DropdownMenu trigger，"打开"保留为主操作。
- 复用：`apps/web/src/components/ui/DropdownMenu.tsx`（v0.5.5 已就位）。

#### S3.3 · `task.reopen` 通知 fan-out
- 当前：v0.7.0 删除 `/auth/me/notifications` audit-derived 后，`test_task_reopen_notification` 暂跳过。
- 改造：reopen 端点（`apps/api/app/api/v1/tasks.py`）调 `NotificationService.fan_out(type='task.reopened', recipients=[原 reviewer_id], context={task_id, batch_id})`。
- 配合：v0.7.2 已落 NotificationService + 偏好静音；本步只补 type 注册 + reopen 端点 hook。
- 测试：去除 `test_task_reopen_notification` 的 skip，确认通知中心收到 entry。

#### S3.4 · 批次状态看板（Kanban 视图）
- 新文件：`apps/web/src/pages/Projects/sections/BatchesKanbanView.tsx`
- 7 态卡片墙（draft / active / annotating / reviewing / approved / rejected / archived），列内显示批次卡片（编号 / 进度 / 分派人 stack）。
- 拖拽迁移：仅在 owner 视角启用，受 `VALID_TRANSITIONS` 字典约束（前端 dryrun，后端最终鉴权）。非法目标列 drop 显示 toast "transition 不合法"。
- view toggle：BatchesSection 顶栏加 `[列表 | 看板]` 切换，URL `?batch_view=kanban` 持久化（参考 v0.7.2 ProjectGrid `?view=grid` 模式）。

#### S3.5 · standalone batch_summary stored 列
- 当前：`list_projects` GROUP BY 单查询返回 `{total, assigned, in_review}`，每次拉项目列表都触发。
- 改造：alembic 0031 加 `projects.batch_summary` JSONB 列（默认 `{}`），由批次状态机变迁时 invalidate / 重算。
- 触发点：`batch_svc` 中所有改 BatchStatus 的方法（约 8 处）末尾调 `_recompute_project_batch_summary(project_id)`。
- `list_projects` 改读列，不再 GROUP BY。
- 回填脚本：alembic upgrade 中一次性 `UPDATE projects SET batch_summary = (SELECT ...)`。

---

### S4 · AuditMiddleware → Celery 异步队列

**当前**：`apps/api/app/middleware/audit.py` L42-99 `dispatch()` 内同步 await INSERT，主请求被旁路阻塞约 1-3ms。

**方案**：
1. Celery 队列增加 `audit` 路由：`apps/api/app/workers/celery_app.py` task_routes 加 `'app.workers.audit.persist_audit_entry': {'queue': 'audit'}`。
2. 新建 `apps/api/app/workers/audit.py`，定义 `@celery_app.task` 包装 INSERT 逻辑（迁移 `_persist_audit` 到 task body）。
3. 中间件改为 `persist_audit_entry.delay(payload_dict)`，主请求返回耗时 < 0.1ms。
4. 兜底：当 Celery broker 不可用时（`settings.celery_broker_url is None` 或 `settings.audit_async = False`），回退到原同步路径（保留为 fallback）。
5. 配置开关：`settings.audit_async: bool = True`，env `AUDIT_ASYNC=false` 可禁用。
6. 健康检查：`/health/celery` 已存在（v0.7.5），新增 active workers 中显示 `audit` 队列长度。

**测试**：`apps/api/tests/test_audit_async.py` 用 `celery_app.conf.task_always_eager = True` 验证 task body 正确写入；新增 fallback 测试用例（broker down 模拟）。

---

### S5 · Annotation 列表 keyset 分页

**当前**：`GET /tasks/{task_id}/annotations` (`apps/api/app/api/v1/tasks.py` L226-235) 全量返；前端 `useAnnotations` 单次拉，单 task 1000+ 框时阻塞渲染。

**方案**：
1. **后端**：移植 `apps/api/app/api/v1/audit_logs.py` L76-143 的 keyset 模式。
   - query 参数：`limit: int = 200`, `cursor: str | None = None`
   - 排序：`created_at DESC, id DESC`
   - cursor 编码：base64(`{ts}|{id}`)
   - 响应 shape：`{ items: [...], next_cursor: str | None }`
2. **索引**：alembic 0031 添加 `ix_annotations_task_created` `(task_id, created_at DESC, id DESC)`。
3. **前端**：`apps/web/src/hooks/useAnnotations.ts`（如不存在则在 WorkbenchShell 内联处升级）改用 RQ `useInfiniteQuery`，按 cursor 自动加载下一页；初始 page 拉 200，滚动 / 切 task 时再拉。
4. **兼容性**：旧调用方（无 cursor）默认拉 200 条 + 返 `next_cursor`，调用方决定是否继续翻页。前端逐步切到 infinite query。

**测试**：后端 `test_annotations_pagination.py` 覆盖 cursor 编解码 + 末页 null + 重复时间戳 tiebreak；前端 hook 在 vitest 内 mock 三页数据。

---

### S6 · Predictions 表分区（完整迁移）

**当前**：`predictions` 表无分区，`prediction_metas.prediction_id` FK → `predictions.id`，`predictions.created_at` 无索引。

**方案**：alembic 0031（与 S5 索引同迁移文件，或 0032 紧随）完整迁移到 RANGE(created_at) 月分区。

**步骤**：
1. **重塑主键**：`predictions` 主键从 `(id)` 改为 `(id, created_at)` 复合主键 — 这是 PG partition by RANGE 的硬要求（partition key 必须在主键中）。
2. **改 FK**：`prediction_metas.prediction_id` → `(prediction_id, prediction_created_at)` 复合 FK。`prediction_metas` 表也需加 `prediction_created_at` 列并回填。
3. **创建 partitioned 表**：`predictions_new` 用 `PARTITION BY RANGE (created_at)`，预创建过去 12 月 + 未来 3 月分区。
4. **数据搬迁**：`INSERT INTO predictions_new SELECT * FROM predictions`；`prediction_metas` 同步回填新列。
5. **rename swap**：`ALTER TABLE predictions RENAME TO predictions_old; ALTER TABLE predictions_new RENAME TO predictions;`。
6. **保留 rollback**：`predictions_old` 在 alembic downgrade 路径中可重建。
7. **后台 cron**：新建 `apps/api/app/workers/cleanup.py` 中加 `create_next_month_partition` 每月 1 日提前创建下月分区。

**风险与缓解**：
- 迁移在线时间长（千万级行需分批 INSERT）：alembic 中加进度日志 + chunked insert（参考 v0.6.x audit_logs partition 经验，如有）。
- ORM 模型同步更新：`apps/api/app/db/models/prediction.py` 的 `created_at` 列加入 `__mapper_args__.primary_key` 元组，同时 `prediction_metas.py` 加新列。
- 本地开发数据：在 `docs-site/dev/migrations.md` 写明本地 reset 步骤。

**ADR**：本期同步落 `docs/adr/0006-predictions-partition-by-month.md`，记录主键变更原因 / FK 复合化代价 / cron 自动化策略。

**测试**：`test_predictions_partition.py` 验证插入分散到正确分区（用 `pg_partition_tree`），FK 删除级联正确。

---

### S7 · 前端单测扩展（codecov ≥ 30%）

**目标**：前端 line coverage 从 ~10% 拉到 ≥ 30%。

**待补 hooks 单测**（位置：`apps/web/src/pages/Workbench/state/`）：
- `useClipboard.test.ts` — 偏移粘贴 / 多 annotation 粘贴 / 边界
- `useSessionStats.test.ts` — ring buffer / 节流 / reset
- `replaceAnnotationId.test.ts`（如位于 offlineQueue.ts，则补充测试用例）

**待补组件单测**：
- `apps/web/src/components/ui/Modal.test.tsx` — focus trap / Escape / overlay click
- `apps/web/src/components/projects/InviteUserModal.test.tsx` — 三态机（输入 / 验证中 / 已发出）
- `apps/web/src/pages/Auth/RegisterPage.test.tsx` — 三态（无邀请 / 邀请有效 / 邀请失效）
- `apps/web/src/components/ui/DropdownMenu.test.tsx` — 键盘 ↑↓ Enter Escape

**待补页面级单测**（含 MSW）：
- `apps/web/src/pages/Dashboard/__tests__/DashboardPage.test.tsx`
- `apps/web/src/pages/Projects/__tests__/ProjectsPage.test.tsx`（如不存在路径见 `/Projects/` 目录）
- `apps/web/src/pages/Workbench/shell/__tests__/WorkbenchShell.test.tsx`

**配置**：`apps/web/vite.config.ts` test.coverage 加 `thresholds: { lines: 30, statements: 30, functions: 30, branches: 25 }`。

---

### S8 · E2E spec 写实 + 去 continue-on-error

**当前**：`apps/web/e2e/tests/{auth,annotation,batch-flow}.spec.ts` 全 4 个 `.skip`；CI job `continue-on-error: true`。

**方案**：
1. **后端 factory 模块**：`apps/api/tests/factory.py` 新建（沿用 conftest.py 4 角色 fixture 模式）。导出 `seed_full_project()` 创建完整 project + dataset + 1 batch + N tasks + 1 annotator + 1 reviewer。
2. **E2E fixtures**：`apps/web/e2e/fixtures/seed.ts` 新建，提供 `seedFullProject()` 函数 — 通过 `POST /test/seed/full-project`（仅在 `ENV=test` 下挂载）调后端 factory。
3. **写实三个 spec**：
   - `auth.spec.ts`：登录页 → dashboard / 错密码 toast / token 过期跳回登录。
   - `annotation.spec.ts`：种子项目 → workbench → 画 1 框 → 提交 → list 显示。
   - `batch-flow.spec.ts`：annotator 提交全部 task → reviewer 通过 → batch 状态变 approved。
4. **去 `continue-on-error`**：`.github/workflows/ci.yml` L135-160 e2e job 改 `continue-on-error: false`。

**关键文件**：
- `apps/api/tests/conftest.py`（factory 复用 fixture 模式）
- `apps/api/app/api/v1/`（新增 `_test_seed.py` 路由，`if settings.env != "test": raise 404`）
- `apps/web/e2e/playwright.config.ts`（webServer 已配置）

---

### S9 · codecov.yml + 硬阻断

**当前**：无 `codecov.yml`，CI 用 codecov-action v5 默认模式（informational）。

**方案**：仓库根目录新建 `codecov.yml`：

```yaml
coverage:
  status:
    project:
      backend:
        target: 60%
        threshold: 1%
        flags: [backend]
      frontend:
        target: 30%
        threshold: 1%
        flags: [frontend]
    patch:
      backend:
        target: 70%
        flags: [backend]
      frontend:
        target: 50%
        flags: [frontend]
flag_management:
  default_rules:
    carryforward: true
  individual_flags:
    - name: backend
      paths: [apps/api/]
    - name: frontend
      paths: [apps/web/src/]
comment:
  require_changes: true
```

**生效**：去掉 codecov-action 默认 informational 模式，PR 跑出的覆盖率低于 target 时阻断 merge。

---

## 修改文件清单（合并视图）

### 后端
- `apps/api/app/api/v1/batches.py` — `POST /{id}/reset` (S2)
- `apps/api/app/api/v1/tasks.py` — annotations 端点加 cursor (S5)、reopen 加通知 fan-out (S3.3)
- `apps/api/app/api/v1/projects.py` + `app/schemas/project.py` — ProjectCreate 加 attribute_schema (S1)
- `apps/api/app/api/v1/_test_seed.py` — 新建（E2E factory 入口，S8）
- `apps/api/app/services/batch.py` — `reset_to_draft` (S2)、`_recompute_project_batch_summary` (S3.5)
- `apps/api/app/middleware/audit.py` — 改 Celery delay (S4)
- `apps/api/app/workers/audit.py` — 新建 (S4)
- `apps/api/app/workers/cleanup.py` — 新建 / 扩展 partition cron (S6)
- `apps/api/app/db/models/prediction.py` + `prediction_meta.py` — PK / FK 重塑 (S6)
- `apps/api/app/db/models/project.py` — 加 batch_summary JSONB 列 (S3.5)
- `apps/api/alembic/versions/0031_*.py` — annotations index + batch_summary 列 + project attribute_schema 默认值
- `apps/api/alembic/versions/0032_*.py` — predictions partition 完整迁移
- `apps/api/tests/factory.py` — 新建 (S8)
- `apps/api/tests/test_batch_reset.py` / `test_audit_async.py` / `test_annotations_pagination.py` / `test_predictions_partition.py` — 新建

### 前端
- `apps/web/src/pages/Projects/sections/AttributeSchemaEditor.tsx` — 新建抽取组件 (S1)
- `apps/web/src/pages/Projects/sections/AttributesSection.tsx` — 收薄 (S1)
- `apps/web/src/components/projects/CreateProjectWizard.tsx` — 6 步扩展 + payload 扩展 (S1)
- `apps/web/src/components/shell/NotificationsPopover.tsx` + `TopBar.tsx` — usePopover 迁移 (S3.1)
- `apps/web/src/pages/Dashboard/ProjectGrid.tsx` — DropdownMenu 收编 (S3.2)
- `apps/web/src/pages/Projects/sections/BatchesSection.tsx` — 重置按钮 + view toggle (S2 + S3.4)
- `apps/web/src/pages/Projects/sections/BatchesKanbanView.tsx` — 新建 (S3.4)
- `apps/web/src/hooks/useAnnotations.ts` — 改 useInfiniteQuery (S5)
- `apps/web/vite.config.ts` — coverage thresholds (S7)
- `apps/web/src/**/*.test.{ts,tsx}` — 新增 ~10 个测试文件 (S7)
- `apps/web/e2e/fixtures/seed.ts` — 新建 (S8)
- `apps/web/e2e/tests/{auth,annotation,batch-flow}.spec.ts` — 写实 (S8)

### CI / 文档
- `.github/workflows/ci.yml` — e2e 去 `continue-on-error` (S8)
- `codecov.yml` — 新建 (S9)
- `docs/adr/0006-predictions-partition-by-month.md` — 新建 (S6)
- `docs-site/dev/migrations.md` — 本地 reset 步骤 (S6)
- `CHANGELOG.md` — v0.7.6 收口段
- `ROADMAP.md` — 删除已完成项 / 移转写时观察

---

## 验证

1. **本地端到端**：`docker compose up` → `pnpm dev` → 跑 wizard 6 步 / 创建项目 / 进 workbench 标 1 框 / 重置批次 / 拖拽 kanban
2. **后端测试**：`pytest apps/api -q`（新增 4 个测试文件全 PASS，原 109 个不退化）
3. **前端单测**：`pnpm vitest --filter web` + `pnpm coverage` 验证 ≥ 30%
4. **E2E**：`pnpm e2e` 三个 spec 全 PASS，CI 去掉 continue-on-error 后仍绿
5. **alembic 双向**：`alembic upgrade head && alembic downgrade -2` 验证 0031 / 0032 round-trip（v0.7.4 已有 round-trip 测试基建）
6. **CI 全流程**：PR 上 CI 4 个 job（pytest / vitest / lint / e2e）全绿，codecov 显示后端 ≥ 60%、前端 ≥ 30%，低于阈值时 status check 红
7. **审计异步**：本地 `AUDIT_ASYNC=true` + Celery worker 起，访问任意写端点 → 验证 audit_logs 在 Celery 处理后写入；`AUDIT_ASYNC=false` 验证 fallback 同步路径

## 不在本期范围

- 批次状态机二阶段的 `annotating → active 暂停` 与 `bulk approve/reject`（推到 v0.7.7+ 待 UX 定）
- C 节工作台专项优化（SAM 等差异化能力另起 epic）
- ML Backend 协议 / WebSocket 文档（依业务触发）
