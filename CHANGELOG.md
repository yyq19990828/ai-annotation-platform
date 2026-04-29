# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---


## [0.4.9] - 2026-04-29

### 新增

#### 标注工作台 — 结构骨架（行为等价基线）
- **三层拆分**：`apps/web/src/pages/Workbench/WorkbenchPage.tsx` 由 720 行单文件拆为 `WorkbenchPage`(5 行入口) + `shell/`(`WorkbenchShell` / `Topbar` / `TaskQueuePanel` / `AIInspectorPanel` / `StatusBar` / `HotkeyCheatSheet`) + `stage/`(`ImageStage` / `ImageBackdrop` / `BoxRenderer` / `BoxListItem` / `DrawingPreview` / `ResizeHandles` / `colors`) + `state/`(`useWorkbenchState` / `useViewportTransform` / `useAnnotationHistory` / `transforms` / `hotkeys`)；按 ROADMAP §C.4 「单工作台外壳 + 维度切分画布 + 工具可插拔」三层架构落地，后续扩 polygon / video / lidar 仅注册新 Stage 与新 Tool，不动外壳
- **空图状态**：删除 `ImageBackdrop` 的 SVG 货架占位，改为「图像不可用 + 重试」按钮（清理研发期 mock 残留）

#### 标注工作台 — P0 体验
- **撤销 / 重做**：`useAnnotationHistory` 命令栈支持 create / delete / update / acceptPrediction 四类命令；`Ctrl+Z` undo、`Ctrl+Shift+Z` / `Ctrl+Y` redo；切任务清栈；mutation pending 期间禁用 undo 按钮
- **框 Move / Resize**：选中用户框后渲染 8 个 resize 锚点（4 角 + 4 边中点）+ 框体拖动整体平移；本地 state 显示拖动过程，松手才落 PATCH（节流落库）；几何全程 clamp 到 [0,1]，过小框（< 0.5%）拒收并 toast 提示
- **真视口 transform**：`<canvas>` 用 `transform: translate(tx,ty) scale(s)` 替代原 `width:900*zoom × height:600*zoom` 伪缩放；`Ctrl + wheel` 以光标为锚点缩放（公式 `tx' = cx - (cx - tx)·(s'/s)`）；`Space + drag` 平移；双击空白 fit-to-viewport；`Ctrl+0` 触发 fit
- **状态栏真实化**：`分辨率` 字段从 `task.image_width × task.image_height` 读（dataset_items 新增字段）；新增「光标 (x, y)」字段实时显示图像系坐标；`BoxListItem` 像素坐标也从硬编码 1920×1280 改为读真实尺寸
- **快捷键速查面板**：`?` 弹 `<HotkeyCheatSheet>`；所有快捷键定义集中在 `state/hotkeys.ts` 一份 SoT，cheat sheet 与 keydown 注册都从这里读
- **类别色板自动分配**：> 5 个类别时按 hash(class_name) → OKLCH 色环确定性派生，跨会话稳定；< 5 仍用预设 5 色
- **Toast 抑流**：`handleAcceptAll` 与批量审核都改为终态聚合一条 `已采纳 17/20，3 项失败`，避免每框一刷屏

#### 标注 API
- **`PATCH /api/v1/tasks/{task_id}/annotations/{annotation_id}`**：新增；支持部分更新 `geometry / class_name / confidence`；拒绝改 `task_id / source / parent_prediction_id`（防越权）；写 `audit.action=annotation.update`
- **任务锁心跳续锁**：`create / update / delete annotation` 与 `accept prediction` 四个 mutation 端点在 commit 前自动调 `TaskLockService.heartbeat`，避免长时间画框 lock 过期误报
- **前端 hook**：`useUpdateAnnotation(taskId)` / `tasksApi.updateAnnotation` / `AnnotationUpdatePayload`

