## 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本详见 [CHANGELOG.md](../CHANGELOG.md)：v0.6.0 ~ v0.6.6 同前；**v0.6.7（项目管理员 4 项 BUG 收口：B-13 TaskLock 自重入鲁棒性 + B-11 CreateProjectWizard 扩 5 步含数据集/成员引导 + B-12 分包/分派可见性全链路含 link 自动建命名 batch / BatchesSection 分派 UI / Workbench batch 过滤 / Dashboard 深链 + B-10 unlink 二次确认 + alembic 0024 回填孤儿 batch_id）**；**v0.6.7-hotfix（task_lock upsert 防并发 unique 冲突 + unlink 改 hard-delete + 「清理孤儿任务」按钮 + 进度条「已动工」副条 + ProjectOut.in_progress_tasks 字段）**。

---

### A · 代码观察到的硬占位 / 残留 mock

#### 项目模块
- **非 image-det 类型的标注工作台**：image-seg / image-kp / lidar / video-mm / video-track / mm 共 6 类点击「打开」仅显示 toast `类型 X 的标注界面尚未实现`（`DashboardPage.tsx:139`、`ViewerDashboard.tsx:31`）。
- **`CreateProjectWizard` step 2/3 升级到 settings 完整组件**：v0.6.7 已扩为 5 步（+数据集 + 成员），但「类别」步骤仍是简单字符串列表 vs `ClassesSection.tsx` 的颜色 / 别名 / 父子结构编辑器；缺「属性 schema」步骤（`AttributesSection` 完整能力）。从 sections 抽 `ClassEditor` / `AttributeSchemaEditor` 子组件给向导复用即可。
- **`Project.in_progress_tasks` 改 stored counter**：v0.6.7-hotfix 把 `in_progress_tasks` 字段加到 `ProjectOut`，但实现是 `_serialize_project` 内即时 COUNT 查询 —— `GET /projects` 列 N 个项目就 N 次额外 SQL，hot path 上代价不可忽视。建议：① Project 表加 `in_progress_tasks` 列 ② 状态机变迁时（pending↔in_progress↔review↔completed）维护 ③ alembic 一次性回填。
- **项目模板**：当前每次新建项目都从 0 配置类别 / AI 模型；无「从已有项目复制」或「保存为模板」入口（v0.6.7 wizard 扩了 dataset + members 步骤，模板复用更有意义了）。

#### 数据 & 存储
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。
- **批次相关延伸**：① 智能切批（按难度/类别/不确定度）；② 批次级 IAA / 共识合并算法；③ 不可变训练快照 + 主动学习闭环。调研报告 [docs/research/12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md)。
- **link_project 自动 batch 命名去重**：v0.6.7 创建「{ds.name} 默认包」，但同一项目 unlink → re-link 同数据集会产生同名 batch；建议加序号或时间戳（如「{name} 默认包 #2」）。
- **批次级 reviewer 视图**：v0.6.7 推迟到 v0.6.8。Reviewer dashboard 当前是项目级 pending_review_count，未按 `assigned_user_ids` 包含 self 的 batch 筛选；workbench 已实现，dashboard 待对齐。
- **批次级智能分派**：BatchAssignmentModal 当前是手动多选；可加「按当前成员数量均匀分派」「按角色批量勾选」等批量动作。

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
- ✅ v0.6.6 已收：双行 UI 合并视图（`request_id` 持久化 + 前端 group + ▸ 折叠 + virtualizer）。

#### TopBar / Dashboard 控件
- **全局搜索**：TopBar 的 `<SearchInput placeholder="搜索项目、任务、数据集、成员..." kbd="⌘K">` 无 `value` / `onChange` / 提交 handler；后端无 `/search` 端点。
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast；Organization 表已存在但前端无切换 UI。
- **Dashboard 高级筛选 / 网格视图**：`DashboardPage.tsx:198-199` 两个 Button 无 onClick。

#### Annotator / Reviewer 工作台
- **AnnotatorDashboard `weeklyTarget = 200` 硬编码**：应来自项目级 / 用户级偏好。
- ✅ v0.6.6 已收：ReviewerDashboard 个人最近审核记录 + 5 张实时仪表卡（含 24h 通过率）。

#### v0.6.7 后续观察 / v0.6.8 候选

> v0.6.7 + hotfix 收口了项目管理员 4 项 BUG（B-10~B-13）；剩余推迟项与新发现：

