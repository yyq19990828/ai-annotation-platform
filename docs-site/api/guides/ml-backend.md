---
audience: [dev, ops]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-07-11
---

# ML Backend

## 列出 / 详情

```http
GET /api/v1/admin/ml-integrations              # 当前用户可见
GET /api/v1/admin/ml-integrations/all          # 全局列表
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

URL 校验拒绝 `localhost / 127.x.x.x / 0.0.0.0 / ::1`（[ADR 0015](../../dev/adr/archive/0015-ml-backend-url-validation)）。失败返回 422 + 提示用 docker bridge IP / service DNS。

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

## 项目启用与主后端

每个项目从全局注册表勾选启用 backend，并设主后端。

启用 / 覆盖（项目作用域）：

```http
GET /api/v1/projects/:id/ml-backends/available
PUT /api/v1/projects/:id/ml-backends/:registry_id/enablement
{ "enabled": true, "box_threshold": 0.3, "text_threshold": 0.25, "default_variants": {} }
```

- `available` 列出全部全局 backend + 本项目启用态 / 覆盖。
- `enablement` 切换启用并写项目级覆盖（`box_threshold` / `text_threshold` / `default_variants` 均可选）。

项目作用域端点同时执行角色门与项目范围门：

- list / get / setup / capabilities / interactive inference：调用者必须能看见该项目；读指定 backend 时还要求它已对本项目启用。
- create / update / delete(enablement disable) / health / capabilities refresh / warmup / reload / unload / predict-test：要求项目 owner（超级管理员仍按全局特权放行）。仅有 `project_admin` 角色但不是该项目 owner 不足以执行写操作。
- 带 `task_id` 的测试 / 交互端点还会校验 task 确实属于 URL 中的 project；不属于时统一返回 404，避免跨项目 IDOR 与存在性泄露。

设主后端 / AI 开关（走项目本体）：

```http
PATCH /api/v1/projects/:id
{ "ml_backend_id": 3, "ai_enabled": true }
```

`ml_backend_id` 只能取**已启用**的 backend。未设主后端直接触发预标会得到明确错误：

```json
{ "detail": "Project has no ML backend bound. Configure in project settings." }
```

> 旧的项目作用域端点仍向后兼容：`POST /api/v1/projects/:id/ml-backends`（按 URL 复用或新建全局项 + 启用）、`DELETE`（停用）。主推路径是上面的启用清单。

## 协议

ML Backend 必须实现：

| 端点 | 用途 |
|---|---|
| `GET /health` | 健康检查 |
| `POST /predict` | 推理（请求/响应见 [ML Backend 协议](../../dev/reference/ml-backend-protocol)） |

参考实现：`docs-site/dev/examples/echo-ml-backend/`。

## 能力目录（capabilities）

能力声明协议 v2（v0.14.9）下，平台把 backend `/setup` 派生成 model 粒度的能力目录，供模型市场与工作台多模型选择器消费：

```http
GET  /api/v1/projects/:id/ml-backends/:bid/capabilities
POST /api/v1/projects/:id/ml-backends/:bid/capabilities/refresh
```

- 服务端探 backend `/setup`（复用 30s setup 缓存链路）后调 `extract_capabilities` 派生快照，返回 `models[]` / `infra` / `modalities` 与扁平并集字段（所有 model 的 prompts / geometry 去重合并）。
- 老 backend（协议 v1，无 `models[]`）由平台合成隐式单 model（`id="default"`），返回结构一致，长度为 1。
- `refresh` 对该 backend 强制重探并刷新缓存。
- `/setup` 与 capabilities 允许能看见该项目的项目管理员、超级管理员、审核员、标注员读取；`refresh` 只允许项目 owner / 超级管理员。backend `/setup` 不可达时返回 502。
- 能力快照同时落库到 `ml_backend_registry.health_meta["capabilities"]`（健康检查时写入），无独立迁移。

字段语义与受控词表见 [ML Backend 协议 §4.1](../../dev/reference/ml-backend-protocol)。

## 审计

`ml_backend.created` / `updated` / `deleted` 全部进 audit_logs。

## 相关

- [超管 - ML Backend 注册](../../user-guide/superadmin/ml-backend-registry)
- [容器网络与 loopback](../../dev/troubleshooting/container-networking)
- [预标注流水线](../../dev/concepts/prediction-pipeline)
