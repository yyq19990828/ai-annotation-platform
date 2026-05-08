# 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本一律见 [CHANGELOG.md](./CHANGELOG.md) 与 [docs/changelogs/](docs/changelogs/)；**最近一版 v0.9.7 (Virtual Lynx) — AIPreAnnotatePage 信息架构重构（拆 6 子组件 + 顶部 stepper）+ 视觉精修 + 交互打磨（Ctrl+Enter / 草稿 / 历史表搜索分页 / 空 alias 引导）+ alias 频率排序后端 + Wizard step 4 backend 复用 dropdown + schema adapter / config.py 守卫 / 截图 19 张实跑回填** 详情见 [CHANGELOG.md](./CHANGELOG.md)。0.9.x 段暂存 root CHANGELOG，开 v0.10 时再迁回 `docs/changelogs/0.9.x.md`。

---

## 即将到来（按版本切片的详细计划）

> 大颗粒 epic 拆到独立文档；下面 §A/§B/§C 仍维护单条颗粒度的待办。

- ~~**v0.9.x — Grounded-SAM-2 接入（首版 AI 基座）**~~ ✅ 已收尾（M0+M1+M2+M3+M4+M5 + chip 包，`/ai-pre` 文本批量预标 + 工作台 `S` 工具 + 类别英文 alias + Batch `pre_annotated` 状态机 + ADR-0012/0013 全落地）。详细切片归档于 `ROADMAP/0.9.x.md`（已归档），剩余文档同步 / 真实 SAM mask 验收已迁移到下方 §A/§B。
- ~~**v0.9.7 — Virtual Lynx**~~ ✅ 已收尾（AIPreAnnotatePage 478 行单文件拆 6 子组件 (PreannotateStepper / ProjectBatchPicker / PromptComposer / OutputModeSelector / RunPanel / HistoryTable) + 顶部 4 步水平 stepper 引导 + 视觉精修 (cardHeader borderBottom 分隔 / chip hover/active/×N 频率角标 / 进度卡大号百分数) + 交互打磨 (Ctrl+Enter / usePreannotateDraft localStorage 草稿 / 切项目 toast / 空 alias 引导卡 / 历史表搜索/列排序/客户端分页/空状态); alias chips 频率排序后端 `GET /admin/projects/:id/alias-frequency` (PG `jsonb_array_elements` GROUP BY count desc + 7 单测) + 前端按 count desc 排; Wizard step 4 backend 复用 dropdown — `GET /admin/ml-integrations/all` 全局去重列表 + `ProjectCreate.ml_backend_source_id` + 项目创建时复制 backend row (state 重置, health_meta 清空) + 4 单测; scenes.ts 加 4 个 v0.9.7 截图场景 (实跑 PNG 留 maintainer); 用户手册 ai-preannotate.md v0.9.7 段同步）。详细切片：[`docs/plans/2026-05-08-v0.9.7-virtual-lynx.md`](docs/plans/2026-05-08-v0.9.7-virtual-lynx.md)。剩余 `截图 22 张 PNG 实跑` / `完整 prediction job 历史 (prediction_jobs 表)` 已迁到下方观察项与 v0.10.x 触发条件。
- ~~**v0.9.6 — Agile Kernighan**~~ ✅ 已收尾（工具栏 P2-b Tooltip + hotkey 角标 + 激活态强化 + 分组分隔 + SAM 抽屉 + spinner overlay + Alt+1/2/3/4 备用切工具；alias schema 自动规范化 + 前端 onBlur + 双 toast；Wizard step 4 暴露 text_output_default + 共享组件；BatchStatusBadge 新建 + Kanban pre_annotated 列 + Topbar 紫徽章；AIPreAnnotate chips 滚动 + 搜索筛选；ML backend probe 端点 + URL 默认值预填 + 测试连接按钮；ml_backends.health_meta 列 + 行内深度指标；/admin/preannotate-queue 端点 + 跑完 CTA + 历史表 + 重试链接；用户手册 sam-tool / ai-preannotate）。详细切片：[`docs/plans/2026-05-08-v0.9.6-agile-kernighan.md`](docs/plans/2026-05-08-v0.9.6-agile-kernighan.md)。**v0.9.7 已清掉 4 项遗留**: alias 频率排序 ✅ / Wizard backend 绑定 dropdown ✅ / 用户手册 ✅ / 截图 scenes 配置 ✅ (PNG 实跑留 maintainer)。
- **v0.9.8 — Prediction Job 历史 + v0.9.7 端到端跑通暴露的隐性 bug 收口**（**主线**，提前自 v0.10.x；2026-05-08 用户首次真实跑预标后规划）：
  - **新建 `prediction_jobs` 表 + worker 写入**：schema `{id, project_id, batch_id, ml_backend_id, prompt, output_mode, status, total_tasks, success_count, failed_count, started_at, completed_at, duration_ms, total_cost, error_message}`。`_run_batch` 开头创建 row，跑完 update final stats；failure 走 `_BatchPredictTask.on_failure` 时写 `status=error`。
  - **后端 `GET /admin/preannotate-jobs`**（新，与现有 `/admin/preannotate-queue` 区分）：列**所有**历史 job 含已结束/重置批次，不限于 `pre_annotated` 状态；支持 `?project_id=&status=&from=&to=&search=` 过滤 + cursor 分页。
  - **前端 `/ai-pre/jobs` 子页面或 tab**：与现有「AI 预标已就绪批次」（只列 `pre_annotated`）拆开；完整 job timeline（项目 / 批次 / prompt / outputMode / 跑时长 / 成本 / 状态 / 失败计数 / 操作—重跑 / 看明细）。复用 v0.9.7 `HistoryTable.tsx` 样式 + 搜索/排序/分页能力。
  - **schema adapter 端到端**：v0.9.7 fix 已加 `to_internal_shape` 在 read path（LabelStudio 标准 → 内部 schema）；v0.9.8 加 codegen `predict.result` 类型同步 + 前端 transforms.ts 单测 + 用户手册说明 DB schema vs 前端 schema 边界，防止下次 ML backend 改输出格式时再撞。
  - **ml_backends URL 容器/宿主机视角守卫**：`MLBackendCreate` schema validator 拒绝 host == `localhost`/`127.0.0.1`，提示用 docker bridge IP / service DNS，与 v0.9.6 placeholder 配套。
  - **WS 进度多项目订阅可见性**：当前 `usePreannotationProgress(projectId)` 仅订阅当前选中项目；跑完后切项目就丢 progress 状态。候选方案：① AdminDashboard / Topbar 加全局「进行中预标 job」badge 链回原项目；② 用户切项目时 toast 提示「项目 X 仍在跑预标 (i/N)」+ 一键回跳。与 prediction_jobs 表合并实现（job 在跑时全局可见）。
  - 估时 ~5 工作日（含数据迁移 + 测试 + 文档）。详细 plan 待写：`docs/plans/2026-05-??-v0.9.8-...md`。

