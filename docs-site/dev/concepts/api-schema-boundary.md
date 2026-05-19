---
audience: [dev]
type: explanation
since: v0.1.0
status: stable
last_reviewed: 2026-05-09
---

# API Schema 边界 (DB ↔ API ↔ 前端)

> v0.9.8 落地, 起源于 v0.9.7 紧急修复 — 后端 ML backend 返回的 LabelStudio
> 标准 shape 与前端 ImageStage 期望的内部 shape 之间多年不一致, 直到首次
> 端到端真实预标才暴露. 本文记录三层边界 + adapter 责任 + 单测黄金样本约定.

## 三层 schema

```
┌────────────────────────────────────────────────────┐
│ DB (PostgreSQL)                                     │
│   predictions.result   = JSONB                      │
│   存的是 LabelStudio 标准 {type, value, score}      │
│   原因: 与导出 / CVAT / Label Studio 互通工具兼容   │
└──────────────────────┬─────────────────────────────┘
                       │ services/prediction.PredictionService
                       │ + to_internal_shape() (v0.9.7 fix)
                       ↓
┌────────────────────────────────────────────────────┐
│ API (FastAPI / Pydantic)                            │
│   PredictionOut.result = list[dict]                 │
│   每个 dict 已转成内部 shape:                        │
│     {type, class_name, geometry, confidence}        │
│   geometry = {type: "bbox", x, y, w, h} | polygon   │
└──────────────────────┬─────────────────────────────┘
                       │ openapi-ts codegen → src/api/generated/types.gen.ts
                       │ + 手写 PredictionShape (TypedDict 泛 unknown)
                       ↓
┌────────────────────────────────────────────────────┐
│ 前端 (apps/web/src/types/index.ts + transforms.ts)  │
│   PredictionShape = { type, class_name, geometry,  │
│                        confidence }                 │
│   predictionsToBoxes() 消费 → AiBox 渲染            │
└────────────────────────────────────────────────────┘
```

## Adapter 在哪里

| 位置 | 职责 |
|---|---|
| `apps/api/app/services/prediction.py:to_internal_shape` | LabelStudio 标准 → 内部 shape (read path 单一适配点) |
| `apps/api/app/api/v1/tasks.py:468-472` | list predictions 端点构建 PredictionOut 时调用 |
| `apps/api/app/services/annotation.py:61-64` | annotation 创建时取 prediction 候选转换 |

写路径 (`PredictionService.create_from_ml_result`) **不动** — 直接存 ML backend 返回的 LabelStudio 原文, 维持 DB 标准。读路径单一吸收适配, 避免双向转换导致的环状依赖。

## OpenAPI codegen

工具: `@hey-api/openapi-ts` (`apps/web/openapi-ts.config.ts`).

```bash
# 1. 后端改 Pydantic schema 后, 刷新 OpenAPI snapshot
cd apps/api && uv run python ../../scripts/export_openapi.py

# 2. 生成 TypeScript types
cd apps/web && pnpm codegen

# 输出: apps/web/src/api/generated/types.gen.ts
```

`pnpm build` 通过 `prebuild` hook (`scripts/codegen-if-changed.mjs`) 仅在 snapshot 比生成产物新时跑 codegen, 加速开发循环。

### v0.9.11 codegen 迁移完成

- ✅ `PredictionJobOut` (新增 v0.9.8 端点) **从 codegen 派生**, 见 `apps/web/src/api/adminPreannotateJobs.ts`
- ✅ `PredictionShape` / `PredictionResponse` **从 codegen 派生** (v0.9.11)
  - 后端: `apps/api/app/schemas/prediction.py` 加 `PredictionShape` Pydantic 模型 (geometry 复用 `_jsonb_types.{Bbox,Polygon}Geometry`); `PredictionOut.result: list[PredictionShape]`
  - 前端: `apps/web/src/types/index.ts` re-export generated 类型, 对 `geometry` 做轻度窄化 (剔除 dict fallback) 兼容 transforms.ts 强类型消费
  - 数据流: DB 仍存 LabelStudio 标准 `{type, value, score}` (导出兼容); 读路径 `to_internal_shape()` 在 `apps/api/app/api/v1/tasks.py` 转换后构造 PredictionOut

