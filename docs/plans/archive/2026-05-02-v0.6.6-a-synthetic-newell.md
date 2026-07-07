# v0.6.6 实施计划

## Context

ROADMAP.md 中累积了 v0.6.4 / v0.6.5 写时观察的 quick win、v0.6.2 phase 2 留的尾巴、以及 B 类治理项中可在不引入新基础设施前提下做掉的几条。本版本目标是**清掉 v0.6.x 系列的存量观察清单**，让 v0.6.7+ 能腾出干净的画布去做 SAM / 多任务类型工作台 / CI/CD 等大工程。

通过四问对范围进行了校准：
- Bug 反馈延伸**只做截图涂抹上传**（LLM 聚类 + 邮件通知延后到 v0.6.7，避开新 SDK / SMTP 链路）
- 审计日志双行 UI **全链路做完**（model + migration + middleware + UI 折叠 + 双栏 Modal）—— ROADMAP 写"仅剩 UI 折叠"是错的，模型层未持久化 request_id
- task 列表虚拟滚动**改 ROADMAP + 顺手把 AuditPage 表格也虚拟化**（TaskQueuePanel 已 react-virtual 化）
- CI/CD **测试基座先行 + 用例补齐 + CI 收口**（依赖顺序：conftest → @testing-library/react → 用例 → workflows）

本计划共 10 大块、按依赖顺序排列。预计工作量：5-7 天。

---

## 1 · 测试基座先行（其他模块的前置依赖）

### 1.1 后端 conftest.py 修补
**目标**：解锁 v0.5.5 / v0.6.0 / v0.6.3 留下的旧 httpx 集成测套（被 event loop 冲突 + 缺 dependency_overrides 卡住）。

**动作**：
- `apps/api/tests/conftest.py`
  - `test_engine` 改为 **function-scoped**（参考 `test_task_lock.py:35-41` 已验证方案）
  - `db_session` 配套改 function-scoped
  - 新增 `httpx_client_bound` fixture：内部 `app_module.dependency_overrides[get_db] = lambda: db_session`，yield 后 `pop`
  - `apply_migrations` 保持 session-scoped（迁移只跑一次）—— 参考 `test_task_lock.py` 已演示可与 function-scoped engine 共存

**文件**：`apps/api/tests/conftest.py:30-82`

**验证**：`cd apps/api && pytest tests/ -q` —— v0.6.5 之前 ERROR 的旧测应解锁；`test_task_lock.py` 内部 override 应可移除（改用新的 `httpx_client_bound`）。

### 1.2 前端 vitest 基座
**动作**：
- `apps/web/package.json` devDependencies 增加：
  - `@testing-library/react@^16.0.0`
  - `@testing-library/dom@^10.0.0`
  - `@testing-library/jest-dom@^6.0.0`
  - `jsdom@^25.0.0`
- `apps/web/vite.config.ts` 增 `test` 配置：`environment: "jsdom"`、`setupFiles: ["./vitest.setup.ts"]`、`globals: true`
- 新建 `apps/web/vitest.setup.ts`：`import "@testing-library/jest-dom/vitest"`
- `apps/web/package.json` scripts 增 `"test": "vitest run"` / `"test:watch": "vitest"`

**文件**：`apps/web/package.json`、`apps/web/vite.config.ts:1-39`、新建 `apps/web/vitest.setup.ts`

**验证**：`pnpm --filter @anno/web test` —— 现有 hotkey/iou 用例（42 例）应继续 pass。

---

## 2 · 测试欠账收尾

### 2.1 后端 pytest 4 例
**新建文件**：

- `apps/api/tests/test_attribute_audit.py`
  - PATCH `/projects/{pid}/tasks/{tid}/annotations/{aid}` 改 attributes
  - 断言 `audit_logs` 中 `action="annotation.attribute_change"` 行数 = 实际改动属性数（v0.6.3 `log_many` 后 round-trip 1 行）
  - 参考 `apps/api/app/services/audit.py:39,96-137`

- `apps/api/tests/test_comment_polish.py`
  - mentions 含非项目成员 user_id → 422（参考 `annotation_comments.py:56-85`）
  - attachments storageKey 不以 `comment-attachments/` 开头 → 422（参考 `_jsonb_types.py:162,174-179`）
  - download key 不在 `comment-attachments/{annotation_id}/` 前缀下 → 400（参考 `annotation_comments.py:226-227`）
  - 项目非成员请求 download → 404（参考 `annotation_comments.py:232-233`）

