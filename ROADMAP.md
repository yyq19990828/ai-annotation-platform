# 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本详情见 [CHANGELOG.md](./CHANGELOG.md) 与 [docs/changelogs/](docs/changelogs/)；本文件只保留尚未完成或仍需触发的事项。

---

## 即将到来（按版本切片的详细计划）

> 大颗粒 epic 拆到独立文档；下面 §A/§B/§C 仍维护单条颗粒度的待办。

### 计划中

- **[长期规划（12 个月以外）](./ROADMAP/2026-05-12-long-term-strategy.md)**：L1-L15 战略方向盘点。数据中台 / 主动学习闭环 / 模型评估 / 跨模态 / 协同与众包 / 插件机制 / 公开 SDK / 合规认证 / 移动端 / 端侧推理 / 合成数据 / SaaS / 可观测性 / i18n / AI 审计。**当前 P0/P1 完成前不开工**。
- **[CVAT / Label Studio 取经合集（2026-05-18）](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md)**：跨主题对标盘点研究档。Webhook 完整形态 / 公开 SDK / Annotation Guide / AnnotationFeedback 收敛 / Consensus 拆分 / async_jobs 统一 / LLM-as-Judge / 平台原生 AAP JSON 等。**性质：研究输入**，按颗粒度逐步回流到 §A/§B/§C。当前已回流：决策底线表。


---

## 当前焦点（按"何时触发"分组）

> 优先级表（§ 末尾）按价值/成本排序；本节按**触发条件**重组，一眼看清"现在能做什么 / 等什么再做"。

### 现在可做（无前置依赖，作为 `chip:maintenance` 穿插推进，不抢 v0.10.x 主线）

- **OpenSeadragon 瓦片金字塔**（见 §C.7 图片工作台 · I1 大图 tile；极大图 > 50MP 才必要）
- **i18n 框架接入**（P3，v0.10.11 已为 sections 群建 CSS modules 试点；i18n 可在迁 inline style 同窗口合并破窗，密度最高的 `pages/Projects/sections/` 仍是首选切入点）
- **WorkbenchStageHostProps 类型嵌套重构 (call-site 改造)**（P3，v0.10.18 后续维护项）：v0.10.18 已加 JSDoc 分组注释 (common / video / image / ai / editors) 但类型仍平铺以兼容 WorkbenchShell 1210 行 call site；后续若 Shell 再次膨胀超过 900 行触发线，把 props 改为嵌套对象形态 `{ common: {...}, image?: {...}, video?: {...}, ai?: {...}, editors?: {...} }` 同时改造 call site，分组注释已就位作切分参考。
- **`useWorkbenchShellModel` 装配 hook**（P3，触发条件）：WorkbenchShell 仍 1210 行；触发条件 Shell 再次超过 900 行（v0.10.18 后续观察）。

### 等业务规模 / 监控触发（先观察、不做）
- **审计日志归档物化视图**：partition + archive + 冷数据回源（`/audit-logs/archives`）已落（v0.10.25）；剩月度汇总 BI 物化视图，等 10M+ 行触发。
- **OAuth2 / SSO**：等具体客户驱动（企业场景需求触发再做）

### 等独立 epic（体量大、不适合塞进收尾版）
- **视频工作台（功能 + 渲染 + 后端）三联**：见 §C.5（前端）与 §C.6（后端）；原 epic 文档已归档。
- **lidar 真实 3D 工作台**（C.4 Layer 2 触发;v0.10.17 已收 image-seg → region tool_unit,v0.10.28 已落 polyline / rotated_bbox / keypoint(COCO 骨骼),真正的独立 epic 只剩 lidar 3D 部分;图片侧形状能力扩展见 §C.7）
- **大文件分片上传**（>5GB 视频 / 点云）
- **数据集版本 snapshot + 主动学习闭环**（与训练队列一起做，长期规划 L1 / L2）
- **2FA / TOTP**（super_admin 必选 / 其它角色可选）
- **批次状态机二阶段：admin-locked + bulk-approve / bulk-reject**（ADR-0008 Proposed → 实施前补 scheduler 测试覆盖）
- **长期方向**：见 [`ROADMAP/2026-05-12-long-term-strategy.md`](ROADMAP/2026-05-12-long-term-strategy.md)（数据中台、主动学习、合规认证、跨模态等 15 个方向）。

---

## A · 代码观察到的硬占位 / 残留 mock

### 项目模块
- **3D / 视频多模态工作台**（v0.10.17 已把项目"类型"从 7 种 type_key 收敛到「image / video / lidar 三种数据载体 + 工具集多选」形态,详见 [ADR-0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md)）:
  - `lidar` 在 Workbench StageHost 仍是 3D placeholder,Dashboard 入口未开放,`tool_unit=lidar_box_3d` 留位置灰;接入真实 3D 前不要复用图片 / 视频 geometry。
  - `video-mm` / `mm` 多模态工作台未实现;视频侧能力详见 §C.5 / §C.6。
