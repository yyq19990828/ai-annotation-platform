# 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本详情见 [CHANGELOG.md](./CHANGELOG.md) 与 [docs/changelogs/](docs/changelogs/)；本文件只保留尚未完成或仍需触发的事项。

---

## 即将到来（按版本切片的详细计划）

> 大颗粒 epic 拆到独立文档；下面 §A/§B/§C 仍维护单条颗粒度的待办。

### 计划中

- **[v0.10.x — SAM 3 接入（与 Grounded-SAM-2 并存）](./ROADMAP/0.10.x.md)**：新增 sam3-backend 作为高精度选项，**不替换** v0.9.x grounded-sam2-backend；增加 exemplar prompt + 路由策略 UI + AB 对比工具。共享 `apps/_shared/mask_utils/`。预计 ~3.5 周。
- **[P0/P1 · 视频标注工作台综合 epic](./ROADMAP/2026-05-12-video-workbench-rendering-optimization.md)**：已合并原 [`[archived]2026-05-11-video-workbench.md`](./ROADMAP/%5Barchived%5D2026-05-11-video-workbench.md) 功能线。范围：V4-V6 功能尾巴（review 差异化 / probe 重试 / bbox→track 聚合）+ R1-R12 渲染体系（帧索引 / 分层 / 插值 / 时间轴 / 帧缓存 / Viewport / Polygon track / AI tracker / segment）+ R13-R24 CVAT 视频深度借鉴（Chapter / Track Split-Merge-Join / MOT 导出 / frameStep / Job overlap / Tracker Registry / MOTA-IDF1）。共 7 个 Wave。
- **[P1 · 视频后端帧服务 epic](./ROADMAP/2026-05-12-video-backend-frame-service.md)**：B1-B7 后端独立工程，承载帧时间表、chunk 切片、帧抽取缓存、segment 协同、AI tracker 编排、manifest v2、监控运维。前端 R5.3 / R10 / R11 / R20 / R21 / R23 的服务端依赖。
- **[P2 · 图片工作台优化（渲染 + 能力扩展）](./ROADMAP/2026-05-12-image-workbench-optimization.md)**：I1-I8 渲染优化（大图 tile、多边形 LOD、SAM 缓存、双图比对、批注时间线）+ I9-I21 CVAT 借鉴能力扩展（Ellipse / Skeleton / Mask 编辑器 / Object Group / Attribute Schema / Autoborder / Issue 锚点 / GT-IAA / Interactor 协议）。
- **[长期规划（12 个月以外）](./ROADMAP/2026-05-12-long-term-strategy.md)**：L1-L15 战略方向盘点。数据中台 / 主动学习闭环 / 模型评估 / 跨模态 / 协同与众包 / 插件机制 / 公开 SDK / 合规认证 / 移动端 / 端侧推理 / 合成数据 / SaaS / 可观测性 / i18n / AI 审计。**当前 P0/P1 完成前不开工**。

---

## 当前焦点（按"何时触发"分组）

> 优先级表（§ 末尾）按价值/成本排序；本节按**触发条件**重组，一眼看清"现在能做什么 / 等什么再做"。

### 现在可做（无前置依赖，作为 `chip:maintenance` 穿插推进，不抢 v0.10.x 主线）

