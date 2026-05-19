---
audience: [dev]
type: reference
since: v0.10.15
status: stable
last_reviewed: 2026-05-19
---

# 外部预测导入端点

v0.10.15 起新增。允许客户把**外部模型**（不通过平台 ML backend 跑的模型）生成的预测灌入平台，进入"AI 预标 → 人工修正 → 导出"工作流。

支持两种输入格式：**COCO Detection** 与平台原生 **AAP JSON v1.0**（无损中间格式）。

## 端点

```http
POST /api/v1/projects/{project_id}/predictions/import?format=aap_json&dry_run=false
Content-Type: multipart/form-data

file=<JSON file>
model_version=<optional fallback string>
overwrite_existing=<true|false default false>
```

参数：

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `format` | query | `aap_json` \| `coco` | 是 | input 格式. 默认 `aap_json`. |
| `dry_run` | query | bool | 否 | true 时走全部校验路径但**不入库**, 供前端 wizard 预览. |
| `file` | form | File | 是 | JSON 文件. |
| `model_version` | form | string | 否 | AAP JSON 内 `model_version` 缺失时的兜底值. |
| `overwrite_existing` | form | bool | 否 | true 时按 task 维度删该 task 下 `source='external_import'` 的旧 prediction 后再写入. |

权限：项目 owner 或 super_admin（与 ML backend 配置同位）。

## 响应

```json
{
  "imported": 42,
  "skipped": 3,
  "errors": [
    {"task_match": {"display_id": "T-999"}, "reason": "task not found in project"},
    {"task_match": {"file_path": "x.jpg"}, "reason": "unsupported geometry kind: 'polyline'"}
  ],
  "dry_run": false
}
```

错误是逐 entry 累计，不让整批挂；只有 schema_version 不兼容 / JSON 不可解析才整体 422。

## AAP JSON 格式

详见 [用户文档 · AAP JSON v1.1](../../user-guide/reference/export-formats#aap-json-v11无损) + [ADR-0024](../../dev/adr/0024-aap-json-format).

最小可导入示例：

```json
{
  "schema_version": "1.0",
  "tasks": [
    {
      "task_match": { "display_id": "T-101" },
      "predictions": [
        {
          "geometry": { "type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 },
          "class_name": "stop_sign",
          "confidence": 0.92,
          "model_version": "ext-yolov8-v1"
        }
      ]
    }
  ]
}
```

支持的 geometry kind：`bbox` / `polygon` / `multi_polygon`。其他 kind（`video_bbox` / `video_track` / 自定义）进 errors[] 不入库。

## COCO Detection 格式

最小子集：`images[]` + `annotations[]` + `categories[]`。bbox 是 COCO 标准 `[x, y, w, h]` 像素坐标，用 `images[].width/height` 归一化。

匹配规则：用 `images[].file_name` 当 `task.file_path`（调用方应保证 dataset 命名一致）。

`annotations[].score` 字段被读为 confidence；缺失则 confidence=None。

## 写入语义

- 写入的 `predictions` 行：`source='external_import'`, `ml_backend_id=NULL`, `model_version=<entry 内值或 form 兜底>`, `result=<内部 LS shape 数组>`.
- AAP JSON 每个 `predictions[i]` 对应**一条** Prediction 行（单 shape）；COCO 每个 `annotations[i]` 对应一条。
- 写入路径复用 `PredictionService.create_from_ml_result`，确保与 ML backend 写入路径同源。

## task_match 匹配规则

AAP JSON `task_match` 是 oneof：

1. **`display_id` 优先**：全局唯一，最稳。命中后校验 `project_id` 一致；跨项目命中视为不匹配（防偷换项目）。
2. **`file_path` fallback**：项目内查；命中第一条即返。
3. 都没给或都不命中 → entry 进 errors[]，整批继续。

## dry-run 工作流（推荐）

```bash
# Step 1: dry-run 预览
curl -X POST "https://platform/api/v1/projects/$PID/predictions/import?format=aap_json&dry_run=true" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@external_preds.json"

# 检查 errors[] 是否符合预期，调整 input 后...

# Step 2: 正式导入
curl -X POST "https://platform/api/v1/projects/$PID/predictions/import?format=aap_json&dry_run=false" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@external_preds.json" \
  -F "overwrite_existing=true"
```

## 审计

所有非 dry-run 导入在 `audit_logs` 写一条 `predictions.import` 记录，`detail_json` 含 `format` / `imported` / `skipped` / `error_count` / `overwrite_existing` / `model_version_fallback`。
