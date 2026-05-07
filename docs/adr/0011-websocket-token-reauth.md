# ADR-0011: WebSocket 鉴权过期重连

- **Status**: Accepted
- **Date**: 2026-05-07
- **Supersedes**: —
- **Related**: ADR-0010, [`docs-site/dev/ws-protocol.md`](../../docs-site/dev/ws-protocol.md), [`docs-site/dev/security.md`](../../docs-site/dev/security.md)

## Context

v0.6.6 落 `useNotificationSocket` 后，WS 连接的鉴权链路是：

```
ws.connect → URL 带 ?token=<jwt> → 后端 ws_router 解 token → 验证通过 → accept
```

JWT TTL 默认 24 小时（`ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24`）。token 过期后：

1. 浏览器 ws 收到 close（后端关闭码 1008 / 4001）
2. `useNotificationSocket.onclose` 直接 `scheduleRetry()`
3. 重连仍带旧 token → 立即被关闭 → 退避后再试
4. 直到用户手动刷新页面或重新登录

**实际伤害**：标注员一上午积累几百个标注未提交，午饭回来发现通知都丢了 + my-batches 更新没收到；只能强刷页面赌画布草稿仍在。

## Decision

引入 **`/auth/refresh` 端点 + 前端 onclose 时主动 refresh 重连** 两段闭环。

### 后端端点

```
POST /auth/refresh
Authorization: Bearer <old_token>     # 即使已过期，7 天 grace 内可接受
→ 200 { access_token: <new_token> }   # 新 token TTL 24h
```

**校验链**：

1. `jwt.decode(..., options={"verify_exp": False})` 解出 sub / jti / exp / gen
2. 拒绝 grace 已过：`now > expired_at + 7 days` → 401 `grace_expired`
3. jti 黑名单（`logout` 后立即生效）→ 401 `token_revoked`
4. user.is_active = True → 否则 401 `user_inactive`
5. gen 与 Redis 中 `token_gen:<user_id>` 比对（`logout-all` 后会变）→ 否则 401 `generation_outdated`
6. 都通过 → `create_access_token` 同 sub/role/gen 发新 token
7. 审计 `auth.token_refresh`（detail 含 `old_jti`、`expired_seconds_ago`）

**速率**：5/min/IP（slowapi）。

### 前端 hook

`useNotificationSocket` onclose 检测关闭码：

- `1008` / `4001`（鉴权失败 / 过期）
   1. POST `/auth/refresh` 用旧 token 拉新 token
   2. 写 localStorage（保持原有 token 存储约定）
   3. `scheduleRetry()` 用新 token 重连
   4. refresh 失败 → toast「会话已过期」+ 跳 `/login`
- 其他 close code → 走原有指数退避 retry

### Grace 策略

7 天 grace 是「用户出差一周回来 token 过期但身份还在」的体感线。超过则强制重新输入密码——这是有意为之，给凭证泄露的死亡时间窗设上限。

## Consequences

**正向：**

- 长会话（开着标注页面 24h+）的标注员永不被中断
- 凭证泄露窗口受 `is_active` + jti 黑名单 + gen 三段闭环约束，refresh 不放宽攻击面
- 实施 cost 小：后端单端点 + 前端 hook 修改 ~20 行

**负向 / 风险：**

- 攻击者 stoles 一个未过期 token 后能 7 天内不停 refresh —— 但 `is_active` + 主动 logout 仍可斩断
- ws 1008/4001 关闭码必须由后端正确发出，否则前端 fall through 到普通 retry（不调 refresh）。当前 `apps/api/app/api/v1/ws.py` 已用 1008
- refresh 失败时跳 `/login` 会丢前端未保存草稿——但工作台 v0.8.5 已有 sessionStorage 5min TTL 草稿，损失可控

## Open / Follow-up

1. **滑动续期**：refresh 端点同时延长 `last_seen_at`，未来若加 idle 超时（比如 7 天不活跃 logout），refresh 行为本身就构成 active 信号。本 ADR 已在 audit 中写入 `last_seen_at = now`。
2. **refresh 链路监控**：未来在 Grafana 加面板「refresh 次数 / 401 比例」，比例突增即 token 滥发。（与 ADR-0010 共用一份 dashboard）
3. **Cookie session**：长期可考虑切到 HttpOnly cookie + CSRF token，杜绝 localStorage 持久化 jwt 的安全劣势。变动较大，留作 v0.10.x 评估。
