---
audience: [super_admin]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# ML Backend 注册

ML Backend 是平台对接外部推理服务的契约层。每个 Backend 是一行 `ml_backends` 记录，绑定到具体项目后，AI 预标注任务才能找到推理目标。

## 入口

- 项目侧：项目设置 → **ML 模型** tab（v0.9.3-phase3 起前端可写，写权限属 admin/super_admin）
- 全局侧（仅超管）：`/model-market`

## 表单字段

| 字段 | 含义 | 约束 |
|---|---|---|
| 名称 | 显示名 | 项目内唯一 |
| 类型 | `grounded-sam-2` / 自训类型 | 决定 worker 用哪条调用路径 |
| URL | Backend HTTP 入口 | **不能填 loopback**（详见下） |
| API Key | 可选，header `Authorization: Bearer ...` | — |
| 默认 prompt / 默认阈值 | 调用兜底参数 | — |

## URL 校验：拒绝 loopback

v0.9.8 起后端 Pydantic `field_validator` 直接拒绝以下 host：

- `localhost`
- `127.0.0.1` / `127.x.x.x`
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

注册后系统会自动调用 `GET <url>/health`。失败不阻断创建（避免临时网络问题让你卡住），但会在列表里显示红色 `unreachable` 徽章。

## 项目绑定

注册仅是创建可选项。真正生效需要：

1. 项目设置 → 基本信息 → **启用 AI 预标注**（开关）
2. 项目设置 → 基本信息 → **ML 模型** 下拉选刚注册的 backend
3. 保存

未绑定 backend 直接跑预标会报错（v0.9.9 B-8 后给出明确 toast 引导而非空字符串错）。

## 复用其它项目的 Backend（v0.9.7）

新建项目 wizard step 4 提供下拉选其它项目已注册的 backend，平台会**复制**一份到新项目（不是引用）。这样修改互不影响，也避免单项目 backend 删除影响他人。

后端：`GET /admin/ml-integrations/all` 返回全局可见的 backend 列表。

## 删除

仅超管可删除。删除前提示「该 backend 被 N 个项目使用」，确认后级联清理项目绑定（项目侧 ml_backend_id 置 NULL）。

## 审计

v0.9.9 B-5 起，`ml_backend.created` / `ml_backend.updated` / `ml_backend.deleted` 全部进 audit_logs。详见 [审计日志](./audit-logs)。

## 相关

- [ADR 0015 — ML Backend URL 验证](../../dev/adr/0015-ml-backend-url-validation)
- [模型市场](./model-market)
- [ML Backend 协议](../../dev/ml-backend-protocol)
