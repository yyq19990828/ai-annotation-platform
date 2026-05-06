# v0.8.1 — 系统设置可编辑 / 注册统计 / 自助注销 / 管理员改密 / 审计分区归档 / 导出审计

> 状态：**定稿**（用户已确认 3 项关键决策）
> 范围：从 ROADMAP.md 一次性收拢 6 项治理 / 安全 / 用户体验类残留。

---

## Context

v0.8.0 把开发文档分组、ADR 0002-0007、协议契约、SoT 自动化补齐，治理向硬占位（系统设置只读、注册统计空白、注销路径缺失、审计无归档、导出无审计水印）成为下一个最显眼的「残缺感」。本期一次性闭环 6 项，全部围绕**「管理员日常运维体感」+「合规可追溯」**两条主线。

**用户已确认决策**：
1. 审计归档采用 **按月分区表**（roadmap 标 P3，但用户偏好原生 SQL 可查老月份）→ 写 ADR-0008 + Alembic 数据迁移
2. 管理员改密采用 **临时密码**（不依赖邮件，单步操作，UX 直接）
3. SMTP 字段 **一并做可编辑** + 测试邮件按钮

工作量按调研评估约 35–38h，分 4 个 PR 提交。

---

## 调研锚点（路径 + 行号）

| 主题 | 关键文件 | 当前状态 |
|---|---|---|
| GET /settings/system | `apps/api/app/api/v1/system_settings.py:12-28` | 仅读 env，super_admin only |
| Pydantic schema | `apps/api/app/schemas/me.py:22-35` | `SystemSettingsOut` 已有 |
| SettingsPage 系统区 | `apps/web/src/pages/Settings/SettingsPage.tsx:205-264` | 全 read-only |
| 注册路由 | `apps/api/app/api/v1/auth.py:178-227` (open) / `invitations.py:35-69` (invite) | `detail_json.method` 已写 |
| AdminDashboard | `apps/web/src/pages/Dashboard/AdminDashboard.tsx:74-248` | 6 张卡片，**无图表库**，纯 HTML/CSS |
| User 模型 | `apps/api/app/db/models/user.py` | `is_active` 已有，无 `deactivation_*` 字段 |
| 软删除路径 | `apps/api/app/api/v1/users.py:374-530` (DELETE) | GDPR 脱敏完整，可复用 |
| PasswordResetService | `apps/api/app/services/password_reset.py:1-56` | 64-char hex token + 1h TTL |
| 角色枚举 | `apps/api/app/db/enums.py:4-9` | super_admin > project_admin > reviewer > annotator > viewer |
| audit_logs 模型 | `apps/api/app/db/models/audit_log.py:12-39` | 不可变 trigger 已落（v0.7.8），**未分区** |
| AuditMiddleware | `apps/api/app/middleware/audit.py:30-147` | Celery 异步 + sync fallback |
| AuditService.log | `apps/api/app/services/audit.py:14-66` | action 命名规范已定 |
| 4 个导出端点 | `projects.py:489-567` / `batches.py:650+` / `audit_logs.py:146-248` / `users.py:128-184` | 已有 audit，detail 仅 format+count |
| StorageService | `apps/api/app/services/storage.py:14-220` | MinIO/S3 + lifecycle 已就位 |
| Celery beat | `apps/api/app/workers/celery_app.py:1-43` | 现有 1 个任务（attachment purge） |
| Alembic | `alembic/versions/0032_audit_log_immutability.py` | 最新迁移 0032 |

---

## 实施计划（按 PR 分组）

### PR 1 — 系统设置可编辑 + 开放注册 toggle + SMTP 配置  ≈ 10h

**后端**
- 新表 `system_settings`：`key (PK str)` / `value_json (JSONB)` / `value_type (str)` / `updated_by (FK users.id)` / `updated_at`
- Alembic `0033_system_settings.py`：建表 + 种子初始值（从当前 env 镜像）
- 新模型 `apps/api/app/db/models/system_setting.py`
- 配置加载策略：启动时 env 优先；运行时 `SystemSettingsService.get(key)` 读 DB override，降级到 env；服务内置 30s LRU cache 减少 DB 压力
- 端点 `PATCH /settings/system`（super_admin only）：白名单字段 only，写 audit log（新 action `system.settings_update`），PATCH 后清 LRU cache
- 端点 `POST /settings/system/test-smtp`（super_admin only）：用当前 SMTP override 配置发一封测试邮件到 actor.email，3/min 限流；不写 DB，仅返回 success/error
- **白名单**（运行时热更新，本期范围）：
  - `allow_open_registration`（bool）
  - `invitation_ttl_days`（int, 1–90）
  - `frontend_base_url`（str）
  - `smtp_host` / `smtp_port` / `smtp_user` / `smtp_password` / `smtp_from`（str/int；password 字段 PATCH 时接受明文，DB 存对称加密 with `SECRET_KEY`，GET 时返回 `"***"` 掩码）
