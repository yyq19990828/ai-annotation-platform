# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## 最新版本

<!-- 0.12.x 版本变更按版本段追加到本区；开始开发 0.13 后整体移到 docs/changelogs/0.12.x.md -->

## [0.12.0] - 2026-06-02

大数据集规模化加固第二版（B4/B5），承接 v0.11.30 的查询地基，把「关联数据集 → 建任务」搬入异步、并补未归类任务池在大表下的浏览与分包规模化。配套路线图见 `docs/plans/2026-06-02-large-dataset-scale-hardening-roadmap.md`。

### Added

- **建任务异步化（B4）**：关联数据集时，超过 `TASK_CREATE_SYNC_THRESHOLD`（默认 2000 items）的大数据集不再在同步 HTTP 单事务里一次性建 task，而是建立 link 后入队 Celery worker（`app.workers.create_tasks`）分块（每块 5000）建任务并回写 `async_jobs` 进度；小数据集仍走同步快路径保持即时体验。worker 以 `(project_id, dataset_item_id)` 去重，支持断点重跑不双建。
- **关联进度可见**：数据集关联返回 `async_job_id`，前端在数据集关联 / 建项目向导第 5 步轮询进度条，完成后提示已建任务数。
- **未归类任务池浏览**：`GET /tasks?unbatched=true` 走 cursor 分页 + 虚拟滚动列出 `batch_id IS NULL` 的未归类任务；BatchesSection 横带新增「浏览未归类」入口。
- **一键全量建包**：未归类横带新增按钮，一键把全部未归类任务注入单个批次（split `n_batches=1`），消除大数据集导入后「工作台仍空、必须先手动切批」的 UX 悬崖。
- 迁移 `0091`：部分索引 `ix_tasks_project_unbatched ON tasks (project_id, created_at, id) WHERE batch_id IS NULL`，撑未归类池分页（实测 Index Scan，无额外 Sort）。

### Changed

- **split 大表分块 UPDATE（B5）**：`BatchService._assign_tasks` 回写 `batch_id` 改为每块 5000 个 id 一条 UPDATE，避免十万级单条 `IN` 巨 UPDATE 的长事务。
- `create_tasks_for_items`（upload/zip/scan 追加路径）内部改分块 INSERT，调用方语义不变。
- `DatasetService.link_project` 返回 `LinkProjectResult(link, async_job_id, created_tasks)`，供 endpoint 在 commit 后再 enqueue。

### Config

- 新增 `TASK_CREATE_SYNC_THRESHOLD`（默认 2000）：数据集 item 数 ≤ 阈值走同步建 task，> 阈值走 Celery 异步。
