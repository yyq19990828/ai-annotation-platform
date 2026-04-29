## 待实现 (Roadmap)

> 两类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）。

---

### A · 代码观察到的硬占位 / 残留 mock

#### 项目模块
- **非 image-det 类型的标注工作台**：image-seg / image-kp / lidar / video-mm / video-track / mm 共 6 类点击「打开」仅显示 toast `类型 X 的标注界面尚未实现`（`DashboardPage.tsx:139`、`ViewerDashboard.tsx:31`）。
- **类别管理**：项目创建后类别（classes）只在 `CreateProjectWizard` 步骤 2 录入，后续无批量编辑 / 导入 / 导出 UI；`PATCH /projects/{id}` 已支持但前端未暴露。
- **项目模板**：当前每次新建项目都从 0 配置类别 / AI 模型；无「从已有项目复制」或「保存为模板」入口。

#### 数据 & 存储
- ~~**存储文件大小统计**：`StoragePage.tsx:163` 明示「文件大小统计将在后续版本中支持」。~~ ✅ v0.4.8 已完成
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- ~~**文件去重 / hash**：`dataset_items` 没有 `content_hash` 列，相同文件多次上传会产生多份对象存储副本。~~ ✅ v0.4.8 已完成
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。

#### AI / 模型
- **AI 预标注独立页**：路由 `/ai-pre` 为占位 PlaceholderPage。Dashboard「AI 预标注队列」卡片永久显示空状态（`AdminDashboard.tsx:107-119`、`DashboardPage.tsx:287-291`）。
- **模型市场**：路由 `/model-market` 占位；项目级 ML Backend 真实选择 / 挂接 UI 缺失（向导步骤 3 仅录入模型名称字符串）。
- **训练队列**：路由 `/training` 占位。
- **预测成本统计**：后端 `prediction_metas` 表已记录 token / 耗时 / 成本，但前端无任何可视化（应进入 AdminDashboard 的成本卡片）。
- **失败预测重试**：`failed_predictions` 表记录但无 UI 触发重试。
- **ML Backend 健康检查**：`MLBackendService` 只在管理员手动点击时探活，无后台周期任务。

#### 用户与权限页（UsersPage）
- **「API 密钥」按钮**：`UsersPage.tsx:63` 无实现（API key 模型也未建表）。
- ~~**「角色」tab 卡片**：仍读取 `data/mock.ts` 的 `roles` 与硬编码 `perms`；应映射到 `constants/permissions.ts` 的真实 `ROLE_PERMISSIONS` 矩阵。~~ ✅ v0.4.8 已完成
- **「存储与模型集成」面板**：`UsersPage.tsx:246-269` 全部 mock 数据，应对接 `/storage/health` 与 `/projects/{pid}/ml-backends`。

#### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**：语言 / 主题 / 时区 / 通知偏好均无（依赖 i18n / 主题基础设施先建立）。
- **系统设置可编辑**：本期 `GET /settings/system` 是只读 .env mirror，缺 PATCH。需要 `system_settings` 表 + 启动时 env 优先加载、表项作为 override。

#### 审计日志页（AuditPage）
- ~~**导出 CSV / JSON**：合规场景需要离线归档。~~ ✅ v0.4.8 已完成
- ~~**自动刷新 / 实时流**：当前需手动点刷新；可加 30s 轮询或 SSE。~~ ✅ v0.4.8 30s 轮询已完成
- **detail_json 字段级筛选**：现在只能按 `action / target_type / actor_id / 时间`，不能按「角色变更：role: super_admin」这种字段值过滤（需 PG GIN 索引）。
- **正向反向追溯视图**：点用户 / 项目 → 跳转该对象的完整审计时间线。

#### TopBar / Dashboard 控件
- **全局搜索**：TopBar 的 `<SearchInput placeholder="搜索项目、任务、数据集、成员..." kbd="⌘K">` 无 `value` / `onChange` / 提交 handler；后端无 `/search` 端点。
- ~~**通知 / 刷新按钮**：TopBar 两个 icon button 无 onClick；通知中心可基于 audit_logs（`actor_id == self` 或 `target_id 关联到自己的项目/任务`）实时弹卡。~~ ✅ v0.4.8 已完成
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast「切换工作区面板已展开」；Organization 表已存在但前端无切换 UI。
- **Dashboard 高级筛选 / 网格视图**：`DashboardPage.tsx:198-199` 两个 Button 无 onClick。

