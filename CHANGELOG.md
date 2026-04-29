# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## 待实现 (Roadmap)

> 两类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）。

---

### A · 代码观察到的硬占位 / 残留 mock

#### 项目模块
- **非 image-det 类型的标注工作台**：image-seg / image-kp / lidar / video-mm / video-track / mm 共 6 类点击「打开」仅显示 toast `类型 X 的标注界面尚未实现`（`DashboardPage.tsx:139`、`ViewerDashboard.tsx:31`）。
- **类别管理**：项目创建后类别（classes）只在 `CreateProjectWizard` 步骤 2 录入，后续无批量编辑 / 导入 / 导出 UI；`PATCH /projects/{id}` 已支持但前端未暴露。
- **项目模板**：当前每次新建项目都从 0 配置类别 / AI 模型；无「从已有项目复制」或「保存为模板」入口。

#### 数据 & 存储
- **数据集导入面板**：Dashboard 顶部「导入数据集」按钮（`DashboardPage.tsx:170`）与 DatasetsPage 上传按钮（`DatasetsPage.tsx:141`）均为 toast 占位，未实现 OSS / 本地 / 数据库三种声明的来源。
- **存储文件大小统计**：`StoragePage.tsx:163` 明示「文件大小统计将在后续版本中支持」。
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- **文件去重 / hash**：`dataset_items` 没有 `content_hash` 列，相同文件多次上传会产生多份对象存储副本。
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。

#### AI / 模型
- **AI 预标注独立页**：路由 `/ai-pre` 为占位 PlaceholderPage。Dashboard「AI 预标注队列」卡片永久显示空状态（`AdminDashboard.tsx:107-119`、`DashboardPage.tsx:287-291`）。
- **模型市场**：路由 `/model-market` 占位；项目级 ML Backend 真实选择 / 挂接 UI 缺失（向导步骤 3 仅录入模型名称字符串）。
- **训练队列**：路由 `/training` 占位。
- **预测成本统计**：后端 `prediction_metas` 表已记录 token / 耗时 / 成本，但前端无任何可视化（应进入 AdminDashboard 的成本卡片）。
- **失败预测重试**：`failed_predictions` 表记录但无 UI 触发重试。
- **ML Backend 健康检查**：`MLBackendService` 只在管理员手动点击时探活，无后台周期任务。

#### 用户与权限页（UsersPage）
- **行末「编辑 / 设置」按钮**：`UsersPage.tsx:159-160` 两个 icon button 无 onClick。后端 `PATCH /users/{id}/role` 与 `POST /users/{id}/deactivate` 已就绪，仅缺前端 modal。
- **「API 密钥」按钮**：`UsersPage.tsx:63` 无实现（API key 模型也未建表）。
- **「导出名单」按钮**：`UsersPage.tsx:64` 无实现。
- **「角色」tab 卡片**：仍读取 `data/mock.ts` 的 `roles` 与硬编码 `perms`；应映射到 `constants/permissions.ts` 的真实 `ROLE_PERMISSIONS` 矩阵。
- **「数据组」tab**：硬编码 7 个组名（`UsersPage.tsx:208`），无新建 / 重命名 / 删除；group 仍是 User 表的字符串字段，未升级为关系。
- **「存储与模型集成」面板**：`UsersPage.tsx:246-269` 全部 mock 数据，应对接 `/storage/health` 与 `/projects/{pid}/ml-backends`。
- **邀请管理**：当前邀请发出后只返回一次性链接，缺少「我邀请过的人」列表 / 手动撤销 pending 邀请 / 重发邀请等运营功能（`user_invitations` 表已建好）。

#### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**：语言 / 主题 / 时区 / 通知偏好均无（依赖 i18n / 主题基础设施先建立）。
- **系统设置可编辑**：本期 `GET /settings/system` 是只读 .env mirror，缺 PATCH。需要 `system_settings` 表 + 启动时 env 优先加载、表项作为 override。

#### 审计日志页（AuditPage）
- **导出 CSV / JSON**：合规场景需要离线归档。
- **自动刷新 / 实时流**：当前需手动点刷新；可加 30s 轮询或 SSE。
- **detail_json 字段级筛选**：现在只能按 `action / target_type / actor_id / 时间`，不能按「角色变更：role: super_admin」这种字段值过滤（需 PG GIN 索引）。
- **正向反向追溯视图**：点用户 / 项目 → 跳转该对象的完整审计时间线。

#### TopBar / Dashboard 控件
- **全局搜索**：TopBar 的 `<SearchInput placeholder="搜索项目、任务、数据集、成员..." kbd="⌘K">` 无 `value` / `onChange` / 提交 handler；后端无 `/search` 端点。
- **通知 / 刷新按钮**：TopBar 两个 icon button 无 onClick；通知中心可基于 audit_logs（`actor_id == self` 或 `target_id 关联到自己的项目/任务`）实时弹卡。
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast「切换工作区面板已展开」；Organization 表已存在但前端无切换 UI。
- **Dashboard 高级筛选 / 网格视图**：`DashboardPage.tsx:198-199` 两个 Button 无 onClick。

#### Annotator / Reviewer 工作台
- **AnnotatorDashboard `weeklyTarget = 200` 硬编码**（`AnnotatorDashboard.tsx`）：应来自项目级 / 用户级偏好。
- **ReviewerDashboard 无个人最近审核记录** —— 当前只有跨项目待审列表，无历史回看。

#### 一致性 / 体验
- **路由守卫粒度**：`RequirePagePermission` 当前按页判定；项目级权限（如「仅自己项目」）仍依赖后端校验，前端尚未在 `/projects/:id/annotate` 做同等检查 → 进入工作台后才被后端 403，体验差。
- **破坏性操作 confirm**：所有删除流程已用 Modal 二次确认，但仍需审视一遍 `confirm(...)` 是否漏网。
- **错误边界**：`App.tsx` 顶层无 React `<ErrorBoundary>`，任意子组件抛错白屏。
- **WebSocket 重连**：`usePreannotationProgress` 断线后无自动重连。

---

### B · 架构 & 治理向前演进