- **[v0.10.x — SAM 3 接入（与 Grounded-SAM-2 并存）](./ROADMAP/0.10.x.md)**：新增 sam3-backend 作为高精度选项，**不替换** v0.9.x grounded-sam2-backend；增加 exemplar prompt + 路由策略 UI + AB 对比工具。共享 `apps/_shared/mask_utils/`。预计 ~3.5 周。

---

## 当前焦点（按"何时触发"分组）

> 优先级表（§ 末尾）按价值/成本排序；本节按**触发条件**重组，一眼看清"现在能做什么 / 等什么再做"。

### 现在可做（无前置依赖、有清晰交付物）

> 下列条目作为 `chip:maintenance` 穿插推进，不抢 v0.9.8 / v0.10.x 主线优先级。

- **CSP nonce-based 收紧**（P2，与 vite plugin 同窗口做，`chip:maintenance`）
- **OpenSeadragon 瓦片金字塔**（P2，§C.1，极大图 > 50MP 才必要，`chip:maintenance`）
- **i18n 框架接入**（P3，与 ProjectSettingsPage 重构合并节省破窗成本，`chip:maintenance`）
- **截图自动化 fixture 数据补齐重跑**（P3，v0.9.7 实跑后发现）：`adccb60` 已 commit 19 张 PNG，但 4 张因 fixture 数据空白渲染相同空状态（`ai-pre-history-search` / `ai-pre-empty-alias` / `bbox-iou` / `bbox-bulk-edit`）。需在 `apps/api/scripts/seed.py` 或 scene `prepare()` 钩子里造数据后重跑同一命令覆盖。

### v0.9.x 收尾遗留（→ v0.10.x 与 sam3-backend 一并做）

> v0.9.5 (Async Oasis) 主线已收尾。以下因体量 / 风险考量推迟：

