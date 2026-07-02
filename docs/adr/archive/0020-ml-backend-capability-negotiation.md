# 0020 — ML Backend Capability 协商协议（GET /setup JSON Schema 契约）

- **Status:** Accepted
- **Date:** 2026-05-14（回填，实际决策发生于 v0.10.1 落地）
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.9.x 时 ML Backend 协议中的 `GET /setup` 返回的是松散 dict，前端**没有消费**它。导致两个具体问题：

1. 项目挂 sam3-backend，用户在工作台点 Smart Point → 前端不知道 sam3 不支持 `point`，照常发请求 → 后端 400。
2. 不同后端的可调参数（box_threshold / text_threshold / sam_variant）形态不同，但前端硬编码了一套阈值面板。

v0.10.x 要在工具栏按"prompt 范式"组织 4 个独立工具（ADR-0019），前端必须能在工具激活前知道：

- 当前 backend 支持哪些 prompt（决定哪些工具置灰）
- 当前 backend 暴露哪些参数（决定 AIToolDrawer 渲染什么 form 字段）

## Decision

**用 JSON Schema (Draft-07 子集) 作为 `/setup` 的自描述协议**，前端把 `params` 直接喂给 schema-form 渲染。

最小契约（[apps/api/app/schemas/ml_backend.py / docs-site/dev/reference/ml-backend-protocol.md §4](../../docs-site/dev/reference/ml-backend-protocol.md)）：

```json
{
  "name": "sam3-backend",
  "version": "0.10.0",
  "model_version": "sam3.1",
  "supported_prompts": ["bbox", "text", "exemplar"],
  "supported_text_outputs": ["box", "mask", "both"],
  "params": {
    "type": "object",
    "properties": {
      "box_threshold":  { "type": "number", "minimum": 0, "maximum": 1, "default": 0.25, "title": "Box 置信度阈值" },
      "text_threshold": { "type": "number", "minimum": 0, "maximum": 1, "default": 0.20, "title": "Text 置信度阈值" },
      "sam_variant":    { "type": "string", "enum": ["base", "large"], "default": "base" }
    }
  }
}
```

约定：

1. **必填字段**：`name`、`supported_prompts`（其余可选）。`supported_prompts` 缺失时前端兜底为 `["point","bbox","text"]` 并 `console.warn`（向下兼容 v0.9.x 老镜像）。
2. **支持的 prompt 字面量**：`point` / `bbox` / `text` / `exemplar`。新增 prompt 类型需要前后端同步加。
3. **`params` 限制为 Draft-07 子集**：仅支持 `number`/`integer`（带 `minimum`/`maximum`/`default`/`title`）、`boolean`、`string`（`enum` 或自由文本）。**不支持** `array`/`object`/`oneOf`/`$ref`。理由：自研 ~200 行 schema-form 覆盖这五种已够用，加 array/object 就要引入 `@rjsf/core`（50KB gzipped），权衡后选择保持小。
4. **代理端点**：前端不直接打 backend `/setup`（CORS + 鉴权），由 apps/api 提供 `GET /projects/{id}/ml-backends/{bid}/setup`（[apps/api/app/api/v1/ml_backends.py § setup proxy](../../apps/api/app/api/v1/ml_backends.py)），30s TTL 进程内缓存，backend update/delete 时 invalidate。
5. **前端唯一消费点**：`apps/web/src/pages/Workbench/state/useMLCapabilities.ts`，对外暴露 `prompts` / `paramsSchema` / `isPromptSupported(type)` / `isLoading` / `isError`。其它组件（如 ProjectSettings 的能力列）独立调 `mlBackendsApi.setup` 而不复用此 hook——语义不同，那里假设单一绑定，这里枚举多个。

## Consequences

正向：

- 工作台工具栏置灰逻辑**完全声明式**：后端 `/setup` 说支持就支持，不再硬编码 `if (modelName === "sam3")`。
- 后端新增可调参数零前端改动：只要在 `/setup.params.properties` 加一条 JSON Schema 描述，AIToolDrawer 自动渲染。
- ADR-0019 的 Prompt-first 重构有了硬协议支撑。

负向：

- `/setup` 是破坏式升级——v0.9.x 老 backend 镜像必须升到 v0.10.1+ 才能挂到 v0.10.x 平台。已在 [CHANGELOG 0.10.1](../../CHANGELOG.md) 标注。
- 自研 schema-form 不支持 nested object/array。后端不能在 `params` 里塞复杂结构。如果未来真的需要（比如 ROI 列表参数），要么扩 schema-form，要么换 `@rjsf/core`，需要新 ADR 决策。
- `/setup` 代理端点的 30s 缓存意味着 backend 升级 model_version 后前端最多滞后 30s 才看到新能力。当前可接受。

## Alternatives Considered（详）

**方案 B：用 GraphQL / OpenAPI 子集描述能力**。否决理由：引入 schema 处理库，复杂度远高于"JSON Schema + 自研 200 行 form"。当前 5 类参数完全够用。

**方案 C：硬编码 backend 能力表（前端维护一个 `KNOWN_BACKENDS` map）**。否决理由：每加一个后端就要改前端，违背"backend 自描述"的初衷；ADR-0019 的"放开 N 不改前端"目标无法实现。

## Notes

- 实现代码：
  - 后端 `/setup` schema：`apps/sam3-backend/main.py`、`apps/grounded-sam2-backend/main.py`
  - 代理 + 缓存：`apps/api/app/api/v1/ml_backends.py` § setup proxy + `_setup_cache`
  - 前端 hook：`apps/web/src/pages/Workbench/state/useMLCapabilities.ts`
  - 前端 schema-form：`apps/web/src/pages/Workbench/components/SchemaForm.tsx`
- 协议文档：[docs-site/dev/reference/ml-backend-protocol.md §4 GET /setup](../../docs-site/dev/reference/ml-backend-protocol.md)
- 相关 ADR：[0019](./0019-prompt-first-tooldock-1n-arch.md)
- 后续演进：若 `params` 需要 nested object / array，新建 ADR 决定升级到 `@rjsf/core` 还是扩自研 SchemaForm。
