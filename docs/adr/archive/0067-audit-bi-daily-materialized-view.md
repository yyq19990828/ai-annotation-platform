# 0067 — 审计 BI 采用日粒度物化与热数据补尾

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** core team
- **Supersedes:** —

## Context

`audit_logs` 已按 UTC 月份分区并具备在线索引与冷归档，但审计页面只能逐行查询，月度统计需要反复扫描
原始流水。原路线图计划在约 10M 行且月报出现查询压力后再建设聚合层；本期决定提前交付可用闭环。

当前数据量仍小，因此方案必须在未来规模下可用，同时避免为了预期压力引入新的分析数据库、服务或运维
依赖。审计流水不可变，但当前 UTC 日仍持续写入；冷归档月份只保留在 MinIO，不应为了图表重新载入在线库。

## Decision

创建 `mv_audit_bi_daily` PostgreSQL 物化视图，按 `day / action / target_type / actor_role /
status_family` 聚合已经结束的 UTC 日期：

- 唯一索引覆盖全部维度，允许 `REFRESH MATERIALIZED VIEW CONCURRENTLY`；
- Celery beat 每日 `00:10 UTC` 在既有 `cleanup` 队列刷新；
- 月报 API 从物化视图读取已覆盖日期，从 `audit_logs` 读取其后的热数据并合并；
- 视图为空或刷新落后时，原表读取范围自动扩大，优先保证数字完整；
- BI 仅覆盖在线保留期，冷归档继续使用现有月份回源接口；
- 汇总 API 只开放给 super admin，不复制 IP、target ID 或 detail JSON 等敏感高基数维度。

前端在现有审计页展示月度 KPI、每日趋势、Top action、目标类型和角色分布，并复用 action 精确过滤完成
汇总到明细的下钻。

## Consequences

正向：

- 历史月份查询不再扫描 `audit_logs` 分区；
- 当天数据实时可见，刷新失败不会造成静默缺数；
- 复用 PostgreSQL、Celery beat 和现有审计权限边界，没有新增运行服务或依赖；
- 删除视图即可回滚，不改写审计流水。

负向：

- 每日刷新仍会扫描在线审计分区；达到真实大规模后需监控刷新时长和 IO；
- 月报不包含已归档月份，跨保留期分析仍需独立离线流程；
- `materialized_through` 之前的日期依赖最近一次成功刷新，不提供分钟级历史聚合更新。

## Alternatives Considered

**按日增量汇总表**：刷新成本更低，但需要 watermark、幂等 upsert、归档协调和修复工具。审计在线数据当前
只有约 35k 行，尚不足以承担这套状态维护。

**ClickHouse / TimescaleDB / 通用 BI 服务**：可扩展性更强，但引入新的部署、备份、权限和同步边界，远超
单一月报需求。

**月粒度物化视图**：行数更少，但无法直接提供每日趋势，当前月也需要更复杂的整月重算与合并。日粒度是
可视化与刷新成本之间的最小稳定粒度。

## Notes

- 迁移：`apps/api/alembic/versions/0155_audit_bi_daily_mv.py`
- API：`apps/api/app/api/v1/audit_logs.py`
- 定时刷新：`apps/api/app/workers/cleanup.py`、`apps/api/app/workers/celery_app.py`
- 前端：`apps/web/src/pages/Audit/AuditPage.tsx`
