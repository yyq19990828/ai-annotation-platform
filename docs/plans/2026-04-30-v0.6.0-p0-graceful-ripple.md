# v0.6.0 P0 任务实施计划

## Context

v0.6.0 聚焦 ROADMAP.md 中标注的 3 个 P0 项。这三个任务分别解决：**安全与质量基线缺失**（生产就能跑但无测试/无限流/弱密码）、**协作并发数据丢失风险**（锁过期静默 + 无冲突检测）、**反馈链路断裂**（用户遇到 bug 只能口头描述，AI 无法批量消费修复）。

三个轨道相互独立，可并行推进。预计总工时约 15-20 人天。

---

## Track 1: 协作并发 —— 任务锁主动续约 + 编辑冲突 ETag

**目标**：锁过期自动续约 + 可视化倒计时 + PATCH 带版本号防覆盖 + 409 冲突 UI。

### 1.1 Backend: 加 version 列

**文件**：
- `apps/api/app/db/models/annotation.py` — 加 `version: Mapped[int] = mapped_column(Integer, default=1)`
- `apps/api/app/db/models/task.py` — 同上
- `apps/api/alembic/versions/0016_add_version_columns.py` — migration

### 1.2 Backend: Annotation PATCH 支持 ETag/If-Match

**文件**：`apps/api/app/api/v1/tasks.py`（`update_annotation` 端点，约 L159-190）
- 读取 `If-Match` header，解析 `W/"<version>"`
- 与 DB 中当前 `annotation.version` 比对
- 不匹配 → 返回 `409 Conflict`，body `{ "reason": "version_mismatch", "current_version": N }`
- 匹配 → 更新成功，`version += 1`，响应头设 `ETag: W/"<new_version>"`
- `AnnotationOut` schema 加 `version: int`

**文件**：`apps/api/app/services/annotation.py` — `update()` 方法内处理 version 递增

### 1.3 Frontend: apiClient 支持自定义 headers

**文件**：`apps/web/src/api/client.ts`
- `patch()` 方法加可选的 `extra?: RequestInit` 参数，merge 到 fetch init

### 1.4 Frontend: 标注更新带 If-Match

**文件**：`apps/web/src/api/tasks.ts` — `updateAnnotation()` 接受 `etag?: string`，拼 `If-Match` header
**文件**：`apps/web/src/types/index.ts` — `AnnotationResponse` 加 `version?: number`

### 1.5 Frontend: 409 冲突弹窗

**新建**：`apps/web/src/components/workbench/ConflictModal.tsx`
- 标题 "编辑冲突"、正文 "该标注已被他人修改"
- 两个按钮：「重载（放弃本地修改）」/「强制覆盖」
- 强制覆盖 = PATCH 不带 If-Match

**文件**：`apps/web/src/hooks/useTasks.ts` — `useUpdateAnnotation` 的 `onError` 检测 409，触发冲突弹窗

### 1.6 Frontend: 锁心跳改为 60s + 倒计时 + 自动重试

**文件**：`apps/web/src/hooks/useTaskLock.ts`
- `HEARTBEAT_INTERVAL_MS` 从 120s 改为 60s
- 新增 `remainingMs` 状态（每秒计算 `expire_at - Date.now()`）
- 心跳失败时先尝试重新 `acquireLock`，成功则清除错误；失败才设 `lockError`
- 返回新增 `remainingMs`、`isExpired`

### 1.7 Frontend: StatusBar 锁倒计时

**文件**：`apps/web/src/pages/Workbench/shell/StatusBar.tsx`
- 接收 `lockRemainingMs` prop
- 显示 `<Icon name="lock" /> 锁剩余 4:23`，< 60s 变红
- **文件**：`apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` — 传 lock 状态给 StatusBar

---

## Track 2: 安全 & 测试基建

**目标**：JWT 生产硬校验、登录限流、密码策略升级、密码重置流程、DB-backed 测试套件。

### 2.1 JWT 生产硬校验

**文件**：`apps/api/app/main.py`（`lifespan` 内，`yield` 前）
```python
if settings.environment == "production" and settings.secret_key == "dev-secret-change-in-production":
    raise RuntimeError("PRODUCTION: default SECRET_KEY detected. Set SECRET_KEY in .env.")
```

### 2.2 登录限流

**文件**：`apps/api/pyproject.toml` — 加 `slowapi>=0.1.9`
**新建**：`apps/api/app/core/ratelimit.py` — `limiter = Limiter(key_func=get_remote_address)`
**文件**：`apps/api/app/main.py` — 注册 `SlowAPIMiddleware`
**文件**：`apps/api/app/api/v1/auth.py` — login 端点上 `@limiter.limit("5/minute")`

