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

#### AI / 模型
- **AI 预标注独立页**：路由 `/ai-pre` 为占位 PlaceholderPage。Dashboard「AI 预标注队列」卡片永久显示空状态（`AdminDashboard.tsx:107-119`、`DashboardPage.tsx:287-291`）。
- **模型市场**：路由 `/model-market` 占位；项目级 ML Backend 真实选择 / 挂接 UI 缺失（向导步骤 3 仅录入模型名称字符串）。
- **训练队列**：路由 `/training` 占位。
- **预测成本统计**：后端 `prediction_metas` 表已记录 token / 耗时 / 成本，但前端无任何可视化（应进入 AdminDashboard 的成本卡片，并向工作台 AI 助手面板透传"本题花费 X 元 / Y tokens"）。
- **失败预测重试**：`failed_predictions` 表记录但无 UI 触发重试。
- **ML Backend 健康检查**：`MLBackendService` 只在管理员手动点击时探活，无后台周期任务。
- **ML Backend 协议契约文档**：前后端 ML 接入点散落在 `MLBackendService` / 工作台 / 模型市场，缺统一协议描述（健康端点 / 预测请求 / 错误格式 / 流式 vs 同步 / `is_interactive` 模式协商等）。

#### 用户与权限页（UsersPage）
- **「API 密钥」按钮**：`UsersPage.tsx:63` 无实现（API key 模型也未建表）。
- **「存储与模型集成」面板**：`UsersPage.tsx:246-269` 全部 mock 数据，应对接 `/storage/health` 与 `/projects/{pid}/ml-backends`。

#### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**：语言 / 主题 / 时区 / 通知偏好均无（依赖 i18n / 主题基础设施先建立）。
- **系统设置可编辑**：本期 `GET /settings/system` 是只读 .env mirror，缺 PATCH。需要 `system_settings` 表 + 启动时 env 优先加载、表项作为 override。

#### 审计日志页（AuditPage）
- **detail_json 字段级筛选**：现在只能按 `action / target_type / actor_id / 时间`，不能按「角色变更：role: super_admin」这种字段值过滤（需 PG GIN 索引）。
- **正向反向追溯视图**：点用户 / 项目 → 跳转该对象的完整审计时间线。

#### TopBar / Dashboard 控件
- **全局搜索**：TopBar 的 `<SearchInput placeholder="搜索项目、任务、数据集、成员..." kbd="⌘K">` 无 `value` / `onChange` / 提交 handler；后端无 `/search` 端点。
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast「切换工作区面板已展开」；Organization 表已存在但前端无切换 UI。
- **Dashboard 高级筛选 / 网格视图**：`DashboardPage.tsx:198-199` 两个 Button 无 onClick。

#### Annotator / Reviewer 工作台
- **AnnotatorDashboard `weeklyTarget = 200` 硬编码**（`AnnotatorDashboard.tsx`）：应来自项目级 / 用户级偏好。
- **ReviewerDashboard 无个人最近审核记录** —— 当前只有跨项目待审列表，无历史回看。
- **Reviewer 实时仪表卡（与标注端 ETA 对称）**：v0.5.2 已为 annotator StatusBar 加 ETA；reviewer 端缺「本日已审 / 待审队列长度 / 通过率（24h 滚动）」三项实时卡片。

#### 协作并发（新增）
- **任务锁主动续约**：`useTaskLock` 监听 lockError 弹错；但用户 idle 5 分钟后 lock TTL 到期，**前端无心跳续约 + 无倒计时可视化**。当前依赖刷新发现，体验差。建议：每 60s 心跳 PATCH lock；状态栏显示「锁剩余 4:23」。
- **编辑冲突 ETag**：两人同 task 编辑（lock TTL 缝隙、网络抖动期间），后提交覆盖前者，无 `If-Match`/`version` 字段。建议 Annotation / Task 表加 `version` 列；前端 PATCH 带版本号，409 时浮出「他人已修改 → 重载 / 强制覆盖」二选一。

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
- **审计中间件双行 UI 合并视图**：v0.4.8 已在 metadata 行 + 业务 detail 行注入同一 `request_id`；待补 UI 合并视图（点 metadata 行展开关联 detail）。
- **数据导出审计**：`GET /projects/{id}/export` 等批量数据导出应触发审计 + 下载者签名水印。
- **GDPR / 个人信息删除**：被删用户的 audit 行需要做 actor_email 脱敏（保留 actor_id 关联，原始邮箱另存或抹除）。
- **通知中心实时推送**：v0.4.8 30s 轮询已落；待升级为 Redis Pub/Sub WS 推送（与下面 WebSocket 多副本一起做）。
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

