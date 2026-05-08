# ML Backend

## 列出 / 详情

```http
GET /api/v1/admin/ml-integrations              # 当前用户可见
GET /api/v1/admin/ml-integrations/all          # 全局列表（v0.9.7 wizard 复用用）
GET /api/v1/admin/ml-integrations/:id
```

## 创建

```http
POST /api/v1/admin/ml-integrations
{
  "name": "sam-prod",
  "type": "grounded-sam-2",
  "url": "http://172.17.0.1:8001",   // ⚠️ 不能 loopback
  "api_key": "...",
  "default_prompt": "person",
  "default_threshold": 0.3
}
```

URL 校验拒绝 `localhost / 127.x.x.x / 0.0.0.0 / ::1`（[ADR 0015](../../dev/adr/0015-ml-backend-url-validation)）。失败返回 422 + 提示用 docker bridge IP / service DNS。

## 修改 / 删除

```http
PATCH  /api/v1/admin/ml-integrations/:id
DELETE /api/v1/admin/ml-integrations/:id       # 仅 super_admin
```

删除前若有项目引用会提示 N 个项目，确认后级联清掉项目侧绑定（`projects.ml_backend_id = NULL`）。

## 健康检查

注册时 / 详情查询时后端会调用 `GET <url>/health`（5s 超时）。结果在响应里：

```json
{ "id": 1, "url": "...", "health": { "ok": true, "latency_ms": 45 } }
```

不阻断创建——网络抖动不应让你卡住。

## 项目绑定

绑定走项目侧：

```http
PATCH /api/v1/projects/:id
{ "ml_backend_id": 3, "ai_enabled": true }
```

未绑定状态下触发预标会得到明确错误（v0.9.9 B-8）：

```json
{ "detail": "Project has no ML backend bound. Configure in project settings." }
```

## 协议

ML Backend 必须实现：

| 端点 | 用途 |
|---|---|
| `GET /health` | 健康检查 |
| `POST /predict` | 推理（请求/响应见 [ML Backend 协议](../../dev/ml-backend-protocol)） |

参考实现：`docs-site/dev/examples/echo-ml-backend/`。

## 审计

`ml_backend.created` / `updated` / `deleted` 全部进 audit_logs（v0.9.9 B-5）。

## 相关

- [超管 - ML Backend 注册](../../user-guide/superadmin/ml-backend-registry)
- [容器网络与 loopback](../../dev/troubleshooting/container-networking)
- [预标注流水线](../../dev/architecture/prediction-pipeline)
