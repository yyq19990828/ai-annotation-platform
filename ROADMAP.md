## 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本详见 [CHANGELOG.md](./CHANGELOG.md)：v0.6.0 ~ v0.6.10-hotfix 同前；v0.7.0 批次状态机重设计 epic 同前；**v0.7.2（治理可视化 + 全局导航）**；**v0.7.3（批次状态机扩展 + 多选批量操作 + 操作历史）**；**v0.7.4（测试与文档体系一次性建齐）**；**v0.7.5（性能 & DX 收尾）**；**v0.7.6（功能补缺 + 治理深化）**；**v0.7.7（登录注册机制完善）**；**v0.7.8（登录注册改进 + 安全加固 + 治理合规）**；**v0.8.0（文档细化与补全：deploy/security/ml-backend-protocol/ws-protocol 4 篇新文档 + ADR 0002-0005 回填 + 快捷键 SoT 自动生成 + data-flow mermaid 代码路径标注 + add-api-endpoint 改 logout 真实例 + 16 处截图占位 + IMAGE_CHECKLIST）**；**v0.8.1（治理合规向收口 epic：系统设置可编辑 + SMTP 测试发送 + 注册来源统计卡 + 管理员重置低等级用户密码 + 账号自助注销 7 天冷静期 + audit_logs 按月分区 + 冷数据归档 + 4 个导出端点审计强化）**；**v0.8.2（文档深度优化：docs:build 进 CI gate + snippet 漂移 lint + ADR sidebar mirror + echo-ml-backend 可执行样板 + ADR-0008 admin-locked 状态机草稿）**。

---

### A · 代码观察到的硬占位 / 残留 mock

#### 项目模块
- **非 image-det 类型的标注工作台**：image-seg / image-kp / lidar / video-mm / video-track / mm 共 6 类点击「打开」仅显示 toast `类型 X 的标注界面尚未实现`（`DashboardPage.tsx:139`、`ViewerDashboard.tsx:31`）。
- **项目模板**：当前每次新建项目都从 0 配置类别 / AI 模型；无「从已有项目复制」或「保存为模板」入口（v0.7.6 wizard 已扩为 6 步含属性 schema，模板复用更有意义了）。

#### 数据 & 存储
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。
- **批次相关延伸**：① 智能切批（按难度/类别/不确定度）；② 批次级 IAA / 共识合并算法；③ 不可变训练快照 + 主动学习闭环。调研报告 [docs/research/12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md)。
- **批次状态机增补 · 二阶段**（v0.7.3 已收 3 条 owner 逆向迁移 + 4 项多选批量；v0.7.6 已收 reset → draft 终极重置；以下为延后项）：
  - `annotating → active` 暂停：项目临时叫停。**难点**：调度器（`scheduler.check_auto_transitions`）一旦看到 `in_progress` task 就会立刻把 batch 推回 `annotating`，需要同时把 in_progress task 复位到 pending（释放标注员锁）+ 引入 batch 级「admin-locked」标志阻断调度器，否则迁移做了等于没做。
  - 批量状态迁移类（bulk-approve / bulk-reject）：v0.7.3 故意未做。reject 反馈是逐批次语义、approve 跳过逐批次审视有质检失职风险。落地前先讨论 UX。

#### AI / 模型
- **AI 预标注独立页**：路由 `/ai-pre` 为占位 PlaceholderPage。Dashboard「AI 预标注队列」卡片永久显示空状态（`AdminDashboard.tsx:107-119`、`DashboardPage.tsx:287-291`）。
- **模型市场**：路由 `/model-market` 占位；项目级 ML Backend 真实选择 / 挂接 UI 缺失（向导步骤 3 仅录入模型名称字符串）。
- **训练队列**：路由 `/training` 占位。
- **预测成本统计**：后端 `prediction_metas` 表已记录 token / 耗时 / 成本，但前端无任何可视化（应进入 AdminDashboard 的成本卡片，并向工作台 AI 助手面板透传"本题花费 X 元 / Y tokens"）。
- **失败预测重试**：`failed_predictions` 表记录但无 UI 触发重试。
- **ML Backend 健康检查**：`MLBackendService` 只在管理员手动点击时探活，无后台周期任务。v0.8.0 协议文档已就位，可直接基于 `/health` 实现一个 Celery beat 周期任务。