#### Annotator / Reviewer 工作台
- **AnnotatorDashboard `weeklyTarget = 200` 硬编码**（`AnnotatorDashboard.tsx`）：应来自项目级 / 用户级偏好。
- **ReviewerDashboard 无个人最近审核记录** —— 当前只有跨项目待审列表，无历史回看。

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
- ~~**审计中间件双行去重**：当前 metadata 行 + 业务 detail 行各写一行；可加 `request_id`（来自请求头或自动生成）做关联，UI 提供合并视图。~~ ✅ v0.4.8 `request_id` 注入两行均已完成；UI 合并视图待后续
- **数据导出审计**：`GET /projects/{id}/export` 等批量数据导出应触发审计 + 下载者签名水印。
- **GDPR / 个人信息删除**：被删用户的 audit 行需要做 actor_email 脱敏（保留 actor_id 关联，原始邮箱另存或抹除）。
- ~~**通知中心 / 事件总线**：基于 audit_logs 派生面向用户的通知（被邀请、审核通过、AI 完成等），前端 TopBar 通知按钮承接；后端可用 Redis Pub/Sub 实时推送。~~ ✅ v0.4.8 轮询方案已完成；Redis Pub/Sub 实时推送待后续
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

#### 可观测性
- ~~**结构化日志**：当前使用 `logger.warning` 普通字符串；引入 `structlog` 或 `loguru` + JSON 输出便于聚合（Loki / ELK）。~~ ✅ v0.4.8 已完成
- ~~**request_id / trace_id**：中间件注入并写入 audit_logs 的 detail，便于跨表追溯。~~ ✅ v0.4.8 已完成
- ~~**Prometheus metrics**：暴露 `/metrics`（FastAPI 请求时延、Celery 队列长度、数据库连接池、ML Backend 健康）。~~ ✅ v0.4.8 HTTP metrics 已完成（Celery/ML Backend 指标待后续）
- **Sentry**：前后端 error tracking。
- ~~**健康检查拆分**：现在 `/health` 只返回 `{status: "ok"}`；拆为 `/health/db`、`/health/redis`、`/health/minio`、`/health/celery` 便于编排（k8s readiness）。~~ ✅ v0.4.8 已完成（celery 待后续）

#### 性能 / 扩展
- **AuditMiddleware 写入异步队列**：当前每写请求一次 INSERT，写流量上来后改 Redis Stream / Kafka 异步消费，主请求 < 1ms 旁路。
- ~~**Audit / Task / Annotation 列表 keyset 分页**：当前 OFFSET 在大表上慢；改为 `(created_at, id) > (?, ?)` 游标分页。~~ ✅ v0.4.8 audit_logs + tasks 已完成（Annotation 列表待后续）
- **Predictions 表分区**：按 `project_id` 或 `created_at` PARTITION，单项目预测量大时查询性能下降。
- ~~**N+1 / 关联预加载**：`GET /audit-logs` 当前对每行额外 `db.get(User, actor_id)` 回填 actor_email；改为单 JOIN 批量取。~~ ✅ v0.4.8 已完成
- ~~**数据库连接池调优 + 监控**：当前 `create_async_engine` 默认池，无 `pool_size / max_overflow / pool_recycle`。~~ ✅ v0.4.8 已完成
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

### C · 标注工作台专项优化（性能 / 界面 / 标注体验）

> 现状基线（一次代码体检）：`apps/web/src/pages/Workbench/WorkbenchPage.tsx`（720 行单文件，DOM 绝对定位渲染框、`<img>` 直接挂载、`900*zoom × 600*zoom` 伪缩放、仅支持 bbox、无撤销/移动/resize/多选）；`apps/web/src/pages/Review/ReviewPage.tsx`（152 行，**无任何画布预览**，reviewer 只能看到 class badge，必须跳转 Workbench 才能判断质量）。
> 横向参考：CVAT（Konva 画布 + 关键帧插值 + 骨架）、Label Studio（interactive ML backend，SAM 触点）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量类别检测）。

