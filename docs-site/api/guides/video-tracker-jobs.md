---
audience: [dev]
type: how-to
status: stable
last_reviewed: 2026-07-14
---

# Video Tracker Jobs

Video Tracker Job API 用于视频工作台里的异步 AI 追踪。它与批量预标 `Prediction` API 分开：推理结果先暂存为 job candidate，调用 accept 后才写入 annotation。

## 创建追踪任务

```http
POST /api/v1/tasks/{task_id}/video/tracks/{annotation_id}:propagate
Authorization: Bearer <token>
Content-Type: application/json
```

最小请求：

```json
{
  "from_frame": 0,
  "to_frame": 120,
  "model_key": "sam2_video",
  "direction": "forward",
  "output_geometry": "mask"
}
```

种子驱动的多目标 / 多帧请求：

```json
{
  "from_frame": 0,
  "to_frame": 120,
  "model_key": "sam3_video_interactive",
  "direction": "forward",
  "prompt": {
    "seeds": [
      {
        "obj_id": 1,
        "prompts": [
          { "frame_index": 0, "bbox": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 } },
          { "frame_index": 24, "points": [[0.5, 0.5, 1], [0.7, 0.5, 0]] }
        ]
      },
      {
        "obj_id": 2,
        "prompts": [
          { "frame_index": 0, "points": [[0.8, 0.4, 1]] }
        ]
      }
    ]
  }
}
```

## 文本与视觉示例

文本自动发现使用 `model_key="sam3_video"`，并在请求顶层传必填 `text`。API 客户端还可用可选的 `exemplars` 收紧或排除相似实例：`bbox` 是归一化的 `[x1, y1, x2, y2]`，`label: true` 表示正示例，`label: false` 表示负示例。

```json
{
  "from_frame": 0,
  "to_frame": 120,
  "model_key": "sam3_video",
  "direction": "forward",
  "text": "the red car",
  "exemplars": [
    { "bbox": [0.10, 0.20, 0.32, 0.58], "label": true },
    { "bbox": [0.62, 0.18, 0.81, 0.55], "label": false }
  ]
}
```

工作台的文本追踪面板当前只收集 `text`；视觉示例适用于直接调用此 API 的客户端。`frame_index` 与范围字段始终使用绝对源帧。

创建端点要求 task 对当前用户可见、annotation 属于该 task，并且普通标注员持有覆盖整个范围的有效 video segment lock。请求不能跨 segment。

响应是 `VideoTrackerJobOut`，其中 `event_channel` 可用于订阅 WebSocket：

```text
WS /api/v1/ws/video-tracker-jobs/{job_id}?token=<jwt>
```

## 查询 job 与候选

```http
GET /api/v1/video-tracker-jobs/{job_id}
GET /api/v1/video-tracker-jobs/{job_id}/preview
```

两个端点都按 job 所属 task 做可见性检查。preview 响应：

```json
{
  "job_id": "...",
  "status": "pending_review",
  "annotation_id": "...",
  "grid_step": 1,
  "output_geometry": "bbox",
  "results": [
    {
      "frame_index": 1,
      "geometry": { "type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 },
      "confidence": 0.91,
      "outside": false,
      "instance_id": "1",
      "primary": true
    }
  ]
}
```

preview 只表示暂存候选，不代表 annotation 已经改变。没有 staged result 时 `results` 为空数组。

Mask preview 的 geometry 为 `{type:"mask", mask:coco_rle_ref, bbox?}`。内容通过下列鉴权端点读取，客户端应以 job id + instance id + frame + SHA-256 作为 staged cache identity：

```http
GET /api/v1/video-tracker-jobs/{job_id}/mask-content/{sha256}
```

## 接受、丢弃与取消

```http
POST /api/v1/video-tracker-jobs/{job_id}/accept
POST /api/v1/video-tracker-jobs/{job_id}/discard
DELETE /api/v1/video-tracker-jobs/{job_id}
```

这些写操作要求当前用户是 job 创建者，或对项目拥有特权角色：

- `accept`：只对带结果的 `pending_review` / `cancelled` job 应用候选。主实例回填源轨迹，额外实例各创建新轨迹；已接受时幂等返回。
- `discard`：只允许带暂存结果的 `pending_review` / `cancelled` job，清空 staged result，annotation 保持不变；已丢弃时幂等返回，其它状态返回 `409`。
- `DELETE`：请求停止 queued / running job。已计算的部分结果可能保留为 candidate，之后仍可接受或丢弃。

不要把 `DELETE` 当成“回滚已接受结果”；接受后需要通过 annotation API 做后续修改。

## 工作台刷新恢复

```http
GET /api/v1/tasks/{task_id}/video/tracker-jobs/reviewable
GET /api/v1/tasks/{task_id}/video/tracker-jobs/active
```

`reviewable` 返回当前任务中仍可审阅的 `pending_review`，以及带有 staged result 的 `cancelled` job，按创建时间倒序排列。客户端拿到 job 后继续调用 preview 端点加载逐帧候选；不要从 annotation 推导未接受结果。

`active` 返回当前任务下仍在运行的 `queued` / `running` job，供刷新后重连 WebSocket——这样运行中的追踪任务不会因整页刷新从界面消失，完成时仍能进入候选审阅。二者共享同一套 task 可见性与归属规则：先执行 task 可见性校验，普通用户只恢复自己创建的 job，项目 owner / 超级管理员可恢复该任务下全部 job。

## 状态语义

| status | 含义 |
|---|---|
| `queued` | 已入队，worker 尚未开始 |
| `running` | 正在分窗推理 |
| `pending_review` | 推理完成，候选已暂存，annotation 未改 |
| `cancelled` | 已取消；可能仍有部分 staged result |
| `accepted` | 候选已写入 annotation |
| `discarded` | 候选已丢弃 |
| `failed` | 推理失败，无可接受结果 |
| `completed` | 历史兼容状态；当前 runner 正常完成使用 `pending_review` |

## 管理员列表

```http
GET /api/v1/video-tracker-jobs?project_id=<uuid>&status=pending_review&model_key=sam2_video&limit=20&cursor=...
```

该列表仅项目管理员 / 超级管理员可调用，按 `created_at DESC, id DESC` 做 cursor 分页。超级管理员可读全局；项目管理员的 items 与 counts 始终限制在自己拥有的项目内，显式传入他人项目 id 只会得到空交集。响应包含：

- `items[]`：job、项目、模型、范围和时间字段。
- `next_cursor`：下一页游标。
- `counts`：在当前 `project_id / model_key` 过滤下按 status 聚合；counts 刻意忽略列表的 `status / cursor`，用于状态筛选器总数。

## 相关文档

- 架构与数据边界：[视频 AI 追踪架构](../../dev/concepts/video-ai-tracking)
- Worker / backend contract：[视频后端帧服务](../../dev/reference/video-frame-service#tracker-job)
- WebSocket：[WS 协议](../../dev/reference/ws-protocol#6-wsvideo-tracker-jobsjob_id)
- 运行时排障：[视频帧服务 Runbook](../../ops/runbooks/video-frame-service)
- OpenAPI 路由索引：[自动生成路由](./_routes.generated)