#### 安全
- **JWT secret 生产硬校验**：启动时若 `environment=production` 且 `secret_key=="dev-secret-change-in-production"` 应直接拒绝启动。
- **登录限流**：`/auth/login` 当前无 N 次失败锁定 / IP 限速，存在暴力破解面。建议接 `slowapi` 或 Redis 计数。
- **邀请频率限流**：单 actor 单日邀请上限，避免 spam。
- **密码策略升级**：当前仅长度 ≥ 6；建议 8 位 + 复杂度 + breached-password 校验（haveibeenpwned k-anonymity API）。
- **密码重置流程**：当前无「忘记密码」入口；可复用 `user_invitations` 基础设施增 `password_reset_tokens` 表。
- **2FA / TOTP**：super_admin 必选、其它角色可选。
- **API 密钥**：UsersPage 已有按钮，需 `api_keys` 表 + scope + revoke + 最后使用时间。
- **会话管理**：当前 token 过期前不可撤销；需 token blacklist 或 jti + Redis。「在所有设备登出」功能。
- **审计日志不可变**：当前 super_admin 仍可 `DELETE FROM audit_logs`；建议 PG row-level security 或 trigger 拒绝 DELETE/UPDATE。
- **CORS 收紧**：当前 `allow_origin_regex=r"http://localhost:\d+"`，production 需替换为白名单。
- **HTTPS 强制 / HSTS / CSP**：production 中间件层补齐。

#### 治理 / 合规
- **审计日志归档**：按月 PARTITION + 冷数据 S3 归档；后台 cron job 触发。
- **审计日志全文索引**：`detail_json` 加 GIN 索引以支持快速查询；超大数据量考虑 ES / OpenSearch 镜像。
- **审计中间件双行去重**：当前 metadata 行 + 业务 detail 行各写一行；可加 `request_id`（来自请求头或自动生成）做关联，UI 提供合并视图。
- **数据导出审计**：`GET /projects/{id}/export` 等批量数据导出应触发审计 + 下载者签名水印。
- **GDPR / 个人信息删除**：被删用户的 audit 行需要做 actor_email 脱敏（保留 actor_id 关联，原始邮箱另存或抹除）。
- **通知中心 / 事件总线**：基于 audit_logs 派生面向用户的通知（被邀请、审核通过、AI 完成等），前端 TopBar 通知按钮承接；后端可用 Redis Pub/Sub 实时推送。
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

#### 可观测性
- **结构化日志**：当前使用 `logger.warning` 普通字符串；引入 `structlog` 或 `loguru` + JSON 输出便于聚合（Loki / ELK）。
- **request_id / trace_id**：中间件注入并写入 audit_logs 的 detail，便于跨表追溯。
- **Prometheus metrics**：暴露 `/metrics`（FastAPI 请求时延、Celery 队列长度、数据库连接池、ML Backend 健康）。
- **Sentry**：前后端 error tracking。
- **健康检查拆分**：现在 `/health` 只返回 `{status: "ok"}`；拆为 `/health/db`、`/health/redis`、`/health/minio`、`/health/celery` 便于编排（k8s readiness）。

#### 性能 / 扩展
- **AuditMiddleware 写入异步队列**：当前每写请求一次 INSERT，写流量上来后改 Redis Stream / Kafka 异步消费，主请求 < 1ms 旁路。
- **Audit / Task / Annotation 列表 keyset 分页**：当前 OFFSET 在大表上慢；改为 `(created_at, id) > (?, ?)` 游标分页。
- **Predictions 表分区**：按 `project_id` 或 `created_at` PARTITION，单项目预测量大时查询性能下降。
- **N+1 / 关联预加载**：`GET /audit-logs` 当前对每行额外 `db.get(User, actor_id)` 回填 actor_email；改为单 JOIN 批量取。
- **数据库连接池调优 + 监控**：当前 `create_async_engine` 默认池，无 `pool_size / max_overflow / pool_recycle`。
- **WebSocket 多副本**：Redis Pub/Sub 已就位，但生产横向扩 uvicorn 副本时需测试 sticky session 与 broadcast。
- **CDN / 图片缩略图**：`dataset_items` 缺缩略图字段；标注页加载大图慢。

#### 测试 / 开发体验
- **后端单元测试 / 集成测试**：`apps/api/tests/` 目前空缺；至少为 InvitationService、AuditMiddleware、权限工厂建测试 fixture（pytest + pytest-asyncio + httpx ASGI transport，本次冒烟脚本可改造为基础套件）。
- **前端单元测试**：vitest + React Testing Library 覆盖 hooks 与关键组件（Modal、InviteUserModal 状态机、RegisterPage 三态）。
- **E2E 测试**：Playwright 录制邀请→注册→标注→审核→审计核心 5 条用户流程。
- **OpenAPI → TS 类型生成**：当前前后端 schema 手动同步（`apps/web/src/api/*.ts` vs `apps/api/app/schemas/*.py`），易漂移；接 `openapi-typescript` 或 `@hey-api/openapi-ts`。
- **CI/CD pipeline**：`.github/workflows/` 缺；至少 lint + tsc + pytest + 镜像构建。
- **预提交钩子**：husky + lint-staged + ruff + tsc。

#### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **主题切换**：CSS 变量已就绪，但 TopBar 无 toggle；增加日间 / 夜间 / 跟随系统三档。
- **无障碍**：ARIA 属性极少（仅 Modal `role=dialog` 和 `aria-label="关闭"`）；Lighthouse Accessibility 分数应作为 PR gate。
- **响应式**：`gridTemplateColumns: "220px 1fr"` 等硬编码栅格在 < 1024px 下错位；Sidebar 缺折叠态。

#### 文档
- **部署文档**：缺 production 部署清单（环境变量、TLS、备份、初次 bootstrap_admin 步骤）。
- **安全模型文档**：RBAC 矩阵、审计字段释义、邀请流程时序图。
- **API 使用指南**：FastAPI 自动 `/docs` 已有，但缺示例与最佳实践（特别是 ML Backend 协议、WebSocket 订阅）。

---

### 优先级建议（参考）

| 优先级 | 候选项 | 理由 |
|---|---|---|
| **P0** | 后端测试套件、JWT secret 生产硬校验、登录限流、密码重置流程 | 安全 / 质量基线，缺它们生产风险高 |
| **P1** | 数据集导入面板、TopBar 通知中心、UsersPage 残留 mock 接通、API 密钥 | 用户每天面对，残缺感最强 |
| **P1** | 路由守卫粒度（项目级前端校验）、错误边界、WebSocket 重连 | 体验 / 可靠性 quick win |
| **P2** | 非 image-det 工作台、AI 预标注独立页、模型市场 | 体量大，按业务优先级排队 |
| **P2** | 审计日志归档 / 全文索引、AuditMiddleware 队列化 | 当前数据量未到瓶颈，监控触发再做 |
| **P3** | i18n、主题切换、SSO、2FA | 客户具体需求驱动 |

---

## [0.4.6] - 2026-04-29

### 新增

#### 平台 / 治理基座（一次性兑现 4 项硬占位）

