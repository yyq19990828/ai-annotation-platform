# v0.5.5 phase 2 — Floating Noodle（遗留工程一次性收口）

## Context

v0.5.5 phase 1 已落地分级权限矩阵 / 审计正反向追溯 / 主题三档 / 响应式收尾 / Lucide 迁移；v0.5.4 落地 polygon 编辑 / 属性 schema / 评论 / 离线队列 / classes 升级。两期都显式留下了"非本期范围"的尾巴：phase 1 留 7 项偏治理 / 基建（OpenAPI 同步是触发本计划的事件 —— 漏暴露 `UserOut.is_active` 直接挂掉前端删除按钮），v0.5.4 留 5 项偏工作台 polish（hotkey / 离线 / 评论 / 导出 / IoU 阈值）。

phase 2 把这 12 项一次性扫干净。**不引入新功能**，只做已立项遗留的闭环；交付一个稳定基线，下半场再开新需求。

---

## Scope（A · B · C · D · E 五块，共 12 项）

### A · 治理 / 基建（4 项）

#### A.1 OpenAPI → TypeScript 类型生成基建

**目标**：消除前后端 schema 手抄漂移；新增 `@hey-api/openapi-ts` 流水线，生成 `apps/web/src/api/generated/`，逐步替代 `apps/web/src/api/*.ts` 手写 type；首期至少把 `User / Project / Annotation / AuditLog / DatasetItem` 五个高频 type 切到生成版。

**后端**

- `apps/api/app/main.py` 已自带 `/openapi.json`（FastAPI 内置，无需改动）；确认 dev 环境 `GET /openapi.json` 返回完整 schema。
- 给关键 schema 加显式 `Field(..., examples=[...])` / `description`，便于生成端文档化（仅补 `apps/api/app/schemas/{user,project,annotation,audit_log,dataset}.py` 头部）。

**前端**

- `pnpm --filter @anno/web add -D @hey-api/openapi-ts`。
- 新建 `apps/web/openapi-ts.config.ts`：`input: "http://localhost:8000/openapi.json"`，`output: "src/api/generated"`，`client: "fetch"`（不引 axios 重写，仅生成 type + 可选 SDK）。
- `package.json` 加脚本：
  - `"codegen": "openapi-ts"`（手动）
  - `"codegen:watch": "openapi-ts --watch"`（开发期）
  - `"prebuild": "openapi-ts"`（CI gate；失败即失败，杜绝带漂移上线）
- 在 `src/api/users.ts` / `projects.ts` / `annotations.ts` / `audit.ts` / `datasets.ts` 顶部从 `generated/types.gen.ts` 重新导出 `UserResponse / ProjectResponse / AnnotationResponse / AuditLogResponse / DatasetItemResponse`，删除手抄声明；保留这些文件里现有的 axios 调用包装（不强行切到生成 SDK，渐进迁移）。
- 生成产物 `src/api/generated/` 加入 `.gitignore`（CI / prebuild 时再生成；本地开发首次跑 `pnpm codegen`）。
- README / DEV.md 加一段「前后端 schema 同步：改后端 schema → `pnpm --filter web codegen` → 提交」。

**关键文件**

- 新建：`apps/web/openapi-ts.config.ts`、`apps/web/src/api/generated/`（生成产物，gitignore）
- 修改：`apps/web/package.json`、`apps/web/.gitignore`、`apps/web/src/api/{users,projects,annotations,audit,datasets}.ts`、`DEV.md`

**验收**

- `pnpm --filter web codegen` 成功生成 `generated/types.gen.ts`，文件包含 `UserResponse.is_active` 字段（即此次 phase 1 漏字段事故的反向 case）。
- 删除一个手写 type（如 `UserResponse`）后 `tsc -b` 仍全绿（来自 generated 重导出）。
- `pnpm build` 触发 `prebuild` 自动跑 codegen；中断 API 时构建失败并提示"无法连接 OpenAPI 端点"。

---

#### A.2 后端 pytest 脚手架 + audit export `target_id` E2E 单测

**目标**：把 `apps/api/tests/` 从空目录变为可运行的 pytest 套件；首期覆盖 audit_logs 端点（`target_id` 过滤是 phase 1 新增逻辑，最易回归）。后续 InvitationService / AuditMiddleware / 权限矩阵单测都基于这套脚手架挂。

**新建文件**

- `apps/api/tests/__init__.py`（空）
- `apps/api/tests/conftest.py`：
  - `event_loop` session-scoped；
  - `db_engine` session-scoped（`TEST_DATABASE_URL` env，默认 `postgresql+asyncpg://...annotation_test`），autoflush 关；启动时 `Base.metadata.create_all()` 后跑 alembic upgrade head（保证 model 与 migration 一致）；
  - `db_session` function-scoped（per-test 事务嵌入 SAVEPOINT，结束 rollback）；
  - `client` async httpx `ASGITransport` + `AsyncClient(base_url="http://test")`；
  - `super_admin_user` / `project_admin_user` / `annotator_user` 三种角色 fixture；带 JWT token 注入 header；
  - `auth_client(role)` factory：返回带对应 role token 的 client。
