# 0006 — predictions 表按月 RANGE 分区

- **Status:** Accepted（设计完成 · 真正迁移延期到行数 > 1M）
- **Date:** 2026-05-06
- **Deciders:** core team

## Context

`predictions` 表是项目里增长最快的事实表：每个 task × 每次 ML inference 落 1 行；千 task 项目跑 5 个 epoch 即 5k 行；规模化项目 / 流式 LLM 标注下，预计单项目每月 10w+ 行，全部写入单表。

观察到的痛点（v0.7.5 监控）：
- `created_at` 列无索引，按时间范围查询走全表 seq scan
- 后台 cleanup / 旧数据归档无法切分块批量 DROP，只能逐行 DELETE 触发 vacuum 压力
- 主备复制延迟在大 batch insert 下飙升（无分区 → 单页 wal 体积大）

ROADMAP 把「Predictions 表分区」放在 P2「监控触发再做」。v0.7.6 评估后选了**两阶段**实施。

## Decision

按 `RANGE(created_at)` 月分区，但分两阶段落地以控制风险：

### Stage 1（v0.7.6 已落，alembic 0031）

仅加 `ix_predictions_created_at` 单列 btree 索引。这一步：

- 解决 80% 痛点（按时间过滤的查询）
- 不动表结构，零下游影响
- 为 Stage 2 的数据搬迁提供高效扫描入口

### Stage 2（延期，触发条件：单月 INSERT > 100k 或 总行数 > 1M）

完整迁移到 partitioned table：

1. **重塑主键**：`predictions(id) PK` → `predictions(id, created_at) PK`
   PG 要求 partition key 必须在 PRIMARY KEY 中。
2. **改 FK**：
   - `prediction_metas.prediction_id` → 复合 FK `(prediction_id, prediction_created_at)`
     需要在 `prediction_metas` 加 `prediction_created_at` 列并回填
   - `annotations.parent_prediction_id` → 同样复合 FK
     需要在 `annotations` 加 `parent_prediction_created_at` 列并回填
3. **创建 partitioned 表**：`predictions_new PARTITION BY RANGE(created_at)`
   预创建过去 12 月 + 未来 3 月分区
4. **数据搬迁**：分批 INSERT chunked by month
5. **rename swap**：`predictions → predictions_old; predictions_new → predictions`
6. **保留 predictions_old** 7 天作为 rollback 缓冲
7. **新建 cron task** `app.workers.cleanup.create_next_month_partition`
   每月 1 日提前创建下个月的分区

### 为什么本期不直接做 Stage 2

权衡了三个维度：

| 维度 | 评估 |
|---|---|
| **业务收益** | 当前 prediction 行数仍在 10w 级，Stage 1 索引已能覆盖 80% 查询。Stage 2 收益边际递减。 |
| **改动半径** | `annotations.parent_prediction_id` 复合 FK 化 = annotations 表迁移，单表 100w+ 行，在线时间窗 ≥ 30min。 |
| **测试成本** | alembic round-trip 必须在仿真数据集上跑通；CI 数据量小测不出真实迁移问题。 |
| **回滚成本** | rename swap 一旦数据丢失需要 PITR 恢复。 |

结论：Stage 2 的成本（high）目前 ≪ 收益（low）。Stage 1 索引足以覆盖到下次扫描。

## Consequences

正向：
- v0.7.6 解决了 80% 的时间维度查询慢问题
- 真正迁移路径已写明，未来执行人有清晰 checklist
- ADR 中明确触发条件（行数 > 1M），避免讨论「什么时候做」

负向：
- 单月 INSERT 大于 100k 时，索引仍可能成为瓶颈（B-tree 写放大）
- `prediction_metas` UNIQUE(prediction_id) 仍有效，单表压力随 predictions 同步增长

## 监控触发

加监控告警（v0.7.7+）：
- `SELECT count(*) FROM predictions` 超过 1M → P2 工单
- `SELECT pg_total_relation_size('predictions')` > 5GB → P2 工单
- 单次 INSERT batch 平均 > 1s → P2 工单

任一触发后启动 Stage 2。
