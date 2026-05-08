# 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本详情见 [CHANGELOG.md](./CHANGELOG.md) 与 [docs/changelogs/](docs/changelogs/)；最近一版 **v0.9.8 (Fluffy Cosmos)** — Prediction Job 历史 + WS 全局可见性 + URL validator + schema 边界. 0.9.x 段暂存 root CHANGELOG，开 v0.10 时再迁回 `docs/changelogs/0.9.x.md`.

---

## 即将到来（按版本切片的详细计划）

> 大颗粒 epic 拆到独立文档；下面 §A/§B/§C 仍维护单条颗粒度的待办。

### 已收尾（条目越短越好；详情看 plan 文件 / CHANGELOG）

- ~~**v0.9.8 — Fluffy Cosmos**~~ ✅ Prediction job 历史 + WS 全局可见性 + URL loopback validator + schema 边界文档. → [plan](docs/plans/2026-05-08-v0.9.8-fluffy-cosmos.md). 清空 v0.9.7 4 项 known gaps（schema codegen 派生留 v0.9.9 — 等后端 `PredictionShape` Pydantic 收口）.
- ~~**v0.9.7 — Virtual Lynx**~~ ✅ AIPreAnnotatePage 478 行单文件拆 6 子组件 + stepper + 草稿 / 历史表 + alias 频率排序 + Wizard backend 复用. → [plan](docs/plans/2026-05-08-v0.9.7-virtual-lynx.md).
- ~~**v0.9.6 — Agile Kernighan**~~ ✅ 工具栏 P2-b + alias schema 规范化 + ml_backends.health_meta + `/admin/preannotate-queue` + Topbar 紫徽章 + 用户手册 sam-tool/ai-preannotate. → [plan](docs/plans/2026-05-08-v0.9.6-agile-kernighan.md).
- ~~**v0.9.x — Grounded-SAM-2 接入（首版 AI 基座）**~~ ✅ M0–M5 + chip 包，`/ai-pre` 文本批量预标 + 工作台 `S` 工具 + ADR-0012/0013. 详细已归档.

### 计划中

- **[v0.10.x — SAM 3 接入（与 Grounded-SAM-2 并存）](./ROADMAP/0.10.x.md)**：新增 sam3-backend 作为高精度选项，**不替换** v0.9.x grounded-sam2-backend；增加 exemplar prompt + 路由策略 UI + AB 对比工具。共享 `apps/_shared/mask_utils/`。预计 ~3.5 周。

---

## 当前焦点（按"何时触发"分组）

> 优先级表（§ 末尾）按价值/成本排序；本节按**触发条件**重组，一眼看清"现在能做什么 / 等什么再做"。

### 现在可做（无前置依赖，作为 `chip:maintenance` 穿插推进，不抢 v0.10.x 主线）

- **CSP nonce-based 收紧**（P2，与 vite plugin 同窗口做）
- **OpenSeadragon 瓦片金字塔**（P2，§C.1，极大图 > 50MP 才必要）
- **i18n 框架接入**（P3，与 ProjectSettingsPage 重构合并节省破窗成本）
- **截图 fixture 数据补齐 + 重跑**（P3）：v0.9.7 19 张 PNG 已 commit，4 张空白态需在 `apps/api/scripts/seed.py` 或 scene `prepare()` 钩子造数据后重跑（`ai-pre-history-search` / `ai-pre-empty-alias` / `bbox-iou` / `bbox-bulk-edit`）。
- **v0.9.8 落地后新发现**（v0.9.9 候选，~2-3d）：① 后端加 `PredictionShape` Pydantic 模型 wire 到 `PredictionOut.result`，前端切 codegen 派生（详见 `docs-site/dev/architecture/api-schema-boundary.md`）；② `prediction_jobs.total_cost` 接通 `PredictionMeta.total_cost` 累加 (字段就位 `Numeric(10, 4) NULL`)。
- **mask→polygon 多连通域 / 空洞支持**（P2，长尾 follow-up，与 sam3-backend 共做）：详见 §A.AI / 模型 与优先级表对应行。