- `apps/api/pytest.ini` / 或 `pyproject.toml [tool.pytest.ini_options]`：`asyncio_mode = "auto"`；`addopts = "-q --tb=short"`；`testpaths = ["tests"]`。
- `apps/api/tests/test_audit_logs.py`：
  - `test_export_filters_by_target_id`：先 seed 3 条 audit_log（target_type=user/target_id=A、B、A），导出 `?target_id=A&format=json`，断言只回 2 条。
  - `test_export_combined_filters`：`?actor_id=X&target_type=user&target_id=A`，断言精确匹配。
  - `test_export_records_self_in_audit`：导出本身写一条 `audit.export` 行，断言 `detail_json.target_id_filter == "A"`（同时把"导出操作记录目标 ID 过滤"补齐到后端，见后端改动）。
- `apps/api/tests/test_users_role_matrix.py`（顺带补 phase 1 矩阵基础回归）：
  - super_admin 改任意 → 200；改自己 → 403；
  - project_admin 改 annotator ↔ reviewer → 200；改非管理项目 user → 403；改 super_admin → 403；
  - 最后一名 super_admin 不可降 / 删 → 409。

**后端微调**

- `apps/api/app/api/v1/audit_logs.py` 导出端点的 audit 自记录处补 `target_id_filter` 字段（一行 dict 加 `if target_id` 时塞入）—— 与 A.2 测试 `test_export_records_self_in_audit` 对齐。
- 新增 `apps/api/app/db/test_utils.py`（仅 fixture 用）：`reset_audit_logs(session)` / `seed_user(session, role)` 工具函数，避免每个测试自己拼 SQL。

**关键文件**

- 新建：`apps/api/tests/{__init__,conftest,test_audit_logs,test_users_role_matrix}.py`、`apps/api/app/db/test_utils.py`
- 修改：`apps/api/pyproject.toml`、`apps/api/app/api/v1/audit_logs.py`（detail 增 `target_id_filter` 字段）

**验收**

- `cd apps/api && pytest -q` ✅ 0 failed；至少 8 个 test 通过。
- 测试本地运行不污染开发库（独立 `annotation_test` schema 或 db）。
- CI 入口（待 B 项 CI 落地后）能跑。

---

#### A.3 audit `detail_json` GIN 索引 + 双行 UI 合并视图

**目标**：① 后端给 `audit_logs.detail_json` 加 PG GIN 索引，启用字段级 `@>` 查询（前端可按 `detail.role: super_admin` 等键值过滤）；② 前端 AuditPage 把同 `request_id` 的 metadata 行（中间件自动写）+ business detail 行（业务代码主动写）合并展示 —— 当前是两条独立行，admin 阅读体验差。

**后端**

- alembic migration `0014_audit_detail_gin_index.py`：
  - upgrade：`op.create_index("ix_audit_logs_detail_json_gin", "audit_logs", ["detail_json"], postgresql_using="gin")`。
  - downgrade：drop index。
  - SQLite 测试库走 `if dialect != "postgresql": return`（noop），保持测试便携。
- `apps/api/app/api/v1/audit_logs.py` 的 `_build_base_query()` 新增 `detail_filter: dict | None` 参数（接受 `{"role": "super_admin"}` 等键值对）；查询内 `q = q.where(AuditLog.detail_json.contains(detail_filter))`；端点入参 `detail_key: str | None = Query(None)` + `detail_value: str | None = Query(None)`，组合成单键值（首期只支持单键，避免 URL 编码 JSON 的脏接口）。
- `GET /audit-logs?detail_key=role&detail_value=super_admin` 类似 SQL `WHERE detail_json @> '{"role": "super_admin"}'`，走 GIN 走索引 < 50ms（10 万行级）。

**前端**

- `apps/web/src/api/audit.ts`：`AuditQuery` 加 `detail_key?: string` / `detail_value?: string`。
- `apps/web/src/pages/Audit/AuditPage.tsx`：
  - 筛选区加两个并排 input：`detail 字段 key` + `detail 字段 value`（仅 super_admin 可见，避开普通 admin 误用）。
  - 表格行渲染合并：`useMemo` 按 `request_id` 分组同一请求的 metadata + detail 两行；展示主行（business detail 行优先，无则 metadata 行）+ 折叠按钮 `▸`，展开后渲染配对行的 `actor_role / status_code / ip / latency_ms` 等 metadata 字段。`request_id` 缺失时降级为单行原行为。
  - 详情 Modal 同样 merge：左栏 business detail，右栏 request metadata；`request_id` 显眼标头。

**关键文件**