##### 推迟自 v0.6.7 计划

- **Wizard step 2 升级到 ClassesSection 完整 `classes_config` 编辑**：颜色 / 别名 / 父子结构。从 `pages/Projects/sections/ClassesSection.tsx` 抽 `ClassEditor` 给向导复用。
- **Wizard 新增「属性 schema」步骤**：从 `AttributesSection.tsx` 抽 `AttributeSchemaEditor`，字段类型 / 必填 / hotkey / visible_if 一次配齐。
- **批次级 reviewer dashboard**：当前 reviewer dashboard 项目级聚合；workbench 已按 `assigned_user_ids` 过滤 batch，dashboard 待对齐。
- **B-12-④ 项目卡批次概览**：当前 dashboard 进度列只加了「→ 查看批次分派」深链；进一步可显示「N 个批次 · K 已分派」概览（需后端 ProjectStats 增字段，避免 N+1 查询）。

##### 推迟自 v0.6.6 计划（仍未落）

- **Bug 反馈延伸 LLM 聚类去重 + 邮件通知**：需要新引 LLM SDK（openai / anthropic / embedding-only）+ 实现 SMTP 发件链路。与 v0.6.6 已落地的「截图 + 涂抹 + MinIO 上传」无强耦合，单独成版本更合理。`bug_reports` 表加 `cluster_id` / `llm_distance` 字段；`POST /bug_reports/cluster` 已有占位实现可挂。
- **celery beat 定时清理软删评论附件**：v0.6.6 已用 MinIO bucket lifecycle 90 天兜底，但活跃评论的附件也会被 GC（接受），更精准的清理需要 celery beat + 定时扫 `is_active=false` AnnotationComment → 删 MinIO 对象。当前 celery 仅用作 broker，beat 未启用。
- **预提交钩子**：v0.6.6 已落 `.github/workflows/ci.yml`。本地 husky + lint-staged 是 nice-to-have。
- **`useCurrentProjectMembers` 顶层 context**：React Query 已按 queryKey 去重，引入 context 收益有限。
- **`usePopover` 剩余 4 处迁移**：TopBar 主题切换 / 智能切题菜单 / AttributeForm DescriptionPopover / CanvasToolbar 留作渐进迁移。

##### v0.6.7 写时新点

- **`Project.in_progress_tasks` 改 stored 列**：v0.6.7-hotfix 用即时 COUNT 实现，列项目时每行一次额外查询；改成持久化列 + 状态机维护。优先级 P2。
- **`ProgressBar` aiPct 启发式不真实**：dashboard `aiPct = Math.round(pct * 0.6)` 是装饰，不反映真实 AI 完成率。应基于 `predictions` / `annotations.parent_prediction_id` 真实数据计算。优先级 P2。
- **`UnlinkConfirmModal` 文案与按钮强度对齐**：v0.6.7-hotfix 已加「将一并删除 N 个任务（含 K 个已标注）」与红色按钮，但仍是单击直删；考虑改为输入数据集名称二次确认（与 DangerSection 删项目的强度一致）。优先级 P3。
- **WorkbenchShell.tsx 仍 924+ 行**：v0.6.7 增 `isOwner` / `useIsProjectOwner` 几行；下一刀候选 `<WorkbenchTopbar />` 子组件（含 ETA / 进度条 / 提交按钮 / batch 下拉），约 100 行 JSX。优先级 P3。
- **AuditPage 折叠 UI 缺持久化**：`expandedReqIds` 仅 in-memory；可加 sessionStorage 持久化最近展开的 request_id（30 分钟 TTL）。优先级 P3。
- **`uploadBugScreenshot` 失败回退体验**：v0.6.6 截图上传失败时降级为「无截图提交」并 toast warning；可加 retry 按钮 / 显式错误 UI。优先级 P3。
- **link_project 同名 batch 去重**：unlink → re-link 同 dataset 时新 batch 与历史 B-DEFAULT 同样可能撞名；建议带 dataset display_id 后缀或时间戳。优先级 P3。
- **`POST /orphan-tasks/cleanup` 大批量优化**：当前对 `orphan_ids` 用 `ANY(:ids)` 单次发；P-3 实测 1206 条 ~ 即时返回，但 10万级孤儿（理论上限）会走 array overflow。建议改 `WHERE id IN (subquery)` 直接联查。优先级 P3。

---

### B · 架构 & 治理向前演进

