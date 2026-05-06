# NNNN — 简短标题（中文，描述决策本身而非问题）

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX | Deprecated
- **Date:** YYYY-MM-DD（首次进入 Accepted 状态的日期；回填请注明）
- **Deciders:** core team / 具体署名
- **Supersedes:** —（或 ADR-XXXX）

## Context

为什么现在要做这个决策？业务/技术背景、约束、痛点。

如果有候选方案，先在这里给出对比表（要点级），详细论证放到下方 *Alternatives Considered*：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **方案 A** | … | … |
| 方案 B | … | … |

## Decision

明确写出**选了什么 + 关键参数 + 落地约束**。能让后来者照此实施，而不只是"我们决定用 X"。

如有必要，分子节（实现细节、状态机示意、表结构、API 形态）。

## Consequences

正向：

- 这一决策直接带来的好处（最好引用具体版本/PR/文件位置佐证）

负向：

- 这一决策已知的代价、坑、需要后续注意的点

## Alternatives Considered（详）

**方案 B**：为什么没选。具体到哪一条限制不可接受。

**方案 C**：同上。

> 区别于 *Context* 中的对比表：这里写**论证过程**，对比表只是要点。

## Notes

- 实现代码位置：`apps/api/...`、`apps/web/...`
- 相关 alembic / 迁移：`xxxx_*.py`
- 相关 ROADMAP / ADR：ADR-XXXX、ROADMAP §X
- 后续可能演进 / 触发条件 / 已知 TODO

---

## 写作约定

- **文件名**：`NNNN-short-kebab-title.md`，编号单调递增、不复用、不删除。
- **状态变更**：被推翻时新建一份 ADR，把旧的状态改为 `Superseded by ADR-XXXX`，但**保留旧文档**。
- **章节可裁剪**：*Alternatives Considered* / *Notes* 没有内容时可省略；*Context / Decision / Consequences* 必填。
- **引用代码**：用 `path/to/file.py:NN` 而非纯文字描述，便于跳转。
- **回填 ADR**：Date 写"回填日期（实际决策发生于 vX.Y.Z 阶段）"。
