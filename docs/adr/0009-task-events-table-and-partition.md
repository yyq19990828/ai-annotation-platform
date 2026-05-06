# ADR-0009: task_events 表与按月分区方案

- **Status**: Proposed
- **Date**: 2026-05-06
- **Supersedes**: —
- **Related**: ADR-0006 (predictions 月分区), ADR-0008 (audit_logs 不可变 trigger)

## Context

v0.8.4 落「效率看板 / 人员绩效」epic 时新增了高频写表 `task_events`：

- 每位标注员 task 切换时 push 一条 `{task_id, user_id, project_id, kind, started_at, ended_at, duration_ms, ...}`
- 写入路径：工作台 `useSessionStats.ts` 缓冲 → `POST /auth/me/task-events:batch` → Celery `persist_task_events_batch` → INSERT
- 读取路径：物化视图 `mv_user_perf_daily` 每小时聚合 + AdminPeoplePage 详情页直接读
  耗时直方图原始数据

写入量级（产品线规模假设）：
- 单标注员每分钟 ~1-2 条（task 切换粒度）
- 1 万标注员 / 8 小时工作 / 60 min ≈ **480 万行/日**，月 ≈ **1.4 亿行**
- 当前内部部署量级 ≤ 50 标注员 / 8h ≈ **2.4 万行/日** ≈ 月 70 万

本期（v0.8.4）选择**不分区**，避免引入复合主键 + 多分区维护负担。但 schema 设计要为未来按月 RANGE 分区留好出口。

## Decision

**Stage 1（v0.8.4，本期）**：
- 普通表 `task_events`，PK = `id` (UUID)
- 索引：`(user_id, started_at DESC)` / `(project_id, started_at DESC)` / `(kind, started_at DESC)` / `(task_id)`
- 物化视图 `mv_user_perf_daily` 聚合源
- Celery beat hourly REFRESH MATERIALIZED VIEW CONCURRENTLY

**Stage 2（触发条件满足后另起 PR）**：
- 单月 INSERT > 100k 或总行数 > 1M
- 迁移 schema 为 `PARTITION BY RANGE(started_at)`，PK 改为 `(id, started_at)`
- 子分区命名：`task_events_y{YYYY}m{MM}`（与 `audit_logs` 一致）
- 创建 12 个月历史分区 + 3 个月未来分区
- Celery beat 每月 25 日 `ensure_future_task_events_partitions`（参考 ADR-0008）
- 冷数据归档：超过 `task_events_retention_months`（默认 24）的分区导出到 MinIO 后 DROP
- 物化视图：分区表上 REFRESH 不变（不依赖底层是否分区）

## Consequences

**正向：**
- v0.8.4 实现路径短、迁移代价小，能在不阻塞前端落地的窗口内完成。
- Schema 列与索引与未来分区表对齐，Stage 2 只需改表结构 + 数据迁移，应用代码无需改动。

**负向 / 风险：**
- 单表行数若超出预期增长（例如客户突击导入老数据集），查询性能会先于触发阈值劣化；
  需在监控里盯 `pg_stat_user_tables.n_live_tup` for `task_events`。
- 工作台批量写在 broker 抖动时 fallback 到同步路径（在 `me.py` 中 inline INSERT），
  此时单批次最多 200 行 INSERT 阻塞 1 个请求；建议 staging 环境压测 P95 < 200ms。
- 物化视图 `mv_user_perf_daily` 当日 lag ≤ 1 小时；端点优先读视图，
  当日窗口需用「视图 ∪ 直查 task_events」联合（参考 dashboard.py 的实现）。
- 分布式部署时，`pg_get_serial_sequence` 对 UUID 不适用 — 本表用 UUID 主键避开了 `audit_logs` 的 sequence 同步问题。

## Stage 2 触发流程（草案）

1. 监控触发：`SELECT count(*) FROM task_events` > 1,000,000 或 `pg_stat_get_inserted` 单月 > 100k。
2. 冻结 Celery 写入（`task_events_async = False`，sync fallback 持续）。
3. 在维护窗口运行迁移：
   - `ALTER TABLE task_events RENAME TO task_events_legacy`
   - 创建分区父表 `task_events` PARTITION BY RANGE (started_at)，PK=(id, started_at)
   - 创建覆盖 [min(legacy.started_at) 月, current+3] 的子分区
   - `INSERT INTO task_events SELECT * FROM task_events_legacy`
   - 重建 mv_user_perf_daily 唯一索引（其分区表已天然支持 CONCURRENTLY refresh）
   - DROP TABLE task_events_legacy
4. 恢复 `task_events_async = True`。

预计 1M 行迁移在 2c8g 实例上 < 5 min。

## Open Questions

- 是否给标注会话粒度（`session_id`）单独建二级索引？目前所有查询都按 `user_id + started_at` 走，
  无人统计「单会话内 task 切换分布」，暂不加。
- mv_user_perf_daily 是否需要按 `kind` 进一步分裂为两个视图？目前查询都带 `WHERE kind=…` filter，
  视图本身按 `(user_id, project_id, kind, day)` UNIQUE 索引已能命中，不分裂。
