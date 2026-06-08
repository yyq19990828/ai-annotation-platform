# v0.14.12 · HealthMeta 字段元数据登记表（草稿）

> 规划日期 2026-06-08 · **状态：草稿，待详细讨论**。承接 v0.14.11 的 SSOT 思路，把 RuntimeObservePanel 从"前端硬编码字段名 + label"改造为"后端 field registry 驱动渲染"。
>
> 本文件只列骨架与开放问题，不是可实施 plan。详细方案在用户确认方向后补全。

## 1. 问题陈述

`apps/web/src/pages/ModelMarket/RuntimeObservePanel.tsx` L163-229 把 health_meta 的字段名（`gpu_info` / `model_version` / `pool` / `video_pool` / `cache.hit_rate`）连同中文 label、单位、阈值色阶**全部硬编码在前端**。后端 `HealthMeta` schema 是 `extra="allow"` 的松散 JSONB（`apps/api/app/schemas/ml_backend.py` L134-146），扩字段时存在两处问题：

1. **新增 health 指标要改前端**：backend 想暴露一个新指标（比如 `inflight_requests`），后端写进 health_meta 后，前端不改代码就看不见。
2. **label / unit / 含义没有协议层定义**：cache.hit_rate 在前端写死"缓存命中率（%）"，换一处面板就要重写一遍；i18n 改文案要找 N 处。

与 v0.14.11 的能力目录是同源问题——**前端 hardcode 字段名 + 后端隐式契约**。

## 2. 目标（草稿）

- **G1**：新建 `apps/api/app/services/health_field_registry.py` 作为 SSOT，登记每个 health 字段的 id / label / unit / category / format / threshold / 取值路径。
- **G2**：新增端点 `GET /v1/ml-capabilities/health-fields`（与 `/protocol` 同源思路），返回字段元数据清单。
- **G3**：`RuntimeObservePanel` 改造为「读 health-fields 注册表 → 按 category 分组渲染 → 按 format 选 widget」。前端不再硬编码字段名/label。
- **G4**：未登记的 health_meta 字段统一收口到一个"扩展字段"折叠区（兜底显示，避免 backend 私自加字段彻底不可见）。

### 非目标

- 不动 `HealthMeta` pydantic 定义本身（仍然 `extra="allow"`）。
- 不动 backend `/health` 协议。
- 不做运营后台编辑 field metadata（与 v0.14.11 同样硬编码在代码里）。
- 不动注册表单（那是 v0.14.13 的事，参考 §6）。

## 3. 设计骨架

### 3.1 后端 field registry（示意）

```python
# apps/api/app/services/health_field_registry.py
@dataclass(frozen=True)
class HealthFieldSpec:
    id: str                    # "gpu.memory_used_mb"
    path: str                  # JSONPath 取值: "gpu_info.memory_used_mb"
    label: str                 # "显存占用"
    unit: str | None           # "MB" / "%" / None
    category: str              # "gpu" / "model" / "cache" / "pool" / "host"
    format: str                # "number" / "percent" / "bytes" / "duration" / "string" / "kv-list"
    threshold: ThresholdSpec | None  # 颜色阈值: { warn: 80, danger: 95 }

HEALTH_FIELDS: tuple[HealthFieldSpec, ...] = (
    HealthFieldSpec(id="gpu.memory_used", path="gpu_info.memory_used_mb",
                    label="显存占用", unit="MB", category="gpu", format="bytes"),
    HealthFieldSpec(id="gpu.utilization", path="gpu_info.utilization_pct",
                    label="GPU 利用率", unit="%", category="gpu", format="percent",
                    threshold=ThresholdSpec(warn=80, danger=95)),
    HealthFieldSpec(id="model.version", path="model_version",
                    label="模型版本", unit=None, category="model", format="string"),
    HealthFieldSpec(id="cache.hit_rate", path="cache.hit_rate",
                    label="缓存命中率", unit="%", category="cache", format="percent"),
    HealthFieldSpec(id="pool.variants", path="pool",
                    label="模型并存池", unit=None, category="pool", format="kv-list"),
    # ... 把 RuntimeObservePanel.tsx L163-229 现在硬编码的字段全部登记
)
```

### 3.2 端点

```
GET /v1/ml-capabilities/health-fields
→ { "fields": [HealthFieldSpec, ...], "categories": [...] }
```

ETag + 304，缓存语义同 v0.14.11 的 `/protocol`。

### 3.3 前端渲染

