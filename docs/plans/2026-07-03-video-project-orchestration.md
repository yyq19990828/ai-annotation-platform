# 视频项目接入预标注编排 · 初始输入节点 + 双下游分支

状态：**定案（accepted，2026-07-03）**。承接 v0.21.1 detect-then-track（backend + 平台落库已完备、
端到端验证），解决它**缺 UI 入口**的 gap：视频项目当前进不了预标注编排 UI（`/ai-pre`「视频」tab
是交互式 `VideoTrackerJobsPanel`，编排器 `ProjectDetailPanel` 只在「图像」tab / image 项目），
视频工作台 AI 面板也未接线检测式推理。

**执行**：串行推进 Phase 1 → 2 → 3 → 4；Phase 3（tracking）在既定链 v0.21.2 → v0.21.3 之后
（见「与前置版本协同」）。

本计划把「视频项目能不能用 AI 预标」这件事，落到 ROADMAP 已定的**「初始输入节点」重构**终态上
（见 ROADMAP §编排「初始输入节点」重构 方向 B/C）。

## 目标形态（源自两点构想 + ROADMAP 终态）

**视频源 = 初始输入节点，分叉出两条按「执行单位」区分的下游分支：**

```
[视频输入节点]  data_type=video
  ├── (执行单位=frame)  → 图像编排分支：det/seg/分类 逐帧跑 → VideoBboxGeometry（frame_index）
  └── (执行单位=video)  → 视频序列分支：detect-then-track → VideoTrackGeometry（track_id + keyframes）
```

- 「输入节点」声明 **数据源 + 数据类型（image/video/…）+ 执行单位（frame/video/scene）**——正是
  ROADMAP 说的「源类型」维度的真正归宿。原「第一阶段模型」退化成有父的普通 stage（父=输入节点），
  画布不再 special-case 源 vs 阶段，`deriveSourceShape`（v0.21.1 WS0 的过渡产物）上移/退役。
- **视频序列分支** = v0.21.1 已做完的 detect-then-track（backend `type=tracker` + 平台 `_remap_track_ids`
  + `to_internal_shape`→`VideoTrackGeometry`，全链路验证过）。本计划只给它**接 UI 入口**。
- **单帧分支** = 让**图像 backend（det/seg/分类）在视频项目可用**（构想 #1）。产 `VideoBboxGeometry`
  （单帧框，`_jsonb_types.py:408`，已有 schema）。

## 核心张力（决定分期）

### 张力 ① · 单帧分支撞上被推迟的「执行单位」难题

构想 #1「单帧预标注」含两半，贵贱差极大，**必须拆开分期**：

| 子能力 | 执行单位 | 成本 | 说明 |
|---|---|---|---|
| **工作台单题运行** | 当前 1 帧（按需） | 低 | 视频工作台 AI 面板：当前帧 → 图像 backend → `VideoBbox` 候选 → 采纳。纯交互、**不 fan-out、不改执行单位**。 |
| **批量逐帧预标注** | frame（video→多帧） | **高** | 整段视频抽帧 → 图像 pipeline 逐帧 → 每帧落 `VideoBbox`。**这就是** plan 判为「最贵」的执行单位 task→frame epic（抽帧策略 / 帧寻址 / 落库量 / per-scene 聚合）。 |

结论：工作台单题先行（便宜、独立、见效快），批量逐帧作为独立 epic 隔离到最后。

### 张力 ② · 输入节点重构要改已发布的 v0.21.0 编排

两条编排分支都需画布支持「输入节点 + 执行单位字段」。这是 ROADMAP 方向 B/C 正主：
`usePipelineComposer` 的 payload 要能表达输入节点（`source: {kind, data_type, execution_unit}`），
`ProjectDetailPanel` / `GlobalPipelineLibraryPage` / `PipelineGraphCanvas` 三处渲染改造，
可达性 / `deriveDownstreamShape`（父=输入节点）随之调整。**结构机已在 v0.18/0.21 抽出共用，改一处
多页同吃**——这是 v0.21.1 WS0 去硬编码 + 抽 `deriveDownstreamShape`/`deriveSourceShape` 铺的路。

### 张力 ③ · 工作台单题与编排解耦

工作台单题是**工作台面板**，不经编排画布 → 可独立于输入节点重构先落，最快让「图像 backend 用在
视频」见效。它与视频序列分支（tracking，走编排）是两条不同的产品路径，别硬塞进一个 UI。

