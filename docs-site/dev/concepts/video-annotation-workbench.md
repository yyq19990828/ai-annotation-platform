---
audience: [dev]
type: explanation
since: v0.9.16
status: stable
last_reviewed: 2026-05-11
---

# 视频标注工作台

v0.9.16 是视频工作台 MVP，只落 `video-track` 的 M0 + M1：视频元数据、manifest、播放/逐帧定位，以及当前帧 bbox 标注。

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
| `poster_frame_path` | poster 对象存储路径 |
| `probe_error` / `poster_error` | 解析或抽帧失败原因 |

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
    "codec": "h264"
  },
  "expires_in": 3600
}
```

非视频任务会返回 `400`。`GET /tasks/{id}` 也透出 `video_metadata`，用于列表和工作台决定是否进入视频 stage。

## Annotation Schema

v0.9.16 新增 `video_bbox` geometry：

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
- 本版本不表达 `track_id`、keyframe、interpolated source 或 absent/occluded 区间。

## 前端 Stage 边界

`WorkbenchShell` 根据 `task.file_type === "video"` 或项目类型 `video-track` 选择 `VideoStage`，否则仍走 `ImageStage`。

`VideoStage` 自己接管视频快捷键：

- `Space` 播放 / 暂停
- `←` / `→` 逐帧
- `Shift + ←/→` 跳 10 帧

图片工作台的 SAM、polygon、canvas 工具在视频任务中不展示；左侧队列、顶部提交/审核、右侧属性面板、评论、任务锁和离线队列继续复用原外壳。
