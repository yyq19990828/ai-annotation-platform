# 0044 — ML Backend 全局注册表 + 项目级启用（解耦能力声明与项目绑定）

- **Status:** Proposed
- **Date:** 2026-06-25（提案；目标 v0.19.0 落地）
- **Deciders:** core team
- **Supersedes:** —（在 [ADR-0020](./0020-ml-backend-capability-negotiation.md) / [ADR-0036](./0036-ml-backend-capability-protocol-v2-multi-model.md) / [ADR-0037](./0037-protocol-capability-catalog-decoupling.md) 之上做注册模型的加法，不推翻协议）

## Context

当前 `ml_backends` 表是**项目作用域**的（`apps/api/app/db/models/ml_backend.py:15` `project_id` FK）：一个 backend 实例（URL + 能力快照 `health_meta.capabilities`）从属于某个项目。同一个物理 backend（如 grounded-sam2 / yolo）要在 N 个项目里用，就得**注册 N 次**，每次重复存一份 URL + 能力快照。

但「能力」本是 backend **固有**的、与项目无关——这一点平台已经部分承认：

- **能力「展示」其实已经全局化**：`services/capability_instances.py` 的 ModelMarket 数据源是 `_load_registered_instances`（已注册）∪ `_load_env_only_instances`（env 配了 URL 但没注册到任何项目）。所以 env 里配置的 backend **不注册也能在模型市场看到**（实时探测 `/setup`）。
- 但「使用」仍然项目作用域：跑预标、多阶段 DAG 选下游 backend、「≥2 backend 才能加阶段」（[ADR-0043](./0043-staged-preannotation-pipeline.md)）全部读 `ml_backends WHERE project_id = ?`。

由此产生的痛点：

1. **重复注册**：同一 backend 每项目重注一遍，URL / 能力快照 N 份冗余、易漂移（某项目改了 URL 另一项目不知道）。
2. **env-only 是半成品**：env backend 能看不能用——要用还得在项目里手动注册一遍，体验割裂。
3. **多阶段编排门槛**：DAG「检测 → 分类」要求项目里**已注册 ≥2 个 backend**，否则连「加阶段」都不出；用户得先去项目设置重复注册第二个 backend。
4. 能力是 backend 固有属性，却被复制进每个项目的行里——概念上错位。

候选方案：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A. 全局注册表 + 项目级启用** | backend 注册一次（全局），能力快照单份真值；项目层只存「启用 + 覆盖配置」；env-only 升级为一等注册项 | 需迁移现有 per-project 数据；权限模型要分层（谁管全局 vs 谁管项目启用） |
| B. env backend 默认对所有项目可用（opt-out） | 零注册 | 失去显式作用域 / 审计；env 即真值，运维改配置才能增删，不便 UI 管理 |
| C. 维持现状 + 「从其他项目导入 backend」一键复制 | 改动最小 | 仍是多份拷贝、治标不治本；漂移问题不解 |

## Decision

**采方案 A：把 backend 实例从「项目子资源」上提为「全局注册表项」，项目层退化为「启用开关 + 项目级覆盖配置」的关联。**

### 数据模型

新增两张表（命名待定，下为语义）：

- `ml_backend_registry`（全局，superadmin 维护）：`id`、`name`、`url`、`state`、`is_interactive`、`health_meta`（能力快照单份真值）、`source`（`manual` | `env`）。env 配置的 backend 启动时**自动 upsert** 成 `source=env` 的注册项（不再走 `_load_env_only_instances` 临时探测）。
- `project_ml_backend`（项目 × 注册项关联）：`project_id`、`registry_id`、`enabled`、项目级覆盖（`box_threshold` / `text_threshold` / `default_variants` / 可选 `url_override`）。

能力快照 `health_meta.capabilities` **只在全局注册表项上维护一份**，`check_health`（`services/ml_backend.py:121`）改为对注册表项探测、写回全局行；所有项目共享同一份快照。

### 读取路径