- `apps/api/tests/test_task_reopen_notification.py`（v0.6.5 新增第 4 例）
  - reviewer reopen 任务后，原 reviewer 调 `GET /me/notifications` 应能看到 `action=task.reopen` 且 `detail.original_reviewer_id == self`
  - 参考 `me.py:47-126`、`tasks.py:664-677`

**修改文件**：
- 把 `apps/api/tests/test_task_lock.py:32-70` 内部 override 删掉，改用 `httpx_client_bound`

### 2.2 前端 vitest 2 例
**新建文件**：

- `apps/web/src/pages/Workbench/shell/__tests__/CommentInput.test.tsx`
  - serialize 往返：`<div><span data-mention-uid="u1" data-mention-name="alice">@alice</span> hi</div>` → body `"@alice hi"` + mentions `[{userId:"u1", offset:0, length:6}]`
  - chip 紧邻 chip / chip 在首尾 / 粘贴 chip 后 Backspace 整体删除（参考 `CommentInput.tsx:50-86`）

- `apps/web/src/pages/Dashboard/__tests__/ExportSection.test.tsx`
  - 勾掉 includeAttributes → 调用 `projectsApi.exportProject(id, format, { includeAttributes: false })`
  - 用 vi.mock 拦截 API 模块，断言入参（参考 `ExportSection.tsx:44`）

---

## 3 · 数据 & 存储

### 3.1 维度回填 UI
**动作**：
- `apps/web/src/api/datasets.ts`（或 generated 客户端）补 `useBackfillDatasetDimensions(datasetId)` mutation hook，参照 `useScanDatasetItems` 同区域写法
- `apps/web/src/pages/Datasets/DatasetsPage.tsx:97-263` `DatasetDetail` 组件，在「扫描导入」按钮旁加「回填维度」按钮 + loading + toast；按钮显示 last `processed/failed/remaining_hint`
- 限制：仅 super_admin / project_admin 可见（参考现有按钮权限模式）

**文件**：`apps/web/src/pages/Datasets/DatasetsPage.tsx`、客户端 hook

**验证**：本地 dataset 中存在 `width=NULL` 的 item，点击按钮后 reload 列表，dimension 列填充。

### 3.2 link_project bulk_insert
**动作**：
- `apps/api/app/services/dataset.py:286-323` 重写 `link_project`：
  - 改用 `db.execute(insert(Task), [...])` 或 `bulk_insert_mappings`
  - `display_id` 当前在循环里逐条 `next_display_id` —— 改用一次性预分配序列：`SELECT nextval('display_id_seq') FROM generate_series(1, N)` 或保留逐条但放在 list comprehension 外
  - 注意 `display_id` 唯一约束（v0.6.4 改为复合 unique）

**文件**：`apps/api/app/services/dataset.py`

**验证**：1000 条 dataset items 的 link 操作时间从 ~2s 降到 < 200ms；新增 `apps/api/tests/test_dataset_link.py` 1 例覆盖 bulk 路径正确性。

### 3.3 dataset items 列表分页 + 缩略图懒加载
**现状**：已 offset 分页 + blurhash 缩略图（`DatasetsPage.tsx:177`），**ROADMAP 描述过期**。
**动作**：仅在 ROADMAP 标记完成。

---

## 4 · task 列表虚拟滚动 + AuditPage 表格虚拟化

### 4.1 ROADMAP 更新
- TaskQueuePanel 已用 `@tanstack/react-virtual` 完成 → ROADMAP 改 ✅

### 4.2 AuditPage 表格虚拟化
**动作**：
- `apps/web/src/pages/Audit/AuditPage.tsx:236+` 当前 `<tbody>` 直接 `.map()` 平铺 —— 改用 `useVirtualizer` 包裹（参考 `TaskQueuePanel.tsx`）
- 注意：`<table>` 虚拟化需用 `<div>` 模拟表格行（CSS grid / flex）或采用 react-virtual 的 row virtualizer + 容器固定高度

**文件**：`apps/web/src/pages/Audit/AuditPage.tsx`

**验证**：本地灌入 5000 条 audit_log，AuditPage 滚动 60 FPS；DOM 节点数 < 50 行。

