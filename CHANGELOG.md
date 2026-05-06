# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |

---

## 最新版本

## [0.8.4] - 2026-05-06

> **效率看板 / 人员绩效 epic。** 一次性把 ROADMAP P1「Layer 1 数据沉淀 + Layer 2 个人 dashboard 强化 + Layer 3 管理员人员看板」三层落地：标注员/审核员能自查产能/质量/投入；管理员有 `/admin/people` 卡片网格 + 抽屉下钻看全员效率。

> **数据沉淀**：`Task.assigned_at` 写入点全量改派（`_cascade_task_assignee` / `task.submit` 兜底 / 用户注销改派）；新表 `task_events`（工作台 `useSessionStats` 每 20 条 flush）；物化视图 `mv_user_perf_daily` 每小时 refresh。

> **显式不做**（依赖另一 session）：心跳 `User.last_seen_at` + `POST /me/heartbeat` + Celery beat offline 扫描。「今日活跃时长」「连续标注天数」「专注时段直方图」三项指标本期 graceful degrade 显示 `—`。

### 新增

- **迁移 0038-0041**（4 个）：
  - `0038_task_assigned_at`：`tasks.assigned_at TIMESTAMPTZ` + 部分索引 `(assignee_id, assigned_at DESC) WHERE assigned_at IS NOT NULL`。idempotent（`ADD COLUMN IF NOT EXISTS`）。
  - `0039_task_events`：新表 `task_events(id PK, task_id, user_id, project_id, kind ENUM(annotate|review), started_at, ended_at, duration_ms, annotation_count, was_rejected)` + 三个时序索引 + CHECK 约束。
  - `0040_mv_user_perf_daily`：物化视图 `(user_id, project_id, kind, day) → throughput / median_duration_ms / p95_duration_ms / rejected_n / active_minutes`，UNIQUE 索引支持 CONCURRENTLY refresh。
  - `0041_user_weekly_target`：`users.weekly_target_default` + `project_members.weekly_target`，替换 AnnotatorDashboard.tsx `weeklyTarget = 200` 硬编码。
- **后端端点**（4 个）：
  - `POST /auth/me/task-events:batch`：单批 ≤ 200 条，user_id 强制覆盖为登录用户（防伪造）；走 Celery 异步队列 `app.workers.task_events.persist_task_events_batch`，broker 不可用 → sync fallback。
  - `GET /dashboard/admin/people?role=&period=&sort=&q=`：super_admin only，返回每人 `{main_metric, throughput_score, quality_score, activity_score, sparkline_7d, alerts}`，告警 chip：被退回率 > 15% / 周环比降 > 30%。
  - `GET /dashboard/admin/people/{user_id}?period=4w`：详情 — 4 周趋势 / 项目分布 / 耗时直方图（10 桶 + p50/p95）/ 最近 50 条 timeline。
  - `GET /dashboard/annotator` / `/reviewer` 扩展：annotator 增加 `median_duration_ms / rejected_rate / reopened_avg / weekly_compare_pct / weekly_target`；reviewer 增加 `median_review_duration_ms / reopen_after_approve_rate / weekly_compare_pct / daily_review_counts`。
