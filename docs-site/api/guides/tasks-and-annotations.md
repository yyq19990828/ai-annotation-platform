# 任务与标注

## 任务模型

`tasks` 表的每行代表"一张图待标"。它属于一个 batch，batch 属于 project。任务生命周期：

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