#### 用户与权限页（UsersPage）
- **「API 密钥」按钮**：`UsersPage.tsx:63` 无实现（API key 模型也未建表）。需 `api_keys` 表 + scope + revoke + 最后使用时间。
- **「存储与模型集成」面板**：`UsersPage.tsx:246-269` 全部 mock 数据，应对接 `/storage/health` 与 `/projects/{pid}/ml-backends`。
- **在线状态心跳机制**：2026-05-06 修复了登录不切 `online` 的 BUG（auth.py login/logout/logout-all 同步切 status），但仅靠登录/登出事件不准确——用户直接关浏览器、token 过期、网络断开都会停留在 `online`。需要 `last_seen_at` 列 + 前端定时（30s）打 `POST /me/heartbeat` + Celery beat 周期把 `last_seen_at < now-N min` 用户置 `offline`。同时把 `UsersPage.tsx:150` 的「本周活跃」改成基于 `last_seen_at` 而非 `status` 的 7 日窗口聚合。

#### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**：语言 / 主题 / 时区 / 通知偏好均无（依赖 i18n / 主题基础设施先建立）。

#### TopBar / Dashboard 控件
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast；Organization 表已存在但前端无切换 UI。

#### Annotator / Reviewer 工作台
- **AnnotatorDashboard `weeklyTarget = 200` 硬编码**：应来自项目级 / 用户级偏好。

#### 登录 / 注册 / 认证
- **开放注册二阶段增强**（v0.7.7 落了基座，以下为可选延伸）：
  - **邮箱验证**：当前 viewer 零权限可跳过；若未来开放注册默认角色调高，需 `POST /auth/verify-email` + `email_verified_at` 字段 + 验证前 `is_active=false`。
  - **CAPTCHA / 防机器人**：v0.7.7 的 3/min rate limit 对 production 够用但不防分布式刷号；接 hCaptcha / Turnstile，前端 `OpenRegisterForm` 加 CAPTCHA widget + 后端校验 token。
  - **OAuth2 / 社交登录**：Google / GitHub SSO，python-social-auth 或 authlib；`User.oauth_provider` + `oauth_id` 字段；LoginPage / RegisterPage 加「使用 Google 登录」按钮。

#### v0.7.x ~ v0.8.0 后续观察 / 下版候选

> v0.7.0 集中收口了批次状态机 epic + v0.6.x 写时观察 18 项；v0.7.6 一次清了 4 项（属性 schema 步骤 / NotificationsPopover usePopover 迁移 / ProjectsPage 卡片 DropdownMenu / task.reopen fan-out / Kanban 看板）；v0.7.7 落了开放注册基座；v0.8.0 一次性把开发文档分组与 ADR 0002-0005 补齐；v0.8.2 把文档体系四处机制缝隙（CI gate / snippet lint / ADR sidebar / echo 样板）以自动化方式收齐；下面列剩余观察项：

- **standalone batch_summary stored 列**：v0.7.0 项目卡批次概览用 GROUP BY 单查询返回 `{total, assigned, in_review}`，每次 list_projects 都触发；如需更冷优化，可加 stored 列由 batch 状态机变迁维护。**v0.7.6 评估后推迟**：触发点 8 处维护成本高，当前 GROUP BY 性能未到瓶颈。优先级 P3，监控触发再做。
- **fabric.js dead dep 清理**：v0.8.0 写 ADR-0004 时确认 `apps/web/package.json:fabric@^6.5.0` 实际未在 `src/` 任何文件引用（仅 `App.tsx:20` 有一处注释提到）。下次依赖清理 PR 一并删除，省 ~150KB bundle / 一项 supply-chain 风险面。
- **getting-started 与 SoT 漂移**：v0.8.0 已修过一次（W/R/Ctrl+Enter → B/V/E）。文档站文字硬编码的快捷键提示如再次漂移仍需手改，长期可考虑给所有 .md 中的 `` `<键>` `` 内联引用建一份从 hotkeys.ts 推导的 ESLint/markdownlint 规则；优先级低，等漂移再触发。

---

### B · 架构 & 治理向前演进

