---
audience: [dev]
type: explanation
since: v0.9.16
status: stable
last_reviewed: 2026-05-12
---

# 视频标注工作台

v0.9.16 落地视频工作台 M0 + M1：视频元数据、manifest、播放/逐帧定位，以及当前帧 bbox 标注。

v0.9.17 把视频标注升级为 `video_track`：一条 annotation 保存一个对象轨迹和 compact keyframes，前端按需显示关键帧与线性插值结果。

v0.9.19 补齐视频工作台基础设施：关键帧编辑进入 keyframe 级撤销/重做，视频创建 / 更新 / 重命名复用离线队列兜底，时间轴改为画布内悬浮 overlay。

v0.9.20 分离视频矩形框与轨迹工具：`video_bbox` 重新成为可创建的一等对象，`video_track` 只由轨迹工具创建或延续，并新增 track → `video_bbox` 事务转换 API。

v0.9.21 加入帧时间表与前端 `FrameClock`：media worker 生成 `frame_index -> pts_ms`，前端 seek/playback 优先用 `requestVideoFrameCallback` 与真实 PTS 做帧号映射；轨迹插值也改为 keyframe 索引 + 二分查找。

v0.9.22 把视频渲染面向 CVAT 的 canvas 边界对齐：Media / Bitmap / Grid / Objects / Text / Interaction / Attachment 分层，bbox 命中测试迁到 Interaction 层统一 picker，并新增时间轴 frame bucket helper。

v0.9.23 引入 `outside` 段语义：`video_track` 可用闭区间表达目标在一段帧内不存在，前后端渲染、导出和 track → `video_bbox` 转换都兼容旧 `absent=true` 并优先尊重 outside。

## 数据入口

视频文件通过 dataset 导入进入系统：

1. `DatasetItem.file_type = "video"`。
2. 上传、ZIP 导入、bucket scan 完成后投递 `app.workers.media.generate_video_metadata`。
3. Celery media worker 下载原视频到临时目录，调用 `ffprobe` 解析元数据，再用 `ffmpeg` 抽首帧 poster。
4. 元数据写入 `dataset_items.metadata["video"]`，poster 路径写入 `dataset_items.thumbnail_path`，使任务列表复用现有缩略图链路。

`metadata["video"]` 当前字段：

| 字段 | 含义 |
|---|---|
| `duration_ms` | 视频时长，毫秒 |
| `fps` | 帧率，优先取 `avg_frame_rate` |
| `frame_count` | 帧数，优先取 `nb_frames`，缺失时用 `duration * fps` 估算 |
| `width` / `height` | 视频原始尺寸 |
| `codec` | 视频编码名 |
| `playback_path` / `playback_codec` | 非浏览器兼容编码转码后的 H.264 MP4 对象路径与编码 |
| `poster_frame_path` | poster 对象存储路径 |
| `probe_error` / `poster_error` / `playback_error` | 解析、抽帧或播放转码失败原因 |
| `frame_timetable_frame_count` | 已生成帧时间表的帧数 |
| `frame_timetable_error` | 帧时间表生成失败原因；失败时前端按 fps 估算降级 |

## Manifest API

`GET /tasks/{task_id}/video/manifest` 返回播放所需信息：

```json
{
  "task_id": "...",
  "video_url": "https://...",
  "poster_url": "https://...",
  "metadata": {
    "duration_ms": 1000,
    "fps": 25,
    "frame_count": 25,
    "width": 640,
    "height": 360,
    "codec": "mpeg4",
    "playback_path": "playback/..."
  },
  "expires_in": 3600
}
```

非视频任务会返回 `400`。如果 `playback_path` 存在，manifest 的 `video_url` 会优先指向转码后的 H.264 MP4；否则使用原始视频对象。`GET /tasks/{id}` 也透出 `video_metadata`，用于列表和工作台决定是否进入视频 stage。

## Frame Timetable API

v0.9.21 新增：

```http
GET /api/v1/tasks/{task_id}/video/frame-timetable?from=0&to=120
```

响应示例：

