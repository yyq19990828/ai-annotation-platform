---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-07-13
---

# 任务与标注

## 任务模型

`tasks` 表的每行代表一条待标数据，可以是一张图片、一个视频任务，或其它项目类型的数据。它属于一个 batch，batch 属于 project。任务状态以 `pending / in_progress / completed / review` 为主，批次状态负责更高层的生产推进。

```
pending → in_progress → completed → review
                 ↑          ↘ reviewer reject
                 └────────────── pending
```

## 拉取下一个任务

```http
POST /api/v1/tasks/next
{ "project_id": 1, "batch_id": 5 }
```

返回一个未被锁定的任务并**加锁 30 分钟**（[ADR 0005](../../dev/adr/archive/0005-task-lock-and-review-matrix)）。同一标注员重复调用拿同一个；其他人拿不到。

## 提交标注

```http
POST /api/v1/tasks/:id/annotations
{
  "shapes": [
    {
      "type": "rectanglelabels",
      "class_name": "dog",
      "geometry": { "x": 12, "y": 34, "width": 56, "height": 78 },
      "attributes": { "color": "brown" }
    }
  ]
}
```

提交后任务状态进入完成或待审核路径，锁释放。

## 视频任务

视频任务会在 `GET /api/v1/tasks/:id` 的 `TaskOut.video_metadata` 里透出标准化视频元数据：

```json
{
  "video_metadata": {
    "duration_ms": 1000,
    "fps": 25,
    "frame_count": 25,
    "width": 640,
    "height": 360,
    "codec": "mpeg4",
    "playback_path": "playback/...",
    "playback_codec": "h264",
    "poster_frame_path": "thumbnails/...",
    "frame_timetable_frame_count": 25
  }
}
```

工作台播放视频前会再请求 manifest：

```http
GET /api/v1/tasks/:id/video/manifest
```

如果原视频编码不是浏览器稳定支持的 H.264，media worker 会生成 `playback/*.mp4`；manifest 的 `video_url` 优先返回该播放版本。

返回 presigned 播放地址、poster 地址和同一份标准化 metadata。非视频任务会返回 `400`。

工作台还会读取帧时间表，用真实 `pts_ms` 替代单纯 `frame / fps`：

```http
GET /api/v1/tasks/:id/video/frame-timetable?from=0&to=120
```

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

存量视频没有时间表时会返回 `source: "estimated"` 和空 `frames`，前端继续按 `fps` 估算。

逐帧 `video_bbox` 表示单个 frame 上的独立框：

```json
{
  "annotation_type": "video_bbox",
  "geometry": {
    "type": "video_bbox",
    "frame_index": 12,
    "x": 0.1,
    "y": 0.2,
    "w": 0.3,
    "h": 0.4
  }
}
```

新建视频轨迹标注默认使用 compact `video_track_bbox`，一条 annotation 表达一个对象轨迹：

```json
{
  "annotation_type": "video_track_bbox",
  "class_name": "person",
  "geometry": {
    "type": "video_track_bbox",
    "track_id": "trk_...",
    "keyframes": [
      {
        "frame_index": 0,
        "bbox": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 },
        "source": "manual",
        "occluded": false
      }
    ]
  }
}
```

`video_track_bbox.keyframes[]` 只保存关键帧；插值帧由前端按需计算，不会展开写入 `annotations` 表。旧 `video_bbox` 数据仍可读取和显示。

逐像素视频轨迹使用 `video_track_mask`。关键帧内只保存内容寻址引用；帧间按最近关键帧保持，不做像素插值：

```json
{
  "annotation_type": "video_track_mask",
  "tool_unit_id": "region",
  "class_name": "person",
  "geometry": {
    "type": "video_track_mask",
    "track_id": "trk_...",
    "keyframes": [{
      "frame_index": 0,
      "source": "manual",
      "mask": {
        "encoding": "coco_rle_ref",
        "size": [1080, 1920],
        "object_key": "raster-masks/sha256/...json",
        "sha256": "...",
        "runs": 312,
        "bytes": 3727
      }
    }]
  }
}
```