---

## 5 · 审计日志双行 UI 合并（全链路）

### 5.1 后端：request_id 持久化
**动作**：
- `apps/api/app/db/models/audit_log.py:12-32` 增 `request_id: Mapped[str | None] = mapped_column(String(36), index=True)`
- 新建 alembic migration `0023_audit_request_id.py`：`ADD COLUMN request_id VARCHAR(36)` + B-tree index
- `apps/api/app/middleware/audit.py`（或 RequestIDMiddleware 协同）：从 request.state.request_id 注入到 audit_log 行；business detail 行（`audit_service.log()` / `log_many()` 调用方）也取同一 request_id
- 检查 `apps/api/app/services/audit.py:96-137` `log_many`，确保接受 request_id 参数透传

**文件**：`apps/api/app/db/models/audit_log.py`、`apps/api/alembic/versions/0023_audit_request_id.py`、`apps/api/app/middleware/audit.py`、`apps/api/app/services/audit.py`、`apps/api/app/api/v1/*.py`（调用 log_many 的地方传 request_id）

### 5.2 后端：API 响应包含 request_id
- `apps/api/app/schemas/audit.py` `AuditLogResponse` 增 `request_id: str | None`

### 5.3 前端：折叠 UI + 双栏 Modal
**动作**：
- `apps/web/src/pages/Audit/AuditPage.tsx`：
  - 拉到平铺列表后用 `useMemo` group by `request_id`（无 request_id 的归独立组）
  - 渲染：每组一行；若组内多于 1 行，左侧 `▸` 折叠按钮，展开后子行缩进显示
  - 详情 Modal：左栏「请求元数据」（method/path/status_code/ip/actor），右栏「业务 detail」（detail_json 美化展示）；当组内有多条 detail 行时，右栏支持 tab 切换

**文件**：`apps/web/src/pages/Audit/AuditPage.tsx` + 可能拆出 `AuditRowGroup.tsx`

**验证**：构造一条同 request_id 的 metadata + 2 条 business detail 的请求（如 PATCH attributes），AuditPage 显示 1 行折叠 + 展开后 3 行。

---

## 6 · Reviewer 仪表盘升级

### 6.1 个人最近审核记录
**动作**：
- `apps/api/app/api/v1/me.py` 新增 `GET /me/reviews/recent?limit=20`
  - SELECT Task WHERE reviewer_id=current_user AND status IN (completed, returned) ORDER BY updated_at DESC LIMIT N
  - 返回 `{id, display_id, project_id, project_name, file_name, status, updated_at}`

### 6.2 24h 滚动通过率 + 实时仪表卡
**动作**：
- `apps/api/app/api/v1/dashboard.py:74-132` `ReviewerDashboardStats` 增字段：
  - `approval_rate_24h`: 过去 24 小时 (completed) / (completed + returned)
  - `pending_queue_length`: 跨项目所有 status=review 的总数（已有 pending_review_count 即此）
  - `today_reviewed_count`: 已有
- `apps/web/src/pages/Dashboard/ReviewerDashboard.tsx`：
  - 顶部 4 卡片：本日已审 / 待审队列长度 / 24h 通过率 / 累计审核
  - 中部新增「最近审核记录」list，调 `/me/reviews/recent`，每行 `display_id + 项目名 + 文件名 + 状态 badge + 时间`，点击跳到任务

**文件**：`apps/api/app/api/v1/me.py`、`apps/api/app/api/v1/dashboard.py`、`apps/web/src/pages/Dashboard/ReviewerDashboard.tsx` + 可能拆出 `RecentReviewsList.tsx`

---

## 7 · WorkbenchShell 第三刀 + CanvasDrawing 历史回看 + 体验 quick win

### 7.1 useWorkbenchTaskFlow 拆分
**动作**：
- 新建 `apps/web/src/pages/Workbench/state/useWorkbenchTaskFlow.ts`（~80 行）
- 入参：`{ taskId, tasks, hasNextPage, isFetchingNextPage, fetchNextPage, annotationsRef, currentProject, ...selectors }`
- 出参：`{ navigateTask, smartNext, hasMissingRequired, handleSubmitTask }`
- 从 `WorkbenchShell.tsx:312-324, 338-361, 561-588` 切到新 hook
- 同步把切题 effect（参考 v0.6.4 hotkeys / v0.6.5 草稿持久化拆分模板）