### 等业务规模 / 监控触发（先观察、不做）
- **predictions 月分区 Stage 2**：单月 INSERT > 100k 或 总行数 > 1M（ADR-0006）
- **batch_summary stored 列**：当前 GROUP BY 性能未到瓶颈（v0.7.6 评估推迟）
- **审计日志归档物化**：v0.8.1 已落 partition + Celery beat archive，AuditMiddleware 队列化已完成；冷数据数据量未到 1M 行
- **`/health/celery` 真实心跳秒数**：当前 round-trip 近似为 0；分钟级新鲜度待客户提需求
- **OAuth2 / SSO**：等具体客户驱动（企业场景需求触发再做）

### 等独立 epic（体量大、不适合塞进收尾版）
- **非 image-det 工作台**（image-seg / keypoint / video / lidar，C.4 Layer 2 触发）
- **大文件分片上传**（>5GB 视频 / 点云）
- **数据集版本 snapshot + 主动学习闭环**（与训练队列一起做）
- **2FA / TOTP**（super_admin 必选 / 其它角色可选）
- **批次状态机二阶段：admin-locked + bulk-approve / bulk-reject**（ADR-0008 Proposed → 实施前补 scheduler 测试覆盖）

---

## A · 代码观察到的硬占位 / 残留 mock

### 项目模块
- **非 image-det 类型的标注工作台**：image-seg / image-kp / lidar / video-mm / video-track / mm 共 6 类点击「打开」仅显示 toast `类型 X 的标注界面尚未实现`（`DashboardPage.tsx:139`、`ViewerDashboard.tsx:31`）。
- **项目模板**：当前每次新建项目都从 0 配置类别 / AI 模型；无「从已有项目复制」或「保存为模板」入口（v0.7.6 wizard 已扩为 6 步含属性 schema，模板复用更有意义了）。

### 数据 & 存储
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。
- **批次相关延伸**：① 智能切批（按难度/类别/不确定度）；② 批次级 IAA / 共识合并算法；③ 不可变训练快照 + 主动学习闭环。调研报告 [docs/research/12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md)。
- **批次状态机增补 · 二阶段**（v0.7.3 已收 3 条 owner 逆向迁移 + 4 项多选批量；v0.7.6 已收 reset → draft 终极重置；以下为延后项）：
  - `annotating → active` 暂停：项目临时叫停。**难点**：调度器（`scheduler.check_auto_transitions`）一旦看到 `in_progress` task 就会立刻把 batch 推回 `annotating`，需要同时把 in_progress task 复位到 pending（释放标注员锁）+ 引入 batch 级「admin-locked」标志阻断调度器；ADR-0008 已 Proposed 但未实施。
  - 批量状态迁移类（bulk-approve / bulk-reject）：v0.7.3 故意未做。reject 反馈是逐批次语义、approve 跳过逐批次审视有质检失职风险。落地前先讨论 UX。

### AI / 模型
- **模型市场扩展**：v0.9.3 phase 2 已激活 `/model-market`（合并 backends + failed-predictions tab）；二期可加：① 模型版本对比 / AB 路由 UI（依赖 v0.10.x sam3-backend 双模型并存）；② 一键热更新模型权重（`/admin/ml-backends/{id}/reload`）。
- **训练队列**：路由 `/training` 占位。等数据集 snapshot + 主动学习闭环成熟一并做。
- **ML backend storage endpoint 选择机制（生产化）**（**P3**）：dev `ML_BACKEND_STORAGE_HOST` + ADR-0012 框架已收口；生产场景多变, 第一个生产部署遇到再扩策略表（"何时设、设啥值、何时留空"）。
- **真实 SAM mask 50 张 simplify tolerance 验收**（**P3**，v0.9.4 phase 3 归档）：`scripts/eval_simplify.py` 就位但用合成 fixture（IoU≥0.95 缺真实长尾），等 GPU 环境 50 张真实 mask 重跑 `docs/research/13-simplify-tolerance-eval.md`；与 mask→polygon 多连通域 follow-up 同窗口。
- **mask→polygon 多连通域 / 空洞支持**（**P2，长尾 follow-up**）：v0.9.4 phase 3 长尾分析（< 15% 样本 IoU 落 [0.5, 0.95)）暴露 `mask_to_polygon` 两个假设 — 取面积最大连通域 + `RETR_EXTERNAL`. 解法 = `multi_polygon` 输出 + `RETR_CCOMP` 内外环编码 + morphological closing；触发条件 = 客户抱怨形状差异 / 长尾 IoU<0.95 占比 > 20%。当前 85% 样本 IoU≥0.95 不阻塞.

### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**：语言 / 主题 / 时区 / 通知偏好均无（依赖 i18n / 主题基础设施先建立）。

### TopBar / Dashboard 控件
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast；Organization 表已存在但前端无切换 UI。

### 登录 / 注册 / 认证
- **开放注册二阶段剩余**：
  - **邮箱验证**：当前 viewer 零权限可跳过；若未来开放注册默认角色调高，需 `POST /auth/verify-email` + `email_verified_at` 字段 + 验证前 `is_active=false`。
  - **OAuth2 / 社交登录**：Google / GitHub SSO，python-social-auth 或 authlib；`User.oauth_provider` + `oauth_id` 字段；LoginPage / RegisterPage 加「使用 Google 登录」按钮。

### 后续观察项（仍 open）

- **standalone batch_summary stored 列**：v0.7.6 评估后推迟，触发点 8 处维护成本高 + GROUP BY 未到瓶颈。监控触发再做（P3）.
- **getting-started 与 SoT 漂移**：文档站硬编码快捷键如再漂移可考虑给 .md 内联 `` `<键>` `` 建一份从 hotkeys.ts 推导的 ESLint/markdownlint 规则；优先级低，等漂移触发.
- **`/health/celery` 心跳秒数占位**：worker 当前「在线/不在线」二元够用；要真实秒数需 broker 侧报告（kombu / rabbitmq events），分钟级新鲜度待客户提需求（P3）.

---

## B · 架构 & 治理向前演进

### 安全
- **2FA / TOTP**：super_admin 必选、其它角色可选。
- **CSP nonce-based 收紧（剔除 'unsafe-inline'）**：v0.8.8 ADR-0010 落地的是宽松基线（兼容 vite shim + emotion CSS-in-JS）；下一阶段配合 vite plugin 注入 build-time nonce，给 `script-src` / `style-src` 改 `'nonce-XXX'`。预计与 ProjectSettingsPage 重构同窗口做。

### 治理 / 合规
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

### 效率看板 / 人员绩效（v0.8.4 已落 L1+L2+L3，v0.8.5 已落 24-bar 专注时段尾巴）

> 当前阶段已无 open 项；后续如需扩展，参考调研报告 + ADR-0009。

### 可观测性
- **Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest**：v0.6.9 闭环 + 通知已落，剩 LLM SDK + SMTP 链路；`bug_reports` 加 `cluster_id` / `llm_distance`；与通知偏好（按 type 静音）协同。

### 性能 / 扩展
- **Annotation 列表前端切换 keyset 分页**：v0.7.6 已落后端新端点 `GET /tasks/{id}/annotations/page?limit&cursor` + 复合索引；前端 `useAnnotations` 仍用旧数组端点（cap=2000），改 useInfiniteQuery 推迟到 1000+ 框监控触发。
- **Predictions 表分区**：v0.7.6 已落 Stage 1（`ix_predictions_created_at` 索引）+ ADR-0006 设计 Stage 2 完整 RANGE(created_at) 月分区。Stage 2 触发条件：单月 INSERT > 100k 或 总行数 > 1M（FK 复合化代价 + annotations 表迁移成本）。