- **Celery beat hourly refresh**：`refresh_user_perf_mv` crontab `minute=5`，`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_perf_daily`；端点优先读视图，当日窗口直查 task_events 兜底。
- **前端原子组件**：`<SectionDivider>` / `<RadialProgress>` / `<Histogram>`（仿 RegistrationSourceCard SVG bar 风格，不引图表库）。
- **AnnotatorDashboard 5 卡 → 9 卡三段**：产能（待标 / 今日 / 本周 + 周环比 + sparkline / 单题中位耗时）+ 质量（原创比例 / 退回率 / 重审次数 avg）+ 投入（活跃时长 / streak / 累计），心跳依赖项暂显 `—`。
- **ReviewerDashboard 5 卡 → 6 卡两段**：产能（待审 / 今日 + 周环比 + sparkline / 平均审核耗时 / 累计）+ 质量（24h 通过率 / 历史通过率 / 二次返修率）。
- **AdminPeoplePage（`/admin/people`）**：sticky 筛选栏（角色 / 时间 / 排序 / 搜索 → URL search params 同步）+ 响应式卡片网格（auto-fill minmax 280px）+ 右侧抽屉个人详情（4 hero KPI + 4 周趋势双 sparkline + 耗时直方图 + 项目分布 + timeline）。super_admin RBAC 双重门（路由 + endpoint）。
- **AdminDashboard 入口卡**：顶部 4 总量 StatCard 下方加「成员绩效 →」可点击 Card，跳 `/admin/people`。
- **工作台埋点**：`useSessionStats(currentTaskId, projectId, kind)` 现支持 `pendingEvents` 缓冲，每 20 条或 unmount/pagehide 时 flush 到 `meApi.submitTaskEvents`。失败静默丢弃避免雪崩。
- **ADR-0009**：`docs/adr/0009-task-events-table-and-partition.md` 记录 task_events 月分区两阶段方案：Stage 1（本期）普通表 + 时序索引；Stage 2（行数 > 1M 或单月 INSERT > 100k 触发）按 `started_at` RANGE 分区，参考 ADR-0006 / ADR-0008 模式。
- **测试**：`tests/test_task_events_batch.py`（6 例）覆盖 sync fallback INSERT 落库、`ended_at < started_at` 422、`/admin/people` 403 / 200 / 404 / detail 200。

### 变更

- **alembic env.py**：`config.set_main_option("sqlalchemy.url", ...)` 改为只在调用方未注入 URL 时设置，否则 conftest 注入的 test DB URL 会被覆盖到 dev DB。
- **`app/services/batch.py:_cascade_task_assignee`**：`user_id` 非空时 `assigned_at = func.now()`，否则置 NULL。
- **`app/api/v1/tasks.py:548`** / **`app/api/v1/users.py:587`**：兜底分派 / 注销改派路径同步写 `assigned_at`。
- **`app/api/v1/dashboard.py`**：annotator/reviewer 端点新增字段（详见上文）。
- **OpenAPI snapshot 同步**：新增 7 个 schema（AdminPeopleList / AdminPersonItem / AdminPersonDetail / TaskEventIn / TaskEventBatchIn / TaskEventBatchOut + reviewer/annotator 字段）。

### 推迟（依赖另一 session）

- **心跳机制**：`User.last_seen_at` + `POST /me/heartbeat` + Celery beat 扫描。L2/L3 中「今日活跃时长 / streak / 专注时段直方图 / activity_score」graceful degrade，等心跳合并后无需改前端，仅后端 endpoint 切真实计算。
- **L3 leaderboard Tab**：`GET /dashboard/admin/people/leaderboard` 端点占位未实现，UI 也未暴露。

---

## [0.8.2] - 2026-05-06

> **文档深度优化。** 把 v0.8.0 / v0.8.1 留下的四处文档机制缝隙以**自动化**方式补齐：ADR 不再孤悬 GitHub、`pnpm docs:build` 进 PR gate、how-to 与源码漂移即报错、ML Backend 协议有可跑样板。后续文档随代码自然漂移即被 CI 拦下，免人工巡检。

### 新增