##### 审计日志（`/audit`）
- 新增 `audit_logs` 表（actor_id / actor_email / actor_role / action / target_type / target_id / method / path / status_code / ip / detail_json / created_at）+ 4 条索引；alembic 迁移 `0005_governance.py`
- 新增 `AuditService.log()` 业务显式打点 + `AuditAction` 枚举（17 种业务动作）
- 新增 `AuditMiddleware`（`apps/api/app/middleware/audit.py`）：异步、错误隔离、独立 session，自动捕获所有 `POST/PATCH/PUT/DELETE` 写请求 metadata；`/auth/login`、`/auth/register`、`/auth/me/password` 因含密码 body 跳过中间件，由路由内显式 audit
- 新增 `GET /api/v1/audit-logs`（super_admin only，分页 + 按 action / target_type / actor_id / 时间区间过滤）
- 新增 `/audit` 页（`AuditPage.tsx`）：FilterBar（仅业务 / 全部 / 按动作 / 按对象 / 按操作人）+ 表格（时间 / 操作人+role badge / 动作 / 对象 / IP / 状态码彩色 badge / 详情 Modal 显示 detail JSON）
- AdminDashboard 新增「近期审计活动」卡片：取最近 8 条业务事件，点击「查看全部」跳 `/audit`
- 新增 `apps/web/src/utils/auditLabels.ts`：action → 中文映射

##### 邀请制注册（B 方案，落地 CHANGELOG 既定设计）
- 新增 `user_invitations` 表（id / email / role / group_name / token UNIQUE / expires_at / invited_by / accepted_at / accepted_user_id）+ 部分索引 `WHERE accepted_at IS NULL`
- 新增 `InvitationService`（`create / resolve / accept`）：
  - `create`：`secrets.token_urlsafe(32)` 生成 token，`expires_at = now() + invitation_ttl_days`；同 email 旧 pending 自动作废（避免一邮箱多链接歧义）
  - `resolve`：404 / 410（accepted / expired）
  - `accept`：复用 `hash_password` 创建 User + invitation 标记 accepted
- `POST /users/invite` 替换 stub：`super_admin / project_admin` 可调，已激活同 email 用户返回 409；写 audit `user.invite`（detail 含 role / group_name）；返回 `{invite_url, token, expires_at}`
- 新增 `GET /auth/invitations/{token}`（公开）+ `POST /auth/register`（公开）：register 成功直接颁发 access_token + 写 audit `user.register`（actor 即新建用户自身）
- 新增 `PATCH /users/{id}/role` + `POST /users/{id}/deactivate`（super_admin only），均显式写 audit
- 新增 `InviteUserModal.tsx`：两态（form / result）—— form 按 actor 角色过滤可邀请角色（super_admin 可邀全部 / project_admin 仅 reviewer/annotator/viewer），result 显示一次性 invite_url + 复制按钮 + 7 天有效提示
- 新增 `RegisterPage.tsx`（`/register?token=xxx`，脱离 AppShell + RequireAuth）：三态 loading / error（无效 / 过期 / 已使用，全屏 Card 提示「请联系管理员重新发送邀请」）/ form；提交后 `setAuth(token, user)` → `navigate('/dashboard')`
- UsersPage 邀请按钮去掉 toast 占位，挂 `<InviteUserModal />` + `<Can permission="user.invite">` 守卫
- `client.ts` 增加 `publicGet / publicPost`：跳过 Authorization 注入、401 不触发全局 logout（用于公开端点）
- authStore 增加 `setAuth(token, user)` 一次性入口，便于 RegisterPage 与 SettingsPage 复用

##### 设置页（`/settings`）
- 新增 `PATCH /auth/me`（改 name，含 audit `user.profile_update`）
- 新增 `POST /auth/me/password`（旧密码校验，写 audit `user.password_change`，本路径跳过中间件捕获）
- 新增 `GET /settings/system`（super_admin only）：返回 environment / invitation_ttl_days / frontend_base_url / SMTP 配置态（password 永不出口）
- 新增 `SettingsPage.tsx`，左 nav + 右 panel：
  - **个人资料**（所有角色）：邮箱 / 角色 / 数据组只读，姓名可改 + 修改密码块
  - **系统设置**（仅 super_admin）：只读卡片展示当前环境（badge 配色 production 红 / staging 黄 / development 灰）+ 邀请有效期 + 前端地址 + SMTP 主机/端口/账号/发件人状态；底部小字「如需修改，请编辑后端 .env 并重启服务」
- `permissions.ts` 把 `settings` 加入所有角色可访问页（不同角色看到的 section 不同）；`audit` 仍仅 super_admin

##### annotator 个人任务面板
- AnnotatorDashboard「开始标注」按钮智能行为：
  - 0 项目：`disabled` + tooltip「暂无分配项目，请联系管理员」
  - 1 项目：直接 `navigate('/projects/${id}/annotate')`
  - 多项目：弹出 `SelectProjectModal`（按待标任务数排序）
- 新增「我的项目」卡片：表格（项目名 / 类型 / 进度 / 待标 / 打开按钮），数据复用 0.4.5 已加 ProjectMember 过滤的 `GET /projects`，无需新端点
- 新增 `apps/web/src/components/dashboard/SelectProjectModal.tsx`

#### 配置 / 运维
- `app/config.py` 扩展：`environment: Literal["development","staging","production"]`、`frontend_base_url`、`invitation_ttl_days`、`smtp_host/port/user/password/from`、`smtp_configured` property
- 新增 `scripts/bootstrap_admin.py`：从 env (`ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME`) 创建首个 super_admin（幂等，已存在则跳过 + 写 audit `system.bootstrap_admin`）；可在 production 安全运行
- `scripts/seed.py` 顶部加生产保护：`environment=production` 时立即非 0 退出
- `app/main.py` 注册 AuditMiddleware（CORS 之后）；版本号 0.2.0 → 0.4.6

### 变更
- `users.invite` 端点契约变更：从 `{status: "invited"}` stub → `{invite_url, token, expires_at}`，前端 `usersApi.invite` 返回类型同步更新
- `permissions.ts`：`settings` 页对 reviewer / annotator / viewer 开放（仅展示「个人资料」section）
- `apiClient` 新增 `publicGet / publicPost` 方法供公开端点使用，原 `apiClient.get/post/...` 行为不变

### 修复
- `POST /api/v1/users/invite` 不再返回 stub `{"status": "invited"}`
- UsersPage「邀请成员」按钮不再显示虚假 toast「邀请链接已复制」
- AnnotatorDashboard「开始标注」按钮不再仅 toast 占位

---

## [0.4.5] - 2026-04-29

### 新增

