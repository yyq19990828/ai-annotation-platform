# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