#### 安全
- **邀请频率限流**：单 actor 单日邀请上限，避免 spam。
- **2FA / TOTP**：super_admin 必选、其它角色可选。
- **API 密钥**：UsersPage 已有按钮，需 `api_keys` 表 + scope + revoke + 最后使用时间。
- **会话管理**：当前 token 过期前不可撤销；需 token blacklist 或 jti + Redis。「在所有设备登出」功能。
- **审计日志不可变**：当前 super_admin 仍可 `DELETE FROM audit_logs`；建议 PG row-level security 或 trigger 拒绝 DELETE/UPDATE。
- **CORS 收紧**：当前 `allow_origin_regex=r"http://localhost:\d+"`，production 需替换为白名单。
- **HTTPS 强制 / HSTS / CSP**：production 中间件层补齐。

#### 治理 / 合规
- **审计日志归档**：按月 PARTITION + 冷数据 S3 归档；后台 cron job 触发。
- **数据导出审计**：`GET /projects/{id}/export` 等批量导出应触发审计 + 下载者签名水印。
- ✅ v0.6.6 已收：GDPR 用户软删后 audit_logs.actor_email/actor_role 脱敏。
- **通知中心实时推送**：v0.4.8 30s 轮询已落；待升级为 Redis Pub/Sub WS 推送。
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

#### 可观测性
- ✅ v0.6.6 已收：Sentry 前后端接入（DSN 留空则不启用）。
- **Celery / ML Backend 指标**：v0.4.8 已加 HTTP metrics + DB pool + `/health/{db,redis,minio}`；缺 Celery 队列长度、Worker 心跳、ML Backend 平均延迟 / 失败率。
- **`/health/celery`**：v0.4.8 留下的待办；做成 broker ping + active worker count。
- **Bug 反馈系统延伸**：✅ v0.6.6 已收截图（html2canvas）+ 涂抹脱敏 + MinIO 上传；剩 LLM 聚类去重 + 邮件通知反馈者状态变更（v0.6.7 候选，见上）。

#### 性能 / 扩展
- **AuditMiddleware 写入异步队列**：当前每写请求一次 INSERT，写流量上来后改 Redis Stream / Kafka 异步消费，主请求 < 1ms 旁路。
- **Annotation 列表 keyset 分页**：v0.4.8 已对 audit_logs / tasks 改造；annotations 仍单次拉全（`useAnnotations` task 内全量），单任务 1000+ 框时阻塞渲染。
- **Predictions 表分区**：按 `project_id` 或 `created_at` PARTITION，单项目预测量大时查询性能下降。
- **WebSocket 多副本**：Redis Pub/Sub 已就位，但生产横向扩 uvicorn 副本时需测试 sticky session 与 broadcast 不重复。
- **useInfiniteQuery 缓存 GC**：工作台调置信度阈值会创建新 query key；旧 key 默认 5min GC，长时间调阈值会内存增长。建议 `cacheTime: 30s` for predictions / 切题时手动 `removeQueries`。

#### 测试 / 开发体验
- **前端单元测试**：v0.5.2 已落 vitest 基座，phase 2 累计 42 例（hotkey 32 + iou 10）；需扩展覆盖 hooks（`useAnnotationHistory` batch 命令、`useClipboard` 偏移粘贴、`useSessionStats` ring buffer、`replaceAnnotationId`）与关键组件（Modal、InviteUserModal 状态机、RegisterPage 三态、`<DropdownMenu>` 键盘导航）。
- **E2E 测试**：Playwright 录制邀请→注册→标注→审核→审计核心 5 条用户流程。
- **CI/CD pipeline**：`.github/workflows/` 缺；至少 lint + tsc + pytest + 镜像构建 + vitest + `pnpm codegen` 校验前后端 schema 同步。
- **预提交钩子**：husky + lint-staged + ruff + tsc + vitest run --changed。

#### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **无障碍**：ARIA 属性极少；Lighthouse Accessibility 分数应作为 PR gate。

#### 文档
- **部署文档**：缺 production 部署清单（环境变量、TLS、备份、初次 bootstrap_admin 步骤）。
- **安全模型文档**：RBAC 矩阵、审计字段释义、邀请流程时序图。
- **API 使用指南**：FastAPI 自动 `/docs` 已有，但缺示例与最佳实践（特别是 ML Backend 协议、WebSocket 订阅）。
- **快捷键文档**：v0.6.2 后工作台快捷键 30+ 静态 + 动态属性键，HotkeyCheatSheet 是 SoT 但缺独立 Markdown 用户文档（QA / 运营培训用）。

