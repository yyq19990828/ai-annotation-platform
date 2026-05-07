## 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本详见 [CHANGELOG.md](./CHANGELOG.md)：v0.6.0 ~ v0.6.10-hotfix 同前；v0.7.0 批次状态机重设计 epic 同前；**v0.7.2（治理可视化 + 全局导航）**；**v0.7.3（批次状态机扩展 + 多选批量操作 + 操作历史）**；**v0.7.4（测试与文档体系一次性建齐）**；**v0.7.5（性能 & DX 收尾）**；**v0.7.6（功能补缺 + 治理深化）**；**v0.7.7（登录注册机制完善）**；**v0.7.8（登录注册改进 + 安全加固 + 治理合规）**；**v0.8.0（文档细化与补全：deploy/security/ml-backend-protocol/ws-protocol 4 篇新文档 + ADR 0002-0005 回填 + 快捷键 SoT 自动生成 + data-flow mermaid 代码路径标注 + add-api-endpoint 改 logout 真实例 + 16 处截图占位 + IMAGE_CHECKLIST）**；**v0.8.1（治理合规向收口 epic：系统设置可编辑 + SMTP 测试发送 + 注册来源统计卡 + 管理员重置低等级用户密码 + 账号自助注销 7 天冷静期 + audit_logs 按月分区 + 冷数据归档 + 4 个导出端点审计强化）**；**v0.8.2（文档深度优化：docs:build 进 CI gate + snippet 漂移 lint + ADR sidebar mirror + echo-ml-backend 可执行样板 + ADR-0008 admin-locked 状态机草稿）**；**v0.8.3（治理 / 测试基建闭环：在线状态心跳 + 审计 trigger 测试覆盖 + 前端单测切硬阻断（10%）+ E2E 三 spec 写实摘 continue-on-error + `_test_seed` router 造数链路）**；**v0.8.4（效率看板 / 人员绩效 epic：Task.assigned_at + task_events + mv_user_perf_daily + Annotator/Reviewer 三段卡组 + AdminPeoplePage 卡片网格 + 抽屉下钻 + ADR-0009）**；**v0.8.5（fabric 清理 + AnnotatorDashboard 24-bar 专注时段直方图 + 前端单测推到 25.28%（CI 阈值 25%）+ E2E annotation/batch-flow 写实化（bbox 拖框 + 多角色串联 + 4 处 data-testid + `_test_seed.advance_task` 辅助端点））**；**v0.8.6（v0.9.x 准备版：协议 `context.type` 扩 `text` + ML Backend 周期健康检查（Celery beat 60s + 抖动）+ Project↔MLBackend 真实绑定 + 预测成本卡片 + `apps/_shared/mask_utils/` 共享包骨架 + 失败预测重试 UI + ws 进度推送 + ADR-0010/0011 留作 v0.9.x M5）**；**v0.8.7（防机器人 / 指标深化 / E2E 续作 / 截图自动化 / 工作台 UX 收口：Cloudflare Turnstile CAPTCHA + Prometheus `ml_backend_request_duration_seconds` + `celery_queue_length/worker_heartbeat_seconds` + 预测延迟 P50/P95/P99 + ReviewerMiniPanel + Shift 锁纵横比 / Alt 中心 resize + Task.skip_reason 任务跳过 + History sessionStorage 5min TTL + Playwright 截图自动化 14 场景）**。

---

### 即将到来（按版本切片的详细计划）

> 大颗粒 epic 拆到独立文档；下面 §A/§B/§C 仍维护单条颗粒度的待办。

- **[v0.9.x — Grounded-SAM-2 接入（首版 AI 基座）](./ROADMAP/0.9.x.md)**：vendor `IDEA-Research/Grounded-SAM-2` 打包成 ML Backend，一期吃下点 / 框 / 文本三种 prompt，落 `/ai-pre` 文本批量预标 + 工作台 `S` 工具。预计 ~5 周。
- **[v0.10.x — SAM 3 接入（与 Grounded-SAM-2 并存）](./ROADMAP/0.10.x.md)**：新增 sam3-backend 作为高精度选项，**不替换** v0.9.x grounded-sam2-backend；增加 exemplar prompt + 路由策略 UI + AB 对比工具。预计 ~3.5 周。

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
- **AI 预标注独立页**：路由 `/ai-pre` 为占位 PlaceholderPage。Dashboard「AI 预标注队列」卡片永久显示空状态（`AdminDashboard.tsx:107-119`、`DashboardPage.tsx:287-291`）。**v0.9.4 接 grounded-sam2-backend 文本批量预标 UI 时收口**。
- **模型市场**：路由 `/model-market` 占位。
- **训练队列**：路由 `/training` 占位。
- **失败预测「永久放弃」UI**：v0.8.6 落地 max=3 软上限重试，但超过 3 次后 admin 在 `/admin/failed-predictions` 没有「永久放弃 / 标记忽略」按钮，只能数据库手删；建议加 `failed_predictions.dismissed_at` + 列表 toggle 过滤已忽略。
- **预测成本卡片透传到工作台**：v0.8.6 已落 admin 维度 `/admin/prediction-cost-stats`；剩工作台 AI 助手面板「本题花费 X 元」单条透传，与 v0.9.x SAM 工具一起做。

