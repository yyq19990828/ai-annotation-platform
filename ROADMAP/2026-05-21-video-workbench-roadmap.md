# 视频工作台总路线图（导入采样 / 轨迹工具 / 导出）

> 从 [ROADMAP.md](../ROADMAP.md) 抽离的**视频专项独立 epic**。原 §C.5（前端剩余）/ §C.6（后端帧服务剩余）/ 优先级表 P0-P1 视频两行、以及散落在 §A 的视频相关条目，全部按执行顺序并入本文；主 ROADMAP 只保留一行指针。
>
> 性质：**长程 epic 规划**，不是"等触发"。当前 v0.10.x 主线收尾后按 Phase 顺序推进；每个 Phase 收尾配套精简本文 + 回写 CHANGELOG。
>
> 上游已收尾基座（不在本文范围，仅作前置说明）：帧服务三层索引（`VideoFrameIndex` / `VideoChunk` / `VideoFrameCache`）、按帧渲染图片接口、ffprobe 元数据、`video_tracker_jobs` 协议桥与 adapter MVP、chunk smart-copy、SAM video 协议桥（v0.9.36）、关键帧 + 前端线性插值、`split_track` / `merge_tracks` 后端服务、AAP JSON v1.1 信封。

---

## 0. 三项已拍板的架构决策（贯穿全文）

这三项在 2026-05-21 讨论中确定，是后续所有 Phase 的设计前提，违反即推倒重来：

| # | 决策 | 反面（不要走） | 理由 |
|---|---|---|---|
| **D1** | **抽帧 = 逻辑采样，不物理重采样、不取代原视频** | ffmpeg 重新编码出低 fps 新 mp4 替换/并存 | 帧服务本就按 `frame_index` 渲染单帧图片，原视频 fps 不影响标注体验；逻辑采样零成本、可逆、随时改密度 |
| **D2** | **标注 geometry 的 `frame_index` 永远存原视频帧号** | 存采样后的帧号 | 改采样密度不破坏旧标注；tracker / 插值都在源帧空间算；与决策底线"内部稳定 ID"一致。导出 MOT 时再按采样网格重编号 |
| **D3** | **AAP 不按 image/video/lidar 拆分，保持单一信封 + 模态判别字段** | 拆成三套 schema / 三个 importer | 单 envelope 靠 `media_type` + 多态 geometry 区分；拆分 = 维护 3 个 schema_version，正踩"别自己维护 25 种格式"反模式（决策底线"格式适配"行） |

> **采样配置归属**：项目级（不是数据集级）。数据集 = 原始资产（一个 mp4 是 ground truth，全 fps，存一份）；同一视频不同项目可要不同采样率，采样是项目/任务的标注策略。可在数据集级留一个 `default_fps_hint` 供建项目时预填。

---

## Phase 1 · 导入与帧采样（D1 + D2 落地）

> 已于 v0.10.29 落地，详见 [CHANGELOG v0.10.29](../CHANGELOG.md)。软网格语义（绝对网格锚定 0、`←/→` 跳网格、暂停吸附、`Shift+←/→` 逃生口微调 ±1 源帧、`Alt+←/→` 关键帧跳）是后续 Phase 的设计前提，保留于此供参考。
>
> **遗留待续**：WebCodecs 精确帧解码当前是**预留骨架**——`useVideoChunkDecoder` 解码核心 + feature flag（默认关闭）已就位，但 mp4 demux 链路（mp4 字节 → `EncodedVideoChunk`）尚未接入，前端 manifest 也未暴露 chunk 字节获取链路。端到端跑通需补 demux（轻量自写 mp4 box 解析或后端预 demux sample 列表），按真实卡顿数据决定是否推进。
>
> **明确不做（D1）**：物理重采样 / 生成低 fps 新 mp4 / 从视频抽成独立图片数据集。

---

## Phase 2 · 轨迹工具对齐 CVAT（核心生产力）

