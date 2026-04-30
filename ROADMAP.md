## 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。

---

### A · 代码观察到的硬占位 / 残留 mock

#### 项目模块
- **非 image-det 类型的标注工作台**：image-seg / image-kp / lidar / video-mm / video-track / mm 共 6 类点击「打开」仅显示 toast `类型 X 的标注界面尚未实现`（`DashboardPage.tsx:139`、`ViewerDashboard.tsx:31`）。
- **类别管理**：项目创建后类别（classes）只在 `CreateProjectWizard` 步骤 2 录入，后续无批量编辑 / 导入 / 导出 UI；`PATCH /projects/{id}` 已支持但前端未暴露。
- **项目模板**：当前每次新建项目都从 0 配置类别 / AI 模型；无「从已有项目复制」或「保存为模板」入口。

#### 数据 & 存储
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。
- **维度回填 UI**：`POST /datasets/{id}/backfill-dimensions` 已实现（用于回填 v0.4.9 之前没有 width/height 的存量 `dataset_items`），但 DatasetsPage 无触发入口；当前需要管理员直接 curl，操作门槛高。
- **大数据集分包 / 批次工作流（task_batch）**：当前 0 处出现 batch / job / partition 概念，单 dataset 关联到 project 时 `DatasetService.link_project()` 一次循环把全部 items 建成 task（[apps/api/app/services/dataset.py:285-322](apps/api/app/services/dataset.py)），1 万+ 量级时项目经理无法做「按交付批次跟踪 / 按批指派 50 个标注员 / 整批退回 / 按批导出」，审核员只能从一个超长队列里挑题，ML 团队拿不到「先标完 batch 1 → 起跑训练 → 用 v1 预标 batch 2」的迭代节奏。详见调研报告 [docs/research/12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md)。
  - **数据模型**：新建 `task_batches` 表 → `id / project_id / dataset_id (nullable, 支持跨 dataset 混合批) / display_id / name / description / status / priority(0-100) / deadline / assigned_user_ids JSONB / total_tasks / completed_tasks / review_tasks / approved_tasks / rejected_tasks / created_by / created_at / updated_at`；`tasks` 加 `batch_id UUID FK nullable index`；alembic migration 给现存 project 各建一个「默认批次」把老 task 全部回填，避免 nullable 字段让前端到处判空。
  - **状态机**：`draft`（PM 配置中）→ `active`（已启用，可领题）→ `annotating`（首次有 task in_progress 自动进入）→ `reviewing`（所有 task 完成自动进入）→ `approved` / `rejected`（终态）→ `archived`（归档）。状态转移规则单独成文档，避免跟 task.status 语义冲突。
  - **创建 / 切批 UI**：项目设置加「批次管理」section（与 General / Members 平级），创建批次时支持三种范围切分策略：① 按 metadata 切（如 `region=华东`）；② 按 item id 列表 / 范围；③ 随机均分到 N 个批次（每批 size 自动算）；批次创建后可设 deadline / priority / assigned_user_ids。
  - **调度联动**：`scheduler.get_next_task()` 增加 `batch_id` 入参；标注员工作台任务队列上方加批次 dropdown；调度器候选池按 `tasks.batch_id IN (active 批次集合) AND user_id IN assigned_user_ids` 过滤；`priority desc` 决定多批次并发时谁先发。
  - **审核流转**：批次进入 `reviewing` 后整批移交审核；ReviewPage 按批次分组，支持「整批通过 / 整批退回」一键操作；退回的批次 status → `rejected`，对应 task 全部回炉重做（status 重置 + 标注员收通知）。
  - **进度可见性**：`ProgressService` 重写聚合：每个批次独立进度条 + 项目总数自动累加；Dashboard 项目卡片把单一「85%」拆成「批次1 100% · 批次2 73% · 批次3 0%」三段。
  - **按批次导出**：`POST /batches/{id}/export` 端点，按批次范围生成 zip / COCO / YOLO；不影响整 dataset 导出（保留 `POST /projects/{id}/export`）；导出走 MinIO **只读**，不复制对象。
  - **存储边界（重要）**：批次是纯 DB 层 / 业务流转层概念，**不动 MinIO**——`DatasetItem` 仍是 MinIO 对象唯一所有者，`Task` 与 `Batch` 都只是引用层；删批次 / 退回批次只动 DB 行，绝不级联删 MinIO 对象（`DatasetItem.file_path` 可能被其它项目 / 其它批次共享）。
  - **审计**：批次创建 / 状态变更 / 整批退回 / 整批删除全部进 audit_logs（`batch_created` / `batch_status_changed` / `batch_rejected` / `batch_deleted`，记 actor / batch_id / before / after / 影响 task 数）。
  - **AI / ML 联动（轻挂钩，重逻辑留给后续）**：批次 `approved` 时埋一个 hook 点（`on_batch_approved(batch_id)`），当前实现为空 / 仅记日志；后续接入「自动触发训练 → 模型反哺下批预标注」的主动学习闭环（参见调研报告 § 5.4 重量方案 C）。
  - **依赖工程伤口（与本条独立但常被混淆）**：① `link_project` 用 `bulk_insert_mappings` 替代循环 `db.add`，1 万 task 从 ~30s 降到 ~1s；② dataset items 列表分页 + 缩略图懒加载；③ task 列表前端虚拟滚动（react-window）。这三件事**不要**跟批次打包做，是分页 / 异步任务的标准工程问题。
  - **不在本条范围**：① 智能切批（按难度 / 类别 / 不确定度自动切）；② 批次级 IAA / 共识合并算法（字段有了，算法单独写）；③ 不可变训练快照 + 主动学习闭环（C 方案，留给 v1.0+）。
  - **验收**：PM 在项目设置里能创建批次（三种范围策略至少 ① ③ 两种）→ 标注员队列按批次过滤 → 批次完成自动进入审核 → 审核员可整批通过 / 退回 → 退回的批次 task 回炉 → 项目进度按批次分段展示 → 按批导出生成 zip → MinIO 桶对象数量在所有以上操作前后保持不变。