#### 项目权限隔离与负责人体系
- 新增 `ProjectMember` 模型 + alembic 迁移 `0004_project_members.py`：项目内 annotator/reviewer 指派关系（UniqueConstraint(project_id, user_id)，CASCADE 项目）
- `apps/api/app/deps.py` 增加 `assert_project_visible` / `require_project_visible` / `require_project_owner` 三个工厂：可见性 = super_admin 全量；project_admin 仅 `owner_id == self`；annotator/reviewer/viewer 仅经 ProjectMember 关联
- `GET /projects` / `GET /projects/stats` / `GET /projects/{id}` 全部按可见性过滤；`GET /tasks` 与 `/tasks/next` 也加同样校验

#### 项目设置接口（兑现 0.4.4 占位）
- `PATCH /projects/{id}`：通用字段更新，权限 `require_project_owner`
- `DELETE /projects/{id}`：硬删 + cascade，权限 `require_project_owner`
- `POST /projects/{id}/transfer`：负责人转移，**仅 super_admin** 可调用，目标必须是 `project_admin` 角色
- `GET / POST / DELETE /projects/{id}/members`：成员 CRUD；`POST` 校验目标 user.role 与指派 role 一致（annotator → ANNOTATOR；reviewer → REVIEWER）

#### `ProjectOut` 字段扩充
- 新增 `owner_id` / `owner_name` / `member_count` 字段，前端 Dashboard「负责人」列与设置页直接消费

#### 前端项目设置页
- 新建 `/projects/:id/settings` 路由（`pages/Projects/ProjectSettingsPage.tsx`）：左侧 4 个 section 切换
  - **基本信息**（`GeneralSection`）：名称 / 状态 / 截止 / 类别 chip / AI 开关与模型，调用 `PATCH`
  - **成员管理**（`MembersSection` + `AssignMemberModal`）：列表 + 「指派标注员」「指派审核员」按钮，按角色过滤候选，去重；移除走二次确认 Modal
  - **负责人**（`OwnerSection`）：仅 super_admin 可见；下拉选 project_admin → 「确认转移」
  - **危险操作**（`DangerSection`）：删除项目，输入项目名二次确认
- 守卫：非 owner 且非 super_admin 直接 `<Navigate to="/unauthorized">`

#### Dashboard / 向导接入
- `DashboardPage.tsx` 项目列「负责人」列改为真数据 `p.owner_name`、`p.member_count`
- 列尾对 owner / super_admin 显示齿轮按钮 → 设置页
- `CreateProjectWizard.tsx` 成功页新增「项目设置」CTA，兑现步骤 2 文案「后续可在项目设置中调整」

#### Hooks / API / Permissions
- `api/projects.ts`：`update / remove / transfer / listMembers / addMember / removeMember`
- `hooks/useProjects.ts`：`useUpdateProject / useDeleteProject / useTransferProject / useProjectMembers / useAddProjectMember / useRemoveProjectMember`
- `hooks/useIsProjectOwner.ts`：`super_admin || owner_id === self` 工具 hook
- `constants/permissions.ts`：新增 `project.transfer`（仅 super_admin）
- `api/client.ts`：新增 `apiClient.patch`

### 变更

- `apps/web/tsconfig.json` 移除已弃用的 `baseUrl`（`paths` 在 bundler 模式下使用相对路径，`vite/tsconfig` 解析依旧）

---

## [0.4.4] - 2026-04-28

### 新增

#### 真实路由（URL 即状态）
- `react-router-dom` v6.28 启用：`main.tsx` 包 `<BrowserRouter>`，`App.tsx` 重写为 `<Routes>` + `AppShell`（`<Outlet />`）
- 路由表：`/login`、`/dashboard`、`/projects/:id/annotate`、`/review`、`/users`、`/datasets`、`/storage`、`/ai-pre`、`/model-market`、`/training`、`/audit`、`/settings`、`/unauthorized`，未匹配路径回落 `/dashboard`
- 新增 `components/routing/RequireAuth.tsx`：未登录跳 `/login` 并通过 `state.from` 承接登录后回跳
- 新增 `components/routing/RequirePagePermission.tsx`：基于 `usePermissions().canAccessPage()` 守卫，无权限重定向 `/unauthorized`
- `Sidebar.tsx` 改用 `<NavLink>`，激活态由 URL 驱动；导航不再依赖 Zustand 内存态
- `LoginPage.tsx` 已登录则 `<Navigate>` 回 `from` 或 `/dashboard`，避免重复登录
- 标注工作台改为按 URL 加载：`WorkbenchPage` 通过 `useParams<{ id }>()` 读取项目 ID，`useProject(id)` 拉取数据；刷新 `/projects/<id>/annotate` 不再掉回 dashboard

#### 新建项目向导
- 新增 `components/ui/Modal.tsx`：通用对话框（`createPortal` + ESC + 点击遮罩 + body 锁滚），无第三方依赖
- 新增 `components/projects/CreateProjectWizard.tsx`：三步向导
  - 步骤 1 类型：项目名称（2-60）+ 数据类型卡片（7 种，与 `TYPE_ICONS` 对齐）+ 截止日期
  - 步骤 2 类别：标注类别 chip（回车快速添加，× 删除，去重，单条 ≤30）
  - 步骤 3 AI 接入：开关 + 预设模型下拉（`YOLOv8` / `GroundingDINO+SAM` / `SAM-HQ` / `GPT-4V` / `Qwen2-VL` / `PointPillars`）+「自定义」自由输入
  - 成功页：显示 `display_id`，CTA「关联数据集」跳 `/datasets`、「打开项目」（仅 image-det）跳工作台
- 新增 `constants/projectTypes.ts`：`PROJECT_TYPES` + `PRESET_AI_MODELS` + `CUSTOM_MODEL_KEY`
- `DashboardPage.tsx`「新建项目」按钮接通向导：`useSearchParams` 控制 `?new=1`，模态状态写进 URL（刷新可保持），仍由 `<Can permission="project.create">` 守卫
- 创建成功后通过 `useCreateProject` 的 `invalidateQueries` 自动刷新项目列表与统计卡

### 变更

#### 移除 Zustand 页面状态
- `stores/appStore.ts` 删除 `page` / `setPage` / `currentProject` / `setCurrentProject`，仅保留 `workspace`
- 全部页面切换改用 `useNavigate()`：`AnnotatorDashboard` / `ReviewerDashboard` / `ViewerDashboard` / `UnauthorizedPage` / `DashboardPage`
- `DashboardPage` / `ViewerDashboard` 不再接收 `onOpenProject` prop，内联 `useNavigate` 决定跳转目标
- Sidebar 移除「标注工作台」顶层入口（无项目上下文不可用），改由 dashboard 列表行点击进入

### 修复
- 解决浏览器刷新一律回到 dashboard 的问题：URL 即真实导航状态
- 浏览器前进/后退按钮恢复正常工作

---

## [0.4.3] - 2026-04-28

### 新增