#### 可观测性
- **Sentry**：前后端 error tracking。
- **Celery / ML Backend 指标**：v0.4.8 已加 HTTP metrics + DB pool + `/health/{db,redis,minio}`；缺 Celery 队列长度、Worker 心跳、ML Backend 平均延迟 / 失败率。
- **`/health/celery`**：v0.4.8 留下的待办；做成 broker ping + active worker count。

#### 性能 / 扩展
- **AuditMiddleware 写入异步队列**：当前每写请求一次 INSERT，写流量上来后改 Redis Stream / Kafka 异步消费，主请求 < 1ms 旁路。
- **Annotation 列表 keyset 分页**：v0.4.8 已对 audit_logs / tasks 改造；annotations 仍单次拉全（`useAnnotations` task 内全量），单任务 1000+ 框时阻塞渲染。
- **Predictions 表分区**：按 `project_id` 或 `created_at` PARTITION，单项目预测量大时查询性能下降。
- **WebSocket 多副本**：Redis Pub/Sub 已就位，但生产横向扩 uvicorn 副本时需测试 sticky session 与 broadcast 不重复。
- **useInfiniteQuery 缓存 GC**：工作台调置信度阈值会创建新 `["predictions", taskId, undefined, debouncedConf]` query key；旧 key 默认 5min GC，长时间调阈值会内存增长。建议 `cacheTime: 30s` for predictions / 切题时手动 `removeQueries`。

#### 测试 / 开发体验
- **后端单元测试 / 集成测试**：`apps/api/tests/` 目前空缺；至少为 InvitationService、AuditMiddleware、权限工厂建测试 fixture（pytest + pytest-asyncio + httpx ASGI transport，本次冒烟脚本可改造为基础套件）。
- **前端单元测试**：v0.5.2 已落 vitest 基座（`stage/iou.test.ts` 6 例）；需扩展覆盖 hooks（`useAnnotationHistory` batch 命令、`useClipboard` 偏移粘贴、`useSessionStats` ring buffer）与关键组件（Modal、InviteUserModal 状态机、RegisterPage 三态）。
- **Workbench keyboard handler 单测**：v0.5.2 后处理键已 30+ 条且彼此修饰键有交集（Ctrl+A/C/V/D 与 a/d AI 接受、Shift+Tab 与 Tab 循环、N/U 与字母类映射）；建议把 `state/hotkeys.ts` 提取为纯函数 `dispatch(event, ctx) → Action`，配单测覆盖所有分支。
- **E2E 测试**：Playwright 录制邀请→注册→标注→审核→审计核心 5 条用户流程。
- **OpenAPI → TS 类型生成**：当前前后端 schema 手动同步（`apps/web/src/api/*.ts` vs `apps/api/app/schemas/*.py`），易漂移；接 `openapi-typescript` 或 `@hey-api/openapi-ts`。
- **CI/CD pipeline**：`.github/workflows/` 缺；至少 lint + tsc + pytest + 镜像构建 + vitest（v0.5.2 起）。
- **预提交钩子**：husky + lint-staged + ruff + tsc + vitest run --changed。

#### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **主题切换**：CSS 变量已就绪，但 TopBar 无 toggle；增加日间 / 夜间 / 跟随系统三档。
- **无障碍**：ARIA 属性极少（仅 Modal `role=dialog` 和 `aria-label="关闭"`）；Lighthouse Accessibility 分数应作为 PR gate。
- **响应式**：`gridTemplateColumns: "220px 1fr"` 等硬编码栅格在 < 1024px 下错位；Sidebar 缺折叠态。

#### 文档
- **部署文档**：缺 production 部署清单（环境变量、TLS、备份、初次 bootstrap_admin 步骤）。
- **安全模型文档**：RBAC 矩阵、审计字段释义、邀请流程时序图。
- **API 使用指南**：FastAPI 自动 `/docs` 已有，但缺示例与最佳实践（特别是 ML Backend 协议、WebSocket 订阅）。
- **快捷键文档**：v0.5.2 后工作台快捷键超过 30 条，HotkeyCheatSheet 是 SoT 但缺独立 Markdown 用户文档（QA / 运营培训用）。

---

### C · 标注工作台专项优化（性能 / 界面 / 标注体验）

> 现状基线（截至 v0.5.2）：`WorkbenchShell` 三层架构（shell + stage + state）已稳定；Konva 画布、虚拟化任务/标注列表、blurhash 预占位、Minimap、阈值服务端化、批量编辑、IoU 视觉去重、ETA、智能切题等已落地。
> 横向参考：CVAT（Konva 画布 + 关键帧插值 + 骨架）、Label Studio（interactive ML backend，SAM 触点）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量类别检测）。

#### C.1 渲染性能 / 大图大量框