- **mask→polygon 多连通域 / 空洞支持**（**P2，长尾 follow-up**）：v0.9.4 phase 3 真实 SAM mask 评测的长尾分析（< 15% 样本 IoU 落 [0.5, 0.95)）暴露 `apps/_shared/mask_utils.mask_to_polygon` 的两个隐藏假设 —— ① 取面积最大连通域 → 多片段 mask 小碎块被丢弃；② `RETR_EXTERNAL` 丢内部空洞。修复方向：① `multi_polygon` 输出支持（返回 `list[list[list[float]]]` 而非单 polygon）；② `RETR_CCOMP` 切换 + 内外环编码（外环 + holes 数组，与 LabelMe / COCO 协议对齐）；③ polygon 化前先 morphological closing 抹平像素级噪声。**协议影响**：`AnnotationResult.value` schema 需支持 polygon-with-holes 或 multi-polygon，前端 `<ImageStage>` 候选叠加层渲染逻辑同步改。**触发条件**：客户首次抱怨 polygon 与 mask 形状差异、或长尾 IoU<0.95 占比 > 20% 时；当前大头（85%）IoU 已 ≥ 0.95，不阻塞工作台正常使用。

### v0.9.5 / v0.9.6 / v0.9.7 落地后剩余真实问题

> 三连击已把 `/ai-pre` UX 闭环 / 一致性 / 视觉成熟度收齐, 剩余条目均已并入 v0.9.8 主线（见上方版本切片）或 v0.10.x 触发条件。仅留这一条 dev/生产部署相关:

- **生产部署 ML backend storage endpoint 选择机制**（**P3**）：dev `ML_BACKEND_STORAGE_HOST` 简单覆盖够用 + ADR-0012 已写决策框架，生产场景多变可能需 ADR 扩充策略表；首次生产部署遇到再扩.

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
- **ML backend storage endpoint 选择机制（生产化）**（**P3**）：v0.9.4 phase 1 用的 `ML_BACKEND_STORAGE_HOST` 简单 host 重写适合 dev；ADR-0012 已写决策框架但仅 dev 场景。**触发条件**：第一个生产部署遇到这条时按需扩 ADR-0012 策略表（"何时设、设啥值、何时留空"）；当前 dev 单机已收口。
- **真实 SAM mask 50 张 simplify tolerance 验收**（**P3**，v0.9.4 phase 3 归档遗留）：`scripts/eval_simplify.py` 已就位，v0.9.4 phase 3 用 6 张合成 fixture 替代真实 SAM mask 出报告（100% IoU≥0.95 但缺真实长尾分布）；待 maintainer 在 GPU 环境采集 50 张真实 SAM mask 后重跑 `docs/research/13-simplify-tolerance-eval.md`，确认 `DEFAULT_SIMPLIFY_TOLERANCE = 1.0` 默认值在真实分布下仍最优；与 §C.3 mask→polygon 多连通域 follow-up 同窗口处理。

### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**：语言 / 主题 / 时区 / 通知偏好均无（依赖 i18n / 主题基础设施先建立）。

### TopBar / Dashboard 控件
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast；Organization 表已存在但前端无切换 UI。

### 登录 / 注册 / 认证
- **开放注册二阶段剩余**：
  - **邮箱验证**：当前 viewer 零权限可跳过；若未来开放注册默认角色调高，需 `POST /auth/verify-email` + `email_verified_at` 字段 + 验证前 `is_active=false`。
  - **OAuth2 / 社交登录**：Google / GitHub SSO，python-social-auth 或 authlib；`User.oauth_provider` + `oauth_id` 字段；LoginPage / RegisterPage 加「使用 Google 登录」按钮。

### 后续观察项

> 历史背景：v0.7.0 集中收口批次状态机 epic + v0.6.x 写时观察 18 项；v0.7.6 一次清 4 项；v0.7.7 落开放注册基座；v0.8.0 一次性把开发文档分组与 ADR 0002-0005 补齐；v0.8.2 把文档体系四处机制缝隙以自动化方式收齐；**v0.8.8 把 P3 杂项 + 几条 P2 一次性清空**（HSTS/CSP / OpenAPI hook / WS reauth / dismiss / .env SoT / Polygon hit-test / CommentsPanel keyset / bundle budget / Grafana dashboard / Sentry WARN / `_task_with_url` model_validate / skip badge）。下面是仍 open 的：