```json
{
  "task_id": "...",
  "fps": 29.97,
  "frame_count": 1800,
  "source": "ffprobe",
  "frames": [
    {
      "frame_index": 0,
      "pts_ms": 0,
      "is_keyframe": true,
      "pict_type": "I",
      "byte_offset": 48
    }
  ]
}
```

当存量视频还没有时间表时，接口返回 `source: "estimated"` 和空 `frames`；前端使用 `fps` 与 `frame_count` 继续估算，不阻断打开工作台。`from` / `to` 都是可选且包含边界。

## Annotation Schema

视频工作台支持两种视频 geometry：

- `video_bbox`：当前帧独立矩形框。
- `video_track`：跨帧对象轨迹。

v0.9.20 起，前端通过 `videoTool` 决定新拖框落库类型：矩形框工具写 `video_bbox`，轨迹工具写 `video_track` 或追加 keyframe。

`video_track` 示例：

```json
{
  "type": "video_track",
  "track_id": "trk_...",
  "outside": [
    { "from": 24, "to": 48, "source": "manual" }
  ],
  "keyframes": [
    {
      "frame_index": 0,
      "bbox": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 },
      "source": "manual",
      "absent": false,
      "occluded": false
    }
  ]
}
```

约定：

- `annotation_type` 写 `video_track`。
- `track_id` 在单条 annotation 内稳定，用于 UI 展示和审核定位。
- 类别继续使用 annotation 顶层 `class_name`，本期不引入稳定 `class_id`。
- `keyframes[]` 是持久化数据；插值结果由前端按相邻关键帧计算，不写库。v0.9.21 起前端用缓存索引和二分查找解析当前帧。
- `outside[]` 是 v0.9.23 起的一等消失段，使用闭区间 `{ from, to }` 表示目标在该段帧内不存在；相邻或重叠区间会在读写 helper 中归一化。
- `source` 当前支持 `manual` / `prediction` / `interpolated`；前端不会把计算得到的 interpolated frame 展开保存。
- `absent=true` 是旧版单帧消失标记；读路径会把它视为单帧 outside，新的 UI 写入优先使用 `outside`。
- outside/absent 对渲染和导出优先级最高：落在 outside 的帧不显示对象、不导出 bbox，也不会参与 track → `video_bbox` 转换。
- `occluded=true` 表示目标存在但被遮挡，前端用虚线状态显示。

`video_bbox` geometry：

```json
{
  "type": "video_bbox",
  "frame_index": 12,
  "x": 0.1,
  "y": 0.2,
  "w": 0.3,
  "h": 0.4
}
```

约定：

- `frame_index` 从 0 开始，是唯一时间轴定位字段。
- `x/y/w/h` 与图片 bbox 一样使用归一化坐标。
- `annotation_type` 写 `video_bbox`。
- v0.9.20 起，`video_bbox` 可由视频矩形框工具直接创建，也可由 track 转换 API 生成。

## Track 转独立框 API

v0.9.20 新增：

```http
POST /api/v1/tasks/{task_id}/annotations/{annotation_id}/video/convert-to-bboxes
```

请求体：

```json
{
  "operation": "copy",
  "scope": "track",
  "frame_mode": "all_frames"
}
```

字段：

| 字段 | 取值 | 说明 |
|---|---|---|
| `operation` | `copy` / `split` | `copy` 保留原 track；`split` 会移除源 keyframe 或删除整条源 track |
| `scope` | `frame` / `track` | 转换当前帧或整条轨迹 |
| `frame_index` | number | `scope=frame` 时必填 |
| `frame_mode` | `keyframes` / `all_frames` | `scope=track` 时决定只转关键帧还是展开插值帧 |

响应返回源 annotation 的新状态、创建出的 `video_bbox[]`、是否删除源 track，以及被移除的 frame indexes。`copy` 不会改动源轨迹，`removed_frame_indexes` 为空；`split` 才会移除源关键帧或删除整条源轨迹，并返回被移除的帧号。`all_frames` 使用与 Video Tracks JSON 导出相同的后端插值 helper：outside/absent 范围不输出 bbox，也不会跨消失段转换。为避免长视频一次性写爆 annotation 表，单次请求最多生成 5000 个 `video_bbox`。