#### AI / 模型
- **AI 预标注独立页**：路由 `/ai-pre` 为占位 PlaceholderPage。Dashboard「AI 预标注队列」卡片永久显示空状态（`AdminDashboard.tsx:107-119`、`DashboardPage.tsx:287-291`）。
- **模型市场**：路由 `/model-market` 占位；项目级 ML Backend 真实选择 / 挂接 UI 缺失（向导步骤 3 仅录入模型名称字符串）。
- **训练队列**：路由 `/training` 占位。
- **预测成本统计**：后端 `prediction_metas` 表已记录 token / 耗时 / 成本，但前端无任何可视化（应进入 AdminDashboard 的成本卡片，并向工作台 AI 助手面板透传"本题花费 X 元 / Y tokens"）。
- **失败预测重试**：`failed_predictions` 表记录但无 UI 触发重试。
- **ML Backend 健康检查**：`MLBackendService` 只在管理员手动点击时探活，无后台周期任务。
- **ML Backend 协议契约文档**：前后端 ML 接入点散落在 `MLBackendService` / 工作台 / 模型市场，缺统一协议描述（健康端点 / 预测请求 / 错误格式 / 流式 vs 同步 / `is_interactive` 模式协商等）。

#### 用户与权限页（UsersPage）
- **「API 密钥」按钮**：`UsersPage.tsx:63` 无实现（API key 模型也未建表）。需 `api_keys` 表 + scope + revoke + 最后使用时间。
- **「存储与模型集成」面板**：`UsersPage.tsx:246-269` 全部 mock 数据，应对接 `/storage/health` 与 `/projects/{pid}/ml-backends`。

#### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**：语言 / 主题 / 时区 / 通知偏好均无（依赖 i18n / 主题基础设施先建立）。
- **系统设置可编辑**：本期 `GET /settings/system` 是只读 .env mirror，缺 PATCH。需要 `system_settings` 表 + 启动时 env 优先加载、表项作为 override。