### 2.3 密码策略升级

**新建**：`apps/api/app/core/password.py`
- `validate_password_strength(password)` → 返回错误列表
- 规则：≥ 8 位 + 大写 + 小写 + 数字
- 可选 `check_breached(password)` 调 haveibeenpwned k-anonymity API

**文件**：`apps/api/app/schemas/me.py` — `PasswordChange.new_password` 的 `Field(min_length=6)` → `min_length=8`
**文件**：`apps/api/app/schemas/invitation.py` — `RegisterRequest.password` 同上
- 两处 schema validator 都加上 `validate_password_strength` 调用

### 2.4 密码重置流程

**新建 migration**：`password_reset_tokens` 表（id, user_id FK, token UNIQUE, expires_at, used_at, created_at）
**新建**：`apps/api/app/services/password_reset.py` — `create_token()` / `consume_token()`
**新建**：`apps/api/app/db/models/password_reset_token.py`

**文件**：`apps/api/app/api/v1/auth.py` — 加两个公开端点：
- `POST /auth/forgot-password` — 收 email，生成 token（若 SMTP 未配置则打日志）
- `POST /auth/reset-password` — 收 token + new_password，校验强度，更新密码

**新建**：`apps/web/src/pages/Login/ForgotPasswordPage.tsx` — email 输入 + 提交
**新建**：`apps/web/src/pages/Login/ResetPasswordPage.tsx` — token 从 URL 读取，新密码表单
**文件**：`apps/web/src/App.tsx` — 加 `/forgot-password`、`/reset-password` 公开路由
**文件**：`apps/web/src/pages/Login/LoginPage.tsx` — 加 "忘记密码？" 链接

### 2.5 DB-backed 测试套件

**文件**：`apps/api/tests/conftest.py` — 重写，新增：
- `test_db_url` fixture（读 `TEST_DATABASE_URL` 环境变量或默认 `annotation_test` 库）
- `apply_migrations` session 级 fixture（alembic upgrade head）
- `db_session` fixture（per-test SAVEPOINT 隔离：`begin_nested()` + rollback）
- `super_admin` / `project_admin` / `annotator` 三个用户 fixture，各返回 `(User, jwt_token)`
- `auth_headers` fixture

**新建**：`apps/api/tests/test_audit_logs.py` — target_id 过滤 / 组合过滤 / 翻页
**新建**：`apps/api/tests/test_users_role_matrix.py` — 12 个角色矩阵用例
**新建**：`apps/api/tests/test_users_delete_transfer.py` — 409 + 转交 happy path

---

## Track 3: 用户内嵌式 Bug 反馈系统（AI-friendly）

**目标**：右下角 FAB → 抽屉提交（自动捕获上下文 + 可选截图 + 脱敏涂鸦）→ admin BugsPage 管理 → `GET /bug_reports?format=markdown` 直接喂 Claude Code。

### 3.1 Backend: 数据模型

**新建 migration** `0017_bug_reports.py`：
- `bug_reports` 表：id, display_id, reporter_id FK, route, user_role, project_id (nullable), task_id (nullable), title, description, severity (low/medium/high/critical), status (new/triaged/in_progress/fixed/wont_fix/duplicate), duplicate_of_id FK self (nullable), browser_ua, viewport, recent_api_calls JSONB, recent_console_errors JSONB, screenshot_url, created_at, triaged_at, fixed_at, fixed_in_version
- `bug_comments` 表：id, bug_report_id FK, author_id FK, body, created_at

**新建**：`apps/api/app/db/models/bug_report.py`
**文件**：`apps/api/app/db/__init__.py` — 注册新 model

### 3.2 Backend: Schema + Service + Router

**新建**：`apps/api/app/schemas/bug_report.py` — `BugReportCreate`, `BugReportUpdate`, `BugReportOut`, `BugCommentCreate`, `BugCommentOut`
**新建**：`apps/api/app/services/bug_report.py` — `BugReportService`（create / list / get_markdown / cluster）
**新建**：`apps/api/app/api/v1/bug_reports.py` — 端点：
- `POST /bug_reports` — 提交（限流 10/hour）
- `GET /bug_reports` — admin 列表/过滤；`?format=markdown` 直接输出 Markdown
- `GET /bug_reports/mine` — 当前用户自己的报告
- `GET /bug_reports/{id}` — 详情+评论
- `PATCH /bug_reports/{id}` — admin 更新状态
- `POST /bug_reports/{id}/comments` — 加评论
- `POST /bug_reports/cluster` — 去重合并

