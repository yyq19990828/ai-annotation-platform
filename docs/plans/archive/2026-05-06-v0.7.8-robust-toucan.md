# v0.7.8 Plan — 登录注册改进 + 安全加固 + 治理合规

## Context

v0.7.7 落了开放注册基座，但存在前端密码校验与后端不一致的安全缺陷，LoginPage 测试账号在 production 直接暴露。同时 ROADMAP 中积累了多项安全/治理待办（会话管理、邀请限流、审计不可变、CORS 收紧、导出审计）。v0.7.8 集中收口这些安全与治理欠账。

---

## 实施项 (10 项, 总估时 ~23h, 不含 P3 分区)

### Phase 1: P1 前端安全修复 (2h)

#### 1. InviteRegisterForm 密码校验对齐后端
- **文件**: `apps/web/src/pages/Register/RegisterPage.tsx`
- **问题**: InviteRegisterForm 第 183 行 `pwd.length < 6`、第 196 行 `pwd.length >= 6`；后端要求 8+ 含大小写+数字
- **改动**:
  - 新增工具函数 `isPasswordStrong(pwd)`: length>=8 && /[A-Z]/ && /[a-z]/ && /\d/
  - InviteRegisterForm: 第 183 行 → `!isPasswordStrong(pwd)`，第 196 行 → `isPasswordStrong(pwd)`
  - OpenRegisterForm: 第 44 行已是 `>= 8`，补加大小写+数字检测
  - 两个表单均添加实时 `PasswordStrengthIndicator`（4 条规则 check/cross）
- **验证**: 输入弱密码（如 "abc12345"）提交按钮灰显

#### 2. LoginPage 测试账号 production 隐藏 + 去域名简化
- **文件**:
  - `apps/web/src/pages/Login/LoginPage.tsx` — 第 217-224 行无条件渲染测试账号
  - `apps/api/scripts/seed.py` — 测试账号邮箱去掉 `@test.com` 域名
  - `DEV.md` — 新增「测试账号」小节记录
- **改动**:
  1. LoginPage 测试账号区块包裹 `{import.meta.env.MODE !== 'production' && (...)}`
  2. seed.py 测试邮箱从 `admin@test.com` → `admin`，`pm@test.com` → `pm`，以此类推（`LoginRequest.email` 是 `str` 非 `EmailStr`，无格式校验问题）
  3. LoginPage dev 模式显示更新为新的短标识符
  4. DEV.md 添加测试账号速查表:
     ```
     | 标识符  | 角色          | 密码   |
     |---------|--------------|--------|
     | admin   | super_admin  | 123456 |
     | pm      | project_admin| 123456 |
     | qa      | reviewer     | 123456 |
     | anno    | annotator    | 123456 |
     | viewer  | viewer       | 123456 |
     | anno2   | annotator    | 123456 |
     | anno3   | annotator    | 123456 |
     ```
- **验证**: `pnpm build` 后 production bundle 中无测试账号文本；dev 模式用短标识符可正常登录

---

### Phase 2: 安全加固 (16h)

#### 3. 邀请频率限流 (2-3h)
- **文件**:
  - `apps/api/app/config.py` — 新增 `max_invitations_per_day: int = 30`
  - `apps/api/app/api/v1/users.py` — `invite_user` 加 `@limiter.limit("20/day")` + 业务层 24h 计数校验
  - `apps/api/app/services/invitation.py` — 新增 `check_daily_limit(actor_id, db)` 方法
- **逻辑**: COUNT user_invitations WHERE invited_by_id=actor AND created_at > now()-24h >= settings.max_invitations_per_day → 429
- **测试**: `test_invitation_rate_limit_exceeded`

#### 4. 会话管理: Token 黑名单 + 登出 (6-8h)
- **核心架构**: JWT 加入 `jti` (UUID) + `gen` (代际号) 声明；Redis 存黑名单
- **文件**:
  - `apps/api/app/core/security.py` — `create_access_token` 加 jti+gen 参数
  - **新建** `apps/api/app/core/token_blacklist.py`:
    - `blacklist_token(redis, jti, ttl_seconds)` — SETEX
    - `is_blacklisted(redis, jti)` — EXISTS
    - `increment_user_generation(redis, user_id)` — INCR `token_gen:{user_id}`
    - `get_user_generation(redis, user_id)` — GET (default 0)
  - `apps/api/app/deps.py` — `get_current_user` 增加: 提取 jti/gen → 检查黑名单 → 检查代际
  - `apps/api/app/api/v1/auth.py` — 新端点:
    - `POST /auth/logout` — 黑名单当前 jti
    - `POST /auth/logout-all` — 递增 user generation (所有旧 token 失效)
  - `apps/api/app/services/audit.py` — 新增 `AUTH_LOGOUT` / `AUTH_LOGOUT_ALL` action
  - `apps/web/src/hooks/useAuth.ts` — logout 调 API 再清本地状态
  - `apps/web/src/stores/authStore.ts` — logout action 调后端
- **Redis 依赖**: 已在 docker-compose 中运行，`settings.redis_url` 已配置
- **测试**: `test_logout_blacklists_token`, `test_logout_all_invalidates_sessions`

