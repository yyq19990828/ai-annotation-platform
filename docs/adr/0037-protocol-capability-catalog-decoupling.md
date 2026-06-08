# 0037 — 协议能力目录与 backend 注册解耦

- **Status:** Accepted
- **Date:** 2026-06-08
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.14.9 落地能力声明协议 v2（[ADR-0036](0036-ml-backend-capability-protocol-v2-multi-model.md)）后，前端 `/model-market?tab=catalog` 把「能力目录」做成「按 model 条目展开的卡片」。但数据链路是：

```
admin/ml-integrations/overview  →  枚举已注册 backend
        ↓ 对每个 backend
projects/{pid}/ml-backends/{bid}/capabilities
        ↓ 后端读 ml_backends.health_meta["capabilities"]
渲染 model 卡
```

即「能力目录」的可见性 100% 依赖「至少一个 backend 注册并通过 health check」。零接入状态下，`/model-market?tab=catalog` 是一个空表格，没有任何关于「平台支持什么能力」的信息——产品语义与实际心智错位。

协议层面其实已有静态来源：`apps/api/app/services/ml_capabilities.py` 写死了 `INFRA_VALUES / TASK_VALUES / GEOMETRY_VALUES` 等受控词表。但这些只用作「校验入参 / 合成隐式单 model」的内部逻辑，没有作为产品资源对外暴露。

候选方案对比：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A. 后端 SSOT + 端点** | OpenAPI / SDK / docs site 共用；i18n 集中维护 | 多一次网络调用（5min staleTime 缓解） |
| B. 前端常量 | 实现快 | 与协议文档易漂移；多前端 / SDK 复用差 |
| C. 从 OpenAPI 自动派生 | 完全无双份维护 | label / summary / suggested_backends 这类产品文案不适合 schema |

## Decision

选 A。新增 `apps/api/app/services/capability_registry.py` 作为 SSOT，集中维护 4 张受控词表（task / infra / modality / geometry）+ 每条 task 的人类可读元数据（label / summary / protocol_notes / typical_models / suggested_backends）。

**端点**：

```
GET /api/v1/ml-capabilities/protocol
```

- 登录用户即可访问（不限 super_admin，与 `/model-market` 页面同权限）；
- 进程内冻结 payload + ETag，`Cache-Control: private, max-age=300`，支持 304；
- 响应版本号 `version: "v2"` 与 ml-backend-protocol 协议版本对齐；受控词表不兼容变更才 bump（新增 task 不算）。

**前端**：`CapabilityCatalogPanel` 默认 `groupBy=task`，遍历 protocol.tasks 渲染 9 张协议卡；已注册 model 按 `model.task` 字段挂载。空协议卡显示「暂无接入」徽标 + 「典型模型」+ 推荐 backend 列表 + 「去注册」CTA（跳 `?tab=registry`）。零接入时顶部加 `EmptyCatalogBanner` 横幅。

**`ml_capabilities.py` 退化为薄壳**：原 `INFRA_VALUES / TASK_VALUES / GEOMETRY_VALUES / _TASK_DEFAULT_GEOMETRY` 改为 re-export `capability_registry` 的派生值，`extract_capabilities` / `derive_modalities` 函数签名与行为零变化。

## Consequences

正向：

- 「能力目录」与 backend 注册解耦，零接入用户也能完整看到平台支持的 9 类 AI 标注能力。
- 协议元数据集中到 `capability_registry.py` 单一真源，扩 task / infra 时只改一处；同时被内部 `extract_capabilities` 和对外端点消费。
- 推荐 backend 列表（PaddleOCR / X-AnyLabeling / Grounded-SAM-2 等）作为产品资源固化在协议层，与 `docs/research/01-04` 调研结论对齐；onboarding 不依赖运营后台编辑。
- 协议层 / 实例层职责清晰：`/v1/ml-capabilities/protocol` 答「平台支持什么」，`/projects/{pid}/ml-backends/{bid}/capabilities` 答「该 backend 暴露什么」。

