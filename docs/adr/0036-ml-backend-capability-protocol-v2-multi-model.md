# 0036 — ML Backend 能力声明协议 v2（多模型目录 + infra）

- **Status:** Accepted
- **Date:** 2026-06-07
- **Deciders:** core team
- **Supersedes:** —（在 [ADR-0020](./0020-ml-backend-capability-negotiation.md) 之上做向后兼容扩展，不推翻）

## Context

[ADR-0020](./0020-ml-backend-capability-negotiation.md) 定义的 `/setup` 是**单模型快照**：顶层 `supported_prompts` / `supported_text_outputs` / `supported_geometric_outputs` / `supported_variants` / `params` 描述「这一个 backend 能做什么」。它隐含一个前提——**1 个 backend ≈ 1 个模型族**（grounded-sam2 / sam3 各占一个 backend）。

但下一阶段要补两类 **1 个 backend = N 个 model** 的 backend，单模型快照表达不了：

- **ONNX 聚合 backend**：一个进程聚合多个异构模型（检测 / 关键点 / OCR / 抠图…），各带不同能力（不同 task、不同输出几何、不同输出属性）。
- **YOLO 官仓 backend**（基于 ultralytics）：一个仓覆盖 `系列(v8/v11/v12) × 任务(det/seg/pose/obb/cls) × 尺寸(n/s/m/l/x)`，上百个权重。

同时缺一个 backend 级元数据 `infra`（pytorch / onnx / paddle / …），无法在目录里告诉用户「这条模型跑在什么运行时」，也不便排障溯源（同模型 pytorch vs onnx 数值微差）。

X-AnyLabeling 的启发不是「再做一个 SAM」，而是它把 OCR、doc layout、pose、OBB、tracker、depth 放进一个**模型能力目录**。平台需要同类目录，但不照搬桌面端本地下载和 Qt 推理——目录只声明「远端 backend 能做什么」，不托管权重。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A. 协议 v2：顶层加 `infra` + `models[]`，能力下沉到 model 粒度** | 一份 `/setup` 表达 N 个 model；老 backend 零改动（合成隐式单 model）；复用现有字段名 | `extract_capabilities` / `derive_modalities` 要改成遍历 model；目录视图要按 model 渲染 |
| B. 每个模型族各起一个独立 backend 进程 | 协议不动 | YOLO 上百权重要拆几十个进程；ONNX 聚合的初衷就是单进程多模型，被打散 |
| C. 平台侧维护一张 backend → 模型能力映射表 | backend 不用改 | 每加一个后端就改平台，违背「backend 自描述」初衷（同 ADR-0020 否决方案 C） |

## Decision

**升级到能力声明协议 v2：`/setup` 顶层新增 `infra` + `models[]`，把能力声明、目录、校验全部下沉到 model 粒度。** 完整协议见 [ml-backend-protocol.md §4.1](../../docs-site/dev/reference/ml-backend-protocol.md)。

关键约束：

1. **结构**：`/setup` 顶层加 `infra`（backend 默认运行时）+ `models[]`（model 条目数组）。每个 model 条目带 `id` / `display_name` / `task` / `model_family` / `infra` / `is_interactive` / `supported_prompts` / `supported_geometric_outputs` / `output_attribute_types` / `supported_text_outputs` / `supported_trackers` / `supported_variants` / `default_thresholds` / `resource_profile` / `params`。
2. **`task` 是条目边界与项目兼容性校验的主轴**，受控词表：`detection` / `obb` / `segmentation` / `keypoint` / `classification` / `ocr` / `doc_layout` / `tracker` / `interactive_seg`。`model_family` 仅作 UI 展示分组，不参与校验。
3. **复用 > 新造**：几何输出复用现有 `supported_geometric_outputs`（`bbox` / `rotated_bbox` / `polygon` / `polyline` / `keypoint` / `none`），系列/尺寸复用现有 `supported_variants` 多轴结构。**不**引入并行词汇（纠正原规划草案的 `output_geometry_types`）。
4. **`infra` 受控枚举**：`pytorch` / `onnx` / `paddle` / `tensorrt` / `openvino` / `other`。backend 顶层声明默认值，model 条目可覆盖。`infra` 是**纯元数据**——不改 `/predict` 协议、不影响 result schema、不参与硬校验，仅 UI badge + 排障溯源（+ Phase 2 调度路由提示）。
5. **向后兼容是硬约束**：无 `models[]` ⇒ 顶层字段合成 1 个隐式 model（`id="default"`，`task` 由 `supported_trackers`→`tracker`、`supported_prompts` 含 point/bbox/text/exemplar→`interactive_seg`、否则 `detection` 推断），`infra` 缺省 = `unknown`。grounded-sam2 / sam3 / echo 零改动继续工作。
6. **存储延迟建表**：能力快照首版写现有 `ml_backends.health_meta["capabilities"]`（JSONB，零迁移），保留顶层「扁平并集」字段（所有 model 的 prompts/geometry 去重合并）让现有消费方零回归。独立表 `ml_model_capabilities` 列为 Phase 2，触发条件 = `MAX_ML_BACKENDS_PER_PROJECT > 1` 或需要跨 backend 模型检索。
7. **不动 predict**：`infra` / `models[]` 只影响能力声明与目录展示，`/predict` 请求/响应 schema 不变，不新增 prediction 表结构。OCR / doc_layout 走统一 adapter（`ocr_text`→`attributes.text`、`layout_type`→`class_name`、`orientation`→`attributes.orientation`）。

