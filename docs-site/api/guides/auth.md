---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-09-09
---

# 认证

## 登录

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "alice@example.com", "password": "...", "captcha_token": null }
```

成功响应：

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer"
}
```

`access_token` 默认有效期 **24 小时**（`access_token_expire_minutes` 配置，默认 `60 * 24`）。登录后通过 `/api/v1/auth/me` 获取当前用户；续期使用同一个 Bearer token。

## 携带 token

```http
GET /api/v1/auth/me
Authorization: Bearer <access_token>
```

## 账号恢复

忘记密码时提交邮箱地址：

```http
POST /api/v1/auth/forgot-password
Content-Type: application/json

{ "email": "alice@example.com", "captcha_token": null }
```

接口对已注册和未注册地址都返回 `202` 及相同提示。账号查询和邮件投递在响应后执行，SMTP 等待不会延迟该响应或阻塞其他请求。已注册账号会通过系统 SMTP 设置发送一小时有效的重置链接；SMTP 未配置或发送失败时，服务端不会把 token 写入日志，管理员可在设置页发送测试邮件定位问题。未收到邮件时可重新申请或由管理员协助恢复。

用户提交邮件中的 token 设置新密码：

```http
POST /api/v1/auth/reset-password
Content-Type: application/json

{ "token": "<one-time-token>", "new_password": "..." }
```

密码为 8–128 位，并且必须包含大写字母、小写字母和数字。token 过期、消费后或账号处于停用状态时不能使用；重置成功会使该账号已有的 JWT 会话失效，用户需要使用新密码重新登录。

管理员无法发送邮件时，可以先在 `/settings` 的系统设置中检查 `frontend_base_url` 与 SMTP host / port / 发件人，并使用「发送测试邮件到我」定位配置问题。使用管理员生成的临时密码登录后，界面会引导用户到设置页改密。

## 停用、交接与恢复

以下接口要求超级管理员或目标用户所在项目的项目管理员。项目管理员只能处理其管理范围内的标注员和审核员；跨越管理范围、操作自己和停用最后一名超管均会被拒绝。

| 方法与路径                                       | 行为                                                     |
| ------------------------------------------------ | -------------------------------------------------------- |
| `GET /api/v1/users?status=active\|inactive\|all` | 按启用状态过滤，缺省 `active`，仍返回用户数组            |
| `GET /api/v1/users/{id}/offboarding-preview`     | 读取项目职责、批次、各状态任务、锁、API Key 和接收人选项 |
| `POST /api/v1/users/{id}/offboarding`            | 重新核对预览，交接并停用，或紧急停用后保留待交接事项     |
| `POST /api/v1/users/{id}/reactivate`             | 恢复明确可恢复的停用账号                                 |

预览返回 `preview_version`、`generated_at`、`projects`、`api_keys`、`blockers` 和 `can_commit`。每个项目通过 `roles.owner`、`roles.annotator`、`roles.reviewer` 分开描述职责和 `receiver_options`，客户端应使用这些实际选项。

```json
{
  "preview_version": "<version-from-preview>",
  "reason": "人员离职，职责已核对",
  "mode": "handoff",
  "projects": [
    {
      "project_id": "<project-uuid>",
      "annotator_receiver_id": "<annotator-uuid>"
    }
  ]
}
```

每项只提交该项目需要交接的职责，也可分别使用 `owner_receiver_id`、`reviewer_receiver_id`。`mode=emergency_suspend` 允许暂不提供接收人，响应中的 `unresolved` 列出后续事项。管理员可以为该停用账号重新获取预览，再以 `handoff` 完成交接。

确认时会重新校验接收人启用状态、角色和项目权限，并在同一数据库事务内更新用户、批次、可继续流转的任务、项目负责人、锁和审计。预览过期、接收人资格变化或相关资源正在写入时返回 `409`，客户端须刷新预览并让管理员重新确认。交接不改写已完成任务的历史归属。

