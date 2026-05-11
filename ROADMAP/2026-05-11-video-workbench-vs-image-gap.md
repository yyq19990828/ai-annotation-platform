# 视频工作台 vs 图片工作台 · 差距盘点与优化方向

> 类型：P0 调研报告 / 优化路线图（**not yet a milestone plan**）
>
> 范围：以当前已落地的 [VideoStage](../apps/web/src/pages/Workbench/stage/VideoStage.tsx)（v0.9.16 + v0.9.17）为基线，与 [ImageStage](../apps/web/src/pages/Workbench/stage/ImageStage.tsx) 做逐项对比，沉淀下一阶段（M4 之后）的优化方向。
>
> 与 [2026-05-11-video-workbench.md](2026-05-11-video-workbench.md) 的关系：原 Epic 写的是"先把视频闭环做起来"，本文写的是"图片工作台两年沉淀的工程能力如何向视频侧迁移"。

---

## 0. TL;DR

- VideoStage 当前 **725 行**，ImageStage **1108 行**。规模差距背后的核心是：VideoStage 是独立重写的 MVP，**没有复用 ImageStage 的工程基础设施**（撤销重做、离线队列、冲突解决、快捷键体系、多选、属性面板、复制粘贴、AI 采纳/驳回、Minimap、浮动 Dock、Review diff 模式）。
- WorkbenchShell 通过 `task?.file_type === "video" || currentProject?.type_key === "video-track"` 一行分支切换两套 Stage（[WorkbenchShell.tsx:183](../apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L183)），两者 props 接口几乎不重合——ImageStage ~50 个 prop、VideoStage 10 个 prop。
- 视频侧 M3 已落地的 QC（轨迹断裂、极小框、同帧重叠）和 M4 导出（目前显式 `UnsupportedExportError`）是已知短板，但**真正影响日常标注效率的是"快捷键 + 撤销"两项**——其它图片工作台习惯到了视频侧全部失效。
- 建议下一阶段（暂名 M5 · 工作台基础设施统一）的核心目标：**把视频工作台从"能用的 MVP"推到"和图片工作台相同的工程基线"**，再去做导出、AI tracker 等增量。

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
| | 撤销重做 | ✅ useAnnotationHistory | ⚠️ shell 层有 history.push，但 VideoStage 内部编辑不接入 | useAnnotationHistory.ts |
| | 批量改类别 / 批量删除 | ✅ onBatchChangeClass / onBatchDelete | ❌ | useWorkbenchAnnotationActions.ts |
| | nudge（方向键微调） | ✅ 1px / Shift+10px | ❌（方向键被逐帧占用） | hotkeys.ts |
| **快捷键** | 工具切换 B/P/V/S | ✅ | ❌ | hotkeys.ts |
| | 1–9 切类别 | ✅ | ❌ | hotkeys.ts |
| | Tab 循环目标 | ✅ | ❌ | hotkeys.ts |
| | A/D AI 采纳/驳回 | ✅ | — 视频暂无 AI 候选 | hotkeys.ts |
| | Space / ←→ 视频控制 | — | ✅ | VideoStage.tsx:306-331 |
| | hotkeys 注册中心 | useWorkbenchHotkeys | **未接入** | useWorkbenchHotkeys.ts |
| **AI 集成** | AI 预标候选 + accept/reject | ✅ | ❌（aiDisabled={isVideoTask}, [WorkbenchShell.tsx:1258](../apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L1258)） | useInteractiveAI.ts |
| | SAM mask 输入 | ✅ | ❌ | samTextOutput.ts |
| **提交链路** | optimistic update | ✅ | ⚠️ shell 层有，但 VideoStage 自己不展示 pending 态 | useWorkbenchAnnotationActions.ts |
| | 离线队列 | ✅ useWorkbenchOfflineQueue + OfflineQueueDrawer | ⚠️ shell 共享同一 hook，但 video_track 的 update 没有走 queue 重试路径需验证 | useWorkbenchOfflineQueue.ts, offlineQueue.ts |
| | 冲突 Modal | ✅ ConflictModal | ⚠️ shell 共享，video_track 的 412 冲突路径未验证 | ConflictModal.tsx |
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
| **导出** | COCO / YOLO / VOC | ✅ | ❌ 显式 `UnsupportedExportError`（[apps/api/app/services/export.py:25-29](../apps/api/app/services/export.py#L25-L29)） | export.py |
| **后端** | ffprobe 元数据 | — | ✅ workers/media.py | workers/media.py |
| | poster 缩略图 | ✅ thumbnail_path 复用 | ✅ extract_video_poster | workers/media.py |
| | manifest API | — | ✅ `/tasks/{id}/video/manifest` | — |
| | probe / poster 失败重试 | ⚠️ | ❌ 一次性失败写入 probe_error / poster_error | — |
| **测试** | 单元测试覆盖 | hotkeys(67 分支) / iou / polygonGeom / ResizeHandles / transforms / history / offlineQueue / interactiveAI / annotationActions ... | VideoStage.test.tsx 7 个场景 | — |

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

**已有基础**：`useWorkbenchHotkeys` 接收 `videoMode` 参数（[WorkbenchShell.tsx:1106](../apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx#L1106)），但 VideoStage 没有把自己的快捷键注册进 hotkeys.ts，而是在组件内部 `window.addEventListener("keydown")` 直接处理（[VideoStage.tsx:306-331](../apps/web/src/pages/Workbench/stage/VideoStage.tsx#L306-L331)）。结果：**两套机制并存，hotkeys 中心化对视频是"假复用"。**

---

## 3. 优化方向（按价值 × 工程量分档）

每条都标注：**S/M/L 工程量** + **影响面**（标注员效率 / 审核员效率 / 可靠性 / 训练下游）+ **依赖**。

### 第一档：基础设施统一（建议下一里程碑必做）

#### O1 · 把 VideoStage 接入中心化快捷键体系
- **痛点**：当前快捷键在 VideoStage 组件内 hardcode，hotkeys.test.ts 覆盖不到，未来加快捷键会越来越乱。
- **方案**：在 `useWorkbenchHotkeys.ts` / `hotkeys.ts` 增加 video 命名空间（Space、←→、Shift+←→、Delete），通过 `videoMode` 分发；VideoStage 移除内部 keydown listener。
- **附带产出**：补 `1–9` 切类、`Tab` 循环 track、`Esc` 取消选中等图片侧已有快捷键到视频。
- **工程量**：S。**影响**：标注员效率 / 可维护性。**依赖**：无。

#### O2 · 撤销重做（track-aware）
- **痛点**：当前 shell 层 `history.push` 在 video 任务里只记录 annotation 级别的操作，**关键帧增删改不进 history**——用户改 3 帧后无法回滚。
- **方案**：为 video_track 设计 history action 类型：`AddKeyframe` / `UpdateKeyframe` / `DeleteKeyframe` / `ToggleAbsent` / `ToggleOccluded`，复用 `useAnnotationHistory` 的栈结构但替换 reducer。
- **工程量**：M。**影响**：标注员信心 / 误操作恢复。**依赖**：先确认 history 是否需要按"track 维度"组织。

#### O3 · 验证 / 修复 offline queue 与 conflict modal 在视频上的覆盖
- **痛点**：shell 层共享同一套 offline queue + ConflictModal，但 `handleVideoCreate` / `handleVideoUpdate` 是否真的走 queue 重试、412 时是否唤起 ConflictModal——**当前测试没覆盖**。
- **方案**：补 e2e / 集成测试，覆盖：弱网下创建 track / 修改 keyframe → 网络恢复后自动重放；并发编辑同一 task 触发 412 → ConflictModal 显示视频侧 diff。
- **工程量**：S（如果不需要改实现）/ M（如果发现 video_track 的 diff 渲染需要单独写）。**影响**：可靠性。
- **风险**：ConflictModal 当前的 diff 是基于 box 列表的，video_track 的 keyframes diff 可能不可读，**需独立设计**。

#### O4 · Review 模式视频差异化
- **痛点**：图片侧支持 `diffMode = raw / diff / final`，审核员可对比"标注员提交版 vs AI 预标版 vs 终版"；视频任务**直接进入只读模式，没有 diff**。
- **方案**：
  - 短期：审核员看到的 track 列表能区分"manual / interpolated / prediction"来源（视觉已经有"· 插值"标记，但缺少 raw vs final 切换）。
  - 中期：把审核评论锚定到 (track_id, frame_index)，而不是整条 annotation。
- **工程量**：M。**影响**：审核员效率 / 反馈精度。

### 第二档：标注效率提升（重要但不阻塞 M4）

#### O5 · 属性面板支持 track 级 + frame 级属性
- **痛点**：M2 已经在 schema 里预留了 track 级 / frame 级属性的位置，但前端没有属性面板，只能改 `class_name`。真实场景（行人 re-id、车牌识别、行为分类）严重依赖属性。
- **方案**：复用图片侧的 attribute schema 渲染逻辑，在轨迹侧栏（[VideoStage.tsx:571-663](../apps/web/src/pages/Workbench/stage/VideoStage.tsx#L571-L663)）下方加属性表单；frame 级属性挂在当前 keyframe 上。
- **工程量**：M。**影响**：能否承载真实业务场景。**依赖**：项目类型的 schema 定义是否已经支持视频。

#### O6 · 多选 + 批量操作（track 维度）
- **痛点**：处理一段视频里"这一群人"或"这一段被错标的目标"现在只能逐条改。
- **方案**：Shift+Click 在轨迹侧栏多选 track → 批量改类别 / 批量删除 / 批量改 visibility。**注意不要在帧 overlay 上做多选**——视频里同帧目标少，多选意义不大。
- **工程量**：S–M。**影响**：批量纠错效率。

#### O7 · Keyframe 复制粘贴 / 沿时间轴平移
- **痛点**：相邻几帧目标几乎不动时，当前要逐帧打关键帧。Label Studio 和 CVAT 的常见操作是"复制当前帧 bbox 到帧 N+k"或"把整条 track 沿时间轴平移"。
- **方案**：Ctrl+C 复制当前帧 keyframe → 移到目标帧 Ctrl+V 粘贴；右键菜单"把 track 整体平移 ±N 帧"。
- **工程量**：M。**影响**：长视频标注效率。

#### O8 · 删除中间关键帧后的插值重算 UI
- **痛点**：M2 验收提到"删除中间关键帧后重新计算插值的独立 UI 入口留到后续增强"——目前**完全没有 UI 让用户看到删了关键帧后的插值效果**。
- **方案**：轨迹侧栏新增"keyframe 列表"展开视图，每个 keyframe 一行带"删除"按钮，预览删除后的插值变化。
- **工程量**：S。**影响**：标注员调整轨迹的可控性。

### 第三档：导出与后端

#### O9 · M4 视频导出（独立里程碑）
- **现状**：[export.py:25-29](../apps/api/app/services/export.py#L25-L29) 显式 `UnsupportedExportError`。
- **方案**（与 [2026-05-11-video-workbench.md](2026-05-11-video-workbench.md) M4 一致）：
  - JSON 首选：保留 compact track / keyframes / interpolated metadata。
  - 可选展开为 MOT Challenge 或 COCO Video 格式（行业标准，便于训练下游）。
  - 导出选项："仅关键帧" vs "展开所有帧"。
- **工程量**：M。**影响**：下游训练 / 数据流通。**这是 M4 主线，不属于本文档新增**。

#### O10 · probe / poster 失败重试 + 错误展示
- **痛点**：当前 ffprobe / poster 失败一次性写入 `probe_error` / `poster_error`，前端只能显示"加载失败"。运维侧无重试入口。
- **方案**：
  - 后端：把 probe / poster 抽成 Celery task 链，失败进入 retry queue（已经有 retry 基础设施）。
  - 前端：项目管理员的数据集列表里能看到"probe 失败的视频"，点一下手动触发重 probe。
- **工程量**：S（重试）/ M（管理 UI）。**影响**：可运维性。

### 第四档：暂不做 / 长期 epic

- **视频 viewport（缩放 / 平移高分辨率视频）**：浏览器视频解码 + WebGL 渲染是独立工程，列入长期 epic，不在工作台优化范围。
- **SAM 3 video predictor / 视频 AI tracker**：依赖单独 backend 能力验证，参见 [2026-05-11-video-workbench.md](2026-05-11-video-workbench.md) §5。
- **Polygon track / 视频多边形**：需求未明确，先观察用户反馈。
- **长视频切片 + 多人协同**：架构问题，独立 epic。

---

## 4. 建议的执行顺序

按"先打地基再装修"的逻辑，推荐顺序：

```
M5.1（基础设施）: O1（快捷键） → O2（撤销重做）→ O3（offline/conflict 验证）
  ↓
M5.2（标注体验）: O5（属性面板） → O6（多选） → O7（keyframe 复制粘贴） → O8（插值重算 UI）
  ↓
M5.3（审核 & 运维）: O4（review diff） → O10（probe 重试）
  ↓
M4（导出，独立）: O9 —— 与 M5 解耦，可并行进行
```

**理由**：

- O1 + O2 是其它所有交互的前提（没有撤销，用户不敢做新操作）。
- O3 不在表面但风险最大（数据丢失风险）。
- O5–O8 是用户能直接感受到的提速。
- O9（导出）严格说和 M5 解耦，可以由不同人并行做。

---

## 5. 未决问题（需要先讨论再动手）

- [ ] **撤销粒度**：撤销是按"keyframe 操作"还是"track 操作"？混合？ → 影响 O2 的 history 设计。
- [ ] **冲突 modal 的视频 diff 怎么渲染**？两条 track 同名不同 keyframes 的 diff 用户看不懂。 → 影响 O3 是否需要额外 UI。
- [ ] **复制粘贴的语义**：Ctrl+C 复制"当前帧的 keyframe"还是"整条 track"？右键菜单是否更合适？ → 影响 O7。
- [ ] **导出格式优先级**：MOT Challenge 还是 COCO Video？由下游训练团队决定。 → 影响 O9。
- [ ] **probe 失败的视频是否阻塞建任务**？目前是允许建任务但前端报错——是否需要在导入阶段就拦截？ → 影响 O10。
- [ ] **VideoStage 是否考虑拆分**？725 行已经在临界点，是否提前抽出 `Timeline`、`TrackList`、`VideoOverlay` 子组件？ → 影响后续所有 video 工作的可维护性。

---

## 6. 不做清单

延续 [2026-05-11-video-workbench.md](2026-05-11-video-workbench.md) §7，**本次优化不做**：

- 不重构 WorkbenchShell 的 stage 分发机制（一行 if 足够）。
- 不强行让 VideoStage 用 ImageStage 的 props 接口——两套数据模型不同，假统一只会更乱。
- 不把图片侧的 viewport / Minimap 硬塞进视频。
- 不在本里程碑做视频 AI tracker / SAM video。
- 不为兼容旧 `video_bbox`（v0.9.16）写迁移脚本——schema 已经向前兼容（[VideoStage.tsx](../apps/web/src/pages/Workbench/stage/VideoStage.tsx) 同时处理两种 geometry）。
