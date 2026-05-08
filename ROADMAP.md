# 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本一律见 [CHANGELOG.md](./CHANGELOG.md) 与 [docs/changelogs/](docs/changelogs/)；**最近一版 v0.9.5 (Async Oasis) — `/ai-pre` 文本批量 UI + 类别英文 alias + Batch pre_annotated + chip 包** 详情见 [`0.9.x.md`](docs/changelogs/0.9.x.md)。

---

## 即将到来（按版本切片的详细计划）

> 大颗粒 epic 拆到独立文档；下面 §A/§B/§C 仍维护单条颗粒度的待办。

- ~~**[v0.9.x — Grounded-SAM-2 接入（首版 AI 基座）](./ROADMAP/0.9.x.md)**~~ ✅ 已收尾（M0+M1+M2+M3+M4+M5 + chip 包，`/ai-pre` 文本批量预标 + 工作台 `S` 工具 + 类别英文 alias + Batch `pre_annotated` 状态机 + ADR-0012/0013 全落地）。
- **[v0.10.x — SAM 3 接入（与 Grounded-SAM-2 并存）](./ROADMAP/0.10.x.md)**：新增 sam3-backend 作为高精度选项，**不替换** v0.9.x grounded-sam2-backend；增加 exemplar prompt + 路由策略 UI + AB 对比工具。共享 `apps/_shared/mask_utils/`。预计 ~3.5 周。
- **v0.9.6 — 工作台工具栏 UX 完成 + 截图回填**（独立小版本）：v0.9.5 留下的 §C.2 P2-b 工具栏 UX（Tooltip 组件 + hotkey 角标 + 激活态强化 + 分组分隔 + 数字键 1-4 直跳工具 + SAM 子工具栏改右展开抽屉）+ 截图自动化 14 张实跑回填。预计 ~3 工作日；与 v0.10.x 同期或先于 v0.10.x 都可。

---

## 当前焦点（按"何时触发"分组）

> 优先级表（§ 末尾）按价值/成本排序；本节按**触发条件**重组，一眼看清"现在能做什么 / 等什么再做"。

### 现在可做（无前置依赖、有清晰交付物）

> v0.9.x 已收尾（M0+M1+M2+M3+M4+M5 + chip 包全落地）。下列条目作为 `chip:maintenance` 穿插推进，不抢 v0.10.x 主线优先级。

- **CSP nonce-based 收紧**（P2，与 vite plugin 同窗口做，`chip:maintenance`）
- **OpenSeadragon 瓦片金字塔**（P2，§C.1，极大图 > 50MP 才必要，`chip:maintenance`）
- **i18n 框架接入**（P3，与 ProjectSettingsPage 重构合并节省破窗成本，`chip:maintenance`）
- **工作台工具栏 P2-b**（**P2**，§C.2，v0.9.6 主体）：Tooltip 组件 + hotkey 角标 + 激活态强化 + 分组分隔 + 数字键 1-4 直跳工具 + SAM 子工具栏改右展开抽屉。v0.9.5 phase 4 已落 P2-a（9 处 sparkles 重整 + `docs-site/dev/icon-conventions.md`），P2-b 独立避免与 v0.9.5 主线同窗口导致截图双拍。
- **截图自动化 14 张实跑回填**（**P3**，与 v0.9.6 工具栏 P2-b 同窗口做避免双拍）：v0.8.7 落地脚本框架（`apps/web/e2e/screenshots/scenes.ts:1-227`），需 maintainer 在完整启动栈下 `pnpm --filter web screenshots` 实跑一次产出 PNG。部分场景（iou 双框 / bulk-edit 多选 / progress 50%）需先在 `apps/api/scripts/seed.py` prepare 钩子里造数据。

### v0.9.x 收尾遗留（→ v0.10.x 与 sam3-backend 一并做）

> v0.9.5 (Async Oasis) 主线已收尾。以下因体量 / 风险考量推迟：

