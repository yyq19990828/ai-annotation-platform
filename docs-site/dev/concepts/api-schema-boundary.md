---
audience: [dev]
type: explanation
since: v0.1.0
status: stable
last_reviewed: 2026-07-13
---

# API Schema 边界 (DB ↔ API ↔ 前端)

后端 ML backend 返回的是 Label Studio 标准 shape，前端工作台消费的是平台内部 shape。本文记录三层边界、adapter 责任和单测黄金样本约定。

<!-- history: this page originally documented the v0.9 adapter fix; visible guidance now focuses on the current schema contract. -->

## 三层 schema

```
┌────────────────────────────────────────────────────┐
│ DB (PostgreSQL)                                     │
│   predictions.result   = JSONB                      │
│   存的是 LabelStudio 标准 {type, value, score}      │
│   原因: 与导出 / CVAT / Label Studio 互通工具兼容   │
└──────────────────────┬─────────────────────────────┘
                       │ services/prediction.PredictionService
                       │ + to_internal_shape()
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
| `apps/api/app/api/v1/tasks/predictions.py:get_predictions` | list predictions 端点构建 PredictionOut 时调用 |
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

## Capability Registry Codegen

ML 能力目录还有一条独立的受控词表链路：`apps/api/app/services/capability_registry.py` 是 task / infra / modality / geometry / prompt 的单源真值，`GET /ml-capabilities/protocol` 和前端能力目录都消费它。

```bash
# 1. 后端受控词表或响应 schema 变化后，刷新 snapshot
cd apps/api && uv run python ../../scripts/export_capability_registry.py

