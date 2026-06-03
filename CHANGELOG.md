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

## [0.12.6] - 2026-06-03

> **成员绩效项目级范围(A3)+ reject/类别维度下钻。** `/admin/people` 与详情端点支持按项目切分聚合,并对 **project_admin 放行**(强制其管理的项目范围);super_admin 仍可全局或任意项目。补 A2 顺延的 reject/类别下钻:`GET /tasks` 新增 `reject_reason_type`/`class_name` 过滤,详情抽屉在项目模式下点 reject 原因 / 类别行内联展开该项目内本人匹配任务。计划见 `docs/plans/2026-06-03-v0.12.6-project-scope-drilldown.md`。

### Added

- **成员绩效项目级范围**:`GET /dashboard/admin/people` 与 `GET /dashboard/admin/people/{user_id}` 新增/启用 `project` 参数,给**每个产能/质量/活跃/耗时/归因聚合**加项目过滤(此前 `project` 仅过滤"返回哪些用户",聚合仍是跨项目全局数字 → 误导)。新增共享助手 `_resolve_people_scope` 统一解析范围 + RBAC。导出端点同步放行。
- **RBAC 放行 project_admin**:两端点角色门由 super_admin 扩到 `super_admin + project_admin`;project_admin **必须指定** 其 owner 的项目(`assert_project_visible`,越权项目 404 隐藏存在性,缺省 project → 403),super_admin 不变。前端 `permissions` 给 project_admin 加 `admin-people` 页面权限 + Sidebar 入口放开(由 `canAccessPage` 过滤);`AdminPeoplePage` 新增项目下拉(super_admin 含「全部项目」,project_admin 锁自有项目并自动选第一个)。
- **reject/类别维度下钻**:`GET /tasks` 新增 `reject_reason_type`(Task 列)与 `class_name`(annotation EXISTS 子查询)过滤;成员详情抽屉在**项目模式**下点 reject 原因 / 类别行,内联展开该项目内本人匹配任务列表(只读,display_id + 状态)。全局模式下不下钻(tasks 查询需 project_id)。

### Notes

- **timeline(审计活动流)不按项目切分**:其无可靠 project 维度,保持全局。`project_count`(成员所属项目数)同理保持全局。
- 聚合级对账测试(全局 vs 项目级数字)保证改造正确性:见 `tests/test_dashboard_people_project_scope.py`。

## [0.12.5] - 2026-06-03

> **成员绩效 CSV 导出 + 项目维度下钻(A2)。** `/admin/people` 顶部新增「导出 CSV」(带当前筛选,Excel UTF-8 BOM 防中文乱码);成员详情抽屉「项目分布」每行可点 → 跳到该项目审核队列并按本人 assignee 过滤。落地时发现路线档原设想的「reject/类别下钻复用现有 tasks query」前提不成立(tasks 端点 `project_id` 必填、无 `reject_reason_type`/`class_name` 过滤,且绩效聚合跨项目),故本版只做**项目维度**下钻,reject/类别下钻并入 A3(v0.12.6,届时聚合做成项目级、落点天然顺)。计划见 `docs/plans/2026-06-03-v0.12.5-export-drilldown.md`。

### Added

- **成员绩效 CSV 导出**:`GET /dashboard/admin/people/export`(super_admin),复用 `admin_people_list` 聚合输出 CSV(13 列:user_id/name/email/role/status/project_count/main_metric 等),Excel UTF-8 BOM。前端 `dashboardApi.exportPeople` 带 Bearer 拉 blob 触发下载,`AdminPeoplePage` 头部「导出 CSV」按钮携带当前 role/period/sort/q 筛选。
- **项目维度下钻**:`AdminPeoplePage` 成员详情抽屉「项目分布」行改为可点,跳 `/review?project=<pid>&assignee=<uid>`;`ReviewPage` 新增读 `assignee` query param 注入任务列表过滤(复用后端已有 `assignee_id`)。