客户端先 `POST /api/v1/tasks/{task_id}/mask-content` 上传 `{encoding:"coco_rle",size,counts}` 获得引用，再创建或更新 annotation。读取当前解析帧用 `GET /api/v1/annotations/{annotation_id}/mask-content/{frame_index}`；outside 帧返回 404。

## 视频轨迹转独立框

视频轨迹可以转换为一个或多个独立 `video_bbox`：

```http
POST /api/v1/tasks/:id/annotations/:annotation_id/video/convert-to-bboxes
{
  "operation": "copy",
  "scope": "track",
  "frame_mode": "all_frames"
}
```

参数：

| 字段 | 取值 | 说明 |
|---|---|---|
| `operation` | `copy` / `split` | `copy` 保留源轨迹；`split` 移除源关键帧或整条源轨迹 |
| `scope` | `frame` / `track` | 转换当前帧或整条轨迹 |
| `frame_index` | number | `scope=frame` 时必填 |
| `frame_mode` | `keyframes` / `all_frames` | `scope=track` 时生效 |

响应包含 `source_annotation`、`created_annotations[]`、`deleted_source` 与 `removed_frame_indexes`。`copy` 不会移除源帧，所以 `removed_frame_indexes` 为空；`split` 才会返回被移除的帧号。

视频标注支持 track composition：

```http
POST /api/v1/tasks/:id/annotations/video/track-compositions
```

```json
{
  "operation": "aggregate_bboxes",
  "annotation_ids": ["bbox-a", "bbox-b"],
  "delete_sources": true
}
```

| `operation` | 说明 |
|---|---|
| `aggregate_bboxes` | 将同任务、同类、无重复帧的 `video_bbox[]` 聚合为一条 `video_track_bbox` |
| `split_track` | 在 `frame_index` 可见帧之后，把一条 track 拆成前后两条 |
| `merge_tracks` | 合并两条同类、可见帧区间不重叠的 track，并自动补中间 `outside` gap |
| `join_tracks` | 跳连两条同类、可见帧区间不重叠的 track；`gap_mode=interpolate` 靠插值过渡 / `outside` 把 gap 标消失后合并 |

响应包含 `updated_annotations[]`、`created_annotations[]` 和 `deleted_annotation_ids[]`，客户端应按这三组结果更新 annotation 列表。

## 候选预测（AI 紫框）

```http
GET /api/v1/tasks/:id/predictions
```

返回**经过 `to_internal_shape` adapter 处理**的内部 schema（不是 LabelStudio 原 raw）。详见 [Schema 适配器](../../dev/troubleshooting/schema-adapter-pitfalls)。

## 采纳预测

```http
POST /api/v1/tasks/:id/annotations/accept
{ "prediction_id": 42, "shape_index": 0 }
```

后端会：
1. 把 shape 写入 `annotations`（source=ai-accepted）
2. 反查类别配置把 alias 映射回原类别名
3. 写审计 `annotation.prediction_accepted`

## 驳回预测

```http
POST /api/v1/tasks/:id/predictions/reject
{ "prediction_id": 42, "shape_index": 0 }
```

驳回后该 shape 不再出现在工作台候选里（按 prediction+shape_index 双键过滤）。

## 历史与版本

```http
GET /api/v1/tasks/:id/history          # annotation_history 全部 revision
GET /api/v1/tasks/:id/comments         # 标注评论
```

## 任务锁

| 端点 | 作用 |
|---|---|
| `POST /tasks/:id/lock` | 显式续锁 |
| `DELETE /tasks/:id/lock` | 主动释放 |

锁过期后由后台清理任务自动归还。详见 [ADR 0005](../../dev/adr/archive/0005-task-lock-and-review-matrix)。

## 相关

- [审核](./predictions)
- [WebSocket 协作](../../dev/reference/ws-protocol)
