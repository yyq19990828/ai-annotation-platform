# Epic 草案 · 视频追踪多目标化 + SAM 能力扩充

状态：**草案（2026-07-07）**。把视频 tracker 链路从「单 annotation 单 track」升级为**一次追踪产出多条 track**，并借此
接线级扩充 sam2_video 的既有 vendor 能力（多目标 / point-seed / mask 输出 / 真实 confidence）+ 接上 sam3.1_multiplex
的多目标视频追踪。**这是一个横跨前后端、多版本的 epic**，本文件只定骨架、证据、分期与待决策点，不是单版本可完结。

关联计划：
- [v0.21.19 sam3_video 文本驱动追踪](2026-07-05-v0.21.19-sam3-video-text-tracking.md)——text-driven 前哨，其 PR3/PR4
  （sam3.1 multiplex backend + seeding）是本 epic「能力线 B」的一部分。
- [v0.21.20 多几何 track](2026-07-05-v0.21.20-multi-geometry-track.md)——mask/polygon 输出，本 epic「能力线 A」的
  mask 输出项归它，不重复。
- detect-then-track（memory `project_detection_tracking_epic`，「真实工作量在落库不在 backend」）——**detect-then-track
  天生多目标，也依赖本 epic 的多目标底座**，三条线共享同一公共依赖。

## 动机：三条能力线撞同一个瓶颈

调研四份（sam2_video 能力 / sam3 权重 / 后端 track 链路 / 前端消费）交叉结论：**平台想暴露的三种多目标能力，全部卡在
同一个「单 annotation 单 track」平台侧硬假设上，而 backend 侧能力早已具备。**

| 能力线 | backend 现状 | 卡点 |
|---|---|---|
| **A · sam2_video 多目标** | vendor `SAM2VideoPredictor` 原生支持任意 `obj_id`、propagate 返回 `[num_obj,…]`；平台 wrapper 硬编码 `_OBJ_ID=1` 只取 obj[0]（`grounded-sam2-backend/video_predictor.py:62,254`） | 平台单 track 落库 |
| **B · sam3.1 multiplex 多目标** | `sam3.1_multiplex.pt` 是 Object Multiplex 多目标视频模型（`RELEASE_SAM3p1.md`，128 目标 ~7x），backend 视频端点尚未实现 | backend 未建 + 平台单 track 落库 |
| **C · detect-then-track**（相邻 epic） | 检测式追踪天然多目标 | 平台单 track 落库 |

## 核心洞察：数据模型已就绪，真瓶颈只有两处（带证据）

**好消息——大半改造面不存在：**

| 层 | 结论 | 证据 |
|---|---|---|
| **DB annotation/几何** | 多 track = 多 annotation 行，`video_track_bbox` 结构复用，**annotation 表不改** | 一个 Annotation = 一个 geometry = 一条 track（`_jsonb_types.py:455-470 VideoTrackGeometry`，`track_id` 已是一等标识；`types/index.ts:246-253`） |
| **协议契约** | `/predict` 返回带 `instance_id` 的 bbox 序列**已声明**，无需改 | `capability_registry.py:288-296` |
| **前端画布/时间轴** | 已能渲染任意多 track、时间轴已按多 track 聚合，**几乎零改** | `VideoKonvaStage.tsx:410 filter(isVideoTrack)`；`videoTrackTimeline.ts:93 buildGlobalTimelineDensity` |
| **前端几何回填** | job 完成靠 `invalidateQueries(["annotations",taskId])` 整体重拉，多 track 天然可见，**零改** | `useVideoTrackerJobs.ts:145-147,231-233` |

**真瓶颈——只有两处 + 一处透传：**

1. **后端 runner 分组落库（核心工作量）** `video_tracker_runner.py:128-317`：
   - `apply_tracker_results`（`:128-186`）现在把每帧 bbox append 成**一个** `video_track_bbox` 的 keyframes 写回**那一个**
     annotation，**无 instance 分组、无新目标建 annotation**。需改为按 `instance_id` 分组，每组落**独立 annotation**：
     首个 instance 覆盖 source，新 instance **新建 annotation 行**（label 继承 / source 标记 / 审阅归属——需产品决策）。
   - 跨窗续追（`:275-317`）从单 `last_bbox` 状态 → **per-instance last_bbox 字典**，每 instance 独立判 outside/终止。
   - 中途新出现的 instance（某窗才检测到）如何回填/起始标记。