**文件**：`apps/api/app/api/v1/router.py` — 注册 bug_reports router
**文件**：`apps/api/app/services/audit.py` — `AuditAction` enum 加 `BUG_REPORT_CREATED` 等值

### 3.3 Frontend: API + 自动捕获 + FAB + Drawer

**新建**：`apps/web/src/api/bug-reports.ts` — API 方法
**新建**：`apps/web/src/utils/bugReportCapture.ts` — API 调用 ring buffer (最近 10 次) + console 错误 ring buffer (最近 5 条) + 脱敏
**新建**：`apps/web/src/components/bugreport/BugReportFAB.tsx` — 右下角悬浮按钮（z-index: 100），放 `AppShell` 内
**新建**：`apps/web/src/components/bugreport/BugReportDrawer.tsx` — 抽屉组件：
- 列表态（我的反馈）+ 创建态（标题/描述/严重度/截图）+ 详情态（含评论）
- 截图：`html2canvas` 抓视口 + 涂抹脱敏工具（canvas 画黑块）+ 上传 MinIO
- 安装 `html2canvas` 依赖

### 3.4 Frontend: Admin BugsPage + Settings 反馈 tab

**新建**：`apps/web/src/pages/Bugs/BugsPage.tsx` — 表格 + 过滤 + 详情 + 批量操作
- 路由 `/bugs`，仅 super_admin / project_admin 可访问

**文件**：`apps/web/src/pages/Settings/SettingsPage.tsx` — 加 "我的反馈" tab，调 `GET /bug_reports/mine`

### 3.5 Frontend: 路由 & 权限

**文件**：`apps/web/src/types/index.ts` — `PageKey` 加 `"bugs"`
**文件**：`apps/web/src/constants/permissions.ts` — `ROLE_PAGE_ACCESS` 加 bugs
**文件**：`apps/web/src/App.tsx` — 加 `/bugs` 路由，FAB 放 `AppShell`
**文件**：`apps/web/src/utils/auditLabels.ts` — 加 bug 相关 action label

---

## 执行顺序

```
Phase 1 (安全快赢 + 后端基建)：
  S2.1 JWT guard        ← 5 分钟
  S2.2 登录限流          ← 30 分钟
  S2.3 密码策略          ← 30 分钟
  S1.1-S1.3 version列+ETag ← 先做后端
  S3.1-S3.2 bug数据模型+API ← 先做后端

Phase 2 (测试套件 + 密码重置 + 前端并发)：
  S2.5 DB测试套件        ← 最大工作量
  S2.4 密码重置          ← 中等
  S1.4-S1.7 前端ETag+冲突UI+锁倒计时

Phase 3 (Bug反馈前端)：
  S3.3-S3.5 FAB+Drawer+BugsPage+Settings tab

Phase 4 (收尾)：
  S2.6-S2.8 测试用例编写
  全链路验证 + 文档更新
```

---

## Verification

### Track 1 验证
1. 工作台打开任务 → StatusBar 显示 "锁剩余 X:XX"，每秒更新
2. 等待 60s → 心跳成功续约，倒计时重置
3. 手动删 DB lock 行 → 心跳失败 → 自动重新获取锁成功
4. 两个浏览器同任务 → 第二个看到 "该任务正被其他用户编辑"
5. 同标注两人同时编辑 → 后提交者看到冲突弹窗 → 「重载」刷新数据 / 「强制覆盖」写入

### Track 2 验证
1. 改 `.env` `SECRET_KEY=dev-secret-change-in-production` + `ENVIRONMENT=production` → 启动报错
2. `/auth/login` 连续 6 次错误密码 → 第 6 次返回 429
3. 注册密码 `"123456"` → 提示 "至少 8 位，需包含大小写字母和数字"
4. `/auth/forgot-password` → 生成 token（未配 SMTP 则打日志）→ `/auth/reset-password` 重置成功
5. `TEST_DATABASE_URL=... pytest` → 3 个测试文件全绿，per-test 隔离不互相污染

### Track 3 验证
1. 任意页面点右下角 FAB → 抽屉滑出 → 填标题+描述 → 可选截图 → 提交成功
2. admin 访问 `/bugs` → 看到提交的 bug → 改状态为 in_progress → 加评论
3. 提交者在 Settings → 我的反馈 → 看到状态变更
4. `GET /bug_reports?status=new&format=markdown` → 输出结构化 Markdown（含 route/描述/上下文/截图URL）
5. 同用户同 route 30 分钟内连提 2 次 → 第二次被建议合并