---

### C · 标注工作台专项优化（性能 / 界面 / 标注体验）

> 现状基线（截至 v0.6.2）：`WorkbenchShell` 三层架构（shell + stage + state）已稳定；Konva 画布 / 4 Layer / 虚拟化任务标注列表 / blurhash / Minimap / 阈值服务端化 / 批量编辑 / IoU 项目级阈值 / ETA / 智能切题 / polygon 编辑闭环 / 项目级属性 schema + hotkey 绑定 / 离线队列 + 多 tab 同步 + tmpId 端到端 + 抽屉 UI / 评论 polish（@ 提及 + 附件 + 画布批注）/ 暗色模式 / Lucide 图标体系等已落地。
> 横向参考：CVAT（Konva 画布 + 关键帧插值 + 骨架）、Label Studio（interactive ML backend，SAM 触点）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量类别检测）。

#### C.1 渲染性能 / 大图大量框
- **OpenSeadragon 瓦片金字塔**：当前直接加载完整图像，> 50MP 会卡。需要后端切瓦片 + 前端 OpenSeadragon viewport，与 Konva overlay 共生。极大图场景才必要。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。`useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。
- **IoU 去重几何加速**：v0.5.2 用 useMemo + 嵌套循环 O(N×M)。如果掉帧，上空间索引 rbush（仅同类内分片）。

#### C.2 界面优化（信息架构 / 可见性 / 一致性）
- **`<DropdownMenu>` 第 3+ 个使用方收编**：phase 2 已抽通用组件并接入 TopBar / Topbar；剩余 ProjectsPage 卡片操作菜单等若干散落 dropdown。
- **阈值控件统一**：Topbar 已有数值浮出反馈（`[`/`]`键），AIInspectorPanel 仍是 slider 主入口；统一为 Topbar 主控 + AI 面板小数值显示。
- **Reviewer 端实时仪表卡**：与 A 中并跟进，画布外右侧栏空间承接。

#### C.3 标注体验（核心生产力杠杆）
- **SAM mask → polygon 化（marching squares / simplify-js）**：与 SAM 接入一起做。
- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90%；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式）。
- **Shift 锁定纵横比 / Alt 从中心 resize**：v0.4.9 留下的 TODO；resize handle 8 锚点已就位，加修饰键判断即可。
- **SAM 交互式标注（点 / 框 → mask）**：研究报告 `06-ai-patterns.md`「模式 B」P1。最小切片：
  - 后端：`POST /projects/{pid}/ml-backends/interactive`，路由到 `is_interactive=True` 的 ML backend；常驻 GPU 容器 + image embedding LRU 缓存（首次 ~300ms，命中 < 50ms）。
  - 前端：新工具 `S`（SAM 模式），点击 = positive point、Alt+点击 = negative point、拖框 = bbox prompt；返回多边形以「待确认紫虚线」叠加，Enter 接受 / Esc 取消。
  - 与现有 GroundingDINO 配合：「文本框 → 全图批量同类」 vs 「点 / 框 → 单实例精修」两条路并存。
- **关键帧插值（视频/序列）**：CVAT 同款；标注员只标 1 / 30 / 60 帧，中间线性插值。需配合 `Task.dimension` 字段。
- **类别确认 hint**：刚画完一个框时，AI 后台跑一次单框分类，右上角弹「建议：标识牌（92%）」+ 一键采纳。
- **Magic Box / Snap**：粗略画一个大框 → AI 收紧到对象边缘（SAM 推 mask → 取 mask bbox）；同时支持「贴边吸附」。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **任务跳过与原因**：标注员可「跳过本题」并选原因（图像损坏 / 无目标 / 不清晰），后端记 `Task.skip_reason` 并自动转 reviewer 复核。
- **History 持久化（sessionStorage）**：刷新页面 history 清空；将 undo/redo 栈序列化到 sessionStorage（5 分钟 TTL）。需小心 redo 命令引用的 prediction id 可能已变；与 `replaceAnnotationId` 协同。
- **`U` 键准确度升级**：v0.5.2 用启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）。

#### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> 决策：**单工作台外壳 + 按维度切分的画布渲染器 + 工具可插拔**（v0.4.9 Step 1 完成）。当前只支持矩形框 + polygon，数据模型 `annotation_type: String(30)` + `geometry: JSONB` discriminated union 已为多类型留好口子。

- **Layer 1 · 工作台外壳（`<WorkbenchShell>`）**：路由 `/projects/:id/annotate`、左侧任务队列、Topbar、AI 助手、状态栏、各 hooks。跨所有类型共用 ~80%。
- **Layer 2 · 画布渲染器（按维度切，3 个）**：
  - `<ImageStage>`：image-det / image-seg / image-kp / mm（图像类）共用 ✅
  - `<VideoStage>`：video-mm / video-track，多了**时间轴 + 关键帧插值**控件
  - `<LidarStage>`：lidar 单独，Three.js / WebGL viewport
- **Layer 3 · 工具（画布内插件）**：每个工具实现统一接口 `{ id, hotkey, icon, onPointerDown, ... }`。当前 `<ImageStage>` 注册 BboxTool / HandTool / PolygonTool。
- **Step 2 触发条件**：业务需要 keypoint / video / lidar 时才动；当前 image-det + polygon 双类型不必预先抽象。

---

### 优先级建议（参考）

> 已完成的项不再列出，参考 CHANGELOG。下面只是当前 open 的优先级。

| 优先级 | 候选项 | 理由 |
|---|---|---|
| **P1** | TopBar 通知中心、UsersPage API 密钥、「存储与模型集成」对接 | 用户每天面对，残缺感最强 |
| **P1** | C.3 SAM 交互式（点/框→mask）+ SAM mask → polygon 化 | 核心差异化，研究报告明确 P1 |
| **P1** | Bug 反馈延伸 LLM 聚类去重 + 邮件通知 | v0.6.6 截图链路已落，剩 LLM + SMTP；管理员 triage 体感 |
| **P1** | Wizard step 2/3 升级到完整 ClassesSection / AttributesSection 编辑器 | v0.6.7 推迟，向导仍存「半残」感 |
| **P2** | 非 image-det 工作台（image-seg → keypoint → video → lidar） | 体量大，按业务优先级排队 |
| **P2** | C.3 marquee / 关键帧 / 任务跳过 / 会话级标注辅助 | 业务复杂度起来后必需 |
| **P2** | C.1 OpenSeadragon 瓦片金字塔、IoU rbush 加速 | 千框 / 4K 大图场景才必要 |
| **P2** | C.3 history 持久化（undo/redo 栈 sessionStorage） | quick win，工时少 |
| **P2** | `Project.in_progress_tasks` 改 stored 列 | v0.6.7-hotfix 即时 COUNT 列项目时 N 次查询 |
| **P2** | `ProgressBar` aiPct 启发式 → 真实 AI 完成率 | dashboard 现 `pct * 0.6` 是装饰 |
| **P2** | 批次级 reviewer dashboard | workbench 已按 batch 过滤，dashboard 待对齐 |
| **P2** | 审计日志归档（PARTITION）、AuditMiddleware 队列化、useInfiniteQuery 缓存 GC | 当前数据量未到瓶颈，监控触发再做 |
| **P2** | `<DropdownMenu>` 全站第 3+ 个使用方收编 + `usePopover` 剩余 4 处迁移 | v0.6.6 hook 已上架，扫尾即可 |
| **P3** | WorkbenchShell 第四刀（拆 `<WorkbenchTopbar />` 子组件，~100 行 JSX） | v0.6.6 第三刀后 shell 仍 924+ 行；收益中等 |
| **P3** | UnlinkConfirmModal 升级到「输入数据集名称」二次确认 | 与 DangerSection 删项目强度对齐 |
| **P3** | link_project 同名 batch 去重命名 | unlink → re-link 同 dataset 会撞名 |
| **P3** | 项目卡批次概览（N 个批次 · K 已分派） | 需后端 ProjectStats 加字段避免 N+1 |
| **P3** | husky + lint-staged 预提交钩子 | v0.6.6 CI 已能拦回归，本地拦截是 nice-to-have |
| **P3** | AuditPage 折叠 UI sessionStorage 持久化、bug 截图失败 retry UI | v0.6.6/0.6.7 写时观察项 |
| **P3** | i18n、SSO、2FA | 客户具体需求驱动 |
| **P3** | C.3 SAM 后续延伸：Magic Box、类别确认 hint | 依赖 SAM 基座 + 通知中心 |

---