**文件**：新建 `apps/web/src/pages/Workbench/state/useWorkbenchTaskFlow.ts`、修改 `WorkbenchShell.tsx`

**验证**：`pnpm --filter @anno/web build` 类型不挂；手测：N 切下一题 / U 切最不确定 / Ctrl+Enter 提交质检 / 必填缺失时弹 toast 不切题。

### 7.2 CanvasDrawing 历史回看叠加
**动作**：
- `apps/web/src/pages/Workbench/stage/ImageStage.tsx:342-351` Props 增 `historicalShapes?: Shape[]`
- 在 Stage 中并排渲染只读 Group（半透明 0.5 opacity），坐标系与 canvasShapes 一致
- `apps/web/src/pages/Workbench/shell/CommentsPanel.tsx:134-143` 评论卡片 onMouseEnter → 上层 store / context 写入 hoveredCommentId；ImageStage 从 store 读取对应 comment 的 canvas_drawing.shapes 作为 historicalShapes

**文件**：`apps/web/src/pages/Workbench/stage/ImageStage.tsx`、`CommentsPanel.tsx`、可能新建 `useHoveredCommentStore`（zustand）

### 7.3 AttributeForm 数字键 hint 强化
**动作**：
- `apps/web/src/pages/Workbench/shell/AttributeForm.tsx:86-117` hotkey badge 已渲染 —— 在标注被选中态时，让 hotkey badge **高亮**（参考 selected → border 加重）
- `Topbar.tsx` 角落 toast/徽章「⌨ 数字键 = 属性快捷键」（仅当选中态下显示）

### 7.4 CommentInput.serialize 边界（vitest 已在 §2.2 覆盖）
**动作**：
- `CommentInput.tsx:50-86` serialize：检查 chip 紧邻 chip 时 textNode 的边界、chip 在 block 元素首尾的 offset 计算
- chip 旁 Backspace：现有 onKeyDown 中拦截 Backspace，若光标紧邻 chip 右侧 → 整体删 chip 节点
- 单测在 §2.2 已规划

### 7.5 useCurrentProjectMembers context
**动作**：
- 新建 `apps/web/src/contexts/CurrentProjectMembersContext.tsx`：在 WorkbenchShell 顶层 Provider，调一次 `useProjectMembers(projectId)`
- `CommentsPanel.tsx:39` 改用 `useCurrentProjectMembers()`；后续其他面板（如 batch 分配）也复用
- 参考：项目当前无 createContext 用例 → 该 context 为首例，需选个清晰位置

**文件**：新建 `apps/web/src/contexts/CurrentProjectMembersContext.tsx`、修改 `CommentsPanel.tsx`、`WorkbenchShell.tsx`

### 7.6 usePopover hook 统一
**动作**：
- 新建 `apps/web/src/hooks/usePopover.ts`：`{ open, setOpen, anchorRef, popoverRef, toggle }`，内部封装 click-outside + esc-close + 锚点定位（参考 `ExportSection.tsx:25-39` 模式）
- 重构 5 个调用方：ExportSection / TopBar 主题切换 / 智能切题菜单 / AttributeForm DescriptionPopover / CanvasToolbar
- 顺带新建 `useClickOutside` / `useEscapeKey` 两个底层 hook（如有复用需求）

**文件**：新建 `apps/web/src/hooks/usePopover.ts`、5 处调用方

---

## 8 · GDPR / audit_logs 脱敏

### 8.1 用户软删后 actor_email 抹除
**动作**：
- `apps/api/app/api/v1/users.py:345-446` `delete_user` 流程末尾 + AuditService.log 之后：
  - `await db.execute(update(AuditLog).where(AuditLog.actor_id == user_id).values(actor_email=None, actor_role=None))`
  - 保留 actor_id（FK 已 SET NULL，但 actor_id 是当前 user_id，删除前是有效的）—— 这里是关键：actor_id 可保留（FK 会在用户行真正 DELETE 时 SET NULL，但用户软删 is_active=False 后 actor_id 仍指向有效行）
  - 实际上由于是软删（user 行不删），actor_id 始终有效；脱敏只需抹 email + role
- 同时 audit 该删除事件本身的 detail 含 redacted_email_count

**文件**：`apps/api/app/api/v1/users.py`