#### 审计日志页（AuditPage）
- **双行 UI 合并视图**：v0.4.8 已在 metadata 行 + 业务 detail 行注入同一 `request_id`，v0.5.5 phase 2 已加 GIN 索引 + `detail_key/detail_value` 字段过滤，**仅剩 UI 折叠** —— 按 `request_id` 把同请求的 metadata 行 + business detail 行合并为单行 + `▸` 展开切换；详情 Modal 双栏（左 business detail、右 request metadata）。

#### TopBar / Dashboard 控件
- **全局搜索**：TopBar 的 `<SearchInput placeholder="搜索项目、任务、数据集、成员..." kbd="⌘K">` 无 `value` / `onChange` / 提交 handler；后端无 `/search` 端点。
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast「切换工作区面板已展开」；Organization 表已存在但前端无切换 UI。
- **Dashboard 高级筛选 / 网格视图**：`DashboardPage.tsx:198-199` 两个 Button 无 onClick。

#### Annotator / Reviewer 工作台
- **AnnotatorDashboard `weeklyTarget = 200` 硬编码**（`AnnotatorDashboard.tsx`）：应来自项目级 / 用户级偏好。
- **ReviewerDashboard 无个人最近审核记录** —— 当前只有跨项目待审列表，无历史回看。
- **Reviewer 实时仪表卡（与标注端 ETA 对称）**：v0.5.2 已为 annotator StatusBar 加 ETA；reviewer 端缺「本日已审 / 待审队列长度 / 通过率（24h 滚动）」三项实时卡片。

#### 协作并发
- **任务锁主动续约**：`useTaskLock` 监听 lockError 弹错；但用户 idle 5 分钟后 lock TTL 到期，**前端无心跳续约 + 无倒计时可视化**。当前依赖刷新发现，体验差。建议：每 60s 心跳 PATCH lock；状态栏显示「锁剩余 4:23」。
- **编辑冲突 ETag**：两人同 task 编辑（lock TTL 缝隙、网络抖动期间），后提交覆盖前者，无 `If-Match`/`version` 字段。建议 Annotation / Task 表加 `version` 列；前端 PATCH 带版本号，409 时浮出「他人已修改 → 重载 / 强制覆盖」二选一。