#### 用户与权限页（UsersPage）
- **「API 密钥」按钮**：`UsersPage.tsx:63` 无实现（API key 模型也未建表）。需 `api_keys` 表 + scope + revoke + 最后使用时间。
- **「存储与模型集成」面板**：`UsersPage.tsx:246-269` 全部 mock 数据，应对接 `/storage/health` 与 `/projects/{pid}/ml-backends`。

#### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**：语言 / 主题 / 时区 / 通知偏好均无（依赖 i18n / 主题基础设施先建立）。

#### TopBar / Dashboard 控件
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast；Organization 表已存在但前端无切换 UI。

#### 登录 / 注册 / 认证
- **登录页 progressive CAPTCHA**：v0.8.7 在注册 / 忘记密码两路加了 Turnstile，但登录页故意未加（每天高频，体验代价大）。production 字典攻击场景下，建议改为渐进式：同一 IP 失败 ≥ 5 次（slowapi 计数 + Redis）后下一次登录强制弹 widget；正常用户零打扰，攻击者被减速。前端：登录失败计数从 401 response header 读取，达到阈值时 LoginPage 渲染 `<Captcha>`。
- **开放注册二阶段剩余**：
  - **邮箱验证**：当前 viewer 零权限可跳过；若未来开放注册默认角色调高，需 `POST /auth/verify-email` + `email_verified_at` 字段 + 验证前 `is_active=false`。
  - **OAuth2 / 社交登录**：Google / GitHub SSO，python-social-auth 或 authlib；`User.oauth_provider` + `oauth_id` 字段；LoginPage / RegisterPage 加「使用 Google 登录」按钮。

#### v0.7.x ~ v0.8.0 后续观察 / 下版候选

> v0.7.0 集中收口了批次状态机 epic + v0.6.x 写时观察 18 项；v0.7.6 一次清了 4 项（属性 schema 步骤 / NotificationsPopover usePopover 迁移 / ProjectsPage 卡片 DropdownMenu / task.reopen fan-out / Kanban 看板）；v0.7.7 落了开放注册基座；v0.8.0 一次性把开发文档分组与 ADR 0002-0005 补齐；v0.8.2 把文档体系四处机制缝隙（CI gate / snippet lint / ADR sidebar / echo 样板）以自动化方式收齐；下面列剩余观察项：

- **standalone batch_summary stored 列**：v0.7.0 项目卡批次概览用 GROUP BY 单查询返回 `{total, assigned, in_review}`，每次 list_projects 都触发；如需更冷优化，可加 stored 列由 batch 状态机变迁维护。**v0.7.6 评估后推迟**：触发点 8 处维护成本高，当前 GROUP BY 性能未到瓶颈。优先级 P3，监控触发再做。
- **getting-started 与 SoT 漂移**：v0.8.0 已修过一次（W/R/Ctrl+Enter → B/V/E）。文档站文字硬编码的快捷键提示如再次漂移仍需手改，长期可考虑给所有 .md 中的 `` `<键>` `` 内联引用建一份从 hotkeys.ts 推导的 ESLint/markdownlint 规则；优先级低，等漂移再触发。
- **`_task_with_url` 与 `TaskOut` schema 漂移**：`apps/api/app/api/v1/tasks.py:1024-1095` 手写 dict 构造响应（不走 `TaskOut.model_validate`），v0.8.7 加 `skip_reason / skipped_at` 时漏一处就丢字段。下一版改造为 `TaskOut.model_validate(task, from_attributes=True)` + 单独 hook 注入 `file_url / thumbnail_url / assignee/reviewer briefs`，让 schema 变更自动生效。优先级 P3。
- **`/health/celery` workers `last_heartbeat_seconds_ago` 仍是 0 占位**：v0.8.7 F2 接通了 queues 维度，但心跳 timestamp 用 round-trip 时刻近似为 0；要真实心跳秒数需 broker 侧报告（kombu / rabbitmq events）。当前 worker 「在线 / 不在线」二元已能满足告警，分钟级新鲜度待客户提需求再做。优先级 P3。
- **前后端共用 `.env`**：v0.8.7 给 `apps/api/app/config.py` 加了 `extra="ignore"` 让 VITE_* 不再炸；但前端 vite 默认只读项目根 `.env`，`apps/web/.env.example` 同步占位但运行时不一定加载——建议仓库根 `.env` 收口为 SoT，移除 `apps/web/.env.example` 或在 vite.config.ts 显式 `envDir: '../../'`。优先级 P3，等开发者反馈混乱再做。

