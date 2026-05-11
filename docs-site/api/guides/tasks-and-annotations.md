---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-11
---

# 任务与标注

## 任务模型

`tasks` 表的每行代表一条待标数据，可以是一张图片、一个视频任务，或其它项目类型的数据。它属于一个 batch，batch 属于 project。任务生命周期：

```
created → assigned → in_progress → submitted → reviewed → completed
                                              ↘ returned ↗
```

## 拉取下一个任务

```http
POST /api/v1/tasks/next
{ "project_id": 1, "batch_id": 5 }
```

返回一个未被锁定的任务并**加锁 30 分钟**（[ADR 0005](../../dev/adr/0005-task-lock-and-review-matrix)）。同一标注员重复调用拿同一个；其他人拿不到。

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

提交后任务状态进入 `submitted`，锁释放。

## 视频任务

v0.9.16 起，视频任务会在 `GET /api/v1/tasks/:id` 的 `TaskOut.video_metadata` 里透出标准化视频元数据：

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
    "poster_frame_path": "thumbnails/..."
  }
}
```

工作台播放视频前会再请求 manifest：

```http
GET /api/v1/tasks/:id/video/manifest
```

如果原视频编码不是浏览器稳定支持的 H.264，media worker 会生成 `playback/*.mp4`；manifest 的 `video_url` 优先返回该播放版本。

返回 presigned 播放地址、poster 地址和同一份标准化 metadata。非视频任务会返回 `400`。

v0.9.16 的视频标注使用逐帧 `video_bbox`：

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

v0.9.17 起，新建视频标注默认使用 compact `video_track`，一条 annotation 表达一个对象轨迹：

```json
{
  "annotation_type": "video_track",
  "class_name": "person",
  "geometry": {
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
}
```

`video_track.keyframes[]` 只保存关键帧；插值帧由前端按需计算，不会展开写入 `annotations` 表。旧 `video_bbox` 数据仍可读取和显示。

## 视频轨迹转独立框

v0.9.20 起，视频轨迹可以转换为一个或多个独立 `video_bbox`：

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

## 候选预测（AI 紫框）

```http
GET /api/v1/tasks/:id/predictions
```

返回**经过 `to_internal_shape` adapter 处理**的内部 schema（不是 LabelStudio 原 raw）。详见 [Schema 适配器](../../dev/troubleshooting/schema-adapter-pitfalls)。

## 采纳预测

```http
POST /api/v1/tasks/:id/annotations/accept
{ "prediction_id": 42, "shape_index": 0 }   # v0.9.10 拆 shape 级
```

后端会：
1. 把 shape 写入 `annotations`（source=ai-accepted）
2. 反查 `classes_config` 把 alias 映射回原类别名（v0.9.10 B-11）
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

锁过期后由后台清理任务自动归还。详见 [ADR 0005](../../dev/adr/0005-task-lock-and-review-matrix)。

## 相关

- [审核](./predictions)
- [WebSocket 协作](../../dev/ws-protocol)