#### C.1 渲染性能 / 大图大量框

- **画布引擎切换**：当前每个 box 是 `<BoxOverlay>` div（`stage/BoxRenderer.tsx`），DOM 节点数 = 框数 × ~5；超过 200 框肉眼掉帧，超过 500 框开始卡顿。引入 **Konva**（推荐，与 React 友好，配合 `react-konva`）或 PixiJS（极致性能但门槛高）；保留 DOM 浮层只承接选中框的操作菜单（accept/reject/resize）。
  - 验收：1000 框 + 4K 图，pan/zoom @ 60fps；首帧 < 80ms。
- **图像加载流水线**：`<img src={file_url}>` 朴素加载（`stage/ImageBackdrop.tsx`），切下一题白屏可见。补：① `dataset_items` 增 `thumbnail_url` + `blurhash`，前端先显示低清占位，再用 `<img loading="eager" decoding="async">` 切换；② `useTasks` 队列里**预取下一题**的 image / annotations / predictions（`queryClient.prefetchQuery`）；③ 大图（> 4096 px 边长 / RS 卫星 / 病理切片）走 OpenSeadragon / DeepZoom 瓦片金字塔。
- ~~**真正的视口缩放与平移**~~ ✅ v0.4.9：`stage/ImageStage.tsx` 已用 `transform: translate(tx,ty) scale(s)`；`Ctrl + wheel` 光标锚点缩放、`Space + drag` 平移、双击 fit、`Ctrl+0` 重置全部就位；`useViewportTransform` hook 收敛 vp 状态。**Minimap 待后续。**
- **绘制 / 拖拽节流**：`onCanvasMouseMove` 每像素 setState（`stage/ImageStage.tsx`），高分辨屏 240Hz 时炸 React。用 `requestAnimationFrame` 合并 + ref 写入避免 setState 抖动。
- **任务列表虚拟化**：`useTaskList` 一次拉全（默认 limit=100，但真实项目 5k+ 任务时左侧 `tasks.map` 直接卡死，`shell/TaskQueuePanel.tsx`）。改为 `react-virtualized` / `@tanstack/react-virtual` + 后端游标分页（与 B.「Audit / Task / Annotation 列表 keyset 分页」共用）。
- **标注列表虚拟化**：右侧 `aiBoxes.map` + `userBoxes.map`（`shell/AIInspectorPanel.tsx`）同样需要虚拟化。
- **置信度阈值服务端化**：当前 `aiBoxes.filter(b => b.conf >= confThreshold)` 仅前端过滤（`shell/WorkbenchShell.tsx`），全量预测仍走网络。`GET /tasks/{id}/predictions?min_confidence=0.5` 查询参数下推；阈值变更带防抖。
- **按需加载预测**：当前任务一打开就拉全部 prediction；可改成「默认只拉 conf ≥ 0.5 的 top N，滚动右侧 AI 列表时再加载更低分」。
- **WebSocket 重连 + 心跳**：与 A 的「WebSocket 重连」合并，但要在 Workbench 状态栏暴露连接指示（断开时变灰提示「实时进度暂停」）。

#### C.2 界面优化（信息架构 / 可见性 / 一致性）