- 新建：`apps/api/alembic/versions/0014_audit_detail_gin_index.py`
- 修改：`apps/api/app/api/v1/audit_logs.py`、`apps/web/src/api/audit.ts`、`apps/web/src/pages/Audit/AuditPage.tsx`

**验收**

- `alembic upgrade head` / `downgrade -1` 双向通过；PG `\d audit_logs` 看到新 GIN 索引。
- 前端按 `detail_key=role&detail_value=super_admin` 过滤可看到角色变更日志。
- 折叠行：phase 1 后随便发一次写请求，AuditPage 表里能看到 metadata + detail 合并为一行 + `▸` 展开。

---

#### A.4 IoU 去重阈值项目级可配

**目标**：把 `WorkbenchShell.tsx:218` 硬编码的 `0.7` 提到 `Project.iou_dedup_threshold`，项目设置页 General tab 加滑块（0.30 ~ 0.95，步长 0.05），保存即生效。

**数据模型**

- `apps/api/app/db/models/project.py` 加列：`iou_dedup_threshold: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.7", default=0.7)`。
- alembic migration `0015_project_iou_dedup_threshold.py`：upgrade 加列默认 0.7；downgrade drop。

**后端**

- `apps/api/app/schemas/project.py`：`ProjectOut.iou_dedup_threshold: float`；`ProjectUpdate.iou_dedup_threshold: Annotated[float, Field(ge=0.3, le=0.95)] | None = None`。
- `apps/api/app/api/v1/projects.py` PATCH 流转无需改（已是 `model_dump(exclude_unset=True)`）。

**前端**