> **2.1–2.8 已于 v0.10.30 落地**（执行计划见 [2026-05-21-v0.10.30-phase2-tracks-plan](../docs/plans/2026-05-21-v0.10.30-phase2-tracks-plan.md)，详情见 [CHANGELOG v0.10.30](../CHANGELOG.md)）：
>
> - 2.1 `semantic_label`（可编辑语义标签）+ `track_number` 确定性派生（不持久化）；内部 `track_id` uuid 保持只读。
> - 2.2 删除 `absent`、语义并入 `outside`（对齐 CVAT 两态 outside/occluded，alembic 0084 迁移存量）。
> - 2.3 track 级 / 帧级（`mutable`）属性 UI；2.4 split / merge UI 接通；2.5 Track Join（`gap_mode` interpolate/outside）；2.6 Propagate 铺帧；2.7 导航（`,`/`.` 关键帧、`Home`/`End` 首末出现帧）；2.8 侧栏隐藏 / 锁定 / 选色。
>
> **2.10 侧栏外操作入口已于 v0.10.32 落地**（执行计划见 [2026-05-22-v0.10.32-track-ops-out-of-sidebar](../docs/plans/2026-05-22-v0.10.32-track-ops-out-of-sidebar.md)）：选中 track 后，`O` / `Q` / `H` / `L` / `Ctrl+B` 可直接改 outside、occluded、hidden、locked、AI propagate；画布浮动条同步补齐消失 / 遮挡 / 锁定 / 隐藏，侧栏、快捷键和浮动条共享同一组 track actions。

### 2.9 多几何 track（polygon / polyline / mask）（**延后**；原 R9）
- 扩 `video_track.geometry.kind` → `polygon | polyline | mask`，旧 bbox track 缺省兼容；按周长 / 长度参数化插值；mask track 依赖 canvas / bitmap 能力；同步 `docs-site/dev/reference/` 与导出协议。
- **体量大、依赖点对应插值**，排在轨迹基础能力之后；DAVIS mask 导出（Phase 4.5）依赖此项。

### 2.11 采样下 propagate「N 帧」单位对齐导航网格（**v0.10.35 落地**，前端）
- **背景**：v0.10.29 起 `←/→` 在采样开启时按**网格格子**步进（`seekGrid`），但两个 propagate 对话框的「N 帧」仍按**源帧**算（`VideoTrackerPropagateDialog` 预设 10/30/60 帧 = 源帧；`VideoKeyframesPropagateDialog` `count` = 源帧）。step=10 时「30 帧」只覆盖 3 个格子，与「按 3 次 →」的心智割裂；AI 传播还会把 keyframe 写在用户导航不到的 off-grid 源帧上。
- **底层不动（D2）**：tracker / 插值仍逐源帧算、`frame_index` 仍存源帧、导出仍按网格重编号——只改**表现层**：采样开启时两个对话框的「N」改用网格格子为单位（内部乘 `step` 还原源帧范围喂后端），range 提示同时显示网格序号；可选把写回 keyframe 吸附网格。
- **只回填网格帧（v0.10.35 落地，后端）**：tracker 仍逐源帧跑 + 跨窗续追，但 `apply_tracker_results` 按项目 `derive_step` 只持久化 `frame_index % step == 0` 的预测帧（off-grid 帧丢弃），编辑器关键帧与导航/导出网格一致，避免堆满够不到的关键帧。
- 详见 [v0.10.35 计划](../docs/plans/2026-05-22-v0.10.35-video-tracker-backend-and-sampling-units.md) §A。

---

## Phase 3 · 真实 tracker / 自动标注

### 3.1 真实 SAM 2/3 video backend（原 C.6 P0，**P0 体量大**；gsam2 首发 **v0.10.35**）
- 把 v0.9.36 的 `sam2_video` / `sam3_video` 协议桥接到真实模型服务（grounded-sam2 / sam3-backend 实现 `/predict context.type="video_tracker"`）：
  - 输入：`task.file_path` + `from_frame/to_frame` + `direction` + `prompt` + `source_geometry`；
  - 输出：逐帧 `{frame_index, geometry, confidence, outside}`（frame_index 为源帧号，D2）。
- GPU profile 覆盖 30s@30fps / 10min / 长 segment 分窗；OOM / timeout / backend 5xx 在 `video_tracker_jobs.error_message` 可诊断。
- **不做**：不把 predictor 加进 `apps/api`（遵循 [ADR-0012](../docs/adr/0012-sam-backend-as-independent-gpu-service.md)）。

