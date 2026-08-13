# 0066 — 视频协同以 Segment Fragment 为写入真相

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** core team
- **Supersedes:** —

## Context

ADR-0018 确立了视频帧服务、固定 Segment 与 Segment lease，ADR-0045 又把
`track_id` 提升为 Annotation 一等列。但当前一条视频轨迹仍是一行覆盖完整视频的
Annotation，工作台也持有 Task 级长锁。两名标注员因此无法在相邻 Segment 保存彼此
独立的 overlap 结果，Track 级一致性也没有可比较的输入。

| 选项 | 主要卖点 | 主要劣势 |
| --- | --- | --- |
| **Segment fragment + 派生 canonical track** | 写入隔离清晰，保留原始结果，导出可确定性聚合 | 读取和导出需要 projection |
| 多人共享完整 Annotation | 不改表结构 | 写冲突，无法获得独立 overlap 结果 |
| 对账后再写一条完整 Annotation | 导出读取简单 | fragment 与完整轨迹形成两份真相 |

## Decision

协同模式下，每条视频 Annotation 必须归属一个 `VideoSegment`，并且只保存该
Segment `work range` 内的单帧几何或 track fragment。旧任务保留
`video_segment_id = NULL`，继续使用原来的单人完整轨迹语义；不自动拆分旧数据。

`VideoSegment.start_frame / end_frame` 继续表示互不重叠的 core range。相邻
Segment 的 overlap 只派生 `work_start_frame / work_end_frame`，不重复落库。
Annotation 写入统一验证 Segment assignee、有效 lease 和 work range。

边界审核只保存 fragment 之间的 `same_track / different_track` 决策。canonical
track 是已接受决策图上的派生读模型：先把每个 fragment 裁回 core range，再按
`same_track` 连通分量聚合；不新建一条完整轨迹 Annotation。

项目配置 `video_collaboration` 默认关闭。只有视频项目且不存在有效 Annotation、
不存在运行中 tracker job 时才可启用；产生 fragment 后不得切回 legacy 模式。

## Consequences

正向：

- 相邻 Segment 可以由不同用户并行写入，overlap 保留两份独立输入。
- 原始 fragment、质量报告和 canonical 输出各自职责明确，没有双写漂移。
- 旧项目和旧 Annotation 无需迁移数据。

负向：

- Annotation 查询必须显式带 Segment scope。
- 跨 Segment 的读取、审核和导出必须经过 canonical projection。
- 协同项目不能直接退回旧模式，需先完成对账或另建项目。

## Alternatives Considered

**共享完整 Annotation**：Task 锁改成 Segment 锁后仍会有同一 JSONB 行并发覆盖，且
overlap 两侧没有独立版本，不能作为 IAA 或 TrackEval 输入。

**写回完整 canonical Annotation**：虽然能复用旧导出查询，但每次 fragment 或审核
决策变化都必须同步第二份大 JSONB，失败时难以判定哪份数据权威。

## Notes

- 实施计划：`docs/plans/2026-08-13-v0.23.30-video-overlap-tracker-context-track-quality.md`
- 相关 ADR：ADR-0018、ADR-0045、ADR-0047
- 相关迁移：`apps/api/alembic/versions/0153_video_segment_fragments.py`
