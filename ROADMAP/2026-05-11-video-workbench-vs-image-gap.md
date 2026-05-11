# 视频工作台 vs 图片工作台 · 差距盘点与优化方向

> 类型：P0 调研报告 / 优化路线图（**not yet a milestone plan**）
>
> 范围：以当前已落地的 [VideoStage](../apps/web/src/pages/Workbench/stage/VideoStage.tsx)（v0.9.16 – v0.9.20）为基线，与 [ImageStage](../apps/web/src/pages/Workbench/stage/ImageStage.tsx) 做逐项对比，沉淀下一阶段的优化方向。
>
> 与 [2026-05-11-video-workbench.md](2026-05-11-video-workbench.md) 的关系：原 Epic 写的是"先把视频闭环做起来"，本文写的是"图片工作台两年沉淀的工程能力如何向视频侧迁移"。

---

## 0. TL;DR

- VideoStage 当前约 **700+ 行**，ImageStage **1100+ 行**。规模差距背后的核心是：VideoStage 是独立重写后逐步补齐能力；v0.9.18–v0.9.20 已补上快捷键中心化、撤销重做、离线队列基线和工具语义主路径，仍缺少冲突 diff、多选、属性面板、复制粘贴、AI 采纳/驳回、Minimap、浮动 Dock、Review diff 模式等 ImageStage 工程能力。
- WorkbenchShell 通过 `task?.file_type === "video" || currentProject?.type_key === "video-track"` 一行分支切换两套 Stage（[WorkbenchShell.tsx:183](../apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L183)），两者 props 接口几乎不重合——ImageStage ~50 个 prop、VideoStage 10 个 prop。
- 视频侧 M3 已落地 QC（轨迹断裂、极小框、同帧重叠），v0.9.18 已落地 M4 Video Tracks JSON 导出和 O1 快捷键中心化，v0.9.19 已落地 track-aware 撤销重做与 offline/conflict 基线，v0.9.20 已落地 M5.0 工具语义补全主体（O11/O12/O13/O14 主路径）。
- 当前最影响后续效率的剩余短板是 **属性面板、多选、复制粘贴、Review diff、probe/poster 失败重试**；O14 的独立右键菜单与 ConflictModal 的 keyframe diff 仍是后续 UX polish。
- 建议下一阶段（暂名 M5 · 工作台基础设施统一）的核心目标：**把视频工作台从"能用的 MVP"推到"可靠可恢复的工程基线"**，再做属性、多选、复制粘贴和 AI tracker 等增量。

---

## 1. 当前能力对比矩阵

> 图例：✅ 已有 / ⚠️ 部分 / ❌ 缺失 / — 不适用