- ~~**审核页零画布的硬伤**~~ ✅ v0.4.9：`ReviewPage.tsx` 行点击 → 70vw Drawer 滑入 `<ReviewWorkbench>` 复用 `<ImageStage readOnly />`；diff 三态「仅最终 / 仅 AI 原始 / 叠加 diff」；URL `?taskId=` 同步浏览器前进后退；ESC 关闭、左右切上下题。
- ~~**审核批量操作**~~ ✅ v0.4.9：每行 checkbox + 顶部浮条「批量通过 (N)」「批量退回 (N)」；退回弹 `<RejectReasonModal>` 选预设原因（类别错误 / 漏标 / 位置不准 / 框过大或过小 / 自定义）；进度聚合 toast。
- ~~**快捷键速查面板**~~ ✅ v0.4.9：`?` 弹 `<HotkeyCheatSheet>`，所有快捷键定义集中在 `state/hotkeys.ts` 一份 SoT；当前覆盖：V/B/1-9 类别、Ctrl+Z/Y/Shift+Z 撤销重做、A/D 采纳驳回、E 提交、Ctrl+→/← 切题、Ctrl+0 fit、Ctrl+wheel 缩放、Space+drag 平移。**Tab/Shift+Tab 切框、J/K 上下框、`[` `]` 调阈值待后续。**
- ~~**状态栏真实化**~~ ✅ v0.4.9：`dataset_items.width / height` 列已加（migration 0008）；`TaskOut.image_width / image_height` 透出；`StatusBar` 真实尺寸 + 光标坐标；`BoxListItem` 像素值同样基于真实尺寸。**存量数据需调 `POST /datasets/{id}/backfill-dimensions` 回填。**
- **类别面板增强**：① 颜色已支持 `> 5` 类自动从 OKLCH 色环按 hash 派生（v0.4.9，`stage/colors.ts`），仍未上后端 `Project.classes_palette` 持久化；② 类别 > 9 个时支持搜索 + 字母键映射；③ 拖动重排顺序；④ 「最近使用」置顶 — 待后续。
- **响应式 / 可折叠**：当前 `gridTemplateColumns` 在 < 1280px 下两侧面板会挤压画布。补：① < 1024px 自动收起一侧；② 把工具栏分组为「视图 / 绘制 / AI / 导航」并溢出折叠到「⋯」菜单；③ 移动端只读模式（标注员现场用 iPad 看图）。
- **空状态 / 加载骨架**：`isProjectLoading` 时只是文字「加载项目中...」（`shell/WorkbenchShell.tsx`），换成画布 + 任务列表的 skeleton；图像加载阶段叠 blurhash 而不是白屏。
- ~~**Toast 抑流**~~ ✅ v0.4.9：`handleAcceptAll` 与批量审核都改为终态聚合一条 `已采纳 17/20，3 项失败`。
- **暗色模式优先**：标注员长时间盯屏，眼疲劳是真问题。把工作台当成 dark-first 面（图像周围背景已是棋盘格，再叠暗色 chrome），与 B 的「主题切换」共建 CSS 变量。
- **进度心理预期**：底部状态栏已有 AI 接管率，但缺**预计剩余时间 ETA**（基于本会话平均每题耗时 × 剩余题数）；reviewer 端缺「本日已审 / 待审 / 通过率」实时卡片。

#### C.3 标注体验（核心生产力杠杆）

- ~~**撤销 / 重做**~~ ✅ v0.4.9：`state/useAnnotationHistory.ts` 命令栈支持 create / delete / update / acceptPrediction；`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`；切任务清栈；mutation pending 期间禁用 undo。
- ~~**框的移动 / resize**~~ ✅ v0.4.9：8 个 resize 锚点（4 角 + 4 边中点）+ 框体拖动整体平移；本地 state 显示拖动过程，松手才落 `PATCH /annotations/{id}`；几何 clamp 到 [0,1]，过小框拒收。**Shift 锁定纵横比、Alt 从中心缩放待后续。**
- **多选与批量编辑**：Shift + 点击叠加选中、框选 marquee、Ctrl+A 全选当前帧；批量改 class、批量删除、批量平移（方向键 1px / Shift+方向键 10px）。
- **复制粘贴 / 重复**：Ctrl+C / Ctrl+V 在同一任务或跨任务复制框（典型场景：连续 30 张货架照同一商品的相似框）；Ctrl+D 当前位置原地重复。
- **SAM 交互式标注（点 / 框生成多边形 / 蒙版）**：研究报告 `06-ai-patterns.md` 的「模式 B」明确推荐 P1。最小切片：
  - 后端：`POST /projects/{pid}/ml-backends/interactive`，路由到 `is_interactive=True` 的 ML backend；常驻 GPU 容器 + image embedding LRU 缓存（首次 ~300ms，命中 < 50ms）。
  - 前端：新工具 `S`（SAM 模式），鼠标点击 = positive point、Alt+点击 = negative point、拖框 = bbox prompt；返回多边形以「待确认紫虚线」叠加（不立刻落 Annotation），Enter 接受 / Esc 取消。
  - 与现有 GroundingDINO 配合：「文本框 → 全图批量同类」 vs 「点 / 框 → 单实例精修」两条路并存。