- ModelMarket / `capability_instances`：直接读全局注册表（不再区分 registered vs env-only，二者已统一为注册项）。
- 项目内「可用 backend」（预标 / DAG 下游 / `availableParentStages` 的 `backends>=2` 门控）：读 `project_ml_backend WHERE project_id=? AND enabled=true` join 注册表。

### 迁移

现有 `ml_backends` 行：按 `url` 去重 upsert 进 `ml_backend_registry`，每行再生成一条 `project_ml_backend(enabled=true)` 保留项目归属与覆盖配置。指向 `ml_backends.id` 的外键（`project.ml_backend_id`、`prediction.ml_backend_id`，均 `ondelete=SET NULL`，见 `db/models/project.py:44`、`db/models/prediction.py:31,114`）改指向新表或保留 backend 概念 id 的稳定映射——迁移脚本须保证历史 prediction 的 backend 溯源不丢。

### 权限

- 全局注册表的增删改：superadmin（与现有「系统级 ML 集成」管理对齐）。
- 项目级 `enabled` + 覆盖配置：项目 manager（与现状项目设置权限一致）。

## Consequences

正向：

- backend 注册一次即全局可见可用；能力快照单份真值，杜绝跨项目 URL / 能力漂移。
- env-configured backend 升级为一等注册项（自动 upsert），「看得到也用得到」，消除 `_load_env_only_instances` 半成品分支。
- 多阶段 DAG「≥2 backend」门槛大幅降低：项目里勾选启用即可，不必重复注册（直接缓解 [ADR-0043](./0043-staged-preannotation-pipeline.md) / v0.18.16 的注册摩擦）。
- 能力概念归位：固有能力在 backend 层，项目层只表达「用不用 + 怎么调」。

负向：

- 一次性迁移成本：`ml_backends` 拆两表 + 外键重指 + 历史 prediction 溯源保真，需谨慎的 alembic 迁移与回滚预案。
- 权限模型分层带来新的边界用例（全局项被某项目启用后，superadmin 删全局项要级联禁用各项目）。
- `url_override`（项目覆盖全局 URL）若保留会引回「一份 backend 多个真实地址」的复杂度——倾向**不做** url_override，URL 只在全局维护（见 Alternatives）。

## Alternatives Considered（详）

**方案 B（env 默认全可用）**：把 env backend 直接对所有项目开放。否决——失去显式启用/审计，运维只能改 env 文件增删 backend，无法在 UI 管理；与「项目自助选用」诉求相悖。

**方案 C（跨项目导入）**：在现有 per-project 模型上加「从项目 X 复制 backend 到项目 Y」。否决——仍是多份拷贝，漂移问题原样保留，只是少敲几次 URL；治标。

**url_override 子选项**：允许项目覆盖全局 backend URL。倾向不做——它把「全局单份真值」打回「每项目一个地址」，与本 ADR 初衷矛盾；真有多地址需求应注册成两个全局项。

## Notes

- 目标版本：**v0.19.0**，计划详见 [`docs/plans/2026-06-25-v0.19.0-global-ml-backend-registry-draft.md`](../plans/2026-06-25-v0.19.0-global-ml-backend-registry-draft.md)。
- 涉及代码：`apps/api/app/db/models/ml_backend.py`、`services/ml_backend.py`、`services/capability_instances.py`、`api/v1/ml_backends.py` / `ml_capabilities.py`；前端 `apps/web/src/pages/ModelMarket/*`、项目设置 backend 管理、`AIPreAnnotate`（下游 backend 选择 + `backends>=2` 门控）。
- alembic：新增 `ml_backend_registry` + `project_ml_backend`，迁移 + 回填 + 外键重指。
- 相关 ADR：ADR-0020（能力协商）、ADR-0036（协议 v2 多 model）、ADR-0037（catalog 解耦）、ADR-0043（多阶段编排）。
- 触发背景：v0.18.16 多阶段 DAG 编排暴露「同一 backend 每项目重复注册」摩擦 + supported_inputs 补全时发现 ModelMarket 已半全局化（env-only 路径）。