- `apps/web/src/pages/Workbench/stage/iou.ts`：`iouShape()` 签名不变（保持纯几何），阈值在调用点判断。
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx:218`：`iouShape(u, a) > (currentProject?.iou_dedup_threshold ?? 0.7)`。
- `apps/web/src/pages/Projects/sections/GeneralSection.tsx`：加一行 `<RangeSlider label="AI 框去重阈值" min=0.3 max=0.95 step=0.05 value={p.iou_dedup_threshold}>`；保存 → `PATCH /projects/{id}` `{ iou_dedup_threshold }`。

**关键文件**

- 新建：`apps/api/alembic/versions/0015_project_iou_dedup_threshold.py`
- 修改：`apps/api/app/db/models/project.py`、`apps/api/app/schemas/project.py`、`apps/web/src/api/projects.ts`（type 加字段，A.1 后由 codegen 自动）、`apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`、`apps/web/src/pages/Projects/sections/GeneralSection.tsx`

**验收**

- 项目设置改阈值 0.85 → 工作台刷新 → IoU 在 0.7~0.85 之间的 AI 框不再淡化。
- migration 双向通过。

---

### B · 用户 / 权限完整化（2 项）

#### B.1 project_admin 视角 UsersPage 按管理项目过滤

**目标**：project_admin 进 UsersPage 只看到自己管理项目里的成员；后端从源头限制数据，前端不再做"看到再禁用按钮"。

**后端**

- `apps/api/app/api/v1/users.py` `list_users()` 当前无任何过滤（`apps/api/app/api/v1/users.py:79-89`）。改造：
  - 入参加 `project_id: UUID | None = Query(None)`（super_admin 可显式选项目过滤）。
  - 内部按 actor 角色分流：
    - super_admin：原行为（可选 project_id 过滤）。
    - project_admin：强制过滤到 actor 管理的项目（`Project.owner_id == actor.id`）的 ProjectMember 集合（subquery `SELECT user_id FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE owner_id = :actor_id)`）；忽略入参 project_id 或仅允许在子集内取值。
    - 其它角色：现行 router 已限制 `_MANAGERS` 才能进，理论不会到这里。
  - 自身 always 出现在结果（actor 看自己资料）。

**前端**

- `apps/web/src/pages/Users/UsersPage.tsx`：因为后端已过滤，前端无需改 fetch；保留现有矩阵裁剪逻辑（行级按钮显隐）。
- `useUsers.ts` 把后端返回直接吐给 React Query；没必要再做双重 filter。
- super_admin 视角加项目下拉（`<SelectInput project_id>`）作为 quality-of-life；project_admin 不显示该下拉。

**关键文件**

- 修改：`apps/api/app/api/v1/users.py`、`apps/web/src/pages/Users/UsersPage.tsx`、`apps/web/src/api/users.ts`（list 入参加 project_id）

**验收**

- super_admin 仍看到全量；超管 + project_id 过滤 = 仅该项目成员。
- 切到 project_admin 视角 → 仅看到管理项目内成员 + 自己。
- 用 A.2 pytest 套件加一例 `test_list_users_project_admin_scope`。

---

#### B.2 删除带未完成任务用户先转交 / 跨项目用户精确显示

**目标**：`DELETE /users/{id}` 当目标 user 在 `assignee_id` / TaskLock / 未完成 Task 中出现时，返回 409 + 详情，前端弹"转交目标"二次 Modal；强制 actor 选择目标用户接收任务再实际软删。

**后端**

- `apps/api/app/api/v1/users.py` `delete_user()`：
  - 软删前查询 `Task.where(assignee_id == target_id, status.in_([draft, in_progress, review_pending]))` count + first 5 task ids；TaskLock 查 `user_id == target_id` count。
  - 任一非零 → `raise HTTPException(409, detail={"reason":"has_pending_tasks", "pending_task_count": N, "locked_task_count": M, "sample_task_ids": [...]})`。
  - 接受新参数 `transfer_to_user_id: UUID | None = Body(None)`：当传值时，先 `UPDATE tasks SET assignee_id = :transfer WHERE assignee_id = :target AND status not in [completed]`，`DELETE FROM task_locks WHERE user_id = :target`，再走原软删路径；audit_log `user.delete` 的 detail 加 `transferred_to / transferred_count`。
  - 校验 `transfer_to_user_id` 必须是 actor 可见的 active 用户 + role >= annotator + 至少与 target 共享一个项目（避免转给毫不相干的人）。
- 「跨项目用户精确显示」：仍归 super_admin 处理 —— 当 project_admin 试图删跨多项目用户，返回明确文案 `"User belongs to projects you don't manage; ask super_admin"`（已有逻辑，仅文案对齐）。

**前端**

- `apps/web/src/pages/Users/UsersPage.tsx` 删除 Modal：检测 409 + `reason==="has_pending_tasks"` → 切到二阶段：
  - 文案"该用户当前有 N 个未完成任务、M 个锁定任务，需先转交"。
  - `<UserPicker>` 选 `transfer_to_user_id`（候选 = 同项目其它 active annotator/reviewer，复用 useUsers 列表过滤）。
  - 第二次提交 `DELETE /users/{id}` 带 body `{ transfer_to_user_id }`。
- `apps/web/src/api/users.ts` `removeUser(id, opts?: { transfer_to_user_id?: string })`。

**关键文件**

- 修改：`apps/api/app/api/v1/users.py`、`apps/web/src/pages/Users/UsersPage.tsx`、`apps/web/src/components/users/EditUserModal.tsx`（删除 Modal 二阶段）、`apps/web/src/api/users.ts`、`apps/web/src/hooks/useUsers.ts`（mutation 带新参数）

**验收**

- 删一个有 5 个 in_progress task 的 user → 弹"先转交"二阶段 → 选另一个 annotator 提交 → 5 个 task assignee 转走 + user 软删 + audit_log `user.delete` detail 含 `transferred_to`。
- 删一个 task 全完成的 user → 直接软删（不弹二阶段）。
- pytest 单测覆盖 409 + 转交 happy path。

---

### C · 响应式与组件抽取（2 项）

#### C.1 窄屏 hamburger drawer

**目标**：`< 1024px` 时 TopBar 左侧出现 hamburger 按钮；点击拉出右滑抽屉，承载完整 sidebar 内容（导航 + 用户菜单）；点遮罩 / Esc / 路由跳转后关闭。

**前端**

- 新建 `apps/web/src/components/shell/SidebarDrawer.tsx`：
  - props `{ open, onClose, children }`；
  - 实现：`<Portal>` 挂到 body；右滑 `transform: translateX(-100%)` → `0`，过渡 220ms ease-out；
  - 遮罩：黑色 0.4 opacity，点击 onClose；
  - body `overflow:hidden` 锁滚；ESC 监听；
  - `useLocation()` 监听路由变化自动关闭。
- `apps/web/src/App.tsx` 当前 `CompactSidebarDrawer`（占位 width:0）改为：`drawerOpen` state + 渲染 `<SidebarDrawer open={drawerOpen} onClose={...}>` 复用 `<AppShellSidebar>` 同一组件实例。
- `apps/web/src/components/shell/TopBar.tsx`：左侧加 `<IconButton name="menu" onClick={onOpenDrawer}>` 仅 `< 1024px` 显示；通过新增 prop `onOpenDrawer?: () => void` 由 App.tsx 注入；仅在 useMediaQuery `< 1024` 时渲染按钮。
- 工作台 `FullScreenWorkbench` 不接 drawer（继续走移动端遮罩逻辑）。

**关键文件**

- 新建：`apps/web/src/components/shell/SidebarDrawer.tsx`
- 修改：`apps/web/src/App.tsx`、`apps/web/src/components/shell/TopBar.tsx`

**验收**

- Chrome devtools 切窄屏 < 1024 → TopBar 左侧 hamburger 出现 → 点击拉出抽屉 → Esc / 点遮罩 / 跳路由都关闭。
- 桌面端 ≥ 1024 不渲染 hamburger（仅 sidebar 直显）。

---

#### C.2 通用 `⋯` 溢出菜单组件抽取

**目标**：phase 1 在 `apps/web/src/components/shell/TopBar.tsx:169-247` 实现的主题切换 dropdown + 工作台 `Topbar.tsx:63-73` 的 overflow dropdown，两处都重复"absolute 定位 + outside click 关闭 + ref 锚点"逻辑。抽 `<DropdownMenu>` 通用组件，两处接入。

**前端**

- 新建 `apps/web/src/components/ui/DropdownMenu.tsx`：
  - props：`{ trigger: ReactNode, items: DropdownItem[], align?: "start"|"end", className? }`；
  - `DropdownItem = { id, label, icon?, kbd?, onSelect, divider?, active? }`；分隔符走 `divider: true`；
  - 内部：`<button ref>` 包 trigger，`open` state，document mousedown outside-close，Esc 关闭，`role="menu" aria-orientation="vertical"`，子项 `role="menuitem"`，键盘 ↑↓ Home End 导航；
  - 主题切换这种"显示当前选中"的子菜单，通过 `active: boolean` + 渲染时尾部加 `<Icon name="check">` 实现。
- 改造 `apps/web/src/components/shell/TopBar.tsx` 的主题 dropdown：用 `<DropdownMenu trigger={<button>...</button>} items={[{light}, {dark}, {system}]}>`；删除 70 行内联实现。
- 改造 `apps/web/src/pages/Workbench/shell/Topbar.tsx` 的 overflow dropdown：同步用 `<DropdownMenu>`。
- 老的 `themeOpen` / `themeBtnRef` / `overflowOpen` / `overflowRef` 全部删（被 Dropdown 内置）。

**关键文件**

- 新建：`apps/web/src/components/ui/DropdownMenu.tsx`
- 修改：`apps/web/src/components/shell/TopBar.tsx`、`apps/web/src/pages/Workbench/shell/Topbar.tsx`

**验收**

- 两处 dropdown 行为不变（视觉 + 交互对齐）。
- 加键盘 ↑↓ 选择 + Esc 关闭 + Tab 不串到下一个焦点（focus trap）。
- 手动测：点击外部、点子项、按 Esc，三种关闭路径都正确。

---

### D · 工作台 polish（3 项）

#### D.1 属性 schema `hotkey` 字段实际绑定

**目标**：v0.5.4 留的 schema `hotkey` 字段从"声明但不消费"变为"声明即生效"；与 1-9 类别快捷键以**上下文优先级**协调（无选中框时 1-9 = 切类，有选中框且当前类别有对应 hotkey 属性时 1-9 = 切属性值）。

**前端**

- `apps/web/src/pages/Workbench/state/hotkeys.ts`：
  - `dispatchKey(event, ctx)` 的 ctx 加 `selectedAnnotationId / annotationAttributes / projectAttributeSchema`；
  - 新增 action `{ type: "setAttributeViaHotkey", annotationId, key, value }`；
  - 数字键分支改为：①若 `ctx.selectedAnnotationId == null` → `setClassByDigit`（保留原行为）；②若有选中 + schema 中存在 `applies_to == * / class_match` 且 `hotkey == "1"` 的字段：
    - boolean 字段 → toggle；
    - select 字段 → cycle 选中 options 的下一项（`current → next` 越界绕回）；
    - 其它类型 → 不响应（保留 setClassByDigit fallback）。
  - 同 hotkey 多字段命中时取 schema fields 顺序第一项；schema 校验时已要求 hotkey 唯一（在后端 validator 加）。
- `apps/api/app/schemas/project.py` `_validate_attribute_schema` 加：`hotkey` 唯一性校验（不同字段 hotkey 不重复），格式 `[1-9]` 字符串。
- `apps/web/src/pages/Workbench/shell/AttributeForm.tsx`：字段 label 后加 `<KeyBadge>{f.hotkey}</KeyBadge>`（仅 boolean / select 类型显示），提示用户该键已绑。
- `apps/web/src/pages/Workbench/shell/HotkeyCheatSheet.tsx`：动态从 `projectAttributeSchema.fields.filter(hotkey)` 加一组「属性快捷键」分组，文案"选中标注后，1-9 切换属性值"。
- `useAnnotationHistory`：属性变更走 `update` 命令，与 attribute form blur 同样的 PATCH 路径。

**关键文件**

- 修改：`apps/web/src/pages/Workbench/state/hotkeys.ts`、`apps/web/src/pages/Workbench/state/hotkeys.test.ts`（加 5 例：无选中走 class、有选中走 attribute、boolean toggle、select cycle、hotkey 不存在 fallback）、`apps/web/src/pages/Workbench/shell/{AttributeForm,HotkeyCheatSheet,WorkbenchShell}.tsx`、`apps/api/app/schemas/project.py`

**验收**

- 无选中按 1 → 切第一类别（原行为）。
- 选中 box，schema 有 `{key:"occluded", type:"boolean", hotkey:"2"}` → 按 2 → toggle 该 box `attributes.occluded`。
- vitest 5 例新单测全过。

---

#### D.2 离线队列：多 tab 同步 + queue 详情抽屉 + history tmp_id 替换

**目标**：① 多 tab 共享同一 idb 队列状态（任一 tab 在线后 drain，其它 tab 红点徽章同步消失）；② StatusBar 离线徽章点击不直接 flush，而是弹抽屉显示队列详情 + 单条重试 / 删除；③ 离线 create 时前端用 `tmp_${uuid}` 占位，drain 后把 history 命令链中的 tmp_id 整体替换为后端真实 id。

**前端**

- `apps/web/src/pages/Workbench/state/offlineQueue.ts`：
  - 新增 `BroadcastChannel("anno.offline-queue.v1")`；enqueue / drain / clear 后 `bc.postMessage({type:"changed"})`；
  - 监听 message 触发 `subscribe()` listeners 重新读 idb；
  - `OfflineOp` 加 `tmp_id?: string`（仅 create 操作有），`real_id?: string`（drain 后回填）。
- `apps/web/src/hooks/useOnlineStatus.ts`：既有；多 tab queue change 直接由 BroadcastChannel 推动 listener 更新。
- `apps/web/src/pages/Workbench/state/useAnnotationHistory.ts`：
  - 新增 `replaceAnnotationId(tmp_id, real_id)`：遍历 undo/redo 栈，把命令中所有 `annotationId === tmp_id` 替换为 real_id；同步替换 `before.id / after.id` 嵌套字段。
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`：
  - `handleCreateAnnotation` onError 入 offline queue 时分配 `tmp_id`；optimistic update 用 tmp_id 加进本地 annotations cache；history push `{kind:"create", annotationId: tmp_id, ...}`。
  - `flushOffline` 成功 create 时拿后端真实 id，调 `replaceAnnotationId(tmp_id, real_id)` + `queryClient.setQueryData` 替换 cache。