- **AI 框 IoU 去重**：用户已画框后，重叠 IoU > 0.7 的同类 AI 框自动隐藏 / 标灰，避免重复劳动。
- **关键帧插值（视频/序列）**：CVAT 同款；标注员只标 1 / 30 / 60 帧，中间线性插值（前端实现，提交时落库为关键帧 + 插值标志）。需配合 `Task.dimension` 字段。
- **类别属性 / 子属性**：当前 `Annotation` 只存 `class_name`，缺 `occluded` / `truncated` / `difficult` / `group_id`。建 `annotation_attributes` JSONB 列 + 项目级 schema（每类可声明哪些属性必填 / 枚举），右侧选中框时下沿展开属性面板。
- **逐框评论 / 标记问题**：`annotation_comments` 表（`annotation_id, author_id, body`）；reviewer 退回任务时可直接在某个框上留批注，标注员收到通知（与 B 的通知中心串）。
- **智能下一题**：当前只能顺序切（`navigateTask`，`WorkbenchPage.tsx:285-293`）。补：「N」键 = 下一未标注（跳过已完成）；「U」键 = 下一不确定题（按 prediction 平均 conf 升序）；与 09-recommendations 的 `next_task.py` Active Learning 调度协同。
- **自动保存 + 离线队列**：当前每次 mutation 都直发 → 网络抖动期间用户白干。`createAnnotation` / `deleteAnnotation` 落 IndexedDB 队列，连不上时显示「离线 · 3 操作待同步」徽章。
- **键盘优先标注流**：Tab 在框间循环、Enter 编辑选中框 class（弹小输入框 + 模糊匹配）、Esc 取消、E 提交并跳下一题；目标是从「鼠标 ↔ 键盘」混合操作压到「画框 + 全程键盘」。
- **类别确认 hint**：刚画完一个框时，AI 后台跑一次单框分类（轻量分类头，非 GroundingDINO），右上角弹「建议：标识牌（92%）」+ 一键采纳。
- **Magic Box / Snap**：粗略画一个大框 → AI 收紧到对象边缘（SAM 推 mask → 取 mask bbox）；同时支持「贴边吸附」（5px 内自动吸附到图像边缘）。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **任务跳过与原因**：标注员可「跳过本题」并选原因（图像损坏 / 无目标 / 不清晰），后端记 `Task.skip_reason` 并自动转 reviewer 复核。
- ~~**Workbench 子组件拆分**~~ ✅ v0.4.9：720 行单文件已拆为 `WorkbenchPage`(5 行入口) + `shell/`(`WorkbenchShell` / `Topbar` / `TaskQueuePanel` / `AIInspectorPanel` / `StatusBar` / `HotkeyCheatSheet`) + `stage/`(`ImageStage` / `ImageBackdrop` / `BoxRenderer` / `BoxListItem` / `DrawingPreview` / `ResizeHandles` / `colors`) + `state/`(`useWorkbenchState` / `useViewportTransform` / `useAnnotationHistory` / `transforms` / `hotkeys`)。审核页 `<ReviewWorkbench>` 复用 `<ImageStage readOnly />`，画布逻辑单一来源。

#### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> 决策：**单工作台外壳 + 按维度切分的画布渲染器 + 工具可插拔**，不是「一类型一工作台」也不是「单文件 if/else 全塞」。当前只支持矩形框（`tool: "box" | "hand"`，`WorkbenchPage.tsx:224`、`annotation_type: "bbox"` 硬编码 `WorkbenchPage.tsx:380`），但数据模型 `annotation_type: String(30)` + `geometry: JSONB` 已为多类型留好口子（`apps/api/app/db/models/annotation.py:17`）—— 未来扩多类型时不需要改外壳与数据层，只新增画布层 / 工具层。