- **CSP `style-src` nonce 收紧**（P3，留 v0.10.x 与 ProjectSettingsPage 重构 + 全站 ~2600 处 `<style={{}}>` 重构同窗口；script-src 已 v0.9.11 收紧）
- **OpenSeadragon 瓦片金字塔**（已合并到[图片工作台优化 I1](ROADMAP/2026-05-12-image-workbench-optimization.md)；极大图 > 50MP 才必要）
- **i18n 框架接入**（P3，与全站 inline style 重构合并节省破窗成本，inline style 密度最高的 ProjectSettingsPage sections 群可作为切入点）
- **截图 fixture 数据补齐 + 重跑**（P3）：4 张空白态需补数据后重跑（`ai-pre-history-search` / `ai-pre-empty-alias` / `bbox-iou` / `bbox-bulk-edit`）。
- **PerfHud 浏览器侧指标**（P3）：FPS / JS heap / longtask / API p95 / WS 重连数 / 当前 task 框数，留到 §C.1 keyset 分页拐点判断时一并加。
- **dev SMTP 测试链路**（P3）：docker-compose 缺 mailpit / mailhog dev SMTP service；可加 `mailpit` service + `.env` `SMTP_HOST=mailpit SMTP_PORT=1025`。
- **Workbench Shell 拆分后续精简**（P3，M6 归档后的维护项）：`WorkbenchShell.tsx` 已降到 790 行并保留单 Shell + mode hooks；下一步只做低风险瘦身：① 把 `WorkbenchStageHostProps` 按 image/video 分组，降低 Host prop 面积；② 等真实 3D 需求出现再抽通用 `StageControls`，当前不为 camera/viewport 预设接口；③ 给 `WorkbenchLayout` / `WorkbenchStageHost` 补 focused render tests，避免后续改 topbar/overlay 时回归；④ 若 Shell 再超过 900 行，再考虑 `useWorkbenchShellModel` 装配 hook。

### 等业务规模 / 监控触发（先观察、不做）
- **predictions 月分区 Stage 2**：单月 INSERT > 100k 或 总行数 > 1M（ADR-0006）
- **batch_summary stored 列**：当前 GROUP BY 性能未到瓶颈（v0.7.6 评估推迟）
- **审计日志归档物化**：v0.8.1 已落 partition + Celery beat archive，AuditMiddleware 队列化已完成；冷数据数据量未到 1M 行
- **`/health/celery` 真实心跳秒数**：当前 round-trip 近似为 0；分钟级新鲜度待客户提需求
- **OAuth2 / SSO**：等具体客户驱动（企业场景需求触发再做）

### 等独立 epic（体量大、不适合塞进收尾版）
- **视频工作台（功能 + 渲染 + 后端）三联**：见上文「计划中」四个文档。
- **非视频工作台**（image-seg / keypoint / lidar，C.4 Layer 2 触发；图片侧渲染优化已独立 epic）
- **大文件分片上传**（>5GB 视频 / 点云）
- **数据集版本 snapshot + 主动学习闭环**（与训练队列一起做，长期规划 L1 / L2）
- **2FA / TOTP**（super_admin 必选 / 其它角色可选）
- **批次状态机二阶段：admin-locked + bulk-approve / bulk-reject**（ADR-0008 Proposed → 实施前补 scheduler 测试覆盖）
- **长期方向**：见 [`ROADMAP/2026-05-12-long-term-strategy.md`](ROADMAP/2026-05-12-long-term-strategy.md)（数据中台、主动学习、合规认证、跨模态等 15 个方向）。

---

## A · 代码观察到的硬占位 / 残留 mock

### 项目模块
- **非 image-det / video-track 类型的标注工作台**：image-seg / image-kp / lidar / video-mm / mm 仍未提供真实标注能力。`lidar` 在 Workbench StageHost 中已有 3D placeholder，但 Dashboard 入口仍未把它作为可用工作台开放；接入真实 3D 前不要复用图片 / 视频 geometry。
- **项目模板**：当前每次新建项目都从 0 配置类别 / AI 模型；无「从已有项目复制」或「保存为模板」入口（v0.7.6 wizard 已扩为 6 步含属性 schema，模板复用更有意义了）。

### 数据 & 存储
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。
- **批次相关延伸**：① 智能切批（按难度/类别/不确定度）；② 批次级 IAA / 共识合并算法；③ 不可变训练快照 + 主动学习闭环。调研报告 [docs/research/12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md)。
- **批次状态机增补 · 二阶段**（v0.7.3 已收 3 条 owner 逆向迁移 + 4 项多选批量；v0.7.6 已收 reset → draft 终极重置；以下为延后项）：
  - `annotating → active` 暂停：项目临时叫停。**难点**：调度器（`scheduler.check_auto_transitions`）一旦看到 `in_progress` task 就会立刻把 batch 推回 `annotating`，需要同时把 in_progress task 复位到 pending（释放标注员锁）+ 引入 batch 级「admin-locked」标志阻断调度器；ADR-0008 已 Proposed 但未实施。
  - 批量状态迁移类（bulk-approve / bulk-reject）：v0.7.3 故意未做。reject 反馈是逐批次语义、approve 跳过逐批次审视有质检失职风险。落地前先讨论 UX。