## 分期（价值优先 + 隔离最贵）

> 顺序原则：**便宜且独立的先行**（工作台单题）；**已备好 backend 的次之**（tracking 接入，但依赖
> 输入节点地基）；**最贵的执行单位 epic 最后**（批量逐帧）。

### Phase 1 · 视频工作台单题 AI（构想 #1 的便宜半，独立于编排）

- 视频工作台 AI 面板：对**当前帧**调图像 backend（det/seg/分类），返回候选渲染为帧标注、人工采纳
  落 `VideoBboxGeometry`（`frame_index`=当前帧）。
- **不碰**执行单位 / 输入节点 / 编排画布。交付：图像 backend 在视频项目即时可用。

**已读实（2026-07-03）· 前提「当前帧能否喂 backend」结论**：

- **当前帧像素可取 ✅**：视频工作台把帧解码成 `ImageBitmap` 缓存（`useVideoBitmapCache`，键
  `taskId:frameIndex` + `activeFrameIndex`；WebCodecs 精确解帧，`<video>` `drawImage` 兜底）。
  客户端提像素 → canvas → JPEG blob 是现成能力。
- **但送不进 backend ❌**：所有 predict 路径（`interactive_annotating` / `predict_test` / worker 批量）
  都在**服务端用 `_resolve_task_url(task)` 从 task 派生图 URL**，客户端只传 `task_id`、不传图。视频 task
  的 URL 是**整段 mp4**，图像 backend 取不到帧。
- **故 Phase 1 = 新开「对客户端传入帧图预测」一条路**（非复用图像交互 AI），含三块：
  1. 前端：当前帧 `ImageBitmap` → canvas → JPEG（现成）。
  2. **供图路径 = 帧上传（通用，已定）**：当前帧 JPEG → 上传 storage（复用 `upload_crop_bytes`
     presigned 机制）→ 拿容器可达 URL → 新 endpoint 传该 URL。**通用**（yolo/onnxtools/gsam2/sam3
     全支持 http URL），不走 `data:` 捷径（那只 yolo/onnxtools 认）——「要做就做通用全量」。
  3. 落库：候选采纳 → `VideoBboxGeometry` + 当前 `frame_index`（schema 已有）。
- **工作量定级：中等**（新 endpoint 收 client 供图 URL + 前端提帧上传 + 帧号落库），非「顺手接线」。

### Phase 2 · 初始输入节点重构（地基，ROADMAP 方向 B/C · Option B 统一画布）

- `usePipelineComposer` + payload：加初始输入节点（`source: {kind:"dataset", data_type, execution_unit}`），
  原源阶段退化成有父普通 stage。
- 画布三处（`ProjectDetailPanel` / `GlobalPipelineLibraryPage` / `PipelineGraphCanvas`）渲染输入节点 +
  执行单位徽标（节点头第二行槽位 v0.21.1 WS0 已预留）；`deriveSourceShape` 退役。
- **Option B 统一画布**：同一编排器按 `project.data_type` 派生——输入节点的 `data_type`（image/video）
  决定可选执行单位与下游分支。**不新建视频专属编排 surface**。编排器对 video 项目开放 = 让视频项目进
  现有编排项目列表，画布按 data_type 渲染。
- **最小原则**：本期只做「输入节点 + video 输入 + 执行单位=video 单分支」跑通，不预建 frame/scene
  分支 UI（那是 Phase 4）。

### Phase 3 · 视频序列分支（tracking）接入编排

- 在输入节点（data_type=video）下加 tracker stage（执行单位=video）→ 派发 detect-then-track
  （backend + `_remap_track_ids` + `VideoTrackGeometry` **已就绪**，仅缺编排派发接线）。
- `_build_predict_context` 对 `task_type=tracker` 已自动走 v2 结构化路径（v0.21.1 验证过），
  投递侧几乎不改；补 tracker 专属超时 + 独立 queue / 限并发（v0.21.1 风险项）。
- 交付：视频项目经编排跑 tracking → 落 `VideoTrackGeometry` 预标注 → 工作台渲染审核（渲染复用现成）。

### Phase 4 · 单帧分支批量逐帧预标注（执行单位 epic，最贵）

**「要做就做通用全量」——全帧批量在范围内，不降级为按需抽样。**