---

### B · 架构 & 治理向前演进

#### 安全
- **2FA / TOTP**：super_admin 必选、其它角色可选。
- **API 密钥**：UsersPage 已有按钮，需 `api_keys` 表 + scope + revoke + 最后使用时间。
- **HTTPS 强制 / HSTS / CSP**：production 中间件层补齐。v0.8.0 `deploy.md` 已写 nginx 端 TLS 终结示例，但 FastAPI 侧没有 strict-transport-security / CSP middleware；建议加 `app/middleware/security_headers.py` + production-only 注册。

#### 治理 / 合规
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

#### 效率看板 / 人员绩效（v0.8.4 已落 L1+L2+L3，v0.8.5 已落 24-bar 专注时段尾巴）

> 当前阶段已无 open 项；后续如需扩展，参考调研报告 + ADR-0009。


#### 可观测性
- **Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest**：v0.6.9 闭环 + 通知已落，剩 LLM SDK + SMTP 链路；`bug_reports` 加 `cluster_id` / `llm_distance`；与通知偏好（按 type 静音）协同。
- **Sentry DSN production 部署校验**：v0.6.6 已搭基础设施，但 `.env.example` 中 `SENTRY_DSN=` 留空；production 部署易忘记填，错过线上错误。建议 `app/main.py` lifespan 在 `environment="production"` + DSN 缺失时 emit 一条 WARN 日志（不阻断启动），同时 deploy.md 加 checklist 项。优先级 P3。
- **Grafana / Prometheus dashboard JSON 入仓**：v0.8.7 加了 4 个 metrics（http / ml_backend / celery_queue / celery_worker），但目前没有官方 dashboard 模板。建议 `infra/grafana/dashboards/anno-overview.json` + deploy.md 一段「import this JSON」说明，让 production 运维零成本上 panel。优先级 P2。

#### 性能 / 扩展
- **Annotation 列表前端切换 keyset 分页**：v0.7.6 已落后端新端点 `GET /tasks/{id}/annotations/page?limit&cursor` + 复合索引；前端 `useAnnotations` 仍用旧数组端点（cap=2000），改 useInfiniteQuery 推迟到 1000+ 框监控触发。
- **Predictions 表分区**：v0.7.6 已落 Stage 1（`ix_predictions_created_at` 索引）+ ADR-0006 设计 Stage 2 完整 RANGE(created_at) 月分区。Stage 2 触发条件：单月 INSERT > 100k 或 总行数 > 1M（FK 复合化代价 + annotations 表迁移成本）。