`UserOut` 增加 `disabled_kind`、`disabled_at`、`disabled_by`、`disabled_reason`。`suspended` 和 `emergency_suspended` 可以恢复；`deleted`、`historical_unknown` 不能恢复。迁移前无法可靠识别停用来源的账号归入 `historical_unknown`。恢复请求可带 `{"reason":"返岗"}`；恢复不会拿回已交接职责、复活旧会话或恢复已撤销的 API Key。集成负责人应为接收账号另行创建密钥。

原有删除入口继续具有独立语义，参见[人员管理](../../user-guide/superadmin/user-management.md)。

## 刷新

```http
POST /api/v1/auth/refresh
Authorization: Bearer <access_token>
```

无需 body。可以使用过期不超过 7 天的 JWT 换取新 `access_token`；已登出、代际号失效、账号停用或超过宽限期时返回 `401`。

## 登出

```http
POST /api/v1/auth/logout
Authorization: Bearer <access_token>
```

撤销当前 JWT，前端同步清除本地认证状态。

## CAPTCHA

同 IP 连续登录失败达到阈值（`login_captcha_threshold`，默认 **5 次**）后，下一次登录必须带 CAPTCHA：

```json
{
  "email": "alice@example.com",
  "password": "...",
  "captcha_token": "<turnstile-token>"
}
```

开启 Turnstile 后由前端验证组件获取 `captcha_token`。验证失败时接口返回 `captcha_required`，响应头 `X-Login-Failed-Count` 提供失败次数。

失败计数按 IP 单键 (`login_failed:{ip}`)，窗口长度由 `login_failed_window_seconds` 配置（默认 **3600 秒 / 1 小时**）。登录成功后立刻清空计数。

## API Key

适合脚本 / 自动化场景，长期凭证。token 形如 `ak_<随机串>`，仅创建瞬间返回一次明文：

```http
GET    /api/v1/me/api-keys            # 列出（不含明文，含已撤销）
POST   /api/v1/me/api-keys            # 创建（仅返回明文一次）
PATCH  /api/v1/me/api-keys/:id        # 改名 / 改 scope / 改有效期
POST   /api/v1/me/api-keys/:id/rotate # 轮换（换新明文，旧的立即失效）
DELETE /api/v1/me/api-keys/:id        # 撤销（软删，保留审计）
```

调用时作 Bearer token 发送（与 JWT 同一 header，后端按 `ak_` 前缀区分）：

```http
GET /api/v1/projects
Authorization: Bearer ak_xxxxxxxxxxxx
```

**有效期**：创建时可选 `expires_in_days`（省略 = 永不过期）；过期后认证返回 401。

**权限 scope**：

- key 的 `scopes` 在路由层经 `require_scopes` 校验；缺少所需 scope → **403**。
- 含通配 `"*"`（完全访问 / full-access）的 key 绕过 scope 校验，等同用户全权。
- 已挂强制的 scope：`annotations:read` / `annotations:write` / `datasets:read` / `predictions:read`（其余路由暂不限制）。
- ⚠️ **scope 不是只读隔离**：未挂强制的端点（含多数写操作，以及 `/ws/ml-backend-stats` 监控流）仍遵从 key 所属用户的角色——只勾读 scope 的 key 在 owner 为 super_admin / project_admin 时仍能触达 `POST /datasets`、`DELETE /projects/*` 等高危写操作。需要真正受限的程序化访问，请用低权限账号创建 key。
- JWT / 密码登录的会话不受 scope 约束（视为 full-access）。

## 错误码

| HTTP | 含义                                 |
| ---- | ------------------------------------ |
| 401  | token 缺失 / 过期 / 无效             |
| 403  | 角色权限不足                         |
| 409  | 交接预览过期、资源忙碌或状态不可恢复 |
| 422  | body 校验失败（如密码不满足规则）    |
| 429  | 限流（登录端点单独限流以防爆破）     |

## 相关

- [WebSocket token 续签](../../dev/adr/archive/0011-websocket-token-reauth)
- [安全模型](../../ops/security/)