- **standalone batch_summary stored 列**：v0.7.0 项目卡批次概览用 GROUP BY 单查询返回 `{total, assigned, in_review}`，每次 list_projects 都触发；如需更冷优化，可加 stored 列由 batch 状态机变迁维护。**v0.7.6 评估后推迟**：触发点 8 处维护成本高，当前 GROUP BY 性能未到瓶颈。优先级 P3，监控触发再做。
- **getting-started 与 SoT 漂移**：v0.8.0 已修过一次（W/R/Ctrl+Enter → B/V/E）。文档站文字硬编码的快捷键提示如再次漂移仍需手改，长期可考虑给所有 .md 中的 `` `<键>` `` 内联引用建一份从 hotkeys.ts 推导的 ESLint/markdownlint 规则；优先级低，等漂移再触发。
- **`/health/celery` workers `last_heartbeat_seconds_ago` 仍是 0 占位**：v0.8.7 F2 接通了 queues 维度，但心跳 timestamp 用 round-trip 时刻近似为 0；要真实心跳秒数需 broker 侧报告（kombu / rabbitmq events）。当前 worker 「在线 / 不在线」二元已能满足告警，分钟级新鲜度待客户提需求再做。优先级 P3。

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

> 现状基线（截至 v0.8.8）：`WorkbenchShell` 三层架构（shell + stage + state）已稳定；Konva 画布 / 4 Layer / 虚拟化任务标注列表 / blurhash / Minimap / 阈值服务端化 / 批量编辑 / IoU 项目级阈值 / ETA / 智能切题 / polygon 编辑闭环（v0.8.8 hit-test 改进）/ 项目级属性 schema + hotkey 绑定 / 离线队列 + 多 tab 同步 + tmpId 端到端 + 抽屉 UI / 评论 polish（@ 提及 + 附件 + 画布批注 + v0.8.8 keyset 分页）/ 暗色模式 / Lucide 图标体系 / Shift 锁纵横比 + Alt 中心 resize / 任务跳过 + skip badge / History sessionStorage TTL 等已落地。
> 横向参考：CVAT（Konva 画布 + 关键帧插值 + 骨架）、Label Studio（interactive ML backend，SAM 触点）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量类别检测）。

### C.1 渲染性能 / 大图大量框
- **OpenSeadragon 瓦片金字塔**：当前直接加载完整图像，> 50MP 会卡。需要后端切瓦片 + 前端 OpenSeadragon viewport，与 Konva overlay 共生。极大图场景才必要。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。`useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。

### C.2 界面优化（信息架构 / 可见性 / 一致性）

> ✅ 工具栏 P2-a (v0.9.5 phase 4) + P2-b (v0.9.6 Agile Kernighan) 已收尾, AIPreAnnotatePage 重构 + stepper (v0.9.7 Virtual Lynx) 已收尾。当前阶段无新 open 项, 后续 UI 信息架构改进按页面单独立项。

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
| **P1** | v0.9.8 主线: prediction_jobs + /ai-pre/jobs + URL validator + WS 多项目可见性 + schema codegen | 用户首次端到端跑预标后明确需求; 已写入版本切片, 估时 ~5 工作日 | — |
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

> v0.8.8 重写后这一节用于记录"对 ROADMAP 自身格式"的下次维护方向，避免文件无限膨胀。v0.9.5 / v0.9.7 各已按此节工序做了一次精简（v0.9.7: 删 9 条 ✅ + 整合 §C.2/§C.3 已落地的工具栏 / SAM 子工具栏 / text 模式 历史块 + v0.9.8 主线规划提前）。

1. **「后续观察项」清单滚动归档**：当前 §A 末尾保留 3 条 v0.7.x ~ v0.8.8 残留观察（3/5）；超过 5 条时拆出 `ROADMAP/observations.md`。
2. **触发条件量化**：「监控触发」类条目（如 predictions Stage 2、batch_summary stored 列）目前是文字描述；条件成熟后可在 Grafana dashboard 加阈值 panel + 告警，跨过即生 ROADMAP 通知 issue。**仍未执行**（依赖 Grafana 工程化优先级）。
3. **版本切片 epic 完成时同步精简 §A/§C**：v0.9.5 实证：每个 epic 收尾时应配套删 §A / §C 已落项 + 在该 epic 后写 1 段「落地后新发现」补到优先级表，避免 ROADMAP 与 CHANGELOG 双源真相漂移。**已成为约定**。
4. **ADR 引用列回填**：v0.9.5 加了 ADR-0012/0013，回填到优先级表 Related ADR 列；下次每次新增 ADR 时记得 grep 优先级表对应行加链接。