#### 安全
- **2FA / TOTP**：super_admin 必选、其它角色可选。
- **API 密钥**：UsersPage 已有按钮，需 `api_keys` 表 + scope + revoke + 最后使用时间。
- **HTTPS 强制 / HSTS / CSP**：production 中间件层补齐。v0.8.0 `deploy.md` 已写 nginx 端 TLS 终结示例，但 FastAPI 侧没有 strict-transport-security / CSP middleware；建议加 `app/middleware/security_headers.py` + production-only 注册。
- **审计日志不可变 trigger 测试覆盖**：v0.7.8 落了 PG trigger + GDPR `SET LOCAL` 豁免，但缺测试。建议加 `tests/test_audit_immutability.py` 覆盖三条：① 普通 UPDATE/DELETE 抛 RAISE；② `SET LOCAL` 后允许；③ pg_restore 走 COPY 不被阻断。security.md 已声称该机制可靠，需要测试兜底。

#### 治理 / 合规
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

#### 可观测性
- **Celery / ML Backend 指标**：v0.4.8 已加 HTTP metrics + DB pool + `/health/{db,redis,minio,celery}`（v0.7.5 补齐 celery）；缺 Celery 队列长度、Worker 心跳、ML Backend 平均延迟 / 失败率。
- **Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest**：v0.6.9 闭环 + 通知已落，剩 LLM SDK + SMTP 链路；`bug_reports` 加 `cluster_id` / `llm_distance`；与通知偏好（按 type 静音）协同。

#### 性能 / 扩展
- **AuditMiddleware 写入异步队列**：~~当前每写请求一次 INSERT~~ → v0.7.6 已落 Celery 异步 + AUDIT_ASYNC 开关 + sync fallback。如需 Redis Stream / Kafka 替代 Celery 路径再开新 issue。
- **Annotation 列表 keyset 分页**：~~annotations 仍单次拉全~~ → v0.7.6 已落新端点 `GET /tasks/{id}/annotations/page?limit&cursor` + 复合索引；前端 `useAnnotations` 仍用旧数组端点（cap=2000 为防性能场景），改 useInfiniteQuery 推迟到 1000+ 框监控触发。
- **Predictions 表分区**：v0.7.6 已落 Stage 1（`ix_predictions_created_at` 索引）+ ADR-0006 设计 Stage 2 完整 RANGE(created_at) 月分区。Stage 2 触发条件：单月 INSERT > 100k 或 总行数 > 1M（FK 复合化代价 + annotations 表迁移成本）。

#### 测试 / 开发体验
- **前端单元测试 — 页面级覆盖**：vitest + MSW 基座已就位（v0.7.4）；v0.7.6 已把 baseline 从 4.27% 推到 8.68%（新增 29 个测试覆盖 AttributeSchemaEditor / Modal / DropdownMenu / BatchesKanbanView / useClipboard）。剩余目标 ≥ 25% 持续提升：补 hooks（`useSessionStats` ring buffer / `replaceAnnotationId`）+ 关键组件（InviteUserModal 状态机、RegisterPage 三态）+ Dashboard / ProjectList / WorkbenchShell 三个页面级单测。
- **E2E spec 写实**：v0.7.4 已搭好 Playwright 骨架，三个 spec（auth / annotation / batch-flow）全 `.skip` 占位且 e2e job `continue-on-error: true`。需先把 `auth.spec.ts` 写实（登录页 → dashboard、错密码、JWT 过期），加 `e2e/fixtures/seed.ts` 调后端造种子数据（`apps/api/tests/factory.py` + 仅 ENV=test 挂载的 `_test_seed.py` 路由），跑通后去掉 `continue-on-error`。然后第二轮 annotation bbox 完整链路。**v0.7.6 评估后推迟**：1-2 天深度活，本期窗口不足。
- **覆盖率门槛硬阻断**：v0.7.6 已落 `codecov.yml` 显式 backend 60% / frontend 8% target（基线值），全部 informational 不阻断。frontend 持续 ≥ 25% 后切硬阻断。

#### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **无障碍**：ARIA 属性极少；Lighthouse Accessibility 分数应作为 PR gate。

#### 文档（v0.7.4 已搭 VitePress 文档站三栏骨架；v0.8.0 一次性把开发文档分组、ADR 0002-0005、协议契约、SoT 自动化补齐）