### Notes

- **reject/类别维度下钻**未做:需给工作台 tasks 查询新增 `reject_reason_type`/`class_name` 过滤(触碰 B-16 可见性 + cursor 分页)并解决跨项目落点,非快赢零风险 —— 延后并入 A3 项目级聚合改造(v0.12.6)。

## [0.12.4] - 2026-06-03

> **绩效页质量归因(A1)。** 给 `/me/performance`(标注员自助)与 `/admin/people` 成员详情抽屉补三个质量归因维度:**Reject 原因细分**(本人被驳回任务按漏标/多标/类别错/位置错分布)、**类别覆盖**(本人标注按 class_name 的 top-N 占比,检测偏科/盲区)、**首过率 first-pass yield**(一次通过无 reopen / 提交总数,比 reopen 率更标准的质量 KPI)。纯增量、数据现成。对标调研见 `docs/research/15-annotator-performance.md`,路线见 `docs/plans/2026-06-03-annotator-performance-deepening.md`。

### Added

- **质量归因三维**:`GET /dashboard/me/performance` 与 `GET /dashboard/admin/people/{user_id}` 响应新增 `reject_reason_breakdown` / `class_distribution` / `first_pass_yield` 三字段(追加,向后兼容)。后端三个共享 helper:`_reject_reason_breakdown`(按 `Task.reject_reason_type` 分组)、`_class_distribution`(按 `Annotation.class_name` top-N)、`_first_pass_yield`(`reopened_count==0` 占提交比,无样本→null)。
- **前端**:`MyPerformancePage` 新增「首过率」KPI + 「Reject 原因分布」+「类别覆盖」(recharts 横向柱图);`AdminPeoplePage` 详情抽屉新增同三块(复用现有 distribution 行样式 + 首过率 KPI)。

## [0.12.3] - 2026-06-03

> **标注员自助绩效页 + 绩效/分析导航补全。** 取经合集 §4.1「Annotator Performance Dashboard」的真实缺口收口：super_admin 的成员绩效页 `/admin/people`（v0.8.4 已含今日/本周/本月、产能/质量排序、人均卡片 + 下钻趋势/直方图）此前只能从 Dashboard 卡片或直达 URL 进入，本版补 Sidebar 入口；DuckDB 离线分析页 `/admin/analytics` 同为导航孤儿，一并接入。新增**所有角色可见的 `/me/performance` 自助页**，标注员看自己 4 周产出趋势对标团队均线 + 耗时直方图，用 recharts 渲染。计划见 `docs/plans/2026-06-03-v0.12.3-annotator-performance-dashboard.md`。

### Added

- **`/me/performance` 标注员自助绩效页**：新增 `GET /dashboard/me/performance?period=`（任意已认证用户，强制 self，不接受他人 user_id），返回本人 4 周产出趋势 `trend_throughput` + 团队 annotator 群体每周均线 `team_trend_throughput` + 质量趋势 + 耗时直方图（10 桶）+ p50/p95 + 周环比。前端 `MyPerformancePage` 用 recharts LineChart（我 vs 团队均线）+ BarChart（耗时分布）+ hero KPI 卡渲染。所有角色 Sidebar 新增「我的绩效」入口（pageKey `my-performance`）。
- **绩效 / 分析导航补全**：super_admin Sidebar「管理」区新增「标注员绩效」（`/admin/people`）与「离线分析」（`/admin/analytics`）两个入口——此前二者均为导航孤儿（路由存在但 Sidebar 无链接）。

### Notes

- **依赖**：前端新增 `recharts`（图表库）。
- **project_admin 项目级绩效**暂未放开：`/admin/people` 的吞吐/质量聚合当前不按项目维度切分，直接放行会让 project_admin 看到跨项目全局数字（误导）。正确做法需为每个聚合加项目过滤，留后续版本独立做（详见 plan §范围修订）。

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