#### 数据 & 存储
- **`dataset_items.width / height`**：alembic migration 0008；上传完成（`upload-complete` 与 `upload-zip`）与 `scan_and_import` 自动用 Pillow 解析图像头部（256KB Range fetch，避开整张大图下载）回填尺寸；新增 `Pillow>=10` 依赖
- **`POST /api/v1/datasets/{id}/backfill-dimensions?batch=N`**：管理员补量端点，分批处理存量 image 类型 items（默认 50/批），返回 `processed / failed / remaining_hint`
- **`TaskOut.image_width / image_height`**：列表端点批量 JOIN dataset_items（避 N+1），单端点直接 get，前端状态栏与 BoxListItem 全部用真实尺寸

#### 审核页接画布
- **`<ReviewWorkbench>`**：复用 `<ImageStage readOnly />`，readOnly 时禁用绘制 / move / resize / accept-reject 浮按钮，仅保留 pan / 选中 / wheel-zoom；与标注页共用同一个画布组件
- **diff 三态切换**：「仅最终 / 仅 AI 原始 / 叠加 diff」；diff 模式下已被采纳的 prediction 自动淡化（`opacity: 0.35`）避免与对应 annotation 堆叠；ImageStage 接受 `fadedAiIds` 集合
- **ReviewPage 列表 + Drawer**：行点击不再跳转 Workbench，改为右侧 70vw Drawer 滑入（URL `?taskId=` 同步，浏览器前进后退保留状态，ESC 关闭，左右切上下题）
- **批量操作**：每行 checkbox + 顶部浮条「批量通过 (N)」「批量退回 (N)」；退回弹 `<RejectReasonModal>` 选预设原因（类别错误 / 漏标 / 位置不准 / 框过大或过小 / 其他自定义）；批量 fire 后聚合 toast `已退回 18/20，2 项失败`

### 升级备注

- **alembic upgrade head**：执行 0008 加 `dataset_items.width / height` 两列（nullable，无数据迁移开销）
- **Python 依赖**：`uv sync` 拉 Pillow；alpine 基础镜像需在 Dockerfile 加 `apk add jpeg-dev zlib-dev`，slim 镜像无须改动
- **存量数据**：上线后管理员调用 `POST /datasets/{id}/backfill-dimensions` 给已有 dataset 补尺寸（不调用也能跑，状态栏显示「分辨率 —」直到回填完成）
- 版本号升至 0.4.9

---


## [0.4.8] - 2026-04-29

### 新增

#### 数据 & 存储
- **多桶展示**：`GET /api/v1/storage/buckets` 返回 `annotations` + `datasets` 两桶的 name / status / object_count / total_size_bytes；StoragePage 按桶分卡显示，TopStats 展示总容量
- **文件大小统计**：`DatasetOut` 增加 `total_size` 字段（聚合 `SUM(file_size)`，批量 GROUP BY 避免 N+1）；StoragePage 数据集表新增「容量」列，去除「后续版本支持」占位文案
- **文件 md5 去重**：`dataset_items` 增加 `content_hash(md5)` 列（nullable，带索引）；ZIP 上传计算 md5 跳过同 dataset 内重复文件（新增返回字段 `deduped`）；`upload-complete` 通过 S3 ETag 检测重复 → 409 + `duplicate_of`；`scan_and_import` 同样跳过重复 hash

#### 用户与权限
- **角色 tab 真权限矩阵**：`UsersPage`「角色」tab 不再读 `mock.ts`；从 `ROLE_PERMISSIONS` 枚举所有角色，按 `PERMISSION_GROUPS`（项目/任务/用户数据组/数据集存储/AI审计设置）5 组分块展示，命中权限绿色 ✓ 徽章，未命中灰色占位，viewer 角色零权限仍有完整信息密度
- 新增 `ROLE_DESC`（`constants/roles.ts`）、`PERMISSION_LABELS` + `PERMISSION_GROUPS`（`constants/permissions.ts`）