#### v0.5.5 phase 2 部分落地的延续
- **OfflineQueueDrawer 抽屉 UI + tmpId 端到端接入**：phase 2 已落 `BroadcastChannel("anno.offline-queue.v1")` 多 tab 同步 + `useAnnotationHistory.replaceAnnotationId(tmpId, realId)` 命令栈整体替换；剩余 ① `OfflineQueueDrawer` 抽屉组件（队列详情列表 + 单条重试 / 删除 / 全部清空）；② `WorkbenchShell.handleCreateAnnotation` onError 入队时分配 `tmp_${uuid}`；③ `flushOffline` 成功 create 时拿后端真实 id → 调 `replaceAnnotationId` + `queryClient.setQueryData` 替换 cache；④ `StatusBar` 离线徽章点击改为 `setDrawerOpen(true)`。
- **评论 polish（@ 提及 + 附件 + 画布批注层）**：alembic 0016 给 `annotation_comments` 加 `mentions JSONB DEFAULT '[]'` + `attachments JSONB DEFAULT '[]'` + `canvas_drawing JSONB`；后端 `AnnotationCommentCreate` 校验 mentions.userId 必须是项目成员、attachments key 必须以 `comment-attachments/` 前缀；新增 `POST /annotations/{aid}/comment-attachments/upload-init` 返回 presigned PUT URL；前端新建 `CommentInput.tsx`（contenteditable + `@` 触发 UserPicker popup + 提交序列化 mentions[]）；mention chip 点击跳转用户审计追溯；ReviewWorkbench 加 Konva overlay 序列化为 svg 路径，存 `canvas_drawing`，annotator 端可见 reviewer 红圈批注。
- **导出 UI「包含属性数据」复选框**：后端 `?include_attributes=` 已就位（默认 true）；待 `ExportSection` 抽出（DashboardPage 当前 inline `<select>`）后在前端暴露 toggle，不勾选时输出原版兼容格式。
- **OpenAPI codegen 完整迁移**：v0.5.5 phase 2 已落基建（dep + config + scripts + .gitignore）；剩余 ① 跑一次 `pnpm codegen` 生成 `src/api/generated/`；② 把 `src/api/{users,projects,annotations,audit,datasets}.ts` 顶部手写 `interface XxxResponse {...}` 替换为 `export type { XxxResponse } from "./generated/types.gen"`；③ 在 5 个高频 type 全部切到 generated 后启用 `prebuild` gate。
- **后端 DB-backed pytest 套件**：v0.5.5 phase 2 已落 scaffold（`pyproject.toml [project.optional-dependencies] test` + `[tool.pytest.ini_options]` + `tests/conftest.py` 含 app_module / httpx_client fixture + `test_smoke.py` 5 例 sanity）；剩余 ① 独立 `TEST_DATABASE_URL`（如 `postgresql+asyncpg://...annotation_test`）+ alembic upgrade head per session；② SAVEPOINT 嵌入事务实现 per-test 隔离；③ super_admin / project_admin / annotator JWT 三角色 fixture；④ `test_audit_logs.py`（target_id 过滤 / 组合过滤 / 自记录 detail_filter）+ `test_users_role_matrix.py`（矩阵守卫 12 用例）+ `test_users_delete_transfer.py`（409 + 转交 happy path）。
- **属性 schema 余项**：① AI 预标自动携带 `attributes.description` 字段；② 属性变更接 audit_logs（独立 action `annotation.attribute_change`，便于审计字段级历史）。
- **AttributeForm hotkey 1-9 与类别快捷键的可视化协调**：phase 2 已实现"无选中走类别 / 选中态走属性"上下文优先级 + KeyBadge 提示；HotkeyCheatSheet 仍按静态分组渲染，需改为读取 `currentProject.attribute_schema.fields.filter(hotkey)` 动态注入「属性快捷键」分组，文案"选中标注后，1-9 切换属性值"。

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
- **数据导出审计**：`GET /projects/{id}/export` 等批量数据导出应触发审计 + 下载者签名水印。
- **GDPR / 个人信息删除**：被删用户的 audit 行需要做 actor_email 脱敏（保留 actor_id 关联，原始邮箱另存或抹除）。
- **通知中心实时推送**：v0.4.8 30s 轮询已落；待升级为 Redis Pub/Sub WS 推送（与下面 WebSocket 多副本一起做）。
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