`RuntimeObservePanel` 改成 driven-by-registry：

```tsx
const { fields } = useHealthFields();
const grouped = groupBy(fields, "category");
// 按 category 渲染分组卡, 每张卡内的字段按 spec.format 选 widget:
//   number  → <NumberStat />
//   percent → <PercentBar threshold={spec.threshold} />
//   bytes   → <BytesStat />
//   string  → <KvRow />
//   kv-list → <PoolTable />
// 字段取值: getByPath(backend.health_meta, spec.path)
// 取值为 undefined → 该字段隐藏
```

未登记字段（health_meta 里有，但 registry 里没有）统一进"其他字段"折叠区，以 raw key:value 显示。

## 4. 开放问题（待讨论）

1. **format 词表**：目前列了 `number / percent / bytes / duration / string / kv-list`，够不够？`pool` / `video_pool` 是 dict-of-dict 结构，`kv-list` 是否足以表达？还是要单独引入 `pool` format？
2. **threshold 语义**：阈值颜色是后端定，还是前端按业务定？后端定的好处是 SSOT，坏处是产品改色阶要发版后端。
3. **JSONPath 还是嵌套字段路径**：`path` 用点分字符串够用，还是要支持完整 JSONPath（`gpu_info.devices[0].memory`）？大概率前者够，但 backend pool 类字段会嵌套数组。
4. **是否登记"动态字段"**：variant pool 的 key 是动态的（model 变体名），registry 只能描述"pool 这个容器"，无法描述"每个 variant 的指标"。这部分应该让 widget 自己内部约定，还是 registry 增加 "container" 语义？
5. **i18n**：v0.14.11 的能力目录决定中文 label 后端给、英文延后。本版要不要直接做 i18n（`label_zh` / `label_en`），还是同样延后？
6. **与现有 admin observe 协议的关系**：v0.14.10 已经有 `GET /admin/ml-integrations/observe` 双发 `variant_catalog` / `supported_variants`。observe 数据流是不是也应该接入这个 registry？还是 observe 是独立频道？
7. **变更频率**：新增 health 字段是高频还是低频操作？如果一年只加 2-3 个字段，硬编码改前端的成本其实不大，registry 是不是过度工程？

## 5. 任务清单（粗粒度）

- [ ] T1 后端 `health_field_registry.py` + `/v1/ml-capabilities/health-fields` 端点 + 单测
- [ ] T2 前端 `useHealthFields` hook + `RuntimeObservePanel` 改造为 registry 驱动
- [ ] T3 widget 库（NumberStat / PercentBar / BytesStat / KvRow / PoolTable）
- [ ] T4 "其他字段"兜底区
- [ ] T5 ADR + 协议文档 + 超管手册更新
- [ ] T6 兼容性自检（旧 backend 的 health_meta 不掉字段）

预估工作量：1.5 ~ 2 day（取决于 widget 库复杂度）。

## 6. 与 v0.14.13 的边界

v0.14.13 的候选议题是「注册表单 schema 驱动」（让 `MlBackendFormModal` 的字段定义来自后端）。两者关系：

- v0.14.12 解决「读侧」schema 驱动（health 展示）；
- v0.14.13 解决「写侧」schema 驱动（注册表单），涉及到 backend `/setup` 是否自描述可调参数，议题更重；
- 两版的 field registry 风格如果对齐，可以共享 `ProtocolFieldSpec` 抽象，避免双份维护。

但本版**不为 v0.14.13 预留接口**，避免提前抽象。等真到 v0.14.13 时再回看是否抽公共基类。

## 7. 风险

- **R1（过度工程）**：见开放问题 #7。讨论时先量化"过去一年加了几个 health 字段"决定值不值得做。
- **R2（registry 漂移）**：backend 写进 health_meta 的字段在 registry 里没有，导致前端兜底为"其他字段"——长期下沉就丢失信息。需要 lint / 测试保证 registry 与实际后端 health_meta 字段同步。
- **R3（widget 库膨胀）**：每加一个 format 就要加一个 widget，可能比硬编码渲染更复杂。需要在讨论里确认 format 词表收敛。

## 8. 下一步

讨论以下问题后再补全 plan：

1. §4 开放问题逐条确认；
2. 是否真值得做（成本/收益 vs 当前痛点）；
3. 是否合并到 v0.14.11 一起做（不推荐，但保留讨论空间）；
4. i18n 时机（本版做 vs 推迟）。