**复用边界（2026-05-22 调研结论）**：
- ✅ **协议 + 平台管线 100% 复用**：同一 `POST /predict`（`context.type="video_tracker"` 分流）、同一 `MLBackendClient`、同一 1:N backend 注册（v0.10.3）；`video_tracker_jobs` + [`video_tracker_runner.py`](../apps/api/app/services/video_tracker_runner.py) 分窗调度 + Redis 事件 + 低置信度自动 `outside` + Mock adapter 全就位。平台侧基本不动。
- ❌ **backend 推理代码要新写**：现有两个 backend 收到 `video_tracker` 都 422。SAM2 视频要用 **`build_sam2_video_predictor` + `SAM2VideoPredictor`**（带跨帧 memory bank 的**有状态**预测），**不是循环调图片接口**；不复用 `EmbeddingCache`（那是 `set_image` 图片专用桶）。
- **跨窗续追（关键正确性）**：现 runner 每个窗都用**原始** `source_geometry` 重新起追（[runner:270](../apps/api/app/services/video_tracker_runner.py)），mock 无所谓但真实 video 会让窗 2..N 全从首帧框起追 → 错。v0.10.35 先走**无状态近似**：runner 把上一窗末帧 geometry 作为下一窗 seed 续追（实现简单、容错好、边界略漂）；后续再上 session/context-token 让 backend 跨窗保状态。
- **显存（已拍板）**：video predictor 与图片模型**权重独立**（两份对象 + 视频会话 memory bank，即便共用同一 checkpoint / Hiera encoder）。**先在 gsam2 同容器内放独立池 / 独立显存预算**（不塞进按 `(sam,dino)` 分桶的图片 `ModelPool`），与图片池**并存**、互不驱逐；按 job 结束释放会话状态（不复用图片 idle watcher）。显存吃紧时再退到"共享预算、互相驱逐、同时只留一个"。
- **观测（独立池的应有之义）**：video 独立池**必须在 `/health` 暴露**（video 池显存 / 已加载 / 会话数，与图片池分列）+ `/metrics` 加 `task_type` 维度，否则模型市场观测只看到显存被占却不知是谁占。这半部分并进 v0.10.35 §B；模型市场前端的 image/video 分类 + 视频追踪任务聚合监控页见下文 **v0.10.36** 章节。
- **首发范围**：v0.10.35 只做 gsam2 `sam2_video`；`sam3_video` 待 SAM3 video 能力随后跟进（新约束同上）。详见 [v0.10.35 计划](../docs/plans/2026-05-22-v0.10.35-video-tracker-backend-and-sampling-units.md) §B。

### 3.2 Tracker Registry UI（原 R23）
- 管理员侧 tracker adapter 注册 / 启停 / 显示当前 backend；与 v0.10.3 ML Backend 1:N 管理形态一致。
- **video tracker 模型尺寸（sam_variant）选择**（计划 v0.10.36）：后端基础设施已就绪——`video_pool` 按 `sam_variant` 分桶、`video_predictor(sam_variant=...)` 可加载 tiny/small/base_plus/large；缺的是请求链路传参：`VideoTrackerPropagatePayload` 无 `sam_variant` 字段 → adapter context 只发 `model_key` → 后端永远用默认 tiny。补齐 = 纯 plumbing（propagate 对话框加变体下拉，复用图片侧 `paramsSchema`/`aiVariant` 模式 → payload → adapter context → 后端 `/predict` video_tracker 分支读 `sam_variant` → `video_pool.get(variant)`）。
  - **现状（2026-05-22）**：图片工作台的悬浮 AI 面板（变体 + 阈值 SchemaForm）对视频任务**显式禁用**（[`WorkbenchShell.tsx`](../apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx) `aiPopover.open = aiPopoverOpen && !isVideoTask`，**by design**）；视频的 AI 入口是 `VideoTrackerPropagateDialog`（Shift+T），尚无变体选择。

### 3.3 图片 / 视频 tracker 协议统一收口（原 I20.4，跨模态；v0.11.0）
- 视频侧 `/video-tracker-jobs` 协议与图片 setup 收口为同一 `supported_capabilities` 数组；放 v0.11.0 协议统一窗口做。
- **现状痛点（2026-05-22 调研）**：图片/视频**完全共用**单表 `MLBackend` + 单套注册/绑定 UI（`MlBackendsSection` / wizard `Step4Ai`），`Project.ml_backend_id` 单值绑定，平台**不区分模态**——`MLBackend` 无 modality 字段、绑定时不校验已有的 `Project.data_type`；`sam2_video`/`sam3_video` 是**写死在** [`video_tracker_adapters.py` `_REGISTRY`](../apps/api/app/services/video_tracker_adapters.py)，backend 无法自报支持哪些 tracker。→ 视频项目可能误绑只支持图片的 backend；用户不知道 backend 支持哪些 tracker；加新 tracker 要改代码发版。
- **统一目标**：backend `/setup` 自报 `supported_capabilities`（含 `{type:"video_tracker", model_key, media_type}`）；平台动态读取替代写死 `_REGISTRY`；注册/绑定按 `data_type` 过滤校验；wizard 按模态推荐。
- **演进路径（关键）**：**不在 v0.10.35 重构注册流程**（会与本统一窗口撞车、提前固化错误抽象）；v0.10.35 §B.3 先让 backend `/setup` 声明 `supported_trackers`，是本统一收口的**第一块砖**，平台动态消费 + 模态校验 + wizard 过滤留到 v0.11.0。