#### 可观测性
- **Sentry**：前后端 error tracking。
- **Celery / ML Backend 指标**：v0.4.8 已加 HTTP metrics + DB pool + `/health/{db,redis,minio}`；缺 Celery 队列长度、Worker 心跳、ML Backend 平均延迟 / 失败率。
- **`/health/celery`**：v0.4.8 留下的待办；做成 broker ping + active worker count。
- **用户内嵌式 Bug 反馈系统（AI-friendly）**：当前用户遇到 bug 只能口头反馈或外部 IM，反馈内容碎、缺上下文、AI 无法批量消费修复。需要把反馈做成**结构化产物**——不是「让用户填表」，而是「自动捕获上下文 + 用户少量补述 + 直接给 Claude Code 消费」的全链路。
  - **数据模型**：`bug_reports` 表 → `id / display_id / reporter_id / route / user_role / project_id (nullable) / task_id (nullable) / title / description / severity (low/medium/high/critical) / status (new/triaged/in_progress/fixed/wont_fix/duplicate) / duplicate_of_id (nullable) / browser_ua / viewport / recent_api_calls JSONB (最近 10 次 method+url+status+ms) / recent_console_errors JSONB (最近 5 条 error msg+stack) / screenshot_url (MinIO key, nullable) / created_at / triaged_at / fixed_at / fixed_in_version`；附 `bug_comments` 表（评论 / 排查记录）。
  - **入口**：右下角浮动 FAB「反馈」按钮（每页常驻，z-index 高于 Modal 但低于 Toast）；点击弹出抽屉而非全屏 Modal，避免打断用户操作。
  - **自动上下文捕获（核心）**：提交时前端无感采集 → 当前 `location.pathname + search` / `useAuth()` 角色 / `navigator.userAgent` / `window.innerWidth × innerHeight` / `axios` 拦截器维护的最近 10 次请求 ring buffer / `window.onerror` + `unhandledrejection` 维护的最近 5 条错误 ring buffer / 当前路由对应的 project_id / task_id（从 URL 或 React Query cache 读）。**用户只需填「描述 + 是否截图」两项**。
  - **截图**：用 `html2canvas` 抓当前视口（不抓全页避免巨大），生成 base64 → 上传 MinIO（独立 bucket `bug-screenshots`，TTL 30 天可配）；提交前显示预览 + 一个简单的涂抹/打码工具（canvas 画黑块），便于用户脱敏掉真实图像 / 客户名 / token。
  - **AI 消费接口（差异化关键）**：`GET /bug_reports?status=new&format=markdown` 一次吐 N 个未处理 bug 的完整 markdown 报告（含 route / 描述 / 自动上下文 / 截图 URL / 复现要素），结构稳定可被 Claude Code 直接 ingest；配合 `PATCH /bug_reports/{id}/status` 让 AI 修完自己改状态、写 fix commit hash、关联 fixed_in_version；可选 `POST /bug_reports/cluster` 调内置 LLM 把相似 bug 合并到 `duplicate_of_id`。
  - **管理 UI（BugsPage，admin only）**：列表页按 status × severity × route 过滤；点开看「自动上下文 + 用户描述 + 截图 + 评论」一体化；批量操作「标记已 triaged」「合并为重复」「指派给 super_admin / project_admin」。
  - **反馈者侧 UI**：SettingsPage 加「我提交过的反馈」tab，看自己提交的所有 bug 当前状态；状态变 `fixed` 时通知中心推一条「你提交的 bug #B-1234 已修复」。
  - **隐私 & 安全**：① 截图 bucket 不公开，签发短期 presigned URL；② 自动捕获的 `recent_api_calls` 必须脱敏 Authorization header / token query 参数 / 密码字段；③ 用户可选择「不附截图」「不附 API 调用」；④ 反馈者只能看自己提交的，admin 才能看全量。
  - **限流 & 反 spam**：单用户每小时 ≤ 10 条；同一 route + 相似 description（embedding 距离）30 分钟内合并为同一条。
  - **审计**：bug 状态流转进 audit_logs（`bug_status_changed` / `bug_assigned`），admin 关闭 bug 时强制写 resolution 文字。
  - **不在本条范围**：① 自动 Sentry / 错误堆栈对接（独立 Sentry 条已在本节）；② 内置 AI 自动写 PR（更靠后的差异化方向，先把数据 pipeline 跑通）；③ 用户互投 bug 优先级 / upvote（不需要）。
  - **验收**：用户在任意页面点 FAB → 填一句话 + 可选截图 → 提交 → admin 在 BugsPage 看到带完整上下文的报告 → `GET /bug_reports?format=markdown` 输出可直接喂 Claude Code 修复 → 修复后用户在 SettingsPage 看到状态变更 → MinIO 截图 30 天后自动清理。

#### 性能 / 扩展
- **AuditMiddleware 写入异步队列**：当前每写请求一次 INSERT，写流量上来后改 Redis Stream / Kafka 异步消费，主请求 < 1ms 旁路。
- **Annotation 列表 keyset 分页**：v0.4.8 已对 audit_logs / tasks 改造；annotations 仍单次拉全（`useAnnotations` task 内全量），单任务 1000+ 框时阻塞渲染。
- **Predictions 表分区**：按 `project_id` 或 `created_at` PARTITION，单项目预测量大时查询性能下降。
- **WebSocket 多副本**：Redis Pub/Sub 已就位，但生产横向扩 uvicorn 副本时需测试 sticky session 与 broadcast 不重复。
- **useInfiniteQuery 缓存 GC**：工作台调置信度阈值会创建新 `["predictions", taskId, undefined, debouncedConf]` query key；旧 key 默认 5min GC，长时间调阈值会内存增长。建议 `cacheTime: 30s` for predictions / 切题时手动 `removeQueries`。

