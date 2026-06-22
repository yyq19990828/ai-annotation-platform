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
- **[点云 + 图像联合标注（2026-06-14）](./ROADMAP/2026-06-14-pointcloud-image-joint-annotation.md)**：3D 旗舰独立 epic。读方向(3D 框投影到相机图)已落 v0.13.4；写方向(相机图 2D 框种 3D 框 frustum fit → 投影手柄微调 → 多相机一致性)Phase 1 已落 v0.15.24(视锥反算选点 + 3D 框初值拟合)，Phase 2-3(投影手柄微调 / 多相机一致性)待开工。配套 §C.8 拖影消除两版本(v0.15.22 剔除 / v0.15.23 逐目标补偿)构成「3D 前线深化」近期切片。
- **[视频工作台总路线图（2026-05-21）](./ROADMAP/2026-05-21-video-workbench-roadmap.md)**：视频专项独立 epic。进度：Phase 1-4 主体已落（帧采样 / 轨迹工具 2.1–2.8 / `sam2_video` backend + 能力协商 / 视频导出 + 逐帧 YOLO），Phase 5-6 待开工（sam3_video 待续）。衍生 epic [ML Backend 能力协商 + AI 预标注模态化重设计](ROADMAP/[archived]2026-05-22-ml-backend-modality-and-ai-preannotate-redesign.md) 三阶段已落地归档。
  - **延后项**：**2.9 多几何 track（polygon / polyline / mask）**（P1，体量大）——扩 `video_track.geometry.kind`，按周长/长度参数化插值；mask track 依赖 canvas/bitmap，DAVIS mask 导出（Phase 4.5）依赖此项。


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
- **大文件分片上传**（>5GB 视频 / 点云）
- **数据集版本 snapshot + 主动学习闭环**（与训练队列一起做，长期规划 L1 / L2）
- **2FA / TOTP**（super_admin 必选 / 其它角色可选）

---

## A · 代码观察到的硬占位 / 残留 mock

### 项目模块
- **3D / 视频多模态工作台**（v0.10.17 项目"类型"已收敛到「image / video / lidar 数据载体 + 工具集多选」，详见 [ADR-0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md)）:
  - **lidar 3D 点云工作台已落地**（v0.13.2–v0.15.21，原 P0「`lidar_box_3d` 工具实现」已完成）：真实 Three.js `PointCloudScene` + `lidar_box_3d` 7-DoF 框标注 + 后端 `point-cloud/manifest` + KITTI/nuScenes 导出 + ego pose 跨帧插值/批量 propagate + 邻帧框/点云叠加 + PSR 面板 + 3D 右键菜单/帧选择器。`lidar` 数据类型入口已开放（`toolUnits.ts` `available:true`）。剩余优化见 §C.8（拖影彻底消除）与下方 3D 延伸项。
  - `video-mm` / `mm` 多模态工作台未实现；视频侧能力详见 [视频工作台总 epic](ROADMAP/2026-05-21-video-workbench-roadmap.md)。
  - **3D 延伸项**：① **点云 + 图像联合标注（2D⇄3D 互标）** → 抽为独立 epic [`ROADMAP/2026-06-14-pointcloud-image-joint-annotation.md`](ROADMAP/2026-06-14-pointcloud-image-joint-annotation.md)：读方向(3D 框投影到相机图)已于 v0.13.4 完成，写方向(相机图画框种 3D 框 / 投影手柄微调)Phase 1 已落 v0.15.24，Phase 2-3 待开工；② 多 lidar 融合标注（按反馈触发）。
