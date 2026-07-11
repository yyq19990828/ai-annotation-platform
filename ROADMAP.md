# 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本详情见 [CHANGELOG.md](./CHANGELOG.md) 与 [docs/changelogs/](docs/changelogs/)；本文件只保留尚未完成或仍需触发的事项。

---

## 即将到来（按版本切片的详细计划）

> 大颗粒 epic 拆到独立文档；下面 §A/§B/§C 仍维护单条颗粒度的待办。

### 计划中

- **✅ 视频 AI 追踪多目标化 epic 已交付**（[v0.21.25 epic](docs/plans/2026-07-07-v0.21.25-video-multi-target-tracking-epic.md)）：`sam3_video` 文本追踪（backend + 平台 + 前端）、多目标落库底座（阶段 0）、按能力路由（阶段 R）、`sam2_video` 多目标 + 点/框种子（阶段 A，解 `_OBJ_ID` 硬编码）、`sam3_video_interactive` PVS 点/框交互追踪（B-pvs）、`sam3_video` multiplex 文本多目标 + 平台窗边界 IoU 跨窗关联（B-mx）、视频 AI 传播「候选 → 接受/丢弃」流（[v0.21.28 计划](docs/plans/2026-07-10-v0.21.28-video-tracker-candidate-accept.md)）均已落地，真机 3090 GPU E2E 通过。显存对策：sam3 专用小分窗（`VIDEO_TRACKER_SAM3_WINDOW_SIZE_FRAMES=16`，前向峰值随窗口近似线性 ~0.85–1.3 GB/帧）已收口原「`SAM3_VIDEO_MAX_WINDOW_FRAMES=300` 单卡 OOM」隐患。剩 `sam3.1_multiplex` 与图像 sam3.pt 单卡并存的显存编排见 §B「跨 backend 显存互斥编排」。
- **多几何 track 后续切片（部分已落）**：逐帧 YOLO-seg 导出已随 v0.21.24 `yolo-frames-seg` 落地（单帧多边形按帧、多边形轨迹按弧长插值展开）；**仍未建**：`export_video.py` 的 COCO-seg 导出、真·mask 栅格 track + DAVIS 导出（平台**零占位**，需从头建，单独立项）、**polyline 轨迹的 AI 传播回填**（v0.21.24 起明确 400 拒绝，见 §A [#56](https://github.com/yyq19990828/ai-annotation-platform/issues/56)）。见 [v0.21.20 计划](docs/plans/2026-07-05-v0.21.20-multi-geometry-track.md)。
- **视频单帧工具 epic（v0.21.21 已发版；v0.21.22 起暂停）**：把图片全套单帧工具搬进视频单帧标注。**v0.21.21 已交付**——单帧 + 轨迹 polygon/polyline 全链（绘制 UX 对齐图片侧、提交后顶点/整体编辑、轨迹编辑 keyframe 感知）+ 视频几何工具单位对齐图片（多边形/折线独立类别·属性 schema，设置三 tab）。见 [epic](docs/plans/2026-07-07-video-single-frame-tools-epic.md) / [v0.21.21 计划](docs/plans/2026-07-07-v0.21.21-video-single-frame-geometry-foundation.md)。**v0.21.22（单帧 keypoint / rotated-box(OBB) / mask 笔刷）暂停**——使用少、回馈少，投入产出不划算；计划文件已归档至 [`docs/plans/archive/`](docs/plans/archive/2026-07-07-v0.21.22-video-single-frame-keypoint-obb-mask.md)。已落的 inert 地基（keypoint / OBB 的 `video_*` 几何 schema + 只读渲染派生）保留无害；**未做**：绘制交互（尤其 OBB 旋转手柄）、keypoint 前端、mask。下游 **v0.21.23（交互式 SAM 分割当前帧：智能点 / 框 / 示例框 + Magic Box）与 v0.21.24（单帧几何导出：`yolo-frames-seg` + `video_json` 加 `type` 字段 + 多边形 / 折线导出修复）均已交付**（见 [CHANGELOG](CHANGELOG.md) Unreleased）；仅 v0.21.22（keypoint / OBB / mask）一档仍暂停待触发。
- **[长期规划（12 个月以外）](./ROADMAP/2026-05-12-long-term-strategy.md)**：L1-L15 战略方向盘点。数据中台 / 主动学习闭环 / 模型评估 / 跨模态 / 协同与众包 / 插件机制 / 公开 SDK / 合规认证 / 移动端 / 端侧推理 / 合成数据 / SaaS / 可观测性 / i18n / AI 审计。**当前 P0/P1 完成前不开工**。
- **[CVAT / Label Studio 取经合集（2026-05-18）](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md)**：跨主题对标盘点研究档。Webhook 完整形态 / 公开 SDK / Annotation Guide / AnnotationFeedback 收敛 / Consensus 拆分 / async_jobs 统一 / LLM-as-Judge / 平台原生 AAP JSON 等。**性质：研究输入**，按颗粒度逐步回流到 §A/§B/§C。当前已回流：决策底线表。
- **[点云 + 图像联合标注（2026-06-14）](./ROADMAP/2026-06-14-pointcloud-image-joint-annotation.md)**：3D 旗舰独立 epic。读方向(3D 框投影到相机图)已落 v0.13.4；写方向(相机图 2D 框种 3D 框 frustum fit → 投影手柄微调 → 多相机一致性)Phase 1 已落 v0.15.24(视锥反算选点 + 3D 框初值拟合)，Phase 2-3(投影手柄微调 / 多相机一致性)待开工。配套 §C.8 拖影消除两版本(v0.15.22 剔除 / v0.15.23 逐目标补偿)构成「3D 前线深化」近期切片。
- **[视频工作台总路线图（2026-05-21）](./ROADMAP/2026-05-21-video-workbench-roadmap.md)**：视频专项独立 epic。进度：Phase 1-4 主体已落（帧采样 / 轨迹工具 2.1–2.8 / `sam2_video` backend + 能力协商 / 视频导出 + 逐帧 YOLO），Phase 5-6 待开工（sam3_video 文本驱动追踪已细化为 [v0.21.19 计划](../docs/plans/2026-07-05-v0.21.19-sam3-video-text-tracking.md)——现 `sam3_video` 前端选项/adapter 槽位纯占位、sam3-backend 无任何 video 实现）。衍生 epic [ML Backend 能力协商 + AI 预标注模态化重设计](ROADMAP/[archived]2026-05-22-ml-backend-modality-and-ai-preannotate-redesign.md) 三阶段已落地归档。
  - **延后项**：**2.9 多几何 track（polygon / polyline / mask）**（P1，体量大）→ **已细化为 [v0.21.20 计划](../docs/plans/2026-07-05-v0.21.20-multi-geometry-track.md)**——扩 `VideoTrackGeometry.type`（判别字段是 `type` 非 `kind`；当前只 `video_track_bbox`），按周长/长度参数化插值（现插值 bbox-only）；polygon track 先行（复用图片 polygon schema + SAM2 已算 mask），真·mask 栅格 track + DAVIS 导出（平台**零占位**，需从头建，非「已有待接」）单独立项。


---

## 当前焦点（按"何时触发"分组）

> 优先级表（§ 末尾）按价值/成本排序；本节按**触发条件**重组，一眼看清"现在能做什么 / 等什么再做"。

### 现在可做（无前置依赖，纯前端随手优化，可作为 `chip:maintenance` 穿插推进）

- **前端随手优化批剩余项**（`ai.*` 去重已落 v0.21.17、`useWorkbenchConfig` 去重已落 v0.21.18）：首屏 `GET /me/preferences` 的并发重复拉取已全部收敛到共享 react-query。**仅剩** PipelineGraphCanvas 运行态每 tick 无谓 `setNodes` re-render 微优化（低收益、回归面广，保留待触发）。详见 §C.1。非 bug。
- **视频侧折线 / 多边形轨迹 / 折线轨迹的快捷键**（暂缓分配）：单帧多边形已拿到 `P`、Magic Box 拿到 `G`（均与图片侧同键）。但折线、多边形轨迹、折线轨迹三者目前**无快捷键**——它们的工具栏角标已在 v0.21.23 收尾时清掉（此前 `L` / `Shift+G` / `Shift+L` 是死标签，其中视频 `L` 实为播放快进）。分配时须避开已占键：视频 `L`=播放 jog、`G`=Magic Box、`P`=多边形、`Shift+G`/`Shift+L` 在视频里当前为空但语义上应留给「轨迹版」。候选方案：折线给 `Shift+P`？轨迹版沿用图片侧的 `Shift+G`/`Shift+L`？需与图片侧键位表一起定，避免再造不一致。

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
- **3D / 视频多模态工作台**（v0.10.17 项目"类型"已收敛到「image / video / lidar 数据载体 + 工具集多选」，详见 [ADR-0026](docs/adr/archive/0026-tool-unit-class-and-attribute-binding.md)）:
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
- **批次 hard pause（严格暂停语义）**（**P3**，源自 [ADR-0008](docs/adr/archive/0008-batch-admin-locked-status.md)）：v0.9.15 `admin_locked` 是 **soft hold**（冻结自动推进 + 阻断 `/tasks/next` 派单），不保证锁后只读（`GET /tasks` 仍可见、写接口放行）。硬只读需收敛任务可见性查询 + task lock 归属校验 + 写门禁，是更重的设计题。触发：客户反馈 soft hold 不够。

### AI / 模型
- **模型市场扩展 — 二期剩余 defer 项**：加权 AB 路由（按 task 自动分流打标，需路由配置 + 结果打标协议）、同输入双变体并排对比（工作台级独立 epic）、带 token 的观测容器（当前 observe URL 假定免鉴权）。触发条件按客户驱动。
- **Predictions Import / AAP JSON 后续延伸**（按客户反馈触发）：
  - **Task 表加 `external_id` 字段**（**P3**）：当前 display_id + file_path 两元组匹配够用。走 `tasks.external_id UNIQUE(project_id, external_id)`，[`AAPTaskMatch`](apps/api/app/schemas/aap_json.py) 已留 forward compat。触发：跨实例迁移改 display_id / 路径。
  - **AAP JSON video_track 导入支持**（**P3**）：`internal_geometry_to_ls_shape` 仅覆盖 bbox / polygon / multi_polygon。**已并入视频 epic Phase 4.2**。
  - **`predictions_import` 审计 detail 专项**（**P3**）：在 `app/services/audit.py` 加 `predictions_import_detail()` helper（补 task / model_version / hash 取证字段）。触发：审计期反馈 detail 不足。
- **跨 backend 显存互斥编排（单卡多 GPU backend 共存）**（**P2**）：平台可同时注册多个 GPU backend（grounded-sam2 / sam3 / yolo，各驻留 3–4GB），但**谁都不知道别人占了多少显存**。单卡放不下时不会 OOM 报错，而是**静默退化**：`cudaMalloc` 反复失败 → 清缓存 → 重试，模型加载慢一个数量级（8G 卡实测 SAM 3 冷启动 `8.5s` → `159s`），随后撞上 `ML_PREDICT_TIMEOUT` 超时。表象是「推理超时」，根因是显存竞争，极易误诊成「模型本来就慢」而去调大超时（治标且掩盖问题；二次推理的 504 文案已改为指向卸载 backend）。**现状**：`MLBackendClient.unload()` + `POST /api/v1/ml-backends/{id}/unload` 已具备卸载能力，但只有手动入口，无自动编排。多卡场景已有 `*_GPU_DEVICE_ID` 把各 backend 错开到不同物理卡——那是**空间隔离**（绕开竞争），单卡机器所有 backend 仍挤在卡 0，故本条只对单卡有效。**做法**：派发前按显存预算决策是否卸载其它 backend——需定义「卸谁」（LRU / 优先级）、「并发请求如何排队」（卸载期间其它 backend 的 in-flight 请求怎么办）、「是否跨进程加锁」（API 与 Celery worker 都会派发）。有设计取舍，宜独立 ADR。**触发**：单卡多 backend 部署成为常规用法，或此类「超时实为显存竞争」的误诊再现 ≥ 2 次。多卡 / 大显存部署下不触发。
- **训练队列**：路由 `/training` 占位。等数据集 snapshot + 主动学习闭环成熟一并做。
- **ML backend storage endpoint 选择机制（生产化）**（**P3**）：dev `ML_BACKEND_STORAGE_HOST` + ADR-0012 框架已收口；生产场景多变, 第一个生产部署遇到再扩策略表（"何时设、设啥值、何时留空"）。
- **Python SDK 暴露全局注册表 CRUD / 项目启用管理端点**（**P3**，按需触发）：v0.19.0 把 ML backend 上提为全局注册表（[ADR-0044](docs/adr/archive/0044-global-ml-backend-registry-and-project-enablement.md)），v0.19.1 已让 SDK 只读路径（`MLBackends.list/get`）与之对齐（见 plan [`docs/plans/archive/2026-06-29-v0.19.1-python-sdk-global-registry-alignment.md`](docs/plans/archive/2026-06-29-v0.19.1-python-sdk-global-registry-alignment.md)），但**写路径仍只在 Web 端**：超管全局注册 CRUD（`POST/PUT/DELETE /admin/ml-integrations/registry` + `POST .../registry/{id}/health`）、项目启用清单（`GET /projects/{id}/ml-backends/available`、`PUT .../{rid}/enablement`）。封装为 SDK 客户端方法 + `aap` CLI 子命令，需同步扩 `packages/python-sdk/src/ai_annotation/_http.py` 端点白名单并过 `test_openapi_contract` 对账。属 **SDK feature（非 patch）**，对应 SDK minor。**触发**：出现脚本化批量注册 / 启用 backend 的诉求（CI 部署、多环境批量配置）。
- **项目编排多条命名持久化（`project_pipelines` 表）**（**P3**，按需触发）：v0.18.x「项目编排」落地走**方案 A** —— `Project.preannotate_pipeline` 单列 JSONB 存「一项目一条当前编排」，供「当前题 AI」popover 的「运行当前题（按项目编排）」读取（见 plan [`docs/plans/archive/2026-06-26-v0.18.25-interactive-ai-toolbar-redesign.md`](docs/plans/archive/2026-06-26-v0.18.25-interactive-ai-toolbar-redesign.md)，依赖 [多阶段预标注编排 epic](ROADMAP/2026-06-23-staged-preannotation-pipeline-roadmap.md)）。当出现「一个项目要保存多条命名编排并切换」（如『仅检测』『检测+车辆属性』『检测+OCR』并存）需求时，再升级为独立 `project_pipelines(id, project_id, name, stages JSONB, is_default, …)` 表 + 编排选择 UI。**触发**：单项目多命名编排诉求 ≥ 2 例，或跨项目编排复用/共享需求出现。不要因「灵活性」提前建表（YAGNI，对照决策底线表「标注配置」行）。
- **`batchable` 驱动源阶段分块预标（WS3）**（**P3**，先压测再立项）：从 v0.19.2「ML 能力字段消费」计划[出范围存档](docs/plans/archive/2026-06-26-v0.19.2-ml-capability-field-consumption.md#ws3--batchable-驱动源阶段分块不进-v0192存档待立项)。把 `_run_batch`（`apps/api/app/workers/tasks.py:801`）源阶段「逐图循环」改为 `batchable=true` 时按块聚合发 `predict(tasks=[...])`。**收益有限**：四个 backend 服务端都是 `for t in req.tasks` 顺序循环、不堆 GPU batch，故推理总时长一秒不省，3a 只摊销 per-call overhead（HTTP 往返 / context 校验 / Celery↔backend 延迟，毛估 5–15% wall-clock）；却要改动核心批量执行路径的失败 / 进度 / 取消三处粒度（逐图→逐块），改坏会静默吞结果。**触发**：批量吞吐成为实测痛点；且应与 3b（真 GPU 批量，需 backend 改动 + 单独 ADR + 逐 backend 计划）合并立项算总账，避免先改一遍执行路径、3b 再改第二遍。
- **编排源扩展：crops 源（方向 B）与 scene 源（方向 C）**（**P3**，各自触发）：**输入节点终态已落地**——v0.21.5/v0.21.6 把编排输入节点收敛为深度 0 的纯数据源（`source:{data_type,execution_unit}`，不配模型、不入后端 stage），源检测/追踪模型下沉为其子阶段；v0.21.7 又让 `execution_unit=frame`（视频逐帧检测，图像 backend 逐帧跑落 `VideoBboxGeometry`）落地。「输入 vs 第一模型」的解耦、「执行单位」作为输入节点字段的骨架都已成型，剩两种非平凡源仍待接入这套骨架：
  - **方向 B · 矩形标注框（crops）作为源**：以项目里已有的矩形标注为父框来源、**第一个算子不是模型**（零推理）。输入节点已是纯数据源，故只需让其 payload 表达「无模型输入」（无 `ml_backend_id`/`model_id`，换 `source: {kind:"annotations", annotation_type:"rectangle"}`），backend 源阶段增「读已有标注而非调 backend」分支。**触发**：crops 源诉求出现（rule-of-three：客户明确要「用已有框跑下游」）。不要退而在模型节点上挂「源种类下拉」（那是把已解耦的东西糊回去）。
  - **方向 C · 图片序列（scene 抽帧）作为源**：打破 pipeline per-task 独立执行、逼执行单位从 task/frame 再升到 **scene**（跨帧聚合），是执行单位维度**最贵的一块**。`execution_unit` 字段与 frame 单位已就位（v0.21.7），scene 是其上待补的值。**触发**：scene 跨帧聚合标注单独立项（计划已判「最贵、单独立项」）。

### polyline 轨迹追踪回填链路（源自 PR #51 审查，[#56](https://github.com/yyq19990828/ai-annotation-platform/issues/56)）

> PR #51 审查共提 13 条，其余 12 条均已修复并补回归测试（见 [CHANGELOG](CHANGELOG.md)）。仅此一条因需 ML backend 侧改动 + >8GB 显存回归而未做。

- **polyline 轨迹追踪回填链路（P2，当前是「拒绝」不是「支持」）**：`reject polyline track propagation` 只做了短期止血——`video_tracker_runner.py` 的 `_coerce_video_track_geometry` 只认 `video_track_polygon` / `video_track_bbox`，polyline 原本会命中 bbox fallback 被压成 `{x:0,y:0,w:0,h:0}` 空框、`annotation_type` 被改写、原关键帧全丢，故 `video_tracker_job_service.py` 在 propagate 入口改为明确 400 拒绝。**中期仍需实现**：让 polyline 走真实追踪链路（`output_geometry` 传 `"polyline"`、SAM2 mask → 折线的骨架化 / 中心线提取，或退而用顶点集直接传播）。注意 API 侧**不做矢量化**——`video_tracker_runner.py` 只下发 `output_geometry` 让 backend 保留矢量输出，故本项真实工作量在 backend 镜像内。用户现在能画 polyline 轨迹、能按弧长插值、能导出，唯独**不能用 AI 传播**，是多几何 track 能力矩阵上唯一的洞。见 [v0.21.20 计划](docs/plans/2026-07-05-v0.21.20-multi-geometry-track.md)。

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
- **ghost 参考虚影不消费查询帧的 `outside` 区间**（P3，待判定是 bug 还是设计）：`resolveTrackAtFrame` 在 `frameIndex ∈ outside` 时返回 null（不产生 entry），但 `nearestTrackKeyframe` 只过滤**关键帧**是否落在 outside，**不检查查询帧本身**。故轨迹被显式标记「目标离开画面」的帧上，仍会显示 ghost 参考框 / linear 外推预测框（`videoFrameViews.test.ts` 的 `referenceConfig=linear` 用例即在 outside 区间内断言 ghost 存在）。语义上 outside = 目标不在画面，给参考虚影可能诱导标注员画出不该存在的框；但也可解释为「帮助目标重新出现时续画」。**此前该行为被一条假绿测试掩盖**（outside 字段名写错致其从未生效），修正后才显形。需产品侧判定。
- **视频工作台画布偶发全黑 —— 已加载看门狗缓解，连接层 wedge 态仍需硬刷新**（2026-07-10 已修主因，残留边角）：隐藏 `<video>` 解码源偶发卡在 `readyState=HAVE_NOTHING`（mp4 的 HTTP range 请求 stall / 连接竞态），Konva 背景层无帧可画 → 画布全黑，且这类 hang **不触发 `<video>` 的 `error` 事件**、现有错误处理捕获不到，此前只能手动刷新。已加加载看门狗（`useVideoPlaybackController`）：src 就绪后持续无元数据则每 5s `video.load()` 重踢至多 3 次、拿到元数据即解除、超时给「请刷新」提示，把「静默永久黑屏」变为「自愈 / 明确提示」（见 CHANGELOG + 单测）。**残留**：少数会话卡进浏览器**连接层 wedge** 态时，`load()`（复用同连接池）乃至整页刷新都可能救不回，只有硬刷新 / 换连接能清——此类只能靠提示兜底。**可选加强（未做，待定）**：看门狗最后一步改自动 `window.location.reload()`（换新连接必恢复，但会打断标注、需防重载循环）。mp4 本身健康（对象存在、CORS `ACAO` + `Accept-Ranges` 正常），非数据 / 存储问题。

---

## B · 架构 & 治理向前演进

### 安全
- **2FA / TOTP**：super_admin 必选、其它角色可选。

### 治理 / 合规
- **Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组（通用 Webhook，对接企业微信 / 钉钉 / 飞书）。`event_envelope.py` 的信封 schema + 事件名 Literal 已占位（v0.10.16），**仅差 publisher / outbox / delivery 实现**。

### 可观测性
- **Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest**：v0.6.9 闭环 + 通知已落，SMTP 配置框架已就位（`config.py` + Alertmanager 邮件投递）；剩 LLM 聚类 + `bug_reports` 加 `cluster_id` / `llm_distance` 字段 + 邮件 digest 工作流；与通知偏好（按 type 静音）协同。

### 性能 / 扩展

- **ML 后端 GPU 失效 → CPU fallback 健壮性审计（五镜像统一，P2）**：起因 = 视频单帧推理报 500 根因排查——yolo-backend 的「CPU fallback」是假的：`torch.cuda.is_available()` 只查驱动可见性，GPU 上下文损坏（如笔记本挂起/恢复后的 `CUDA error: unknown error`）时它仍返回 True，但任何 CUDA 算子会硬抛错。旧代码 `model.to(cuda)` 失败只打日志不搬 CPU，且 ultralytics 在 predict 时又按 `is_available()` 自动选回 cuda:0 → 硬 500。**yolo-backend 已修**（真实显存分配探测 + latch CPU + `device=str(model.device)` 贯通 predict/track + `/health.provisioning.effective_device` 观测，见本次改动）。**剩余四镜像需同款探查**：
  - **grounded-sam2-backend**：`video_predictor.py:80`、`main.py` 均 `self.device = "cuda" if torch.cuda.is_available() else "cpu"` —— 同一 `is_available()` 陷阱，无真实算子探测；SAM2 build/predict 走 `self.device`，GPU 上下文坏时会硬 500。
  - **sam3-backend**：`predictor.py:105` 同款 `is_available()` 判定，且 `torch.autocast(self.device, enabled=(self.device=="cuda"))` 直接绑定该值；需同样加真实探测 + latch。
  - **rapidocr-backend**：`predictor.py:101` 由 `RAPIDOCR_DEVICE` 决定 `use_cuda`，走 onnxruntime。需验证 CUDAExecutionProvider 不可用/上下文坏时是否自动降级到 CPUExecutionProvider（onnxruntime 一般会，但要确认「坏上下文」而非「缺 provider」也能降级，并观测降级信号）。
  - **onnxtools-backend**：onnxruntime-gpu，compose 注释称「缺 GPU/cuDNN 时自动 fallback CPU」；需实测坏上下文场景并把降级结果暴露到 `/health`。
  - **统一交付**：抽一个共享探测 helper（候选落 `aap_backend_runtime`，五镜像复用）——`effective_device()` 做真实分配探测 + 失败 latch CPU；torch 系（yolo/gsam2/sam3）显式把 device 贯通到推理调用，onnxruntime 系（rapidocr/onnxtools）显式声明 provider 优先级并观测实际生效 provider；各 `/health` 统一暴露 `effective_device` / 实际 provider，供「GPU 静默退回 CPU」告警。**触发**：现在可做（yolo 已开路，四镜像照抄）。

### 测试 / 开发体验
- **前端单元测试 — 页面级覆盖**：vitest + MSW 基座（v0.7.4）。v0.10.48 起覆盖率口径已排除测试文件，当前真实源码 lines 47.68% / 阈值 45（branches 70）。下阶段目标 47→55：补 `BatchesSection`（~32%）/ `useWorkbenchShellModel` / `useImageAnnotationActions` 等复杂 hook；Konva 渲染层（`ImageStage` / `ImageStageShapes`）难测，留待。
- **size-limit / scripts 脚本测试**：`apps/web/scripts/check-bundle-size.mjs` 已有基础单测覆盖 glob match / 单位解析 / 格式化输出；当前脚本数量少，暂不拆独立 vitest 项目。若后续 build-time 脚本增多，再为 `apps/web/scripts/` 建独立测试项目（不算主分母覆盖率）。
- **vite proxy `/ws` 多并发偶发 CONNECTING 卡死（P3 dev experience）**：dev 直连 `localhost:8000` 绕法保留；根因待追，必要时给 vite 上游提 minimal repro[不影响生产环境]。
- **`useStageViewport` 拆分（图片工作台 paint 时序）**：巨石文件拆分 Epic 主体已结项（见 [CHANGELOG](CHANGELOG.md)），此为唯一遗留触发项。ImageStage 翻页首帧 jank 修法核心 —— render-time setState + 双 `useLayoutEffect` 顺序，jsdom 测不到。**触发**：先立 Playwright 视觉回归基线再拆。

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
- **交互工具 preference 重复拉取去重**（已全部落地：`ai.*` 四 hook v0.21.17 + `useWorkbenchConfig` v0.21.18）：`ai.*` 四个偏好 hook（`useInteractiveBackendPref` / `useAiToolModelPref` / `useSecondaryParamPrefs` / `useAiToolParamPrefs`）与 `useWorkbenchConfig` 的多个挂载实例（shell 主状态 / 画布 / 设置抽屉）首屏并发的相同 `GET /me/preferences` 均已收敛到共享 react-query `["me","preferences",userId]`——首屏该端点从 3~4 次并发降到单次，写回用 `setQueryData` 整份回灌，跨设备刷新沿用 5min staleTime。§C.1 该项已闭环，仅剩下条 PipelineGraphCanvas re-render 微优化待触发。
- **PipelineGraphCanvas 运行态每 tick 无谓 re-render**（**P3**，可选，未做）：原「每 tick 重置/跳视口/闪烁」命题**已被前序优化修复**（`fitView` 改依赖 `topoFingerprint` 只在拓扑变时触发、measured 尺寸按 id 保留）。仅剩「运行态轮询每 1.5s 无条件 `setNodes` 一次无谓 re-render」微优化——低收益、回归面广（DAG 交互 + 运行进度实时性），原列为 v0.21.17 可选尾项、随 v0.21.17 放行时未做，保留待触发。

### C.3 标注体验（核心生产力杠杆）
- **`U` 键准确度升级**：v0.5.2 用启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）。

### C.5 / C.6 视频工作台前端 + 后端剩余 → 已抽离

> 原 §C.5（前端：R5.3 / R9 / R20 / R16 / R23 / R11+R21 / R22 / R24）与 §C.6（后端帧服务：真实 SAM video backend / timetable compact / segment 导出 / frameStep+Chapter / chunk warmup / MOT 导出 / 质量评估 worker）已全部并入独立 epic：[`ROADMAP/2026-05-21-video-workbench-roadmap.md`](./ROADMAP/2026-05-21-video-workbench-roadmap.md)，按 Phase 1-6 顺序排布。

### C.7 图片工作台能力扩展剩余（原 `[archived]2026-05-12-image-workbench-optimization.md` 转录）

> Wave α / β / γ / δ 已收尾（I2 / I3 / I6 / I7 / I8 / I11 / I13 / I15 / I16 / I17 / I20 Interactor 类型均落地）。以下是 Wave γ 末段 + Wave ε 剩余。

- **I1 大图 tile**（v0.11.0 独立 epic，**必做**）：>4K 图后端 Celery 切 IIIF / 自定义 tile 金字塔（zoom 0/1/2 ... 每级 512×512 PNG/WebP），元数据 `ImageTilePyramid(image_id, max_level, tile_size, format)`；前端 `useTileSource` hook + LRU 缓存 ImageBitmap；Konva 背景 bg 层改 `<Group>` + 多张 `<Image>` tile；保留 BlurhashLayer 兜底。衡量：8K×8K 图、4x 缩放局部、内存 <300MB、FPS ≥30。后端切片服务可与视频 chunk service 共用基础设施。
- **I18 续作（仅余视频帧 pin）**：图片 `IssueLayer.tsx` Konva pin 层 + 单击建 pin 入口已落（v0.15.x）；剩**视频帧 pin**（按 `frame_index` 锚定）+ ADR-0027 第三段切单源（legacy-table-retirement）。
- **I21 用户级快捷键自定义**（M，纯前端；v0.15.3 偏好注册表地基已就位，成本降低）：`User.preferences.keymap` + 冲突校验；SettingsPage 录制框 UI；`?` 弹快捷键参考卡按 keymap 渲染（取代硬编码 KeyboardHintOverlay）。

### C.8 邻帧点云叠加 · 动态目标拖影彻底消除（v0.15.18 落地后衍生）

> 背景：v0.15.18 邻帧点云叠加用 **ego-only 刚体补偿**——只抵消车自身运动，抵消不了目标自身运动，故静止背景重合加密、**动态目标必然留拖影**。v0.15.18 已补视觉缓解(前/后帧分色 + 时序淡出，让拖影读成"运动方向")。基于标注 box 的两条彻底消除路（B 剔除 / A 逐目标对齐）已落地,覆盖**已标注且跨帧成链**目标(详见 [CHANGELOG](CHANGELOG.md));剩一条不依赖标注的重路：

- **D. 学习式动静分割**（**P3**，重，性价比低）：不依赖标注的动静点分类(需模型 / 几何启发)，能处理未标注动态物，但成本高;非必要不做。

### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> **已落地的架构基线，非待办**。单工作台外壳 + Mode 轴 + StageHost + 按类型独立 action hooks 的四层结构（含 `StageKind` / `StageCapabilities` / overlay 边界 / 3D 约束）SoT 见 [`dev/concepts/workbench-shell.md`](docs-site/dev/concepts/workbench-shell.md) 与 [ADR-0017](docs/adr/archive/0017-workbench-shell-mode-and-stage-adapters.md)。
>
> 真实 lidar / 3D 接入**已落地**（v0.13.2+，`ThreeDWorkbench` + `PointCloudScene` 复用 `StageKind` / `StageCapabilities` / `WorkbenchStageHost` 边界，未破坏 overlay / 3D 约束）。架构基线无 open 项；具体能力优化见 §C.8（拖影消除）与 §A 3D 延伸项。

---

## 优先级建议（参考）

> 已完成的项不再列出，参考 [docs/changelogs/](docs/changelogs/)。下面只是当前 open 的优先级。

| 优先级 | 候选项 | 触发 / 理由 | Related ADR |
|---|---|---|---|
| **P0/P1** | 视频工作台总 epic（导入帧采样 / 轨迹工具对齐 CVAT / 视频导出 / 长视频协同 / 质量评估） | 已抽离为独立 epic，前后端 Phase 1-6 详见 [`ROADMAP/2026-05-21-video-workbench-roadmap.md`](ROADMAP/2026-05-21-video-workbench-roadmap.md) | [0012](docs/adr/archive/0012-sam-backend-as-independent-gpu-service.md) [0026](docs/adr/archive/0026-tool-unit-class-and-attribute-binding.md) |
| **P2** | polyline 轨迹追踪回填链路（[#56](https://github.com/yyq19990828/ai-annotation-platform/issues/56)） | v0.21.24 只做了 400 拒绝止血；polyline 能画 / 能插值 / 能导出，唯独不能 AI 传播 —— 多几何 track 能力矩阵唯一的洞。真实工作量在 backend 镜像内（API 侧不做矢量化），需 >8GB 显存回归 | [0012](docs/adr/archive/0012-sam-backend-as-independent-gpu-service.md) |
| **P2** | 图片工作台能力扩展剩余（I1 / I21） | 大图 tile / 快捷键自定义；详见 §C.7（I10 Skeleton 进阶 + I12 Object Group + I18 图片 pin + I14 Polygon Crop 已落） | [0004](docs/adr/archive/0004-canvas-stack-konva.md) [0027](docs/adr/archive/0027-annotation-feedback-unified-table.md) |
| **P3** | ImageStage Konva sceneFunc + evenodd 镂空渲染（v0.9.14 协议 + transforms 已就位） | v0.9.14 后端 `MultiPolygonGeometry` + 前端 `AIBox.holes` / `multiPolygon` 字段已落, ImageStage `<Line>` 渲染层暂取主外环降级；触发 = 客户反馈「donut 类对象渲染少了内圈」或 v0.10.x sam3 多连通域占比 > 30%, 与 sam3-backend 接入同窗口做避免二次破窗 | [0013](docs/adr/archive/0013-mask-to-polygon-server-side.md) |
| **P2** | OAuth2 / 社交登录（Google / GitHub SSO） | 降低注册门槛，企业场景 SSO；客户驱动 | — |
| **P2** | Bug 反馈延伸 LLM 聚类去重 + SMTP 邮件 digest | v0.7.0 通知偏好基础静音已落，邮件 channel 字段就位但 UI 未启 | — |
| **P3** | 截图 fixture 实际重跑 | v0.10.18 已落 `page.route` mock 注入式 prepare；maintainer 跑 `playwright test --config=playwright.screenshots.config.ts` 验证 | — |
| **P3** | 首次登录 UI walkthrough（onboarding tooltip） | 新客户上线前低优；客户反馈触发再做 | — |
| **P3** | i18n、2FA | 客户具体需求驱动（SSO 已单独提升到 P2） | — |
| **P3** | C.3 SAM 后续延伸: 类别确认 hint | Magic Box 已 v0.10.17 落地; 剩类别确认 hint(画完一框 SAM 跑分类弹建议) | [0026](docs/adr/archive/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | I4/I18 epic 续作余（I12 已落 / I18 图片 pin 已落） | 剩 ADR-0027 第三段切单源 (legacy-table-retirement) + IssueLayer **视频帧** pin；详见 §C.7 | [0027](docs/adr/archive/0027-annotation-feedback-unified-table.md) |
| **P3** | 新几何 ML 预测协议按客户 backend 输出补齐 | 平台读路径 (`to_internal_shape`) + 协议文档 + 导入(AAP/YOLO)/导出/测试均已支持 rotated_bbox/polyline/keypoint；等真实客户 backend 产出这些几何时按实际输出对账 | [0026](docs/adr/archive/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | ML backend storage endpoint 选择机制（生产化） | v0.9.4 phase 1 用 `ML_BACKEND_STORAGE_HOST` 简单覆盖适合 dev + ADR-0012 已写决策框架；生产场景多变，第一个生产部署遇到再扩 ADR 策略表 | [0012](docs/adr/archive/0012-sam-backend-as-independent-gpu-service.md) |
| **P3** | 审计日志月度汇总物化视图 | partition + archive + 回源端点已落（v0.10.25）；剩 BI 月度汇总物化视图，等 10M+ 行触发 | [0007](docs/adr/archive/0007-audit-log-partitioning.md) |
| **P3** | 邻帧点云叠加动态拖影彻底消除（§C.8 D 学习式动静分割） | B 剔除(v0.15.22)+ A 逐目标对齐(v0.15.23)已落地,覆盖**已标注且跨帧成链**目标;剩 D=不依赖标注的学习式动静分割(能处理未标注动态物,重、性价比低),非必要不做 | [0026](docs/adr/archive/0026-tool-unit-class-and-attribute-binding.md) |
| **P3** | `useStageViewport`(图片工作台 paint 时序)拆分 | 巨石拆分 Epic 已结项;唯一遗留 —— render-time setState + 双 useLayoutEffect 顺序,需先立 Playwright 视觉基线另立项 | — |

---

## 决策底线 / 反模式备忘

> 这一节**不是 TODO**，是 PR review 时的参考底线。记录"当前正确选择不要走回头路"的决策，避免后续重新踩 CVAT / Label Studio 已经踩过的坑。完整对照表与出处见 [取经合集 §6](./ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#6-避坑清单保持当前选择不要走回头路)。

| 主题 | 反模式（来源） | 当前正确选择 | 何时检查 |
|---|---|---|---|
| 状态字段 | 同时存 status/stage/state 三字段（CVAT Job） | 单 status enum | 加新状态前看一眼现有 enum 能否表达 |
| 标注配置 | XML DSL（Label Studio） | JSONB `tool_bindings` 按 tool_unit 嵌套（v0.10.17+; v0.10.22 起为**唯一存储真值**, 扁平 `classes_config` 仅响应/导出读时派生, 无 DB 列） | 永远不要为"灵活性"回退到 DSL；要灵活就扩 JSONB schema；不要重新引入扁平存储列 |
| 类别绑定 | 项目级扁平类别表（v0.10.16 之前的本平台 / Label Studio） | 按工具单位 `tool_bindings` **强隔离**（v0.10.17+, [ADR-0026](docs/adr/archive/0026-tool-unit-class-and-attribute-binding.md)） | 不要回到"项目级扁平 classes_config"; 跨工具复用类需求出现时走可选 `alias_to` 链而不是合并表 |
| Task 双重含义 | task 既是标注题目也是后台 job（Label Studio） | 题目 / Celery 分离；async_jobs 作 job 索引 + batch_predict 单一真值（v0.10.49），但带活实体 FK + 运行时状态的 job（VideoTrackerJob）保留专表 | 新 job 类型默认进 async_jobs；仅当需 FK 级联到活标注 / 复杂运行时状态机时才建专表 |
| 模块化拆分 | 24+ Django apps 跨依赖（Label Studio） | apps/api 单仓 | 不要因"模块化"动机拆出新 apps/* |
| OSS/EE 分叉 | `if settings.EE` 满地（Label Studio） | 单分支无功能开关 | 商业化前不要拆，灰度走 feature flags |
| 格式适配 | 自己维护 25+ 格式（CVAT） | COCO/YOLO/VOC + 平台原生 AAP JSON | 客户要新格式走 datumaro 中转，不自己加 |
| 权限引擎 | Rego / OPA policy DSL（CVAT） | 单 RBAC 中间件 | 权限复杂化时先看 RBAC 内能否表达 |
| AI backend | 自管 serverless（CVAT Nuclio） | HTTP `/predict` 协议 + 独立容器（[ADR-0012](docs/adr/archive/0012-sam-backend-as-independent-gpu-service.md)） | 保持；Plugin tool 也走 HTTP |
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