- 新建 `apps/web/src/pages/Workbench/shell/OfflineQueueDrawer.tsx`：
  - 右侧抽屉（width 360）；
  - 列表行：操作类型徽章（create/update/delete）+ annotation_id（tmp / real）+ 时间 + 错误（如有）+ 重试 / 删除按钮；
  - 顶部按钮：「全部重试」「全部清空」；
  - 单条重试 = 单条 replay；删除 = 从 queue 移除（用户自愿放弃）。
- `apps/web/src/pages/Workbench/shell/StatusBar.tsx`：离线徽章点击改为 `setDrawerOpen(true)` 而非 `onFlushOffline`（flush 走抽屉里"全部重试"）。

**关键文件**

- 修改：`apps/web/src/pages/Workbench/state/offlineQueue.ts`、`apps/web/src/pages/Workbench/state/useAnnotationHistory.ts`、`apps/web/src/pages/Workbench/shell/{WorkbenchShell,StatusBar}.tsx`
- 新建：`apps/web/src/pages/Workbench/shell/OfflineQueueDrawer.tsx`

**验收**

- 离线断网 → 拉框 3 个 → 在线 → 抽屉显示 3 条 → 点"全部重试" → 后端落库 → annotations 拿到真实 id → Ctrl+Z 还原一次后 redo 仍能恢复（说明 history tmp_id 替换正确）。
- 开两个 tab 同时离线，A tab enqueue → B tab StatusBar 徽章红点同步出现（BroadcastChannel）。