### AI / 模型
- **模型市场扩展**：v0.9.3 phase 2 已激活 `/model-market`（合并 backends + failed-predictions tab）；二期：① 模型版本对比 / AB 路由 UI（依赖 v0.10.x sam3-backend 双模型并存）；② 一键热更新模型权重（`/admin/ml-backends/{id}/reload`）；③ **注册 backend 时选模型变体**（详见下条，C → B 两阶段，与本条同窗口）。
- **注册 backend 时选模型变体 · C → B 两阶段**（**P2**，与模型市场二期同窗口）：
  - **现状钉死**：grounded-sam2-backend 的 `(SAM_VARIANT, DINO_VARIANT)` 组合在容器启动时由 env 锁死（`apps/grounded-sam2-backend/main.py:43-44` 读 env，`predictor.py:50-58` 选 checkpoint，`lifespan` 一次性 build 占住显存），运行期不可变；改变体 = 改 env + rebuild + 重启。注册端 `MLBackendCreate` 也只接 `name` / `url` / `extra_params`（`apps/api/app/schemas/ml_backend.py:28-34`），平台**不知道**某条 ml_backends 行对应哪个变体，只能从 `health_meta.model_version` 字符串反解。
  - **目标**：把"变体"提升为注册时一等参数，让平台获得变体维度的认知（路由 / mismatch 校验 / AB 对比 UI 全靠这个），并为后续显存吃紧场景的 model pool 留好升级路径。
  - ---
  - **阶段 1 · C — 注册时声明 + 后端按声明常驻**（**~2-3d**，先做）
    - **容器拓扑**：仍是「一变体一容器」（与现状一致），predictor / lifespan / Dockerfile **零改动**。
    - **compose 改造**：`grounded-sam2-backend` 拆成按变体细分的 service（`gsam2-tiny` / `gsam2-large` / ...），各自带独立 profile（如 `gpu-tiny` / `gpu-large`）和端口。dev 默认不启，生产按显存预算 `--profile` opt-in。
    - **schema 改造**：`MLBackendCreate.extra_params` 收口 `variant: {sam: tiny|small|base|large, dino: T|B}` 字段（用 Pydantic 子模型而非裸 dict，便于 codegen 派生前端类型）。`MLBackendOut` 同步暴露。
    - **UI 改造**：`apps/web/src/pages/ModelMarket/RegisteredBackendsTab.tsx` 创建表单加 variant 下拉（按 backend 类型动态枚举：grounded-sam2 显示 SAM × DINO 组合，sam3 显示单档）；列表行加 variant chip。
    - **mismatch 校验**：`services/ml_backend.check_health` 比对声明 variant 和 `/health.model_version` 子串，不一致时 `state=mismatch` + `error_message` 提示 ops 同步 ml_backends 行或 compose env。
    - **运维侧**：`docs-site/dev/deploy.md` 加「按需启动 + 显存预算」章节（每变体 ~3-7GB 常驻 + embedding cache buffer，列预设组合表：4060 起 1 个 / 3090 起 2 个 / A100 全起）。
    - **不做**：predictor 抽象 / model pool / 请求级 variant 切换 / ProjectSettings 路由 UI（路由 UI 跟 v0.10.x M1 sam3 路由共做，避免二次破窗）。
    - **验收**：① ProjectSettings 注册 grounded-sam2-tiny + grounded-sam2-large 两条；② 健康检查 mismatch 用例（手动改 compose env 不改 ml_backends）能告警；③ `/model-market` 列表带 variant chip 渲染；④ AB 对比 UI（v0.10.2）能直接读 `extra_params.variant` 选 backend。
  - ---
  - **阶段 2 · B — 单容器 model pool（运行期热切换）**（**触发后再做，估 ~5-7d**）
    - **触发条件**（任一）：① 客户硬件预算线上一台 GPU 想跑 ≥ 3 个变体且显存吃紧；② 集群场景出现"变体频繁切换"真实工况（运营反馈 / Prometheus 看 ml_backends 切换率）；③ v0.10.x sam3 + grounded-sam2 双 backend 跑稳后，发现"同 backend 内多变体并存"仍是高频需求。**触发前不动手**，避免过度工程。
    - **实现要点**：
      - predictor 抽象出 `ModelPool`（LRU cap 由 env 配置，按显存档位预设：3090 cap=1~2，A100 cap=2~4）。
      - `/predict` 接受 `variant` 参数（header 优先，fallback 到 `extra_params.variant`），命中走原路径，miss 触发驱逐 + build（1-3s 冷启）。
      - per-variant 异步锁，防并发请求同时触发同一 variant build；pool 满 + 多 variant 并发 miss → 排队 + 超时降级。
      - `embedding_cache.py` 按 variant 分桶（不同模型的 embedding 不能跨）。
      - `/health` 暴露 pool 状态（`loaded_variants` / `evict_count` / 每 variant LRU 时间戳），`/admin/ml-integrations/overview` 渲染。
    - **C → B 平滑迁移**：阶段 1 的 `extra_params.variant` 字段语义保持兼容 —— C 时是「这条 ml_backends 行映射的容器装的变体」，B 时是「请求该 backend 时默认带的 variant 参数」。前端 / 协议无破坏性改动。多容器 → 单容器是 ops 决策（compose profile 切换 + 把多条 ml_backends 行的 URL 合并到同一端口），平台层不强制。
    - **不做**：自动 pool sizing（按工作集自动调 cap）/ 跨容器 pool 共享（k8s sidecar 模式）—— 留 v0.11+。
  - ---
  - **触发与排序**：
    - 阶段 1（C）跟「v0.10.x M0 sam3-backend 容器化」(`ROADMAP/0.10.x.md` v0.10.0) 同窗口起，理由：sam3-backend 落地时 ml_backends 的 variant 维度本来就要加（sam3 vs grounded-sam2 各自有变体枚举），合并改 schema 一次到位。
    - 模型市场二期 ① AB 路由 UI（v0.10.2）依赖阶段 1 的 variant 字段，**强依赖**。
    - 阶段 2（B）独立触发，与 v0.11+ 视频 / Active Learning 节奏解耦。
  - **影响面**（阶段 1）：`apps/api/app/schemas/ml_backend.py`、`apps/api/app/services/ml_backend.py`（health 校验）、`apps/web/src/pages/ModelMarket/RegisteredBackendsTab.tsx`、`docker-compose.yml`、`docs-site/dev/ml-backend-protocol.md`、`docs-site/dev/deploy.md`。**不动**：predictor.py / main.py / lifespan / embedding_cache。