---

## v0.10.36 · 模型市场观测增强（image / video 分类 + 视频追踪任务聚合）

> 承接 v0.10.35 §B 的 `/health` video 池暴露（容器观测层已就位），本版本补**前端分类**与**任务观测层**。

- **模型市场 image/video 标题分类**：`ObserveBackendsPanel` / `VariantPanel` 消费 v0.10.35 暴露的 `video_pool` + `task_type` 指标，按「图像推理 / 视频追踪」分组展示（cache 命中、延迟、显存按模态拆分）。
- **视频追踪任务聚合监控**：`video_tracker_jobs` 当前只在工作台单 job badge 显示、**无聚合视图**（对比图片侧 preannotate jobs 已有聚合）。新增聚合查询端点 + 监控页（active / running / completed / failed 计数、error_message、按 model_key/项目分组），形态对齐图片侧任务监控。
- **video tracker 模型尺寸选择**：见 Phase 3.2 的 sam_variant 选择项（后端已就绪，补 propagate 对话框变体下拉 → payload → adapter → backend 的 plumbing）。
- **不做**：协议统一（Phase 3.3）、模态校验（Phase 3.3）；本版本纯观测增强，不改注册/绑定。
- 详见 [v0.10.36 计划](../docs/plans/2026-05-22-v0.10.36-model-market-tracker-observability.md)。

---

## Phase 4 · 视频导出（D3 落地）

> **4.1 + 4.2 导出端 + 4.3 + 4.4 + 4.7 已于 v0.10.31 落地**（执行计划见 [2026-05-21-v0.10.31-phase4-video-export-plan](../docs/plans/2026-05-21-v0.10.31-phase4-video-export-plan.md)，详情见 [CHANGELOG v0.10.31](../CHANGELOG.md)）：
>
> - 4.1 视频并入异步 zip 管线（`manifest.json` + `annotations.json` + `fetch_videos.py`），修掉误用 YOLO 图片入口；4.7 前端格式选项扩 Video JSON / AAP / MOT / KITTI。
> - 4.2 **导出端**：AAP schema 升 1.2，task 层 `media_type` + `video` 子块，`video_track` geometry 无损透传（envelope 不拆，D3）。
> - 4.3 MOT 16/17/20（`gt.txt` + `seqinfo.ini`）/ 4.4 KITTI Tracking 2D，整数 id 用 `derive_track_number`，按采样网格重编号（D2）、outside 帧省略；附 `fetch_frames.py`（ffmpeg 抽 `img1/`，D1 不物理打包帧）。
> - **统一映射约定**（已落地于 [export_video.py](../apps/api/app/services/export_video.py) 顶部）：MOT 省略 outside 帧 / occluded 仍输出；KITTI 用 occluded 列；帧号 MOT 1-based、KITTI 0-based。

### 4.2 导入端（**延后**）
- `internal_geometry_to_ls_shape`（[`predictions_import.py`](../apps/api/app/services/predictions_import.py)）当前仅 bbox/polygon/multi_polygon，`video_bbox`/`video_track`/`skeleton` 进 errors[]；接通 video_track 导入需新增 tool_unit 实现端，跟 §A「predictions import / AAP JSON 适配新几何」同窗口做。

### 4.5 DAVIS mask 序列（原 R22 + C.6 P2，**依赖 Phase 2.9**）
- 逐帧 PNG mask 序列，依赖多几何 mask track（Phase 2.9 / R9）；mask track 未落地前不做。

### 4.6 Segment 导出聚合（后端，原 C.6 P1）
- `Annotation` 查询 / 导出按 `segment_id` 或 frame range 聚合；跨 segment 合并按 `frame_index` 排序，outside / prediction keyframe 不丢；overlap 区间元数据为 Phase 5 / IAA / IDF1 预留。
- Video Tracks JSON 作内部稳定格式，MOT/KITTI/DAVIS 从它派生。

---