**验证**：新增 `apps/api/tests/test_user_delete_gdpr.py` 1 例：删除 user A 后查 `audit_logs WHERE actor_id=A`，actor_email 应全部 NULL。

---

## 9 · Sentry 接入

### 9.1 后端
**动作**：
- `apps/api/pyproject.toml` 增 `sentry-sdk[fastapi]>=2.0.0`
- `apps/api/app/config.py` 增 `sentry_dsn: str | None = None`、`sentry_environment: str = "development"`、`sentry_traces_sample_rate: float = 0.1`
- `apps/api/app/main.py:33-49` lifespan 早期初始化 Sentry（在 middleware 之前）：
  - 仅当 `settings.sentry_dsn` 非空才初始化
  - integrations: `FastApiIntegration`、`SqlalchemyIntegration`、`AsyncioIntegration`
  - `before_send` 钩子：剔除 `Authorization` header

**文件**：`apps/api/pyproject.toml`、`apps/api/app/config.py`、`apps/api/app/main.py`

### 9.2 前端
**动作**：
- `apps/web/package.json` 增 `@sentry/react@^8.0.0`
- `apps/web/.env.example` 增 `VITE_SENTRY_DSN=` 空值
- `apps/web/src/main.tsx`（如不存在则在 App.tsx 入口）初始化 Sentry：DSN 来自 `import.meta.env.VITE_SENTRY_DSN`，仅 production 启用
- `apps/web/src/App.tsx` 用 `Sentry.ErrorBoundary` 包裹 Router 根；fallback 显示「页面崩溃，已上报」+ 重试按钮

**文件**：`apps/web/package.json`、`apps/web/.env.example`、`apps/web/src/main.tsx`、`apps/web/src/App.tsx`

**验证**：临时注入 `throw new Error("test")` 在某页面，观察 Sentry 收到事件；本地 DSN 留空时不发请求。

---

## 10 · Bug 反馈系统延伸（截图 + 涂抹 + MinIO 上传）

### 10.1 截图采集
**动作**：
- `apps/web/package.json` 增 `html2canvas@^1.4.1`
- `apps/web/src/utils/bugReportCapture.ts` 增 `captureScreenshot()`：调 html2canvas → blob，约 2-5MB

### 10.2 简易涂抹层
**动作**：
- 新建 `apps/web/src/components/bugreport/ScreenshotEditor.tsx`：`<canvas>` 上叠加 fabric.js（项目已装）/ 直接 2D context drawRect → 让用户拉黑色矩形遮挡敏感区
- 在 BugReportDrawer 的 form 上方加「截取当前画面」按钮 → 弹 ScreenshotEditor → 确认后存到 form state

### 10.3 MinIO 上传链路
**动作**：
- 后端：`apps/api/app/api/v1/bug_reports.py` 增 `POST /bug-reports/screenshot/upload-init` 签发 `bug-screenshots/{user_id}/{uuid}.png` 的 PUT presigned URL；POST `/bug-reports` 接受 `screenshot_url` 字段（schema 已有）
- 前端：上传调用上述 init → PUT blob → `screenshot_url = "{minio}/bug-screenshots/.../uuid.png"` 写入 form

**文件**：`apps/api/app/api/v1/bug_reports.py`、`apps/web/src/components/bugreport/BugReportDrawer.tsx`、新建 `ScreenshotEditor.tsx`、`apps/web/src/utils/bugReportCapture.ts`

**LLM 聚类去重 + 邮件通知**：本版本不做，留 v0.6.7。

---

## 11 · MinIO 评论附件桶生命周期

### 11.1 lifecycle 配置
**动作**：
- `apps/api/app/services/storage.py:26-35` `ensure_bucket()` 之后追加 `set_bucket_lifecycle()`：`comment-attachments/` 前缀对象 90 天过期（仅作用于 `is_active=false` 评论的附件——需要 prefix 匹配，简化为整个 bucket 90 天 expire 过期，因为活跃评论也会随时间累积，可接受）
- 注：MinIO Python SDK 的 `set_bucket_lifecycle` 接受 `LifecycleConfig` 对象

### 11.2 celery 定时清理（推迟）
**说明**：项目当前**无 celery beat**（pyproject.toml 未启用），单做 lifecycle 已能在 90 天后自动 GC。celery 定时扫 `is_active=false` 评论硬清 storage key 推迟到 v0.6.7 与其他周期任务一起做。

