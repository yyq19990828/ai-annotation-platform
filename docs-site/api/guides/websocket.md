---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-09
---

# WebSocket

完整协议见 [WebSocket 协议](../../dev/ws-protocol)，本页给出 API 视角的常见调用模式。

## 连接

```
ws://localhost:8000/ws?token=<access_token>
```

token 用 query string 传（浏览器 WS API 不支持自定义 header）。后端在 accept 后立刻校验 + 续签机制（[ADR 0011](../../dev/adr/0011-websocket-token-reauth)）。

## 订阅

连接后发送：

```json
{ "type": "subscribe", "channel": "project:1:preannotate" }
```

可订阅多个 channel；取消：

```json
{ "type": "unsubscribe", "channel": "project:1:preannotate" }
```

## 通道列表

| 通道 | 谁订阅 | 内容 |
|---|---|---|
| `project:{id}:preannotate` | 该项目工作台 / `/ai-pre` | 预标进度 / 错误 |
| `project:{id}:annotation` | 工作台协作（多人同任务）| 谁在编辑 |
| `task:{id}:lock` | 工作台 | 锁状态变更 |
| `global:prediction-jobs` | admin（Topbar 徽章） | 全局 in-flight job |
| `user:{uid}:notify` | 当前用户 | 系统通知 / 邀请 |

`global:prediction-jobs` 仅 admin 角色订阅得到（服务端校验）。

## 消息体

服务器 → 客户端：

```json
{
  "channel": "project:1:preannotate",
  "type": "progress",
  "data": { "job_id": "...", "i": 3, "n": 10 }
}
```

通用字段 `channel` + `type`，`data` payload 按通道而异。

## 心跳

服务器每 25s 发 `{"type": "ping"}`，客户端回 `{"type": "pong"}`。60s 内无收发关闭连接。

## Token 续签

access token 默认 30min。WS 连接长寿命，到期前 5min 服务端推：

```json
{ "type": "token-expiring", "expires_in": 300 }
```

客户端调 `POST /api/v1/auth/refresh` 拿新 token，再发：

```json
{ "type": "reauth", "token": "<new_access_token>" }
```

不重连，复用 socket。详见 [ADR 0011](../../dev/adr/0011-websocket-token-reauth)。

## 专用端点

```
ws://localhost:8000/ws/prediction-jobs?token=...
```

仅 admin，等价于 `subscribe global:prediction-jobs`，但去掉了订阅 step（直接连即订阅）。前端 `useGlobalPreannotationJobs` hook 用此端点。

## 错误处理

服务器主动断开会发 close frame：

| code | 含义 |
|---|---|
| 4001 | token 缺失 |
| 4003 | token 无效 / 过期且未 reauth |
| 4029 | 连接数超限（per-user 限流） |
