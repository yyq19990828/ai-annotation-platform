---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-09
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

`access_token` 短期有效（默认 30 min）。Refresh token 通过 **HttpOnly cookie** 自动下发，前端无需手动管理。

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

## CAPTCHA 升级（v0.9.3）

连续登录失败 3 次后，下一次必须带 CAPTCHA：

```json
{
  "username": "alice",
  "password": "...",
  "captcha_id": "...",
  "captcha_answer": "..."
}
```

CAPTCHA 由 `GET /api/v1/auth/captcha` 获取（PNG + id）。

失败计数按 IP + 用户名 双键，3 分钟窗口。

## API Key（v0.9.3）

适合脚本 / 自动化场景，长期凭证：

```http
POST /api/v1/api-keys           # 创建（仅返回明文一次）
GET  /api/v1/api-keys           # 列出（不含明文）
DELETE /api/v1/api-keys/:id     # 撤销
```

调用时：

```http
GET /api/v1/projects
X-API-Key: <key>
```

API Key 按用户授权，权限 = 用户角色权限。

## 错误码

| HTTP | 含义 |
|---|---|
| 401 | token 缺失 / 过期 / 无效 |
| 403 | 角色权限不足 |
| 422 | body 校验失败（如 username 为空） |
| 429 | 限流（登录端点单独限流以防爆破） |

## 相关

- [WebSocket token 续签](../../dev/adr/0011-websocket-token-reauth)
- [安全模型](../../dev/security)