- **`pnpm docs:build` 进 CI gate**：`.github/workflows/ci.yml` 新增 `docs-build` job，所有 PR 都跑（不带 `paths` 过滤），约 5s 成本；dead-link / hotkeys SoT 漂移 / snippet 不一致即时阻断。原 `docs.yml` 保留为 GitHub Pages 发布触发，无重复构建影响。
- **`docs-site/scripts/check-doc-snippets.mjs`** + snippet 标记机制：扫 `.md` 中的 `<!-- snippet:PATH:START-END -->` ... `<!-- /snippet -->` 块，逐行比对源文件区间与代码块内容，不一致即打印 diff 并 exit 1。`docs-site/package.json` 的 `prebuild` 链中追加；`pnpm check:snippets` 顶层别名可直接调用。
- **`add-api-endpoint.md` 加 snippet 标记**：logout 代码块绑定 `apps/api/app/api/v1/auth.py:239-266`；同时把 v0.8.0 写入时**已漂移**的内容（漏 `current_user.status = "offline"`、AuditService.log 压缩单行）对齐到当前真实源码。后续 logout 函数任一字符变化 prebuild 即报。
- **`docs-site/scripts/mirror-adr.mjs`** + ADR 接入 sidebar：把 `docs/adr/*.md` 镜像到 `docs-site/dev/adr/` 让 VitePress 渲染，文件头注入"自动镜像"警告条；同时输出 `sidebar.generated.json`。`docs-site/.vitepress/config.ts` 顶部读取该 JSON，在 `/dev/` 侧边栏底部新增「ADR（架构决策）」可折叠组（默认 collapsed）。`.gitignore` 排除 `docs-site/dev/adr/`，避免 mirror 产物入库。
- **`docs-site/dev/examples/echo-ml-backend/`** 可执行样板（5 文件）：`main.py`（协议 §1-3 四端点完整 FastAPI 实现）+ `requirements.txt` + `Dockerfile`（python:3.11-slim + uvicorn）+ `test.sh`（curl 三连击 health/setup/predict）+ `README.md`（uvicorn / docker 两种启动方式 + 接入平台步骤）。`ml-backend-protocol.md §8` 改为 `<!-- snippet -->` 引用 `main.py:1-63`，inline 示例与样板永远同步。
- **ADR-0008（Proposed）批次 admin-locked 字段**：`docs/adr/0008-batch-admin-locked-status.md` 把 ROADMAP A §批次状态机二阶段「`annotating → active` 暂停」难点（scheduler 死锁）文字化。决定引入正交 `admin_locked: bool` 字段（独立于 7 态枚举），check_auto_transitions 起始处短路返回；包含表迁移 SQL、API 端点设计（lock/unlock）、状态机 mermaid 图、3 种被拒绝方案（PAUSED 枚举 / task 级锁 / 借 ARCHIVED）的取舍理由。**仅设计**，实现推迟到 v0.9 评估窗口。

### 变更

- **`docs-site/package.json` prebuild 链**：从 `sync-openapi && generate-hotkeys` 扩为 `sync-openapi && mirror-adr && generate-hotkeys && check-doc-snippets`；新增 `check:snippets` / `mirror:adr` 顶层 script。
- **`.vitepress/config.ts`**：`/dev/` 侧边栏底部新增 `ADR（架构决策）` 折叠组，items 由 mirror-adr 输出的 sidebar.generated.json 注入；缺文件时降级为空数组让 VitePress 仍可启动。

### 推迟（明确不在本期）

- **截图自动化（Playwright + IMAGE_CHECKLIST 16 处）**：与 E2E spec 写实共建 fixture，1-2 天深活，本期窗口不足
- **getting-started 3 张 GIF 录屏**：等截图自动化方案落地后批量产出
- **fabric.js dead dep 清理**：非文档主题，留给下次依赖清理 PR

---

## [0.8.1] - 2026-05-06

> **治理 / 合规向收口 epic。** 一次性把 ROADMAP 中「系统设置可编辑、注册统计、自助注销、管理员重置密码、审计分区归档、数据导出审计」6 项硬残缺收齐。

### 新增