## Phase 5 · 长视频协同与 overlap（原 R11 / R21 + C.6 P1 Segment 底座）

- segment 切换 UI、单段单人 lock 只读提示、overlap 区 IAA / IDF1 报告；Presence 可选，**不做 OT / CRDT**。
- 后端 segment 导出聚合（Phase 4.6）为本 Phase 提供 overlap 元数据底座。

---

## Phase 6 · Track 级质量评估（原 R24 + C.6 P2 worker）

- MOTA / IDF1 / HOTA 评估 worker，按 track / segment / chapter 输出错误定位；时间轴错误定位 UI。
- 与 Phase 5 overlap 和长期规划 L15「标注质量 AI 审计」打通。

---

## 执行顺序与优先级

| Phase | 主题 | 原 ROADMAP 对应 | 优先级 | 备注 |
|---|---|---|---|---|
| 1 ✅ | 导入与帧采样（D1/D2） | R20 / C.6 P1(timetable/frameStep/chapter/warmup) / R5.3 | P0/P1 | v0.10.29 落地；WebCodecs demux 接入延后 |
| 2 ✅ | 轨迹工具对齐 CVAT | R16 / R9(暂缓) + 新增 2.1/2.6/2.7/2.8 | P0/P1 | 2.1–2.8 v0.10.30 落地；**2.9 多几何 track 延后** |
| 3 | 真实 tracker backend | C.6 P0 / R23 / I20.4 | P0(体量大) | 遵循 ADR-0012 不入 apps/api |
| 4 ◑ | 视频导出（D3） | R22 / C.6 P2 / §A AAP video_track 导入 | P1 | 4.1+4.2 导出端+4.3+4.4+4.7 v0.10.31 落地；**4.2 导入端 / 4.5 DAVIS(依赖 2.9) / 4.6 Segment 延后** |
| 5 | 长视频协同 overlap | R11 / R21 / C.6 P1 segment | P1 | 不做 OT/CRDT |
| 6 | Track 质量评估 | R24 / C.6 P2 worker | P2 | 与 L15 打通 |

> **不做清单**（与决策底线一致）：物理重采样新视频（D1）、AAP 拆三格式（D3）、predictor 进 apps/api（ADR-0012）、OT/CRDT 协同、ffmpeg.wasm/Broadway.js、Skeleton 无限嵌套、自维护 25 种格式（新格式走 datumaro 中转）。

---

## 关键文件索引（开工锚点）

| 关注点 | 文件 | 说明 |
|---|---|---|
| 视频元数据 | `apps/api/app/schemas/task.py:9` | `fps/frame_count/duration_ms/...` |
| 帧服务模型 | `apps/api/app/services/video_frame_service.py` | `VideoFrameIndex`/`VideoChunk`/`VideoFrameCache` |
| 媒体 worker | `apps/api/app/workers/media.py:566` | timetable 生成 |
| track geometry | `apps/api/app/schemas/_jsonb_types.py:337-371` | `VideoTrackKeyframe`/`VideoTrackGeometry` |
| track 服务 | `apps/api/app/services/annotation.py:629` | `split_track`/`merge_tracks`/`aggregate_bboxes` |
| tracker job | `apps/api/app/db/models/video_tracker_job.py:20` | `from_frame/to_frame/direction/prompt` |
| tracker adapter | `apps/api/app/services/video_tracker_adapters.py:39` | `propagate()` 协议 |
| 视频导出 | `apps/api/app/services/export.py:153` | `export_video_tracks`（裸 JSON，待并入 zip） |
| AAP schema | `apps/api/app/schemas/aap_json.py:33` | `schema_version 1.1`，待加 `media_type` |
| 导入适配 | `apps/api/app/services/predictions_import.py` | `internal_geometry_to_ls_shape`（video_track 进 errors[]） |
| 前端 stage | `apps/web/src/pages/Workbench/stage/VideoStage.tsx` | 按帧请求图片 |
| track 类型 | `apps/web/src/pages/Workbench/stage/videoStageTypes.ts` | `VideoTrackAnnotation`/`VideoTrackPreview` |
| 插值 | `apps/web/src/pages/Workbench/stage/videoStageGeometry.ts:131` | 线性插值 + LRU |
| 时间轴 | `apps/web/src/pages/Workbench/stage/videoTrackTimeline.ts` | keyframes/outside/interpolated/density |
| 导出 UI | `apps/web/src/pages/Dashboard/ExportSection.tsx:94` | video-track 强制 Video JSON |
