# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

### 待实现
- 自定义角色创建（UsersPage 角色管理 Tab 的"新建角色"按钮）
- 用户邀请流程（当前 `/invite` 仍为 stub）
- 审计日志页面（审计日志 Tab 占位 → 真实数据）
- 项目级权限（当前为全局角色，不支持"仅限某项目的管理员"）
- 组织/工作区切换（多租户）

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

### 待实现
- 拖拽批量上传 UI
- 文件预览/缩略图
- 数据集版本管理
- 多存储后端管理（OSS / S3）
- 文件去重检测
- 跨数据集搜索

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

### 待实现
- Grounded-SAM-2 ML Backend Demo 部署（端到端验证）
- 交互式 SAM 前端（API 已就绪，v0.5 实现）
- 审计日志 + Webhook 出口
- 多源存储抽象（S3 / 阿里云 OSS）
- 持续训练触发器

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

### 待实现
- WorkbenchPage 完整对接真实 API（当前 hooks 已就绪，mock 数据仍保留作为降级）
- 审计日志 + Webhook 出口
- 数据导出（COCO / VOC / YOLO）
- 持续训练触发器
- 多源存储抽象（S3 / 阿里云 OSS）

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

### 待实现
- Celery + Redis 异步任务队列（AI 推理）
- 文件上传 Presigned URL 直传流程
- WebSocket 实时协同标注 + AI 任务进度推送
- 审计日志、数据导出（COCO / VOC / YOLO）
- 全局搜索 Command Palette
- 通知系统

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

### 待实现 (留白)
- JWT 认证与 RBAC 权限校验
- Alembic 数据库迁移
- 前后端 API 联调 (当前前端使用 mock 数据)
- Celery + Redis 异步任务队列 (AI 推理)
- 文件上传 Presigned URL 直传流程
- WebSocket 实时协同标注 + AI 任务进度推送
- 审计日志、数据导出 (COCO/VOC/YOLO)
- 全局搜索 Command Palette
- 通知系统