#### 标注工作台独立全屏模式
- `App.tsx`：`page === "annotate"` 时绕过主布局（TopBar + Sidebar），以全屏独立页面渲染 `WorkbenchPage`，画布、任务列表、AI 面板均可充分展开

#### 两侧面板折叠/展开
- `WorkbenchPage.tsx`：新增 `leftOpen` / `rightOpen` 状态，左侧任务列表与右侧 AI 助手面板均可独立折叠
- 收起后保留 32px 细栏，显示竖排文字（"任务列表" / "AI 助手"）及展开箭头，交互意图清晰
- 展开状态下面板 header 右上角显示收起按钮（`‹` / `›`），操作直观

### 修复
- 修复工作台独立渲染后父节点无高度约束导致画布纵向溢出的问题（`App.tsx` 包裹 `height: 100vh`）

---

## [0.4.2] - 2026-04-28

### 新增

#### 前端 RBAC 权限体系
- 新增 `constants/permissions.ts`：页面访问矩阵（`ROLE_PAGE_ACCESS`）+ 细粒度操作权限矩阵（`ROLE_PERMISSIONS`），20 种权限类型
- 新增 `hooks/usePermissions.ts`：权限 Hook，提供 `canAccessPage()` / `hasPermission()` / `hasAnyPermission()` 接口
- 新增 `components/guards/Can.tsx`：声明式权限守卫组件，包裹 UI 元素按角色显隐
- 新增 `pages/Unauthorized/UnauthorizedPage.tsx`：403 未授权页面，显示当前角色 + 返回首页按钮

#### 侧边栏角色过滤 & 路由守卫
- `Sidebar.tsx` 按当前用户角色过滤导航菜单项，空 section 自动隐藏
- AI 配额卡片仅 super_admin / project_admin 可见
- `App.tsx` 新增路由守卫：无权限页面渲染 UnauthorizedPage，dashboard 页面按角色分发到对应看板组件

#### 角色差异化看板（借鉴 Label Studio / CVAT / Scale AI 等平台经验）
- 新增 `AdminDashboard.tsx`（super_admin）：平台概览 — 用户总数/活跃数、项目状态分布（进度条）、用户角色分布、ML 后端在线状态、任务/标注总量
- 新增 `ReviewerDashboard.tsx`（reviewer）：质检工作台 — 待审核/今日已审/通过率/累计审核统计卡片 + **跨项目待审任务列表**（含文件名、所属项目、标注数），支持直接通过/退回操作
- 新增 `AnnotatorDashboard.tsx`（annotator）：个人工作台 — 待标任务数/今日完成/本周完成/准确率统计 + 近 7 天标注趋势 Sparkline + 周目标环形进度图 + "开始标注" CTA
- 新增 `ViewerDashboard.tsx`（viewer）：只读项目概览 — 精简项目表格（无新建/导出/打开按钮），只读统计卡片
- `DashboardPage.tsx`（project_admin）：保持原有项目总览，"新建项目"/"导入数据集"按钮用 `<Can>` 包裹按权限显隐

#### 后端 Dashboard 统计端点（3 个新端点）
- `GET /api/v1/dashboard/admin`（super_admin）：用户统计、项目状态分布、ML 后端状态、角色分布
- `GET /api/v1/dashboard/reviewer`（reviewer+）：待审核数、今日已审、通过率、**跨项目待审任务列表**（JOIN tasks + projects，返回文件名/项目名/标注数）
- `GET /api/v1/dashboard/annotator`（annotator+）：个人待标任务、今日/本周/累计完成、准确率、近 7 天每日标注计数
- 新增 `schemas/dashboard.py`：AdminDashboardStats / ReviewerDashboardStats / ReviewTaskItem / AnnotatorDashboardStats
- `router.py` 注册 `/dashboard` 路由组

#### 前端 Dashboard API 对接
- 新增 `api/dashboard.ts`：AdminDashboardStats / ReviewerDashboardStats / AnnotatorDashboardStats 类型定义 + API 调用
- 新增 `hooks/useDashboard.ts`：`useAdminStats()` / `useReviewerStats()` / `useAnnotatorStats()` React Query hooks

### 修复

#### Users API 端点实现
- `GET /api/v1/users` 从空壳（返回 `[]`）改为真实数据库查询，支持按 role 过滤，返回 `list[UserOut]`
- UsersPage 成员列表现在展示真实用户数据

#### 用户去重
- 停用 6 个旧 `@example.com` 测试用户（`is_active=False`），消除用户列表中同一人重复出现的问题
- 新增 `viewer@test.com`（观察者）测试账号，补全五种角色覆盖

#### 前端显示修复
- 修复 `roles.ts` 中 `viewer` 角色标签的 Unicode 损坏（`��察者` → `观察者`）

### 变更

#### 权限矩阵

| 角色 | 看板 | 可访问页面 |
|------|------|-----------|
| super_admin | 平台概览 | 全部 11 项 |
| project_admin | 项目总览 | 除审计日志外全部 |
| reviewer | 质检工作台 | 首页 / 质检审核 / 数据集 |
| annotator | 个人工作台 | 首页 / 标注工作台 |
| viewer | 只读概览 | 首页 / 数据集 |

#### 测试账号（密码统一: `123456`）

| 邮箱 | 角色 |
|------|------|
| `admin@test.com` | 超级管理员 |
| `pm@test.com` | 项目管理员 |
| `qa@test.com` | 质检员 |
| `anno@test.com` | 标注员 |
| `viewer@test.com` | 观察者 |

---

## [0.4.1] - 2026-04-28

### 新增

#### 数据集与项目解耦（核心架构升级）
- 新增 `datasets` 表，数据集作为独立实体，与项目多对多关联
- 新增 `dataset_items` 表，文件元数据独立存储（file_name、file_path、file_type、file_size、metadata JSONB）
- 新增 `project_datasets` 关联表，支持一个数据集被多个项目复用、一个项目关联多个数据集
- `tasks` 表新增 `dataset_item_id` 外键，Task 通过 DatasetItem 引用文件，与标注工作逻辑分离
- 保留 Task 上的 `file_name`/`file_path` 冗余字段，向后兼容现有标注流程
- Alembic 迁移 `0003_datasets`：建表 + 自动将现有项目数据迁移为独立数据集（每个 Project 生成同名 Dataset + DatasetItems + ProjectDataset 关联）

