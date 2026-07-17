---
audience: [dev]
type: explanation
since: v0.1.0
status: stable
last_reviewed: 2026-07-17
---

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

规模较大的业务不再堆在 `services/` 根目录的单个平铺文件中，而是放入领域 package：

```text
services/
├── gpu_arbitration/  # 契约、策略和 Redis ledger
├── video_tracking/   # adapter、job 与 runner
├── exporting/       # 导出服务、打包和格式实现
└── data_management/  # schema、查询 primitive 和高层服务
```

领域内依赖保持单向：稳定契约和 primitive 不反向导入高层 orchestration，package `__init__.py` 不为了使用便利而 eager-import 整个高层图。服务不得反向导入 `app.api` 或 `app.workers`；需要派发 Celery 任务时使用稳定注册名，或由路由层调用 worker 边界。

已完成迁移的 Redis ledger、Video、Export 与 Data Manager 旧平铺路径是纯兼容 facade，只保留模块说明、显式 re-export 和 `__all__`。GPU orchestration 的平铺模块仍处于过渡态并承载实现；新生产代码必须直接导入已经落地的领域模块，不得经由纯 facade 回流。

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

领域结构额外由 `tests/test_domain_package_architecture.py` 检查依赖方向、相对导入、package root 和模块环；`tests/test_compat_facades.py` 对每个兼容 facade 的全部公开符号执行 identity 与冷导入验证。
