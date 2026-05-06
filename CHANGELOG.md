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