- **黑名单**（启动时配置，永不可在 UI 编辑）：`SECRET_KEY` / `DATABASE_URL` / `REDIS_URL` / `ENVIRONMENT` / `AUDIT_ASYNC` / MinIO 凭据等
- `auth.py:register_open` 改为读 `SystemSettingsService.get("allow_open_registration")`，env 仅作启动 fallback
- 邮件发送处（`app/services/email.py` 或 `notifications/email.py`）改读 `SystemSettingsService` SMTP override

**前端**
- `SettingsPage.tsx:205-264` SystemSection：read-only `<ReadOnly>` → 受控 `<Input>` / `<Switch>` / `<input type="password">`（SMTP 密码），加「保存」按钮
- 新 hook `useUpdateSystemSettings(patch)` → `PATCH /settings/system`，单次 PATCH 多字段
- 字段旁标注 🟢 立即生效 / 🟡 需新会话生效（如 frontend_base_url）
- SMTP 区块底部「发送测试邮件」按钮 → `POST /settings/system/test-smtp` → toast 成功/失败
- 保存成功后 invalidate `useSystemSettings` query

---

### PR 2 — 注册统计仪表卡 + 管理员改密  ≈ 5h

**A. 注册统计**
- 后端 `app/api/v1/dashboard.py`：`AdminDashboardStats` 增加 `registration_by_day: list[{date, open_count, invite_count}]`，过去 30 天聚合
  - SQL: `SELECT DATE(created_at), COUNT(*) FILTER (WHERE detail_json->>'method' = 'open_registration'), COUNT(*) FILTER (WHERE detail_json ? 'invitation_id') FROM audit_logs WHERE action='auth.register' GROUP BY 1`
- 前端 `AdminDashboard.tsx`：在「用户角色分布」卡片后新增「30 天注册来源」卡片，**沿用现有 `<StatusBar>` 风格**（不引入图表库），双柱并列：邀请 / 开放

**B. 管理员重置密码**
- 后端：`POST /users/{id}/admin-reset-password`（super_admin / project_admin，project_admin 只能重置其项目内 reviewer/annotator/viewer）
  - 角色等级校验：actor.role_level < target.role_level（不能重置同级或更高）
  - 不能重置 super_admin（除非 actor 也是 super_admin 且 != target）
  - 生成 16 字符强临时密码（大小写+数字+符号），更新 `password_hash`，**不发邮件**
  - 限流 `3/minute`
  - 审计 action `user.password_admin_reset`，detail 含 `target_email` / `target_role`，**不记录密码本身**
  - 返回 `{ temp_password: "...", message: "请告知用户首次登录后立即修改密码" }`
- 前端：UsersPage 用户行操作菜单新增「重置密码」→ Modal 二次确认 → 显示临时密码（带复制按钮 + 「30 秒后自动隐藏」提示）
- 用户首次用临时密码登录后，强制跳 SettingsPage 改密 Modal（基于 `User.password_admin_reset_at` 字段，`change_password` 端点成功后清字段）— 需迁移加该字段

---

### PR 3 — 账号自助注销  ≈ 8h

**数据库迁移 `0034_user_deactivation_request.py`**
- `users.deactivation_requested_at` (DateTime tz)
- `users.deactivation_reason` (String 500)
- `users.deactivation_scheduled_at` (DateTime tz, 申请时间 + 7d)
- 索引 `(deactivation_scheduled_at)` 用于 cron 扫描

**后端**
- `POST /me/deactivation-request`：用户自助申请，校验当前未在申请中，写字段，audit `user.deactivation_request`，向所有 super_admin 发站内通知
- `DELETE /me/deactivation-request`：冷静期内取消，清空 3 字段，audit `user.deactivation_cancel`
- `GET /me`：响应增加 `deactivation_status: "none" | "pending" | { scheduled_at }`
- Celery beat 任务 `process_deactivation_requests`（每日 04:00 UTC）：
  - 扫描 `deactivation_scheduled_at <= now()` 用户
  - 调用既有软删路径（复用 `users.py:374-530` 的 GDPR 脱敏逻辑），audit `user.deactivation_approve`
  - 通知所有 super_admin

**前端**
- `SettingsPage.tsx` ProfileSection 末尾新增「危险区」卡片
- 未申请：「申请注销账号」按钮 → Modal（reason textarea + "我已知晓 7 天冷静期"复选框 + 二次密码确认）
- 已申请：显示「已于 X 申请注销，将在 Y 自动生效」 + 「取消申请」按钮

---