#### 测试 / 开发体验
- **前端单元测试**：v0.5.2 已落 vitest 基座，phase 2 累计 42 例（hotkey 32 + iou 10）；需扩展覆盖 hooks（`useAnnotationHistory` batch 命令、`useClipboard` 偏移粘贴、`useSessionStats` ring buffer、`useAnnotationHistory.replaceAnnotationId`）与关键组件（Modal、InviteUserModal 状态机、RegisterPage 三态、`<DropdownMenu>` 键盘导航）。
- **E2E 测试**：Playwright 录制邀请→注册→标注→审核→审计核心 5 条用户流程。
- **CI/CD pipeline**：`.github/workflows/` 缺；至少 lint + tsc + pytest + 镜像构建 + vitest（v0.5.2 起）+ `pnpm codegen` 校验前后端 schema 同步（依赖前述 codegen 完整迁移）。
- **预提交钩子**：husky + lint-staged + ruff + tsc + vitest run --changed。

#### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **无障碍**：ARIA 属性极少（仅 Modal `role=dialog` 和 `aria-label="关闭"`，phase 2 `<DropdownMenu>` 加了 role=menu / menuitem + 键盘导航）；Lighthouse Accessibility 分数应作为 PR gate。

#### 文档
- **部署文档**：缺 production 部署清单（环境变量、TLS、备份、初次 bootstrap_admin 步骤）。
- **安全模型文档**：RBAC 矩阵、审计字段释义、邀请流程时序图。
- **API 使用指南**：FastAPI 自动 `/docs` 已有，但缺示例与最佳实践（特别是 ML Backend 协议、WebSocket 订阅）。
- **快捷键文档**：v0.5.2 后工作台快捷键超过 30 条，HotkeyCheatSheet 是 SoT 但缺独立 Markdown 用户文档（QA / 运营培训用）。

---

### C · 标注工作台专项优化（性能 / 界面 / 标注体验）

> 现状基线（截至 v0.5.5 phase 2）：`WorkbenchShell` 三层架构（shell + stage + state）已稳定；Konva 画布 / 4 Layer / 虚拟化任务标注列表 / blurhash / Minimap / 阈值服务端化 / 批量编辑 / IoU 项目级阈值 / ETA / 智能切题 / polygon 编辑闭环 / 项目级属性 schema + hotkey 绑定 / 离线队列 + 多 tab 同步 / 暗色模式 / Lucide 图标体系等已落地。
> 横向参考：CVAT（Konva 画布 + 关键帧插值 + 骨架）、Label Studio（interactive ML backend，SAM 触点）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量类别检测）。

