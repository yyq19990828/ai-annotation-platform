## 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本详见 [CHANGELOG.md](../CHANGELOG.md)：v0.6.0 ~ v0.6.10-hotfix 同前；**v0.7.0（批次状态机重设计 epic + v0.6.x 后续观察集中收口：transition 鉴权矩阵 + reviewer 可见性 + 批次级 review UI + RejectBatchModal + reject_batch 软重置（alembic 0027）+ 0-task 拦截 + Project.in_progress_tasks stored 列（alembic 0028）+ 通知偏好基础静音（alembic 0029）+ WS ConnectionPool + 心跳 + bug_reports reopen 单独限流 + Wizard ClassEditor 抽取 + ProgressBar aiPct 真实化 + reviewer dashboard 按批次分组 + 项目卡批次概览 + UnlinkConfirmModal 输入名称 + AuditPage sessionStorage + 截图重试 UI + celery beat 软删附件清理 + test_batch_lifecycle.py 16 例覆盖）**。

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

#### TopBar / Dashboard 控件
- **全局搜索**：TopBar 的 `<SearchInput placeholder="搜索项目、任务、数据集、成员..." kbd="⌘K">` 无 `value` / `onChange` / 提交 handler；后端无 `/search` 端点。
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast；Organization 表已存在但前端无切换 UI。
- **Dashboard 高级筛选 / 网格视图**：`DashboardPage.tsx:198-199` 两个 Button 无 onClick。

#### Annotator / Reviewer 工作台
- **AnnotatorDashboard `weeklyTarget = 200` 硬编码**：应来自项目级 / 用户级偏好。

#### v0.7.x 后续观察 / 下版候选

> v0.7.0 集中收口了批次状态机 epic + v0.6.x 写时观察 18 项；下面列写时新观察项：

- **Wizard 新增「属性 schema」步骤**：v0.7.0 已抽 `<ClassEditor>` 升级类别步骤；属性 schema 步骤需抽 `<AttributeSchemaEditor>`（字段类型 / 必填 / hotkey / visible_if 一次配齐）+ Wizard 扩为 6 步。Wizard 已 1009 行，抽取链较深，推迟。优先级 P2。
- **NotificationsPopover usePopover 迁移**：父级以 `open / onClose` 控制流，迁移到 `usePopover` 需重构 TopBar 集成模式。优先级 P3。
- **ProjectsPage 卡片操作菜单收编 DropdownMenu**：3 按钮（导出 / 设置 / 打开）合并到 `⋮` 触发的 DropdownMenu。优先级 P3。
- **`task.reopen` 通知 fan-out**：v0.7.0 删了 `/auth/me/notifications` 后，`test_task_reopen_notification` 暂跳过；将来 reopen 端点应 fan-out `task.reopened` type 到 NotificationService（已为通知偏好基础静音留好接口），把「通知原 reviewer」的语义从 audit-derived 迁到通知中心持久化。优先级 P2。
- **批次状态看板（kanban 视图）**：v0.7.0 BatchesSection 加了 4 个新按钮（提交质检 / 通过 / 驳回），但 7 态卡片墙 + 批次拖拽流转 owner 治理界面未做（与 transition 鉴权冲突需谨慎）。优先级 P3。
- **standalone batch_summary stored 列**：v0.7.0 项目卡批次概览用 GROUP BY 单查询返回 `{total, assigned, in_review}`，每次 list_projects 都触发；如需更冷优化，可加 stored 列由 batch 状态机变迁维护。优先级 P3，监控触发再做。

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
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

#### 可观测性
- **Celery / ML Backend 指标**：v0.4.8 已加 HTTP metrics + DB pool + `/health/{db,redis,minio}`；缺 Celery 队列长度、Worker 心跳、ML Backend 平均延迟 / 失败率。
- **`/health/celery`**：v0.4.8 留下的待办；做成 broker ping + active worker count。
- **Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest**：v0.6.9 闭环 + 通知已落，剩 LLM SDK + SMTP 链路；`bug_reports` 加 `cluster_id` / `llm_distance`；与通知偏好（按 type 静音）协同。

#### 性能 / 扩展
- **AuditMiddleware 写入异步队列**：当前每写请求一次 INSERT，写流量上来后改 Redis Stream / Kafka 异步消费，主请求 < 1ms 旁路。
- **Annotation 列表 keyset 分页**：v0.4.8 已对 audit_logs / tasks 改造；annotations 仍单次拉全（`useAnnotations` task 内全量），单任务 1000+ 框时阻塞渲染。
- **Predictions 表分区**：按 `project_id` 或 `created_at` PARTITION，单项目预测量大时查询性能下降。
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
| **P1** | UsersPage API 密钥、「存储与模型集成」对接 | 用户每天面对，残缺感最强 |
| **P1** | C.3 SAM 交互式（点/框→mask）+ SAM mask → polygon 化 | 核心差异化，研究报告明确 P1 |
| **P1** | Wizard 新增「属性 schema」步骤（抽 `<AttributeSchemaEditor>`） | v0.7.0 已升级类别步骤；属性 schema 步骤推迟 |
| **P2** | Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest | v0.7.0 通知偏好（基础静音）已落，邮件 channel 字段已就位但 UI 未启；与 LLM 聚类协同 |
| **P2** | 非 image-det 工作台（image-seg → keypoint → video → lidar） | 体量大，按业务优先级排队 |
| **P2** | C.3 marquee / 关键帧 / 任务跳过 / 会话级标注辅助 | 业务复杂度起来后必需 |
| **P2** | C.1 OpenSeadragon 瓦片金字塔、IoU rbush 加速 | 千框 / 4K 大图场景才必要 |
| **P2** | C.3 history 持久化（undo/redo 栈 sessionStorage） | quick win，工时少 |
| **P2** | `task.reopen` 通知 fan-out 到通知中心 | v0.7.0 删 audit-derived 后 reopen 通知留作下版 |
| **P2** | 审计日志归档（PARTITION）、AuditMiddleware 队列化、useInfiniteQuery 缓存 GC | 当前数据量未到瓶颈，监控触发再做 |
| **P3** | NotificationsPopover usePopover 迁移 + ProjectsPage 卡片操作菜单收编 DropdownMenu | v0.7.0 写时观察 |
| **P3** | 批次状态看板（kanban 视图） | 7 态卡片墙 + owner 治理界面，与 transition 鉴权冲突需谨慎 |
| **P3** | husky + lint-staged 预提交钩子 | v0.6.6 CI 已能拦回归，本地拦截是 nice-to-have |
| **P3** | i18n、SSO、2FA | 客户具体需求驱动 |
| **P3** | C.3 SAM 后续延伸：Magic Box、类别确认 hint | 依赖 SAM 基座 |

---