### PR 4 — 审计日志按月分区 + 冷数据归档 + 导出审计强化  ≈ 12h

**A. audit_logs 按月分区（用户已选「重」方案）**

写 **ADR-0008** 记录决策：动机、风险、回滚方案（参考 ADR-0006 predictions 双 stage 设计）。

**Alembic 迁移 `0033_audit_logs_partition.py`**（注意 0033 与 system_settings 编号冲突，按 PR 顺序顺延为 0035；最终编号在 PR rebase 时调整）：
1. `BEGIN; LOCK TABLE audit_logs;`
2. 重命名旧表：`audit_logs → audit_logs_legacy`
3. 创建新分区父表：`CREATE TABLE audit_logs (...) PARTITION BY RANGE (created_at);`
4. 复制不可变 trigger 到父表（v0.7.8 `deny_audit_log_mutation`）
5. 创建过去 12 个月 + 未来 3 个月的子分区：`CREATE TABLE audit_logs_y2025m07 PARTITION OF audit_logs FOR VALUES FROM (...) TO (...);`
6. 重建索引（actor_id / action / created_at / request_id / GIN on detail_json）— 索引现在是分区局部索引
7. **数据迁移**：`INSERT INTO audit_logs SELECT * FROM audit_logs_legacy;`（受不可变 trigger 影响需 `SET LOCAL app.allow_audit_update = 'true'`）
8. 验证：`SELECT COUNT(*) FROM audit_logs` == legacy count
9. `DROP TABLE audit_logs_legacy;`（不可 ALTER 接管，因为分区父表的 row 物理在子表）
10. `COMMIT;`

**回滚 (downgrade)**：反向，先把所有数据从分区表 dump 到临时表，DROP 父分区表 + 子分区表，重建原表，恢复数据。**测试时必须用 staging dump 跑一遍**。

**风险与 mitigation**：
- 锁表期间应用 502：迁移文档要求维护窗口，DEV.md 加一节
- 大表 INSERT 慢：本地实测 < 100k 行影响小；如生产 > 1M 行需评估分批迁移（pg_partman extension）
- 不可变 trigger 与分区交互：父表的 trigger 不会自动应用到子表，需在每个子分区 + 未来新分区上重建 → 用 `event_trigger` 机制自动给新分区挂 trigger（参考 PG docs）

**Celery beat 月任务**（`apps/api/app/workers/tasks/audit_partition.py`）：
- `ensure_future_audit_partitions`（每月 25 日 03:00 UTC）：检查未来 3 个月分区是否存在，缺则 `CREATE TABLE ... PARTITION OF audit_logs ...`
- `archive_old_audit_partitions`（每月 2 日 03:00 UTC）：扫描 > 12 个月的子分区，`COPY (SELECT * FROM <partition>) TO STDOUT`，stream-gzip 上传 MinIO `audit-archive/{year}/{month}.jsonl.gz`，成功后 `DROP TABLE <partition>`（分区表 DROP 是元操作，秒级），写 audit `audit.archive`
- 保留期 ENV `AUDIT_RETENTION_MONTHS=12`

**B. 导出审计强化**
- 4 个导出端点（projects/batches/audit-logs/users）的 `AuditService.log` 调用统一扩展 `detail_json`：
  - 已有：`{format, rows}`
  - 新增：`{actor_email, ip, request_id, filter_criteria}`（actor_email 从 `actor` 取，ip 从 request 取）
- **文件 metadata 头**（不引入新依赖）：CSV/JSON 导出文件首部插入注释行：
  ```
  # Exported by: actor@email.com
  # Exported at: 2026-05-06T10:30:00Z
  # Request ID: <uuid>  (可在 audit_logs 中追溯)
  ```
  zip 包（项目/批次导出）则在 zip 根目录加 `EXPORT_MANIFEST.json`
- 前端：AdminDashboard「近期审计活动」列表对 `*.export` action 加图标高亮

---

## 测试与验证

每个 PR 自带 pytest 用例，覆盖：

- **PR 1**：`test_system_settings_patch.py` ① 非 super_admin 403；② 黑名单字段 400；③ PATCH 后 GET 返回新值；④ 改 `allow_open_registration=false` 后 register-open 拒绝
- **PR 2A**：`test_dashboard_registration_stats.py` 造 5 条 audit (3 invite + 2 open) 验证聚合
- **PR 2B**：`test_admin_password_reset.py` ① project_admin 改 super_admin 密码 → 403；② 改同级 → 403；③ 成功路径返回临时密码 + audit 不含密码明文
- **PR 3**：`test_self_deactivation.py` ① 申请 → scheduled_at = now+7d；② 冷静期内取消；③ 模拟 cron task 调用 process 函数后 is_active=False；④ 已注销用户登录 401
- **PR 4A**：`test_audit_partition.py` ① upgrade 后插入 audit log → 落入正确月分区；② `ensure_future_audit_partitions` 调用后 +3 个月分区存在；③ `archive_old_audit_partitions` 把 13 个月前分区 dump 到 MinIO 并 DROP；④ 不可变 trigger 在所有子分区生效（UPDATE 抛错）；⑤ downgrade 后旧表结构 + 数据完整恢复（用 alembic upgrade head + downgrade -1 双向跑）
- **PR 4B**：`test_export_audit_detail.py` 4 个导出端点各跑一次，断言 audit detail 含 actor_email / ip / request_id