- **训练队列**：路由 `/training` 占位。等数据集 snapshot + 主动学习闭环成熟一并做。
- **ML backend storage endpoint 选择机制（生产化）**（**P3**）：dev `ML_BACKEND_STORAGE_HOST` + ADR-0012 框架已收口；生产场景多变, 第一个生产部署遇到再扩策略表（"何时设、设啥值、何时留空"）。

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
- **CSP `style-src` nonce 收紧**（v0.9.11 已收紧 script-src）：剩 style-src `'unsafe-inline'`，前置依赖**全站 ~2600 处 `style={{}}` 重构**（迁 CSS modules / vanilla-extract），切入点选 inline style 密度最高的 `pages/Projects/sections/` 群（`BatchesSection.tsx` 948 行 / `GeneralSection.tsx` 433 行 / `DatasetsSection.tsx` 395 行）。

### 治理 / 合规
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

### 可观测性
- **Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest**：v0.6.9 闭环 + 通知已落，剩 LLM SDK + SMTP 链路；`bug_reports` 加 `cluster_id` / `llm_distance`；与通知偏好（按 type 静音）协同。

### 性能 / 扩展
- **Annotation 列表前端切换 keyset 分页**：v0.7.6 已落后端新端点 `GET /tasks/{id}/annotations/page?limit&cursor` + 复合索引；前端 `useAnnotations` 仍用旧数组端点（cap=2000），改 useInfiniteQuery 推迟到 1000+ 框监控触发。
- **Predictions 表分区**：v0.7.6 已落 Stage 1（`ix_predictions_created_at` 索引）+ ADR-0006 设计 Stage 2 完整 RANGE(created_at) 月分区。Stage 2 触发条件：单月 INSERT > 100k 或 总行数 > 1M（FK 复合化代价 + annotations 表迁移成本）。

