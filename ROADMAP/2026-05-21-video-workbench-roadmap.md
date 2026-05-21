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

> 现状：`VideoTrackGeometry`（[`_jsonb_types.py:359`](../apps/api/app/schemas/_jsonb_types.py)）已有 `track_id`(自动 `trk_<uuid>`, 只读) + `keyframes[{frame_index, bbox, source, absent, occluded, attributes}]` + `outside` 区间；前端线性插值；`split_track`/`merge_tracks` 后端有实现（[`annotation.py:629`](../apps/api/app/services/annotation.py)）但**无 UI**；geometry 仅 bbox。
>
> 下表是对齐 CVAT 的能力盘点：✅已有 / ⚠️半成品 / ❌缺。本 Phase 聚焦低成本高收益 + 解锁 MOT 导出的项。

### 2.1 显式可编辑 ID（❌ → 做，**优先**）
- 现 `track_id` 是只读 uuid，对标注员无意义。拆成两个概念：
  - **`track_number`（整数，任务内连续，后端确定性派生）**：导出 MOT/KITTI 必须（见 Phase 4）；按 track 在任务内的稳定排序派生，不持久化也行（导出时算）。
  - **用户可编辑语义 ID/标签**（如 `car_3`）：放 `VideoTrackGeometry` 新字段或 annotation 属性，用于跨任务 Re-ID 心智；不参与内部主键。
- 内部 `track_id` uuid 保持只读不变（D2 同源思路）。

### 2.2 outside / occluded 语义收敛（⚠️ → 做）
- CVAT 三态：`outside`（目标离开画面，轨迹暂停）/ `occluded`（在画面但被遮，仍画虚线框）/ `keyframe`（手动 vs 插值）。
- 本平台现有 `outside`（区间）+ `occluded`（逐关键帧）+ **多出一个 `absent`，与 outside 语义重叠**。
- 决策：借此次收敛掉 `absent`，对齐 CVAT 两态（outside 区间 + occluded 逐帧）。`videoTrackOutside.ts` 已有"遗留 absent 标志转 outside 范围"兼容逻辑，可平滑迁移。

### 2.3 track 级 vs 帧级属性 UI 暴露（✅ 已有，缺 UI）
- 数据层已支持：track 默认属性 + `mutable=true` 走 `keyframe.attributes`（v0.10.6）。仅需属性面板把"此属性逐帧可变"显式呈现。

### 2.4 split / merge UI（⚠️ 后端有、缺 UI；原 R16 / V6）
- 时间轴右键 / 快捷键：在当前帧 split track 成两条；选中两条 merge（帧号不重叠）。后端 `split_track`/`merge_tracks` 直接接通。

### 2.5 Track Join / Re-ID 跳连（❌；原 R16）
- tracker 完成后补两段 track 之间的 gap 跳连判定；与 split-merge 共享 UI 模式。

### 2.6 Propagate（复制到后续 N 帧）（❌，新，低成本高频）
- CVAT 高频操作：当前帧画一框，一键铺到后续 N 帧（作为关键帧或 held）。纯前端 + 现有 keyframe upsert。

### 2.7 Track 导航（❌，新）
- 跳到该 track 的下一个/上一个关键帧；跳到目标"首次出现 / 消失"帧。

### 2.8 侧栏 track 隐藏 / 锁定 / 选色（❌，新，纯前端）
- 每条 track 可单独隐藏 / 锁定；颜色按 track 还是按类可切。

### 2.9 多几何 track（polygon / polyline / mask）（❌；原 R9，**本期暂缓**）
- 扩 `video_track.geometry.kind` → `polygon | polyline | mask`，旧 bbox track 缺省兼容；按周长 / 长度参数化插值；mask track 依赖 R5.2/R5.3 canvas / bitmap 能力；同步 `docs-site/dev/reference/` 与导出协议。
- **体量大、依赖点对应插值**，排在轨迹基础能力之后；DAVIS mask 导出依赖此项。

---

## Phase 3 · 真实 tracker / 自动标注

### 3.1 真实 SAM 2/3 video backend（原 C.6 P0，**P0 体量大**）
- 把 v0.9.36 的 `sam2_video` / `sam3_video` 协议桥接到真实模型服务（grounded-sam2 / sam3-backend 实现 `/predict context.type="video_tracker"`）：
  - 输入：`task.file_path` + `from_frame/to_frame` + `direction` + `prompt` + `source_geometry`；
  - 输出：逐帧 `{frame_index, geometry, confidence, outside}`（frame_index 为源帧号，D2）。
- GPU profile 覆盖 30s@30fps / 10min / 长 segment 分窗；OOM / timeout / backend 5xx 在 `video_tracker_jobs.error_message` 可诊断。
- **不做**：不把 predictor 加进 `apps/api`（遵循 [ADR-0012](../docs/adr/0012-sam-backend-as-independent-gpu-service.md)）。