2. **前端发起入口（真 UI 改造，仅模式 b 需要）** `videoTracker.ts:46`：`annotationId` 编在 URL path 是单 track 假设的**根**，
   决定上游发起 UI（`VideoTrackerPropagateDialog` 单 `annotation`、Ctrl+B `useWorkbenchShellModel.tsx:741-744`、右键
   `useVideoTrackActions.ts:100-103`）与下游 job 归属（`useVideoTrackerJobs.ts` 单 `annotationId` 键、badge 挂载）全以单
   annotation 为轴。
3. **adapter 透传 instance_id（中等）** `video_tracker_adapters.py`：`TrackerFrameResult`（`:15-20`）加 `instance_id`；
   `_frame_result_from_payload`（`:134-156`）读 payload 的 `instance_id`（**当前直接丢弃**）；分组逻辑放 runner。
4. **job 表 annotation_id 外键（迁移，仅模式 b 必须）** `db/models/video_tracker_job.py:38-43`：job 现在单
   `annotation_id` NOT NULL 外键（job:annotation 实际 1:1）。**模式 a（单 seed 发起、自动发现）下 job 仍锚单 source
   annotation，产出的新 track 靠新建 annotation 承载、不必回挂 job 外键，可不迁移**；仅模式 b（一次发起多 seed）需把
   外键改列表/关联表 + alembic 迁移。此项归属取决于模式决策，不是模式 a 的阻塞。

**现成参照（显著降风险）**：平台**已有一条跑通的多目标写路径**——检测式追踪 ingestion：backend 一次返回多条带
`track_id` 的 `video_track_bbox`，worker `for pred in results` 循环把每条落成**独立 annotation**（`prediction.py:179-226
to_internal_shape`、`workers/tasks.py:314,878`），`_new_track_id`（`annotation_propagation.py:45-47`）是检测/交互/3D 三路
共用的全局 track_id 工厂。**runner 交互式多目标化 = 把这套「多 track→N annotation」心智搬到 `apply_tracker_results`**，
落库分组逻辑有直接参照，不是从零设计。

## ⚠️ 必须先定的产品语义岔路（决定 epic 结构）

多目标有两种触发模式，改造面差异很大，**epic 拆分前需先拍板**：

- **模式 a · 自动发现**：用户框一个 / 给 text，backend 自动发现同类多目标并各自成 track。
  - 是 **sam3 text-driven / detect-then-track 的自然形态**；sam2_video 也可「框一个、传播中自动分裂出新目标」。
  - 改造面：**只需 runner 分组 + adapter 透传，不改入口 URL / 发起 UI**。前端零 UI 改造（重拉即见多 track）。
- **模式 b · 主动多 seed**：用户一次框多个目标 / 给多个 seed 主动发起。
  - 改造面：**额外**要新增 task 级批量 propagate 端点（`annotationId` 移出 URL path）、payload 带 `seeds[]`、画布多选/圈多框
    交互、job↔多 track 归属重设计。是架构级 + 交互级改动。

**✅ 已定（2026-07-07）：模式 a 优先落地，模式 b 单列后续。** 理由：① 模式 a 吃到 sam3.1 multiplex / detect-then-track
的核心红利（多目标自动发现）且**前端零 UI 改造**、后端只动 runner+adapter；② 模式 b 收益（主动多 seed）增量，但要动
URL 架构 + 多选交互，性价比低；③ 两者不冲突，模式 a 的多目标底座是模式 b 的前置。**据此：本 epic 阶段 0/A/B 全部走
模式 a，job 表 annotation_id 外键不迁移；模式 b 归阶段 M（可选，后续）。**

## Epic 分期（草案，待模式决策后定版本号）

### 阶段 0 · 多目标落库底座（公共依赖，模式 a）
- adapter 加 `instance_id` 维度 + `_frame_result_from_payload` 读取（透传）。
- runner `apply_tracker_results` 按 instance 分组落库 + 新 instance→新 annotation 创建策略。**✅ 归属策略已定
  （2026-07-07）：新 track 继承 source annotation 的 label，标 `source=ai_tracker`，默认不强制进 review**（与现有 tracker
  落库一致）。**复用检测式路径的「多 track→N annotation」落库参照 + `_new_track_id` 工厂**（见核心洞察节），不从零设计。