### 测试 / 开发体验
- **前端单元测试 — 页面级覆盖**：vitest + MSW 基座 v0.7.4；v0.8.5 推到 25.28% / 阈值 25；v0.8.7 因引入 8 个新组件回退到 22.04% / 阈值临时降到 22；**v0.8.8 推回 25.17% / 阈值 25**（5 个新 test 文件 ~35 case：turnstile / useCanvasDraftPersistence / RejectReasonModal / FailedPredictionsPage / useNotificationSocket / AnnotationHistoryTimeline）。下阶段目标 25→30：补 `pages/Projects/sections/BatchesSection`（948 行）/ `GeneralSection`（433 行）/ `DatasetsSection`（395 行）/ `AuditPage` / `WorkbenchShell` 关键 hook（`ProjectSettingsPage` shell 自身 v0.9.x 已拆到 181 行，无业务逻辑可测）。
- **size-limit / scripts 脚本测试**：v0.8.8 加的 `apps/web/scripts/check-bundle-size.mjs` 自实现 glob match + 单位解析，目前无单测；如未来加更多 build-time 脚本，建议给该目录建独立 vitest 项目（不算主分母覆盖率）。
- **uvicorn `--reload` + 长 WS = reload 卡死（P3 dev experience）**：如再发，考虑加 `--timeout-graceful-shutdown 5` 兜底。
- **vite proxy `/ws` 多并发偶发 CONNECTING 卡死（P3 dev experience）**：dev 直连 `localhost:8000` 绕法保留；根因待追，必要时给 vite 上游提 minimal repro。

### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **无障碍**：ARIA 属性极少；Lighthouse Accessibility 分数应作为 PR gate。

### 文档

- **首次登录引导（onboarding）**：用户手册有文档但工作台无 UI walkthrough；新用户进 `/projects/:id/annotate` 时左下浮出一条「画框：拖鼠标；提交：E」级别的 3 步 tooltip + 右上 ✕ 关闭一次性写 localStorage `wb:onboarded:v1`。优先级 P3，等首次客户上线反馈触发。

---

## C · 标注工作台专项优化（性能 / 界面 / 标注体验）

> 横向参考：CVAT（Konva + 关键帧 + 骨架）、Label Studio（interactive ML backend）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量检测）。