**E2E**：手动验证 SettingsPage 改 `allow_open_registration=false` → /register-open 返回 403；UsersPage 改密 → 用临时密码登录成功

**文档同步**（CLAUDE.md §5 要求）：
- `docs-site/dev/api/system-settings.md` 新增 PATCH 端点
- `docs-site/user-guide/account-deactivation.md` 新建
- `CHANGELOG.md` 加 v0.8.1 段
- ROADMAP.md 把对应行打勾移到「已完成」

---

## 文件清单（最终版）

### 新增
- `apps/api/alembic/versions/0033_system_settings.py`
- `apps/api/alembic/versions/0034_user_deactivation_request.py`
- `apps/api/alembic/versions/0035_user_password_admin_reset_at.py`
- `apps/api/alembic/versions/0036_audit_logs_partition.py`（按 PR rebase 顺序最终调整）
- `apps/api/app/db/models/system_setting.py`
- `apps/api/app/services/system_settings_service.py`
- `apps/api/app/services/deactivation_service.py`
- `apps/api/app/services/audit_partition_service.py`
- `apps/api/app/workers/tasks/deactivation.py`
- `apps/api/app/workers/tasks/audit_partition.py`
- `apps/api/tests/test_system_settings_patch.py`
- `apps/api/tests/test_admin_password_reset.py`
- `apps/api/tests/test_self_deactivation.py`
- `apps/api/tests/test_audit_archive.py`
- `apps/api/tests/test_export_audit_detail.py`
- `apps/api/tests/test_dashboard_registration_stats.py`
- `apps/web/src/hooks/useUpdateSystemSettings.ts`
- `apps/web/src/hooks/useDeactivationRequest.ts`
- `apps/web/src/components/settings/DangerZoneCard.tsx`
- `apps/web/src/components/admin/PasswordResetModal.tsx`
- `docs-site/dev/api/system-settings.md`
- `docs-site/user-guide/account-deactivation.md`
- `docs-site/dev/operations/audit-archive.md`（运维手册：分区维护 / 归档恢复流程）
- `docs/adr/0008-audit-log-monthly-partitioning.md`

### 修改
- `apps/api/app/api/v1/system_settings.py`（+PATCH）
- `apps/api/app/api/v1/auth.py:178-227`（register-open 改读 DB override）
- `apps/api/app/api/v1/users.py`（+admin-reset-password + +me/deactivation-request 三端点）
- `apps/api/app/api/v1/dashboard.py`（+registration_by_day）
- `apps/api/app/api/v1/projects.py:489-567`（导出 audit detail 扩展）
- `apps/api/app/api/v1/batches.py:650+`（导出 audit detail 扩展）
- `apps/api/app/api/v1/audit_logs.py:146-248`（导出 audit detail 扩展）
- `apps/api/app/services/audit.py:14-66`（+`system.settings_update` / `user.password_admin_reset` / `user.deactivation_*` / `audit.archive` 5 个新 action）
- `apps/api/app/schemas/me.py`（+`SystemSettingsUpdate` / `DeactivationStatus`）
- `apps/api/app/workers/celery_app.py:1-43`（+3 beat 任务：deactivation / ensure_future_partitions / archive_old_partitions）
- `apps/web/src/pages/Settings/SettingsPage.tsx:205-264`（SystemSection 改可编辑 + 末尾加 DangerZone）
- `apps/web/src/pages/Dashboard/AdminDashboard.tsx`（+注册来源卡片）
- `apps/web/src/pages/UsersPage.tsx`（+ 重置密码菜单项）
- `CHANGELOG.md` / `ROADMAP.md` / `.env.example`（+`AUDIT_RETENTION_MONTHS=12`）
- `apps/api/app/services/email.py`（SMTP 配置改读 SystemSettingsService）
- `apps/api/app/db/models/user.py`（+`password_admin_reset_at` 字段）
- `apps/api/app/api/v1/auth.py:change_password`（成功后清 `password_admin_reset_at`）
- `apps/web/src/pages/Login*.tsx`（首次登录后若 `password_admin_reset_at` 非空，强制跳改密页）
