# Epic 草案 · 视频工作台单帧工具全量补齐（图片工具 → 视频单帧）

状态：**草案（2026-07-07）**。把图片工作台的**全部单帧标注工具**搬进视频工作台的**单帧标注**（`video_bbox` 同轴、逐帧、
**不涉及 track/插值**）。目标末态：视频某一帧上能画 polygon / polyline / keypoint / rotated-box(OBB) / mask，并能用
交互式 SAM（smart-point / smart-box / exemplar / magic-box）逐帧分割。**横跨前后端、多版本 epic**，本文件定骨架 /
证据 / 分期 / 待决策；顺延 v0.21.20 之后，分 v0.21.21–24 四个独立版本计划推进。

关联计划：
- [v0.21.20 多几何 track](2026-07-05-v0.21.20-multi-geometry-track.md)——**正交轴 B（轨迹几何）**。本 epic 是**轴 A
  （单帧几何）**，是轴 B 的地基：schema 变体 / 视频栈 `<Line>`·keypoint·mask 渲染 / 工具交互三者**两轴共享**，仅插值为
  轴 B 独占。见该计划「两条正交轴」节。
- [视频追踪多目标化 epic](2026-07-07-video-multi-target-tracking-epic.md)——追踪链路多目标化，与本 epic 正交（那条改
  runner 落库，本 epic 改单帧几何工具）。

## 动机：视频只有 3 个工具，图片有 11 个（带证据）

| | 图片工作台 | 视频工作台 |
|---|---|---|
| 工具栏工具 | **11 个**：select / box / rotated-box / polygon / polyline / keypoint / mask / smart-point / smart-box / exemplar / magic-box（`stage/tools/index.ts:169-181 ALL_TOOLS`） | **3 个**：`select` / `box` / `track`（`ToolDock.tsx:81-84 VIDEO_TOOLS`；`useWorkbenchState.ts:31 VideoTool`） |
| 渲染栈 | `ImageStageShapes.tsx` **815 行**（全几何） | `VideoKonvaTrackShape.tsx` **78 行**（只 `<Rect>`） |
| 交互状态机 | `tools/` 11 个工具单元（`ToolPointerContext → DragInit`）+ `ImageStage.tsx` 消费 | `videoKonvaInteraction.ts`（只 bbox `draw`/`move`/`resize`） |
| 提交层 | `useImageAnnotationActions.ts` | `useVideoAnnotationActions.ts` 532 行（只 `video_bbox`/`video_track_bbox`；`buildVideoCreatePayload:79-110`） |
| AI 候选层 | 全几何 | `VideoKonvaAiLayer` 只 bbox 候选 |

**核心事实：视频是一套与图片完全平行的 Konva 栈，不 import 图片的 `TOOL_REGISTRY`/`ALL_TOOLS`/`ImageStageShapes`**
（全仓 grep：视频侧零命中这三者）。所以「加工具」不是翻开关，而是把整条几何 + AI 工具链在视频栈里**重建或重构成共享**。

### 单帧几何的 schema 形状已明确（省一半设计）
视频单帧几何 = **图片几何 + `frame_index`**，照抄 `VideoBboxGeometry`（`_jsonb_types.py:408-422`：`type`+`frame_index`+
载荷）。`Geometry` 联合（`:616-628`）**已混装图片几何（Polygon/Polyline/Keypoint/RotatedBbox）与视频几何**，加变体是同构扩展，
不动联合骨架。

## 架构：共享 vs 复刻 —— ✅ 已定（2026-07-07）：路 B 务实切分

视频栈要长出 polygon/keypoint/mask 渲染与交互，两条路：

- **路 A · 复刻**：在视频栈内重写几何渲染（78 行 → ImageStageShapes 量级）+ 交互草稿。短期最安全、零回归图片侧，但**每种
  几何双份维护**，长出第二个 800 行平行渲染器。
- **路 B · 共享（✅ 已定）**：延续 canvas-unification epic，抽出 **stage-agnostic 的几何 shape 渲染器 + 复用 `tools/*` 工具单元**
  （它们本就是纯 `ToolPointerContext → DragInit`，见 `tools/PolygonTool.ts` 等），视频/图片两栈共同消费；视频专属胶水（帧
  作用域、单帧 vs track、时间轴）留在视频栈。

**✅ 定稿：路 B 务实切分**——① 直接复用 `tools/*` 工具单元（几乎零改，它们不含 stage 依赖）；② 抽一层「几何 shape 渲染」
供两栈调用；③ DragInit 的消费/派发（`ImageStage.tsx:822-832` samProbe→onSamPrompt、polygon/keypoint commit）在视频栈按需
薄封装，**不强行统一整个 ImageStage**（避免为整洁付图片侧回归风险）。此决策在 v0.21.21 PR1 落地，是后续所有 PR 的地基。

## Epic 分期（四个独立版本，顺延 0.21.20）

