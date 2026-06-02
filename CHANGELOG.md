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

## [0.12.2] - 2026-06-02

> **开放注册邮箱验证。** 开放注册新增邮箱验证环节：验证开关按环境派生（production 默认开、dev/staging 默认关，可用 `REQUIRE_EMAIL_VERIFICATION` 显式覆盖）。开关打开时注册后须点邮件链接验证才能登录；邀请注册与管理员建号恒视为已验证。复用既有 SMTP 底座与 password-reset token 范式，未引入新依赖。

### Added

- **邮箱验证流程**: `User.email_verified_at` 字段 + `email_verification_tokens` 表（24 小时一次性 token，迁移 `0092`）；新增 `POST /auth/verify-email`（消费 token）与 `POST /auth/send-verification-email`（重发，防枚举恒 202）。`register-open` 在验证开关打开时不再自动登录，返回 `email_verification_required=true` 且 `access_token=null`，并发送验证邮件；`login` 对未验证账户返回 `400 {code: "email_not_verified"}` gate。→ [plan](docs/plans/2026-05-27-v0.12.0-email-verification.md)
- **前端验证 UI**: RegisterPage 注册后切到「验证邮件已发送」态（含重发按钮 + 60s 倒计时）；新增 `/verify-email` 落地页消费 token；LoginPage 识别 `email_not_verified` 后展示「重新发送验证邮件」入口。
- **环境派生配置**: 新增 `REQUIRE_EMAIL_VERIFICATION` env（留空按环境派生），经 `settings.email_verification_required` property 统一读取。存量用户迁移时回填 `email_verified_at = created_at`，避免上线即被锁。

## [0.12.1] - 2026-06-02

大数据集规模化加固第三版（B6）：把导出从「全量进内存 + 单 `BytesIO` 攒整包」改为「分块读 DB + 落盘式 ZIP + 流式上传」，使导出 worker 内存与 task 数解耦，消除十万级导出的 OOM 风险。对用户行为无变化（仍异步、仍下载链接），只是内部更省内存。计划见 `docs/plans/2026-06-02-v0.12.1-streaming-export.md`。

### Changed

- **导出 ZIP 落盘 + 流式上传（B6-2）**：`build_export_zip` / `_build_video_export_zip` 不再用 `io.BytesIO()` 把整包压缩 ZIP 攒在内存，改写 `tempfile` 落盘；worker 用 boto3 `upload_file` 多段流式上传（不把整文件读进 RAM），上传后清理临时文件。内存峰值与产物大小解耦。
- **导出 DB 读分块流式化（B6-1）**：新增 `ExportService.iter_export_chunks`，按 task 分块惰性产出 `(tasks, ann_by_task, dataset_items)`（先取轻量 task id 列表再分块水合，规避服务端游标占用连接的冲突），每块产出后 `expunge_all()` 释放 session 身份映射，避免分块加载的 ORM 行滞留内存。per-file 格式（YOLO 镜像、视频逐序列 MOT/KITTI/yolo-frames）的 ORM 对象内存与 task 数解耦。COCO/AAP JSON 是单文档格式，本质需全量物化（流式 JSON 编码不在本版范围），仍由 `ExportService` 自加载。
- **图像 manifest 流式写入**：`images_manifest.json` 改为边遍历边写 zip entry（`zf.open(...,"w")`，O(1) 内存），不再把十万条 manifest dict 攒进 RAM 再整体 `json.dumps`——这是「内存与 task 数解耦」的关键残留项。
- `build_export_zip` 返回签名由 `(bytes, file_count)` 改为 `(zip 路径, file_count, size_bytes)`；`storage_service` 新增 `upload_file` 从本地路径流式上传。
- 实测（10 万 task 项目，YOLO 全量导出）：旧 `_load_data` 仅加载即 ~426MB 峰值；新流式落盘端到端 ~134MB（剩余主要是 stdlib `zipfile` 十万条目的中央目录，小常数因子），产物 `testzip` 完好、manifest 合法。

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
