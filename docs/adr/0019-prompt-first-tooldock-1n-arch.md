# 0019 — ML 工具 UI 的 Prompt-first 重构与 1:N 架构（env 锁 1:1）

- **Status:** Accepted
- **Date:** 2026-05-14（回填，实际决策发生于 v0.10.x 阶段）
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.9.x 时工作台只有 1 个 ML backend（grounded-sam2），SAM 工具栏把 prompt 入口（point / bbox / text）写死在一个组合按钮里。v0.10.0 接入 sam3-backend 后出现两个新现实：

1. 两个后端能力**不是子集关系**：grounded-sam2 有 point，sam3 有 exemplar；
2. 测试环境单机显存有限，**当前阶段不能让两个 backend 同时长驻**一个项目。

如果按"先实现双 backend 并存运行 + AB 路由"的路径走，会同时引入：能力协商 + 运行时路由 + 显存调度 + UI 多选——风险面太大。如果继续 1:1 绑定但 UI 仍按"模型名"组织工具栏，将来加第三个后端就要再重构一次。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A. schema/UI 1:N，运行时 env 锁 1:1** | 一次架构到位；放开 N 只改 env，零代码改动 | 引入一些当下用不上的 UI 形态（配额角标、+ 添加后端 disabled 态） |
| B. schema/API/UI 全部 1:1，未来再 1:N | 当下最简 | 未来加 N 需要全栈重构（API 校验、ProjectSettings 列表、工具栏选择器） |
| C. 直接 1:N 真实并存 | 一步到位 | 显存爆炸；运行时路由、fallback、AB 全部要做，工作量爆炸 |

## Decision

**走方案 A**：

1. **数据模型 / API 已经按 1:N 设计**。`ml_backends.project_id` 非 unique，[apps/api/app/api/v1/ml_backends.py:54-114](../../apps/api/app/api/v1/ml_backends.py) 的 `POST` 接受同 project 多行。
2. **运行时上限由 env 控制**。`MAX_ML_BACKENDS_PER_PROJECT` 默认 1，落地 [apps/api/app/core/config.py](../../apps/api/app/core/config.py)。超限时后端返 `409` + `detail{code:"ML_BACKEND_LIMIT_REACHED", message, limit, current}`。
3. **`GET /projects/{id}`** 透出 `ml_backend_limit`（[apps/api/app/schemas/project.py:76](../../apps/api/app/schemas/project.py)），前端据此渲染禁用状态和文案。
4. **工具栏改 Prompt-first**：v0.10.2 拆 `SamTool` 为四个独立工具（SmartPoint / SmartBox / TextPrompt / Exemplar），通过 `useMLCapabilities.isPromptSupported(type)` 决定置灰。用户的心智是"想怎么交互"，不是"选哪个模型"。
5. **ProjectSettings 渲染 1:N 形态**：表格列出已绑定后端 + 配额角标 + 「注册 backend」按钮；达上限时按钮置灰并 hover 提示，强行触发（或竞态）则弹 `MlBackendLimitModal`（v0.10.3 落地，[MlBackendsSection.tsx](../../apps/web/src/pages/Projects/sections/MlBackendsSection.tsx) / [MlBackendLimitModal.tsx](../../apps/web/src/components/projects/MlBackendLimitModal.tsx)）。
6. **不做**：apps/api 的 prompt-routing 表、AB 对比、自动 fallback、双 backend 真实并存——全部推迟到 v0.11+。

文案约定：LimitModal 优先取服务器 `detail.message`；缺字段时走前端 fallback「当前每个项目最多绑定 N 个 ML 后端」。**文案以服务器为准**。

## Consequences

正向：

- 放开 N 只需把 env 调大；前端零代码改动（按钮自动解禁、配额角标自动更新）。
- 工具栏在不同后端绑定下形态**完全一致**——只是某些工具置灰，新加后端不会重构工具栏。
- Capability 协商（ADR-0020）独立演化：后端只要在 `/setup` 加新 `supported_prompts`，前端工具栏自动 enable。

负向：

- ProjectSettings 当下永远只有 1 行表格，配额角标永远是 `已用 1 / 1`——首次看到的开发者会问"为啥不直接做单 backend UI"。需要在管理员文档（[docs-site/user-guide/for-project-admins/ml-backends.md](../../docs-site/user-guide/for-project-admins/ml-backends.md)）和这份 ADR 解释。
- env 锁绕过（管理员直接改 DB 加行）会让工作台 backend 选择器出现多项。工作台已优雅渲染多项，但路由层尚未实现——属于"已知裸露面"，靠运维纪律和文档约束。

## Notes

- 实现代码：
  - 后端：`apps/api/app/api/v1/ml_backends.py` § create / setup proxy
  - 前端工作台：`apps/web/src/pages/Workbench/state/useMLCapabilities.ts`、四个工具 `apps/web/src/pages/Workbench/tools/*Tool.tsx`
  - 前端设置：`apps/web/src/pages/Projects/sections/MlBackendsSection.tsx`、`apps/web/src/components/projects/MlBackendLimitModal.tsx`
- 相关 ADR：[0020](./0020-ml-backend-capability-negotiation.md)（capability 协商协议）
- 相关 ROADMAP：[`ROADMAP/0.10.x.md`](../../ROADMAP/0.10.x.md) §3.1 / §3.3 / §3.4
- 后续触发条件：v0.11+ 需要双 backend 真实并存时，新建 ADR 描述 routing 层 + fallback 策略。