| 版本 | 范围 | 难度 | 状态 | 独立计划 |
|---|---|---|---|---|
| **v0.21.21** | 单帧几何**地基** + polygon/polyline 端到端（含共享/复刻决策落地） | 中 | **已发版** | [链接](2026-07-07-v0.21.21-video-single-frame-geometry-foundation.md) |
| **v0.21.22** | keypoint + rotated-box(OBB) + mask 笔刷（补齐其余非 AI 几何） | 中 | **暂停**（使用少、回馈少） | [归档](archive/2026-07-07-v0.21.22-video-single-frame-keypoint-obb-mask.md) |
| **v0.21.23** | 交互式 SAM 单帧工具：smart-point / smart-box / exemplar / magic-box（+ 前置修 `ai_interactive` 建模错误） | 大 | 计划（已校准） | [链接](2026-07-07-v0.21.23-video-single-frame-interactive-sam.md) |
| **v0.21.24** | 视频非 bbox 几何导出：打包层白名单修复 + `yolo-frames-seg`（单帧 + 轨迹） | 中 | 计划（已校准） | [链接](2026-07-07-v0.21.24-video-single-frame-export.md) |

**依赖链（2026-07-07 校准）**：v0.21.21（地基）已发版。**v0.21.23 只依赖 v0.21.21**——交互式 SAM 产出 polygon/bbox，
不产 keypoint/OBB/mask，故 **v0.21.22 暂停不阻塞它**。v0.21.24 只依赖已落库几何（v0.21.20 轨迹 + v0.21.21 单帧），
可与 23 并行。**版本号跳过 22 不重编**（文件名 / 本表 / ROADMAP 三处已引用，跳号语义合法）。

## 全局红线（贯穿四版本）

- **坐标归一化**：新几何 points 必须归一化 [0,1]（`videoKonvaCoordinates.ts:8`）；交互式候选浮层同样归一化（对齐
  memory「交互候选坐标系」教训：yolo exemplar 曾误发百分比致候选飞出画布）。
- **每几何带 `frame_index`**：单帧几何靠 `frame_index` 定位（照 `VideoBboxGeometry:416`），与 track 的 keyframe 无关。
- **bbox track/单帧零回归**：现有 `video_bbox` / `video_track_bbox` 存量零迁移、行为不变。
- **共享层不得回归图片工作台**：若走路 B，抽共享渲染器后图片侧所有几何须逐一验证零像素级回归。

## 风险

- **架构岔路未定阻塞地基**：共享 vs 复刻（见上）不先拍板，v0.21.21 的文件级改动面画不准。**首要前置。**
- **平行栈的隐性差异**：视频栈有帧作用域 / bitmap 缓存 / 时间轴，图片栈没有；共享渲染器要吸收这些差异而不污染图片路径。
- **交互式 SAM 逐帧成本（v0.21.23）**：每次 prompt 要取当前帧图送后端，延迟需评估。
  ~~后端 `/predict` 零改~~ **❌ 已推翻（2026-07-07 核实）**：交互式端点是 `interactive-annotating`（非 `/predict`），
  且**只传 `task_id`、服务端自取图**；视频 task 的 `file_path` 是整段 mp4 → **必须新增 `interactive-annotating-frame` 端点**。
  详见 v0.21.23 计划「核心决策 1」。
- ~~**工具单位配置面**：沿用 bbox 单位扩子开关~~ **❌ 已推翻（v0.21.21 落地时用户二次拍板）**：改为**独立工具单位**——
  折线→`polyline` 单位、多边形→`region` 单位，各自独立类别/属性 schema（对齐图片工作台）；每个视频几何单位内含
  `video_modes:{box,track}`（单帧/轨迹）子开关。`VideoModesConfig` 的 `polygon/polyline/keypoint/rotated_box` 死字段
  已于 v0.21.21 清理。详见 [视频几何工具单位对齐图片](2026-07-07-video-geometry-units-align-image.md)。

## 决策记录 + 开放问题

**✅ 已定（2026-07-07）：**
1. **共享 vs 复刻**：**路 B 务实切分**（复用 `tools/*` 工具单元 + 抽共享几何渲染器 + 视频栈薄封装 DragInit 派发，不统一整个
   ImageStage）。头号前置，v0.21.21 PR1 落地。
2. ~~**工具单位粒度**：沿用 bbox 单位扩子开关~~ → **❌ 已被 v0.21.21 推翻，改为独立工具单位**（见上「风险」条目与
   [对齐计划](2026-07-07-video-geometry-units-align-image.md)）。原表述保留仅作决策沿革，**勿据此实施**。
3. **单帧 mask 存储**：**先矢量化**——笔刷编辑 → `mask_to_multi_polygon` → 落 `video_polygon`/`video_multi_polygon`，不引 per-frame
   栅格（与 v0.21.20 缺口 4 一致）。真·栅格 mask 单独立项。（随 v0.21.22 一并暂停。）
4. **版本号编排**：**跳过 v0.21.22 不重编号**——文件名 / 分期表 / ROADMAP 三处已引用，跳号语义合法，重命名成本大于收益。
5. **`ai_interactive` 建模错误**（2026-07-07 用户提出 + 代码核实）：它被错误建模为几何单位，派生「死开关」与「伪类别域」
   两个 bug。**定稿**：AI 交互开关移入项目设置「ML 模型」（新增 `project.ai_interactive_enabled` 列），
   `ai_interactive` 单位退役，AI 工具按**产出几何**归属单位（smart-*→`region`、magic-box→`bbox`）。
   **是 v0.21.23 的前置 PR0.5**，否则视频侧会复制同一错误。
