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
- **[视频工作台总路线图（2026-05-21）](./ROADMAP/2026-05-21-video-workbench-roadmap.md)**：视频专项独立 epic（导入帧采样 / 轨迹工具对齐 CVAT / 视频导出）。三项已拍板决策：抽帧=逻辑采样不动原视频、frame_index 存源帧号、AAP 单信封模态感知。原 §C.5 / §C.6 / 视频相关 §A 条目已全部并入该文，按 Phase 1-6 顺序排布。
  - **进度**：Phase 1（帧采样，v0.10.29）✅ · Phase 2 轨迹工具 2.1–2.8（v0.10.30）✅ · Phase 3.1 真实 `sam2_video` backend + 独立池 + 观测（v0.10.35/36）✅ · Phase 3.2-3.3 经能力协商 epic（v0.10.37/38）✅ · Phase 4-6 待开工（sam3_video 待续）。
  - **衍生 epic（三阶段全部落地，已归档）**：[ML Backend 能力协商 + AI 预标注模态化重设计](ROADMAP/[archived]2026-05-22-ml-backend-modality-and-ai-preannotate-redesign.md)——能力协商落库 + 模态派生（v0.10.37）、ai-pre 模态化 + 多 backend 参数面板 + video-jobs 并入 ai-pre/jobs（v0.10.38）。剩余按客户驱动：精细单 batch 多模型对比 modal（见优先级表 P3）、底层 `async_jobs` 统一表收敛（见 §B）。
  - **从已完成 Phase 延后的项**（仍在 epic 内，单列以免遗漏）：
    - **2.9 多几何 track（polygon / polyline / mask）**（P1，体量大）：扩 `video_track.geometry.kind`，按周长/长度参数化插值；mask track 依赖 canvas/bitmap 能力；DAVIS mask 导出（Phase 4.5）依赖此项。
    - **WebCodecs 精确帧解码 demux 接入**（P2，按真实卡顿数据决定）：Phase 1 已落地解码核心 + feature flag（默认关闭），但 mp4 demux 链路（mp4 字节 → `EncodedVideoChunk`）尚未接入。


---

## 当前焦点（按"何时触发"分组）

> 优先级表（§ 末尾）按价值/成本排序；本节按**触发条件**重组，一眼看清"现在能做什么 / 等什么再做"。

### 现在可做（无前置依赖，作为 `chip:maintenance` 穿插推进，不抢 v0.10.x 主线）

- 当前无与 `WorkbenchShell` 行数直接绑定的 maintenance 条目：v0.10.39 已收口 `WorkbenchStageHostProps` 嵌套重构与 `useWorkbenchShellModel` 装配 hook，后续 open 项回到优先级表的测试补强与业务驱动功能项。

### 等业务规模 / 监控触发（先观察、不做）
- **OpenSeadragon 瓦片金字塔**（见 §C.7 图片工作台 · I1 大图 tile）：极大图 > 50MP 才必要，等真有此规模图片触发再做。
- **审计日志归档物化视图**：partition + archive + 冷数据回源（`/audit-logs/archives`）已落（v0.10.25）；剩月度汇总 BI 物化视图，等 10M+ 行触发。
- **OAuth2 / SSO**：等具体客户驱动（企业场景需求触发再做）

### 等独立 epic（体量大、不适合塞进收尾版）
- **视频工作台（导入采样 / 轨迹工具 / 导出）**：已抽离为独立 epic，见 [`ROADMAP/2026-05-21-video-workbench-roadmap.md`](./ROADMAP/2026-05-21-video-workbench-roadmap.md)（原 §C.5 / §C.6 已并入）。
- **lidar 真实 3D 工作台**（C.4 Layer 2 触发;v0.10.17 已收 image-seg → region tool_unit,v0.10.28 已落 polyline / rotated_bbox / keypoint(COCO 骨骼),真正的独立 epic 只剩 lidar 3D 部分;图片侧形状能力扩展见 §C.7）
- **大文件分片上传**（>5GB 视频 / 点云）
- **数据集版本 snapshot + 主动学习闭环**（与训练队列一起做，长期规划 L1 / L2）
- **2FA / TOTP**（super_admin 必选 / 其它角色可选）
- **长期方向**：见 [`ROADMAP/2026-05-12-long-term-strategy.md`](ROADMAP/2026-05-12-long-term-strategy.md)（数据中台、主动学习、合规认证、跨模态等 15 个方向）。

