# 大数据集规模化加固路线图（万级 → 十万级）

> 编写时间：2026-06-02 / 当前 v0.11.29
> 上游调研：[docs/research/12-large-dataset-batching.md](../research/12-large-dataset-batching.md)（v0.5.3，关于「分包是否性能方案」的论证）
> 统揽三个版本计划：[v0.11.30](./2026-06-02-v0.11.30-scale-query-foundation.md) · [v0.12.0](./2026-06-02-v0.12.0-async-task-creation.md) · [v0.12.1](./2026-06-02-v0.12.1-streaming-export.md)

---

## 0. 一句话结论

v0.5.3 调研里担心的事大部分已解决（task_batch 表落地、bulk insert、虚拟滚动 + cursor 分页、batch 计数物化）。**现在的问题不是「要不要分包」，而是十万级 task 下还剩 6 个真瓶颈。** 它们全是分页 / 索引 / 异步 / 流式的标准工程问题——和旧调研的核心论点一致：**分包模型本身已够用甚至帮忙，不需要为性能再改它。**

---

## 1. 现状：旧调研担忧的消解情况

| 旧调研的伤口 | 现在 | 证据 |
|---|---|---|
| `link_project` 循环 `db.add`，1 万行卡死 | 已改单次 `insert(Task), rows`（1000 行 <200ms） | `services/dataset.py:569-592` |
| 工作台 1 万 task 全量拉、列表卡死 | 虚拟滚动 + cursor 分页，每页 100 | `TaskQueuePanel.tsx:201`、`useTasks.ts:7` |
| 没有批次概念 | 完整 `task_batches` 表 + 状态机 + split + 物化计数 | `models/task_batch.py`、`services/batch.py` |
| Progress 实时扫全表 | batch 计数物化 + `projects.batch_summary` 物化列 | migration 0079 |

---

## 2. 当前真正剩下的 6 个瓶颈（按严重度）

| # | 瓶颈 | 位置 | 严重度 | 归属版本 |
|---|---|---|---|---|
| B1 | `get_next_task` 的 `NOT IN (已标注子查询)` + uncertainty 采样 `outerjoin Prediction` 全集排序取 1 | `services/scheduler.py:100-149` | 🔴 高（最热路径） | v0.11.30 |
| B2 | `list_tasks` 每翻一页都全表 `COUNT(*)`；非特权用户还 JOIN TaskBatch | `api/v1/tasks.py:188-227` | 🟠 中 | v0.11.30 |
| B3 | Task 表缺复合索引，`created_at` 无索引（B1/B2 的共同地基） | `models/task.py:19-97` | 🟡 中 | v0.11.30 |
| B4 | `link_project` / `create_tasks_for_items` 同步 HTTP 内单事务建 task，十万级超时 + 长事务锁 | `services/dataset.py:536-691` | 🟠 中高 | v0.12.0 |
| B5 | 「未归类任务池」（batch_id=NULL）不可被 scheduler 派发，大 dataset 导入后必须先 split；未归类池本身缺大表浏览 | `services/scheduler.py:108`（INNER JOIN TaskBatch） | 🟡 中（UX 悬崖） | v0.12.0 |
| B6 | 导出全量加载进内存 + 单 `BytesIO` + 逐张预签名 URL，十万 task ≈ 500MB+ 内存 + 十万次 S3 调用 | `services/export.py`、`export_packaging.py` | 🟠 中高 | v0.12.1 |

> **关于分包（B5）的特别说明**：v0.7.3 后新关联 dataset 的 task 直接 `batch_id=NULL`，而 `get_next_task` 是 `INNER JOIN TaskBatch` + `status in (active, annotating)`（`scheduler.py:108-113`）。这意味着**未分包的 task 永远不会被派发**——导入一个十万级 dataset 后必须先 split 成 batch 工作流才流动。这是设计选择（强制切批 = 天然分页），但在大数据集下是个 UX 悬崖，且未归类池本身的浏览 / split 在大表上未做规模化。

---

## 3. 版本切分与排期纪律

**纪律：沿用旧调研「等触发条件再做大工程」的原则，不为还没有的规模铺架构。**

| 版本 | 主题 | 风险 | 是否现在做 | 触发条件 |
|---|---|---|---|---|
| **v0.11.30** | 大表查询地基（B1/B2/B3） | 低（纯后端、无 UI、索引可 CONCURRENTLY） | ✅ **立刻做** | 无——便宜且无害，且是其它两版的前置 |
| **v0.12.0** | 建任务异步化 + 未归类池规模化（B4/B5） | 中（Celery 任务 + 前端进度 + 行为变化） | ✅ **已实现**（提前于触发条件） | 单次 link 的 dataset > ~3 万 items，或真实用户反馈导入卡顿/超时 |
| **v0.12.1** | 导出流式化（B6） | 中（导出链路重写） | ✅ **已实现**（提前于触发条件） | 单 project/batch 导出 task > ~3 万，或 worker OOM / 导出超时实际发生 |

**为什么 v0.11.30 先行**：复合索引（B3）是 B1、B2、B4 查询的共同地基；scheduler / list_tasks 的 SQL 重写不依赖任何前端或行为变化，可独立上线、独立回滚，且对现存中等规模项目也立即有正收益（无副作用）。

---

## 4. 验收的统一标尺

每个版本计划里都用同一套「规模化基准」验证，避免「感觉变快了」式验收：

1. **种子数据**：脚本生成 1 个 project / 1 dataset / 10 万 DatasetItem + 10 万 task，分布在 ~50 个 batch；标注员 A 已标 2 万条（撑大 B1 的「已标注集合」）。
2. **EXPLAIN ANALYZE**：B1/B2/B3 改动前后各跑一次，记录 plan（Seq Scan → Index Scan）+ 实测耗时，贴进对应计划的「验证」节。
3. **端到端计时**：`GET /tasks/next`、`GET /tasks?project_id=...`（首页 + 第 50 页）、`link_project`、导出 ZIP——四条路径的 p50/p95。

> 种子脚本本身放 `apps/api/scripts/seed_scale.py`（v0.11.30 一并产出，后两版复用）。

---

## 5. 明确不做（避免范围蔓延）

- **不**重构分包数据模型（task_batch 已够用，B5 只补「未归类池规模化」与 split 大表性能，不动 schema 语义）。
- **不**引入读副本 / 分库分表 / ClickHouse 等重型基建——十万级单库 + 索引足矣，百万级再议（届时另开 ADR）。
- **不**做主动学习闭环 / workflow stage（旧调研「方案 C」，与性能无关，属产品差异化，单独立项）。
- **不**把 B1~B6 打包进一个大版本一次上线——按上表分三版，各自可独立回滚。