# 2. 生成前端常量与普通 API types
cd ../.. && pnpm codegen
```

输出：

- `apps/api/capability-registry.snapshot.json`：版本化契约，必须提交。
- `apps/web/src/api/generated/capabilityVocab.gen.ts`：由 `apps/web/scripts/gen-capability-vocab.mjs` 从 snapshot 生成，构建时自动刷新。

pre-commit 会在 capability registry、schema 或 API 序列化文件变更时自动重导 snapshot；CI 的 `export_capability_registry.py --check` 负责发现未提交的漂移。

### 当前 codegen 覆盖

- ✅ `AsyncJobOut` **从 codegen 派生**，见 `apps/web/src/api/asyncJobs.ts`
- ✅ `PredictionShape` / `PredictionResponse` **从 codegen 派生**
  - 后端: `apps/api/app/schemas/prediction.py` 加 `PredictionShape` Pydantic 模型 (geometry 复用 `_jsonb_types.{Bbox,Polygon}Geometry`); `PredictionOut.result: list[PredictionShape]`
  - 前端: `apps/web/src/types/index.ts` re-export generated 类型, 对 `geometry` 做轻度窄化 (剔除 dict fallback) 兼容 transforms.ts 强类型消费
  - 数据流: DB 仍存 LabelStudio 标准 `{type, value, score}` (导出兼容); 读路径 `to_internal_shape()` 在 `apps/api/app/api/v1/tasks/predictions.py` 转换后构造 PredictionOut

## 兼容旧 schema 的最小不变量

`to_internal_shape()` 必须满足:

1. **Idempotent** — 二次调用结果同首次, 防止 read path 多层意外叠加
2. **`geometry` pass-through 优先** — 当输入既含 `geometry` 又含 `value` (迁移期 / 老 fixture) 时, 走内部 shape 不再二次解释
3. **非标字段无损** — 已是内部 shape 时同对象返回 (extra meta 不丢); `tool_unit_id` 缺失时**就地 mutate 回填**(`s["tool_unit_id"] = derive_tool_unit_from_ls_type(s["type"])`), 保 dict identity 兼容历史 test

这三条在 `apps/api/tests/test_prediction_schema_adapter.py` 的黄金样本里有 explicit 测试。

## 工具维度 schema（tool_bindings + tool_unit_id）

[ADR-0026](../adr/archive/0026-tool-unit-class-and-attribute-binding) 把项目级扁平 `classes_config` / `attribute_schema` 改为按 `tool_unit_id` 嵌套的 `tool_bindings`。三层 schema 影响:

| 层 | 字段 / 类型 | 备注 |
|---|---|---|
| DB | `projects.tool_bindings JSONB` + `annotations.tool_unit_id String(30)` + `predictions.tool_unit_id String(30)` | 老数据按 `type_key` / `annotation_type` 反推 backfill |
| Pydantic | `_jsonb_types.ToolUnitId` Literal + `ToolBinding` / `ToolClassEntry` / `validate_tool_bindings_keys` 校验器 | `ProjectCreate / Update / Out` + `AnnotationCreate / Out` + `PredictionOut` + `ProjectTemplate*` 全部加字段 |
| codegen (前端) | `ToolBinding` / `ToolClassEntry` 派生; `api/projects.ts` 重导出 + `ToolBindings = Partial<Record<ToolUnitId, ToolBinding>>` 收窄 key | `constants/toolUnits.ts` 与后端 Literal 严格对齐；`ai_interactive` 退役后只保留真实几何单位，枚举不可漂移 |

**单源真值**：`projects` / `project_templates` 的旧扁平列 `classes` / `classes_config` / `attribute_schema` 已删除，`tool_bindings` 是唯一存储真值。`ProjectOut` / `ProjectTemplateOut` 仍暴露三个扁平字段（API 契约不变），但由 `model_validator` 用 `derive_*` 从 `tool_bindings` **读时派生**（响应序列化 / COCO·YOLO·AAP 导出共用）。输入侧 `coalesce_legacy_into_tool_bindings` 保留，把旧客户端 / 旧 AAP JSON 1.0 的扁平字段反推到对应 unit。

**AAP JSON**：当前 schema 1.3 包含 `project.tool_bindings`、媒体块与 portable `mask_objects`。`video_track_mask` geometry 保留 `coco_rle_ref`，envelope 以 SHA-256 为键携带实际 RLE；导入先校验引用与对象一致性，再写不可变对象并创建 annotation。旧 envelope 仍按宽松 reader 兼容。

## Raster mask 引用边界

`video_track_mask` 不把 `counts[]` 内联到 annotation JSONB。Pydantic `CocoRleMaskRef` 负责引用字段强校验，任务上下文 validator 再校验视频媒体类型、尺寸和帧范围。真实 RLE 以 canonical JSON 写入对象存储，key 由 SHA-256 派生；读取必须重新计算 digest、bytes、runs 与 size，任何不一致都拒绝。

前端手写 `Geometry` union 与后端 `_jsonb_types.Geometry` 同步包含 `VideoTrackMaskGeometry`。OpenAPI 覆盖上传 / 读取端点与 tracker request；geometry JSONB union 仍需要专门的跨语言 fixture 测试，不能只依赖路由 codegen。

## 何时跑 codegen

| 场景 | 动作 |
|---|---|
| 后端加新端点 / 改 Pydantic schema | `uv run python scripts/export_openapi.py` → `pnpm codegen` |
| 切分支 (snapshot 可能改了) | `pnpm install` 后第一次 build 自动跑 (prebuild hook) |
| CI | 走 `prebuild` 自动逻辑; 显式 drift 检测可加 `python scripts/export_openapi.py --check` |
| 强制重生 | 删 `apps/web/src/api/generated/` → `pnpm codegen` |

## 故障注入: 何时打破契约

如果 ML backend 突然返回新格式（例如 SAM 3 的新 mask 编码），落到 read path 的 `to_internal_shape` 会直接 pass-through 未识别 `type`, geometry 退化为 `{}`。前端 `predictionsToBoxes` 不会渲染 — 静默丢框。监控建议:

- Sentry: 前端 `predictionsToBoxes` empty box 比例 > 阈值告警
- 后端: 新 unknown `type` 命中时打 WARN 日志 (含 ml_backend_id), `app.log_metrics.unknown_prediction_type_total` counter