- **用户手册截图回填（IMAGE_CHECKLIST 16 处）**：v0.8.0 已在 `getting-started.md`、`workbench/{bbox,polygon,keypoint}.md`、`projects/`、`review/`、`export/` 共 16 处放好截图占位 + 拍摄要求注释，详见 [`docs-site/user-guide/IMAGE_CHECKLIST.md`](docs-site/user-guide/IMAGE_CHECKLIST.md)。本期未回填真实图（PNG 占位为 1×1 透明），0.8.1 候选。
  - **截图自动化方案（替代手工拍图）**：可写 Playwright 脚本基于 `e2e/fixtures/seed.ts`（与 E2E spec 共建）跑一遍 16 个场景自动截图，输出到 `images/` 各子目录。优势：UI 改完 CI 自动重生成；红框 / 标注通过 `page.evaluate` 注入临时 CSS；时间敏感数据（日期 / 头像）可在 fixture 里定值。劣势：动画类（toast、过渡）截不准，仍需手工兜底。建议与「E2E spec 写实」P1 同期推进。

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
| **P1** | C.3 SAM 交互式（点/框→mask）+ SAM mask → polygon 化 | 核心差异化，研究报告明确 P1；v0.8.0 ML Backend 协议契约文档已为接入侧扫清障碍 |
| **P1** | E2E spec 写实（auth → annotation → batch-flow）+ 去 `continue-on-error` | v0.7.6 推迟（1-2 天深活）；factory + seed.ts + 三 spec 写实是 PR 红线收紧前置；与「截图自动化」共建 fixture |
| **P1** | 截图自动化（Playwright + IMAGE_CHECKLIST 16 处）替代手工拍图 | v0.8.0 占位就位；与 E2E spec 共用 fixture，一次写完两件事 |
| **P2** | 开放注册 CAPTCHA 防刷号 + 邮箱验证（角色提升前置） | v0.7.7 基座已落，production 放量前需加固 |
| **P2** | OAuth2 / 社交登录（Google / GitHub SSO） | 降低注册门槛，企业场景 SSO 常见需求 |
| **P2** | 系统设置 admin UI 可编辑（含开放注册 toggle） | 当前所有系统设置仅 env 控制，运维成本高 |
| **P2** | HTTPS 强制 / HSTS / CSP middleware | v0.8.0 deploy.md 已写 nginx 端 TLS，FastAPI middleware 缺 strict-transport-security / CSP；production-only 注册 |
| **P2** | 审计日志不可变 trigger 测试覆盖 | v0.7.8 trigger 已落，security.md 已宣称可靠，需 `tests/test_audit_immutability.py` 兜底 |
| **P2** | Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest | v0.7.0 通知偏好（基础静音）已落，邮件 channel 字段已就位但 UI 未启；与 LLM 聚类协同 |
| **P2** | 非 image-det 工作台（image-seg → keypoint → video → lidar） | 体量大，按业务优先级排队 |
| **P2** | C.3 marquee / 关键帧 / 任务跳过 / 会话级标注辅助 | 业务复杂度起来后必需 |
| **P2** | C.1 OpenSeadragon 瓦片金字塔、IoU rbush 加速 | 千框 / 4K 大图场景才必要 |
| **P2** | C.3 history 持久化（undo/redo 栈 sessionStorage） | quick win，工时少 |
| **P2** | 审计日志归档（PARTITION）；AuditMiddleware 队列化 v0.7.6 已落 Celery | 当前数据量未到瓶颈，监控触发再做 |
| **P2** | 前端单测持续提升到 ≥ 25% + 切覆盖率硬阻断 | v0.7.6 baseline 8.68%（+29 测试 from 4.27%）；目标 25% 后切去 informational |
| **P2** | 批次状态机二阶段剩余：`annotating → active` 暂停（实施 ADR-0008） + bulk-approve / bulk-reject | v0.8.2 ADR-0008 已 Proposed（admin-locked 正交字段 + lock/unlock API + 表迁移 SQL）；v0.9 实施前需补 scheduler 测试覆盖；bulk approve/reject UX 待定 |
| **P3** | fabric.js dead dep 清理 | v0.8.0 ADR-0004 确认未使用；下次 dep 清理 PR 顺手 |
| **P3** | predictions 月分区 Stage 2 完整迁移 | v0.7.6 已落 Stage 1 索引 + ADR-0006；触发条件单月 INSERT > 100k 或 总行数 > 1M |
| **P3** | projects.batch_summary stored 列 | v0.7.6 评估后推迟；触发点 8 处维护成本高，当前 GROUP BY 性能未到瓶颈 |
| **P3** | i18n、2FA | 客户具体需求驱动（SSO 已单独提升到 P2） |
| **P3** | C.3 SAM 后续延伸：Magic Box、类别确认 hint | 依赖 SAM 基座 |

---