- **项目模板开放项**（按客户反馈触发）：
  - **模板版本号 / changelog**（**P3**）：PATCH 直接覆盖无审计轨迹，走 `project_templates_versions` 快照表 + 比较版本 UI。触发：误改投诉 ≥ 2 次或组织模板 > 20。
  - **organization admin 提交 public 模板审核流**（**P3**）：当前仅 super_admin 可建 public，走 `template_publish_requests` 队列。触发：跨组织 SaaS / 公共模板 ≥ 10。
  - **模板 usage 统计页**（**P3**）：缺"哪些项目用了 / 传播路径"等运营信号。触发：公共模板 ≥ 5。可与 [§4.1](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#41-annotator-performance-dashboard) 同窗口。
  - **AAP JSON 支持模板携带**（**P3**）：把 ProjectTemplate 加进 `manifest.json`，闭环"导出 → 跨实例 → 导入即得模板"。与 AAP JSON epic 同窗口。
  - **模板审计专项 detail**（**P3**）：在 `app/services/audit.py` 加 `template_detail()` helper。触发：审计期反馈模板侧 detail 不足。

### 数据 & 存储
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。
- **批次相关延伸**：① 智能切批（按难度/类别/不确定度）；② 批次级 IAA / 共识合并算法；③ 不可变训练快照 + 主动学习闭环。调研报告 [docs/research/12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md)。
- **批次 hard pause（严格暂停语义）**（**P3**，源自 [ADR-0008](docs/adr/0008-batch-admin-locked-status.md)）：v0.9.15 `admin_locked` 是 **soft hold**（冻结自动推进 + 阻断 `/tasks/next` 派单），不保证锁后只读（`GET /tasks` 仍可见、写接口放行）。硬只读需收敛任务可见性查询 + task lock 归属校验 + 写门禁，是更重的设计题。触发：客户反馈 soft hold 不够。

### AI / 模型
- **模型市场扩展 — 二期剩余 defer 项**：加权 AB 路由（按 task 自动分流打标，需路由配置 + 结果打标协议）、同输入双变体并排对比（工作台级独立 epic）、带 token 的观测容器（当前 observe URL 假定免鉴权）。触发条件按客户驱动。
- **Predictions Import / AAP JSON 后续延伸**（按客户反馈触发）：
  - **`POST /annotations/import` 端点**（**P3**）：AAP JSON `annotations[]` 仅导出可用，导入端只警告不入库。要点：入库需回写 `user_id` / `source` / `was_cancelled` 等元数据；需 `batch_match` 字段；是否走 audit 需 ADR。触发：客户反馈"另一实例无法完整重建标注"。
  - **Task 表加 `external_id` 字段**（**P3**）：当前 display_id + file_path 两元组匹配够用。走 `tasks.external_id UNIQUE(project_id, external_id)`，[`AAPTaskMatch`](apps/api/app/schemas/aap_json.py) 已留 forward compat。触发：跨实例迁移改 display_id / 路径。
  - **AAP JSON video_track 导入支持**（**P3**）：`internal_geometry_to_ls_shape` 仅覆盖 bbox / polygon / multi_polygon。**已并入视频 epic Phase 4.2**。
  - **`predictions_import` 审计 detail 专项**（**P3**）：在 `app/services/audit.py` 加 `predictions_import_detail()` helper（补 task / model_version / hash 取证字段）。触发：审计期反馈 detail 不足。
- **训练队列**：路由 `/training` 占位。等数据集 snapshot + 主动学习闭环成熟一并做。
- **ML backend storage endpoint 选择机制（生产化）**（**P3**）：dev `ML_BACKEND_STORAGE_HOST` + ADR-0012 框架已收口；生产场景多变, 第一个生产部署遇到再扩策略表（"何时设、设啥值、何时留空"）。

### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**（部分实现）：通知偏好（v0.7.0，`NotificationPreference` 表 + SettingsPage 分区）与标注工作台偏好（v0.15.3 四分树：通用/图片/视频/点云/布局 50+ 字段 + 设置抽屉）均已落地；主题（v0.15.25 已从 localStorage 升级到服务端用户偏好 `preferences.ui.theme`，跨设备跟随账号）；**仍缺**：语言（依赖 i18n 框架，见 §B）、时区。

### TopBar / Dashboard 控件
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast；Organization 表已存在但前端无切换 UI。

### 登录 / 注册 / 认证
- **开放注册二阶段剩余**：
  - **OAuth2 / 社交登录**：Google / GitHub SSO，python-social-auth 或 authlib；`User.oauth_provider` + `oauth_id` 字段；LoginPage / RegisterPage 加「使用 Google 登录」按钮。

### 后续观察项（仍 open）

- **getting-started 与 SoT 漂移**：文档站硬编码快捷键如再漂移可考虑给 .md 内联 `` `<键>` `` 建一份从 hotkeys.ts 推导的 ESLint/markdownlint 规则；优先级低，等漂移触发.

---

## B · 架构 & 治理向前演进

### 安全
- **2FA / TOTP**：super_admin 必选、其它角色可选。

### 治理 / 合规
- **Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组（通用 Webhook，对接企业微信 / 钉钉 / 飞书）。`event_envelope.py` 的信封 schema + 事件名 Literal 已占位（v0.10.16），**仅差 publisher / outbox / delivery 实现**。

### 可观测性
- **Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest**：v0.6.9 闭环 + 通知已落，SMTP 配置框架已就位（`config.py` + Alertmanager 邮件投递）；剩 LLM 聚类 + `bug_reports` 加 `cluster_id` / `llm_distance` 字段 + 邮件 digest 工作流；与通知偏好（按 type 静音）协同。

### 性能 / 扩展
暂无

### 测试 / 开发体验
- **前端单元测试 — 页面级覆盖**：vitest + MSW 基座（v0.7.4）。v0.10.48 起覆盖率口径已排除测试文件，当前真实源码 lines 47.68% / 阈值 45（branches 70）。下阶段目标 47→55：补 `BatchesSection`（~32%）/ `useWorkbenchShellModel` / `useImageAnnotationActions` 等复杂 hook；Konva 渲染层（`ImageStage` / `ImageStageShapes`）难测，留待。
- **size-limit / scripts 脚本测试**：`apps/web/scripts/check-bundle-size.mjs` 已有基础单测覆盖 glob match / 单位解析 / 格式化输出；当前脚本数量少，暂不拆独立 vitest 项目。若后续 build-time 脚本增多，再为 `apps/web/scripts/` 建独立测试项目（不算主分母覆盖率）。
- **vite proxy `/ws` 多并发偶发 CONNECTING 卡死（P3 dev experience）**：dev 直连 `localhost:8000` 绕法保留；根因待追，必要时给 vite 上游提 minimal repro[不影响生产环境]。
- **巨石文件拆分 Epic — 已收口（2026-06-19 文档收尾）**（计划：[Epic](docs/plans/2026-06-17-v0.16.x-large-file-component-split-epic.md) / [缓拆·补测试再拆](docs/plans/2026-06-17-v0.16.x-deferred-split-test-backfill.md) / [点云 E2E 基线](docs/plans/2026-06-17-v0.16.x-pointcloud-e2e-baseline-for-3d-split.md)）：0.16.9–0.16.13 已落**全部安全可拆部分** —— 后端 `tasks.py`/`dashboard.py` 拆包 + service 抽取、Tier 2 三个 ⭐⭐⭐（`media.py`/`dashboard.py`/`CapabilityCatalogPanel.tsx`）、前端工作台 hook/纯函数拆分、「补测试再拆」第 1 批后端 3 刀 + 第 2 批前端 7 刀 + 第 3 批 B 类可守护者（`usePredictionPropagation`/`usePsrPatchPipeline`/`useAiPopoverFrame`）、点云 E2E 基线 P0/P1/P2 核心 4 spec。**残留三组按设计为「触发才做」**（非遗留欠债 —— 三条红线〔行为零变化 + 测试守护 + 人工值守〕已论证它们默认不做，与其它 P3 触发项同性质）：
  - **3D 整簇深拆**（`usePsrEditor` / `usePointMask` / `usePointCloudSelection`）：共享 `sceneRef` + `form` + 合并键盘 handler 职责纠缠，假边界硬拆会改行为；jsdom 无 WebGL 单测守不住。**触发**：有人值守（连浏览器 + Docker 跑手动回归、确认鼠标键位口径）且补齐对应簇 E2E 基线后逐个拆（拆边缘不碰 `form`/`scene` 的小块如 `usePsrPatchPipeline` 已在第 3 批完成）。
  - **点云 E2E 护栏剩余刀**（gizmo W/E/R canvas 拖拽落库 / point-mask polygon 绘制〔需补 `point_mask` tool binding〕/ 跨帧 Shift+→〔需补 scene/frame_index〕/ 相机面板拖动折叠〔需补 camera link + calibration〕，均需先扩 `seed/lidar`）：边际价值递减。**触发**：真正动手拆上面某簇时「用时再补对应 seed + spec」，不提前投机造护栏。**已绿基线**：headless WebGL 冒烟 + 点选/数值编辑落库 + B 放置/Delete 删除（4 spec，SwiftShader 软渲染，`--repeat-each=3` 稳定）。
  - **`useStageViewport`**（ImageStage paint 时序，翻页首帧 jank 修法核心）：render-time setState + 双 `useLayoutEffect` 顺序 jsdom 测不到。**触发**：先立 Playwright 视觉回归基线（Epic §7 非目标，需另立项）再拆。

### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **无障碍**：ARIA 属性极少；Lighthouse Accessibility 分数应作为 PR gate。

### 文档

- **首次登录引导（onboarding）**：用户手册有文档但工作台无 UI walkthrough；新用户进 `/projects/:id/annotate` 时左下浮出一条「画框：拖鼠标；提交：E」级别的 3 步 tooltip + 右上 ✕ 关闭一次性写 localStorage `wb:onboarded:v1`。优先级 P3，等首次客户上线反馈触发。
- **连接器主机白名单管理 UI（P3）**：当前仅有超管 API `GET/PUT /storage-connections/allowlist`，前端无对应管理界面；用户手册 `datasets/storage-connections.md` 暂按「经接口维护」措辞、截图标记 `connector-allowlist.png` 注明「待 UI 就绪再拍」。补超管侧白名单增删界面后即可落图。

---

## C · 标注工作台专项优化（性能 / 界面 / 标注体验）

> 横向参考：CVAT（Konva + 关键帧 + 骨架）、Label Studio（interactive ML backend）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量检测）。

### C.1 渲染性能 / 大图大量框
- **大图 tile / 多边形 LOD**：多边形 LOD（I2）已落 v0.10.4；大图 tile（I1）见 §C.7。

### C.3 标注体验（核心生产力杠杆）
- **`U` 键准确度升级**：v0.5.2 用启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）。

### C.5 / C.6 视频工作台前端 + 后端剩余 → 已抽离

> 原 §C.5（前端：R5.3 / R9 / R20 / R16 / R23 / R11+R21 / R22 / R24）与 §C.6（后端帧服务：真实 SAM video backend / timetable compact / segment 导出 / frameStep+Chapter / chunk warmup / MOT 导出 / 质量评估 worker）已全部并入独立 epic：[`ROADMAP/2026-05-21-video-workbench-roadmap.md`](./ROADMAP/2026-05-21-video-workbench-roadmap.md)，按 Phase 1-6 顺序排布。

### C.7 图片工作台能力扩展剩余（原 `[archived]2026-05-12-image-workbench-optimization.md` 转录）

> Wave α / β / γ / δ 已收尾（I2 / I3 / I6 / I7 / I8 / I11 / I13 / I15 / I16 / I17 / I20 Interactor 类型均落地）。以下是 Wave γ 末段 + Wave ε 剩余。

- **I1 大图 tile**（v0.11.0 独立 epic，**必做**）：>4K 图后端 Celery 切 IIIF / 自定义 tile 金字塔（zoom 0/1/2 ... 每级 512×512 PNG/WebP），元数据 `ImageTilePyramid(image_id, max_level, tile_size, format)`；前端 `useTileSource` hook + LRU 缓存 ImageBitmap；Konva 背景 bg 层改 `<Group>` + 多张 `<Image>` tile；保留 BlurhashLayer 兜底。衡量：8K×8K 图、4x 缩放局部、内存 <300MB、FPS ≥30。后端切片服务可与视频 chunk service 共用基础设施。
- **I10 Skeleton 进阶**（基础 COCO 关键点已落 v0.10.28）：① 配置器升级为 SVG 拖点 + 连线可视化；② 2 层子标签命名（禁止任意嵌套，见决策底线「Skeleton 嵌套」）；③ keypoint 导出 / 导入 / ML 预测协议（见 §A）。
- **I18 续作（仅余视频帧 pin）**：图片 `IssueLayer.tsx` Konva pin 层 + 单击建 pin 入口已落（v0.15.x）；剩**视频帧 pin**（按 `frame_index` 锚定）+ ADR-0027 第三段切单源（legacy-table-retirement）。
- **I21 用户级快捷键自定义**（M，纯前端；v0.15.3 偏好注册表地基已就位，成本降低）：`User.preferences.keymap` + 冲突校验；SettingsPage 录制框 UI；`?` 弹快捷键参考卡按 keymap 渲染（取代硬编码 KeyboardHintOverlay）。

### C.8 邻帧点云叠加 · 动态目标拖影彻底消除（v0.15.18 落地后衍生）

> 背景：v0.15.18 邻帧点云叠加用 **ego-only 刚体补偿**——只抵消车自身运动，抵消不了目标自身运动，故静止背景重合加密、**动态目标必然留拖影**。v0.15.18 已补视觉缓解(前/后帧分色 + 时序淡出，让拖影读成"运动方向")。下面是**彻底消除拖影**(让动态目标也对齐加密 / 或干脆不显示)的两条路 + 一条重路：

- ~~**B. box 内动态点剔除**~~ → **已落地 v0.15.22**（设置项 `点云 › 邻帧动态点`,`cullDynamicPoints.ts` 投影法 OBB 剔除 + 状态栏透出剔除数,详见 [CHANGELOG](CHANGELOG.md) / 计划 [`docs/plans/2026-06-14-v0.15.22-neighbor-pointcloud-dynamic-cull.md`](docs/plans/2026-06-14-v0.15.22-neighbor-pointcloud-dynamic-cull.md))。代价:动态目标完全不显示;让其也对齐加密见 A(v0.15.23)。
- ~~**A. box 轨迹逐目标补偿**~~ → **已落地 v0.15.23**（设置项 `点云 › 邻帧动态点` 第三档「逐目标对齐」,`perObjectAlign.ts` 用 `T = M_当前框 · M_邻帧框⁻¹` 把落在邻帧 box 内的点搬到当前帧位置一起加密、框外走 ego + 状态栏透出搬运数,详见 [CHANGELOG](CHANGELOG.md) / 计划 [`docs/plans/2026-06-14-v0.15.23-neighbor-pointcloud-per-object-compensation.md`](docs/plans/2026-06-14-v0.15.23-neighbor-pointcloud-per-object-compensation.md)）。复用 B 的 point-in-box 路由 + v0.15.17 邻帧框 + v0.15.1 `group_id` 跨帧链;动态目标也对齐加密、**无拖影**——等于用 box 轨迹做 lite 版 scene flow。仅对**已标注且跨帧成链**目标有效(未标注动态物按 fallback 默认剔除)。
- **D. 学习式动静分割**（**P3**，重，性价比低）：不依赖标注的动静点分类(需模型 / 几何启发)，能处理未标注动态物，但成本高;非必要不做。