#### TopBar
- **刷新按钮**：绑定 `queryClient.invalidateQueries()` 全局刷新；正在 fetching 时图标旋转动画
- **通知中心**：铃铛点击弹 `NotificationsPopover`（右侧浮层，点击外部关闭）；后端 `GET /api/v1/auth/me/notifications` 过滤与当前用户相关的审计事件（被邀请/改角色/项目变更），30s 轮询；已读状态存 localStorage；unread_count > 0 时铃铛显示红点；点「全部已读」写 last_read_at

#### 治理 / 合规
- **审计导出**：`GET /api/v1/audit-logs/export?format=csv|json`（max 50000 行，超出 413）支持与 list 相同的所有过滤参数；导出操作自身写 `audit.export` 行；AuditPage 新增「CSV」「JSON」导出按钮
- **自动刷新**：AuditPage 「30s 自动刷新」checkbox，开启时 refetchInterval=30000

#### 可观测性
- **健康检查拆分**：新建 `app/api/health.py`；`/health` 返回 `{status, version, checks: {db, redis, minio}}`；子路由 `/health/db` `/health/redis` `/health/minio` 各返回 `{status, latency_ms}`；k8s readiness 可单独 probe；旧 `@app.get("/health")` 移除
- **X-Request-ID 传播**：新建 `RequestIDMiddleware`（`middleware/request_id.py`）；每个请求自动生成/透传 `X-Request-ID`，写入 `ContextVar`；`AuditMiddleware` 中间件行与 `AuditService` 业务行均在 `detail_json.request_id` 注入，实现跨表完整追溯
- **结构化 JSON 日志**：`app/core/logging.py` 接入 structlog；所有日志输出 JSON（timestamp / level / logger / event / request_id）；`uvicorn.access` 静默不重复输出；适配 Loki / ELK 聚合
- **Prometheus 指标**：`GET /metrics` 端点（不在 `/api/v1` 前缀下，不经过 AuditMiddleware）；`anno_http_requests_total`（method/path/status）、`anno_http_request_duration_seconds`（method/path）由 `RequestIDMiddleware` 在每次 `/api/` 请求后记录
- 版本号升至 0.4.8

#### 性能 / 扩展
- **审计日志 keyset 分页**：`GET /api/v1/audit-logs` 新增可选 `cursor` 参数（base64 `created_at|id`）；返回 `next_cursor` 供下一页 URL 传递；兼容保留 `page/page_size` 参数
- **任务列表 keyset 分页**：`GET /api/v1/tasks` 同样新增可选 `cursor` 参数（base64 `created_at|task_id`）；返回 `next_cursor`；无 `cursor` 时保持原有 `offset` 分页不变
- **N+1 修复**：`list_audit_logs` 改为单 `OUTERJOIN User` 批量回填 `actor_email`，消除每行单次 `db.get(User, actor_id)` 的 N 次查询
- **数据库连接池调优**：`create_async_engine` 显式设置 `pool_size=10, max_overflow=20, pool_recycle=3600`，避免高并发下连接耗尽与连接泄露

---

## [0.4.7] - 2026-04-29

### 新增

#### 数据集导入面板（M1）
- 新增 `ImportDatasetWizard.tsx`：三步向导（基本信息 → 选择文件 → 上传完成），支持拖拽 + 多文件选择
- 新增 `utils/uploadQueue.ts`：promise pool 并发控制（默认 3）+ `putWithProgress` 基于 XHR 的可上报进度的 PUT
- 复用现有后端 `POST /datasets/{id}/items/upload-init` + `upload-complete`（presigned URL → MinIO 直传）
- DashboardPage「导入数据集」按钮接通向导（替换 toast 占位）；DatasetsPage 详情面板「上传」按钮支持向已有数据集追加文件
- 上传过程实时显示每文件进度条 + 总进度；失败可见错误，关闭后状态清零