---

#### D.3 评论 polish：@ 提及 + 图片附件（画布批注层延后）

**目标**：CommentsPanel 输入框支持 `@`-触发用户选择器，正文内嵌 mention chip；可选图片附件（< 5MB / png / jpg / webp）；@ 用户进通知中心。**画布手绘批注层** 复杂度高（需独立 Konva overlay + 序列化为 svg 路径）→ **延后到 v0.5.6 不在本次范围**，本次留好 schema 占位字段。

**数据模型**

- alembic `0016_annotation_comment_mentions_attachments.py`：
  - `annotation_comments` 加 `mentions: JSONB DEFAULT '[]'`（结构 `[{userId, name, offset, length}]`）+ `attachments: JSONB DEFAULT '[]'`（结构 `[{key, mime, size, name}]`，key 是 MinIO object key）。
  - `annotation_comments` 加 `canvas_drawing: JSONB DEFAULT NULL`（占位字段，本期不消费；为 v0.5.6 画布批注层留位）。

**后端**

- `apps/api/app/db/models/annotation_comment.py` 加三列。
- `apps/api/app/api/v1/annotation_comments.py`：
  - `AnnotationCommentCreate` / `AnnotationCommentUpdate` 加 `mentions / attachments` 字段；pydantic 校验 mentions 中 userId 必须是项目成员；attachments key 必须以 `comment-attachments/` 前缀（在白名单 bucket 内）。
  - create 后遍历 mentions 写通知（复用现有通知中心：每个 mention 的 user_id 写一条 `notification` 行 / 或 audit_log + 通知 30s 轮询）。