#### 测试 / 开发体验
- **前端单元测试 — 页面级覆盖**：vitest + MSW 基座 v0.7.4；v0.8.5 推到 25.28% / 阈值 25；**v0.8.7 因引入 8 个新组件回退到 22.04% / 阈值临时降到 22**。下阶段目标推回 ≥ 25 → 30：补 `ProjectSettingsPage`（842 行）/ `AuditPage` / `WorkbenchShell` 关键 hook（`useCanvasDraftPersistence`、`useTaskNavigation`）/ `turnstile.ts`（当前 18% 覆盖）。
- **E2E reject 反馈环已闭，approve 通知端到端断言留下版**：v0.8.7 已落 reviewer reject UI 全流程；剩 `reviewer 通过 → annotator 看到通知 + my-batches 计数变化`的双向闭环。当前 NotificationsPopover 与 `useNotificationSocket` 已就位，缺一条 spec 把它们串起来。
- **OpenAPI snapshot 自动重生成 hook**：v0.8.7 修字段 schema 时 `test_openapi_contract.py` 失败，需手动 `uv run python scripts/export_openapi.py`。建议 `.pre-commit-config.yaml` 加一条「检测 schema/auth/* 路径变更时自动 regen + git add」hook，避免 CI 红灯。优先级 P3。
- **前端 bundle size budget**：v0.6.5 已加 `manualChunks` 拆 vendor，v0.8.7 引入 `turnstile.ts`（动态 inject 不进 bundle）但 `Captcha.tsx` + `SkipTaskModal.tsx` 等 ~5 KB 累计未监控。建议 `vite-plugin-bundle-stats` + `package.json` 加 `size-limit` config（main < 500 KB、vendor-konva < 300 KB），CI 失败时阻断。优先级 P3。
- **WebSocket 鉴权过期重连**：v0.6.6 落地 `useNotificationSocket` + v0.8.6 加 `failed_prediction.retry.*` 进度推送；token 过期（默认 24h）后 ws 会断且不会自动 reauth，长会话标注员需手动刷新页面。建议 hook 内监听 onclose 1008 / 4001 → 拉新 token → 重连；优先级 P2，受用户投诉触发。

#### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **无障碍**：ARIA 属性极少；Lighthouse Accessibility 分数应作为 PR gate。

#### 文档（v0.7.4 已搭 VitePress 文档站三栏骨架；v0.8.0 ADR / 协议契约 / SoT 自动化补齐；v0.8.7 截图自动化骨架）

- **截图自动化执行 + 14 张回填**：v0.8.7 落了 `apps/web/e2e/screenshots/` 脚本框架，但 PNG 文件需 maintainer 在完整启动栈下 `pnpm --filter web screenshots` 实际跑一遍并把结果 commit。部分场景（iou 双框 / bulk-edit 多选 / progress 50%）需先在 fixture 里造数据再 prepare 钩子触发。
- **首次登录引导（onboarding）**：用户手册有文档但工作台无 UI walkthrough；新用户进 `/projects/:id/annotate` 时左下浮出一条「画框：拖鼠标；提交：E」级别的 3 步 tooltip + 右上 ✕ 关闭一次性写 localStorage `wb:onboarded:v1`。优先级 P3，等首次客户上线反馈触发。

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
- **跳过任务 reviewer 端可视化**：v0.8.7 落了 `Task.skip_reason` 写入但 reviewer 在 `/review` 工作台和列表上未显式区分「正常提交 vs 跳过」。建议 `ReviewerTaskCard` 加紫色 `skip` badge + reject modal 预填 `skip_reason` 提示「此题被标注员跳过」，reviewer 可决定 `mark done`（无目标也算 done）或 `reject 重派`。优先级 P2，与 v0.9.x 标注体验一起做。

#### C.3 标注体验（核心生产力杠杆）
- **SAM mask → polygon 化（marching squares / simplify-js）**：与 SAM 接入一起做。
- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90%；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式）。
- **SAM 交互式标注（点 / 框 → mask）**：研究报告 `06-ai-patterns.md`「模式 B」P1。最小切片：
  - 后端：`POST /projects/{pid}/ml-backends/interactive`，路由到 `is_interactive=True` 的 ML backend；常驻 GPU 容器 + image embedding LRU 缓存（首次 ~300ms，命中 < 50ms）。
  - 前端：新工具 `S`（SAM 模式），点击 = positive point、Alt+点击 = negative point、拖框 = bbox prompt；返回多边形以「待确认紫虚线」叠加，Enter 接受 / Esc 取消。
  - 与现有 GroundingDINO 配合：「文本框 → 全图批量同类」 vs 「点 / 框 → 单实例精修」两条路并存。
- **关键帧插值（视频/序列）**：CVAT 同款；标注员只标 1 / 30 / 60 帧，中间线性插值。需配合 `Task.dimension` 字段。
- **类别确认 hint**：刚画完一个框时，AI 后台跑一次单框分类，右上角弹「建议：标识牌（92%）」+ 一键采纳。
- **Magic Box / Snap**：粗略画一个大框 → AI 收紧到对象边缘（SAM 推 mask → 取 mask bbox）；同时支持「贴边吸附」。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **`U` 键准确度升级**：v0.5.2 用启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）。
- **CommentsPanel keyset 分页**：v0.7.6 给 annotation list 落了后端 keyset 分页，但 `<CommentsPanel>` 仍全量拉一个标注的所有评论（含 @ 提及 + 附件 + 画布批注），单条标注 100+ 评论时初始化卡顿明显。建议复用 annotation 同款 cursor 分页 + 「加载更早评论」按钮。优先级 P3。
- **Polygon 顶点贴近时的 hit-test 改进**：当前 polygon 编辑模式下两个相邻顶点距离 < 8px 时容易选错；建议 z-order 优先选最后绘制的顶点 + 选中态加大 handle 半径。优先级 P3，体感问题。

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
| **P1** | 前端单测从 22% 推回 ≥ 25 → 30 | v0.8.7 引入 8 个新组件回退到 22.04%；优先补 ProjectSettingsPage / AuditPage / WorkbenchShell hook / turnstile.ts |
| **P2** | 邮箱验证（开放注册角色提升前置） | 当前 viewer 零权限可跳过；角色调高时必备 |
| **P2** | OAuth2 / 社交登录（Google / GitHub SSO） | 降低注册门槛，企业场景 SSO 常见需求 |
| **P2** | 登录页 progressive CAPTCHA（5 次失败后启用） | v0.8.7 注册/忘记密码已上 Turnstile，登录字典攻击仍裸奔 |
| **P2** | 系统设置 admin UI 可编辑（含开放注册 toggle） | 当前所有系统设置仅 env 控制，运维成本高 |
| **P2** | HTTPS 强制 / HSTS / CSP middleware | v0.8.0 deploy.md 已写 nginx 端 TLS，FastAPI middleware 缺 strict-transport-security / CSP；production-only 注册 |
| **P2** | Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest | v0.7.0 通知偏好（基础静音）已落，邮件 channel 字段已就位但 UI 未启；与 LLM 聚类协同 |
| **P2** | 非 image-det 工作台（image-seg → keypoint → video → lidar） | 体量大，按业务优先级排队 |
| **P2** | C.3 marquee / 关键帧 / 会话级标注辅助 | 业务复杂度起来后必需 |
| **P2** | C.1 OpenSeadragon 瓦片金字塔、IoU rbush 加速 | 千框 / 4K 大图场景才必要 |
| **P2** | 批次状态机二阶段剩余：`annotating → active` 暂停（实施 ADR-0008） + bulk-approve / bulk-reject | v0.8.2 ADR-0008 已 Proposed；v0.9 实施前需补 scheduler 测试覆盖；bulk approve/reject UX 待定 |
| **P2** | WebSocket 鉴权过期重连 | v0.8.6 落地 ws 进度推送；token 过期后 ws 断开不自动 reauth，长会话标注员需手动刷页 |
| **P2** | Grafana / Prometheus dashboard JSON 入仓 | v0.8.7 加了 4 个 metrics 但无官方 panel 模板；运维上手成本高 |
| **P2** | reviewer 端跳过任务可视化 + reviewer approve → annotator 通知 E2E 闭环 | v0.8.7 reject 反馈环已落，approve 双向闭环 + reviewer 端 skip badge 留作下版 |
| **P2** | 失败预测「永久放弃」UI | v0.8.6 max=3 软上限后 admin 没有 dismiss 按钮，只能数据库手删 |
| **P3** | predictions 月分区 Stage 2 完整迁移 | v0.7.6 已落 Stage 1 索引 + ADR-0006；触发条件单月 INSERT > 100k 或 总行数 > 1M |
| **P3** | projects.batch_summary stored 列 | v0.7.6 评估后推迟；触发点 8 处维护成本高，当前 GROUP BY 性能未到瓶颈 |
| **P3** | `_task_with_url` 改 `TaskOut.model_validate` 消除 schema 漂移 | v0.8.7 加 skip_reason 时漏一处就丢字段 |
| **P3** | OpenAPI snapshot pre-commit 自动重生成 hook | 改 schema 后忘 export → CI 红灯 |
| **P3** | 前端 bundle size budget（size-limit 进 CI） | v0.6.5 已分 vendor chunk，但单测/E2E/turnstile 加进后无监控 |
| **P3** | Sentry DSN production 缺失时 startup WARN | 部署易忘配置错过线上错误 |
| **P3** | CommentsPanel keyset 分页 + Polygon 顶点 hit-test 改进 | 单标注 100+ 评论卡顿；polygon 编辑误选体感问题 |
| **P3** | 首次登录 UI walkthrough（onboarding tooltip） | 新客户上线前低优；客户反馈触发再做 |
| **P3** | 前后端 .env 共用 SoT（vite envDir 统一根 .env） | 当前双份 .env.example 易漂移 |
| **P3** | i18n、2FA | 客户具体需求驱动（SSO 已单独提升到 P2） |
| **P3** | C.3 SAM 后续延伸：Magic Box、类别确认 hint、CommentsPanel 分页、Polygon 顶点 hit-test | 依赖 SAM 基座或体感问题 |
| **P3** | 审计日志归档（PARTITION）；AuditMiddleware 队列化 v0.7.6 已落 Celery | 当前数据量未到瓶颈，监控触发再做 |

---
