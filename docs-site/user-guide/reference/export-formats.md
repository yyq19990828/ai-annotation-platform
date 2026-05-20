---
audience: [annotator, project_admin]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-20
---

# 数据导出格式

![导出格式选择](../images/export/format-select.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 导出对话框，COCO / YOLO / AAP JSON 选项 + 当前选中状态 + 导出范围（项目 / 批次）。 -->

项目 Dashboard 的「导出」入口支持以下格式。图片项目可选择 **COCO / YOLO / AAP JSON**；视频轨迹项目只显示 Video JSON。

## 导出流程（v0.10.27 起异步化）

点「导出」**不再即时下载**：后端会创建一个后台任务并立即弹出 toast「导出已入队，可在右上角任务铃查看进度并下载」，弹窗随即关闭。

![导出进度](../images/export/progress.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 右上角任务铃（JobsBell）里「数据导出」进度条 + 完成后的「下载」按钮。 -->

1. 在**右上角任务铃（JobsBell）**里能看到一条「数据导出」任务，附带进度条。
2. 任务完成后，该条目出现「下载」按钮。
3. 产物（ZIP）的下载链接 **7 天内有效，可反复点击下载**（任务铃在后台不轮询，故不会自动下载，需手动点）。

> **重复导出走缓存**：一周内对**同一范围（项目 / 批次）+ 同一格式 + 同一参数**、且标注未发生增删改的重复导出会**瞬间完成**（复用上次生成的产物）。只要标注有任何增删改，就会重新生成。

## 产物形态：仅标注 + 回源脚本（不含图片本体）

为了控制体积、并尊重「用户本地往往已有原图」的现实，导出的 ZIP **只包含标注与回源脚本，不打包图片本体**。无论选哪种格式，包内都含以下公共文件：

| 文件 | 说明 |
|---|---|
| `classes.txt` | 类别清单 |
| `attribute_schema.json` | 属性 schema |
| `data.yaml` | YOLO 训练入口，`images` / `labels` 路径已配好 |
| `images_manifest.json` | 每张图一条记录，含相对路径、所属 dataset，以及 **7 天有效的预签名下载 URL + `expires_at`** |
| `fetch_images.py` | 回源脚本（纯 Python stdlib），跑它把原图按相对路径下载到 `images/`，与 `labels/` 平行 |

**回源脚本用法**：解压 ZIP 后执行

```bash
python fetch_images.py
```

脚本读取 `images_manifest.json` 里的预签名 URL，把图片下载到 `images/<同相对路径>`，与 `labels/` 严格平行 → 即取即训。本地已有原图时可不跑此脚本。预签名 URL **7 天有效**（与导出产物生命周期对齐，无需配置 MinIO 密钥）；脚本启动时会校验 `expires_at`，临近过期会提示尽快下载。

各格式的标注落点不同，详见下文。

## COCO JSON

最常用格式，适配 Detectron2、MMDetection、YOLOv8 等。COCO 是单文档格式，落在包根的 `annotations.json`（无 per-image label 文件）。图片的 `width` / `height` 现在取**真实尺寸**（来自 dataset 记录；早期版本曾硬编码 1920×1280，已修复）。

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

label 文件按**镜像目录**组织，保留原数据集的递归子目录结构：

```
{project_id}/{dataset_id}/labels/<原图相对路径>.txt
```

例如 `animals/cat/001.jpg` → `{project_id}/{dataset_id}/labels/animals/cat/001.txt`。这修复了过去只用叶子文件名、导致同名跨目录文件互相覆盖、丢失目录结构的问题。`fetch_images.py` 拉下来的原图会落在与之平行的 `images/` 树下。

启用 `include_attributes` 时，每个 label 旁会附一个同名的 `.attrs.json`（如 `001.attrs.json`）。

附带 `data.yaml`：

```yaml
names: [person, car, bicycle]
nc: 3
```

## Label Studio JSON

平台间迁移用，含完整原数据 + 标注 + 审核备注。

## AAP JSON v1.1（无损）

> v0.10.15 引入 1.0；**v0.10.17 升 1.1** 加 `tool_unit_id` / `tool_bindings` 字段（向后兼容,1.0 reader 走 `extra="ignore"` 仍可解析）。**平台原生无损中间格式**。与 COCO / YOLO 并列，但**包含**它们丢失的所有字段：`tool_bindings`(工具维度类别/属性绑定) / `attribute_schema` 值、`prediction.confidence` / `model_version`、`annotation.source`、项目 `annotation_guide`、`classes_config`、`rendering_config`。

适合场景：

- **跨实例迁移**：A 平台 → B 平台，标注不丢失。
- **客户自家模型预测导入**：导出空项目结构 → 客户用自家模型填 `predictions[]` → 上传到 `/projects/{id}/predictions/import` 端点。
- **dataset snapshot 锚点**：版本化备份 / 训练复现。

AAP JSON 是单文档格式，落在包根的 `annotations.json`（无 per-image label 文件）。

结构（简化）：

```json
{
  "schema_version": "1.1",
  "exported_at": "2026-05-19T10:00:00Z",
  "exported_from": {
    "platform": "aap",
    "platform_version": "0.10.17",
    "project_display_id": "P-12",
    "batch_display_id": "BT-3"
  },
  "project": {
    "name": "Traffic Sign",
    "type_key": "image-det",
    "classes_config": { },
    "attribute_schema": { "fields": [] },
    "tool_bindings": {
      "bbox": {
        "enabled": true,
        "classes": [{ "name": "stop_sign", "color": "#ff0000", "order": 0 }],
        "attribute_schema": { "fields": [] }
      }
    },
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
          "tool_unit_id": "bbox",
          "attributes": {},
          "confidence": null,
          "source": "manual"
        }
      ],
      "predictions": [
        {
          "geometry": { "type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 },
          "class_name": "stop_sign",
          "tool_unit_id": "bbox",
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

- `schema_version` 必填，breaking change 升 major，导入端 `major > 1` 返 422; minor 升级(如 1.0 → 1.1) 只加可空字段, 老 reader 走 `extra="ignore"` 继续兼容。
- `annotations[]` 与 `predictions[]` **分开两个数组**（不混 type 字段）。
- 导出严格写满 null；导入 lenient 忽略未知字段、缺失按默认。
- `task_match` 走 `display_id` 优先（全局唯一），`file_path` fallback；跨项目 `display_id` 不允许偷换项目。
- `geometry` 使用平台**内部格式**（`bbox` / `polygon` / `multi_polygon`），不嵌套 LabelStudio shape。
- **v0.10.17 新增** `project.tool_bindings` (工具维度类别 / 属性绑定) + 每条 annotation / prediction 的 `tool_unit_id`(`bbox` / `region` / `ai_interactive` / ...)。导入端缺失时按 LS shape 类型回退派生(rectanglelabels→bbox, polygonlabels→region)。

详见 [ADR-0024](../../dev/adr/0024-aap-json-format) · [ADR-0026](../../dev/adr/0026-tool-unit-class-and-attribute-binding) · [API 导入指南](../../api/guides/import.md)。

## 视频轨迹

v0.9.18 起，`video-track` 项目导出入口只显示 **Video JSON**。导出文件保留轨迹、关键帧、目标消失段和视频元数据，不会伪装成 COCO / YOLO。

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