### 测试 / 开发体验
- **前端单元测试 — 页面级覆盖**：vitest + MSW 基座 v0.7.4；v0.8.5 推到 25.28% / 阈值 25；v0.8.7 因引入 8 个新组件回退到 22.04% / 阈值临时降到 22；**v0.8.8 推回 25.17% / 阈值 25**（5 个新 test 文件 ~35 case：turnstile / useCanvasDraftPersistence / RejectReasonModal / FailedPredictionsPage / useNotificationSocket / AnnotationHistoryTimeline）。下阶段目标 25→30：补 `ProjectSettingsPage`（842 行）/ `AuditPage` / `WorkbenchShell` 关键 hook。
- **size-limit / scripts 脚本测试**：v0.8.8 加的 `apps/web/scripts/check-bundle-size.mjs` 自实现 glob match + 单位解析，目前无单测；如未来加更多 build-time 脚本，建议给该目录建独立 vitest 项目（不算主分母覆盖率）。

### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **无障碍**：ARIA 属性极少；Lighthouse Accessibility 分数应作为 PR gate。

### 文档（v0.7.4 搭骨架；v0.8.0 ADR / 协议契约 / SoT 自动化补齐；v0.8.7 截图自动化骨架；v0.8.8 monitoring.md + ADR 0010/0011；v0.9.5 ADR 0012/0013 + icon-conventions + deploy.md GPU 章节；v0.9.6 sam-tool.md + ai-preannotate.md；v0.9.7 截图实跑 19 张 PNG 回填）

- **首次登录引导（onboarding）**：用户手册有文档但工作台无 UI walkthrough；新用户进 `/projects/:id/annotate` 时左下浮出一条「画框：拖鼠标；提交：E」级别的 3 步 tooltip + 右上 ✕ 关闭一次性写 localStorage `wb:onboarded:v1`。优先级 P3，等首次客户上线反馈触发。
- **`docs-site/dev/architecture/ai-models.md` 部署章节补全**（**P3**，v0.9.x 归档遗留，与 v0.10.x 共用）：v0.9.1 已写缓存策略 + 显存预算 + Prometheus 查询，但部署拓扑（独立 GPU service + docker-compose profile + nvidia 资源预留）章节缺；推迟到 v0.10.x sam3-backend 接入时一并写，复用同样的部署模板。

---

## C · 标注工作台专项优化（性能 / 界面 / 标注体验）

> 现状基线（截至 v0.9.8）：`WorkbenchShell` 三层架构稳定；Konva 4-Layer 画布 / 虚拟化列表 / blurhash / Minimap / 服务端阈值 / 批量编辑 / IoU 项目级阈值 / ETA / 智能切题 / polygon 编辑闭环 / 项目级属性 schema + hotkey 绑定 / 离线队列 + 多 tab 同步 + tmpId / 评论 (@提及 + 附件 + 画布批注 + keyset 分页) / 暗色模式 / Lucide 图标 / Shift 锁纵横比 / 任务跳过 + skip badge / History sessionStorage TTL / SAM 工具 (`S`) + 文本批量预标 (`/ai-pre`) + prediction job 历史 (`/ai-pre/jobs`) 全部落地。
> 横向参考：CVAT（Konva + 关键帧 + 骨架）、Label Studio（interactive ML backend）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量检测）。

