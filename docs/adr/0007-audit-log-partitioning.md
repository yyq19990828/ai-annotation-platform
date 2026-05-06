# ADR-0007: 审计日志月分区

## 状态

已规划（延期执行）

## 背景

`audit_logs` 表随业务增长将持续膨胀。v0.7.8 已通过 trigger 实现不可变性（0032 迁移），但未做分区。当前数据量 < 10 万行，查询性能未到瓶颈。

## 决策

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

## 与 0032 trigger 的交互

分区子表自动继承父表上定义的 trigger。新建分区后 trigger 自动生效，无需额外操作。

## 替代方案

- **TimescaleDB 扩展**：自动分区 + 压缩，但增加运维依赖
- **应用层 soft-delete + 定期 TRUNCATE**：审计日志语义不允许删除
- **分库**：复杂度过高

## 后果

- 查询 WHERE created_at 范围内可命中单个分区（partition pruning）
- 归档操作为 O(1) DETACH 而非全表扫描
- PK 变化需确认无代码硬依赖 `audit_logs.id` 做 FK