- **系统设置 DB 化（PR 1）**：新表 `system_settings`（迁移 0034）+ `SystemSettingsService`（30s LRU）+ `PATCH /settings/system`（super_admin only）。白名单字段 `allow_open_registration / invitation_ttl_days / frontend_base_url / smtp_*`；黑名单字段（`SECRET_KEY / DATABASE_URL / ENVIRONMENT` 等）永不可在 UI 编辑。`smtp_password` 在 GET 响应掩码（`password_set: bool`），audit_log detail 仅记录 `{changed: True}` 不含明文。
- **SMTP 测试发送**：`POST /settings/system/test-smtp`（`3/min` 限流），用 `stdlib smtplib` 即时给当前管理员发一封测试邮件，无新依赖。
- **SettingsPage 系统设置区改可编辑**：受控表单 + 「立即生效 / 需新会话生效」标注 + SMTP 密码独立「设置 / 更换」按钮 + 「发送测试邮件到我」按钮。
- **注册统计仪表卡（PR 2A）**：`/dashboard/admin` 响应增加 `registration_by_day`（30 天，邀请 vs 开放注册分别聚合 `audit_logs.detail_json.method/invitation_id`）。AdminDashboard 新增「30 天注册来源」双柱条形图（沿用现有 `<StatusBar>` 风格，不引入图表库）。
- **管理员重置低等级用户密码（PR 2B）**：`POST /users/{id}/admin-reset-password`（super_admin / project_admin，`3/min` 限流，角色等级校验 + project_admin 项目内限制）。生成 16 字符强临时密码（大小写 + 数字 + 符号），audit_log detail **不记录密码本身**。User 模型新增 `password_admin_reset_at`（迁移 0035），用户首次登录后自助 `change_password` 成功时清空。UsersPage 新增「重置密码」按钮 + 二次确认 + 临时密码展示 Modal（带复制按钮）。
- **账号自助注销冷静期（PR 3）**：`POST/DELETE /auth/me/deactivation-request`（迁移 0036 加 `deactivation_requested_at / reason / scheduled_at`）。提交时通知所有 super_admin，给 7 天处理窗口（如转交任务）；冷静期内可撤销。Celery beat `process_deactivation_requests`（每日 04:00 UTC）扫描到期用户，复用 GDPR 软删路径（`is_active=False` + `audit_logs` 脱敏）。SettingsPage `<DangerZoneCard>`：未申请态「申请注销」/ 已申请态「已于 X 申请，将于 Y 自动生效 + 撤销」。
- **audit_logs 月分区表（PR 4，迁移 0037）**：`PARTITION BY RANGE (created_at)`，PK 改为 `(id, created_at)`。复用 v0.7.8 不可变 trigger，挂在分区父表上（PG13+ 自动级联到所有子分区）。覆盖 `[min(legacy.created_at), now+3m]` 子分区，原数据零丢失迁移。原 7 个索引（含 GIN on detail_json）按相同名重建为分区局部索引。详见 ADR-0007（已从「延期」更新为「已实施」+ 实施记录）。
- **审计冷数据归档（PR 4）**：Celery beat `ensure_future_audit_partitions`（每月 25 日提前建未来 3 月分区）+ `archive_old_audit_partitions`（每月 2 日把 > `AUDIT_RETENTION_MONTHS` 的子分区 stream-gzip 上传 MinIO `audit-archive/{YYYY}/{MM}.jsonl.gz`，成功后 `DROP TABLE`）。新 audit action `audit.archive`，detail 含分区名 + 行数 + S3 key。
- **数据导出审计强化（PR 4）**：4 个导出端点（projects / batches / audit-logs / users）的 `AuditService.log` 调用统一走新 helper `export_detail()`，detail_json 增 `actor_email / ip / request_id / filter_criteria`。CSV 文件首部插入 `# Exported by / Exported at / Request ID` 注释行；JSON 文件包装 `_export_meta` 顶层字段（pandas/Excel `comment='#'` 自动跳过）。
- **`AUDIT_RETENTION_MONTHS` env**：`.env.example` 新增，默认 12 个月。

### 变更

- 邀请流程（`InvitationService.create / resend` + 用户/邀请管理路由）改读 `SystemSettingsService.get(...)`，env 仅作启动 fallback。
- `/auth/forgot-password` 重置链接生成同样改走 `SystemSettingsService`，便于同 PATCH 即时切换前端域名。
- `tests/conftest.py` `db_session` fixture 在 teardown 时清 `SystemSettingsService` 模块级缓存，防跨测试 PATCH 值泄漏。
- `tests/test_alembic_drift.py` 豁免 `audit_logs_y*` 分区子表（不在 ORM metadata 中）。

---

## [0.8.0] - 2026-05-06

> **文档细化与补全。** v0.7.x 收口的特性都齐了，本期把文档站从「骨架完整、内容大纲为主」推进到「可作为新人 onboarding 与运维交付物」。

### 新增