#### 数据集 CRUD API（12 个端点）
- `GET /api/v1/datasets` — 数据集列表（分页 + 搜索 + 数据类型过滤）
- `POST /api/v1/datasets` — 创建数据集（需 project_admin 以上角色）
- `GET /api/v1/datasets/{id}` — 数据集详情（含关联项目计数）
- `PUT /api/v1/datasets/{id}` — 更新数据集名称/描述
- `DELETE /api/v1/datasets/{id}` — 删除数据集（CASCADE 删除关联文件）
- `GET /api/v1/datasets/{id}/items` — 数据集文件列表（分页，含 presigned URL）
- `POST /api/v1/datasets/{id}/items/upload-init` — 文件上传初始化（presigned PUT URL）
- `POST /api/v1/datasets/{id}/items/upload-complete/{item_id}` — 上传完成确认（自动获取文件大小）
- `DELETE /api/v1/datasets/{id}/items/{item_id}` — 删除文件
- `POST /api/v1/datasets/{id}/link` — 关联数据集到项目（自动为每个文件创建 Task，更新 project.total_tasks）
- `DELETE /api/v1/datasets/{id}/link/{project_id}` — 取消关联
- `GET /api/v1/datasets/{id}/projects` — 查看关联的项目列表

#### 存储健康检查端点
- `GET /api/v1/storage/health` — MinIO 连接状态检查，返回 `{ status, bucket }`

#### 后端服务层
- 新增 `DatasetService`：数据集 CRUD + 文件管理 + 项目关联（含自动 Task 生成逻辑）
- 新增 `DatasetDataType` 枚举：image / video / point_cloud / multimodal / other

#### 数据集管理页面（DatasetsPage）
- 页头统计行：数据集总数、文件总量、已关联项目数、存储后端
- 主表格：数据集列表，支持按数据类型（图像/视频/3D/多模态）筛选和关键词搜索
- 内联详情面板：点击数据集行展开，显示文件列表（分页）+ 关联项目列表
- 文件列表：文件名、类型 Badge、大小、上传时间
- 项目关联管理：下拉选择关联项目、取消关联按钮
- 新建数据集表单：名称、描述、数据类型选择
- 前端 API 模块 `api/datasets.ts` + 9 个 React Query hooks（useDatasets / useDatasetItems / useCreateDataset / useLinkProject 等）

#### 存储管理页面（StoragePage）
- 页头统计行：存储后端、存储桶名称、数据集数量
- 存储后端状态卡片：MinIO 连接信息 + 实时健康检查（Badge 显示已连接/连接失败）
- 数据集存储概览表格：按数据集展示文件数和关联项目数
- 刷新状态按钮：重新检查 MinIO 连接
- 前端 API 模块 `api/storage.ts` + `useStorageHealth` hook

### 修复

#### Mock 数据枚举迁移
- `mock.ts` User.role 从中文改为英文枚举（`"标注员"` → `"annotator"` 等）
- `mock.ts` User.status 从中文改为英文（`"在线"` → `"online"` 等）
- `mock.ts` Project.status 从中文改为英文（`"进行中"` → `"in_progress"` 等）
- `mock.ts` roles[] key 从中文改为英文枚举，对齐 `UserRole` 类型
- `DashboardPage` 状态比较和 API 查询参数改为英文枚举，通过 `FILTER_STATUS_MAP` 映射
- `UsersPage` 角色显示通过 `ROLE_LABELS` 映射回中文，STATUS_COLORS 键保持中文（匹配已翻译的 statusLabel）
- 修复构建失败：`mock.ts` 中 17 个 TypeScript 类型错误全部消除

### 变更
- 数据库从 12 张表扩展到 15 张表（+datasets、+dataset_items、+project_datasets）
- 文件存储路径格式新增 `datasets/{dataset_id}/{item_id}/{filename}`（原有 `{project_id}/{task_id}/{filename}` 路径保持兼容）
- `App.tsx` 中 datasets 和 storage 页面从占位替换为实际组件

---

## [0.4.0] - 2026-04-28

### 新增

#### WorkbenchPage 真实 API 对接（P0 — 核心里程碑）
- WorkbenchPage 全面替换 mock 数据，使用 React Query hooks 对接后端 API
- 任务队列从 `useTaskList(projectId)` 加载真实任务列表
- 标注绘制通过 `useCreateAnnotation` 实时持久化到数据库
- AI 预测通过 `usePredictions(taskId)` 加载，支持置信度阈值过滤
- 采纳 AI 预测通过 `useAcceptPrediction` 调用，自动关联 `parent_prediction_id`
- 批量预标注通过 `useTriggerPreannotation` + WebSocket 进度推送
- 删除标注通过 `useDeleteAnnotation` 调用后端软删除
- 提交质检通过 `useSubmitTask` 调用，自动释放任务锁
- 真实图片加载：优先使用 presigned URL，fallback 到 SVG 占位图
- 移除 `data/mock.ts` 中 `taskImages` 的依赖

#### 后端新端点
- `GET /tasks?project_id=&status=&limit=&offset=` — 任务列表（分页 + 过滤）
- `DELETE /tasks/{task_id}/annotations/{annotation_id}` — 删除标注
- `POST /tasks/{task_id}/review/approve` — 审核通过（status → completed）
- `POST /tasks/{task_id}/review/reject` — 审核退回（status → pending），支持 reason
- `GET /projects/{id}/export?format=coco|voc|yolo` — 数据导出（COCO JSON / VOC XML ZIP / YOLO TXT ZIP）

#### 任务锁前端集成
- 新增 `useTaskLock` hook：进入任务自动获取锁 → 120s 心跳续约 → 离开/切换自动释放
- WorkbenchPage 锁冲突提示条（409 Conflict 时显示"该任务正被其他用户编辑"）

#### 质检审核流
- 新增 ReviewPage（`/review`）：展示 status=review 的任务列表，支持通过/退回操作
- Sidebar 新增"质检审核"导航入口
- 新增 `useApproveTask` / `useRejectTask` hooks

#### AI 接管率真实统计
- 后端 `GET /projects/stats` 增强：基于 `parent_prediction_id IS NOT NULL` 计算真实 AI 接管率
- `ProjectStats` schema 新增 `total_annotations` / `ai_derived_annotations` 字段
- DashboardPage "AI 接管率" StatCard 自动使用真实数据
- WorkbenchPage 右侧面板 AI 接管率基于当前任务实时计算

#### 数据导出
- 新增 `ExportService`：COCO JSON / Pascal VOC XML / YOLO TXT 三种格式
- 归一化坐标 → 像素坐标自动转换（COCO bbox / VOC xmin-ymax / YOLO cx-cy-wh）
- VOC/YOLO 导出为 ZIP 包，COCO 为单个 JSON 文件
- DashboardPage 项目行新增导出下拉菜单

### 变更
- `tasksApi` 重构：移除旧版 `source` 字段（从 `AnnotationPayload`），新增 `parent_prediction_id` / `lead_time` 字段
- `useTasks` hooks 全部接受 `undefined` 参数（条件查询安全）
- `WorkbenchPage` 从 546 行 mock 驱动重写为 ~500 行 API 驱动
- PageKey 新增 `"review"` 类型