> 共同前置：A/B 需当前帧 + 邻帧的 box_3d 标注(理想是已 propagate/插值的 track)。与 §A `lidar_box_3d` 真实 3D 接入正交,可在点云叠加被真实使用后按反馈触发。

### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> **已落地的架构基线，非待办**。单工作台外壳 + Mode 轴 + StageHost + 按类型独立 action hooks 的四层结构（含 `StageKind` / `StageCapabilities` / overlay 边界 / 3D 约束）SoT 见 [`dev/concepts/workbench-shell.md`](docs-site/dev/concepts/workbench-shell.md) 与 [ADR-0017](docs/adr/0017-workbench-shell-mode-and-stage-adapters.md)。
>
> 真实 lidar / 3D 接入**已落地**（v0.13.2+，`ThreeDWorkbench` + `PointCloudScene` 复用 `StageKind` / `StageCapabilities` / `WorkbenchStageHost` 边界，未破坏 overlay / 3D 约束）。架构基线无 open 项；具体能力优化见 §C.8（拖影消除）与 §A 3D 延伸项。

---

## 优先级建议（参考）

> 已完成的项不再列出，参考 [docs/changelogs/](docs/changelogs/)。下面只是当前 open 的优先级。

| 优先级 | 候选项 | 触发 / 理由 | Related ADR |
|---|---|---|---|
| **P0/P1** | 视频工作台总 epic（导入帧采样 / 轨迹工具对齐 CVAT / 视频导出 / 长视频协同 / 质量评估） | 已抽离为独立 epic，前后端 Phase 1-6 详见 [`ROADMAP/2026-05-21-video-workbench-roadmap.md`](ROADMAP/2026-05-21-video-workbench-roadmap.md) | [0012](docs/adr/0012-sam-backend-as-independent-gpu-service.md) [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P2** | 图片工作台能力扩展剩余（I1 / I10 / I21） | 大图 tile / Skeleton / 快捷键自定义；详见 §C.7（I12 Object Group + I18 图片 pin + I14 Polygon Crop 已落） | [0004](docs/adr/0004-canvas-stack-konva.md) [0027](docs/adr/0027-annotation-feedback-unified-table.md) |
| **P3** | ImageStage Konva sceneFunc + evenodd 镂空渲染（v0.9.14 协议 + transforms 已就位） | v0.9.14 后端 `MultiPolygonGeometry` + 前端 `AIBox.holes` / `multiPolygon` 字段已落, ImageStage `<Line>` 渲染层暂取主外环降级；触发 = 客户反馈「donut 类对象渲染少了内圈」或 v0.10.x sam3 多连通域占比 > 30%, 与 sam3-backend 接入同窗口做避免二次破窗 | [0013](docs/adr/0013-mask-to-polygon-server-side.md) |
| **P2** | OAuth2 / 社交登录（Google / GitHub SSO） | 降低注册门槛，企业场景 SSO；客户驱动 | — |
| **P2** | Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest | v0.7.0 通知偏好基础静音已落，邮件 channel 字段就位但 UI 未启 | — |
| **P3** | 截图 fixture 实际重跑 | v0.10.18 已落 `page.route` mock 注入式 prepare；maintainer 跑 `playwright test --config=playwright.screenshots.config.ts` 验证 | — |
| **P3** | 首次登录 UI walkthrough（onboarding tooltip） | 新客户上线前低优；客户反馈触发再做 | — |
| **P3** | i18n、2FA | 客户具体需求驱动（SSO 已单独提升到 P2） | — |
| **P3** | C.3 SAM 后续延伸: 类别确认 hint | Magic Box 已 v0.10.17 落地; 剩类别确认 hint(画完一框 SAM 跑分类弹建议) | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | I4/I18 epic 续作余（I12 已落 / I18 图片 pin 已落） | 剩 ADR-0027 第三段切单源 (legacy-table-retirement) + IssueLayer **视频帧** pin；详见 §C.7 | [0027](docs/adr/0027-annotation-feedback-unified-table.md) |
| **P3** | 新几何 ML 预测协议按客户 backend 输出补齐 | 平台读路径 (`to_internal_shape`) + 协议文档 + 导入(AAP/YOLO)/导出/测试均已支持 rotated_bbox/polyline/keypoint；等真实客户 backend 产出这些几何时按实际输出对账 | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | ML backend storage endpoint 选择机制（生产化） | v0.9.4 phase 1 用 `ML_BACKEND_STORAGE_HOST` 简单覆盖适合 dev + ADR-0012 已写决策框架；生产场景多变，第一个生产部署遇到再扩 ADR 策略表 | [0012](docs/adr/0012-sam-backend-as-independent-gpu-service.md) |
| **P3** | 审计日志月度汇总物化视图 | partition + archive + 回源端点已落（v0.10.25）；剩 BI 月度汇总物化视图，等 10M+ 行触发 | [0007](docs/adr/0007-audit-log-partitioning.md) |
| **P3** | 邻帧点云叠加动态拖影彻底消除（§C.8 D 学习式动静分割） | B 剔除(v0.15.22)+ A 逐目标对齐(v0.15.23)已落地,覆盖**已标注且跨帧成链**目标;剩 D=不依赖标注的学习式动静分割(能处理未标注动态物,重、性价比低),非必要不做 | [0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | 3D 工作台整簇拆分 + 点云 E2E 护栏剩余刀（§B 测试/开发体验） | 巨石拆分 Epic 已收口(2026-06-19,安全可拆部分全落);残留按设计触发才做 —— `usePsrEditor`/`usePointMask`/`usePointCloudSelection` 共享 scene/form/键盘 handler,需**有人值守 + 补 gizmo/point-mask/跨帧/相机 的 Playwright 护栏(需扩 seed)再拆**;`useStageViewport` 需视觉基线另立项 | — |

---

## 决策底线 / 反模式备忘

> 这一节**不是 TODO**，是 PR review 时的参考底线。记录"当前正确选择不要走回头路"的决策，避免后续重新踩 CVAT / Label Studio 已经踩过的坑。完整对照表与出处见 [取经合集 §6](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#6-避坑清单保持当前选择不要走回头路)。

| 主题 | 反模式（来源） | 当前正确选择 | 何时检查 |
|---|---|---|---|
| 状态字段 | 同时存 status/stage/state 三字段（CVAT Job） | 单 status enum | 加新状态前看一眼现有 enum 能否表达 |
| 标注配置 | XML DSL（Label Studio） | JSONB `tool_bindings` 按 tool_unit 嵌套（v0.10.17+; v0.10.22 起为**唯一存储真值**, 扁平 `classes_config` 仅响应/导出读时派生, 无 DB 列） | 永远不要为"灵活性"回退到 DSL；要灵活就扩 JSONB schema；不要重新引入扁平存储列 |
| 类别绑定 | 项目级扁平类别表（v0.10.16 之前的本平台 / Label Studio） | 按工具单位 `tool_bindings` **强隔离**（v0.10.17+, [ADR-0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md)） | 不要回到"项目级扁平 classes_config"; 跨工具复用类需求出现时走可选 `alias_to` 链而不是合并表 |
| Task 双重含义 | task 既是标注题目也是后台 job（Label Studio） | 题目 / Celery 分离；async_jobs 作 job 索引 + batch_predict 单一真值（v0.10.49），但带活实体 FK + 运行时状态的 job（VideoTrackerJob）保留专表 | 新 job 类型默认进 async_jobs；仅当需 FK 级联到活标注 / 复杂运行时状态机时才建专表 |
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
2. **触发条件量化**：「监控触发」类条目（predictions Stage 2 / batch_summary stored 列）目前文字描述；条件成熟后可在 Grafana dashboard 加阈值 panel + 告警，跨过即生 issue。Grafana / Alertmanager 基线已落（v0.11.19–21，ML backend 侧），剩业务指标阈值 panel 待接。
3. **epic 收尾同步精简 §A/§C**：每次版本收尾配套删 §A / §C 已落项 + 在该 epic 后写 1 段「落地后新发现」补到优先级表，避免 ROADMAP 与 CHANGELOG 双源真相漂移。已成为约定.
4. **ADR 引用列回填**：每次新增 ADR 时 grep 优先级表对应行加链接。