- runner 跨窗 per-instance last_bbox 状态。
- **验证**：单 seed 发起 → backend 返回多 instance → 落成多条 annotation → 画布/时间轴自动显示（前端零改验证）。

### 阶段 A · sam2_video 接线级扩充（依赖阶段 0）
- **A0. 多目标**：grounded-sam2 wrapper 解除 `_OBJ_ID=1` 硬编码、propagate 输出全 obj，`/setup` 的
  `supported_prompts`/多目标标志扩声明。
- **A1. 真实 confidence**：`video_predictor.py:169` 写死 `0.0/1.0` → 模型真实 IoU/object score（独立小改进，可先落）。
- **A2. point seed / box+point refine**：wrapper 加 `seed_points` 参数、`/setup` `supported_prompts` 加 `point`（交互增强）。
- **A3. mask 输出** → **不在此 epic，归 [v0.21.20](2026-07-05-v0.21.20-multi-geometry-track.md)**（避免重复）。

### 阶段 B · sam3.1 multiplex 多目标视频（依赖阶段 0 + v0.21.19 PR1/PR2 协议前端）
- **B1. sam3.1 video backend**（= v0.21.19 PR3）：sam3-backend 新建 `video_predictor.py` +独立显存池，加载
  `build_sam3_multiplex_video_model` + `sam3.1_multiplex.pt`（gated license + `SAM3_DOWNLOAD_VIDEO=1`）。**显存硬约束**：
  图像 sam3.pt ~5.8GB 常驻 + 视频 multiplex ~3.2GB，单卡紧张，需 idle 让渡或分卡。
- **B2. multiplex 多目标消费**（= v0.21.19 PR4 升级）：runner 消费 multiplex 的多 instance 输出（阶段 0 底座已就绪，
  此处**直接吃到多目标红利**，不再是 v0.21.19 里「首切片只取单目标」的降级）。

### 阶段 M（可选，后续）· 模式 b 主动多 seed
- task 级批量 propagate 端点、payload `seeds[]`、画布多选/圈多框、job↔多 track 归属重设计。**仅在产品确需时启动。**

## 风险

- **产品语义未定阻塞分期**：模式 a/b 岔路（见上）不先定，阶段边界画不准。**这是草案推进的首要前置。**
- **新 annotation 创建策略牵动审阅链路**：多目标新建的 annotation 的 label 分配 / `source` 标记 / status / 是否进 review，
  需与现有 annotation source 体系对齐，是 runner 改造里最容易漏的产品面（非纯技术）。
- **sam3.1 显存硬约束**：图像+视频权重单卡同容（~9GB+），是 B1 的真实部署风险，可能需分卡或 idle 让渡。
- **multiplex 多目标 vs 单 track 消费错配（已被本 epic 消解）**：v0.21.19 首切片按单目标降级消费 multiplex，是因为当时无
  多目标底座；本 epic 阶段 0 落地后该降级消除——**这正是把两件事合成一个 epic 的价值**。
- **job/进度归属展示（模式 a 也需微调）**：几何回填对多 track 透明，但 job badge 现在一个挂一个 annotation
  （`useVideoTrackerJobs.ts:256-265 byAnnotation`），一个 job 产出多 track 时 badge 挂哪条 / 是否聚合，需小设计（非阻塞）。

## 决策记录 + 开放问题

**✅ 已定（2026-07-07）：**
1. **触发模式**：模式 a（自动发现）优先，模式 b（主动多 seed）归阶段 M 后续。
2. **新 track 归属**：继承 source 的 label + `source=ai_tracker` + 默认不进 review。
3. **detect-then-track 不共建公共底座（解读 A · 松耦合）**：阶段 0 的交互式 runner 自己写分组落库，**只共享
   `_new_track_id` 工厂 + 「多 track→N annotation」落库心智参照**，不把已上线的检测式路径（`prediction.py` /
   `workers/tasks.py`）重构成共享服务——避免为整洁付回归风险，且两条链路节奏不同（SSE 逐窗实时 vs worker 批量）本就该分开。
   「抽公共底座」作为两条链路都稳定后的**可选重构留档**，不进本 epic。

**待拍板：**
4. **版本号编排**：阶段 0/A/B 各占哪些 v0.21.x/v0.22.x？（B 与 v0.21.19 PR3/PR4 合并还是并列？）