---

## [0.3.0] - 2026-04-28

### 新增

#### 数据模型重构（P0 — 核心架构升级）
- 新增 `organizations` + `organization_members` 表，为多租户预留
- 新增 `ml_backends` 表，模型即 HTTP 服务（对标 Label Studio ML Backend 协议）
- 新增 `predictions` 表，**与 `annotations` 彻底分离**（核心架构决定）
- 新增 `prediction_metas` 表，记录推理耗时 / token 数 / 成本（LLM 时代记账基础）
- 新增 `failed_predictions` 表，失败推理也留痕
- 新增 `task_locks` 表（防止多人同时标同一题）+ `annotation_drafts` 表（自动保存草稿）
- `projects` 扩展 7 个字段：organization_id、label_config、sampling、maximum_annotations、show_overlap_first、model_version、task_lock_ttl_seconds
- `tasks` 扩展 5 个字段：is_labeled（索引）、overlap、total_annotations、total_predictions、precomputed_agreement
- `annotations` 扩展 6 个字段：project_id、**parent_prediction_id**（AI 接管率追踪核心）、parent_annotation_id、lead_time、was_cancelled、ground_truth
- Alembic 迁移 `0002_p0_restructuring`：含角色/状态数据迁移 + 8 张新表 + 3 张表扩展

#### 枚举系统
- 新增 `app/db/enums.py`：UserRole / ProjectStatus / TaskStatus / MLBackendState / AnnotationSource / OrgMemberRole
- 角色从中文字符串迁移为英文枚举（`"超级管理员"` → `"super_admin"` 等）
- 项目状态从中文迁移为英文枚举（`"进行中"` → `"in_progress"` 等）
- 种子脚本 `seed.py` 同步更新为英文枚举值

#### 后端服务层（7 个新 service）
- `StorageService`：MinIO presigned URL 上传/下载（boto3 S3 兼容协议）
- `MLBackendClient`：ML 模型服务 HTTP 客户端（health / predict / predict_interactive / setup / versions）
- `MLBackendService`：ML Backend CRUD + 健康检查 + 获取项目交互式后端
- `PredictionService`：预测创建（含 PredictionMeta 成本记录）+ 失败记录 + 查询
- `AnnotationService`：标注 CRUD + accept_prediction（从预测派生标注）+ 草稿管理 + 统计更新
- `TaskLockService`：任务锁获取/释放/心跳续约/过期清理
- `TaskScheduler`（get_next_task）：Next-task 调度，支持 sequence / uniform / uncertainty 三种采样策略

#### API 层
- 新增 5 组 Pydantic schemas：ml_backend / prediction / task / annotation / organization
- 新增 ML Backend 路由（8 个端点）：CRUD + health + predict-test + interactive-annotating
- 新增文件上传路由（3 个端点）：upload-init（presigned PUT）+ upload-complete + file-url（presigned GET）
- **Tasks 路由从 stub 改为完整实现**（14 个端点）：包括 GET next、predictions 查询、accept prediction、task lock CRUD
- 新增批量预标注端点 `POST /projects/{pid}/preannotate`（触发 Celery 异步任务）
- `ProjectOut` schema 扩展新增字段

#### Celery 异步任务
- `celery_app.py` 配置（broker=Redis，task route: ml queue）
- `batch_predict` 任务：逐批调用 ML Backend → 创建 Prediction + PredictionMeta → Redis Pub/Sub 进度推送
- `ProgressPublisher` 服务：Redis 异步发布预标注进度

#### WebSocket
- 新增 `WS /ws/projects/{pid}/preannotate` 端点，订阅 Redis Pub/Sub 推送预标注实时进度

#### 前端基础设施
- 新增 `types/index.ts` 扩展：Prediction / PredictionShape / MLBackend / TaskLock / TaskResponse / AnnotationResponse 等类型
- 新增 `constants/roles.ts`：英文枚举 → 中文显示映射（ROLE_LABELS / PROJECT_STATUS_LABELS / TASK_STATUS_LABELS）
- 新增 3 个 API 模块：`ml-backends.ts` / `predictions.ts` / `files.ts`
- 新增 3 组 React hooks：
  - `useMLBackends` / `useCreateMLBackend` / `useMLBackendHealth` / `useInteractiveAnnotate`
  - `usePredictions` / `useAcceptPrediction`
  - `usePreannotationProgress`（WebSocket 订阅）/ `useTriggerPreannotation`
- WorkbenchPage `Annotation.source` 对齐新枚举（`"human"` → `"manual"`，`"ai-accepted"` → `"prediction_based"`）

#### 配置与基础设施
- `config.py` 新增 `ml_predict_timeout` / `ml_health_timeout` / `celery_broker_url`
- `main.py` 版本升至 0.2.0，注册 WebSocket 路由
- `docker-compose.yml` 新增 `celery-worker` 服务

#### 文档
- 调研报告拆分：47KB 单文件 → `docs/research/` 下 12 个独立文档（README 索引 + 按平台/主题分文件）
- 便于持续开发中按需更新单个文档，无需编辑巨型文件

### 变更
- `Annotation.source` 语义变更：`"human"/"ai"/"ai-accepted"` → `"manual"/"prediction_based"`（AI 预测不再混入 annotations 表）
- 角色字段从中文字符串改为英文枚举（影响 JWT payload、前端显示）
- 项目状态字段从中文改为英文枚举
- 数据库从 4 张表扩展到 12 张表

---

## [0.2.0] - 2026-04-27

### 新增

#### 认证与权限
- JWT 签发与校验 (`python-jose`)，Token 有效期可配置，payload 含 `sub`（email）和 `role`
- bcrypt 密码哈希（直接使用 `bcrypt` 库，规避 passlib 与 Python 3.14 不兼容问题）
- `GET /api/v1/auth/login` 实现真实账号密码校验并返回 Bearer Token
- `GET /api/v1/auth/me` 实现，依赖 `get_current_user` 返回当前登录用户信息
- RBAC 权限依赖工厂 `require_roles(*roles)`，不满足条件返回 403
- 后端所有业务接口统一加 Bearer 鉴权，`/health` 与 `/auth/login` 豁免

#### 数据库迁移
- Alembic 异步迁移环境配置（`async_engine_from_config` + `connection.run_sync`）
- 初始 migration `0001_initial_schema`：创建 `users`、`projects`、`tasks`、`annotations` 四张表，含 FK、索引
- 修复 local `alembic/` 目录遮蔽已安装包的 import 问题（统一用 `uv run alembic`）