### C.1 渲染性能 / 大图大量框
- **OpenSeadragon 瓦片金字塔**：当前直接加载完整图像，> 50MP 会卡。需要后端切瓦片 + 前端 OpenSeadragon viewport，与 Konva overlay 共生。极大图场景才必要。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。`useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。

### C.2 界面优化（信息架构 / 可见性 / 一致性）

> 当前阶段无新 open 项 — 工具栏 P2 (v0.9.5/v0.9.6) + AIPreAnnotatePage 重构 (v0.9.7) + `/ai-pre/jobs` (v0.9.8) 已收尾。后续 UI 信息架构改进按页面单独立项。

### C.3 标注体验（核心生产力杠杆）
- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90%；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式）。
- **关键帧插值（视频/序列）**：CVAT 同款；标注员只标 1 / 30 / 60 帧，中间线性插值。需配合 `Task.dimension` 字段。
- **类别确认 hint**：刚画完一个框时，AI 后台跑一次单框分类，右上角弹「建议：标识牌（92%）」+ 一键采纳。
- **Magic Box / Snap**：粗略画一个大框 → AI 收紧到对象边缘（SAM 推 mask → 取 mask bbox）；同时支持「贴边吸附」。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **`U` 键准确度升级**：v0.5.2 用启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）。

### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> 决策：**单工作台外壳 + 按维度切分的画布渲染器 + 工具可插拔**（v0.4.9 Step 1 完成）。当前只支持矩形框 + polygon，数据模型 `annotation_type: String(30)` + `geometry: JSONB` discriminated union 已为多类型留好口子。

- **Layer 1 · 工作台外壳（`<WorkbenchShell>`）**：路由 `/projects/:id/annotate`、左侧任务队列、Topbar、AI 助手、状态栏、各 hooks。跨所有类型共用 ~80%。
- **Layer 2 · 画布渲染器（按维度切，3 个）**：
  - `<ImageStage>`：image-det / image-seg / image-kp / mm（图像类）共用 ✅
  - `<VideoStage>`：video-mm / video-track，多了**时间轴 + 关键帧插值**控件
  - `<LidarStage>`：lidar 单独，Three.js / WebGL viewport
- **Layer 3 · 工具（画布内插件）**：每个工具实现统一接口 `{ id, hotkey, icon, onPointerDown, ... }`。当前 `<ImageStage>` 注册 BboxTool / HandTool / PolygonTool。
- **Step 2 触发条件**：业务需要 keypoint / video / lidar 时才动；当前 image-det + polygon 双类型不必预先抽象。

---

## 优先级建议（参考）

> 已完成的项不再列出，参考 [docs/changelogs/](docs/changelogs/)。下面只是当前 open 的优先级。

| 优先级 | 候选项 | 触发 / 理由 | Related ADR |
|---|---|---|---|
| **P1** | v0.9.9 候选: 后端 `PredictionShape` Pydantic 模型 + 前端 codegen 完整迁移 / `prediction_jobs.total_cost` 聚合接通 / 真实 SAM mask 50 张 simplify tolerance 验收 | v0.9.8 落地后剩余 schema/coverage gap; 体量 ~2-3 工作日 | — |
| **P2** | mask→polygon 多连通域 / 空洞支持 | v0.9.4 phase 3 长尾分析暴露：< 15% 样本 IoU 落 [0.5, 0.95)，根因 `RETR_EXTERNAL + max area` 假设。修复方向：multi_polygon 输出 + `RETR_CCOMP` 内外环编码 + morphological closing；触发：长尾 IoU<0.95 占比 > 20%、或客户抱怨 polygon 与 mask 形状差异 | [0013](docs/adr/0013-mask-to-polygon-server-side.md) |
| **P2** | 邮箱验证（开放注册角色提升前置） | 当前 viewer 零权限可跳过；角色调高时必备 | — |
| **P2** | OAuth2 / 社交登录（Google / GitHub SSO） | 降低注册门槛，企业场景 SSO；客户驱动 | — |
| **P2** | 系统设置 admin UI 可编辑（含开放注册 toggle） | 当前所有系统设置仅 env 控制，运维成本高 | — |
| **P2** | Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest | v0.7.0 通知偏好基础静音已落，邮件 channel 字段就位但 UI 未启 | — |
| **P2** | 非 image-det 工作台（image-seg → keypoint → video → lidar） | 体量大，按业务优先级排队 | — |
| **P2** | C.3 marquee / 关键帧 / 会话级标注辅助 | 业务复杂度起来后必需 | — |
| **P2** | C.1 OpenSeadragon 瓦片金字塔 | 极大图 > 50MP 才必要；纯前端 IoU rbush 已 v0.9.3 落地 | [0004](docs/adr/0004-canvas-stack-konva.md) |
| **P2** | 批次状态机二阶段：`annotating → active` 暂停（实施 ADR-0008） + bulk-approve / bulk-reject | ADR-0008 已 Proposed；实施前补 scheduler 测试覆盖；bulk approve/reject UX 待定 | [0008](docs/adr/0008-batch-admin-locked-status.md) |
| **P2** | CSP nonce-based 收紧（剔除 'unsafe-inline'） | v0.8.8 ADR-0010 是宽松基线；nonce-based 留作 v0.10.x 与 ProjectSettingsPage 重构同窗口做 | [0010](docs/adr/0010-security-headers-middleware.md) |
| **P3** | 截图 fixture 数据补齐 + 重跑（v0.9.7 19 张已 commit, 4 张空白态需补 seed） | seed.py 加 prepare 钩子: 5+ pre_annotated 批次 / 类别无 alias 项目 / 同 task 双 prediction (IoU) / 30+ tasks (bulk-edit) | — |
| **P3** | predictions 月分区 Stage 2 完整迁移 | ADR-0006；触发条件单月 INSERT > 100k 或 总行数 > 1M | [0006](docs/adr/0006-predictions-partition-by-month.md) |
| **P3** | projects.batch_summary stored 列 | v0.7.6 评估后推迟；触发点 8 处维护成本高，当前 GROUP BY 性能未到瓶颈 | — |
| **P3** | 前端单测从 25% 推到 30% | v0.8.8 已推回 25.17%；下阶段补 ProjectSettingsPage / AuditPage / WorkbenchShell 关键 hook 单测 | — |
| **P3** | 首次登录 UI walkthrough（onboarding tooltip） | 新客户上线前低优；客户反馈触发再做 | — |
| **P3** | i18n、2FA | 客户具体需求驱动（SSO 已单独提升到 P2） | — |
| **P3** | C.3 SAM 后续延伸：Magic Box、类别确认 hint | 依赖 SAM 基座 | — |
| **P3** | ML backend storage endpoint 选择机制（生产化） | v0.9.4 phase 1 用 `ML_BACKEND_STORAGE_HOST` 简单覆盖适合 dev + ADR-0012 已写决策框架；生产场景多变，第一个生产部署遇到再扩 ADR 策略表 | [0012](docs/adr/0012-sam-backend-as-independent-gpu-service.md) |
| **P3** | 审计日志冷数据物化触发 | v0.8.1 partition + Celery beat archive 已就位；当前数据量未到 1M 行 | [0007](docs/adr/0007-audit-log-partitioning.md) |

---

## 优化建议 / 文档维护备忘

> 这一节记录"对 ROADMAP 自身格式"的维护方向，避免文件无限膨胀。每个 epic 收尾时应配套精简（最近一次：v0.9.8 把已收尾版本块从多段压缩到单行 + plan 链接，§A/§C 删空段、补「落地后新发现」）。

1. **「后续观察项」滚动归档**：§A 末尾当前 3/5 条；超过 5 条时拆出 `ROADMAP/observations.md`。
2. **触发条件量化**：「监控触发」类条目（predictions Stage 2 / batch_summary stored 列）目前文字描述；条件成熟后可在 Grafana dashboard 加阈值 panel + 告警，跨过即生 issue。仍未执行（依赖 Grafana 优先级）。
3. **epic 收尾同步精简 §A/§C**：每次版本收尾配套删 §A / §C 已落项 + 在该 epic 后写 1 段「落地后新发现」补到优先级表，避免 ROADMAP 与 CHANGELOG 双源真相漂移。已成为约定.
4. **ADR 引用列回填**：每次新增 ADR 时 grep 优先级表对应行加链接。
