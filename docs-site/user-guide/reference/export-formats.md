---
audience: [annotator, project_admin]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-11
---

# 数据导出格式

![导出格式选择](../images/export/format-select.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 导出对话框，COCO / YOLO / VOC / Label Studio JSON 4 个选项 + 当前选中状态 + 导出范围（项目 / 批次）。 -->

项目 Dashboard 的「导出」入口支持以下格式。图片项目可选择 COCO / YOLO / Pascal VOC；视频轨迹项目只显示 Video JSON。

![导出进度](../images/export/progress.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 导出进行中的进度条 + 完成后的下载链接 toast。 -->

## COCO JSON

最常用格式，适配 Detectron2、MMDetection、YOLOv8 等。

结构：

```json
{
  "info": {...},
  "images": [{"id": 1, "file_name": "...", "width": 800, "height": 600}],
  "annotations": [
    {
      "id": 1,
      "image_id": 1,
      "category_id": 1,
      "bbox": [x, y, w, h],
      "segmentation": [[x1, y1, x2, y2, ...]],
      "area": 12345,
      "iscrowd": 0
    }
  ],
  "categories": [{"id": 1, "name": "person", "supercategory": ""}]
}
```

## YOLO

每张图一个 `.txt`，每行一个 bbox：

```
<class_id> <cx> <cy> <w> <h>      # 全部归一化到 [0,1]
```

附带 `data.yaml`：

```yaml
names: [person, car, bicycle]
nc: 3
```

## Pascal VOC

每张图一个 `.xml`，与 LabelImg 兼容。

## Label Studio JSON

平台间迁移用，含完整原数据 + 标注 + 审核备注。

## AAP JSON v1.0（无损）

> v0.10.15 起新增。**平台原生无损中间格式**。与 COCO / YOLO / VOC 并列，但**包含**它们丢失的所有字段：`attribute_schema` 值、`prediction.confidence` / `model_version`、`annotation.source`、项目 `annotation_guide`、`classes_config`、`rendering_config`。

适合场景：

- **跨实例迁移**：A 平台 → B 平台，标注不丢失。
- **客户自家模型预测导入**：导出空项目结构 → 客户用自家模型填 `predictions[]` → 上传到 `/projects/{id}/predictions/import` 端点。
- **dataset snapshot 锚点**：版本化备份 / 训练复现。

结构（简化）：

```json
{
  "schema_version": "1.0",
  "exported_at": "2026-05-19T10:00:00Z",
  "exported_from": {
    "platform": "aap",
    "platform_version": "0.10.15",
    "project_display_id": "P-12",
    "batch_display_id": "BT-3"
  },
  "project": {
    "name": "Traffic Sign",
    "type_key": "image-det",
    "classes_config": { },
    "attribute_schema": { "fields": [] },
    "rendering_config": {},
    "annotation_guide": "..."
  },
  "tasks": [
    {
      "task_match": {
        "display_id": "T-101",
        "file_path": "datasets/foo/img_001.jpg"
      },
      "annotations": [
        {
          "geometry": { "type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 },
          "class_name": "stop_sign",
          "attributes": {},
          "confidence": null,
          "source": "manual"
        }
      ],
      "predictions": [
        {
          "geometry": { "type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 },
          "class_name": "stop_sign",
          "confidence": 0.92,
          "model_version": "ext-yolov8-v1",
          "source": "external_import"
        }
      ]
    }
  ]
}
```

关键规则：

- `schema_version` 必填，breaking change 升 major，导入端 `major > 1` 返 422。
- `annotations[]` 与 `predictions[]` **分开两个数组**（不混 type 字段）。
- 导出严格写满 null；导入 lenient 忽略未知字段、缺失按默认。
- `task_match` 走 `display_id` 优先（全局唯一），`file_path` fallback；跨项目 `display_id` 不允许偷换项目。
- `geometry` 使用平台**内部格式**（`bbox` / `polygon` / `multi_polygon`），不嵌套 LabelStudio shape。

详见 [ADR-0024](../../../docs/adr/0024-aap-json-format.md) 与 [API 导入指南](../../api/guides/import.md)。

## 视频轨迹

v0.9.18 起，`video-track` 项目导出入口只显示 **Video JSON**。导出文件保留轨迹、关键帧、目标消失段和视频元数据，不会伪装成 COCO / YOLO / VOC。

可选帧模式：

- **关键帧**：默认模式，只导出人工 / 预测关键帧，适合备份、质检和后续继续编辑。
- **所有帧**：导出时按相邻有效关键帧线性插值展开每帧 bbox，适合下游训练或逐帧质检。

目标消失语义：

- `absent=true` 表示该帧目标不存在。
- 所有帧模式不会跨越 `absent=true` 的关键帧插值。
- `occluded=true` 表示目标存在但被遮挡，仍可参与插值。

Video JSON 顶层包含 `export_type: "video_tracks"`、`frame_mode`、项目 / 类别 / 任务信息、`tracks[]`、扁平 `keyframes[]`、旧版 `video_bbox[]` 和 `video_metadata`。

## 选哪个？

| 用途 | 推荐 |
|---|---|
| 训练 YOLOv8 | YOLO |
| 训练 Detectron2 / MMDetection | COCO |
| **跨实例无损迁移 / 客户自训模型预测灌入** | **AAP JSON** |
| 数据迁移 / 备份 | AAP JSON / Label Studio JSON |
| 视频轨迹备份 / 质检 | Video JSON（关键帧） |
| 视频逐帧训练 | Video JSON（所有帧） |
| 老项目维护 | Pascal VOC |