- 输入节点执行单位=frame：整段视频 → 全帧（或用户设采样步长，但**全量**是一等能力）→ 图像 pipeline
  逐帧 → 每帧落 `VideoBboxGeometry`。
- 打破 pipeline per-task 独立执行，逼执行单位 task→frame（+ 未来 scene 聚合）。硬点：帧寻址（帧号
  作 sub-unit）、落库量（长视频 × 全帧 × 多框，需分批 + 上限保护）、与工作台导航网格一致性、
  worker 长任务超时 / 独立 queue（同 tracking 的并发约束）。
- **体量最大，独立立项展开**（本计划先定架构位置，不细化实现）。

## 与前置版本 v0.21.2 / v0.21.3 的协同（排期约束）

既定链：**v0.21.1（检测式 tracking，✅ 已完成）→ v0.21.2（跨帧 id 统一）→ v0.21.3（删标注编组）**。
本 epic 与这条链有实质耦合，**track_id 相关部分须让位到 v0.21.2 之后**：

### v0.21.2（`track_id` 提升为 `annotation.track_id` 表列）· 影响大

- v0.21.1 把 `track_id`（`trk_<uuid>`）落在 `VideoTrackGeometry` **geometry JSON 内**（`_remap_track_ids`）；
  v0.21.2 要把它**提升为 annotation 表列**（"geometry 内先行、表列随后统一，避免迁两遍"）。本 epic 的
  **视频序列分支（Phase 3 tracking）会大量新产 track_id**——若在 v0.21.2 之前铺开，等于给其迁移堆更多
  geometry-only track_id。
- **约束**：**Phase 3（tracking 接入编排）排在 v0.21.2 之后**（或其 ingestion/accept 同时写
  `annotation.track_id` 表列）。`_remap_track_ids` 未来应写表列而非仅 geometry。
- **单帧分支**产 `VideoBbox`（无跨帧 id），与 track_id 统一**正交**；若将来要把逐帧检测跨帧连成同一
  对象，那是 track_id（v0.21.2）的活，不在本 epic。

### v0.21.3（删除 `annotation.group_id` 持久化）· 影响小，一处文件重叠

- 视频工作台**本就全靠 track_id 认对象**（v0.21.2 已核实），不碰 group_id → tracking / 单帧分支与
  group_id 删除**正交**。
- **唯一重叠**：本 epic 的 **Phase 1（工作台单题 AI）会动 `AIInspectorPanel`**，v0.21.3 WS2 也改此文件
  （去 group 分桶）+ v0.20.9 父子缩进亦重构此段 → **三处合并做，别各动一次**。

### 排期结论

本 epic 的 **track_id 触及部分（Phase 3）在 v0.21.2/v0.21.3 之后**；**输入节点重构（Phase 2）+ 单帧
分支（Phase 1/4）与 track_id 正交，可独立/并行**推进，不必等 v0.21.2。

## 不在范围（本计划）

- **检测式 track 下游逐帧 crop 分类**（frame × track 二维展开）：v0.21.1 已判后续。
- **scene 跨帧聚合源**（多帧聚合成一标注）：执行单位 per-scene，比 per-frame 更贵，独立。
- **交互式 SAM2/SAM3 video tracker**（`VideoTrackerJobsPanel`）：原样不动，与检测式两条链并存。

## 已定（2026-07-03，全部拍板）

- **供图路径 = 帧上传（通用）**，不走 `data:` 捷径（「通用全量」）。
- **批量逐帧（Phase 4）全量在范围内**，不降级为按需抽样（「通用全量」）。
- **入口形态 = Option B：一个编排画布按 `data_type` 派生**（不另造「视频编排」子视图）。同一
  `ProjectDetailPanel`/canvas 吃图像 + 视频项目，`project.data_type` 驱动输入节点与下游分支选项——
  这正是输入节点重构（Phase 2）的终态（"画布不再 special-case 源 vs 阶段"），Option A 会逆着重构再造
  并列界面故弃。导航上让视频项目进现有编排项目列表；现有交互式 `VideoTrackerJobsPanel` 两条链并存不动。
- **Phase 顺序 = 串行 1 → 2 → 3 → 4**（Phase 1 先行：独立见效、不等 v0.21.2；Phase 3 在 v0.21.2/3 后）。