新增平台派生视图端点（派生自 health_meta，复用现有 `/setup` 30s TTL 缓存链路）：

```text
GET  /projects/{pid}/ml-backends/{bid}/capabilities          # 返回 models[] 目录(含 infra/task/variants)
POST /projects/{pid}/ml-backends/{bid}/capabilities/refresh  # 强制重探 /setup 并刷新缓存
```

OCR / Doc Layout 作为协议 v2 的**首发模型族验证实例**挂到协议之下（`task: "ocr"` / `task: "doc_layout"`），不为它们单独扩协议或扩表。

## Consequences

正向：

- 一个 backend 暴露 N 个 model，YOLO 官仓（≤ ~6 个 task 条目 + series/size 作 variant）/ ONNX 聚合（多家族多任务）有了协议表达，避免上百条扁平条目。
- det/seg/pose/obb 的输出几何恰好命中现有 4 种 result type（`rectanglelabels` / `polygonlabels` / `keypointlabels` / `rectanglelabels+rotation`），**YOLO backend 的 `/predict` 输出零 adapter**，直接落现有渲染链路。
- 老 backend（grounded-sam2 / sam3 / echo）零改动——落「隐式单 model」路径，配合保留的顶层「扁平并集」字段，现有 `useMLCapabilities` / 绑定校验零回归。
- `infra` badge 让用户一眼知运行时；OCR / doc_layout 首发挂到协议 v2 而非各自扩协议。

负向：

- `extract_capabilities` / `derive_modalities`（`services/ml_capabilities.py`）从「抽单层快照」改为「遍历 `models[]` 派生 + backend 汇总」，需用真实老 backend `/setup` 回放测试防止「隐式单 model」合成漏信号。
- 首版走 `health_meta` JSONB ⇒ 跨 backend 按 task/infra 聚合查询要 JSONB 展开，不便；真要做「模型市场全局检索」得等 Phase 2 独立表。
- 目录是能力快照的派生缓存，与真实 backend 可能漂移，必须带 `last_seen_at` 并在 UI 标 stale；`infra` 是 backend 声明值，不是平台探测保证。
- `output_attribute_types` 含 `text` 但项目 schema 未配置 text attribute 时，OCR 文本无落点——前端须提示而非静默丢文本。

## Alternatives Considered（详）

**方案 B（每个模型族各起独立 backend 进程）**：否决理由——YOLO 官仓上百权重要拆成几十个进程，运维成本爆炸；ONNX 聚合 backend 的核心价值就是单进程聚合多模型共享运行时，拆开等于取消这个 backend 形态。协议层无法表达「一个进程多 model」就堵死了这两类企划。

**方案 C（平台侧维护 backend → 模型能力映射表）**：否决理由——每加一个后端就要改平台代码，违背 ADR-0019 / ADR-0020 「放开 N 不改前端、backend 自描述」的根本目标，与 ADR-0020 否决方案 C 同源。

> 区别于 *Context* 对比表：这里写论证过程，对比表只是要点。

## Notes

- 协议文档：[docs-site/dev/reference/ml-backend-protocol.md §4.1 能力声明协议 v2](../../docs-site/dev/reference/ml-backend-protocol.md)
- 规划来源：`docs/plans/2026-06-07-v0.14.9-model-capability-catalog-and-ocr-doclayout.md`
- 实现位置：派生 `apps/api/app/services/ml_capabilities.py`（`extract_capabilities` / `derive_modalities`）；存储 `ml_backends.health_meta["capabilities"]`；代理 / 目录端点 `apps/api/app/api/v1/ml_backends.py`
- 相关 ADR：[0019](./0019-prompt-first-tooldock-1n-arch.md)（prompt-first 1:n）、[0020](./0020-ml-backend-capability-negotiation.md)（capability 协商 v1）、[0026](./0026-tool-unit-class-and-attribute-binding.md)（tool_unit 绑定，兼容性校验主轴）
- 后续演进 / 触发条件：独立表 `ml_model_capabilities`（配额放开 / 全局模型检索）；全局聚合端点 `GET /ml-backends/capabilities`；YOLO 官仓 / ONNX 聚合 backend 本体实现（协议 v2 的消费者，地基稳定后单独排期）。
