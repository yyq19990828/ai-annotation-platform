---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-23
---

# 导出

标注数据导出为下游训练可用格式。v0.10.27 起导出**异步化**：`POST` 创建后台 job 返回 `202 {job_id}`，产物 ZIP 生成后在任务铃用 7 天预签名 URL 下载（VOC 仍同步返回 blob）。v0.10.43 起导出目标**可多选**，一个 job 产一个 ZIP。

## 触发导出

```http
POST /api/v1/projects/{project_id}/export?targets=coco&targets=yolo-det&include_attributes=true
POST /api/v1/projects/{project_id}/batches/{batch_id}/export?targets=coco&include_attributes=true
```

参数：

| 参数 | 取值 | 说明 |
|---|---|---|
| `targets` | 可重复，多选 | `coco` / `yolo-det` / `yolo-obb` / `yolo-seg` / `aap_json` / `video_json` / `yolo-frames-det` / `mot` / `kitti`；`voc` 仅可单选（与其它混选返 400），走同步 blob 下载 |
| `include_attributes` | `true` / `false` | 是否携带 `annotation.attributes` 与 `project.attribute_schema` |
| `video_frame_mode` | `keyframes` / `all_frames` | 仅 `video-track` 生效；默认 `keyframes` |

非 VOC 目标返回 `202 {job_id}`；勾选多个目标时产物 ZIP 内各目标落 `{target}/` 子目录，单目标落包根。`video-track` 项目只接受视频目标（`video_json` / `yolo-frames-det` / `aap_json` / `mot` / `kitti`），选图片目标会返回 400。

v0.11.13 起，导出会按项目当前类别 / 属性定义做兜底收敛：`class_name` 已不在当前类别集合内的标注不会进入任何导出格式；`annotation.attributes` 只保留当前 attribute schema 内的用户属性 key。这样即使尚未执行 cleanup，导出文件的 schema 与 data 也保持一致。

## 格式说明

| 目标 | 适用 |
|---|---|
| **coco** | COCO `annotations.json`：bbox + segmentation(polygon/mask) + keypoints(skeleton) + group_id |
| **yolo-det** | YOLO 检测 txt（矩形框）+ classes.txt，每图一文件 |
| **yolo-obb** | YOLO 旋转框 txt（rotated_bbox 四角） |
| **yolo-seg** | YOLO 分割 txt（polygon / mask 归一化多边形） |
| **aap_json** | 平台原生无损中间格式（双数组 annotations / predictions） |
| **yolo-frames-det** | `video-track` 专用逐帧 YOLO 检测集，按采样网格抽帧，合并 `video_bbox` 与 `video_track` 摊平框 |
| **mot** | MOT 16/17/20 tracking 评测格式，按采样网格重排帧号 |
| **kitti** | KITTI Tracking 2D label 文本 |
| **voc** | Pascal VOC XML（仅同步单选） |
| **video tracks json** | `video-track` 专用 JSON（`video_json` 目标） |

v0.10.43 起 COCO / YOLO 不再只处理 bbox：各目标按其消费的几何（bbox / rotated_bbox / polygon / multi_polygon / keypoint）映射，不匹配的几何跳过（COCO 跳过数记在 `info.skipped_annotations`）。

## 视频轨迹导出

`video-track` 项目通过 `targets=video_json` 返回专用 Video Tracks JSON。响应顶层包含：

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
- `all_frames`：在每条 track 的 `frames[]` 中展开逐帧 bbox。后端按相邻有效关键帧线性插值，`outside` 段阻断跨段插值、不输出 bbox。缺少 `frame_count` 时用最大已标注帧兜底。

`include_attributes=false` 时，视频 JSON 不输出 `project.attribute_schema`，也不输出 track / legacy `video_bbox` 的 `attributes`。

`targets=yolo-frames-det` 会生成逐帧 YOLO 检测集：

- 帧集来自项目采样网格 `derive_sampled_frames(frame_count, step)`，不是全帧，也不是仅关键帧。
- `video_bbox` 单帧框只在 `frame_index` 落网格时输出。
- `video_track` 先用 `resolved_track_frames(..., frame_mode="all_frames")` 展开，再筛采样网格；`outside` 区间不输出框。
- ZIP 内写 `labels/{sequence}/{frame:06d}.txt`、`classes.txt`、`data.yaml`、`manifest.json`、`fetch_videos.py`、`fetch_frames.py`。帧图不打包，`fetch_frames.py` 会抽到 `images/{sequence}`，与 label 路径对齐。

schema 语义见 [视频标注工作台](/dev/concepts/video-annotation-workbench)。

## 权限

| 角色 | 能否导出 |
|---|---|
| viewer | ❌ |
| annotator | ❌ |
| reviewer | ❌ |
| project_admin | ✅（自己的项目） |
| super_admin | ✅（任何项目） |