- **mask→polygon 多连通域 / 空洞支持**（**P2，长尾 follow-up**）：v0.9.4 phase 3 真实 SAM mask 评测的长尾分析（< 15% 样本 IoU 落 [0.5, 0.95)）暴露 `apps/_shared/mask_utils.mask_to_polygon` 的两个隐藏假设 —— ① 取面积最大连通域 → 多片段 mask 小碎块被丢弃；② `RETR_EXTERNAL` 丢内部空洞。修复方向：① `multi_polygon` 输出支持（返回 `list[list[list[float]]]` 而非单 polygon）；② `RETR_CCOMP` 切换 + 内外环编码（外环 + holes 数组，与 LabelMe / COCO 协议对齐）；③ polygon 化前先 morphological closing 抹平像素级噪声。**协议影响**：`AnnotationResult.value` schema 需支持 polygon-with-holes 或 multi-polygon，前端 `<ImageStage>` 候选叠加层渲染逻辑同步改。**触发条件**：客户首次抱怨 polygon 与 mask 形状差异、或长尾 IoU<0.95 占比 > 20% 时；当前大头（85%）IoU 已 ≥ 0.95，不阻塞工作台正常使用。

### v0.9.5 落地后新发现的可优化项（v0.9.6 / 后续 chip）

> v0.9.5 (Async Oasis) 真用起来 `/ai-pre` 后暴露的 UX 闭环 / 一致性 / 验证缺口：

- **AIPreAnnotatePage 二阶段功能**（**P3**，新发现）：v0.9.5 落基础流程（项目→batch→prompt→进度），但缺三块 UX 闭环：① 历史 job 列表（哪些 batch 跑过预标、当时 prompt / cost / 耗时 / 完成率）；② 失败重试入口（直接跳 `/model-market?tab=failed&batch_id=X`）；③ 跑完后批次接管 CTA（「打开标注工作台 →」一键跳转 `/projects/:id/annotate?batch_id=X`，让 admin 跑完即接管 review）。后端只需扩 `/admin/preannotate-queue` 端点（按 batch + 时间倒序聚合 + 关联 prediction count / failed count），前端 ~0.5 天。
- **类别 alias 大小写与符号规范化**（**P3**，新发现）：v0.9.5 引入 `ClassConfigEntry.alias`，但用户输入 `"Person"` vs `"person"` 在 DINO 推理中召回不同（DINO 对 case-insensitive 但实际分布有偏差），且尾随空格 / 多重逗号未做归一化。建议保存时统一小写 + 折叠空格 + dedupe 多 `,`，**或**显式提示用户「DINO 推荐全小写英文」。`schemas/_jsonb_types.py:104` `ClassConfigEntry.alias` 加 `field_validator(alias, mode="before")` 做规范化；同步前端 `ClassEditor.tsx` 输入时 onBlur 自动 `.toLowerCase().trim()` + toast 提示。预计 ~0.3 天。
- **CreateProjectWizard 第 4 步暴露 `text_output_default`**（**P3**，新发现，一致性 chip）：v0.9.5 GeneralSection 已加下拉，但 wizard 第 4 步「AI 接入」没暴露同字段；新建项目时只能进入设置页再调，反复来回。建议 wizard 启用 AI 后增加 inline 字段「文本预标注默认输出」（同 GeneralSection 4 项下拉），与 `box_threshold` / `text_threshold` 同节奏一并暴露。预计 ~0.3 天。
- **batch.pre_annotated → AnnotateLayout 视觉提示**（**P3**，新发现）：v0.9.5 加了 `pre_annotated` 状态但工作台 / 任务列表暂未对其做特殊视觉处理（仍按 active 显示）。建议 `BatchStatusBadge` + 工作台 Topbar 「批次进度」行加紫色「AI 预标已就绪」徽章，让标注员一眼知道「这一批不是从 0 开始，先看 AI 候选」。预计 ~0.2 天。
- **AIPreAnnotatePage 类别 alias chips 滚动**（**P3**，新发现）：项目 30+ 类别且全配 alias 时，chips 会大量铺开挤满整行；建议 chips 区限高 + 横向滚动 + 搜索框；或者按使用频率排序（需 `predictions` GROUP BY alias 聚合）。预计 ~0.2 天。