## 插值与质量检查

前端只在相邻有效关键帧之间做 bbox 线性插值：

- `x/y/w/h` 按 `frame_index` 距离线性计算。
- 如果两个关键帧之间存在 `absent=true`，不显示跨段插值。
- 手工 / 预测关键帧优先于插值结果。
- 编辑时 bbox 会 clamp 到 `[0, 1]` 归一化范围。

当前质检提示在前端完成，不阻止保存：

- 同一 track 关键帧间隔过大。
- 当前帧 bbox 极小。
- 当前帧同类别 bbox 高度重叠。

## Video Tracks JSON 导出

v0.9.18 起，`video-track` 项目可通过现有导出入口拿到专用 JSON：

```http
GET /api/v1/projects/{project_id}/export?format=coco&video_frame_mode=keyframes
GET /api/v1/projects/{project_id}/batches/{batch_id}/export?format=coco&video_frame_mode=all_frames
```

虽然复用了 `format=coco` 查询参数，响应不是 COCO，而是：

```json
{
  "export_type": "video_tracks",
  "exported_at": "2026-05-11T00:00:00",
  "frame_mode": "keyframes",
  "project": { "id": "...", "display_id": "P-1", "type_key": "video-track" },
  "categories": [{ "id": 0, "name": "car" }],
  "tasks": [{ "id": "...", "display_id": "T-1", "video_metadata": { "fps": 25 } }],
  "tracks": [
    {
      "annotation_id": "...",
      "task_id": "...",
      "track_id": "trk_car",
      "class_name": "car",
      "outside": [{ "from": 24, "to": 48, "source": "manual" }],
      "keyframes": [
        {
          "frame_index": 0,
          "bbox": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 },
          "source": "manual",
          "absent": false,
          "occluded": false
        }
      ]
    }
  ],
  "keyframes": [],
  "video_bbox": [],
  "video_metadata": {}
}
```

导出模式：

- `keyframes`：只输出持久化关键帧。
- `all_frames`：每条 track 增加 `frames[]`，后端按相邻有效关键帧线性插值 `x/y/w/h`。

插值规则与前端显示保持一致：outside 段优先；精确关键帧其次；`absent=true` 的旧关键帧会被当作单帧 outside；`occluded=true` 表示目标存在但遮挡，不阻断插值。`video_frame_mode=all_frames` 不输出 outside 范围内的 bbox，也不会把 track → `video_bbox` 转换到 outside 帧上。

`include_attributes=false` 会移除 `project.attribute_schema` 以及 track / legacy `video_bbox` 上的 `attributes`。`format=yolo|voc` 对视频项目返回 400，因为这两个格式会丢失 track 与关键帧语义。

## 前端 Stage 边界

`WorkbenchShell` 只计算 `stageKind`。`WorkbenchStageHost` 根据 `stageKind` 分派到 `ImageWorkbench` / `VideoWorkbench` / `ThreeDWorkbench.placeholder`；视频任务由 `VideoWorkbench` 包装 `VideoStage`。

`stageKind` 的视频入口仍由 `task.file_type === "video"` 或项目类型 `video-track` 决定。3D 入口只显示占位，不复用视频内部 geometry。

`VideoStage` 暴露 `VideoStageControls` ref，由 `useWorkbenchHotkeys` 在 `videoMode` 下统一分发快捷键。视频模式快捷键：

- `Space` 播放 / 暂停
- `B` / `T` 切换视频矩形框 / 轨迹工具
- `←` / `→` 逐帧
- `,` / `.` 逐帧备用键
- `Shift + ←/→` 跳 10 帧
- `Delete` / `Backspace` 删除选中轨迹
- `Tab` / `Shift+Tab` 循环轨迹
- `Esc` 取消选择
- `1-9` 有选中视频对象时改其 `class_name`；无选中时切 active class

图片工作台的 SAM、polygon、canvas 工具在视频任务中不展示；左侧队列、顶部提交/审核、右侧属性面板、评论、任务锁和离线队列继续复用同一个 Workbench 外壳。

