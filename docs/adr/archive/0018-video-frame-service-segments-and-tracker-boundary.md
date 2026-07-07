# 0018 — 视频帧服务 Segment 与 Tracker 边界

- Status: Accepted
- Date: 2026-05-12
- Deciders: Core engineering
- Supersedes: None

## Context

视频工作台已经有后端 frame timetable、chunk、frame cache 和 manifest v2。接下来需要支持长视频多人协作和 AI tracker 流式补帧。两个决策会影响后续代码结构：segment 是否要拆成独立协作单位，以及 tracker job 是否复用现有 `prediction_jobs`。

## Decision

`VideoSegment` 作为 `DatasetItem` 下的逻辑协作单位，不拆 `Task`，也不改变现有 scheduler。task 仍是工作台入口，segment 只表达视频内 frame range、assignee 和短 TTL lock。

Chunk 仍是物理缓存单位，segment 不要求与 chunk 对齐。后端保留自建 chunk/frame service，不切到 HLS/DASH，因为标注场景更看重精确帧寻址和 AI worker 复用单帧缓存。

后续 B5 tracker job 使用独立 `VideoTrackerJob`，不塞进现有 `PredictionJob`。`PredictionJob` 面向批量预标注历史，字段强依赖 project/batch/ml_backend/total_tasks；tracker 是交互式、frame range、可取消、可流式输出，独立表能降低迁移和状态机耦合。

## Consequences

正向：

- 长视频可以在不破坏现有 task 工作流的前提下逐步引入多人协作。
- 前端可先消费 `segments` 和 lock 协议，后续再接 presence 和 tracker。
- B5 tracker 可围绕 segment lock 校验 frame range，不需要反向改造 B4。

负向：

- 第一版会出现 task 与 segment 两层状态，需要文档明确各自职责。
- 已生成 segment 的视频如果调整 `VIDEO_SEGMENT_SIZE_FRAMES`，需要后续提供重建或迁移命令。
- 自建 chunk/frame service 要继续维护 ffmpeg、MinIO 缓存和 GC 逻辑。

## Alternatives Considered

1. 拆 Task 为多个子任务：能复用现有调度，但会影响批次统计、审核状态和旧前端 manifest，改动面过大。
2. 使用 HLS/DASH：更适合播放分发，但精确 frame index、AI 抽帧复用和标注导出一致性更难控制。
3. 复用 `prediction_jobs` 做 tracker：减少表数量，但会让交互式取消、流式结果和 frame range 校验混进批量预标注模型。