- **`docs-site/dev/deploy.md`**（部署指南）：拓扑图、必填/推荐 env 一览、nginx 反代示例（含 WS 长连接 + `proxy_read_timeout`）、首次 `bootstrap_admin` 步骤、备份恢复（pg_dump + MinIO sync + Redis 不需备份说明）、升级 runbook、健康检查端点表、常见 production 启动错误。
- **`docs-site/dev/security.md`**（安全模型）：威胁模型表 + 缓解一览、5 级 RBAC + 全局能力矩阵、JWT 生命周期 + `jti`/`gen` 黑名单时序图、邀请流程 mermaid、审计日志字段释义 + 不可变 trigger 说明、CORS 收紧维度对比。
- **`docs-site/dev/ml-backend-protocol.md`**（ML Backend 协议契约）：4 个端点 schema（`/health` / `/predict` 同步+交互式 / `/setup` / `/versions`）、鉴权约定、`is_interactive` 语义、错误格式、`prediction_metas` token/cost 透传字段表、50 行 FastAPI echo backend 最小可跑示例。
- **`docs-site/dev/ws-protocol.md`**（WebSocket 协议）：两个频道（`/ws/notifications` JWT query + `/ws/projects/{pid}/preannotate` cookie）、消息格式（NotificationOut + ping 心跳 + 进度 payload）、断线兜底、前端指数退避策略、Redis ConnectionPool 上限、扩展新频道的 4 步 how-to。
- **ADR 0002-0005 回填**：
  - `0002-backend-stack-fastapi-sqlalchemy-alembic.md` — FastAPI + SQLAlchemy 2.0 async + Alembic 选型，对比 DRF / Tortoise / Node Prisma
  - `0003-openapi-client-codegen.md` — `@hey-api/openapi-ts` 选型，对比 orval / swagger-typescript-api / openapi-generator-cli
  - `0004-canvas-stack-konva.md` — Konva 4 Layer（v0.6.4 起 5 Layer）选型，对比 Fabric.js / 原生 Canvas / PixiJS / SVG；含 `package.json` 仍含 dead `fabric` 依赖的备注
  - `0005-task-lock-and-review-matrix.md` — 5min TTL + 60s 心跳 + 接管阈值 TTL/2 的取值理由 + 5 状态机 + 角色权限矩阵
- **`docs-site/scripts/generate-hotkeys.mjs`**：从 `apps/web/src/pages/Workbench/state/hotkeys.ts` regex 解析 `HOTKEYS` + `GROUP_LABEL`，生成 `docs-site/user-guide/workbench/hotkeys.generated.md`；`predev` / `prebuild` 自动跑，新增 `pnpm docs:hotkeys` 顶层别名。
- **`docs-site/user-guide/IMAGE_CHECKLIST.md`**：截图回填清单 + 拍摄约定（分辨率、脱敏、红框规范）；汇总 16 处 `<!-- TODO(0.8.1) -->` 占位。

### 改进

- **`docs-site/dev/architecture/data-flow.md`**：4 个 mermaid 序列图全部加上代码路径标注（`apps/api/...:行号`），读者可点 GitHub 跳具体函数；新增「实时通知」详细序列图（含 30s 心跳）。
- **`docs-site/dev/how-to/add-api-endpoint.md`**：从 widgets 占位例改成 v0.7.8 真实落地的 `POST /auth/logout` 全链路（路由 + token_blacklist service + 测试覆盖正常路径/错误路径/副作用断言 + snapshot + 前端 wrapper + PR checklist）。
- **`docs-site/user-guide/workbench/index.md`**：删除手抄快捷键表（与代码漂移：W/R/Ctrl+Enter 都不存在），改为 `<!--@include: ./hotkeys.generated.md-->`，与 `hotkeys.ts` 38 条 SoT 对齐。
- **`docs-site/user-guide/getting-started.md`**：基础快捷键 6 项与代码 SoT 对齐（B/P/V/Space+drag/Ctrl+Z/E）；加 3 处截图占位（登录、忘记密码、端到端 GIF）。
- **bbox / polygon / keypoint / projects / review / export 页**：合计 13 处截图占位，均含拍摄要求注释，配合 IMAGE_CHECKLIST 回填。

### 配置

- **`docs-site/.vitepress/config.ts`**：`/dev/` 侧边栏新增「部署与协议」分组（4 项），位于「架构」与「How-to」之间。
- **`docs-site/package.json`**：`predev` / `prebuild` 改为 `sync-openapi && generate-hotkeys`；新增 `hotkeys` 脚本。
- **`package.json`**：新增 `pnpm docs:hotkeys` 顶层别名。

### 占位（不阻断发布）

- 16 处用户手册截图（`docs-site/user-guide/images/<page>/*.png|gif`）目前为 1×1 透明 PNG，build 通过；真实图按 IMAGE_CHECKLIST 在 0.8.1 回填。
