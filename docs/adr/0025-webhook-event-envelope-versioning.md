# 0025 — Webhook 事件信封与版本化（草案）

- **Status:** Proposed
- **Date:** 2026-05-19
- **Deciders:** core team
- **Supersedes:** —

## Context

未来要做 Webhook 系统（ROADMAP §2.1），将平台事件 fan-out 给外部系统：标注完成、任务通过/退回、批次状态变更、预标完成等。Label Studio 历史教训非常清楚——webhook payload **没有版本字段** 时，任何 schema 调整都会让所有客户端集成挂掉，最后被迫永远向后兼容，schema 走样到难以维护。

CVAT 的 `Webhook` / `WebhookDelivery` 两表分离（[`cvat/apps/webhooks`](https://github.com/cvat-ai/cvat/tree/develop/cvat/apps/webhooks)）已经走通了交付/重试机制，但事件 payload 自身仍无版本约束。

本 ADR 在**实现 webhook 系统之前**先把事件 payload 的**信封 schema** 与版本化策略钉死，让未来落地 §2.1 epic 时不必再争论字段名。本 ADR 不创建任何 alembic 迁移、不写 publisher/consumer，仅产出：

1. 顶层信封约定（必备字段 + 版本演化规则）。
2. Pydantic 占位 schema `EventEnvelope[T]`，将来直接复用。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A. 单一信封 + `event_version` 字符串** | 客户端只看 envelope，data 由 event name 决定 schema；版本演化空间充足 | 需要约定 envelope 字段，不能再改 |
| B. 每事件独立 schema，无 envelope | 客户端按 endpoint 路由处理 | 跨事件公共字段（actor、delivery_id、attempt）必须每个 schema 重复 |
| C. 直接复刻 GitHub webhook 格式 | 生态熟悉 | 平台事件语义与 GitHub 差异大，硬套会导致大量 N/A 字段 |

## Decision

选 **A. 单一信封 + 字符串 `event_version`**。

### 信封字段约定（顶层必备）

```json
{
  "event_version": "1.0",
  "event": "task.rejected",
  "delivery_id": "01JX8K4M5R6S7T8V9W0X1Y2Z3A",
  "occurred_at": "2026-05-19T10:00:00Z",
  "data": { /* 事件载荷，schema 由 event 决定 */ }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `event_version` | `string` (SemVer) | **必备**。信封自身的版本，**非** data 的版本。breaking change 升 major；增量字段升 minor。首版 `"1.0"`。 |
| `event` | `string` (枚举) | **必备**。形如 `domain.action`：`task.created` / `task.reviewed` / `task.approved` / `task.rejected` / `batch.state_changed` / `prediction.completed` / `prediction.failed` / `bug_report.created`。 |
| `delivery_id` | `UUID` 或 `ULID` | **必备**。消费侧去重幂等键；同一逻辑事件重试时**不变**。 |
| `occurred_at` | ISO-8601 UTC | **必备**。事件发生时刻（非发送时刻）。 |
| `data` | object | **必备**。schema 由 `event` 决定，可空对象 `{}`。 |

### 版本演化规则（Postel's law）

- **发送方**（平台）：所有字段写满；未设字段写 `null`（不省略 key），便于客户端做严格 schema 校验。
- **接收方**（客户端推荐）：只解析必备字段 + 已知字段，未知字段忽略不报错。
- **minor 升级**（如 `1.0` → `1.1`）：只能**增加**可空字段，不能改类型/不能删字段/不能让字段变必备。
- **major 升级**：极少触发；触发时**保留 `event_version=1.x` 双轨发送**至少 90 天，新订阅默认走最新 major，老订阅 explicit 选 major。

### 与 §1.5 Predictions Import 的 `schema_version` 关系

- AAP JSON 的 `schema_version` 是**数据 schema** 的版本；webhook 的 `event_version` 是**信封 schema** 的版本。两者独立演化，互不影响。
- AAP JSON 不进 webhook payload（体积大）。如需通知"prediction 导入完成"，发 `prediction.import_completed` 事件，`data` 里只放 job_id + 统计数字。

### 签名规划（不在本 ADR 落地，仅留意）

- 签名头：`X-Aap-Signature-256: sha256=<hmac>`（与 GitHub webhook 同款，便于客户端复用代码）。
- 签名 secret 在 Webhook 实体上配置（未来 §2.1）。
- 签名包含**完整 raw body**（含 envelope），不只 data。

### Pydantic 占位 schema

实际位置：`apps/api/app/schemas/event_envelope.py`（与本 ADR 同窗口落地）。仅定义 `EventEnvelope[T]` 泛型 + `EventName` Literal，不接入任何 publisher。

## Consequences

正向：

- 未来 §2.1 Webhook epic 落地时**无需重写**事件 payload schema。
- §1.5 落地的 `schema_version` 思路对齐，平台 schema 演化策略统一（Postel's law + version major/minor 区分）。
- 第三方集成代码在 v1.0 → v1.x 升级时**只新增字段**，无需重写——大幅降低集成生态摩擦。

负向：

- 信封字段一旦上线就难改，**第一版必须刻意收紧**（仅 5 个必备字段）。
- `delivery_id` 强制幂等约束需要发送侧维护持久化记录（未来 §2.1 epic 内做）。
- `event_version` 与 `data` 字段无机器可读关联，开发者要靠文档 / OpenAPI 描述对照 —— 未来如果 data schema 复杂到值得独立版本号，再单独引入 `data_schema_version`。

## Alternatives Considered（详）

**B. 无信封，每事件独立 schema**：客户端按 endpoint 路由不同 schema，乍看简单，但 `delivery_id`、`actor`、`occurred_at` 这些跨事件公共字段必须在每个 schema 重复定义，前后端 schema codegen 量级爆炸。同时未来加全局字段（如 trace_id）需改 N 个 schema。否决。

**C. 直接复刻 GitHub webhook 格式**：GitHub 信封字段（`action` / `sender` / `repository` / `installation`）有大量平台不适用项（无 installation 概念，无 repo 概念）。硬套会让 envelope 半数字段 N/A，客户端阅读体验差。否决。

## Notes

- 实现代码位置（仅 schema 占位）：`apps/api/app/schemas/event_envelope.py`
- 相关 ROADMAP：[ROADMAP §2.1 Webhook 系统](../../ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#21-webhook-系统一等公民)
- 相关 ADR：ADR-0024（AAP JSON 的 `schema_version` 同源思路）
- 触发条件：当首个客户提"需要集成 webhook" 或 §2.1 epic 启动时，本 ADR 状态切到 **Accepted**，开始拆 publisher/storage/retry 子任务。
- 未来 TODO：`Webhook` / `WebhookDelivery` 表结构、HMAC secret rotation、retry 退避策略表。