#### 种子数据
- 幂等种子脚本 `apps/api/scripts/seed.py`（重复执行安全）
- 预置 6 个用户：超级管理员 `admin@example.com`、项目管理员、质检员、标注员 ×3，分属 3 个数据组
- 预置 2 个项目：P-0001 智能门店货架商品检测（image-det）、P-0002 自动驾驶路面障碍分割（image-seg）

#### 前后端联调
- 前端 API 层 (`apps/web/src/api/`)：`client.ts` fetch 封装（自动附加 Bearer）、`auth.ts`、`projects.ts`、`tasks.ts`、`users.ts`
- TanStack Query hooks：`useProjects`、`useProjectStats`、`useProject`、`useCreateProject`、`useTask`、`useAnnotations`、`useCreateAnnotation`、`useSubmitTask`、`useUsers`、`useInviteUser`
- Zustand `authStore`（`persist` 中间件，token + user 持久化到 localStorage）
- Vite dev proxy `/api/v1` → `http://localhost:8000`
- CORS 更新：`allow_origin_regex=r"http://localhost:\d+"` 兼容 preview 随机端口
- Dashboard、Users、Workbench 三个页面全部替换为真实 API，移除 mock 数据依赖
- `ProjectOut` schema 补充 `updated_at` 字段

#### 登录页与路由守卫
- 登录页 `LoginPage.tsx`：邮箱/密码表单、密码显示切换、登录失败错误提示、测试账号提示卡
- `App.tsx` 路由守卫：无 token 时渲染登录页，登录成功后直接跳转主界面
- `TopBar` 右上角显示真实用户姓名/角色（来自 `authStore`），新增退出登录按钮
- `client.ts` 全局 401 拦截：任意接口返回 401 自动调用 `logout()`，清除 token 并跳回登录页

#### 图标
- Icon 组件新增 `eyeOff`、`warning`、`logout` 三个图标

#### 开发环境
- `.claude/launch.json` 配置 web（autoPort）和 api（固定 8000）双服务启动
- Vite 端口改为环境变量驱动（`process.env.PORT`），兼容 preview_start 自动分配端口

### 修复
- `tsconfig.json` `ignoreDeprecations` 值改为 `"5.0"` 以兼容 TypeScript 5.6
- `UsersPage.tsx` 移除未使用的 `ProgressBar` import，消除编译警告
- `appStore` `currentProject` 类型从 mock `Project` 改为 `ProjectResponse | null`

---

## [0.1.0] - 2026-04-27

### 新增

#### 前端 (React + TypeScript + Vite)
- 项目脚手架：pnpm monorepo、Vite 6、TypeScript 5.6、路径别名 `@/`
- 设计 Token 系统：精确移植原型 oklch 色彩、间距、阴影、圆角等 CSS 变量
- 12 个 UI 基础组件：
  - `Button` (5 种变体: default/primary/ghost/ai/danger, 2 种尺寸)
  - `Badge` (7 种变体 + dot 指示器)
  - `Card`、`Avatar`、`ProgressBar`、`SearchInput`、`TabRow`
  - `Sparkline` (SVG 折线迷你图)
  - `StatCard` (统计卡片，含趋势指标和迷你图)
  - `Toast` + Zustand 消息队列 (3.5s 自动消失)
  - `Icon` (53 个 stroke-based SVG 图标)
- AppShell 布局：
  - `TopBar`：品牌标识、工作区切换、全局搜索 (⌘K 占位)、通知铃铛、用户头像
  - `Sidebar`：三级导航 (工作区/智能/管理)、AI 配额进度条
- 项目总览页 (Dashboard)：
  - 4 个统计卡片 (数据总量/已完成/AI 接管率/待审核) 含 sparkline
  - 项目列表表格，支持状态筛选 (全部/进行中/待审核/已完成) 和关键词搜索
  - AI 预标注队列面板 (3 个运行中任务，含进度条和 GPU 信息)
  - 近期活动流 (人工操作 + AI 助手混合时间线)
- 标注工作台页 (Workbench)：
  - 左面板：任务队列、类别选择器 (数字键快捷键)
  - 中央画布：SVG 货架模拟背景、矩形框绘制 (鼠标拖拽)、缩放控制
  - AI 预标注框 (虚线紫色) + 用户确认框 (实线)
  - 右面板 AI 助手：一键预标、全部采纳、置信度阈值滑块、标注列表
  - 键盘快捷键 (B=矩形框, V=平移, 1-5=类别, Delete=删除, ⌘←/→=切换任务)
  - 底部状态栏 (确认数/AI 待审数/当前类别/分辨率/用时/自动保存)
- 用户与权限页 (Users)：
  - 成员表格 (角色/数据组/状态/标注量/准确率)
  - 角色管理卡片 (6 种角色 + 权限标签)
  - 数据组列表 (头像堆叠)
  - 存储与模型集成面板 (OSS/MinIO/Postgres/Claude/GPT-4V/Qwen2-VL)
- 其他导航页面显示"开发中"占位
- Mock 数据层：7 个项目、6 张标注任务图片、12 个用户、6 种角色

#### 后端 (FastAPI + SQLAlchemy)
- FastAPI 应用骨架，CORS 中间件 (localhost:3000)
- Pydantic Settings 配置 (数据库/Redis/MinIO/JWT)
- 4 个 SQLAlchemy 异步模型：
  - `User` (UUID 主键, email, name, role, group, status)
  - `Project` (display_id, type_key, classes JSONB, ai_model, 任务统计)
  - `Task` (file_path, tags JSONB, status, assignee)
  - `Annotation` (source, geometry JSONB, confidence, class_name)
- Pydantic schemas (Project CRUD + Stats, User + Token + Login)
- API 路由骨架：
  - `POST /api/v1/auth/login` — 登录 (stub)
  - `GET /api/v1/auth/me` — 当前用户 (stub)
  - `GET /api/v1/projects` — 项目列表
  - `GET /api/v1/projects/stats` — 统计数据
  - `POST /api/v1/projects` — 创建项目
  - `GET /api/v1/tasks/{id}` — 任务详情
  - `GET /api/v1/tasks/{id}/annotations` — 标注列表
  - `POST /api/v1/tasks/{id}/submit` — 提交质检
  - `GET /api/v1/users` — 用户列表
- `/health` 健康检查端点

#### 基础设施
- Docker Compose：PostgreSQL 16 + Redis 7 + MinIO (含 healthcheck)
- Dockerfile.web：Node 20 多阶段构建 → Nginx 静态托管
- Dockerfile.api：Python 3.12 + uv 依赖管理 → Uvicorn
- Nginx 反向代理配置 (SPA fallback + /api/ 代理 + /ws/ WebSocket)
- 环境变量模板 (.env.example)
- 开发环境初始化脚本 (scripts/setup.sh)