- **v0.10.17 落地后开放项**（按客户反馈触发）:
  - **`lidar_box_3d` 工具实现**（**P0**,体量大）:见上条 3D 工作台;依赖 3D viewer + 后端 frame service 视点处理。独立 epic,与长期 L3 跨模态挂钩。
  - **跨 tool_unit 类别软关联 (`alias_to`)**（**P3**）:v0.10.17 强隔离意味"bbox 工具的人 / region 工具的人是两条独立记录",同名颜色 / alias 都得重复输入;触发条件:客户后续反馈"想共享类别名字"。设计走 `ToolClassEntry.alias_to: { tool_unit_id, class_name } | null` 链,导出时按 alias_to 合并 categories(可选)。**强隔离决策为默认底线,alias_to 仅作可选叠加**,不破坏 ADR-0026 决策。

  - **rename_class 端点跨 unit 重命名 UX**（**P3**）:v0.10.17 `useRenameClass` 加了 `tool_unit_id` 参数,但 ClassesSection 仅传当前 active unit;若客户想"同时在所有 unit 内把'人'改成'pedestrian'"需要扩 UI 入口(批量勾选 unit + 单次重命名)。触发条件:客户反馈"重命名要跑 N 次"。
- **v0.10.28 新几何导出/导入/预测支持**（三种新几何 rotated_bbox / polyline / keypoint 落地后新发现，端到端绘制 + 持久化已通，但与外部格式 / 模型协议的对接仍缺口）:
  - **导出协议覆盖新几何**（**P2**，客户用了新工具就会立刻撞上）:`export.py` / `export_packaging.py` 当前只导 bbox / polygon / mask;rotated_bbox / polyline / keypoint **没有 COCO / YOLO / VOC 映射**(rotated_bbox→COCO 无原生表示需选 OBB 扩展或 segmentation 退化;keypoint→COCO `keypoints` 数组 + `skeleton`;polyline→无标准格式需走平台原生 AAP JSON)。触发条件:任一新工具的项目走到导出环节。设计先补 AAP JSON(平台原生无损)再按客户要的标准格式逐个加。
  - **predictions import / AAP JSON 适配新几何**（**P3**）:[`internal_geometry_to_ls_shape`](apps/api/app/services/predictions_import.py) 仍只覆盖 bbox / polygon / multi_polygon,rotated_bbox / polyline / keypoint 进 errors[]。与 §A「AAP JSON video_track 导入支持」同窗口做。
  - **ML backend 输出新几何**（**P3**）:`prediction.py` 的 LS shape 适配把 `keypointlabels` / `linelabels` 当前**归 bbox 占位**;真正让外部模型预测 rotated_bbox / polyline / keypoint 需要补 `to_internal_shape` 分支 + ML backend 协议侧约定。触发条件:有支持这些输出的模型接入。