#### 用户与权限页（M2）
**Group 实体（独立表）**
- 新增 `groups` 表（id / name unique / description / created_at）+ `users.group_id` 外键（ON DELETE SET NULL）；alembic 迁移 `0006_groups.py` 包含从现有 `users.group_name` 字符串 seed Group 行 + 回填 group_id
- 新增 `GET / POST / PATCH / DELETE /api/v1/groups`（super_admin / project_admin），含成员计数聚合 + 审计日志
- 新增 `PATCH /users/{id}/group`：分配/解绑数据组，同步刷新 `users.group_name` 冗余字段，写 audit `user.group_change`

**邀请管理（admin 端）**
- 在 `user_invitations` 加 `revoked_at` 列；alembic 迁移 `0007_invitation_revoked_at.py`
- `UserInvitation` 模型新增 `status` 派生属性（pending / accepted / expired / revoked）
- 新增 `GET /api/v1/invitations?status=&scope=me|all`：列出邀请记录（scope=all 仅 super_admin）
- 新增 `DELETE /invitations/{id}` 撤销 pending；`POST /invitations/{id}/resend` 重置 token + 过期时间，返回新 invite_url；均写 audit
- 新增 `InvitationListPanel.tsx`：状态过滤 + 撤销 / 重发（自动复制新链接）

**用户导出**
- 新增 `GET /api/v1/users/export?format=csv|json`（StreamingResponse）：CSV 含 BOM 兼容 Excel；写 audit `user.export`
- 前端 `usersApi.exportUsers()` 直接触发浏览器下载

**EditUserModal + GroupManageModal**
- 新增 `EditUserModal.tsx`：改角色（仅 super_admin）+ 改数据组 + 内联停用账号二次确认
- 新增 `GroupManageModal.tsx`：组的新建 / 重命名 / 删除（行内编辑 + 二次确认）

**UsersPage 接通 + tab 重构**
- 行末「编辑/设置」按钮接通 EditUserModal（替换原死按钮）
- 顶部「导出名单」按钮接通后端 export，加 `Can permission="user.export"` 守卫
- 「数据组」tab 由硬编码 7 个改为 `useGroups()` 实数据 + 顶部「管理数据组」按钮
- 新增「邀请记录」tab，挂 InvitationListPanel
- `permissions.ts` 新增 `user.export` / `group.manage` / `invitation.manage` 三个 PermissionKey 并写入 ROLE_PERMISSIONS

#### 一致性 / 体验（M3）
- **顶层 ErrorBoundary**：`apps/web/src/components/ErrorBoundary.tsx` 包裹整个 RouterProvider，抛错降级到刷新 / 回到首页 / 折叠堆栈面板，预留 Sentry 钩子注释
- **API 客户端 403 / 5xx 拦截**：`api/client.ts` 在抛 ApiError 前对 403 触发 `toast.warning`、对 5xx 触发 `toast.error`，401 既有逻辑保留；公共端点（`anonymous: true`）跳过
- **Toast 扩展**：`Toast.tsx` 支持 `kind: warning | error`（不同色板与 ttl）
- **项目级路由守卫**：新增 `RequireProjectMember` 包裹 `/projects/:id/annotate`，进入工作台前先 `useProject(id)` 校验权限，403/404 弹回 `/dashboard` + warning toast
- **WebSocket 自动重连**：新增通用 `useReconnectingWebSocket` hook（指数退避 1s→30s，最多 8 次），重构 `usePreannotation` 使用；`WorkbenchPage` 状态栏显示「AI 通道重连中… (n)」/「AI 通道断开」

### 端到端验证

- 后端：`alembic upgrade head` → groups + revoked_at 迁移成功；`/api/v1/groups`、`/invitations`、`/users/export`、邀请重发/撤销 全部冒烟通过
- 前端：`tsc --noEmit` 0 错误；新增组件：ImportDatasetWizard / EditUserModal / GroupManageModal / InvitationListPanel / ErrorBoundary / RequireProjectMember / useReconnectingWebSocket

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