视频创建、追加关键帧、重命名、改类、track 转 bbox 等动作由 `useVideoAnnotationActions` 维护。跨 Stage 的 class picker / 改类 / SAM 接受 / 批量改类弹窗由 `WorkbenchOverlays` 渲染，不再挂在 `ImageStage.overlay` 上。

### 视频渲染层

v0.9.22 起，视频画布结构对齐 CVAT 的 canvas layer contract，但仍保留本项目的 React + SVG + HTML video 实现：

| 层 | 文件 | 职责 |
|---|---|---|
| Media | `VideoMediaLayer.tsx` | 承载 `<video>`，由 `useFrameClock` 驱动 |
| Bitmap | `VideoBitmapLayer.tsx` | R5.2 ImageBitmap / canvas 缓存预留入口，当前隐藏 |
| Grid | `VideoGridLayer.tsx` | R8 viewport / grid / minimap 预留入口，当前隐藏 |
| Objects | `VideoObjectsLayer.tsx` | 渲染 committed bbox、track path preview 和 pending draft |
| Text | `VideoTextLayer.tsx` | 独立渲染 label，避免文字吞掉 handle 命中 |
| Interaction | `VideoInteractionLayer.tsx` | 统一 pointer 入口、picker、选中框、resize handle、draft、ghost |
| Attachment | `VideoAttachmentLayer.tsx` | 后续 hover thumbnail、review issue、comment anchor 的 DOM 挂载点 |

`VideoStageSurface` 负责统一尺寸、aspect ratio、层叠顺序和未来 transform 入口。对象层不再给每个 bbox 主体挂 `pointerdown`，Interaction 层通过 `videoStageCoordinates.ts` 把 client 坐标映射到视频归一化坐标，再用 `videoStagePicking.ts` 选择顶层框。

`videoStageMode.ts` 提供轻量 busy guard：`idle` 允许 seek / draw / drag / resize；`draw` / `drag` / `resize` 期间 frame setup 会被拦截并暂停播放，避免播放 tick 覆盖编辑中的几何。

v0.9.19 后，`VideoStage` 底部固定控制条改为 `VideoPlaybackOverlay`：

- 悬浮在视频画布底部，不再占用 stage 布局高度。
- hover 时显示，离开后延迟淡出；绘制或拖动 bbox 时隐藏，避免误触 scrubber。
- 保留播放 / 暂停、逐帧按钮、range scrubber、关键帧 tick、当前帧号、时间和当前帧框数。
- v0.9.23 起，底部标记的数据源升级为 timeline markers：keyframe 仍显示为细线，prediction 使用不同颜色，outside 段显示为灰色区间；完整多轨时间轴仍留给 R4。

## History / Offline

图片工作台的 `useAnnotationHistory` 仍处理 annotation 级 create / update / delete。视频侧在 v0.9.19 增加 `videoKeyframe` command：

- 单个 `frame_index` 的关键帧新增、移动、`absent` 和 `occluded` 切换只撤销该关键帧。
- 创建 / 删除整条 track、重命名类别仍按 annotation 级命令处理。
- apply 时读取当前最新 `video_track` geometry，只替换目标帧 keyframe，保留其它关键帧。

视频写操作仍走原 annotation API。网络断开或 5xx 时：

- create 进入现有 offline queue 的 `create` op。
- keyframe update / rename 进入现有 offline queue 的 `update` op。
- 恢复连接后由 `useWorkbenchOfflineQueue` 顺序重放。
- 409 版本冲突不进入离线队列，继续打开通用 `ConflictModal`；keyframe diff UI 留后续增强。

`VideoStage` 内部维护轨迹列表 UI 状态：

- 显隐和锁定只影响当前工作台会话，不持久化。
- 重命名轨迹会更新 annotation 顶层 `class_name`。
- 选中轨迹但当前帧无可显示 bbox 时，stage 会用最近非 `absent` 且未落入 outside 的关键帧渲染虚线参考框；拖动参考框或点击「复制到当前帧」会通过同一 `upsertKeyframe` 路径创建当前帧关键帧，并清理当前帧 outside 覆盖。
- 当前轨迹面板展示 `track_id` + `frame_index`，审核退回时可复制到原因文本中定位问题。