- **OpenSeadragon 瓦片金字塔**：当前直接加载完整图像，> 50MP（如卫星/医疗影像）会卡。需要后端切瓦片 + 前端 OpenSeadragon viewport，与 Konva overlay 共生（OSD 当背景，Konva 浮层画矢量）。极大图场景才必要。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。当前 `useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。
- **IoU 去重几何加速**：v0.5.2 用 useMemo + 嵌套循环 O(N×M)，100+ AI × 50+ user 约 5000 次/帧；阈值边界附近变更会触发频繁重算。如果掉帧，上空间索引 rbush（仅同类内分片）。
- **Konva 分层 hit-detection**：当前 user/AI 框混在单 Layer，框越多 hit detection 越慢；按 user / AI / overlay 拆三层（`listening: false` for AI 层时禁用拾取）能进一步降负担。

#### C.2 界面优化（信息架构 / 可见性 / 一致性）

- **响应式终态**：v0.5.1 已加 `useMediaQuery` 自动收 sidebar，Topbar flexWrap 兜底；剩余「⋯ 溢出菜单」（窄屏把次要按钮收进抽屉）+ 移动端只读模式（< 768px 强制 `readOnly` + 提示用桌面版）。
- **暗色模式优先**：标注员长时间盯屏，眼疲劳是真问题。把工作台当成 dark-first 面（图像周围背景已是棋盘格，再叠暗色 chrome）；与 B 的「主题切换」共建 CSS 变量 token。
- **类别面板拖动重排 + 后端持久化**：当前 `project.classes: string[]` 只能创建时设置；需要改为 `{ name, color?, order }[]` + migration + PATCH /projects/{id}/classes 排序端点。前端用 dnd-kit 实现拖排。
- **HotkeyCheatSheet 分组与搜索**：v0.5.2 后定义已涨到 30+ 条；目前仅按 `group` 分块，缺搜索框 + 「按使用频率排」。
- **阈值控件统一**：Topbar 已有数值浮出反馈（`[`/`]`键），AIInspectorPanel 仍是 slider 主入口；可考虑统一为 Topbar 主控 + AI 面板小数值显示。
- **Reviewer 端实时仪表卡**：与 A 中「Reviewer 端实时仪表卡」并跟进，画布外的右侧栏空间可承接。

#### C.3 标注体验（核心生产力杠杆）

- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90% 多选场景（v0.5.2）；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式），按住拖选所有相交框。
- **Shift 锁定纵横比 / Alt 从中心 resize**：v0.4.9 留下的 TODO；resize handle 8 锚点已就位，加修饰键判断即可。
- **SAM 交互式标注（点 / 框 → mask）**：研究报告 `06-ai-patterns.md`「模式 B」P1。最小切片：
  - 后端：`POST /projects/{pid}/ml-backends/interactive`，路由到 `is_interactive=True` 的 ML backend；常驻 GPU 容器 + image embedding LRU 缓存（首次 ~300ms，命中 < 50ms）。
  - 前端：新工具 `S`（SAM 模式），鼠标点击 = positive point、Alt+点击 = negative point、拖框 = bbox prompt；返回多边形以「待确认紫虚线」叠加，Enter 接受 / Esc 取消。
  - 与现有 GroundingDINO 配合：「文本框 → 全图批量同类」 vs 「点 / 框 → 单实例精修」两条路并存。
- **关键帧插值（视频/序列）**：CVAT 同款；标注员只标 1 / 30 / 60 帧，中间线性插值（前端实现，提交时落库为关键帧 + 插值标志）。需配合 `Task.dimension` 字段。
- **类别属性 / 子属性**：当前 `Annotation` 只存 `class_name`，缺 `occluded` / `truncated` / `difficult` / `group_id`。建 `annotation_attributes` JSONB 列 + 项目级 schema（每类可声明哪些属性必填 / 枚举），右侧选中框时下沿展开属性面板。
- **逐框评论 / 标记问题**：`annotation_comments` 表（`annotation_id, author_id, body`）；reviewer 退回任务时可直接在某个框上留批注，标注员收到通知（与 B 的通知中心串）。
- **自动保存 + 离线队列**：当前每次 mutation 都直发 → 网络抖动期间用户白干。`createAnnotation` / `deleteAnnotation` 落 IndexedDB 队列，连不上时显示「离线 · 3 操作待同步」徽章。
- **类别确认 hint**：刚画完一个框时，AI 后台跑一次单框分类（轻量分类头，非 GroundingDINO），右上角弹「建议：标识牌（92%）」+ 一键采纳。
- **Magic Box / Snap**：粗略画一个大框 → AI 收紧到对象边缘（SAM 推 mask → 取 mask bbox）；同时支持「贴边吸附」（5px 内自动吸附到图像边缘）。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **任务跳过与原因**：标注员可「跳过本题」并选原因（图像损坏 / 无目标 / 不清晰），后端记 `Task.skip_reason` 并自动转 reviewer 复核。
- **History 持久化（sessionStorage）**：刷新页面 history 清空（v0.5.2 仍如此）；将 undo/redo 栈序列化到 sessionStorage，刷新后恢复（5 分钟 TTL，超过清空）。需小心 redo 命令引用的 prediction id 可能已变。
- **IoU 去重阈值项目级可配**：v0.5.2 硬编码 0.7；不同业务（密集小目标 vs 稀疏大目标）合理阈值不同，需 `project.iou_dedup_threshold` 字段 + 设置页 slider。
- **批注 / 注释画布层**：与「逐框评论」延伸，reviewer 可在 ImageStage 上画箭头 / 文字标注（不入 annotations 表，独立 `annotation_comments_canvas` JSON），发回 annotator 看到「reviewer 在这里画了红圈」。
- **`U` 键准确度升级**：v0.5.2 用 `total_predictions desc + total_annotations == 0` 启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）—— 数据量起来后再做。

#### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> 决策：**单工作台外壳 + 按维度切分的画布渲染器 + 工具可插拔**（v0.4.9 Step 1 完成）。当前只支持矩形框（`tool: "box" | "hand"`，`annotation_type: "bbox"` 硬编码），数据模型 `annotation_type: String(30)` + `geometry: JSONB` 已为多类型留好口子（`apps/api/app/db/models/annotation.py:17`）。

- **Layer 1 · 工作台外壳（`<WorkbenchShell>`）**：路由 `/projects/:id/annotate`、左侧任务队列、Topbar、AI 助手、状态栏、`useTaskLock` / `useAnnotationHistory` / `useSessionStats` / `useClipboard` / `usePreannotationProgress`。跨所有类型共用 ~80%。
- **Layer 2 · 画布渲染器（按维度切，3 个）**：
  - `<ImageStage>`：image-det / image-seg / image-kp / mm（图像类）共用 ✅
  - `<VideoStage>`：video-mm / video-track，多了**时间轴 + 关键帧插值**控件
  - `<LidarStage>`：lidar 单独，Three.js / WebGL viewport
- **Layer 3 · 工具（画布内插件）**：每个工具实现统一接口 `{ id, hotkey, icon, onMouseDown, onMouseMove, onMouseUp, render }`。当前 `<ImageStage>` 仅注册 `BboxTool`。
- **Step 2 触发条件**：业务需要 polygon / keypoint / video / lidar 时才动；当前 image-det 单类型不必预先抽象。

---

### 优先级建议（参考）

| 优先级 | 候选项 | 理由 |
|---|---|---|
| **P0** | 后端测试套件、JWT secret 生产硬校验、登录限流、密码重置流程 | 安全 / 质量基线，缺它们生产风险高 |
| **P0** | A § 协作并发：任务锁主动续约 + 编辑冲突 ETag | 多人协作场景一旦撞上就丢数据；当前 0 防护 |
| **P1** | TopBar 通知中心、UsersPage「角色」tab 接通真权限矩阵、「存储与模型集成」对接、API 密钥 | 用户每天面对，残缺感最强 |
| **P1** | C.3 SAM 交互式（点/框→mask） | 核心差异化，研究报告明确 P1 |
| **P1** | 后端单元/集成测试、前端 hook + keyboard 单测扩展 | v0.5.2 工作台逻辑膨胀，无测试就是定时炸弹 |
| **P1** | OpenAPI → TS 类型生成 | 前后端 schema 手动同步在 v0.5.x 已开始漂移 |
| **P2** | 非 image-det 工作台（image-seg → polygon → 复用 Step 1 架构） | 体量大，按业务优先级排队 |
| **P2** | C.2 暗色模式 / 类别面板拖排持久化、HotkeyCheatSheet 升级 | 上量后必撞 |
| **P2** | C.3 marquee / 关键帧 / 类别属性 schema / 自动保存离线队列 / 任务跳过 | 业务复杂度起来后必需 |
| **P2** | C.1 OpenSeadragon 瓦片金字塔、Konva 分层 hit | 千框/4K 大图场景才必要 |
| **P2** | C.3 history 持久化、IoU 阈值可配、reviewer 实时仪表卡 | quick win，工时少 |
| **P2** | 审计日志归档 / 全文索引、AuditMiddleware 队列化、useInfiniteQuery 缓存 GC | 当前数据量未到瓶颈，监控触发再做 |
| **P3** | i18n、主题切换（含暗色优先工作台）、SSO、2FA | 客户具体需求驱动 |
| **P3** | C.3 SAM 后续延伸：批注画布层、Magic Box、类别确认 hint | 依赖 SAM 基座 + 通知中心 |

---