## 兼容旧 schema 的最小不变量

`to_internal_shape()` 必须满足:

1. **Idempotent** — 二次调用结果同首次, 防止 read path 多层意外叠加
2. **`geometry` pass-through 优先** — 当输入既含 `geometry` 又含 `value` (迁移期 / 老 fixture) 时, 走内部 shape 不再二次解释
3. **非标字段无损** — 已是内部 shape 时同对象返回 (extra meta 不丢); v0.10.17 `tool_unit_id` 缺失时**就地 mutate 回填**(`s["tool_unit_id"] = derive_tool_unit_from_ls_type(s["type"])`), 保 dict identity 兼容历史 test

这三条在 `apps/api/tests/test_prediction_schema_adapter.py` 末尾 v0.9.8 黄金样本里有 explicit 测试。

## v0.10.17 工具维度 schema (tool_bindings + tool_unit_id)

[ADR-0026](../adr/0026-tool-unit-class-and-attribute-binding) 把项目级扁平 `classes_config` / `attribute_schema` 改为按 `tool_unit_id` 嵌套的 `tool_bindings`。三层 schema 影响:

| 层 | 字段 / 类型 | 备注 |
|---|---|---|
| DB | `projects.tool_bindings JSONB` + `annotations.tool_unit_id String(30)` + `predictions.tool_unit_id String(30)` | alembic 0072 / 0073, 老数据按 `type_key` / `annotation_type` 反推 backfill |
| Pydantic | `_jsonb_types.ToolUnitId` Literal + `ToolBinding` / `ToolClassEntry` / `validate_tool_bindings_keys` 校验器 | `ProjectCreate / Update / Out` + `AnnotationCreate / Out` + `PredictionOut` + `ProjectTemplate*` 全部加字段 |
| codegen (前端) | `ToolBinding` / `ToolClassEntry` 派生; `api/projects.ts` 重导出 + `ToolBindings = Partial<Record<ToolUnitId, ToolBinding>>` 收窄 key | `constants/toolUnits.ts` 与后端 Literal 严格对齐, 5 个枚举值不可漂移 |

**兼容层**: v0.10.17 期间 `app/services/project.py` 的 `apply_tool_bindings_legacy_sync` 双写派生回写 `classes / classes_config / attribute_schema`, 老 reader 仍可读;`coalesce_legacy_into_tool_bindings` 反向把老客户端只传扁平字段反推到对应 unit。v0.10.18 完成所有读端切换后删除派生字段。

**AAP JSON**: `schema_version` 升 `1.1`, envelope `project.tool_bindings` 整段嵌入, annotations / predictions 数组每条加 `tool_unit_id`;1.0 reader 走 `extra="ignore"` 仍兼容。

## 何时跑 codegen

| 场景 | 动作 |
|---|---|
| 后端加新端点 / 改 Pydantic schema | `uv run python scripts/export_openapi.py` → `pnpm codegen` |
| 切分支 (snapshot 可能改了) | `pnpm install` 后第一次 build 自动跑 (prebuild hook) |
| CI | 走 `prebuild` 自动逻辑; 显式 drift 检测可加 `python scripts/export_openapi.py --check` |
| 强制重生 | 删 `apps/web/src/api/generated/` → `pnpm codegen` |

## 故障注入: 何时打破契约

如果 ML backend 突然返回新格式 (例如 v0.10.x SAM3 新增 mask 编码), 落到 read path 的 `to_internal_shape` 会直接 pass-through 未识别 `type`, geometry 退化为 `{}`. 前端 `predictionsToBoxes` 不会渲染 — 静默丢框. 监控建议:

- Sentry: 前端 `predictionsToBoxes` empty box 比例 > 阈值告警
- 后端: 新 unknown `type` 命中时打 WARN 日志 (含 ml_backend_id), `app.log_metrics.unknown_prediction_type_total` counter
