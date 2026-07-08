# 视频几何工具单位对齐图片工作台 (2026-07-07)

## 背景与纠偏

v0.21.21 把单帧 polygon/polyline 做成了 **bbox 单位下的 `video_modes.polygon/.polyline` 子开关**,
与矩形框**共享类别/属性 schema**。用户评审后要求纠偏:**对齐图片工作台**——每个几何是**独立工具单位**,
各有独立 tab + 独立类别/属性 schema,与「矩形框/轨迹」并列。

用户拍板 (2026-07-07):
1. **独立 schema**:多边形/折线与矩形框完全隔离,各自类别/属性。折线→`polyline` 单位,多边形→`region` 单位(对齐图片)。
2. **每单位带单帧/轨迹子开关**:每个视频几何单位复刻 bbox 现有的 `video_modes:{box(单帧), track}` 模式。

## 现状关键事实

- 图片侧工具→单位:`polygon→region`,`polyline→polyline`,`box→bbox`(`stage/tools/toolUnits.ts`)。
  类别按单位解析:`useToolBindings(project, toolId)` → `toolUnitForTool` → materialize 该单位 binding 的 classes。
- **视频工作台 `useToolBindings` 用的是 `s.tool`(图片 ToolId,视频下恒 box/select),不是 `videoTool`**
  → 所有视频几何现都取 **bbox 单位**类别。这是"共享"的根因。
- `TOOL_UNIT_GROUPS`(`constants/toolUnits.ts`)按 `dataTypes` 决定单位对某数据类型是否可见。
  目前 `polyline`/`region`/`rotated_bbox`/`keypoint` 都只含 `image`;仅 `bbox` 含 `[image, video]`。
- 后端 `video_modes` 是**每个 ToolBinding 都有的字段**(`_jsonb_types.py`),结构上任意单位可挂
  `video_modes:{box,track}`。`tool_unit_id` 是 `ToolUnitId` Literal 校验,POST `video_polygon` 带
  `tool_unit_id="region"` 后端认(无几何↔单位强绑定)。→ **新模型不需要动后端 schema**;
  我加的 `polygon/polyline/keypoint/rotated_box` 字段变冗余(先留着无害,后续清理)。

## 目标模型

每个视频几何单位 = 一个设置 tab + 独立类别/属性 + `video_modes:{box(单帧), track}` 子开关。
工具→单位→变体映射(集中于新模块 `stage/videoToolUnits.ts`):

| VideoTool | unit | variant | 几何类型 |
|---|---|---|---|
| box | bbox | box | video_bbox |
| track | bbox | track | video_track_bbox |
| polygon | region | box | video_polygon |
| polygon-track | region | track | video_track_polygon |
| polyline | polyline | box | video_polyline |
| polyline-track | polyline | track | video_track_polyline |
| select | — | — | — |

工具可用 ⇔ `enabledToolUnits.has(unit)` 且 `unit.video_modes[variant]`(null=两者可用)。

## 改动清单(前端为主 + dev seed)

1. **`stage/videoToolUnits.ts`(新)**:`VIDEO_TOOL_TARGET` 映射 + `videoToolUnit(t)` + `videoToolEnabled(t, tb)`(+单测)。
2. **`constants/toolUnits.ts`**:`polyline`、`region` 的 `dataTypes` 加 `"video"`。
3. **`useProjectToolBindings.ts`**:`videoModes` 类型回退 `{box,track}`;序列化对所有视频几何单位(bbox/polyline/region)透传 `video_modes`(不再仅 bbox)。
4. **`ClassesSection.tsx`**:`isVideoBbox`→`isVideoGeoUnit`(bbox/polyline/region);`video_modes` 子开关按激活单位渲染,标签按单位文案(单帧矩形框/轨迹矩形框、单帧折线/折线轨迹、单帧多边形/多边形轨迹);`onToggleVideoMode` 作用于激活单位;撤掉 4 开关退回 2 开关。
5. **`useWorkbenchShellModel.tsx`**:视频按 `videoTool` 解析单位(overrideUnit)取类别;把 `videoModes` 对象换成 `isVideoToolEnabled` 谓词下发;切工具 fallback 用谓词。
6. **`ToolDock.tsx`**:`videoModes` prop → `isVideoToolEnabled` 谓词门控。
7. **`VideoKonvaStage.tsx`**:`pointsDrawEnabled` 等改用谓词。
8. **`useVideoAnnotationActions.ts`**:创建 payload 带 `tool_unit_id`(region/polyline/bbox)。
9. **dev seed**:P-VIDEO-DEV 补 `region`/`polyline` 单位(否则纠偏后多边形/折线工具灰置)。

## 迁移影响

存量视频项目在纠偏后,**多边形/折线工具需先在设置里启用 `region`/`polyline` 单位**才可用
(对齐图片:未启用单位则无对应工具)。存量 `video_polygon`(tool_unit_id="bbox")仍能渲染,仅新建落 region/polyline。

## 验证

tsc(0)/eslint(0)/vitest 相关单测;浏览器 E2E:设置里 P-VIDEO-DEV 出现 折线/多边形 tab、各带单帧/轨迹开关、独立类别;
工作台按单位取类别绘制、落库 tool_unit_id 正确。
