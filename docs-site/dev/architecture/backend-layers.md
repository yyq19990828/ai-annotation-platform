# 后端分层

## 分层规则

```
HTTP → 路由 (api/v1) → 服务 (services) → 模型 (db/models)
                ↓
              Schemas (pydantic) — 请求/响应边界
```

**单向依赖**：路由可调服务，服务可调模型；反向调用禁止。

## 路由（api/v1）

- 薄壳：解析参数、调权限、调服务、序列化响应
- 不写业务逻辑
- 必须有 docstring（被 OpenAPI 拾取）
- 必须给所有响应码写 `responses={}` 类型

## 服务（services）

- 业务逻辑核心：状态机、规则、跨表事务
- 可调 db 也可调外部 HTTP（结合 httpx）
- 单测主要打这里

## 模型（db/models）

- 仅 SQLAlchemy 模型定义 + 简单的 `@hybrid_property`
- **不**在模型里写业务方法

## Schemas（pydantic）

- 请求模型（`*In`）和响应模型（`*Out`）严格区分
- 不要复用 SQLAlchemy 模型当响应（避免泄露 ORM 字段）
- 嵌套响应优先显式定义，不依赖 Pydantic 推导

> 反例：`ProjectOut.batch_summary: dict` → 改为 `ProjectBatchSummary` 显式模型

## Middleware

- 限流：`slowapi`，按 IP / 用户
- 审计：写 `audit_logs` 表
- 请求 ID：注入 `X-Request-ID` 到日志

## Workers（Celery）

- 任务定义在 `app/workers/`
- broker = Redis；result backend = Redis
- 长任务（导出 / AI 预标注）必走异步
- 短任务（发邮件）也走异步避免阻塞 HTTP

## 测试映射

| 层 | 测试位置 |
|---|---|
| 路由 | `tests/test_<feature>.py` 用 `httpx_client` |
| 服务 | `tests/test_<service>_service.py` 直接调函数 |
| 模型 | 不单独测，由路由 / 服务测试覆盖 |
| Workers | `tests/test_<task>.py`，用 eager mode |
