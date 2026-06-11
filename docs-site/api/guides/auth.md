---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-28
---

# 认证

## 登录

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "username": "alice", "password": "..." }
```

成功响应：

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "user": { "id": 1, "username": "alice", "role": "annotator" }
}
```

`access_token` 默认有效期 **24 小时**（`access_token_expire_minutes` 配置，默认 `60 * 24`）。Refresh token 通过 **HttpOnly cookie** 自动下发，前端无需手动管理。

## 携带 token

```http
GET /api/v1/me
Authorization: Bearer <access_token>
```

## 刷新

```http
POST /api/v1/auth/refresh
```

无需 body，浏览器自动携带 cookie。返回新 `access_token`。

## 登出

```http
POST /api/v1/auth/logout
```

清 cookie；前端同步清掉内存里的 access token。

## CAPTCHA

同 IP 连续登录失败达到阈值（`login_captcha_threshold`，默认 **5 次**）后，下一次登录必须带 CAPTCHA：

```json
{
  "username": "alice",
  "password": "...",
  "captcha_id": "...",
  "captcha_answer": "..."
}
```

CAPTCHA 由 `GET /api/v1/auth/captcha` 获取（PNG + id）。

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

**权限 scope**（v0.15.11 起真正强制）：

- key 的 `scopes` 在路由层经 `require_scopes` 校验；缺少所需 scope → **403**。
- 含通配 `"*"`（完全访问 / full-access）的 key 绕过 scope 校验，等同用户全权。
- 已挂强制的 scope：`annotations:read` / `annotations:write` / `datasets:read` / `predictions:read`（其余路由暂不限制）。
- JWT / 密码登录的会话不受 scope 约束（视为 full-access）。

## 错误码

| HTTP | 含义 |
|---|---|
| 401 | token 缺失 / 过期 / 无效 |
| 403 | 角色权限不足 |
| 422 | body 校验失败（如 username 为空） |
| 429 | 限流（登录端点单独限流以防爆破） |

## 相关

- [WebSocket token 续签](../../dev/adr/0011-websocket-token-reauth)
- [安全模型](../../ops/security/)