- **Layer 1 · 工作台外壳（`<WorkbenchShell>`，单一份）**：路由 `/projects/:id/annotate`、左侧任务队列、顶栏（项目元信息 / 提交 / 切换上下题）、右侧 AI 助手、任务锁、撤销重做栈、快捷键基座、状态栏、`useTaskLock` / `useAnnotationHistory` / `usePreannotationProgress`。这一层跟「在标什么」无关，跨所有类型共用 ~80%。
- **Layer 2 · 画布渲染器（按维度切，3 个）**：
  - `<ImageStage>`：image-det / image-seg / image-kp / mm（图像类）共用，渲染器 = 「图 + 矢量叠层」
  - `<VideoStage>`：video-mm / video-track，多了**时间轴 + 关键帧插值**控件，硬塞 ImageStage 会扭
  - `<LidarStage>`：lidar 单独，Three.js / WebGL viewport，与 2D 不是一个世界
  - 三个画布通过 `<WorkbenchShell>` 的 slot 接入；外壳通过 `project.type` 选择渲染哪一个
- **Layer 3 · 工具（画布内插件，按需注册）**：每个工具实现统一接口 `{ id, hotkey, icon, onMouseDown, onMouseMove, onMouseUp, render }`。当前 `<ImageStage>` 仅注册 `BboxTool`；后续加 polygon / keypoint / polyline 是注册新工具，**不修改画布**。
- **不要做的两条反路径**：
  - ❌ 单工作台 + 全动态：表面省事，半年后会变成「我是视频吗？我是 3D 吗？」的分支地狱
  - ❌ 一类型一工作台（`WorkbenchImageDet` / `WorkbenchImageSeg` / `WorkbenchLidar`...）：`useTaskLock` / 提交流 / AI 面板要复制 7 份，改一个 bug 改 7 个文件
- **落地路径（分两步）**：
  - ~~**Step 1**：拆成 `<WorkbenchShell>` + `<ImageStage>`（仅 BboxTool）~~ ✅ v0.4.9 已完成。骨架就位，C.1 / C.2 / C.3 P0 全部叠加完毕。
  - **Step 2（未来扩类型时）**：新增 polygon → 在 `<ImageStage>` 注册 `PolygonTool`；新增视频 → 新建 `<VideoStage>` 复用同一 `<WorkbenchShell>`。Shell 层、任务锁、提交流、撤销重做栈零改动。
- ~~**审核页同源复用**~~ ✅ v0.4.9：`<ReviewWorkbench>` 复用 `<ImageStage readOnly />`；readOnly 关闭工具层、隐藏 resize 锚点与 accept-reject 浮按钮，单一画布组件支撑两个页面。

---

### 优先级建议（参考）

| 优先级 | 候选项 | 理由 |
|---|---|---|
| **P0** | 后端测试套件、JWT secret 生产硬校验、登录限流、密码重置流程 | 安全 / 质量基线，缺它们生产风险高 |
| **P0** | C.3 撤销/重做、框移动+resize、审核页画布预览 | 标注员/审核员日常硬伤，用户投诉率最高 |
| **P1** | TopBar 通知中心、UsersPage「角色」tab 接通真权限矩阵、「存储与模型集成」对接、API 密钥 | 用户每天面对，残缺感最强 |
| **P1** | C.1 真视口缩放/平移 + 图像预取 + 任务列表虚拟化、C.3 SAM 交互式（点/框→mask）、Workbench 组件拆分 | 上量后必撞墙；SAM 是核心差异化 |
| **P1** | C.2 快捷键速查面板、多选+批量编辑、置信度服务端化、Toast 抑流 | 提效 quick win，工时少 |
| **P2** | 非 image-det 工作台、AI 预标注独立页、模型市场 | 体量大，按业务优先级排队 |
| **P2** | C.1 Konva 画布引擎切换、瓦片金字塔大图、Minimap | 千框/4K 大图场景才必要 |
| **P2** | C.3 关键帧插值、类别属性 schema、自动保存离线队列、智能下一题（Active Learning） | 业务复杂度起来后必需 |
| **P2** | 审计日志归档 / 全文索引、AuditMiddleware 队列化 | 当前数据量未到瓶颈，监控触发再做 |
| **P3** | i18n、主题切换（含暗色优先工作台）、SSO、2FA | 客户具体需求驱动 |

---