**文件**：`apps/api/app/services/storage.py`

---

## 12 · vite chunk 路由级 lazy-load

### 12.1 改 lazy import
**动作**：
- `apps/web/src/App.tsx:7-34` 把以下页面改为 `React.lazy(() => import("..."))`：
  - WorkbenchPage（最重，含 konva / canvas / fabric）
  - DatasetsPage
  - AuditPage
  - ProjectsPage / SettingsPage / UsersPage
  - 保留 LoginPage / RegisterPage / 各 Dashboard 同步加载（首屏）
- 路由 element 外层套 `<Suspense fallback={<PageLoader />}>`
- 新建 `apps/web/src/components/PageLoader.tsx` 小型 spinner

**文件**：`apps/web/src/App.tsx`、新建 `apps/web/src/components/PageLoader.tsx`

**验证**：`pnpm --filter @anno/web build` 后 `dist/assets/` 应见 `WorkbenchPage-*.js` 独立 chunk；`index-*.js` 从 740KB 降至 < 400KB；登录页加载不再下 konva。

---

## 13 · CI/CD 收口

### 13.1 .github/workflows/ci.yml
**动作**：新建文件，含 jobs：
- `lint`：ruff (apps/api) + eslint (apps/web)
- `typecheck`：mypy (apps/api，可选) + tsc -b (apps/web)
- `pytest`：起 postgres service container → `alembic upgrade head` → `pytest -q`
- `vitest`：`pnpm --filter @anno/web test`
- `alembic-roundtrip`：`alembic upgrade head && alembic downgrade base && alembic upgrade head`
- `openapi-build`：`OPENAPI_URL=/tmp/openapi.json pnpm --filter @anno/web build`（先 dump 再 codegen 再 build）

**文件**：新建 `.github/workflows/ci.yml`

### 13.2 alembic migration drift 检测
**动作**：在 `apps/api/tests/test_alembic_drift.py` 新增 1 例：
- `alembic upgrade head`
- 用 `sqlalchemy.MetaData.reflect()` 读真实库 schema
- 与 `Base.metadata` 对比每张表的列名/类型集合，drift 时 fail

**文件**：新建 `apps/api/tests/test_alembic_drift.py`

### 13.3 pre-commit（推迟）
husky + lint-staged 留 v0.6.7（CI 通了之后再考虑本地拦截，避免重复成本）。

---

## 14 · ROADMAP & CHANGELOG 更新

**动作**：
- `CHANGELOG.md` 新增 `## v0.6.6 — 2026-05-XX` section，按本计划 13 块汇总
- `ROADMAP.md`：删除已完成项；修正 task 列表虚拟滚动条目；把 LLM 聚类 / 邮件通知 / pre-commit / celery 定时清理标为「v0.6.7 候选」

**文件**：`CHANGELOG.md`、`ROADMAP.md`

---

## 关键文件清单

### 新建
- `apps/api/tests/test_attribute_audit.py`
- `apps/api/tests/test_comment_polish.py`
- `apps/api/tests/test_task_reopen_notification.py`
- `apps/api/tests/test_user_delete_gdpr.py`
- `apps/api/tests/test_dataset_link.py`
- `apps/api/tests/test_alembic_drift.py`
- `apps/api/alembic/versions/0023_audit_request_id.py`
- `apps/web/vitest.setup.ts`
- `apps/web/src/pages/Workbench/state/useWorkbenchTaskFlow.ts`
- `apps/web/src/pages/Workbench/shell/__tests__/CommentInput.test.tsx`
- `apps/web/src/pages/Dashboard/__tests__/ExportSection.test.tsx`
- `apps/web/src/contexts/CurrentProjectMembersContext.tsx`
- `apps/web/src/hooks/usePopover.ts`
- `apps/web/src/components/PageLoader.tsx`
- `apps/web/src/components/bugreport/ScreenshotEditor.tsx`
- `.github/workflows/ci.yml`