负向：

- 多了一个无 project 作用域的端点，OpenAPI 中间件 / 鉴权矩阵需要把它正确归类（已加单测覆盖）。
- 推荐 backend 列表每次更新要发版（接受，频率 < 季度一次；运营后台编辑议题留待 v0.14.13+）。
- 前端 `groupBy` 默认值从 `backend` 切到 `task`，对重度用户有轻微心智迁移成本（CHANGELOG 显式说明，下拉 label 标注「默认」）。

## Alternatives Considered（详）

**方案 B（前端常量）**：实现最快，但 i18n 文案、推荐 backend 列表会和后端协议文档漂移；未来若有移动端 / SDK 也要消费同一份目录，复用极差。

**方案 C（从 OpenAPI 自动派生）**：task / infra 已经是 OpenAPI enum，确实可以自动产 ID 列表。但 label / summary / suggested_backends / protocol_notes 这类是「产品文案 + 调研结论」，硬塞 schema description 会让 schema 变臃肿且不利于多语言；分两份维护反而更糟。

## Notes

- 实现代码位置：
  - `apps/api/app/services/capability_registry.py`（SSOT，协议层元数据）
  - `apps/api/app/services/capability_instances.py`（实例层合并：env-only + registered）
  - `apps/api/app/api/v1/ml_capabilities.py`（`/protocol` + `/instances` 双端点）
  - `apps/api/app/schemas/ml_capabilities.py`（响应 schema）
  - `apps/web/src/api/mlCapabilities.ts`（前端 API + hooks）
  - `apps/web/src/pages/ModelMarket/ProtocolCapabilityCard.tsx`
  - `apps/web/src/pages/ModelMarket/EmptyCatalogBanner.tsx`
  - `apps/web/src/pages/ModelMarket/CapabilityCatalogPanel.tsx`（双层视图改造）
- 单测：`apps/api/tests/test_capability_registry.py`、`test_ml_capabilities_protocol.py`、`test_capability_instances.py`；`apps/web/src/pages/ModelMarket/{ProtocolCapabilityCard,CapabilityCatalogPanel}.test.tsx`

### 实例层补丁（同版本，回应「能力目录还是和注册耦合」反馈）

初版 v0.14.11 把协议层解耦（9 张协议卡常驻可见），但每张卡内的「实际可用 model」仍依赖 `admin/ml-integrations/overview`（super_admin only）+ 每个已注册 backend 的 `/capabilities`。结果普通登录用户看到的协议卡全是「暂无接入」——即使 docker-compose 已经把 gsam2 / sam3 跑起来了。

补丁方案：

- 新增 `GET /v1/ml-capabilities/instances`（登录用户可访问），合并 env-only 容器（`settings.ml_backend_observe_urls` 探测 `/setup`）+ 项目级注册 backend（`health_meta.capabilities` 快照）。URL 去重避免重复展示。
- 字段裁剪：只暴露 `source / name / infra / models[]` 的能力相关字段，**不返回 url / gpu_info / cache / pool / extra_params**，避免普通用户看到运维敏感信息。
- 前端协议卡视图改为消费 instances（不再 enumerate admin overview）；每个 model 子卡显示来源徽标（「自带」/「已注册」）。横幅触发条件从「0 backend 注册」改为「所有协议卡都没有 model 挂载」。
- 相关 ADR：[ADR-0036](0036-ml-backend-capability-protocol-v2-multi-model.md)
- 后续可能演进：
  - i18n（en-US label / summary）—— 当前仅中文，v0.14.12 候选。
  - 「按能力一键创建项目模板」—— 从协议卡直接初始化项目 + 标签体系，v0.15.x 候选。
  - HealthMeta 字段元数据登记表（注册表单 / 运行时观测面板的同类「schema 驱动 UI」议题）—— v0.14.12 草稿见 `docs/plans/2026-06-08-v0.14.12-health-field-registry-draft.md`。