#### C.1 渲染性能 / 大图大量框
- **OpenSeadragon 瓦片金字塔**：当前直接加载完整图像，> 50MP（如卫星/医疗影像）会卡。需要后端切瓦片 + 前端 OpenSeadragon viewport，与 Konva overlay 共生（OSD 当背景，Konva 浮层画矢量）。极大图场景才必要。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。当前 `useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。
- **IoU 去重几何加速**：v0.5.2 用 useMemo + 嵌套循环 O(N×M)，100+ AI × 50+ user 约 5000 次/帧；阈值边界附近变更会触发频繁重算。如果掉帧，上空间索引 rbush（仅同类内分片）。

#### C.2 界面优化（信息架构 / 可见性 / 一致性）
- **`<DropdownMenu>` 第 3+ 个使用方**：phase 2 已抽出通用组件并接入 TopBar 主题切换 + 工作台 Topbar 智能切题 / 溢出菜单；剩余 ProjectsPage 卡片操作菜单、DashboardPage 项目行导出 select 等若干散落 dropdown 收编。
- **HotkeyCheatSheet 分组与搜索**：v0.5.2 后定义已涨到 30+ 条；目前仅按 `group` 分块，缺搜索框 + 「按使用频率排」+ 动态注入项目级属性 hotkey 分组。
- **阈值控件统一**：Topbar 已有数值浮出反馈（`[`/`]`键），AIInspectorPanel 仍是 slider 主入口；可考虑统一为 Topbar 主控 + AI 面板小数值显示。
- **Reviewer 端实时仪表卡**：与 A 中「Reviewer 端实时仪表卡」并跟进，画布外的右侧栏空间可承接。

#### C.3 标注体验（核心生产力杠杆）
- **SAM mask → polygon 化（marching squares / simplify-js）**：与 SAM 接入一起做；polygon 编辑闭环本体已在 v0.5.4 落齐。
- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90% 多选场景（v0.5.2）；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式），按住拖选所有相交框。
- **Shift 锁定纵横比 / Alt 从中心 resize**：v0.4.9 留下的 TODO；resize handle 8 锚点已就位，加修饰键判断即可。
- **SAM 交互式标注（点 / 框 → mask）**：研究报告 `06-ai-patterns.md`「模式 B」P1。最小切片：
  - 后端：`POST /projects/{pid}/ml-backends/interactive`，路由到 `is_interactive=True` 的 ML backend；常驻 GPU 容器 + image embedding LRU 缓存（首次 ~300ms，命中 < 50ms）。
  - 前端：新工具 `S`（SAM 模式），鼠标点击 = positive point、Alt+点击 = negative point、拖框 = bbox prompt；返回多边形以「待确认紫虚线」叠加，Enter 接受 / Esc 取消。
  - 与现有 GroundingDINO 配合：「文本框 → 全图批量同类」 vs 「点 / 框 → 单实例精修」两条路并存。
- **关键帧插值（视频/序列）**：CVAT 同款；标注员只标 1 / 30 / 60 帧，中间线性插值（前端实现，提交时落库为关键帧 + 插值标志）。需配合 `Task.dimension` 字段。
- **类别确认 hint**：刚画完一个框时，AI 后台跑一次单框分类（轻量分类头，非 GroundingDINO），右上角弹「建议：标识牌（92%）」+ 一键采纳。
- **Magic Box / Snap**：粗略画一个大框 → AI 收紧到对象边缘（SAM 推 mask → 取 mask bbox）；同时支持「贴边吸附」（5px 内自动吸附到图像边缘）。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **任务跳过与原因**：标注员可「跳过本题」并选原因（图像损坏 / 无目标 / 不清晰），后端记 `Task.skip_reason` 并自动转 reviewer 复核。
- **History 持久化（sessionStorage）**：刷新页面 history 清空（v0.5.2 仍如此）；将 undo/redo 栈序列化到 sessionStorage，刷新后恢复（5 分钟 TTL，超过清空）。需小心 redo 命令引用的 prediction id 可能已变；与 phase 2 的 `replaceAnnotationId` 协同。
- **`U` 键准确度升级**：v0.5.2 用 `total_predictions desc + total_annotations == 0` 启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）—— 数据量起来后再做。

#### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> 决策：**单工作台外壳 + 按维度切分的画布渲染器 + 工具可插拔**（v0.4.9 Step 1 完成）。当前只支持矩形框 + polygon（`tool: "box" | "hand" | "polygon"`），数据模型 `annotation_type: String(30)` + `geometry: JSONB` discriminated union 已为多类型留好口子。

- **Layer 1 · 工作台外壳（`<WorkbenchShell>`）**：路由 `/projects/:id/annotate`、左侧任务队列、Topbar、AI 助手、状态栏、`useTaskLock` / `useAnnotationHistory` / `useSessionStats` / `useClipboard` / `usePreannotationProgress`。跨所有类型共用 ~80%。
- **Layer 2 · 画布渲染器（按维度切，3 个）**：
  - `<ImageStage>`：image-det / image-seg / image-kp / mm（图像类）共用 ✅
  - `<VideoStage>`：video-mm / video-track，多了**时间轴 + 关键帧插值**控件
  - `<LidarStage>`：lidar 单独，Three.js / WebGL viewport
- **Layer 3 · 工具（画布内插件）**：每个工具实现统一接口 `{ id, hotkey, icon, onPointerDown, ... }`。当前 `<ImageStage>` 注册 BboxTool / HandTool / PolygonTool。
- **Step 2 触发条件**：业务需要 keypoint / video / lidar 时才动；当前 image-det + polygon 双类型不必预先抽象。

---

### 优先级建议（参考）

| 优先级 | 候选项 | 理由 |
|---|---|---|
| **P0** | B § 可观测性：用户内嵌式 Bug 反馈系统（AI-friendly） | 反馈数据结构化 + 自动捕获上下文 + Markdown 端点直接喂 Claude Code 批量修；越早上线，bug → fix 闭环越快，每个迭代周期都受益 |
| **P0** | 后端 DB-backed 测试套件、JWT secret 生产硬校验、登录限流、密码重置流程 | 安全 / 质量基线，缺它们生产风险高 |
| **P0** | A § 协作并发：任务锁主动续约 + 编辑冲突 ETag | 多人协作场景一旦撞上就丢数据；当前 0 防护 |
| **P1** | TopBar 通知中心、UsersPage API 密钥、「存储与模型集成」对接 | 用户每天面对，残缺感最强 |
| **P1** | C.3 SAM 交互式（点/框→mask）+ SAM mask → polygon 化 | 核心差异化，研究报告明确 P1 |
| **P1** | A § 数据：大数据集分包 / 批次工作流（`task_batch` 中量方案） | 1 万+ 量级数据集是绕不开的真实场景，PM 按批指派 / 审核员整批退回 / ML 按批迭代训练全无依托；详见 [docs/research/12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md) |
| **P1** | OpenAPI codegen 完整迁移 + prebuild gate | phase 2 已落基建，把 5 个高频 type 切到 generated 后启用 gate，根治 schema 漂移 |
| **P1** | OfflineQueueDrawer 抽屉 UI + WorkbenchShell tmpId 端到端接入 | phase 2 已落多 tab 同步 + history.replaceAnnotationId，差最后一公里 UI |
| **P1** | 评论 polish：@ 提及 + 附件 + 画布批注层 | reviewer ↔ annotator 沟通刚需，phase 2 已 defer |
| **P1** | 前端 hook + 关键组件单测扩展 | v0.5.2 后逻辑膨胀，无测试就是定时炸弹 |
| **P2** | 非 image-det 工作台（image-seg → keypoint → video → lidar） | 体量大，按业务优先级排队 |
| **P2** | C.3 marquee / 关键帧 / 任务跳过 / 会话级标注辅助 | 业务复杂度起来后必需 |
| **P2** | C.1 OpenSeadragon 瓦片金字塔、IoU rbush 加速 | 千框/4K 大图场景才必要 |
| **P2** | C.3 history 持久化、reviewer 实时仪表卡、HotkeyCheatSheet 升级 | quick win，工时少 |
| **P2** | audit 双行 UI 合并视图（按 request_id 折叠） | phase 2 已加 GIN + 字段过滤；UI 折叠是收尾 |
| **P2** | 审计日志归档（PARTITION）、AuditMiddleware 队列化、useInfiniteQuery 缓存 GC | 当前数据量未到瓶颈，监控触发再做 |
| **P2** | `<DropdownMenu>` 全站第 3+ 个使用方收编（ProjectsPage / DashboardPage 散落 dropdown） | phase 2 已抽组件，扫尾即可 |
| **P3** | i18n、SSO、2FA | 客户具体需求驱动 |
| **P3** | C.3 SAM 后续延伸：Magic Box、类别确认 hint | 依赖 SAM 基座 + 通知中心 |

---