---

## A · 代码观察到的硬占位 / 残留 mock

### 项目模块
- **3D / 视频多模态工作台**（v0.10.17 已把项目"类型"从 7 种 type_key 收敛到「image / video / lidar 三种数据载体 + 工具集多选」形态,详见 [ADR-0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md)）:
  - `lidar` 在 Workbench StageHost 仍是 3D placeholder,Dashboard 入口未开放,`tool_unit=lidar_box_3d` 留位置灰;接入真实 3D 前不要复用图片 / 视频 geometry。
  - `video-mm` / `mm` 多模态工作台未实现;视频侧能力详见 [视频工作台总 epic](ROADMAP/2026-05-21-video-workbench-roadmap.md)。
- **v0.10.17 落地后开放项**（按客户反馈触发）:
  - **`lidar_box_3d` 工具实现**（**P0**,体量大）:见上条 3D 工作台;依赖 3D viewer + 后端 frame service 视点处理。独立 epic,与长期 L3 跨模态挂钩。
  - **跨 tool_unit 类别软关联 (`alias_to`)**（**P3**）:v0.10.17 强隔离意味"bbox 工具的人 / region 工具的人是两条独立记录",同名颜色 / alias 都得重复输入;触发条件:客户后续反馈"想共享类别名字"。设计走 `ToolClassEntry.alias_to: { tool_unit_id, class_name } | null` 链,导出时按 alias_to 合并 categories(可选)。**强隔离决策为默认底线,alias_to 仅作可选叠加**,不破坏 ADR-0026 决策。

  - **rename_class 端点跨 unit 重命名 UX**（**P3**）:v0.10.17 `useRenameClass` 加了 `tool_unit_id` 参数,但 ClassesSection 仅传当前 active unit;若客户想"同时在所有 unit 内把'人'改成'pedestrian'"需要扩 UI 入口(批量勾选 unit + 单次重命名)。触发条件:客户反馈"重命名要跑 N 次"。
- **v0.10.28 新几何导出/导入/预测支持**（三种新几何 rotated_bbox / polyline / keypoint 落地后新发现，端到端绘制 + 持久化已通，但与外部格式 / 模型协议的对接仍缺口）:
  - **导出协议覆盖新几何**（**P2**，客户用了新工具就会立刻撞上）:`export.py` / `export_packaging.py` 当前只导 bbox / polygon / mask;rotated_bbox / polyline / keypoint **没有 COCO / YOLO / VOC 映射**(rotated_bbox→COCO 无原生表示需选 OBB 扩展或 segmentation 退化;keypoint→COCO `keypoints` 数组 + `skeleton`;polyline→无标准格式需走平台原生 AAP JSON)。触发条件:任一新工具的项目走到导出环节。设计先补 AAP JSON(平台原生无损)再按客户要的标准格式逐个加。
  - **predictions import / AAP JSON 适配新几何**（**P3**）:[`internal_geometry_to_ls_shape`](apps/api/app/services/predictions_import.py) 仍只覆盖 bbox / polygon / multi_polygon,rotated_bbox / polyline / keypoint 进 errors[]。与 §A「AAP JSON video_track 导入支持」同窗口做。
  - **ML backend 输出新几何**（**P3**）:`prediction.py` 的 LS shape 适配把 `keypointlabels` / `linelabels` 当前**归 bbox 占位**;真正让外部模型预测 rotated_bbox / polyline / keypoint 需要补 `to_internal_shape` 分支 + ML backend 协议侧约定。触发条件:有支持这些输出的模型接入。
