# 数据导出格式

项目「导出」页面支持以下格式。所有导出会异步生成 zip，完成后 Dashboard 顶栏出现下载链接（保留 7 天）。

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

## 选哪个？

| 用途 | 推荐 |
|---|---|
| 训练 YOLOv8 | YOLO |
| 训练 Detectron2 / MMDetection | COCO |
| 数据迁移 / 备份 | Label Studio JSON |
| 老项目维护 | Pascal VOC |
