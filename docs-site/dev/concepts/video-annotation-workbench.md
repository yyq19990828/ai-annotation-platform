---
audience: [dev]
type: explanation
since: v0.9.16
status: stable
last_reviewed: 2026-05-11
---

# 视频标注工作台

v0.9.16 落地视频工作台 M0 + M1：视频元数据、manifest、播放/逐帧定位，以及当前帧 bbox 标注。

v0.9.17 把视频标注升级为 `video_track`：一条 annotation 保存一个对象轨迹和 compact keyframes，前端按需显示关键帧与线性插值结果。

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

## Annotation Schema

v0.9.17 起，新建视频标注默认写 `video_track`：

```json
{
  "type": "video_track",
  "track_id": "trk_...",
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
- `keyframes[]` 是持久化数据；插值结果由前端按相邻关键帧计算，不写库。
- `source` 当前支持 `manual` / `prediction` / `interpolated`；前端不会把计算得到的 interpolated frame 展开保存。
- `absent=true` 表示目标在该帧消失，插值不能跨越该关键帧。
- `occluded=true` 表示目标存在但被遮挡，前端用虚线状态显示。

v0.9.16 的旧数据使用 `video_bbox` geometry：

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
- v0.9.17 继续读取和显示旧 `video_bbox`，但新建视频标注不再使用它。

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

插值规则与前端显示保持一致：精确关键帧优先；`absent=true` 的关键帧不输出 bbox，并阻断跨段插值；`occluded=true` 表示目标存在但遮挡，不阻断插值。

`include_attributes=false` 会移除 `project.attribute_schema` 以及 track / legacy `video_bbox` 上的 `attributes`。`format=yolo|voc` 对视频项目返回 400，因为这两个格式会丢失 track 与关键帧语义。

## 前端 Stage 边界

`WorkbenchShell` 根据 `task.file_type === "video"` 或项目类型 `video-track` 选择 `VideoStage`，否则仍走 `ImageStage`。

`VideoStage` 暴露 `VideoStageControls` ref，由 `useWorkbenchHotkeys` 在 `videoMode` 下统一分发快捷键。视频模式快捷键：

- `Space` 播放 / 暂停
- `←` / `→` 逐帧
- `Shift + ←/→` 跳 10 帧
- `Delete` / `Backspace` 删除选中轨迹
- `Tab` / `Shift+Tab` 循环轨迹
- `Esc` 取消选择
- `1-9` 切 active class

图片工作台的 SAM、polygon、canvas 工具在视频任务中不展示；左侧队列、顶部提交/审核、右侧属性面板、评论、任务锁和离线队列继续复用原外壳。

`VideoStage` 内部维护轨迹列表 UI 状态：

- 显隐和锁定只影响当前工作台会话，不持久化。
- 重命名轨迹会更新 annotation 顶层 `class_name`。
- 当前轨迹面板展示 `track_id` + `frame_index`，审核退回时可复制到原因文本中定位问题。