### v0.9.x SAM 接入暴露的真实问题剩余（已落主链后才发现，分散在 §A AI/模型）

> v0.9.5 已收尾 GeneralSection AI 绑定 UX 解耦 + SAM `/setup` `supported_prompts` 协议消费 + backend `/health` GPU 显存。剩余 4 条仍 open：
>
> - MlBackendFormModal 缺「测试连接」+ URL 默认值预填（每次手敲 `http://172.17.0.1:8001` 麻烦）
> - CreateProjectWizard 启用 AI 时不强制绑定 backend（新建项目仍是「AI 启用 + 未绑定」状态）
> - RegisteredBackendsTab 行内深度健康指标（GPU 显存 / cache hit rate / 模型版本 — backend `/health` v0.9.5 已就位，仅前端聚合展示未做）
> - 生产部署的 ML backend storage endpoint 选择机制（dev `ML_BACKEND_STORAGE_HOST` 简单覆盖够用 + ADR-0012 已写决策框架，生产场景多变可能需 ADR 扩充策略表）

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
- **MlBackendFormModal「测试连接」+ URL 默认值预填**（**P3**）：当前要先创建保存 → 列表行点 health 才能验通，注册前先验失败的成本高（DB 留无效行需手删）。**切片**：① Form 表单内右下加「测试连接」按钮，调一个**无 DB 副作用的** `POST /ml-backends/probe?url=&auth=` 端点（仅 httpx GET `/health`），把状态 inline 显示；② Settings 暴露 `default_ml_backend_url_hint`（dev 可由 `ML_BACKEND_DEFAULT_URL` env 设 `http://172.17.0.1:8001`），URL 输入框 placeholder 直接显示而非空白；③ 注册成功后若 health 仍 `disconnected`，提示用户检查网络，而不是默默存。
- **CreateProjectWizard 启用 AI 时强制 backend 绑定校验**（**P3**）：v0.7.6 wizard step 4 启用 AI 但不要求绑定 backend，新建项目即「AI 启用 + 未绑定」（v0.9.5 GeneralSection 落地了「绑定到本项目」按钮但 wizard 仍未同步）。最小切片：启用 AI 后增加 sub-section 列出本项目作用域已注册的 backend（首次 0 项 → CTA「先到项目设置注册」并允许跳过 + 标黄；勾 backend 后 step 5 总览展示「将绑定到 X」）；同步把 `text_output_default` 字段也暴露在 wizard 里（与 GeneralSection 一致）。
- **RegisteredBackendsTab 行内深度健康指标**（**P3**）：当前每行只 state / last_checked_at；v0.9.5 backend `/health` 已扩 `gpu_info` + `cache` 子对象，仅前端聚合展示未做。可加聚合 helper `GET /admin/ml-integrations/overview` 拉每个 backend 的最新 health 摘要（gpu memory_used_mb / cache hit_rate / model_version），让运维一眼看清「刚才那次卡几秒是首次冷推还是 cache miss」。预计 0.5 天。
- **ML backend storage endpoint 选择机制（生产化）**（**P3**）：v0.9.4 phase 1 用的 `ML_BACKEND_STORAGE_HOST` 简单 host 重写适合 dev；ADR-0012 已写决策框架但仅 dev 场景。生产 K8s 同 namespace 时 SAM 直接走 service DNS 即可（留空），跨 namespace / 跨集群需要 internal vs external 双 endpoint 配置。**触发条件**：第一个生产部署遇到这条时按需扩 ADR-0012 策略表（"何时设、设啥值、何时留空"）；当前 dev 单机已收口。
- **类别 alias 规范化 + DINO 召回友好提示**（**P3**，v0.9.5 落地后新发现）：`ClassConfigEntry.alias` 字段就位但未做大小写 / 符号规范化；用户输入 `"Person"` vs `"person"` 召回有偏差。`schemas/_jsonb_types.py:104` 加 `field_validator(alias, mode="before")` 自动 `.lower().strip()` + 折叠多重逗号 / 空格；前端 `ClassEditor.tsx` onBlur 也做一次。预计 ~0.3 天。

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