| 能力分类 | 细项 | ImageStage | VideoStage | 关键文件 |
|---|---|---|---|---|
| **基础绘制** | bbox 拖框 | ✅ | ✅ | VideoStage.tsx:333-409 |
| | polygon | ✅ | ❌ | tools/polygon |
| | SAM 智能工具 | ✅ | ❌ | tools/, useInteractiveAI.ts |
| | Canvas 批注 | ✅ | ❌ | CanvasDrawingLayer.tsx |
| **视图操作** | 缩放 / 平移 | ✅ ViewportTransform | ❌（视频固定视口） | useViewportTransform.ts |
| | Minimap | ✅ | ❌ | Minimap.tsx |
| | 浮动 Dock（缩放、Undo、适应视口） | ✅ FloatingDock | ❌ | FloatingDock |
| **编辑** | 多选 | ✅ selectedIds 数组 + Shift+Click | ❌ 仅单选 | useWorkbenchState.ts |
| | 复制粘贴 | ✅ Ctrl+C/V | ❌ | useClipboard.ts |
| | 撤销重做 | ✅ useAnnotationHistory | ✅ keyframe 级 history | useAnnotationHistory.ts / videoTrackCommands.ts |
| | 批量改类别 / 批量删除 | ✅ onBatchChangeClass / onBatchDelete | ❌ | useWorkbenchAnnotationActions.ts |
| | nudge（方向键微调） | ✅ 1px / Shift+10px | ❌（方向键被逐帧占用） | hotkeys.ts |
| **快捷键** | 工具切换 B/P/V/S | ✅ | ✅ B/T 视频工具 | hotkeys.ts |
| | 1–9 切类别 | ✅ | ✅ activeClass / 选中对象改类 | hotkeys.ts |
| | Tab 循环目标 | ✅ | ✅ 循环 track | hotkeys.ts |
| | A/D AI 采纳/驳回 | ✅ | — 视频暂无 AI 候选 | hotkeys.ts |
| | Space / ←→ 视频控制 | — | ✅ | hotkeys.ts / useWorkbenchHotkeys.ts |
| | Delete / Backspace 删除 | ✅ | ✅ 删除选中 track | hotkeys.ts |
| | hotkeys 注册中心 | useWorkbenchHotkeys | ✅ v0.9.18 已接入 video mode | useWorkbenchHotkeys.ts |
| **AI 集成** | AI 预标候选 + accept/reject | ✅ | ❌（aiDisabled={isVideoTask}, [WorkbenchShell.tsx:1258](../apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L1258)） | useInteractiveAI.ts |
| | SAM mask 输入 | ✅ | ❌ | samTextOutput.ts |
| **提交链路** | optimistic update | ✅ | ⚠️ shell 层有，但 VideoStage 自己不展示 pending 态 | useWorkbenchAnnotationActions.ts |
| | 离线队列 | ✅ useWorkbenchOfflineQueue + OfflineQueueDrawer | ✅ 视频创建 / 更新 / 重命名覆盖 | useWorkbenchOfflineQueue.ts, offlineQueue.ts |
| | 冲突 Modal | ✅ ConflictModal | ⚠️ 通用弹窗已覆盖；keyframe diff 未做 | ConflictModal.tsx |
| | 草稿持久化 | ✅ useCanvasDraftPersistence | ❌（视频无草稿概念） | useCanvasDraftPersistence.ts |
| **审核 / Review** | diffMode（raw / diff / final） | ✅ | ❌ | WorkbenchShell.tsx |
| | 评论锚定到 shape | ✅ historicalShapes / hoveredCommentShapes | ❌（评论无法锚到某一帧某条 track） | useHoveredCommentStore.ts |
| **QC / 质量检查** | bbox 越界 clamp | ✅ | ✅ clampGeom（[VideoStage.tsx:50](../apps/web/src/pages/Workbench/stage/VideoStage.tsx#L50)） | — |
| | 极小框警告 | ⚠️ | ✅ w/h < 0.003（[VideoStage.tsx:237-263](../apps/web/src/pages/Workbench/stage/VideoStage.tsx#L237-L263)） | — |
| | 同类高 IoU 重叠提示 | ⚠️ | ✅ | iou.ts |
| | 轨迹断裂（关键帧间隔过大） | — | ✅ maxGap=max(30, fps*2) | — |
| | 越界提示（区别于 clamp） | ⚠️ | ❌ | — |
| **属性 / Schema** | 属性面板（attribute schema） | ✅ | ❌ | useWorkbenchState.ts editingClass |
| | 类别筛选 / 显隐 / 锁定 | ✅ | ⚠️ 仅 track 级别可显隐 / 锁定 / 重命名（[VideoStage.tsx:571-663](../apps/web/src/pages/Workbench/stage/VideoStage.tsx#L571-L663)） | — |
| **导出** | COCO / YOLO / VOC | ✅ | ⚠️ 不输出图片格式；`format=coco` 兼容入口返回 Video Tracks JSON，YOLO/VOC 返回 400 | export.py |
| | Video Tracks JSON | — | ✅ keyframes / all_frames | export.py |
| **后端** | ffprobe 元数据 | — | ✅ workers/media.py | workers/media.py |
| | poster 缩略图 | ✅ thumbnail_path 复用 | ✅ extract_video_poster | workers/media.py |
| | manifest API | — | ✅ `/tasks/{id}/video/manifest` | — |
| | probe / poster 失败重试 | ⚠️ | ❌ 一次性失败写入 probe_error / poster_error | — |
| **测试** | 单元测试覆盖 | hotkeys / iou / polygonGeom / ResizeHandles / transforms / history / offlineQueue / interactiveAI / annotationActions ... | hotkeys video mode + VideoStage ref + ExportSection + 后端 video export | — |

---

## 2. 关键结构差异（不是 bug，是设计选择）

这部分不是优化清单，是**理解差距的前提**——避免后续把"差距"当作"bug 修复"机械迁移。

### 2.1 视口模型

ImageStage 的核心抽象是 `ViewportTransform`（`useViewportTransform.ts`），所有 box 都在一个可缩放可平移的逻辑坐标系里。VideoStage 没有 viewport——它直接把 SVG overlay 撑满 `<video>` 元素，全部用归一化坐标（0–1）渲染。

**含义**：把 ImageStage 的"缩放到 1:1 看像素"和 Minimap 直接搬到 VideoStage 不现实——视频帧太大，浏览器解码 + WebGL 缩放是另一套工程问题。**建议这部分不迁移，作为长期"高分辨率视频 ROI 编辑"独立 epic。**

### 2.2 状态模型

ImageStage 的 box 列表是"扁平 annotation 列表"，每个 annotation 一条记录。VideoStage 的 track 是"一条 annotation + 多个 keyframes"，**当前帧显示的 box 是通过 `resolveTrackAtFrame` 实时计算出来的派生数据**（[VideoStage.tsx:116-129](../apps/web/src/pages/Workbench/stage/VideoStage.tsx#L116-L129)）。

**含义**：

- 撤销重做的粒度不一样：图片侧是"撤销一个 box 的创建/删除"，视频侧需要"撤销一个 keyframe 的添加 / 修改 / 删除"，否则用户编辑 3 个关键帧之后撤销会把整条 track 都吞掉。
- 多选语义也不一样：图片是"选中多个 box 批量改"，视频里更自然的是"选中多个 track 整体改类别"或"选中同一 track 的多个 keyframes"。
- 复制粘贴：图片是"复制一个 box 粘贴到下一张图"，视频里是"复制 frame N 的 keyframe 粘贴到 frame N+k"——这是个全新的语义。

**这意味着不能简单复用图片侧的 hook，需要为 track 单独写一套 history / clipboard / multi-select 实现。**

### 2.3 快捷键的命名空间冲突

ImageStage 用 `←→` 做 nudge（box 微调），VideoStage 用 `←→` 做逐帧。如果未来把 `nudge` 也带进视频，必须用 modifier 区分（例如 `Alt+←/→` 微调 box，`←/→` 仍是逐帧）。同样的，`Space` 在图片侧是"hold to pan"，在视频侧是"play/pause"——这俩**不可能同时存在**，必须按 stage 类型分发。

**v0.9.18 状态**：`VideoStage` 已改为 `forwardRef` 暴露 `togglePlayback()` / `seekByFrames(delta)`，组件内部全局 `keydown` listener 已移除；`useWorkbenchHotkeys` 在 `videoMode` 下分发 Space、方向键、Delete / Backspace、Tab、Esc、1–9。视频快捷键已进入 `HotkeyCheatSheet` 统一帮助面板。

### 2.4 工具语义：独立 bbox vs 轨迹 keyframe（用户反馈补充 · 2026-05-11）

**用户反馈**："视频工作台的矩形框和为了轨迹而画的框，这两者语义存在矛盾。视频也应该可以画图片工作台的框（帧无关），也可以把某一段轨迹转换成单帧独立的矩形框（由各个轨迹管理自己派生出的矩形框）。轨迹工具应该单独做一个工具图标。现在每次画一个轨迹框都会自动命名为我配置的第一个类别，也无法改类，前端对轨迹的操作十分局限。"

**问题定位**：

1. **工具混在一起**。[WorkbenchShell.tsx:738-768](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L738-L768) `handleVideoCreate` 无条件生成 `video_track` geometry——VideoStage 上任何一次拖框都被当作"轨迹的第一个关键帧"。`video_bbox`（单帧独立矩形框）虽然 schema 支持（[VideoStage.tsx:74-80](apps/web/src/pages/Workbench/stage/VideoStage.tsx#L74-L80) 还在做兼容渲染），却没有任何 UI 路径能从前端创建它。
2. **类别选择被吞掉**。视频侧创建链路是 `onCreate → mutate({ class_name: s.activeClass || UNKNOWN_CLASS })`，**没有走 `pendingDrawing` 浮层**。图片侧 [WorkbenchShell.tsx:812-814](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L812-L814) 的 `pendingDrawing → handlePickPendingClass → commit` 流程在视频侧完全缺席。
3. **改类入口隐藏**。轨迹一旦落库，只能通过侧栏 [VideoStage.tsx:571-663](apps/web/src/pages/Workbench/stage/VideoStage.tsx#L571-L663) 的 rename 按钮改名。Overlay 上选中 track 没有 `handleStartChangeClass`（[WorkbenchShell.tsx:817-825](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L817-L825)）类的入口，1–9 快捷键也没有绑定到"改当前选中 track 的类"。
4. **Tool 模型未引入**。图片侧的 `Tool = "box" | "hand" | "polygon" | "canvas" | "sam"`（[useWorkbenchState.ts:5](apps/web/src/pages/Workbench/state/useWorkbenchState.ts#L5)）在视频侧完全没有等价物——VideoStage 不读 `s.tool`，全靠"是否有 selectedTrack"判断要不要给现有 track 加关键帧。

**重新设计的语义模型**：

视频工作台同时支持两种"用户视角的对象"：

| 对象 | 数据模型 | 工具 | 创建语义 | 帧间表现 |
|---|---|---|---|---|
| **独立矩形框** | `video_bbox`（已有 schema） | "矩形框" 工具（默认） | 当前帧拖框 → 浮层选类 → 落库为单帧 bbox | 只在 `frame_index` 这一帧显示，其它帧不显示 |
| **轨迹** | `video_track` | "轨迹" 工具（新增） | 第一次拖框 → 浮层选类 → 落库为 track（初始仅 1 个 keyframe）；后续 selectedTrack 状态下拖框 = 给 track 加 keyframe | 在 keyframes 之间线性插值，`absent=true` 阻断 |

**互转关系**（用户希望的"由各个轨迹管理自己派生出的矩形框"）：

- **track → bbox（拆分/烘焙）**：选中一条 track + 一个具体 frame → 右键"将此关键帧拆为独立 bbox"。从该 track 中删掉这个 keyframe，并以同一 (frame, geom, class) 落库一条 `video_bbox`。批量版本："将整条 track 烘焙为每一帧独立 bbox"——主要用于跨标注器输出对齐。
- **bbox → track（聚合）**：选中 N 条 `video_bbox`（同 class，分布在不同 frame）→ "合并为轨迹"。删除原 bbox，落库一条 `video_track` 把它们作为 keyframes。

这两个操作**不在创建路径上发生**——创建路径明确由工具选择决定，互转只在已落库对象上发生（轨迹侧栏 / 上下文菜单），降低 UI 歧义。

---

## 3. 优化方向

每条标注：**S/M/L 工程量** + **影响面** + **依赖**。条目编号（O1–O14）是稳定 ID，不随顺序调整变化。

### 3.0 已完成（v0.9.18 – v0.9.20）

> 这一节只是状态记录，已落地能力不进入后续里程碑。详细背景仍保留在文档历史里以便回溯。

- **O1 · 快捷键中心化**（v0.9.18）。`hotkeys.ts` 增加 video 命名空间；`VideoStage` 用 `forwardRef` 暴露 `togglePlayback` / `seekByFrames`，移除内部 keydown listener；帮助面板新增"视频"分组。覆盖 Space、←/→、Shift+←/→、Delete / Backspace、Tab / Shift+Tab、Esc、1–9。
- **O2 · track-aware 撤销重做**（v0.9.19）。新增 `videoKeyframe` history command：单帧关键帧的增删改 / `absent` / `occluded` 切换只回滚该 frame，不吞整条 track；创建 / 删除 / 改类仍复用 annotation 级 history。
- **O3 · offline queue / conflict 覆盖视频**（v0.9.19）。视频创建、关键帧更新、轨迹重命名在网络断开 / 5xx 时进入现有 offline queue；409 版本冲突走通用 `ConflictModal`。**剩余风险**：ConflictModal 仍无 keyframe diff 视图，留作 O3+ 后续增强。
- **O9 · M4 视频导出**（v0.9.18）。`video-track` 项目复用 `format=coco` 入口输出 Video Tracks JSON（`export_type="video_tracks"`），支持 `video_frame_mode=keyframes|all_frames`、`include_attributes=false`、后端线性插值（`absent=true` 阻断）；`yolo|voc` 在视频侧返回 400 避免语义丢失。**未做**：MOT Challenge / COCO Video 行业格式转换。
- **O11 · 视频工具栏：分离"矩形框"与"轨迹"两个工具**（v0.9.20）。新增独立 `videoTool = "box" | "track"`，B/T 快捷键切换；`box` 新建 `video_bbox`，`track` 新建 / 追加 `video_track` keyframe；默认 `box`，不污染图片侧 `Tool` 联合。
- **O12 · 视频侧接入 `pendingDrawing` + `ClassPickerPopover`**（v0.9.20）。新建视频 bbox / track 走画完选类浮层；轨迹工具下选中已有 track 时直接 upsert 当前帧 keyframe，不重复弹选类。
- **O13 · Track → video_bbox 互转入口**（v0.9.20）。新增后端事务端点，支持当前关键帧 / 整条 track 转 `video_bbox`，提供 `copy` / `split` 两种语义、`keyframes` / `all_frames` 两种粒度，并在前端 keyframe 列表与选中操作条接入。**未做**：`video_bbox → video_track` 反向聚合。
- **O8 · 删除中间关键帧入口**（v0.9.20，随 O13 合并）。轨迹侧栏 keyframe 列表支持删除 / 复制为独立框 / 拆为独立框；删除后的插值预览未单独做。
- **O14 · Overlay 选中对象后的改类与轻量操作条**（v0.9.20 主路径）。1–9 在有选中视频对象时改选中对象类，否则切 activeClass；overlay 选中后提供改类、复制/拆分当前帧、整条复制/拆分、删除等操作。**未做**：独立右键菜单。

### 3.1 第一档 · 工具语义补全（用户反馈 · v0.9.20 已完成主路径）

> 直接回应 §2.4 用户反馈。v0.9.20 已完成对象语义主路径；本节保留原计划与状态标记，便于后续继续补右键菜单、bbox→track 聚合等尾项。

#### O11 · 视频工具栏：分离"矩形框"与"轨迹"两个工具
> **状态**：v0.9.20 已落地。采用独立 `videoTool` 字段，B/T 切换；默认 `box`；已有 `video_bbox` 与 `video_track` 均持续显示。

- **痛点**：见 §2.4——任何拖框都被当作 track，`video_bbox` schema 存在但前端无创建入口。
- **方案**：
  - VideoStage 接入 `s.tool`：扩展 `Tool` 联合（新增 `"track"`）或并行 `videoTool` 字段。视频工作台增加工具切换图标——"矩形框 B" / "轨迹 T"。
  - `handleVideoCreate` 按 tool 分发：`box` → 落库 `video_bbox`；`track` → 落库 `video_track`（仅含当前帧 keyframe）。
  - "矩形框"工具下再次拖框 = 新建另一条独立 `video_bbox`，不动现有 track。
  - "轨迹"工具下 + 有 `selectedTrack` 时，拖框 = 给该 track 当前帧加/改 keyframe；无选中时落库新 track。
  - 默认 `box`，与图片侧一致。
- **工程量**：M。**影响**：标注表达力 + 训练下游语义。**依赖**：与 O12 同步推进（单独做 O11 仍然吞类别）。
- **风险**：已落库 `video_track` 数据零迁移（schema 共存）。测试覆盖"切工具中途的 selectedTrack 是否被错改"。

#### O12 · 视频侧接入 `pendingDrawing` + `ClassPickerPopover`
> **状态**：v0.9.20 已落地。视频新建 bbox / track 已接入浮层选类；选中已有 track 后追加 keyframe 仍直接沿用 track 类。

- **痛点**："新建框自动用第一个类、无法改类"的根因——`handleVideoCreate` 直接 `s.activeClass || UNKNOWN_CLASS` 落库，绕过图片侧 [WorkbenchShell.tsx:1413-1424](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L1413-L1424) 的浮层选类机制。
- **方案**：
  - `finishDrag`（[VideoStage.tsx:475-502](apps/web/src/pages/Workbench/stage/VideoStage.tsx#L475-L502)）画完不再直接 `onCreate`，改为 `onPendingDraw(frameIndex, geom, tool)`。
  - shell 推 `s.setPendingDrawing({ kind: "video_bbox" | "video_track", frameIndex, geom })`，复用现有 `ClassPickerPopover`（定位换为 video overlay client rect）。
  - `handlePickPendingClass` 按 `kind` 分发 `createVideoBbox` / `createVideoTrack`。
  - Esc / 点外部仍走 `UNKNOWN_CLASS` 兜底（[WorkbenchShell.tsx:809-814](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L809-L814)）。
  - 例外：轨迹工具 + 已有 `selectedTrack` 加新 keyframe **不弹浮层**（类已确定），直接 upsert。
- **工程量**：M。**影响**：创建链路对齐图片侧；让"画完选类"成为视频默认行为。**依赖**：O11（工具语义稳定后再接 pendingDrawing 才有意义）。

#### O14 · Overlay 选中 track 后的改类与上下文菜单
> **状态**：v0.9.20 主路径已落地。1–9 改选中视频对象类、overlay 轻量操作条已完成；独立右键菜单未做。

- **痛点**：选中 track 后只能拖框 + Delete，"改类必须去侧栏 rename"。直接回应"无法改类"反馈。
- **方案**：
  - 1–9 / 数字键 = 改 selectedTrack class（参考图片侧 batchChangeClass 模式），走 `handleVideoRename`。
  - Overlay 选中后显示轻量浮动操作条：[改类] [拆为独立框（当前帧）] [整条烘焙] [删除]。
  - 右键菜单：与浮层操作一致，键鼠分流。
- **工程量**：S。**影响**：日常修正速度。**依赖**：O11 / O12（tool 语义先稳）；"拆/烘焙"按钮逻辑由 O13 提供。

#### O13 · Track ↔ video_bbox 互转入口
> **状态**：v0.9.20 已落地 `track → video_bbox`。支持 copy / split、当前关键帧 / 整条 track、keyframes / all_frames；`bbox → track` 反向聚合未做。

- **痛点**："把某一段轨迹转换成单帧独立矩形框"——当前无任何 UI 能做这件事；已落库 track 后悔了只能整体删除。
- **方案**：
  - 轨迹侧栏每条 track 展开 keyframe 列表（**与第二档 O8 合并实现同一份 UI**）：每行带 `[拆为独立框]` / `[删除]`。
  - "拆为独立框"：删该 keyframe + 同 (frame, bbox, class) 落库一条 `video_bbox`；track 拆完只剩 ≤1 个 keyframe 时弹确认"是否整条烘焙"。
  - "整条 track 烘焙"：track 右键菜单 / 上下文按钮。粒度 `keyframes only` 或 `all frames (插值后)`，复用 [export.py](apps/api/app/export.py) 已有的 all_frames 插值实现，可独立后端端点也可前端展开后批量 create。
  - 反向"bbox 合并为 track"：列入第二档可选，先打通"track → bbox"方向。
- **工程量**：M。**影响**：纠错能力 + 跨工具导出灵活度。**依赖**：O11 / O12（让 video_bbox 真的有人创建）；UI 与 O8 合并。

### 3.2 第二档 · 标注体验

> 这一档要在第一档完成后做。所有动作的对象语义（bbox vs track）都依赖 O11 已经成立。

#### O5 · 属性面板（track 级 + frame 级）
- **痛点**：M2 schema 已留 track 级 / frame 级 attributes 位，但前端只有 `class_name` 一个可编辑字段，承载不了行人 re-id / 行为分类等真实场景。
- **方案**：复用图片侧 attribute schema 渲染逻辑，挂在轨迹侧栏（[VideoStage.tsx:571-663](../apps/web/src/pages/Workbench/stage/VideoStage.tsx#L571-L663)）下方；frame 级属性挂当前 keyframe。
- **工程量**：M。**影响**：能否承载真实业务。**依赖**：项目类型 schema 已支持视频。

#### O6 · 多选 + 批量操作（track 维度）
- **痛点**：处理"这一群人"现在只能逐条改。
- **方案**：Shift+Click 在轨迹侧栏多选 → 批量改类 / 删除 / 改 visibility。**不在 overlay 上做多选**（同帧目标少，多选无意义）。
- **工程量**：S–M。**影响**：批量纠错效率。

#### O7 · Keyframe 复制粘贴 / 沿时间轴平移
- **痛点**：相邻几帧目标几乎不动时要逐帧打关键帧。
- **方案**：Ctrl+C 复制当前帧 keyframe → 目标帧 Ctrl+V 粘贴；右键菜单"track 整体平移 ±N 帧"。
- **工程量**：M。**影响**：长视频效率。**未决**：见 §5 复制语义。

#### O8 · 删除中间关键帧 + 插值重算 UI（与 O13 合并实现）
> **状态**：v0.9.20 已随 O13 落地删除入口；删除后的插值变化预览未做。

- **痛点**：M2 验收提到"删中间 keyframe 后插值重算的 UI 入口留到后续"——目前无可视入口。
- **方案**：轨迹侧栏 keyframe 列表（与 O13 同一份 UI），每行带"删除"按钮 + 预览删除后的插值变化。
- **工程量**：S。**影响**：标注员调整轨迹的可控性。

### 3.3 第三档 · 审核 & 运维

#### O4 · Review 模式视频差异化
- **痛点**：图片侧支持 `diffMode = raw / diff / final`；视频任务直接进入只读，没有 diff。
- **方案**：
  - 短期：track 列表区分 "manual / interpolated / prediction" 来源，补 raw vs final 切换。
  - 中期：审核评论锚定 (track_id, frame_index)，不再整条 annotation。
- **工程量**：M。**影响**：审核效率 / 反馈精度。

#### O10 · probe / poster 失败重试 + 错误展示
- **痛点**：ffprobe / poster 失败一次性写入 `probe_error` / `poster_error`，运维无重试入口。
- **方案**：
  - 后端：probe / poster 抽成 Celery task 链，进入 retry queue。
  - 前端：项目管理员数据集列表显示"probe 失败的视频"，可手动重 probe。
- **工程量**：S（重试）/ M（管理 UI）。**影响**：可运维性。

### 3.4 第四档 · 暂不做 / 长期 epic

- **视频 viewport（缩放 / 平移高分辨率视频）**：浏览器解码 + WebGL 渲染是独立工程。
- **SAM 3 video predictor / 视频 AI tracker**：依赖 backend 能力验证，参见 [2026-05-11-video-workbench.md](2026-05-11-video-workbench.md) §5。
- **Polygon track / 视频多边形**：需求未明确。
- **长视频切片 + 多人协同**：架构级，独立 epic。
- **MOT Challenge / COCO Video 等行业格式导出**：作为单独的导出增强里程碑评估。

---

## 4. 执行顺序

```
M5.0 工具语义补全（v0.9.20 已完成主路径）
  ✅ O11（工具栏分离）
    └─ ✅ 同步 O12（pendingDrawing 浮层）        ← O11 + O12 必须一起合并，否则要么吞类要么吞工具
       └─ ✅ O13（track→bbox 互转，与 O8 同一份 UI；bbox→track 未做）
          └─ ⚠️ O14（overlay 改类 + 操作条已做；独立右键菜单未做）

M5.1 标注体验
  O5（属性面板）  →  O6（多选）  →  O7（复制粘贴）
                                      └─ ✅ O8 已在 v0.9.20 与 O13 一起完成删除入口

M5.2 审核 & 运维
  O4（review diff）  →  O10（probe 重试）
```

**整合理由**：

- O11 与 O12 必须**捆绑合并**：单独做 O11 仍然吞类别（无法选类）；单独做 O12 会让 pendingDrawing 找不到 tool 上下文。
- O13 与 O8 共用一份 "keyframe 列表" UI，分开两次实现是浪费工程量——M5.0 内一并做。
- O14 排在 M5.0 最后，因为它的"拆为独立框" / "整条烘焙"按钮直接调用 O13 提供的能力；v0.9.20 已先把这些动作搬到 overlay 轻量操作条，独立右键菜单留作后续 UX polish。
- 第二档不再放 O13（已上移到 M5.0）；O7 复制粘贴排在 O5/O6 之后，因为它的语义未决问题（见 §5）比属性面板和多选更需要先讨论。
- 第三档暂时不和 M5.0/M5.1 并行——审核与运维改动面分散，等前面对象语义稳定后单独立刻做。

---

## 5. 未决问题（需要先讨论再动手）

- [x] **撤销粒度**：v0.9.19 已采用 keyframe 操作粒度；创建 / 删除 / 改类仍按整条 track。
- [ ] **冲突 modal 的视频 diff 怎么渲染**？v0.9.19 先复用通用弹窗；keyframe diff 可读性仍待独立设计。
- [ ] **复制粘贴的语义**：Ctrl+C 复制"当前帧的 keyframe"还是"整条 track"？右键菜单是否更合适？ → 影响 O7。
- [x] **M4 首版导出格式**：已决定先做专用 Video Tracks JSON，保留 compact track / keyframes，并可选展开 all_frames。MOT Challenge / COCO Video 留后续增强。
- [ ] **probe 失败的视频是否阻塞建任务**？目前是允许建任务但前端报错——是否需要在导入阶段就拦截？ → 影响 O10。
- [ ] **VideoStage 是否考虑拆分**？700+ 行已经在临界点，是否提前抽出 `Timeline`、`TrackList`、`VideoOverlay` 子组件？ → 影响后续所有 video 工作的可维护性。
- [x] **工具语义（O11）的具体形态**：v0.9.20 已采用独立 `videoTool` 字段，不合入图片侧 `Tool` 联合；hotkey 注册中心通过 video mode 分发 B/T。
- [x] **video_bbox 在轨迹工具下是否完全不可见**？v0.9.20 已采用"工具只决定下一笔落库类型"：已有 `video_bbox` / `video_track` 均持续显示且可选中。
- [x] **track 烘焙为 video_bbox 后是否保留原 track**？v0.9.20 已提供 `copy` / `split` 两个动作：copy 保留原 track，split 删除被拆出的 keyframe 或源 track。
- [x] **1–9 切类（O14）在视频侧是否需要 modifier**？v0.9.20 已复用无 modifier 语义：有选中视频对象时改选中对象类，无选中对象时切 activeClass。

---

## 6. 不做清单

延续 [2026-05-11-video-workbench.md](2026-05-11-video-workbench.md) §7，**本次优化不做**：

- 不重构 WorkbenchShell 的 stage 分发机制（一行 if 足够）。
- 不强行让 VideoStage 用 ImageStage 的 props 接口——两套数据模型不同，假统一只会更乱。
- 不把图片侧的 viewport / Minimap 硬塞进视频。
- 不在本里程碑做视频 AI tracker / SAM video。
- 不为兼容旧 `video_bbox`（v0.9.16）写迁移脚本——schema 已经向前兼容（[VideoStage.tsx](../apps/web/src/pages/Workbench/stage/VideoStage.tsx) 同时处理两种 geometry）。
