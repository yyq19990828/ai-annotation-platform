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

见 `0001-record-architecture-decisions.md`。