- `apps/api/app/api/v1/annotation_comment_attachments.py` 新文件：
  - `POST /annotations/{aid}/comment-attachments/upload-init` → 返回 presigned PUT URL + key；
  - 限制 mime + size。

**前端**

- 新建 `apps/web/src/pages/Workbench/shell/CommentInput.tsx`：
  - contentEditable div + 简单 markdown-style；
  - 监听 `@` 字符 → 浮出 `<UserPicker>` popup（用 `useProjectMembers(projectId)`，过滤匹配输入 prefix）；
  - 选中后插入 `<span class="mention" data-user-id="...">@张三</span>`；
  - 提交时序列化为 `{ body: "评论内容 @张三 后续", mentions: [{userId, name, offset, length}] }`。
- `apps/web/src/pages/Workbench/shell/CommentsPanel.tsx`：
  - 输入区切到 `<CommentInput>`；
  - 渲染历史评论时把 mention chip 高亮（蓝色 hover）+ 点击跳转用户审计追溯。
  - 附件区：上传按钮 → init presigned URL → PUT → 提交评论时附 attachments；评论展示行下方缩略图 + 点击查看大图。
- `apps/web/src/api/annotation_comments.ts`：type 加 mentions / attachments。

**关键文件**

- 新建：`apps/api/alembic/versions/0016_annotation_comment_mentions_attachments.py`、`apps/api/app/api/v1/annotation_comment_attachments.py`、`apps/web/src/pages/Workbench/shell/CommentInput.tsx`
- 修改：`apps/api/app/db/models/annotation_comment.py`、`apps/api/app/api/v1/annotation_comments.py`、`apps/api/app/schemas/`（如有 comment schema 单独文件）、`apps/web/src/pages/Workbench/shell/CommentsPanel.tsx`、`apps/web/src/api/annotation_comments.ts`

**验收**

- 输入 `@` → 弹用户选择 → 选中 → 评论提交 → 被 @ 用户的通知中心收到一条 `comment.mentioned` 通知。
- 上传 1MB png → 评论展示缩略图 + 点击大图。
- 画布批注层留 `canvas_drawing` JSONB 字段；前端不渲染（v0.5.6）。

---

### E · 导出器扩展（1 项）

#### E.1 COCO / YOLO 导出读 attributes

**目标**：`apps/api/app/services/export.py` 的 COCO / YOLO 输出包含 annotation 的 `attributes` 字段（v0.5.4 落地的项目级属性 schema）；下游训练代码直接拿到结构化属性。

**后端**

- `apps/api/app/services/export.py`：
  - **COCO 路径**（line 64-80）：每个 annotation 输出 dict 加 `"attributes": ann.attributes or {}`（COCO 标准允许扩展字段）。同时把 `Project.attribute_schema` 写到顶层 `info.attribute_schema`，便于 ingest 端解析。
  - **YOLO 路径**（line 111-118）：YOLO 文本格式不能扩展，新增伴生文件 `<image_basename>.attrs.json`（per-image），结构 `{ "attributes": [ann1_attrs, ann2_attrs, ...] }`，索引与 `<image_basename>.txt` 行号对齐；同时 zip 包根目录写 `attribute_schema.json`。
  - **VOC（XML）路径**（如已支持）：在 `<object>` 下插 `<extra>` 节点，内部按 attribute schema 顺序输出 `<key>value</key>`。

**前端**

- `apps/web/src/pages/Projects/sections/ExportSection.tsx` 或对应导出 UI：导出选项加复选框「包含属性数据」（默认勾选；不勾选时维持纯 COCO/YOLO 兼容）；POST `/projects/{id}/export?include_attributes=true`。
- `apps/api/app/api/v1/projects.py` 导出端点接受 `include_attributes: bool = True`。

**关键文件**

- 修改：`apps/api/app/services/export.py`、`apps/api/app/api/v1/projects.py`、对应前端导出 UI（项目设置导出 section / Datasets 导出按钮）

**验收**

- 创建带属性 schema 的项目，标注几个框 + 填属性 → 导出 COCO → 解压看 `coco.json` annotation 行有 `attributes` + `info.attribute_schema`。
- 导出 YOLO → 解压看每个图对应的 `.attrs.json` + 根目录 `attribute_schema.json`。
- include_attributes=false 时输出原版兼容格式（关键字段无 `attributes`）。

---

## 实施顺序（建议）

按依赖与风险递增：

1. **A.1 OpenAPI codegen** —— 先把基建打好，后续 schema 改动免漂移；A.2 / B.1 / B.2 / A.4 都受益。
2. **A.2 pytest 脚手架** —— 后续 B.1 / B.2 / A.3 单测都基于它。
3. **A.3 GIN 索引 + 双行 UI** —— migration 简单，UI 改动孤立。
4. **A.4 IoU 阈值** —— migration + 一行 hardcode 替换。
5. **B.1 + B.2** —— project_admin 列表过滤 + 转交逻辑成对落（同一 users.py 文件）。
6. **C.1 + C.2** —— 抽屉与 dropdown 抽取，两处都是组件级改动。
7. **D.1 hotkey 绑定** —— 需要 hotkeys.test.ts 先跑通。
8. **D.2 离线队列** —— 工作量大，影响多个 hook 与 component。
9. **D.3 评论 polish** —— 新组件 + 后端 schema 加列 + presigned 上传链路。
10. **E.1 导出器** —— 单点改动，独立 PR 也行。