### 3.2 Tracker Registry UI（原 R23）
- 管理员侧 tracker adapter 注册 / 启停 / 显示当前 backend；与 v0.10.3 ML Backend 1:N 管理形态一致。

### 3.3 图片 / 视频 tracker 协议统一收口（原 I20.4，跨模态）
- 视频侧 `/video-tracker-jobs` 协议与图片 setup 收口为同一 `supported_capabilities` 数组；放 v0.11.0 协议统一窗口做。

---

## Phase 4 · 视频导出（D3 落地）

> 现状不一致：图像 COCO/YOLO/VOC/AAP 走异步 zip 管线（manifest + fetch_images + 缓存）；**视频导出是异类**——[`export_video_tracks`](../apps/api/app/services/export.py)（`export.py:153`）直接返回**裸 JSON 不打 zip**，仅 keyframes/all_frames 两模式，无 MOT/KITTI/DAVIS。

### 4.1 视频并入 zip 管线（先做，消除历史不一致）
- 视频项目也产出标准 zip：`manifest.json` + `annotations.json`(AAP) + 视频回源脚本，与图像共用异步打包 / 缓存 / 指纹基建（`export_packaging.py` / `workers/export.py`）。

### 4.2 AAP 单信封模态感知（D3，原 §A「AAP JSON video_track 导入支持」并入）
- envelope **不拆**，task 层加 `media_type`（image/video/lidar）判别字段；视频专属元数据（采样配置 / fps / 时间表 / segment / chapter）放 task 层 `video` 子块，仍在同一 envelope、同一 importer。
- 导出端：`AAPAnnotationEntry.geometry` 原样承载 `video_track`（已无损透传），补 `video` 子块元数据。
- 导入端：`internal_geometry_to_ls_shape`（[`predictions_import.py`](../apps/api/app/services/predictions_import.py)）当前仅 bbox/polygon/multi_polygon，`video_bbox`/`video_track`/`skeleton` 进 errors[]；本 Phase 接通 video_track 导入。schema 已带 `tool_unit_id`（v0.10.17 1.1），新增 tool_unit 实现端接通即可。
- 触发与 §A「predictions import / AAP JSON 适配新几何」同窗口。

### 4.3 MOT 16/17/20 CSV（原 R22 + C.6 P2 后端）
- 格式：`frame,id,bb_left,bb_top,bb_w,bb_h,conf,x,y,z`，**强依赖 Phase 2.1 整数 `track_number`**。
- MOT challenge 目录布局：`{sequence}/gt/gt.txt` + `{sequence}/seqinfo.ini`（写 frameRate / 分辨率 / 帧数），可直接喂 trackeval 工具链。
- **与 Phase 1 采样耦合**：若 10fps 采样自 60fps，`seqinfo.frameRate=10`、帧号在采样网格上重排 1..N（体现 D2 的"导出时重编号"）；outside 帧从 gt 省略。

### 4.4 KITTI Tracking（原 R22 + C.6 P2）
- 2D 版相对简单，与 MOT 同窗口；空格分隔逐帧 + track id + type + truncated/occluded + bbox。

### 4.5 DAVIS mask 序列（原 R22 + C.6 P2，**依赖 Phase 2.9**）
- 逐帧 PNG mask 序列，依赖多几何 mask track（Phase 2.9 / R9）；mask track 未落地前不做。

### 4.6 Segment 导出聚合（后端，原 C.6 P1）
- `Annotation` 查询 / 导出按 `segment_id` 或 frame range 聚合；跨 segment 合并按 `frame_index` 排序，outside / prediction keyframe 不丢；overlap 区间元数据为 Phase 5 / IAA / IDF1 预留。
- Video Tracks JSON 作内部稳定格式，MOT/KITTI/DAVIS 从它派生。

### 4.7 前端导出选项（现状 + 扩展）
- 现 `ExportSection.tsx` 对 video-track 项目强制 Video JSON + 关键帧/所有帧两选一；扩展为可选 AAP / MOT / KITTI，沿用图像侧异步 zip 下载流。

> **统一映射约定**：outside / absent(收敛后) / occluded / prediction source 在各格式中的映射要统一定义一张表（MOT 省略 outside 帧、KITTI 用 occluded 列、DAVIS 用空 mask），避免每格式各写一套。

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
| 1 | 导入与帧采样（D1/D2） | R20 / C.6 P1(timetable/frameStep/chapter/warmup) / R5.3 | P0/P1 | "抽帧放哪"的落地；Phase 4 MOT 依赖其帧号语义 |
| 2 | 轨迹工具对齐 CVAT | R16 / R9(暂缓) + 新增 2.1/2.6/2.7/2.8 | P0/P1 | 2.1 整数 ID 是 Phase 4 MOT 前置 |
| 3 | 真实 tracker backend | C.6 P0 / R23 / I20.4 | P0(体量大) | 遵循 ADR-0012 不入 apps/api |
| 4 | 视频导出（D3） | R22 / C.6 P2 / §A AAP video_track 导入 | P1 | 4.5 DAVIS 依赖 2.9 |
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