### 修改重点
- `apps/api/tests/conftest.py` — function-scoped engine + dependency_overrides
- `apps/api/app/db/models/audit_log.py` — 加 request_id
- `apps/api/app/middleware/audit.py` — 注入 request_id
- `apps/api/app/services/audit.py` — log_many 透传 request_id
- `apps/api/app/services/dataset.py` — link_project bulk_insert
- `apps/api/app/services/storage.py` — bucket lifecycle
- `apps/api/app/api/v1/users.py` — GDPR 脱敏
- `apps/api/app/api/v1/me.py` — `/me/reviews/recent`
- `apps/api/app/api/v1/dashboard.py` — 24h 通过率
- `apps/api/app/api/v1/bug_reports.py` — screenshot upload-init
- `apps/api/app/main.py` + `pyproject.toml` + `config.py` — Sentry
- `apps/web/package.json` + `vite.config.ts` — vitest + lazy-load + 新依赖
- `apps/web/src/App.tsx` + `main.tsx` — lazy + Sentry ErrorBoundary
- `apps/web/src/pages/Audit/AuditPage.tsx` — request_id group + 折叠 + 虚拟化
- `apps/web/src/pages/Datasets/DatasetsPage.tsx` — 维度回填按钮
- `apps/web/src/pages/Dashboard/ReviewerDashboard.tsx` — 最近审核 + 24h 通过率
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` — 拆 useWorkbenchTaskFlow
- `apps/web/src/pages/Workbench/stage/ImageStage.tsx` — historicalShapes
- `apps/web/src/pages/Workbench/shell/CommentsPanel.tsx` — hover → historicalShapes + useCurrentProjectMembers
- `apps/web/src/pages/Workbench/shell/AttributeForm.tsx` — hotkey hint 强化
- `apps/web/src/pages/Workbench/shell/CommentInput.tsx` — serialize 边界
- `apps/web/src/components/bugreport/BugReportDrawer.tsx` — 接 ScreenshotEditor
- `apps/web/src/utils/bugReportCapture.ts` — captureScreenshot
- 5 处 popover 使用方收编 `usePopover`

---

## 端到端验证

### 自动化
1. `cd apps/api && pytest -q` → 现有测 + 新增 5 例全 pass，无 ERROR；conftest fix 后 v0.5.5/v0.6.0 旧测解锁
2. `pnpm --filter @anno/web test` → 现有 42 例 + 新增 2 例全 pass
3. `pnpm --filter @anno/web build` → bundle size 主 chunk < 400KB；产物含 WorkbenchPage 独立 chunk
4. `cd apps/api && alembic upgrade head && alembic downgrade base && alembic upgrade head` 来回 OK
5. CI workflow 在 PR 上跑通绿

### 手测脚本
1. **维度回填**：登录管理员 → Datasets → 选库 → 点「回填维度」→ toast 显示进度
2. **审计双行**：在工作台 PATCH 任意 annotation 的 attributes → 切到 AuditPage → 找到该请求 → 应见 1 行折叠 + ▸ 展开后 metadata + N 条 detail；点详情 Modal 双栏显示
3. **Reviewer 仪表板**：reviewer 账号登录 → ReviewerDashboard → 4 张统计卡 + 最近审核记录 list
4. **WorkbenchShell**：N/U/Ctrl+Enter 切题与提交全链路无 regression
5. **Canvas 历史回看**：画布上画一个红圈作为评论 → 提交评论 → hover 评论卡片 → 题图上半透明叠加红圈
6. **Bug 反馈截图**：触发 BugReportDrawer → 点「截屏」→ 涂抹敏感信息 → 提交 → DB `bug_reports.screenshot_url` 有值 + MinIO 桶有对象
7. **Sentry**：临时 throw → Sentry dashboard 收到事件
8. **GDPR**：删除一个 user → `psql -c "SELECT actor_email FROM audit_logs WHERE actor_id='<deleted_user_id>'"` 应全 NULL
9. **lazy-load**：登录页 Network → 不应见 konva 相关 chunk；进 Workbench 才下载

### 验证依赖关系
- §1 测试基座 → §2 测试用例 → §13 CI（vitest job 依赖 @testing-library/react；pytest job 依赖 conftest fix）
- §5.1 后端 request_id 持久化 → §5.3 前端折叠 UI（前端依赖响应字段）
- §6.1 `/me/reviews/recent` → §6.2 前端展示
- §7.1 useWorkbenchTaskFlow → §7.2 historicalShapes（同一文件 ImageStage 改动注意 merge）
- §10.3 MinIO upload-init → §10.1+§10.2 前端截图链路