---

## 验收（端到端）

按 phase 模版，最终一次性跑：

- `cd apps/api && pytest -q` ✅（含 audit_logs / users role matrix / project_admin scope / 删除转交 4+ 套）
- `cd apps/web && pnpm codegen && pnpm tsc -b && pnpm vitest run` ✅（hotkeys 32+ 例 / iou 10 / 加 D.1 5 例新增）
- `pnpm vite build` ✅
- `alembic upgrade head` / `downgrade -3` 双向通过（0014 GIN + 0015 iou 阈值 + 0016 评论扩展）
- 手动浏览：
  - super_admin / project_admin 视角分别过 UsersPage（B.1）；
  - 删带任务用户 → 转交弹窗（B.2）；
  - 窄屏 < 1024 抽屉拉出（C.1）；
  - 主题切换 dropdown 行为不变（C.2）；
  - 选中标注按 1 切属性（D.1）；
  - 离线 → 抽屉 → 重试（D.2）；
  - 评论 @ 用户 + 上传图片（D.3）；
  - 项目设置改 IoU 阈值即时生效（A.4）；
  - 导出 COCO/YOLO 解压看 attributes（E.1）。

---

## 不在本期范围

- 评论的**画布手绘批注层**（serialize 为 svg 路径 + reviewer 在 ImageStage 上画箭头 / 文字）—— v0.5.6。
- OpenAPI codegen 的 SDK 部分（`@hey-api` 也能生成 fetch SDK），本次只切 type；axios 调用包装维持手写。
- pytest fixture 的 InvitationService / AuditMiddleware 单测扩展（脚手架建好后下一期补）。
- `⋯ 溢出菜单` 全站第 3 个使用方（如 ProjectsPage 卡片菜单）—— 本次只统一两个已知 dropdown。
- 离线队列的 service worker 化（更激进的离线策略）。
- 大文件分片上传 / 数据集 snapshot / 任务批次工作流（roadmap 独立项）。

---

## 关键文件汇总

**新建**

- `apps/web/openapi-ts.config.ts`、`apps/web/src/api/generated/`（gitignore）
- `apps/api/tests/{__init__,conftest,test_audit_logs,test_users_role_matrix}.py`、`apps/api/app/db/test_utils.py`
- `apps/api/alembic/versions/0014_audit_detail_gin_index.py`、`0015_project_iou_dedup_threshold.py`、`0016_annotation_comment_mentions_attachments.py`
- `apps/web/src/components/shell/SidebarDrawer.tsx`、`apps/web/src/components/ui/DropdownMenu.tsx`
- `apps/web/src/pages/Workbench/shell/{OfflineQueueDrawer,CommentInput}.tsx`
- `apps/api/app/api/v1/annotation_comment_attachments.py`

**修改**

- 后端：`apps/api/app/api/v1/{users,audit_logs,projects,annotation_comments}.py`、`apps/api/app/schemas/{user,project,annotation_comment}.py`、`apps/api/app/db/models/{project,annotation_comment}.py`、`apps/api/app/services/export.py`、`apps/api/pyproject.toml`、`apps/api/app/main.py`（仅确认 OpenAPI 端点可用，无实质改动）
- 前端：`apps/web/package.json`、`apps/web/.gitignore`、`apps/web/src/api/{users,projects,annotations,audit,datasets,annotation_comments}.ts`、`apps/web/src/components/shell/TopBar.tsx`、`apps/web/src/App.tsx`、`apps/web/src/pages/Users/UsersPage.tsx`、`apps/web/src/components/users/EditUserModal.tsx`、`apps/web/src/hooks/useUsers.ts`、`apps/web/src/pages/Audit/AuditPage.tsx`、`apps/web/src/pages/Projects/sections/{GeneralSection,ExportSection,AttributesSection}.tsx`、`apps/web/src/pages/Workbench/state/{hotkeys,hotkeys.test,offlineQueue,useAnnotationHistory}.ts`、`apps/web/src/pages/Workbench/shell/{WorkbenchShell,StatusBar,Topbar,CommentsPanel,AttributeForm,HotkeyCheatSheet}.tsx`、`apps/web/src/pages/Workbench/stage/iou.ts`（无改动 / 仅注释）
- 文档：`CHANGELOG.md`（新增 v0.5.5 phase 2 段落）、`ROADMAP.md`（标记完成项）、`DEV.md`（codegen 流程）

---
