---
audience: [super_admin]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-06-10
---

# ML Backend 注册

ML Backend 是平台对接外部推理服务的契约层。每个 Backend 是一行 `ml_backends` 记录，绑定到具体项目后，AI 预标注任务才能找到推理目标。

## 入口

- 项目侧：项目设置 → **ML 模型** tab（写权限属项目管理员 / 超级管理员）
- 全局侧（仅超管）：`/model-market`

## 表单字段

| 字段 | 含义 | 约束 |
|---|---|---|
| 名称 | 显示名 | 无全局唯一性约束（`ml_backends` 表无 UNIQUE 索引） |
| URL | Backend HTTP 入口 | **不能填 loopback**（详见下） |
| 交互式 | 是否支持工作台一键推理 | 布尔开关，默认关 |
| API Key | 可选，header `Authorization: Bearer ...` | — |
| 额外参数 | JSON 扩展字段（如 `max_concurrency`） | — |

> **已删除的虚构字段**：`type`（类型选择器）、默认 prompt、默认阈值均**不是**注册表单的真实字段。backend 类型由 backend 自身通过 `/setup` 声明（能力协议 v2），不在注册时指定。`max_concurrency` 等运行时参数写入 `extra_params` JSONB 字段，不在创建表单暴露（`apps/api/app/db/models/ml_backend.py`）。

## URL 校验：拒绝 loopback

后端 Pydantic `field_validator` 会直接拒绝以下 host（`apps/api/app/schemas/ml_backend.py:8`）：

- `localhost`
- `127.0.0.1`（精确匹配，**不**拒绝整个 `127.x.x.x` 段）
- `0.0.0.0`
- `::1`

错误消息会指引你填正确的地址。背后原因：容器内 `localhost` 指向容器自身，不可能连到宿主机的 ML Backend。详见 [容器网络与 loopback](../../dev/troubleshooting/container-networking)。

**正确填法：**

| 场景 | URL |
|---|---|
| Backend 在同一个 docker-compose | `http://grounded-sam2-backend:8001` |
| Backend 在宿主机 / 局域网 | `http://172.17.0.1:8001`（Linux 默认 bridge）/ `http://host.docker.internal:8001`（mac/win） |
| Backend 在另一台机器 | LAN IP / 域名 |

dev 环境 placeholder 已默认填 `172.17.0.1:8001`。

## 健康检查

注册后系统会自动调用 `GET <url>/health`。失败不阻断创建（避免临时网络问题让你卡住），但会在列表里显示红色徽章，状态值为 **`error`**（不是 `unreachable`；`state` 字段枚举：`disconnected` / `connected` / `error`，见 `apps/api/app/services/ml_backend.py:122`）。

**注册前连通性测试**：`POST /admin/ml-integrations/probe` 提供无 DB 副作用的探测（`/probe`），注册表单「测试连接」按钮即调用此端点。

## 项目绑定

注册仅是创建可选项。真正生效需要：

1. 项目设置 → **ML 模型** → 勾选 **启用 AI 预标注**
2. 在同一页的 **默认 ML Backend** 下拉选刚注册的 backend
3. 保存 AI 设置

未设默认 backend 直接跑预标会报错，并在前端给出配置引导。

## 复用其它项目的 Backend

新建项目 wizard step 4 提供下拉选其它项目已注册的 backend，平台会**复制**一份到新项目（不是引用）。这样修改互不影响，也避免单项目 backend 删除影响他人。

后端：`GET /admin/ml-integrations/all` 返回全局可见的 backend 列表。

## 删除

**超级管理员和项目管理员均可删除**（`require_roles(SUPER_ADMIN, PROJECT_ADMIN)`，`apps/api/app/api/v1/ml_backends.py:185`）。删除前若有正在运行的预测 job，返回 `HTTP 409` 阻断；无 running job 时直接删除，`projects.ml_backend_id` 通过 ON DELETE SET NULL 自动置空（`apps/api/app/db/models/project.py:44`）。

## 审计

以下事件写入 `audit_logs`：

- `ml_backend.created` / `ml_backend.updated` / `ml_backend.deleted`
- `ml_backend.reloaded` / `ml_backend.unloaded` / `ml_backend.warmup`（生命周期动作）
- `ml_backend.smoke_tested`（模型市场试启动）

详见 [审计日志](./audit-logs)。

## 相关操作

- **观测（observe）**：`GET /admin/ml-integrations/observe` 直连 env 配的 ML Backend 容器，不需要项目注册即可看健康 / 变体目录。
- **试启动（smoke-test）**：`POST /admin/ml-integrations/observe/smoke-test`，空池时预热指定变体并自动还原，验证可加载性（`apps/api/app/api/v1/admin_ml_integrations.py:481`）。
- **`max_concurrency`**：写入 `ml_backends.extra_params.max_concurrency`，前端 /ai-pre 项目卡片会读取并展示。

## 相关

- [ADR 0015 — ML Backend URL 验证](../../dev/adr/0015-ml-backend-url-validation)
- [模型市场](./model-market)
- [ML Backend 协议](../../dev/reference/ml-backend-protocol)
