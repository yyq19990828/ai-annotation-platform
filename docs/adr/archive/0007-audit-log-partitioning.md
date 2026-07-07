# 0007 — 审计日志月分区

- **Status:** Accepted（已实施 · v0.8.1 / 迁移 0037）
- **Date:** 2026-05-06（原计划「延期执行」，v0.8.1 提前推进，配合冷数据归档一次落地）
- **Deciders:** core team
- **Supersedes:** —

## Context

`audit_logs` 表随业务增长将持续膨胀。v0.7.8 已通过 trigger 实现不可变性（0032 迁移），但未做分区。当前数据量 < 10 万行，查询性能未到瓶颈，但合规向（GDPR / 行业审计）要求超过保留期的数据自动归档。v0.8.1 与「数据导出审计强化」一起推进。

## Decision

采用 PostgreSQL RANGE(created_at) 按月分区，触发条件：
- 单月 INSERT > 100k 行，或
- 总行数 > 1M

### 分区设计

```sql
CREATE TABLE audit_logs (
    id BIGSERIAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- ... 其他字段 ...
    PRIMARY KEY (id, created_at)  -- 分区表 PK 必须包含分区键
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_logs_y2026m05
    PARTITION OF audit_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
```

### 迁移步骤

1. 创建新的分区父表 `audit_logs_new`
2. 为当前月 + 下月创建子分区
3. `INSERT INTO audit_logs_new SELECT * FROM audit_logs` 批量迁移（分批 10k 行避免长锁）
4. 在同一事务中 `ALTER TABLE audit_logs RENAME TO audit_logs_legacy; ALTER TABLE audit_logs_new RENAME TO audit_logs;`
5. 重建 0032 trigger 到新父表
6. 验证后 DROP audit_logs_legacy

### FK 影响

- `audit_logs.actor_id` 引用 `users.id` (ON DELETE SET NULL)：分区子表自动继承 FK
- 分区表 PK 变为 `(id, created_at)` 复合键

### 分区维护

Celery beat 月度任务 `ensure_next_partition()`：检查下月分区是否存在，不存在则 CREATE。

### 冷数据归档

超过 6 个月的分区可 DETACH → pg_dump → 上传 S3 → DROP（需 super_admin 手动触发或 cron job）。

### 与 0032 trigger 的交互

分区子表自动继承父表上定义的 trigger。新建分区后 trigger 自动生效，无需额外操作。

## Consequences

正向：

- 查询 WHERE created_at 范围内可命中单个分区（partition pruning）
- 归档操作为 O(1) DETACH 而非全表扫描

负向：

- PK 变化需确认无代码硬依赖 `audit_logs.id` 做 FK
- 大表（> 1M 行）单事务 INSERT 会锁较久；本期数据量 < 100k 不构成问题，后续到 1M+ 时改用 `pg_partman` 或分批迁移脚本
- 分区子表名进入 `pg_catalog.pg_class`，反射时会被 ORM 看到 → `tests/test_alembic_drift.py` 已豁免 `audit_logs_y*` 模式

## Alternatives Considered（详）

**TimescaleDB 扩展**：自动分区 + 压缩，但增加运维依赖（额外扩展、版本绑定、备份链路），当前规模收益不抵成本。

**应用层 soft-delete + 定期 TRUNCATE**：审计日志语义不允许删除（合规向），TRUNCATE 等价于销毁证据；soft-delete 也无助于查询性能。

**分库**：复杂度过高，目前单库读写完全在 PG 单实例承载内。

## Notes

### 迁移落地（0037）

实际迁移路径与原始设计一致，关键细节：

1. 重命名旧表 `audit_logs → audit_logs_legacy`，并显式重命名所有冲突索引（PG 不会自动重命名 index/constraint，PK 名为 `audit_logs_pkey`）。
2. 建新分区父表，PK = `(id, created_at)`，完整复制原 7 个索引（含 GIN on detail_json）。
3. 子分区覆盖 `[min(legacy.created_at), current_month + 3]` 区间，按月切。
4. 不可变 trigger 直接挂在分区父表上（PG13+ 自动级联到所有当前/未来子分区）。
5. `INSERT INTO audit_logs SELECT * FROM audit_logs_legacy` 一次性批量迁移（< 100k 行，单事务可控）。
6. `setval(pg_get_serial_sequence('audit_logs', 'id'), max_id)` 同步序列，避免 ID 回滚。

### Celery 维护任务（v0.8.1 新增）

- `ensure_future_audit_partitions`（每月 25 日 03:00 UTC）：保证未来 3 个月分区存在。
- `archive_old_audit_partitions`（每月 2 日 03:00 UTC）：扫保留期外子分区，stream-gzip 上传 MinIO `audit-archive/{year}/{month}.jsonl.gz`，成功后 `DROP TABLE <partition>`，并写 `audit.archive` 审计行。
- 保留期由 `AUDIT_RETENTION_MONTHS`（默认 12）控制。

### 驱动这个时机点的因素

- 与 v0.8.1 「治理合规向」epic 协同：自助注销 GDPR、导出审计水印、分区归档同期落地，统一回收散点。
- 从 P3 提前到本期是用户决策（plan AskUserQuestion 选择「按月分区表（重）」方案）。