- **Annotation Guide 配套延伸**（v0.10.13 之后开放项，按客户反馈触发）：
  - ⚠️ **前端 UI 已整体下线**（feature flag `ANNOTATION_GUIDE_UI_ENABLED=false`，关闭工作台 GuidePanel 浮层 + 项目设置「标注指引」tab）。功能形态待重新设计，后端 API / 数据保留。**下列延伸项在前端重新启用前不开工**。
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
- **批次 hard pause（严格暂停语义）**（**P3**，源自 [ADR-0008](docs/adr/0008-batch-admin-locked-status.md) Alternatives B 划到范围外的部分）：v0.9.15 已落 `admin_locked` **soft hold**（冻结自动状态推进 + 阻断 `/tasks/next` 新派单）+ bulk-approve / bulk-reject。soft hold **不**保证锁后严格只读——`GET /tasks` / `GET /tasks/{id}` 仍可见、annotation 写接口仍放行、已 `in_progress` 的 task 不复位。若客户要"暂停后任何新进入者都不能打开 / 编辑该 batch，只允许现有会话收尾"，需单独收敛任务可见性查询 + task lock 归属校验 + annotation 写门禁，是另一个更重的设计题。触发条件：客户反馈 soft hold 不够、要求锁后硬只读。

### AI / 模型
- **模型市场扩展 — 二期剩余 defer 项**：加权 AB 路由（按 task 自动分流打标，需路由配置 + 结果打标协议）、同输入双变体并排对比（工作台级独立 epic）、带 token 的观测容器（当前 observe URL 假定免鉴权）。触发条件按客户驱动。
- **Predictions Import / AAP JSON 后续延伸**（v0.10.15 之后开放项，按客户反馈触发）：
  - **`POST /annotations/import` 端点**（**P3**）：v0.10.15 AAP JSON `annotations[]` 字段当前仅导出可用，导入端只警告日志不入库。涉及 batch/owner/audit 协议复杂度；触发条件：客户反馈"导出 AAP JSON 后无法在另一实例完整重建标注"。设计要点：① 入库 annotation 行需要回写 `user_id` / `source` / `was_cancelled` / `ground_truth` 等元数据；② batch_id 解析需要类似 `task_match` 的 `batch_match` 字段（display_id 优先）；③ 是否走 audit log 需要 ADR 决策。
  - **Task 表加 `external_id` 字段**（**P3**）：v0.10.15 用 display_id + file_path 两元组匹配够用；触发条件：客户跨实例迁移时改 display_id 或文件路径（"重命名也想保稳定 ID"）。设计走 `tasks.external_id String(100) UNIQUE(project_id, external_id)` + AAP JSON `task_match.external_id` 已预留字段直接生效（[`AAPTaskMatch`](apps/api/app/schemas/aap_json.py) 已留 forward compat）。同时给 `predictions` / `annotations` 也加 `external_id` 派生窗口。
  - **ProjectTemplate 进 AAP JSON manifest**（**P3**）：[取经合集 §2.6](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#26-平台原生-task-json-格式aap-json) AAP JSON 是项目级快照格式；后续应把 ProjectTemplate 也加进 envelope 末层（与 §A「项目模板 § AAP JSON 支持模板携带」同条条目），让"导出 → 跨实例 → 导入即得模板"工作流闭环。与公开 SDK epic 同窗口做。
  - **COCO importer image_size_hint 参数化**（**P3**）：当前 [`import_coco`](apps/api/app/services/predictions_import.py) 强制要求 `images[i].width/height` 非零，缺失时整条 entry 进 errors[]。触发条件：客户上传"裸 annotations"（无 images metadata，只有 file_name）。设计：UI Wizard 可选填"全局图像尺寸 hint"作 fallback，预填到 `image_size_hint` 参数。
  - **AAP JSON 单 prediction 多 shape**（**P3**）：当前每个 `predictions[i]` 对应**一条** Prediction 行（单 shape）；与 ML backend 内部协议（一个 prediction 行可携带 N 个 shape）不一致。触发条件：客户希望"一个外部模型一次推理出来的所有框作为同一 prediction 单元，便于整体采纳/驳回"。设计：把 envelope `predictions[i]` 加可选 `shapes[]` 数组，与现有 flat `geometry/class_name` 同源（二选一，flat 兼容旧 schema）。schema 已在 v0.10.17 升 minor `1.1`（带 `tool_unit_id` / `tool_bindings`）；多 shape 仍待客户驱动。
  - **AAP JSON video_track 导入支持**（**P3**）：当前 `internal_geometry_to_ls_shape` 适配器仅覆盖 bbox / polygon / multi_polygon；video_bbox / video_track / skeleton 进 errors[]。**已并入视频 epic Phase 4.2**（[`ROADMAP/2026-05-21-video-workbench-roadmap.md`](ROADMAP/2026-05-21-video-workbench-roadmap.md)），随 AAP 单信封模态感知 + 视频导出一并接通。
  - **`predictions_import` 审计 detail 专项**（**P3**）：当前 audit log `detail_json` 含 imported/skipped/error_count；缺"哪些 task 被命中 / 哪些 model_version / 文件大小 hash"等取证字段。触发条件：审计期反馈 detail 不足以定位"哪批外部模型结果先被导入又被撤回"。设计在 `app/services/audit.py` 加 `predictions_import_detail()` helper.
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
- **`async_jobs` 统一表收敛**（**P3**，源自已归档 ML Backend 能力协商 epic 阶段 3 延后项）：当前 `PredictionJob`（批×模型，图像）与 `VideoTrackerJob`（任务×标注，帧级）双写 `async_jobs` 索引表，但统一仅停在 `/ai-pre/jobs` 的前端模态 tab 展示层，两套 job 模型未合表。后续若统一历史 / 跨模态查询压力上来，把 `async_jobs` 从索引表升级为单一真值（含状态机收敛）。参考 [取经合集 §1.7](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md)；底线见决策表「Task 双重含义」行。触发条件：客户驱动 / 跨模态 job 查询成为瓶颈。
- **Annotation 列表前端切换 keyset 分页**：v0.7.6 已落后端新端点 `GET /tasks/{id}/annotations/page?limit&cursor` + 复合索引；前端 `useAnnotations` 仍用旧数组端点（cap=2000），改 useInfiniteQuery 推迟到 1000+ 框监控触发。
- **Predictions 表分区生产执行**：Stage 1 + Stage 2 迁移（0080）均已落（dev 已应用，v0.10.25）；生产侧按阈值（单月 INSERT > 100k 或总行数 > 1M）执行 `alembic upgrade` 即可，迁移已 battle-tested。

### 测试 / 开发体验
- **前端单元测试 — 页面级覆盖**：vitest + MSW 基座 v0.7.4；v0.8.5 推到 25.28% / 阈值 25；v0.8.7 因引入 8 个新组件回退到 22.04% / 阈值临时降到 22；**v0.8.8 推回 25.17% / 阈值 25**（5 个新 test 文件 ~35 case：turnstile / useCanvasDraftPersistence / RejectReasonModal / FailedPredictionsPage / useNotificationSocket / AnnotationHistoryTimeline）。下阶段目标 25→30：补 `pages/Projects/sections/BatchesSection`（948 行）/ `GeneralSection`（433 行）/ `DatasetsSection`（395 行）/ `AuditPage` / `useWorkbenchShellModel` 关键 hook（`ProjectSettingsPage` shell 自身 v0.9.x 已拆到 181 行，无业务逻辑可测）。
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
- **大图 tile / 多边形 LOD**：多边形 LOD（I2）已落 v0.10.4；大图 tile（I1）见 §C.7。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。`useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。

### C.3 标注体验（核心生产力杠杆）
- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90%；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式）。
- **Snap-to-edge（贴边吸附）**：v0.10.17 已落地 Magic Box（粗框 → SAM 收紧到对象紧凑外接矩形 → 落 bbox）;剩 pixel-level Snap-to-edge（顶点拖动距已有形状边 < 阈值时吸附 / Canny/Sobel 边缘吸附)留 v0.11+。复用 `apps/web/src/pages/Workbench/stage/shared/geometry/polygon.ts:nearestEdge` 做几何吸附;Canny/Sobel 走 WebWorker 实测开销后再决定。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **`U` 键准确度升级**：v0.5.2 用启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）。

### C.5 / C.6 视频工作台前端 + 后端剩余 → 已抽离

> 原 §C.5（前端：R5.3 / R9 / R20 / R16 / R23 / R11+R21 / R22 / R24）与 §C.6（后端帧服务：真实 SAM video backend / timetable compact / segment 导出 / frameStep+Chapter / chunk warmup / MOT 导出 / 质量评估 worker）已全部并入独立 epic：[`ROADMAP/2026-05-21-video-workbench-roadmap.md`](./ROADMAP/2026-05-21-video-workbench-roadmap.md)，按 Phase 1-6 顺序排布。

### C.7 图片工作台能力扩展剩余（原 `[archived]2026-05-12-image-workbench-optimization.md` 转录）

> Wave α / β / γ / δ 已收尾（I2 / I3 / I6 / I7 / I8 / I11 / I13 / I15 / I16 / I17 / I20 Interactor 类型均落地）。以下是 Wave γ 末段 + Wave ε 剩余。

- **I1 大图 tile**（v0.11.0 独立 epic，**必做**）：>4K 图后端 Celery 切 IIIF / 自定义 tile 金字塔（zoom 0/1/2 ... 每级 512×512 PNG/WebP），元数据 `ImageTilePyramid(image_id, max_level, tile_size, format)`；前端 `useTileSource` hook + LRU 缓存 ImageBitmap；Konva 背景 bg 层改 `<Group>` + 多张 `<Image>` tile；保留 BlurhashLayer 兜底。衡量：8K×8K 图、4x 缩放局部、内存 <300MB、FPS ≥30。后端切片服务可与视频 chunk service 共用基础设施。
- **I4 完整 DiscussionPanel 拆分**（v0.10.19/v0.10.20/v0.10.21 渐进式落地: CommentsPanel 任务级降级 + 任务级评论 POST /feedbacks + 任务级 feedback patch/delete UI + `canvas_drawing.shapes[i].id/started_at/ended_at` 时间戳 + 评论卡片下方迷你 timeline bar; 剩 `DiscussionPanel.tsx` 独立拆出 + WorkbenchLayout 右栏两段固定结构 + ResizeHandle — 重估为纯结构改造对用户行为无增量, Workbench Shell 未破 900 行触发线前不开工）。
- **I10 Skeleton 进阶（骨架关键点）**（基础 COCO 关键点已落 v0.10.28，仅以下进阶项 open，按需触发）：① 配置器从表单升级为 SVG 拖点 + 连线可视化编辑；② 2 层子标签命名（label + sublabel，决策底线表禁止任意嵌套，见 §决策底线「Skeleton 嵌套」）；③ keypoint 的导出 / 导入 / ML 预测协议（见 §A「v0.10.28 新几何导出/导入/预测支持」）；④ 关键点 OKS（Object Keypoint Similarity）质量评估，配合 §C.7 I19 GT / Consensus。
- **I12 Object Group UI 细节**（v0.10.19 已落契约 + 快捷键 + Konva 虚线; 剩 AIInspectorPanel BoxList 同 group 折叠卡片 + AttributeForm 多选 batch banner 消费 `useAnnotationBulkUpdate` + 导出 COCO 时 group_id 映射到 `attributes.__group_id`）。
- **I14 Autoborder / Polygon Crop**（M，纯前端）：开关式 Auto-border，多边形顶点拖动 / 新增时若距其他形状边 < 阈值自动吸附；新建多边形与已有重叠时提供「裁切重叠区」选项（布尔差集，基于已在依赖的 `polygon-clipping@0.15.7`）。
- **I18 Konva pin 渲染**（v0.10.19 已落 `annotation_feedbacks` 表 + `/feedbacks` API + IssueCreateModal/IssueListPanel 浮动入口; 剩 `IssueLayer.tsx` Konva 层 + ImageStage 单击图像创建 pin 入口替代手填 x/y + ADR-0027 第二段 `v_annotation_feedback_unified` view + 旧三表双写）。
- **I19 GT job / Consensus / IAA**（L，独立后端 epic）：项目设置「质检」开关从已完成 task 随机抽 N% 或 honeypot 模式；同一 GT task 分给 ≥2 人互不可见；bbox 走 mAP / IoU、polygon 走 mask IoU、class 走 Cohen's κ；按标注员维度滚动统计 + 质检 Dashboard。与长期 L15 配套，可作 L15 前置。
- **I21 用户级快捷键自定义**（M，纯前端）：`User.preferences.keymap` + 冲突校验；SettingsPage 录制框 UI；`?` 弹快捷键参考卡按 keymap 渲染（取代硬编码 KeyboardHintOverlay）。

### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> **已落地的架构基线，非待办**。单工作台外壳 + Mode 轴 + StageHost + 按类型独立 action hooks 的四层结构（含 `StageKind` / `StageCapabilities` / overlay 边界 / 3D 约束）SoT 见 [`dev/concepts/workbench-shell.md`](docs-site/dev/concepts/workbench-shell.md) 与 [ADR-0017](docs/adr/0017-workbench-shell-mode-and-stage-adapters.md)。
>
> 唯一仍 open 的触发条件：真实 lidar / 3D 接入（设计 `LidarStage` / 3D geometry / camera controls，只复用 `StageKind` / `StageCapabilities` / `WorkbenchStageHost` 外围边界）——已在 §A `lidar_box_3d`（P0，客户需求触发）跟踪。

---

## 优先级建议（参考）

> 已完成的项不再列出，参考 [docs/changelogs/](docs/changelogs/)。下面只是当前 open 的优先级。

| 优先级 | 候选项 | 触发 / 理由 | Related ADR |
|---|---|---|---|
| **P0/P1** | 视频工作台总 epic（导入帧采样 / 轨迹工具对齐 CVAT / 视频导出 / 长视频协同 / 质量评估） | 已抽离为独立 epic，前后端 Phase 1-6 详见 [`ROADMAP/2026-05-21-video-workbench-roadmap.md`](ROADMAP/2026-05-21-video-workbench-roadmap.md) | [0012](docs/adr/0012-sam-backend-as-independent-gpu-service.md) [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P2** | 图片工作台能力扩展剩余（I1 / I10 / I14 / I19 / I21） | 大图 tile / Skeleton / Autoborder / GT-IAA / 快捷键自定义；详见 §C.7 (I4/I12/I18 已 v0.10.19 落地, 仅余 UI 细节: §C.7 各条目内列出) | [0004](docs/adr/0004-canvas-stack-konva.md) [0027](docs/adr/0027-annotation-feedback-unified-table.md) |
| **P3** | `/ai-pre` 精细单批次预标 modal（v0.9.13 后回归） | v0.9.12 IA 重构 + v0.9.13 chips/threshold UI 已搬到 ProjectDetailPanel；4 个 stepper 子组件 (`PreannotateStepper` / `ProjectBatchPicker` / `RunPanel` / `usePreannotateDraft`) 仍 orphan，客户场景需要单 batch 精细调（草稿恢复 / 阶段进度可视化）时唤起 modal 复用旧组件；如反馈不需要再删 orphan 文件 | — |
| **P3** | ImageStage Konva sceneFunc + evenodd 镂空渲染（v0.9.14 协议 + transforms 已就位） | v0.9.14 后端 `MultiPolygonGeometry` + 前端 `AIBox.holes` / `multiPolygon` 字段已落, ImageStage `<Line>` 渲染层暂取主外环降级；触发 = 客户反馈「donut 类对象渲染少了内圈」或 v0.10.x sam3 多连通域占比 > 30%, 与 sam3-backend 接入同窗口做避免二次破窗 | [0013](docs/adr/0013-mask-to-polygon-server-side.md) |
| **P2** | 邮箱验证（开放注册角色提升前置） | 当前 viewer 零权限可跳过；角色调高时必备 | — |
| **P2** | OAuth2 / 社交登录（Google / GitHub SSO） | 降低注册门槛，企业场景 SSO；客户驱动 | — |
| **P2** | Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest | v0.7.0 通知偏好基础静音已落，邮件 channel 字段就位但 UI 未启 | — |
| **P2** | 非视频工作台 lidar 真实 3D | v0.10.17 已把 `tool_unit=lidar_box_3d` 留位置灰; 图片侧形状 region / polyline / rotated_bbox / keypoint 已通过 tool_unit 维度落地(v0.10.17 + v0.10.28), 不再算独立工作台 | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P2** | C.3 marquee / 关键帧 / 会话级标注辅助 | 业务复杂度起来后必需 | — |
| **P3** | 截图 fixture 实际重跑 (v0.10.18 已落 prepare 脚本) | v0.10.18 已落地 `page.route` mock 注入式 prepare; maintainer 跑 `pnpm exec playwright test --config=playwright.screenshots.config.ts --project=desktop-light --grep "ai-pre/history-search\|bbox/iou\|bbox/bulk-edit"` 验证 (`ai-pre/empty-alias` 在 PromptComposer 深层 modal 流, 留作手截) | — |
| **P3** | 前端单测从 30 推到 35 | v0.9.14 实测 30.30%；下阶段补 `BatchesSection` 完整交互（创建/bulk/逆向迁移/看板）+ `useWorkbenchShellModel` / `useBatchEventsSocket` 端到端 | — |
| **P3** | 首次登录 UI walkthrough（onboarding tooltip） | 新客户上线前低优；客户反馈触发再做 | — |
| **P3** | i18n、2FA | 客户具体需求驱动（SSO 已单独提升到 P2） | — |
| **P3** | C.3 SAM 后续延伸: 类别确认 hint / pixel-level Snap-to-edge | Magic Box 已 v0.10.17 落地; 剩类别确认 hint(画完一框 SAM 跑分类弹建议) + 像素级 Snap-to-edge(Canny/Sobel WebWorker) | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | 跨 tool_unit 类别软关联 (`alias_to`) | 强隔离默认底线;客户反馈"想共享类别名字"再做。设计走 `ToolClassEntry.alias_to` 链, 不破坏 ADR-0026 决策 | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | I4/I12/I18 epic 续作余 (v0.10.21 收尾) | v0.10.20 已落 I4 任务级评论 POST + I12 group 折叠/batch banner + I18 IssueLayer + ADR-0027 第二段双写; v0.10.21 落 I4 笔画 timeline + 任务级 feedback patch/delete UI; 剩独立 epic 处理: ADR-0027 第三段切单源 (legacy-table-retirement) + DiscussionPanel 完整拆分 (无 UX 增量) + IssueLayer video frame pin | [0027](docs/adr/0027-annotation-feedback-unified-table.md) |
| **P2** | v0.10.28 新几何导出/导入/预测支持 (rotated_bbox / polyline / keypoint) | 三工具 v0.10.28 已落地绘制 + 持久化, 但 export.py / predictions_import / ML 预测协议未覆盖新几何; 客户用了新工具走到导出立刻撞上; 详见 §A「v0.10.28 新几何导出/导入/预测支持」 | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | ML backend storage endpoint 选择机制（生产化） | v0.9.4 phase 1 用 `ML_BACKEND_STORAGE_HOST` 简单覆盖适合 dev + ADR-0012 已写决策框架；生产场景多变，第一个生产部署遇到再扩 ADR 策略表 | [0012](docs/adr/0012-sam-backend-as-independent-gpu-service.md) |
| **P3** | 审计日志月度汇总物化视图 | partition + archive + 回源端点已落（v0.10.25）；剩 BI 月度汇总物化视图，等 10M+ 行触发 | [0007](docs/adr/0007-audit-log-partitioning.md) |

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
