# Architecture Decision Records

本目录记录关键架构决策，采用 [Michael Nygard 模板](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)。

## 何时写一份 ADR

满足以下任一即应写：

- 选了一个会影响后续 6 个月以上代码结构的方案
- 在两个以上方案间纠结，最终选了不那么显然的一个
- 引入了新的核心库 / 框架
- 改了某个跨多模块的约定（命名、层次、契约）

## 何时**不**写

- 单个 bug 修复 → CHANGELOG 即可
- 临时方案、技术债 → 在代码里加 TODO + issue 链接
- 可被 git log 解释清楚的小重构

## 命名

`NNNN-short-kebab-title.md`，编号自增，**不**复用、**不**删除。

如果决策被推翻，新建一份 ADR，把旧的状态改为 `Superseded by ADR-XXXX`，但**保留旧文档**。

## 模板

见 [`TEMPLATE.md`](TEMPLATE.md)。复制为 `NNNN-short-kebab-title.md`，填入元数据与各章节即可。

规范化要点（所有 ADR 应满足）：

- 标题：`# NNNN — 简短中文标题`（em-dash，不写 `ADR-NNNN:` 前缀）
- 元数据块（紧跟标题，列表形式）：`Status` / `Date` / `Deciders` / `Supersedes` 四项必填
- 章节顺序：`Context` → `Decision` → `Consequences`（正向 / 负向）→ `Alternatives Considered`（可选）→ `Notes`（可选）
- 引用代码：`path/to/file.py:NN`，便于跳转

## 索引

- [0001](0001-record-architecture-decisions.md) — Record architecture decisions
- [0002](0002-backend-stack-fastapi-sqlalchemy-alembic.md) — 后端选型：FastAPI + SQLAlchemy 2.0 async + Alembic
- [0003](0003-openapi-client-codegen.md) — 前端 OpenAPI 客户端生成方案：@hey-api/openapi-ts
- [0004](0004-canvas-stack-konva.md) — 标注画布引擎：Konva（4 Layer 架构）
- [0005](0005-task-lock-and-review-matrix.md) — 任务锁（5min TTL）与审核流转角色矩阵
- [0006](0006-predictions-partition-by-month.md) — predictions 表按月 RANGE 分区
- [0007](0007-audit-log-partitioning.md) — 审计日志月分区
- [0008](0008-batch-admin-locked-status.md) — 批次 admin-locked 字段（与状态机正交）