### 文档（v0.7.4 搭骨架；v0.8.0 ADR / 协议契约 / SoT 自动化补齐；v0.8.7 截图自动化骨架；v0.8.8 monitoring.md + ADR 0010/0011；v0.9.5 ADR 0012/0013 + icon-conventions + deploy.md GPU 章节）

- **截图自动化执行 + 14 张回填**：v0.8.7 落了 `apps/web/e2e/screenshots/` 脚本框架，但 PNG 文件需 maintainer 在完整启动栈下 `pnpm --filter web screenshots` 实际跑一遍并把结果 commit。部分场景（iou 双框 / bulk-edit 多选 / progress 50%）需先在 fixture 里造数据再 prepare 钩子触发。**推迟到 v0.9.6 与工具栏 P2-b 同窗口做**避免双拍（v0.9.5 已落 sparkles 重整 + AIPreAnnotatePage 等新场景，scenes.ts 配置已就位但 PNG 仍 0 张）。
- **首次登录引导（onboarding）**：用户手册有文档但工作台无 UI walkthrough；新用户进 `/projects/:id/annotate` 时左下浮出一条「画框：拖鼠标；提交：E」级别的 3 步 tooltip + 右上 ✕ 关闭一次性写 localStorage `wb:onboarded:v1`。优先级 P3，等首次客户上线反馈触发。
- **scenes.ts 加 v0.9.5 新场景**：v0.9.5 引入 `/ai-pre` 页面 + AIInspectorPanel 「本题花费」+ 类别 alias chips + AdminDashboard pre_annotated 队列卡，建议在 v0.9.6 截图实跑前先扩 `apps/web/e2e/screenshots/scenes.ts` 加 4 张新场景（ai-pre / cost-display / alias-chips / preannotated-queue），让 14 张统一一次性出图。

---

## C · 标注工作台专项优化（性能 / 界面 / 标注体验）

> 现状基线（截至 v0.8.8）：`WorkbenchShell` 三层架构（shell + stage + state）已稳定；Konva 画布 / 4 Layer / 虚拟化任务标注列表 / blurhash / Minimap / 阈值服务端化 / 批量编辑 / IoU 项目级阈值 / ETA / 智能切题 / polygon 编辑闭环（v0.8.8 hit-test 改进）/ 项目级属性 schema + hotkey 绑定 / 离线队列 + 多 tab 同步 + tmpId 端到端 + 抽屉 UI / 评论 polish（@ 提及 + 附件 + 画布批注 + v0.8.8 keyset 分页）/ 暗色模式 / Lucide 图标体系 / Shift 锁纵横比 + Alt 中心 resize / 任务跳过 + skip badge / History sessionStorage TTL 等已落地。
> 横向参考：CVAT（Konva 画布 + 关键帧插值 + 骨架）、Label Studio（interactive ML backend，SAM 触点）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量类别检测）。