### C.1 渲染性能 / 大图大量框
- **大图 tile / 多边形 LOD / 双图比对**：已合并到 [图片工作台优化 epic](ROADMAP/2026-05-12-image-workbench-optimization.md)（I1 / I2 / I5）。极大图场景才必要。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。`useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。

### C.3 标注体验（核心生产力杠杆）
- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90%；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式）。
- **关键帧插值（视频/序列）**：CVAT 同款；标注员只标 1 / 30 / 60 帧，中间线性插值。需配合 `Task.dimension` 字段。
- **类别确认 hint**：刚画完一个框时，AI 后台跑一次单框分类，右上角弹「建议：标识牌（92%）」+ 一键采纳。
- **Magic Box / Snap**：粗略画一个大框 → AI 收紧到对象边缘（SAM 推 mask → 取 mask bbox）；同时支持「贴边吸附」。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **`U` 键准确度升级**：v0.5.2 用启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）。

### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> 决策：**单工作台外壳 + Mode Hooks + StageHost + 按类型独立 action hooks**（M6 已归档）。不要把图片、视频、3D 强行统一成同一个 geometry editor。

- **Layer 1 · 工作台外壳（`<WorkbenchShell>`）**：路由 `/projects/:id/annotate` / review mode、任务队列、Topbar、右栏、状态栏、history、offline、hotkeys。Shell 只做装配。
- **Layer 2 · 模式策略（`modes/`）**：`useAnnotateMode` / `useReviewMode` 注入提交、跳过、领取审核、通过 / 退回、diffMode 与横幅策略；不拆 `AnnotateWorkbench` / `ReviewWorkbench` 两套页面。
- **Layer 3 · Stage 分派（`WorkbenchStageHost` + `stages/types.ts`）**：
  - `ImageWorkbench`：包装 `ImageStage`，承接 image bbox / polygon / SAM / canvas / AI 候选。
  - `VideoWorkbench`：包装 `VideoStage`，承接 video bbox / track / keyframe / timeline。
  - `ThreeDWorkbench.placeholder`：仅占位，不接真实 3D 业务。
- **Layer 4 · Stage-specific actions**：`stages/image/useImageAnnotationActions.ts` 与 `stages/video/useVideoAnnotationActions.ts` 各自维护 payload、optimistic edit、offline fallback 和 focused tests。
- **后续触发条件**：真实 lidar / 3D 标注需求出现时，先设计 `LidarStage` / 3D geometry / camera controls；只复用 `StageKind` / `StageCapabilities` / `WorkbenchStageHost` 外围边界。

---

## 优先级建议（参考）

> 已完成的项不再列出，参考 [docs/changelogs/](docs/changelogs/)。下面只是当前 open 的优先级。

| 优先级 | 候选项 | 触发 / 理由 | Related ADR |
|---|---|---|---|
| **P0/P1** | 视频标注工作台综合 epic | V4-V6 功能尾巴 + R1-R12 渲染优化 + R13-R24 CVAT 视频深度借鉴（Chapter / Track Split-Merge-Join / MOT 导出 / frameStep / Job overlap / Tracker Registry / MOTA-IDF1） → [详见](ROADMAP/2026-05-12-video-workbench-rendering-optimization.md) | — |
| **P1** | 视频后端帧服务（B1-B7） | 前端 R5.3 / R10 / R11 / R20 / R21 / R23 的服务端依赖 → [详见](ROADMAP/2026-05-12-video-backend-frame-service.md) | — |
| **P2** | 图片工作台优化（I1-I21） | 渲染（大图 tile / LOD / 双图比对）+ 能力扩展（Ellipse / Skeleton / Mask 编辑器 / Object Group / Attribute / Issue / GT-IAA / Interactor） → [详见](ROADMAP/2026-05-12-image-workbench-optimization.md) | [0004](docs/adr/0004-canvas-stack-konva.md) |
| **P3** | `/ai-pre` 精细单批次预标 modal（v0.9.13 后回归） | v0.9.12 IA 重构 + v0.9.13 chips/threshold UI 已搬到 ProjectDetailPanel；4 个 stepper 子组件 (`PreannotateStepper` / `ProjectBatchPicker` / `RunPanel` / `usePreannotateDraft`) 仍 orphan，客户场景需要单 batch 精细调（草稿恢复 / 阶段进度可视化）时唤起 modal 复用旧组件；如反馈不需要再删 orphan 文件 | — |
| **P3** | ImageStage Konva sceneFunc + evenodd 镂空渲染（v0.9.14 协议 + transforms 已就位） | v0.9.14 后端 `MultiPolygonGeometry` + 前端 `AIBox.holes` / `multiPolygon` 字段已落, ImageStage `<Line>` 渲染层暂取主外环降级；触发 = 客户反馈「donut 类对象渲染少了内圈」或 v0.10.x sam3 多连通域占比 > 30%, 与 sam3-backend 接入同窗口做避免二次破窗 | [0013](docs/adr/0013-mask-to-polygon-server-side.md) |
| **P2** | 邮箱验证（开放注册角色提升前置） | 当前 viewer 零权限可跳过；角色调高时必备 | — |
| **P2** | OAuth2 / 社交登录（Google / GitHub SSO） | 降低注册门槛，企业场景 SSO；客户驱动 | — |
| **P2** | Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest | v0.7.0 通知偏好基础静音已落，邮件 channel 字段就位但 UI 未启 | — |
| **P2** | 非视频工作台（image-seg → keypoint → lidar） | 体量大，视频工作台已单独提升为 P0 | — |
| **P2** | C.3 marquee / 关键帧 / 会话级标注辅助 | 业务复杂度起来后必需 | — |
| **P2** | 批次状态机二阶段：`annotating → active` 暂停（实施 ADR-0008） + bulk-approve / bulk-reject | ADR-0008 已 Proposed；实施前补 scheduler 测试覆盖；bulk approve/reject UX 待定 | [0008](docs/adr/0008-batch-admin-locked-status.md) |
| **P3** | CSP `style-src` nonce 收紧（v0.9.11 已收紧 script-src） | `style-src 'unsafe-inline'` 仍保留, 前置依赖全站 ~2600 处 `style={{}}` 迁 CSS modules（切入点 `pages/Projects/sections/` 群）, 与 v0.10.x ProjectSettingsPage 重构同窗口 | [0010](docs/adr/0010-security-headers-middleware.md) |
| **P3** | 截图 fixture 数据补齐 + 重跑（v0.9.7 19 张已 commit, 4 张空白态需补 seed） | seed.py 加 prepare 钩子: 5+ pre_annotated 批次 / 类别无 alias 项目 / 同 task 双 prediction (IoU) / 30+ tasks (bulk-edit) | — |
| **P3** | predictions 月分区 Stage 2 完整迁移 | ADR-0006；触发条件单月 INSERT > 100k 或 总行数 > 1M | [0006](docs/adr/0006-predictions-partition-by-month.md) |
| **P3** | projects.batch_summary stored 列 | v0.7.6 评估后推迟；触发点 8 处维护成本高，当前 GROUP BY 性能未到瓶颈 | — |
| **P3** | 前端单测从 30 推到 35 | v0.9.14 实测 30.30%；下阶段补 `BatchesSection` 完整交互（创建/bulk/逆向迁移/看板）+ `WorkbenchShell` 关键 hook + `useBatchEventsSocket` 端到端 | — |
| **P3** | PerfHud 浏览器侧指标扩展（FPS / JS heap / longtask / API p95 / WS 重连数 / task 框数） | v0.9.11 落地 GPU MVP 后, 浏览器侧指标延期到 §C.1 keyset 分页拐点判断时一并加；当前后端视角 GPU/容器指标已足够排预标卡顿/OOM | — |
| **P3** | 首次登录 UI walkthrough（onboarding tooltip） | 新客户上线前低优；客户反馈触发再做 | — |
| **P3** | i18n、2FA | 客户具体需求驱动（SSO 已单独提升到 P2） | — |
| **P3** | C.3 SAM 后续延伸：Magic Box、类别确认 hint | 依赖 SAM 基座 | — |
| **P3** | ML backend storage endpoint 选择机制（生产化） | v0.9.4 phase 1 用 `ML_BACKEND_STORAGE_HOST` 简单覆盖适合 dev + ADR-0012 已写决策框架；生产场景多变，第一个生产部署遇到再扩 ADR 策略表 | [0012](docs/adr/0012-sam-backend-as-independent-gpu-service.md) |
| **P3** | 审计日志冷数据物化触发 | v0.8.1 partition + Celery beat archive 已就位；当前数据量未到 1M 行 | [0007](docs/adr/0007-audit-log-partitioning.md) |
| **P3** | Workbench Shell 拆分后续精简 | M6 已归档并确认不拆两套页面；后续只做 prop 分组、Host/Layout focused tests、必要时 `useWorkbenchShellModel`，真实 3D 前不抽通用 geometry / camera controls | [0017](docs/adr/0017-workbench-shell-mode-and-stage-adapters.md) |

---

## 优化建议 / 文档维护备忘

> 这一节记录"对 ROADMAP 自身格式"的维护方向，避免文件无限膨胀。每个 epic 结束后应配套精简，把完成内容移到 CHANGELOG / changelog 分卷。

1. **「后续观察项」滚动归档**：§A 末尾当前 3/5 条；超过 5 条时拆出 `ROADMAP/observations.md`。
2. **触发条件量化**：「监控触发」类条目（predictions Stage 2 / batch_summary stored 列）目前文字描述；条件成熟后可在 Grafana dashboard 加阈值 panel + 告警，跨过即生 issue。仍未执行（依赖 Grafana 优先级）。
3. **epic 收尾同步精简 §A/§C**：每次版本收尾配套删 §A / §C 已落项 + 在该 epic 后写 1 段「落地后新发现」补到优先级表，避免 ROADMAP 与 CHANGELOG 双源真相漂移。已成为约定.
4. **ADR 引用列回填**：每次新增 ADR 时 grep 优先级表对应行加链接。
