---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-07-22
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

客户端先 `POST /api/v1/tasks/{task_id}/mask-content` 上传 `{encoding:"coco_rle",size,counts}` 获得引用，再创建或更新 annotation。需要对象存储压缩时增加 `storage_encoding:"gzip"`；需要压缩 HTTP 请求时仍发送相同 JSON，并设置 `Content-Encoding:gzip`。返回引用的 `encoding` 始终是 `coco_rle_ref`，gzip 引用额外带 `storage_encoding:"gzip"` 和 `.json.gz` key。

图片的原生像素 Mask 使用相同引用，但 geometry 是单态的 `raster_mask`：

```json
{
  "annotation_type": "raster_mask",
  "tool_unit_id": "region",
  "class_name": "person",
  "geometry": {
    "type": "raster_mask",
    "mask": {
      "encoding": "coco_rle_ref",
      "size": [1080, 1920],
      "object_key": "raster-masks/sha256/...json",
      "sha256": "...",
      "runs": 312,
      "bytes": 3727
    }
  }
}
```

每个 task 最多保留 256 个尚未被 annotation POST/PATCH 认领的匿名上传；重复上传相同内容不重复占额度。达到上限返回 `422 mask_quota_exceeded`。图片读取使用 `GET /api/v1/annotations/{annotation_id}/mask-content`；视频当前解析帧使用带 `{frame_index}` 的路径，兼容客户端也可以用带帧路径读取图片单态 Mask。响应支持 `If-None-Match` 命中返回 304；对象损坏或尺寸失配返回 409，存储暂时不可用返回可重试 503。部署可以分别控制读取和创建；创建关闭时仍允许安全读取存量 geometry。

## Mask 实例原子操作

拆分、复制、合并和严格非重叠会在一个任务级事务内提交：

```http
POST /api/v1/tasks/:id/annotations/mask-mutations:commit
```

请求的核心字段是：

- `idempotency_key`：同一预览重试必须复用同一个 key；同 key 异参返回 `idempotency_conflict`。
- `operation`：`split_components`、`copy_component`、`copy_keyframe`、`join_masks` 或 `overlap`。`copy_keyframe` 只用于视频，并要求 `source_frame_index`。
- `scope`：固定 image / video、当前帧与 segment、同类 / 全部对象过滤、overlap policy 和是否要求严格非重叠。
- `scope_fingerprint` 与 `expected_versions`：必须来自同一个预览快照；版本项按 annotation UUID 排序并覆盖范围内全部对象。
- `mutations`：只允许有判别字段的 `update | create | delete`；geometry 只能是 `raster_mask` 或 `video_track_mask`，新内容引用必须先由当前任务上传保留。
- `report`：只接收受控的面积、拓扑、连通性和受影响对象摘要；不得携带 RLE counts 或任意客户端 JSON。服务端会从实际 RLE 重算并覆盖可审计指标，不信任客户端面积或变化像素。

服务端在同一事务内复核任务可见性与可编辑状态、对象与分段锁、范围成员、版本、类别、帧和内容引用，然后一次写入
annotation 变更、内容关联、操作账本、lineage、任务统计和聚合审计。响应只返回操作 ID、对象 ID / 版本、删除 ID、lineage、摘要和审计 ID，不回传完整 geometry 或 RLE。

服务端还会对像素代数做权威校验：component copy 必须等于指定 4/8 连通性下的一个完整源连通域，keyframe copy 必须与来源帧当时解析的完整 RLE 逐像素相同，split 的每个结果必须是完整连通域且不重叠地覆盖全部来源，join 必须等于全部来源并集，overlap 必须精确等于「原对象 − 主 Mask」。视频 keyframe copy 即使来源在目标帧不可见，也会把来源加入范围指纹与版本锁；新轨只含目标帧的 manual keyframe。视频 join 只允许在当前帧创建副本并保留源轨迹；不允许用单帧请求删除整条来源轨迹。视频 update 只重验当前帧新引用，其他关键帧必须与已锁定的源 geometry 逐项相同，不会在提交时重读整条历史轨迹的对象。

请求体上限为 12 MiB，范围候选对象、版本项、mutation 和引用的 RLE 对象各不得超过 1000，单次验证的 RLE runs 总数不得超过 200 万，派生 RLE 不得超过 100 万 runs，累计代数与连通域扫描不得超过 500 万步，严格非重叠经过 bbox 剪枝后最多比较 10 万对。范围查询在 SQL 层使用 `limit + 1` 预检；超限请求会在无界加载或更大规模的像素计算之前被拒绝。

缺少范围版本返回 `428 expected_versions_missing`。范围成员变化、版本漂移、任务 / 对象 / 分段锁冲突分别返回结构化 409 reason；操作合同、类别、geometry、引用或空结果无效返回结构化 422 reason。任一失败都不会留下部分 annotation 或账本记录。

## 原生 AI Mask 候选采纳

交互式推理返回的原生 Mask 是短生命周期候选，不应由客户端拆成“上传内容 + 创建标注”两次写操作。客户端应把候选和平台签发的 receipt 提交到任务级原子采纳接口：

```http
POST /api/v1/tasks/:id/ai-mask-candidates/accept
```

请求包含 `idempotency_key`、候选 RLE 与 `candidate_id`、`prompt_revision`、receipt、类别、目标、prompt 计数摘要、实际路由和推理摘要。图片新建使用 `target.mode=create`；视频还要给出当前 `frame_index`；精修使用 `target.mode=refine`，同时提供 `source_annotation_id`、`source_version` 和同值 `If-Match`。

服务端重新检查任务状态、assignment、任务与标注锁、项目 Mask 写闸、媒体尺寸和类别，并原子写入 Prediction、lineage、接受 decision、Annotation 与审计。响应返回完整 Prediction、Annotation、源/结果版本和内容摘要，ETag 对应结果版本。相同 task、幂等键和请求会回放第一次的完整响应；同 key 不同请求、过期 decision 或版本漂移返回 409。客户端只有收到成功响应后才能清理候选。

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