- **Annotation Guide 配套延伸**（v0.10.13 之后开放项，按客户反馈触发）：
  - **guide_assets 跨项目 deepcopy（Stage 2）**（**P3**）：v0.10.13 复制 / v0.10.14 模板都让 storage key 共享或干脆不携带 assets，源项目删 asset 会让依赖项目失效。触发条件：客户大量在 guide 中用图（首版人均 ≥ 5 张）且明确反馈需要"应用模板时复制图片到新项目独立 namespace"。实现走 Celery worker 异步 deepcopy storage 对象到新项目 prefix + 重写 markdown 中的 `guide-asset:KEY` 引用。
  - **guide_assets orphan GC**（**P3**）：当前 `PATCH /projects/{id}` 改 `annotation_guide` 时不清理 markdown 中已不被引用的 asset；UI 留「清理未引用资源」按钮口子但未实现。触发条件：客户反馈 storage 占用异常或单项目 guide_assets 数量超 50。
  - **工作台 guide 浮层适配视频 / 多模态**（**P3**）：当前 `GuidePanel` 仅在 image 工作台试过；video / 3D 工作台 layout 不同，浮层定位需要单独适配。触发条件：video 项目第一次配 annotation_guide。
  - **CodeMirror 6 bundle 监控**（**P3**）：当前 lazy-import 把 `~180-220 KB gzipped` 放在 ProjectSettings 路由；如果后续把指引编辑挪到工作台内（取消"只能回设置页改"约束），需要重新评估 bundle 切片。当前不动。
  - **annotation_guide LLM 校验**（**P3**）：参考 [取经合集 §5.1](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#51-llm-as-judge--prompts-模块) LLM-as-Judge，标注员 reject 时附带"指引第 N 段对应规则"。依赖 LLM SDK 接入窗口。
- **项目模板 v0.10.14 之后开放项**（按客户反馈触发）：
  - **模板版本号 / changelog**（**P3**）：当前 PATCH 直接覆盖模板字段，多人协作 / 长期演进时无审计轨迹。触发条件：公共模板出现 ≥ 2 次"被某管理员误改后投诉"或 organization 模板数量超 20。设计走 `project_templates_versions` 表追加快照 + UI 给「比较版本」按钮。
  - **organization admin 提交 public 模板审核流**（**P3**）：当前仅 super_admin 可建 public，组织管理员"看到好模板想推到全平台"必须找超管手动改 scope。触发条件：跨组织 SaaS 场景 / 公共模板数 ≥ 10。设计走 `template_publish_requests` 队列，超管 review 通过后 scope 升级。
  - **模板 usage 统计页**（**P3**）：当前 `usage_count` 只在卡片露一个数字；缺"哪些项目用了这个模板 / 平均使用间隔 / 跨组织传播路径"等运营信号。触发条件：公共模板数 ≥ 5 后超管想看治理数据。可与 [§4.1 Annotator Performance Dashboard](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#41-annotator-performance-dashboard) 同窗口做。
  - **AAP JSON 支持模板携带**（**P3**）：[取经合集 §2.6](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#26-平台原生-task-json-格式aap-json) AAP JSON 是项目级快照格式；后续应把 ProjectTemplate 也加进 `manifest.json`，让"导出 → 跨实例 → 导入即得模板"工作流闭环。与 AAP JSON epic 同窗口做。
  - **模板审计专项 detail**（**P3**）：当前模板 CUD 走默认 AuditMiddleware；如果 organization / public 模板发生 misuse，标准 detail（http body）不够定位。触发条件：审计期反馈模板侧 detail 不足。设计在 `app/services/audit.py` 加 `template_detail()` helper 派生 audit detail。

### 数据 & 存储
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。
- **批次相关延伸**：① 智能切批（按难度/类别/不确定度）；② 批次级 IAA / 共识合并算法；③ 不可变训练快照 + 主动学习闭环。调研报告 [docs/research/12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md)。
- **批次状态机增补 · 二阶段**（v0.7.3 已收 3 条 owner 逆向迁移 + 4 项多选批量；v0.7.6 已收 reset → draft 终极重置；以下为延后项）：
  - `annotating → active` 暂停：项目临时叫停。**难点**：调度器（`scheduler.check_auto_transitions`）一旦看到 `in_progress` task 就会立刻把 batch 推回 `annotating`，需要同时把 in_progress task 复位到 pending（释放标注员锁）+ 引入 batch 级「admin-locked」标志阻断调度器；ADR-0008 已 Proposed 但未实施。
  - 批量状态迁移类（bulk-approve / bulk-reject）：v0.7.3 故意未做。reject 反馈是逐批次语义、approve 跳过逐批次审视有质检失职风险。落地前先讨论 UX。

### AI / 模型
- **模型市场扩展 — 二期剩余 defer 项**：加权 AB 路由（按 task 自动分流打标，需路由配置 + 结果打标协议）、同输入双变体并排对比（工作台级独立 epic）、带 token 的观测容器（当前 observe URL 假定免鉴权）。触发条件按客户驱动。
- **Predictions Import / AAP JSON 后续延伸**（v0.10.15 之后开放项，按客户反馈触发）：
  - **`POST /annotations/import` 端点**（**P3**）：v0.10.15 AAP JSON `annotations[]` 字段当前仅导出可用，导入端只警告日志不入库。涉及 batch/owner/audit 协议复杂度；触发条件：客户反馈"导出 AAP JSON 后无法在另一实例完整重建标注"。设计要点：① 入库 annotation 行需要回写 `user_id` / `source` / `was_cancelled` / `ground_truth` 等元数据；② batch_id 解析需要类似 `task_match` 的 `batch_match` 字段（display_id 优先）；③ 是否走 audit log 需要 ADR 决策。
  - **Task 表加 `external_id` 字段**（**P3**）：v0.10.15 用 display_id + file_path 两元组匹配够用；触发条件：客户跨实例迁移时改 display_id 或文件路径（"重命名也想保稳定 ID"）。设计走 `tasks.external_id String(100) UNIQUE(project_id, external_id)` + AAP JSON `task_match.external_id` 已预留字段直接生效（[`AAPTaskMatch`](apps/api/app/schemas/aap_json.py) 已留 forward compat）。同时给 `predictions` / `annotations` 也加 `external_id` 派生窗口。
  - **ProjectTemplate 进 AAP JSON manifest**（**P3**）：[取经合集 §2.6](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#26-平台原生-task-json-格式aap-json) AAP JSON 是项目级快照格式；后续应把 ProjectTemplate 也加进 envelope 末层（与 §A「项目模板 § AAP JSON 支持模板携带」同条条目），让"导出 → 跨实例 → 导入即得模板"工作流闭环。与公开 SDK epic 同窗口做。
  - **COCO importer image_size_hint 参数化**（**P3**）：当前 [`import_coco`](apps/api/app/services/predictions_import.py) 强制要求 `images[i].width/height` 非零，缺失时整条 entry 进 errors[]。触发条件：客户上传"裸 annotations"（无 images metadata，只有 file_name）。设计：UI Wizard 可选填"全局图像尺寸 hint"作 fallback，预填到 `image_size_hint` 参数。
  - **AAP JSON 单 prediction 多 shape**（**P3**）：当前每个 `predictions[i]` 对应**一条** Prediction 行（单 shape）；与 ML backend 内部协议（一个 prediction 行可携带 N 个 shape）不一致。触发条件：客户希望"一个外部模型一次推理出来的所有框作为同一 prediction 单元，便于整体采纳/驳回"。设计：把 envelope `predictions[i]` 加可选 `shapes[]` 数组，与现有 flat `geometry/class_name` 同源（二选一，flat 兼容旧 schema）。schema 已在 v0.10.17 升 minor `1.1`（带 `tool_unit_id` / `tool_bindings`）；多 shape 仍待客户驱动。
  - **AAP JSON video_track 导入支持**（**P3**）：当前 `internal_geometry_to_ls_shape` 适配器仅覆盖 bbox / polygon / multi_polygon；video_bbox / video_track / skeleton 进 errors[]。触发条件：视频项目客户首次反馈"想把外部 tracker 结果灌进平台"。与 §C.5 R9 / R23 同窗口做。v0.10.17 schema_version 1.1 envelope 已带 `tool_unit_id`,新增 `video_track_bbox` / `video_track` tool_unit 时实现端接通即可。
  - **`predictions_import` 审计 detail 专项**（**P3**）：当前 audit log `detail_json` 含 imported/skipped/error_count；缺"哪些 task 被命中 / 哪些 model_version / 文件大小 hash"等取证字段。触发条件：审计期反馈 detail 不足以定位"哪批外部模型结果先被导入又被撤回"。设计在 `app/services/audit.py` 加 `predictions_import_detail()` helper.
- **变体热切换后续延伸**（v0.10.23 之后开放项，按需触发）：
  - **`/setup.supported_variants` 富元数据**（**P3**）：当前变体选项来源是 `/setup.params` 的 `sam_variant`/`dino_variant` enum（纯字符串）；原需求 §3 设想的 `supported_variants` 数组（携带每变体显存占用 / 推荐档 / labels）未做。触发条件：模型市场二期 AB 路由 UI 需要按变体展示「显存 7GB / 精度高」等元数据时再扩。
  - **grounded-sam2-backend lint 债**（**P3 maintenance**）：包内 `ruff check .` 仍有 ~179 报错（多为 vendor / 历史遗留，本期改动文件已全过）；触发条件：给该包加 CI lint gate 前需先清债或显式 exclude vendor。
- **项目多后端绑定 + 按后端参数面板（重设计，未排期）**（**P2**）：当前一个项目只绑定单一 ML backend；未来支持项目绑定多个后端、预标注时选择用哪个跑，每个后端可调参数不同。基础设施已就位——工作台 AI 面板按所绑定后端 `/setup.params` 动态渲染参数（`SchemaForm`/`AIInspectorPanel`），用户级偏好已按 backend id 分桶存储（`User.preferences.ai.params_by_backend`），多用户互不影响。重设计要点：项目侧 `ml_backend_id` 单值 → 多值/默认值 + 预标注入口加后端选择器；批量预标注页（`ProjectDetailPanel`）的项目级 DINO 阈值是否一并收口到「按后端动态」也在此窗口决策。触发：客户需要同项目多模型并存 / 切换时。**本期不做。**
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

- **getting-started 与 SoT 漂移**：文档站硬编码快捷键如再漂移可考虑给 .md 内联 `` `<键>` `` 建一份从 hotkeys.ts 推导的 ESLint/markdownlint 规则；优先级低，等漂移触发.

---

## B · 架构 & 治理向前演进

### 安全
- **2FA / TOTP**：super_admin 必选、其它角色可选。

### 治理 / 合规
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

### 可观测性
- **Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest**：v0.6.9 闭环 + 通知已落，剩 LLM SDK + SMTP 链路；`bug_reports` 加 `cluster_id` / `llm_distance`；与通知偏好（按 type 静音）协同。

### 性能 / 扩展
- **Annotation 列表前端切换 keyset 分页**：v0.7.6 已落后端新端点 `GET /tasks/{id}/annotations/page?limit&cursor` + 复合索引；前端 `useAnnotations` 仍用旧数组端点（cap=2000），改 useInfiniteQuery 推迟到 1000+ 框监控触发。
- **Predictions 表分区生产执行**：Stage 1 + Stage 2 迁移（0080）均已落（dev 已应用，v0.10.25）；生产侧按阈值（单月 INSERT > 100k 或总行数 > 1M）执行 `alembic upgrade` 即可，迁移已 battle-tested。

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
- **大图 tile / 多边形 LOD / 双图比对**：多边形 LOD（I2）已落 v0.10.4；大图 tile（I1）与双图比对（I5）见 §C.7。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。`useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。

### C.3 标注体验（核心生产力杠杆）
- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90%；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式）。
- **关键帧插值（视频/序列）**：CVAT 同款；标注员只标 1 / 30 / 60 帧，中间线性插值。需配合 `Task.dimension` 字段。
- **类别确认 hint**：刚画完一个框时，AI 后台跑一次单框分类，右上角弹「建议：标识牌（92%）」+ 一键采纳。
- **Snap-to-edge（贴边吸附）**：v0.10.17 已落地 Magic Box（粗框 → SAM 收紧到对象紧凑外接矩形 → 落 bbox）;剩 pixel-level Snap-to-edge（顶点拖动距已有形状边 < 阈值时吸附 / Canny/Sobel 边缘吸附)留 v0.11+。复用 `apps/web/src/pages/Workbench/stage/shared/geometry/polygon.ts:nearestEdge` 做几何吸附;Canny/Sobel 走 WebWorker 实测开销后再决定。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **`U` 键准确度升级**：v0.5.2 用启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）。

### C.5 视频工作台前端剩余（原 `[archived]2026-05-12-video-workbench-rendering-optimization.md` 转录）

> Wave 0-4 已收尾（V4-V6、R1-R10、R13、R17-R19、R5.2、R8 均落地）；以下是 Wave 5-7 剩余。

- **R5.3 WebCodecs chunk decode**：依赖后端帧服务 chunk smart-copy（已 v0.9.38），按真实卡顿数据触发；不上 ffmpeg.wasm / Broadway.js。
- **R9 Polygon / Polyline / Mask Track**：`video_track.geometry.kind` 扩 `bbox` → `polygon | polyline | mask`，旧 bbox track 缺省兼容；按周长 / 长度参数化插值；mask track 依赖 R5.2/R5.3 的 canvas / bitmap 能力；同步 `docs-site/dev/reference/` 与导出协议。
- **R20 frameStep 跳帧标注**：项目级 `frameStep` 配置 → 时间轴 / 方向键按 step 导航；`Shift+←/→` 保留单帧微调；segment overlap 边界按 step 对齐。
- **R16 Track Join (Re-ID)**：tracker 完成后补两段 track 之间的 Re-ID 跳连判定；与 V6 split-merge 共享 UI 模式。
- **R23 Tracker Registry UI**：管理员侧 tracker adapter 注册 / 启停 / 显示当前 backend；与 v0.10.3 ML Backend 1:N 管理形态一致。
- **R11 / R21 长视频协同与 overlap**：segment 切换 UI、单段单人 lock 只读提示、overlap 区 IAA / IDF1 报告；Presence 可选，不做 OT / CRDT。
- **R22 视频专属导出**：MOT 16/17/20 CSV、KITTI Tracking、DAVIS mask 序列；outside / absent / occluded / prediction source 在各格式中的统一映射。YouTube VOS / ImageNet Video 等客户明确需要再做。
- **R24 Track 级质量评估**：MOTA / IDF1 / HOTA worker；时间轴错误定位；与 R21 overlap 和长期 L15 标注质量 AI 审计打通。

### C.6 视频后端帧服务剩余（原 `[archived]2026-05-12-video-backend-frame-service.md` 转录）

> Wave 0-1 已收尾（B1-B7 第一版、B4 segment、B5 tracker job、tracker adapter MVP、SAM video 协议桥、chunk smart-copy）。以下是 Wave 2-6 剩余。

- **P0 真实 SAM 2/3 video backend**：把 v0.9.36 的 `sam2_video` / `sam3_video` 协议桥接到真实模型服务（grounded-sam2 / sam3-backend 实现 `/predict context.type="video_tracker"`），输入 `task.file_path` + `from_frame/to_frame` + `direction` + `prompt` + `source_geometry`，输出逐帧 `{frame_index, geometry, confidence, outside}`；GPU profile 覆盖 30s/30fps、10min、长 segment 分窗；OOM / timeout / backend 5xx 在 `video_tracker_jobs.error_message` 可诊断。**不做**：不把 predictor 加进 `apps/api`（遵循 ADR-0012）。
- **P1 Timetable Compact / Sparse**：长视频按 keyframe + fixed stride 存 sparse timetable（1h 30fps 压缩后 < 500KB），API 保持 `frame_index → pts_ms` 语义；缺口由服务端估算 / 插值；导出与 worker 共用同一 timetable helper。
- **P1 Segment 导出聚合与 Overlap 底座**：`Annotation` 查询 / 导出按 `segment_id` 或 frame range 聚合；跨 segment 合并按 `frame_index` 排序，outside / prediction keyframe 不丢；overlap 区间元数据为前端 R21 / IAA / IDF1 预留。
- **P1 FrameStep / Chapter 后端原语**：项目或任务级 `frameStep` 配置，导出时明确 sampled / interpolated / held frame 来源；`VideoChapter` 元数据扩展；segment 边界按 step 对齐。
- **P1 Chunk warmup**：在 manifest / timeline 预取命中热点 range 时提前投递 media 任务（chunk smart-copy 已落，仅缺 warmup 触发器）。
- **P2 视频专属导出**：MOT 16/17/20 CSV / KITTI Tracking / DAVIS mask 序列后端实现（Video Tracks JSON 作内部稳定格式）。
- **P2 Track 级质量评估 worker**：MOTA / IDF1 / HOTA 评估 worker，按 track / segment / chapter 输出错误定位；与长期 L15 标注质量 AI 审计打通。

### C.7 图片工作台能力扩展剩余（原 `[archived]2026-05-12-image-workbench-optimization.md` 转录）

> Wave α / β / γ / δ 已收尾（I2 / I3 / I6 / I7 / I8 / I11 / I13 / I15 / I16 / I17 / I20 Interactor 类型均落地）。以下是 Wave γ 末段 + Wave ε 剩余。

- **I1 大图 tile**（v0.11.0 独立 epic，**必做**）：>4K 图后端 Celery 切 IIIF / 自定义 tile 金字塔（zoom 0/1/2 ... 每级 512×512 PNG/WebP），元数据 `ImageTilePyramid(image_id, max_level, tile_size, format)`；前端 `useTileSource` hook + LRU 缓存 ImageBitmap；Konva 背景 bg 层改 `<Group>` + 多张 `<Image>` tile；保留 BlurhashLayer 兜底。衡量：8K×8K 图、4x 缩放局部、内存 <300MB、FPS ≥30。后端切片服务可与视频 chunk service 共用基础设施。
- **I4 完整 DiscussionPanel 拆分**（v0.10.19/v0.10.20/v0.10.21 渐进式落地: CommentsPanel 任务级降级 + 任务级评论 POST /feedbacks + 任务级 feedback patch/delete UI + `canvas_drawing.shapes[i].id/started_at/ended_at` 时间戳 + 评论卡片下方迷你 timeline bar; 剩 `DiscussionPanel.tsx` 独立拆出 + WorkbenchLayout 右栏两段固定结构 + ResizeHandle — 重估为纯结构改造对用户行为无增量, Workbench Shell 未破 900 行触发线前不开工）。
- **I5 多图比对（双视图）**：工作台支持左右 / 上下分屏，每个面板独立 ImageStage 实例；可选「锁定 viewport」按钮；标注 diff 左/右面板增删改颜色区分；状态隔离与 R6.2 同理。
- **I10 Skeleton 进阶（骨架关键点）**（基础 COCO 关键点已落 v0.10.28，仅以下进阶项 open，按需触发）：① 配置器从表单升级为 SVG 拖点 + 连线可视化编辑；② 2 层子标签命名（label + sublabel，决策底线表禁止任意嵌套，见 §决策底线「Skeleton 嵌套」）；③ keypoint 的导出 / 导入 / ML 预测协议（见 §A「v0.10.28 新几何导出/导入/预测支持」）；④ 关键点 OKS（Object Keypoint Similarity）质量评估，配合 §C.7 I19 GT / Consensus。
- **I12 Object Group UI 细节**（v0.10.19 已落契约 + 快捷键 + Konva 虚线; 剩 AIInspectorPanel BoxList 同 group 折叠卡片 + AttributeForm 多选 batch banner 消费 `useAnnotationBulkUpdate` + 导出 COCO 时 group_id 映射到 `attributes.__group_id`）。
- **I14 Autoborder / Polygon Crop**（M，纯前端）：开关式 Auto-border，多边形顶点拖动 / 新增时若距其他形状边 < 阈值自动吸附；新建多边形与已有重叠时提供「裁切重叠区」选项（布尔差集，基于已在依赖的 `polygon-clipping@0.15.7`）。
- **I18 Konva pin 渲染**（v0.10.19 已落 `annotation_feedbacks` 表 + `/feedbacks` API + IssueCreateModal/IssueListPanel 浮动入口; 剩 `IssueLayer.tsx` Konva 层 + ImageStage 单击图像创建 pin 入口替代手填 x/y + ADR-0027 第二段 `v_annotation_feedback_unified` view + 旧三表双写）。
- **I19 GT job / Consensus / IAA**（L，独立后端 epic）：项目设置「质检」开关从已完成 task 随机抽 N% 或 honeypot 模式；同一 GT task 分给 ≥2 人互不可见；bbox 走 mAP / IoU、polygon 走 mask IoU、class 走 Cohen's κ；按标注员维度滚动统计 + 质检 Dashboard。与长期 L15 配套，可作 L15 前置。
- **I20.4 Tracker / Auto-Annotation 协议统一收口**（v0.11+）：视频侧 R10 的 `/video-tracker-jobs` 类似协议未与图片 setup 收口为同一 `supported_capabilities` 数组；v0.11.0 做协议统一收口。
- **I21 用户级快捷键自定义**（M，纯前端）：`User.preferences.keymap` + 冲突校验；SettingsPage 录制框 UI；`?` 弹快捷键参考卡按 keymap 渲染（取代硬编码 KeyboardHintOverlay）。

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
| **P0/P1** | 视频工作台前端剩余（R9 / R20 / R16 / R23 / R11+R21 / R22 / R24 / R5.3） | 长视频与协同 / 专属导出 / 质量评估；详见 §C.5 | — |
| **P1** | 视频后端帧服务剩余（真实 SAM video backend / timetable compact / segment 导出 / frameStep+Chapter 原语 / chunk warmup / MOT 导出 / 质量评估 worker） | 前端 R5.3 / R10 / R11 / R20 / R21 / R23 的服务端依赖；详见 §C.6 | — |
| **P2** | 图片工作台能力扩展剩余（I1 / I5 / I10 / I14 / I19 / I20.4 / I21） | 大图 tile / 双图比对 / Skeleton / Autoborder / GT-IAA / 快捷键自定义；详见 §C.7 (I4/I12/I18 已 v0.10.19 落地, 仅余 UI 细节: §C.7 各条目内列出) | [0004](docs/adr/0004-canvas-stack-konva.md) [0027](docs/adr/0027-annotation-feedback-unified-table.md) |
| **P3** | `/ai-pre` 精细单批次预标 modal（v0.9.13 后回归） | v0.9.12 IA 重构 + v0.9.13 chips/threshold UI 已搬到 ProjectDetailPanel；4 个 stepper 子组件 (`PreannotateStepper` / `ProjectBatchPicker` / `RunPanel` / `usePreannotateDraft`) 仍 orphan，客户场景需要单 batch 精细调（草稿恢复 / 阶段进度可视化）时唤起 modal 复用旧组件；如反馈不需要再删 orphan 文件 | — |
| **P3** | ImageStage Konva sceneFunc + evenodd 镂空渲染（v0.9.14 协议 + transforms 已就位） | v0.9.14 后端 `MultiPolygonGeometry` + 前端 `AIBox.holes` / `multiPolygon` 字段已落, ImageStage `<Line>` 渲染层暂取主外环降级；触发 = 客户反馈「donut 类对象渲染少了内圈」或 v0.10.x sam3 多连通域占比 > 30%, 与 sam3-backend 接入同窗口做避免二次破窗 | [0013](docs/adr/0013-mask-to-polygon-server-side.md) |
| **P2** | 邮箱验证（开放注册角色提升前置） | 当前 viewer 零权限可跳过；角色调高时必备 | — |
| **P2** | OAuth2 / 社交登录（Google / GitHub SSO） | 降低注册门槛，企业场景 SSO；客户驱动 | — |
| **P2** | Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest | v0.7.0 通知偏好基础静音已落，邮件 channel 字段就位但 UI 未启 | — |
| **P2** | 非视频工作台 lidar 真实 3D | v0.10.17 已把 `tool_unit=lidar_box_3d` 留位置灰; 图片侧形状 region / polyline / rotated_bbox / keypoint 已通过 tool_unit 维度落地(v0.10.17 + v0.10.28), 不再算独立工作台 | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P2** | C.3 marquee / 关键帧 / 会话级标注辅助 | 业务复杂度起来后必需 | — |
| **P2** | 批次状态机二阶段：`annotating → active` 暂停（实施 ADR-0008） + bulk-approve / bulk-reject | ADR-0008 已 Proposed；实施前补 scheduler 测试覆盖；bulk approve/reject UX 待定 | [0008](docs/adr/0008-batch-admin-locked-status.md) |
| **P3** | 截图 fixture 实际重跑 (v0.10.18 已落 prepare 脚本) | v0.10.18 已落地 `page.route` mock 注入式 prepare; maintainer 跑 `pnpm exec playwright test --config=playwright.screenshots.config.ts --project=desktop-light --grep "ai-pre/history-search\|bbox/iou\|bbox/bulk-edit"` 验证 (`ai-pre/empty-alias` 在 PromptComposer 深层 modal 流, 留作手截) | — |
| **P3** | 前端单测从 30 推到 35 | v0.9.14 实测 30.30%；下阶段补 `BatchesSection` 完整交互（创建/bulk/逆向迁移/看板）+ `WorkbenchShell` 关键 hook + `useBatchEventsSocket` 端到端 | — |
| **P3** | 首次登录 UI walkthrough（onboarding tooltip） | 新客户上线前低优；客户反馈触发再做 | — |
| **P3** | i18n、2FA | 客户具体需求驱动（SSO 已单独提升到 P2） | — |
| **P3** | C.3 SAM 后续延伸: 类别确认 hint / pixel-level Snap-to-edge | Magic Box 已 v0.10.17 落地; 剩类别确认 hint(画完一框 SAM 跑分类弹建议) + 像素级 Snap-to-edge(Canny/Sobel WebWorker) | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | 跨 tool_unit 类别软关联 (`alias_to`) | 强隔离默认底线;客户反馈"想共享类别名字"再做。设计走 `ToolClassEntry.alias_to` 链, 不破坏 ADR-0026 决策 | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | I4/I12/I18 epic 续作余 (v0.10.21 收尾) | v0.10.20 已落 I4 任务级评论 POST + I12 group 折叠/batch banner + I18 IssueLayer + ADR-0027 第二段双写; v0.10.21 落 I4 笔画 timeline + 任务级 feedback patch/delete UI; 剩独立 epic 处理: ADR-0027 第三段切单源 (legacy-table-retirement) + DiscussionPanel 完整拆分 (无 UX 增量) + IssueLayer video frame pin | [0027](docs/adr/0027-annotation-feedback-unified-table.md) |
| **P2** | v0.10.28 新几何导出/导入/预测支持 (rotated_bbox / polyline / keypoint) | 三工具 v0.10.28 已落地绘制 + 持久化, 但 export.py / predictions_import / ML 预测协议未覆盖新几何; 客户用了新工具走到导出立刻撞上; 详见 §A「v0.10.28 新几何导出/导入/预测支持」 | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | ML backend storage endpoint 选择机制（生产化） | v0.9.4 phase 1 用 `ML_BACKEND_STORAGE_HOST` 简单覆盖适合 dev + ADR-0012 已写决策框架；生产场景多变，第一个生产部署遇到再扩 ADR 策略表 | [0012](docs/adr/0012-sam-backend-as-independent-gpu-service.md) |
| **P3** | 审计日志月度汇总物化视图 | partition + archive + 回源端点已落（v0.10.25）；剩 BI 月度汇总物化视图，等 10M+ 行触发 | [0007](docs/adr/0007-audit-log-partitioning.md) |
| **P3** | Workbench Shell 拆分后续精简（v0.10.18 部分收口） | v0.10.18 已落 `WorkbenchStageHostProps` JSDoc 分组 + `WorkbenchLayout.test.tsx` / `WorkbenchStageHost.test.tsx` 共 6 例 focused render tests; 剩 props 嵌套类型重构 (call-site 改造, 触发条件 Shell 再次膨胀) + `useWorkbenchShellModel` (Shell 仍 1210 行, 未破 900) 未做 | [0017](docs/adr/0017-workbench-shell-mode-and-stage-adapters.md) |

---

## 决策底线 / 反模式备忘

> 这一节**不是 TODO**，是 PR review 时的参考底线。记录"当前正确选择不要走回头路"的决策，避免后续重新踩 CVAT / Label Studio 已经踩过的坑。完整对照表与出处见 [取经合集 §6](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#6-避坑清单保持当前选择不要走回头路)。

| 主题 | 反模式（来源） | 当前正确选择 | 何时检查 |
|---|---|---|---|
| 状态字段 | 同时存 status/stage/state 三字段（CVAT Job） | 单 status enum | 加新状态前看一眼现有 enum 能否表达 |
| 标注配置 | XML DSL（Label Studio） | JSONB `tool_bindings` 按 tool_unit 嵌套（v0.10.17+; v0.10.22 起为**唯一存储真值**, 扁平 `classes_config` 仅响应/导出读时派生, 无 DB 列） | 永远不要为"灵活性"回退到 DSL；要灵活就扩 JSONB schema；不要重新引入扁平存储列 |
| 类别绑定 | 项目级扁平类别表（v0.10.16 之前的本平台 / Label Studio） | 按工具单位 `tool_bindings` **强隔离**（v0.10.17+, [ADR-0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md)） | 不要回到"项目级扁平 classes_config"; 跨工具复用类需求出现时走可选 `alias_to` 链而不是合并表 |
| Task 双重含义 | task 既是标注题目也是后台 job（Label Studio） | 题目 / Celery 分离 | `async_jobs` 统一表落地后强化（取经合集 §1.7） |
| 模块化拆分 | 24+ Django apps 跨依赖（Label Studio） | apps/api 单仓 | 不要因"模块化"动机拆出新 apps/* |
| OSS/EE 分叉 | `if settings.EE` 满地（Label Studio） | 单分支无功能开关 | 商业化前不要拆，灰度走 feature flags |
| 格式适配 | 自己维护 25+ 格式（CVAT） | COCO/YOLO/VOC + 平台原生 AAP JSON | 客户要新格式走 datumaro 中转，不自己加 |
| 权限引擎 | Rego / OPA policy DSL（CVAT） | 单 RBAC 中间件 | 权限复杂化时先看 RBAC 内能否表达 |
| AI backend | 自管 serverless（CVAT Nuclio） | HTTP `/predict` 协议 + 独立容器（[ADR-0012](docs/adr/0012-sam-backend-as-independent-gpu-service.md)） | 保持；Plugin tool 也走 HTTP |
| Skeleton 嵌套 | 无限 sublabel 递归（CVAT） | §C.7 I10 实现时**只支持 2 层**（label + sublabel） | 不开放任意嵌套 |
| 标注 / 预测合并 | 同一数组用 type 字段区分（CVAT 部分格式） | `annotations[]` 和 `predictions[]` 双数组分开 | 设计任何新协议（导出、SDK、Plugin、AAP JSON）时保持双数组 |
| 内部主键当稳定 ID | 用 user_id / annotation_id 数字 ID 跨实例匹配 | 导出可写内部 ID 审计用，导入匹配走 `external_id` + `file_path` + `schema_version` 三元组 | 设计 import 端点 / SDK / Plugin I/O 时 |

---

## 优化建议 / 文档维护备忘

> 这一节记录"对 ROADMAP 自身格式"的维护方向，避免文件无限膨胀。每个 epic 结束后应配套精简，把完成内容移到 CHANGELOG / changelog 分卷。

1. **「后续观察项」滚动归档**：§A 末尾当前 3/5 条；超过 5 条时拆出 `ROADMAP/observations.md`。
2. **触发条件量化**：「监控触发」类条目（predictions Stage 2 / batch_summary stored 列）目前文字描述；条件成熟后可在 Grafana dashboard 加阈值 panel + 告警，跨过即生 issue。仍未执行（依赖 Grafana 优先级）。
3. **epic 收尾同步精简 §A/§C**：每次版本收尾配套删 §A / §C 已落项 + 在该 epic 后写 1 段「落地后新发现」补到优先级表，避免 ROADMAP 与 CHANGELOG 双源真相漂移。已成为约定.
4. **ADR 引用列回填**：每次新增 ADR 时 grep 优先级表对应行加链接。
