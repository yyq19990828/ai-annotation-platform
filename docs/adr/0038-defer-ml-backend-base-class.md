# 0038 — ML backend 基类抽象推迟到 N≥4

- **Status:** Accepted
- **Date:** 2026-06-08
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.14.12 接入第三个 ML backend（`apps/yolo-backend/`，ultralytics 多任务多系列），与既有 `apps/sam3-backend/` + `apps/grounded-sam2-backend/` 加起来共 **3 个生产 backend**。

社区参考实现 [`HumanSignal/label-studio-ml-backend`](https://github.com/HumanSignal/label-studio-ml-backend) 提供了 `LabelStudioMLBase` 基类，封装 HTTP 层 + 序列化 + 训练任务 + 回调；接入者只需 subclass 实现 `predict()` / `fit()`。看起来很美，问题是：他们这套抽象是在维护 10+ 个 example backend 之后才稳定下来的，且至今仍有"绕不开框架做特殊事"的痛点（详见 `docs/research/01-label-studio.md` §abstraction-cost）。

本平台 3 个 backend 之间形态差异巨大：

| backend | 交互式 | model pool | embedding cache | video pool | 编译扩展 | 标签集 |
|---|---|---|---|---|---|---|
| sam3-backend         | ✅ | – | ✅ | – | – | 开放词汇 |
| grounded-sam2-backend | ✅ | ✅ | – | ✅ | GroundingDINO CUDA | 开放词汇 |
| yolo-backend (v0.14.12) | – | ✅ | – | – | – | 闭集（COCO/DOTA） |

共性约 30%（FastAPI 端点形态 + Pydantic 请求/响应 schema），剩 70% 是各自 predictor 生命周期 / 显存策略 / 模型加载方式。在 N=3 时拍 base class，等于在样本不足时锁死接口；每接入第 4 个就发现要破抽象重新设计，反复打补丁的代价比手写更高。

候选方案：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A. 仅抽 schemas + vocab 常量** | 共享面真实（3 个 backend 一字不差），改动小，可逆 | 不解决 /setup dict 字面量在三处重复 |
| B. 同时抽 `MLBackendBase` 基类 | 一次到位，未来 backend 接入门槛低 | N=3 信息不足；锁死接口后改回的成本高；CLAUDE.md §2 显式反对 |
| C. 全 SDK 框架（学 LabelStudio） | 对外开发者友好 | 与 v0.15.2 `ML Backend Starter` 计划重复，且模板代码比基类更适合该场景 |

## Decision

**v0.14.12 仅落地方案 A**：抽 `apps/_shared/protocol_v2/` 共享包，**只包含**：

- `aap_protocol_v2.schemas`：`TaskItem` / `PredictionResult` / `BatchPredictResponse` 三个跨 backend 一字不差的 Pydantic 模型。
- `aap_protocol_v2.vocab`：`TASK_VALUES` / `INFRA_VALUES` / `GEOMETRY_VALUES` / `PROMPT_VALUES` / `TASK_DEFAULT_GEOMETRY` 受控词表常量，与 `apps/api/app/services/capability_registry.py` SSOT 手工同源。

**不引入**：

- 任何抽象基类、ABC、Protocol 接口。
- `/setup` 字典构造器（各 backend 自己写）。
- 模型池 / observability / 推理生命周期等"看起来共性"的实现层抽象。

**未来触发条件**（满足任一即重新评估抽象层）：

1. 接入第 4 个 backend（如 PaddleOCR backend、ONNX 聚合 backend）后，发现 ≥50% 代码可机械抽取。
2. 协议 v3 落地，需要在 3+ backend 同步改 schema 形态，手工维护成本明显高于一次性抽象。
3. 外部开发者反馈"接入门槛太高，希望有 SDK" —— 此时走 v0.15.2 [`ML Backend Starter`](../plans/2026-06-07-v0.15.2-sdk-cli-and-ml-backend-starter.md) 路径，**用模板代码而非基类**解决。

## Consequences

正向：

- v0.14.12 PR-A 改动面 < 200 行（含测试），review 成本低。
- 协议词表单点维护：未来 `capability_registry.py` 扩展时只需手工镜像到 `vocab.py`，避免 backend 之间漂移。
- 保留判断权：N=4 时回顾真实共性，再决定是否抽，规避 YAGNI。
- 不与 v0.15.2 SDK / Starter 计划冲突（那是面向外部开发者的产品化包装，非内部基类）。

负向：

- `/setup` dict 字面量在 3 个 backend 各自维护（每家 ~80 行）；协议 v2 字段集 stable 期间维护成本可控，若 v3 大改时需要逐家同步。
- 没有基类校验 → 各 backend 可能拼错字符串字面量（用 `vocab.py` 常量缓解，但无强制力）。
- 新接入 backend 的工程师需要参考既有 backend 复制骨架，而非 subclass —— 这是有意为之，让接入者看到完整生命周期，而非黑盒。

## Alternatives Considered（详）

**B. 同时抽 `MLBackendBase`**：典型形态 `class MLBackend(ABC): def setup(self) -> SetupResponse; def predict(self, req) -> PredictionResponse`。问题：

1. sam3 的 `/predict` 入参 `Context.type` 含 `exemplar`，gsam2 没有，yolo 用 `variants` 完全不同结构 → `predict()` 签名要么走宽松 `dict`（失去类型）、要么定义复杂 generic（增加心智）。
2. sam3 / gsam2 已经在生产用了 1 个 release cycle 的代码形态，要全推倒重新 subclass，是 CLAUDE.md §3 surgical changes 反对的"为重构而重构"。
3. yolo 是第三个样本，三点定不了曲线。

**C. 全 SDK（label-studio-ml-backend 风格）**：包含 HTTP server / training job runner / callback / serialization 全栈。问题：

1. 我们的 `/fit` 训练端点本来就不打算做（NG4 in v0.14.12 plan）。
2. v0.15.2 已经规划了 SDK + Starter，定位是"给外部开发者用"，与"内部 backend 复用"是两个产品。
3. 一旦抽 SDK，内部 3 个 backend 都得迁，这版工作量 ×3，且不解决任何当前的痛点。

> 区别于 *Context* 中的对比表：这里写**论证过程**，对比表只是要点。

## Notes

- 实现代码位置：`apps/_shared/protocol_v2/` —— 包定义；`apps/sam3-backend/schemas.py` + `apps/grounded-sam2-backend/schemas.py` —— 迁移示例；`apps/yolo-backend/` —— 新 backend 引用样板（v0.14.12 PR-B）。
- 相关 ADR：ADR-0020（capability negotiation 起源）、ADR-0036（协议 v2 多模型）、ADR-0037（capability 目录解耦）。
- 相关 ROADMAP / 计划：v0.14.12 计划 `docs/plans/2026-06-08-v0.14.12-yolo-backend.md` §7；v0.15.2 SDK / Starter 计划。
- 后续 TODO：N=4 时打开本 ADR 复审；若决定抽基类，新建 ADR-00XX 将本文标记为 Superseded。