#### 5. 数据导出审计 (1-2h)
- **问题**: 项目/批次 export 端点无审计记录
- **文件**:
  - `apps/api/app/services/export.py` 或对应 router
  - `apps/api/app/services/audit.py` — 新增 `PROJECT_EXPORT` / `BATCH_EXPORT` action
- **改动**: export 函数返回前 `await AuditService.log(...)` 含 format + count
- **测试**: `test_project_export_creates_audit_log`, `test_batch_export_creates_audit_log`

#### 6. 审计日志不可变: PG Trigger (3-4h)
- **新迁移**: `apps/api/alembic/versions/0032_audit_log_immutability.py`
  - BEFORE UPDATE/DELETE trigger → RAISE EXCEPTION
  - GDPR 豁免: trigger 内检查 `current_setting('app.allow_audit_update', true) = 'true'`
- **文件**:
  - `apps/api/app/api/v1/users.py` (GDPR 删除处约第 487 行) — UPDATE 前执行 `SET LOCAL app.allow_audit_update = 'true'`
- **测试**: `test_audit_log_delete_denied`, `test_audit_log_update_denied`, `test_gdpr_redaction_still_works`

#### 7. CORS 收紧 (1h)
- **文件**:
  - `apps/api/app/config.py` — 新增 `cors_allow_methods` / `cors_allow_headers` 字段
  - `apps/api/app/main.py` (第 81-82 行) — production 用显式列表，dev 保持 `["*"]`
- **验证**: production 模式启动后非白名单 header 被拒

---

### Phase 3: 治理增强 (4h)

#### 8. 最后登录追踪 (1-2h)
- **新迁移**: `apps/api/alembic/versions/0033_user_last_login.py` — ADD COLUMN `last_login_at` TIMESTAMPTZ
- **文件**:
  - `apps/api/app/db/models/user.py` — 新字段 `last_login_at`
  - `apps/api/app/api/v1/auth.py` (login 成功分支第 87 行) — `user.last_login_at = datetime.now(UTC)`
  - `apps/api/app/schemas/user.py` (UserOut) — 新增 `last_login_at: datetime | None`
- **测试**: `test_last_login_updated_on_login`

#### 9. 失败登录详情增强 (1h)
- **文件**: `apps/api/app/api/v1/auth.py` (第 63 行 detail dict)
- **改动**: 追加 `"user_agent": request.headers.get("user-agent", "")[:256]`
- **测试**: `test_failed_login_user_agent_logged`

#### 10. 审计日志月分区 — ADR only (1h)
- **不做迁移**，仅写 ADR `docs/adr/0007-audit-log-partitioning.md`
- 内容: RANGE(created_at) 月分区设计、触发条件(>100万行)、FK 处理、与 Item 6 trigger 的交互
- 实际迁移推迟到数据量达标时触发

---

## 迁移序列

| # | 文件 | 内容 | 依赖 |
|---|------|------|------|
| 0032 | `0032_audit_log_immutability.py` | PG trigger 拒绝 UPDATE/DELETE | 无 |
| 0033 | `0033_user_last_login.py` | users 表新增 last_login_at | 无 |

---

## 测试策略

**后端** — 新文件 `apps/api/tests/test_v0_7_8.py`:
1. `test_invite_register_password_strength_rejection` — 弱密码被后端拒绝(已有但确认)
2. `test_invitation_rate_limit_exceeded` — 第 31 次邀请 → 429
3. `test_logout_blacklists_token` — logout 后旧 token 401
4. `test_logout_all_invalidates_sessions` — 多 token 全部失效
5. `test_project_export_creates_audit_log` — export 写 audit
6. `test_batch_export_creates_audit_log` — 同上
7. `test_audit_log_delete_denied` — raw DELETE → ProgrammingError
8. `test_audit_log_update_denied` — raw UPDATE → ProgrammingError
9. `test_gdpr_redaction_still_works` — SET LOCAL 豁免正常
10. `test_last_login_updated_on_login` — login 后字段非空
11. `test_failed_login_user_agent_logged` — detail_json 含 user_agent

**前端** — vitest:
- `RegisterPage.test.tsx`: 密码强度指示器、弱密码禁提交
- `LoginPage.test.tsx`: production mode 无测试账号渲染

---

## 实施顺序

| Step | Items | 估时 | 风险 |
|------|-------|------|------|
| S1 | 1 + 2 (前端修复) | 2h | 极低 |
| S2 | 5 (导出审计) | 2h | 极低 |
| S3 | 3 (邀请限流) | 3h | 低 |
| S4 | 7 (CORS) | 1h | 低 |
| S5 | 8 + 9 (last_login + 失败详情) | 2h | 低 |
| S6 | 6 (审计不可变 trigger) | 4h | 中 (GDPR 交互) |
| S7 | 4 (会话管理) | 8h | 中 (新子系统) |
| S8 | 10 (ADR 文档) | 1h | 无 |

---

## 交付物

- CHANGELOG.md 新增 v0.7.8 条目
- ROADMAP.md 移除已完成项、更新优先级表
- 2 个 Alembic 迁移 (0032, 0033)
- 1 个 ADR (0007)
- 1 个新后端模块 (`core/token_blacklist.py`)
- 11 个后端测试 + 2 个前端测试文件
