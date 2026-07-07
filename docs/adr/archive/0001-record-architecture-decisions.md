# 0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-05-05
- **Deciders:** core team
- **Supersedes:** —

## Context

随着代码增长，越来越多关键决策（选型、分层、契约）只活在 commit message 与个人记忆里。新人加入或半年后回看时，无法回答「为什么当初这么做」「考虑过哪些替代」。

## Decision

采用 [Michael Nygard ADR 模板](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)，存放于 `docs/adr/`。

每份 ADR：

- 文件名 `NNNN-short-kebab-title.md`，编号单调递增
- 必须有：Status / Date / Context / Decision / Consequences
- 决策可以被推翻，但旧 ADR 不删除——把状态改为 `Superseded by ADR-XXXX`

## Consequences

正向：
- 新人可在 1 小时内通读历史决策
- 评审 PR 时有依据指向「我们在 ADR-XX 已经选了 A 路线」
- 决策与代码解耦：ADR 在 docs/，不进 docs-site（保留为内部档）

负向：
- 需要团队养成习惯——「写 ADR 像写 commit」
- 早期回填工作量

## 后续

回填：
- 0002 — FastAPI + SQLAlchemy + Alembic 选型
- 0003 — `@hey-api/openapi-ts` 作为前端类型生成方案
- 0004 — Konva 作为标注画布引擎
- 0005 — 任务锁与审核流的状态机设计
