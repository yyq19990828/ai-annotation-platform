# 0002 — 后端选型：FastAPI + SQLAlchemy 2.0 async + Alembic

- **Status:** Accepted
- **Date:** 2026-05-06（回填；选型实际发生于 v0.1.0 阶段）
- **Deciders:** core team
- **Supersedes:** —

## Context

平台后端需要承担：
- 重 IO（PG / Redis / MinIO / 远端 ML backend）；标注页一次访问要并行拉 task / image presigned URL / annotations / predictions。
- 类型契约严格（前端 codegen 走 OpenAPI），DTO 校验不能仅靠运行期 try/except。
- 数据迁移频繁——v0.6 ~ v0.7 共 33 个 alembic revision，含分区、PG trigger、复合索引等非平凡变更。
- Python 生态首选（团队熟练 + ML/数据流水线已经在 Python 上）。

候选栈：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **FastAPI + SQLAlchemy 2.0 async + Alembic** | type-first、原生 async、Pydantic 校验、社区主流 | SQLAlchemy 学习曲线 + alembic 自动生成不能完全信任 |
| Django REST Framework + Django ORM | batteries-included、admin 后台、auth 现成 | sync-only（DRF）、ORM 表达力弱、迁移系统更弱、前端 codegen 不友好 |
| Tortoise ORM + FastAPI | async + Pydantic 友好 | 生态小、迁移工具 aerich 成熟度差、JSONB / 复合索引支持不全 |
| Node + Prisma + Express/Hono | 单语言全栈 + Prisma DX 顶级 | Python ML 生态对接弯道多；团队需切语言；FastAPI 已能复用 ML lib |

## Decision

采用 **FastAPI 0.115+** 作为 HTTP/WS 框架、**SQLAlchemy 2.0 async** + **asyncpg** 作为 ORM/驱动、**Alembic** 作为迁移工具。

具体约束：

1. **路由结构**：按业务模块切到 `apps/api/app/api/v1/<feature>.py`，每个文件一个 `APIRouter`，统一在 `app/api/v1/router.py` 装配。
2. **DTO 严格分离**：路由签名只接受/返回 `app/schemas/*.py` 中的 Pydantic 模型；ORM 模型不直接出 JSON。
3. **Service 层显式**：复杂业务（IoU、批次状态机、邀请）抽 `app/services/<name>.py`，路由只做参数校验 + 事务编排 + 调 service。
4. **Alembic 手写**：自动生成只用作起草，必须人工审过——尤其涉及 PG trigger、partition、复合 FK 等 alembic autogenerate 不会处理的场景（参见 ADR-0006 的 stage 2 计划）。
5. **async 全链路**：禁止 `db.execute(text("..."))` 之外的 sync DB 调用混入；外部 HTTP 用 `httpx.AsyncClient`。

## Consequences

正向：

- 类型契约一路打通：Pydantic schema → OpenAPI → 前端 `@hey-api/openapi-ts` 生成（参见 ADR-0003）；前端拿到的类型与后端 DTO 1:1 对齐。
- async 让 ML backend 调用、Redis pubsub、WS 心跳全部走同一个事件循环；v0.7.0 后 WS 改用模块级 ConnectionPool，副本下连接数受控。
- Alembic 给了手术级迁移控制：v0.7.6 加 `ix_predictions_created_at`、v0.7.8 装 `audit_logs` 不可变 trigger，都靠 alembic raw SQL 实现。
- FastAPI dependency injection（`Depends`）让权限装饰器（`require_roles(...)`）非常薄，权限矩阵全在 `app/core/permissions.py` 一处。

负向：

- SQLAlchemy 2.0 async API 对新人门槛高：`select()` 表达式、`await session.execute(...).scalar_one_or_none()`、relationship lazy load 在 async 下需 explicit `selectinload`。这是在 PR review 中频繁回踩的点。
- alembic autogenerate 对 enum 改动、JSONB 默认值、check constraint 经常缺值——所有非平凡迁移必须人工逐句校对。
- 缺 admin 后台。审计日志页 / 用户管理页 / 系统设置页全都自己写 React 实现——比 Django admin 慢，但定制度更高。

## Alternatives Considered（详）

**Django REST Framework**：会大幅减少 user / auth / admin 的开发量，但 DRF 默认 sync 路由 + Django ORM relationship 对前端 codegen 极不友好（生成的 schema 充斥 `string | null` 而无判别 union）；大批量 IO 需要切到 channels/asgi 单独栈，分裂成本高。

**Tortoise ORM**：API 风格最像 Django ORM，async 天生，但 aerich 迁移工具不成熟（v0.7.x 时仍不支持复合 FK 自动生成）；对 PG 高级特性（partition、generated column、trigger）缺一等支持。

**Node + Prisma**：DX 最顺、generated client 类型完美，但团队 Python ML 流水线（Adala 类 LLM agent、SAM 推理预处理）已经成型，改 Node 等于双语言维护两份。

**Hono / Bun + Drizzle**：v0.6.x 评估过；Bun 的 async runtime 在 PG 长连接上仍有零星 bug；社区比 FastAPI 小一个量级；放弃。

## Notes

- 当前 Python 版本要求 ≥ 3.12，CI 跑 3.13；仓库 venv 在 3.14 上验证过（参见 `apps/api/.venv` 路径）。
- 路由总数已超过 140 个端点（v0.7.x 末），分文件后单文件平均 < 40 个端点，可读性维持。
- 测试层采用 pytest-asyncio + httpx test client + Postgres testcontainers（CI）/ 本地 docker-compose db（dev）。