### C.1 渲染性能 / 大图大量框
- **OpenSeadragon 瓦片金字塔**：当前直接加载完整图像，> 50MP 会卡。需要后端切瓦片 + 前端 OpenSeadragon viewport，与 Konva overlay 共生。极大图场景才必要。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。`useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。

### C.2 界面优化（信息架构 / 可见性 / 一致性）
- ~~**工作台工具栏 P2-a · 图标语义重整**~~ ✅ v0.9.5 phase 4 落地（9 处 sparkles 重整 + Icon 组件扩 6 个新 name + `docs-site/dev/icon-conventions.md` 钉死规范）。
- **工作台工具栏 P2-b · 可用性重构**（**P2**，v0.9.6 主体）：v0.9.5 phase 4 已收口图标语义；剩余可用性槽点留 v0.9.6 独立 epic 避免与 v0.9.5 主线同窗口截图双拍。
  - **格式化 Tooltip 组件**：新建 `apps/web/src/components/ui/Tooltip.tsx` —— 右侧 Popover 三行（工具名 + 描述 + ⌘ 键徽样式 hotkey），替原生 `title`
  - **按钮快捷键角标**：38×38 主工具按钮右下角嵌 8px 字母（`B/S/P/H`），不靠 hover 即可见
  - **激活态强化**：主工具加 2px 左侧 accent 色边条 + 阴影；子工具激活背景从 10% 提到 20% accent
  - **分组分隔线**：`[Box / Polygon] | [SAM] | [Hand]` 三组之间加 1px hairline；子工具栏 point/bbox/text 之间也加细分隔
  - **数字快捷键直跳**：`1=Box / 2=SAM / 3=Polygon / 4=Hand`。**冲突调研**：当前 1-9 已被 `setClassByDigit` 占用（`useWorkbenchHotkeys.ts:349` + `hotkeys.test.ts` 4 case 覆盖），需按 `target.tagName` 区分（input/textarea 聚焦时切类别，画布聚焦时切工具）。改 `useWorkbenchHotkeys` dispatch 入口前置 `if (canvasFocused) → setTool` 分支 + 加单测 4 case（画布 / input 聚焦切换 + 1-4 / 5-9 边界）。
  - **SAM 子工具栏改右展开抽屉**：当前垂直挤在 SAM 主按钮下方易与主工具栏混淆；改为 SAM 激活时向右弹独立子工具栏（类似 Photoshop fly-out），主工具栏视觉结构稳定
  - **Loading 可视化**：AI 推理中按钮加旋转 spinner overlay（lucide `loader-2` + `animate-spin`），不再仅 `disabled` + 文本"AI 推理中..."
  - **预计 ~1 天**：独立 plan `docs/plans/2026-??-??-toolbar-ux.md`；与截图自动化回填同窗口避免双拍。

### C.3 标注体验（核心生产力杠杆）
- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90%；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式）。
- ~~**SAM 子工具栏拆分（点 / 框 / 文本明确划分）**~~ ✅ v0.9.4 phase 2 落地（2026-05-08, **Crystal Compass**）。下方设计细节保留作历史参考；实施细节见 [`ROADMAP/0.9.x.md`](./ROADMAP/0.9.x.md) v0.9.4 phase 2 段。最终选定方案：保留 `samSubTool` 子态字段（不扩 Tool 联合）+ ToolDock 内嵌子工具栏 + S 循环切；hotkey 用 `=/+` `-` 切 polarity（数字键 1-9 已被「切换类别」占用，原方案改）。
  - **现状痛点**：当前 `S` 工具是单一 Tool（`useWorkbenchState.ts:5` `Tool = "box" | "hand" | "polygon" | "canvas" | "sam"`），按 `S` 进入后通过**鼠标动作隐式分流** prompt 类型 —— 单击 = positive point、Alt+点击 = negative point、拖框 = bbox prompt（`SamTool.ts:24` 都返回同一种 `samProbe` DragInit，`ImageStage.tsx:546` 按拖动距离分流）；文本 prompt 走 AI 助手面板的输入框，跟画布工具栏完全脱节。**问题**：① 新人不会发现 Alt+click = negative point；② 不知道点击和拖动会触发不同后端调用；③ 三种 prompt（point / bbox / text）在 UI 上没有显式分组，运维成本（文档 / 培训）高。
  - **设计方案**：S 激活后，画布顶部或左侧工具栏内浮出**子工具栏**：`[· 点 (Click)] [□ 框 (Box)] [T 文本]` 三按钮 + `[+ / −]` positive / negative 切换（仅点工具下显示）。当前激活的子工具决定接受的鼠标行为（点工具下拖框无效，框工具下单击无效），消除隐式分流；视觉 active state（紫色高亮）标明当前 prompt 类型。文本子工具点击后聚焦 AI 助手面板的文本输入框，把现有「分两块」的 UX 收回画布工具栏闭环。
  - **数据模型改动**：`Tool` 联合类型扩 `"sam-point" | "sam-bbox" | "sam-text"` 三个具体值（或保留 `"sam"` 父态 + 新增 `samSubTool` 子态字段，避免 hotkey 冲突）；`SamTool.ts` 拆三个 `*Tool` export，分别只接受对应 PointerEvent；`ImageStage.tsx` 的 `samProbe` 分流逻辑下移到 tool 层。
  - **协议联动**：依赖 §A AI/模型「SAM `/setup` 自描述协议消费」—— 后端补 `supported_prompts: ["point", "bbox", "text"]` 字段后，前端按 backend 实际能力动态渲染按钮（未来支持 sketch / scribble 等扩展时零改前端核心）。
  - **快捷键**：S 进入 SAM 模式（保留），子工具按 `1 / 2 / 3` 数字键切换；`+ / -` 切 positive/negative；`Esc` 退出。
  - **预计 1.5 天**：tool 拆分 + 子工具栏 UI + 数字键 hotkey + 截图自动化新增 1 张子工具栏特写。
- ~~**SAM text 模式输出选择 box / mask / both**~~ ✅ v0.9.4 phase 2 落地（与子工具栏同窗口做）。下方设计细节保留作历史参考。**实际选定**：智能默认 `image-det → box · 其它 → mask`（不引入 type_key→both 默认，仅 user opt-in）；项目级 default 字段（`projects.text_output_default`）推迟到 v0.9.5，sessionStorage 记忆已覆盖 80% 场景。
  - **现状痛点**：v0.9.2 SAM 文本 prompt 永远走 `DINO → boxes → SAM → mask → polygon` 全链路，固定输出 `polygonlabels`。但**对 image-det 项目反而是负担** —— 标注员要的是 bbox annotation，拿到 polygon 还得手动转矩形或交给前端"polygon → bbox"近似。同时 SAM mask 步骤 GPU 时间贵：text-box 单图仅 DINO ~50-100ms（4060/tiny），text-mask 全链路 200-500ms，box 模式跳过 `predictor.set_image()` + mask 推理 + cv2/shapely 简化能省 50-80% 推理时间。
  - **设计原则**：text 模式下让用户**显式选择输出形态**：① **box only**（DINO 出框直接当 detection annotation，速度最快、image-det 项目首选）；② **mask only**（当前行为，image-seg 项目首选）；③ **both**（同时出 box + polygon 配对，让用户在两个粒度间挑，mm 项目或人工对比时用）。
  - **协议变更（小）**：`apps/grounded-sam2-backend/schemas.py` `Context` 加字段 `output: Literal["box", "mask", "both"] = "mask"`（默认 mask 保持老前端兼容）；`AnnotationResult.type: "polygonlabels" | "rectanglelabels"` **已就位**，`AnnotationValue` schema 同时支持 box（x/y/width/height）+ polygon（points）字段，**返回结构零改动**。`both` 模式下 `result` 数组每个 instance 携带 `{type: "rectanglelabels", value: {x,y,w,h, ...}}` + `{type: "polygonlabels", value: {points, ...}}` 两条记录，前端按需消费。
  - **后端实现切片**（`predictor.py` 文本路径，约半天）：
    - 当前 `_run_text_prompt()` 的链路是 DINO → SAM → polygon，按 `output` 拆三个分支
    - `box`：DINO 出 boxes 后直接归一化为 rectanglelabels，**完全跳过** `predictor.set_image()` 与 SAM 推理；继续把 image embedding 写入 cache 反而浪费内存（box 模式下 cache 不写入）
    - `mask`：当前行为不变（保留入 cache）
    - `both`：DINO 出 boxes → SAM 拿 box prompt 出 masks → 同 instance 一对一配对，返回结构里 box + polygon 都给
    - 返回元信息加 `output_mode` 便于前端兜底分支
  - **前端实现切片**（约半天）：
    - **三选一切换 UI**：AI 助手面板的文本输入框右侧加 segmented control `[□ 框] [○ 掩膜] [⊕ 全部]`（与子工具栏 P1 epic 落地后的 T 文本子工具共用）
    - **智能默认（按项目 type_key）**：`image-det → box`，`image-seg → mask`，`mm / image-kp / 其它 → both`，让用户进项目就拿到合理默认；用户切换后写 sessionStorage 记忆（key: `wb:sam:textOutput:{projectId}`）
    - **候选叠加层**：`box` 模式紫虚线矩形 + Enter 接受；`mask` 模式紫虚线 polygon（当前行为）；`both` 模式两者配对叠加，Tab 在 box / polygon 间切活跃候选，Enter 接受当前活跃形态
    - **`useInteractiveAI` payload** 加 `context.output` 字段；ImageStage 候选渲染层按 `result[i].type` dispatch
  - ~~**项目级默认（中期，v0.9.5 候选）**~~ ✅ v0.9.5 落地：`projects.text_output_default VARCHAR(10) NULL` + 迁移 0050 + GeneralSection 4 项下拉 + `resolveInitialOutputMode` 优先级「项目级 → sessionStorage → type_key」。CreateProjectWizard 同步留 v0.9.6 chip。
  - **协议文档同步**：`docs-site/dev/ml-backend-protocol.md` §2 Context schema 加 `output` 字段说明；用户手册 SAM 文本 prompt 章节加三种模式截图 + 速度对比表。
  - **预计 1 天**：协议字段 + 后端 predictor 三分支 + 前端 segmented control + 候选叠加层适配。
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
| **P2** | 工作台工具栏 P2-b · 可用性重构（§C.2） | Tooltip 组件 + hotkey 角标 + 激活态强化 + 分组分隔 + 数字键 1-4 直跳工具（需 `target.tagName` 区分 `setClassByDigit` 1-9 切类别） + SAM 子工具栏改抽屉。v0.9.6 主体 ~1 天 | — |
| **P2** | 截图自动化 14 张实跑回填 | v0.8.7 落地脚本 + scenes 配置；与 v0.9.6 工具栏 P2-b 同窗口做避免双拍 | — |
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
| **P3** | AIPreAnnotatePage 二阶段功能（历史 job 列表 + 失败重试入口 + 跑完接管 CTA） | v0.9.5 落地后 UX 反馈：基础流程已通但缺 admin 闭环；扩 `/admin/preannotate-queue` 端点 + 前端 ~0.5 天 | — |
| **P3** | 类别 alias 大小写规范化 + DINO 召回友好提示 | v0.9.5 引入 alias 字段但未规范化；用户输 `Person` vs `person` 召回有偏差。`field_validator` 自动 lower/strip + 前端 onBlur ~0.3 天 | — |
| **P3** | CreateProjectWizard 第 4 步暴露 `text_output_default` | v0.9.5 GeneralSection 已加但 wizard 未同步；新建项目要再回设置改一次 ~0.3 天 | — |
| **P3** | batch.pre_annotated → 工作台/任务列表视觉提示 | v0.9.5 加了状态但 BatchStatusBadge / Topbar 未做特殊视觉处理；让标注员一眼知道「AI 预标已就绪」~0.2 天 | — |
| **P3** | AIPreAnnotatePage 类别 alias chips 滚动 + 频率排序 | 项目 30+ 类别全配 alias 时 chips 铺满整行；限高 + 横向滚动 + 按 prediction count 排序 ~0.2 天 | — |
| **P3** | predictions 月分区 Stage 2 完整迁移 | ADR-0006；触发条件单月 INSERT > 100k 或 总行数 > 1M | [0006](docs/adr/0006-predictions-partition-by-month.md) |
| **P3** | projects.batch_summary stored 列 | v0.7.6 评估后推迟；触发点 8 处维护成本高，当前 GROUP BY 性能未到瓶颈 | — |
| **P3** | 前端单测从 25% 推到 30% | v0.8.8 已推回 25.17%；下阶段补 ProjectSettingsPage / AuditPage / WorkbenchShell 关键 hook 单测 | — |
| **P3** | 首次登录 UI walkthrough（onboarding tooltip） | 新客户上线前低优；客户反馈触发再做 | — |
| **P3** | i18n、2FA | 客户具体需求驱动（SSO 已单独提升到 P2） | — |
| **P3** | C.3 SAM 后续延伸：Magic Box、类别确认 hint | 依赖 SAM 基座 | — |
| **P3** | MlBackendFormModal 加测试连接 + URL 默认值预填 | 注册体验摩擦：每次手敲 `http://172.17.0.1:8001`；先存后测有 DB 留无效行成本 | — |
| **P3** | CreateProjectWizard 启用 AI 时 backend 绑定校验 | 新建项目仍可处于「AI 启用 + 未绑定」状态，跟 v0.9.5 GeneralSection 已落地的「绑定到本项目」按钮一致性差距 | — |
| **P3** | RegisteredBackendsTab 行内深度健康指标 | v0.9.5 backend `/health` 已扩 `gpu_info` + `cache`，仅前端聚合 `GET /admin/ml-integrations/overview` 展示未做；运维直观 | — |
| **P3** | ML backend storage endpoint 选择机制（生产化） | v0.9.4 phase 1 用 `ML_BACKEND_STORAGE_HOST` 简单覆盖适合 dev + ADR-0012 已写决策框架；生产场景多变，第一个生产部署遇到再扩 ADR 策略表 | [0012](docs/adr/0012-sam-backend-as-independent-gpu-service.md) |
| **P3** | 审计日志冷数据物化触发 | v0.8.1 partition + Celery beat archive 已就位；当前数据量未到 1M 行 | [0007](docs/adr/0007-audit-log-partitioning.md) |

