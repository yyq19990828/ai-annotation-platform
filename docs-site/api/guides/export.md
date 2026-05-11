---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-11
---

# 导出

标注数据导出为下游训练可用格式。当前项目 / 批次导出接口直接返回文件响应；历史异步导出 job 设计保留为后续大规模导出方向。

## 触发导出

```http
GET /api/v1/projects/{project_id}/export?format=coco&include_attributes=true
GET /api/v1/projects/{project_id}/batches/{batch_id}/export?format=coco&include_attributes=true
```

参数：

| 参数 | 取值 | 说明 |
|---|---|---|
| `format` | `coco` / `voc` / `yolo` | 图片项目导出格式；`video-track` 仅支持通过 `coco` 兼容入口导出 Video JSON |
| `include_attributes` | `true` / `false` | 是否携带 `annotation.attributes` 与 `project.attribute_schema` |
| `video_frame_mode` | `keyframes` / `all_frames` | 仅 `video-track` 生效；默认 `keyframes` |

`format=coco` 返回 JSON；`format=voc|yolo` 返回 zip。`video-track` 的 `format=yolo|voc` 会返回 400。

## 格式说明

| 格式 | 适用 |
|---|---|
| **coco** | COCO `instances_*.json`，目标检测标杆 |
| **yolo** | YOLO txt 格式 + classes.txt，每图一文件 |
| **voc** | Pascal VOC XML |
| **video tracks json** | `video-track` 专用 JSON，经 `format=coco` 兼容入口返回 |

图片导出的 COCO / YOLO / VOC 只处理 bbox annotation。

## 视频轨迹导出

v0.9.18 起，`video-track` 项目通过 `format=coco` 入口返回专用 Video Tracks JSON，文件名为 `*_video_tracks.json`。响应顶层包含：

```json
{
  "export_type": "video_tracks",
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

`video_frame_mode`：

- `keyframes`：只输出持久化关键帧，适合备份、质检和后续可编辑 ingest。
- `all_frames`：在每条 track 的 `frames[]` 中展开逐帧 bbox。后端按相邻有效关键帧线性插值，`absent=true` 阻断跨段插值。缺少 `frame_count` 时用最大已标注帧兜底。

`include_attributes=false` 时，视频 JSON 不输出 `project.attribute_schema`，也不输出 track / legacy `video_bbox` 的 `attributes`。

schema 语义见 [视频标注工作台](/dev/concepts/video-annotation-workbench)。

## 权限

| 角色 | 能否导出 |
|---|---|
| viewer | ❌ |
| annotator | ❌ |
| reviewer | ❌ |
| project_admin | ✅（自己的项目） |
| super_admin | ✅（任何项目） |