---

## 优化建议 / 文档维护备忘

> v0.8.8 重写后这一节用于记录"对 ROADMAP 自身格式"的下次维护方向，避免文件无限膨胀。v0.9.5 已按此节工序做了一次精简（删除 9 条已落项 + 增补 5 条 v0.9.5 落地后新发现）。

1. **「后续观察项」清单滚动归档**：当前 §A 末尾保留 3 条 v0.7.x ~ v0.8.8 残留观察（3/5）；超过 5 条时拆出 `ROADMAP/observations.md`。
2. **触发条件量化**：「监控触发」类条目（如 predictions Stage 2、batch_summary stored 列）目前是文字描述；条件成熟后可在 Grafana dashboard 加阈值 panel + 告警，跨过即生 ROADMAP 通知 issue。**仍未执行**（依赖 Grafana 工程化优先级）。
3. **版本切片 epic 完成时同步精简 §A/§C**：v0.9.5 实证：每个 epic 收尾时应配套删 §A / §C 已落项 + 在该 epic 后写 1 段「落地后新发现」补到优先级表，避免 ROADMAP 与 CHANGELOG 双源真相漂移。**已成为约定**。
4. **ADR 引用列回填**：v0.9.5 加了 ADR-0012/0013，回填到优先级表 Related ADR 列；下次每次新增 ADR 时记得 grep 优先级表对应行加链接。
