# 跨 Backend GPU 显存互斥编排实施计划（草案）

> Status: draft · 2026-07-14
>
> 依赖：`2026-07-13-v0.22.3-ml-backend-cpu-fallback-audit.md` 正由另一 agent 实施；本轮只形成草案，不把其 WS4 视为已完成。待该分支合入后，必须按真实 diff、协议形态和测试结果复核本计划，再进入 ADR 定稿与实施。
>
> 架构依据：ADR-0049（当前仍为 Proposed）、ADR-0044（全局注册表）、ADR-0012（独立 GPU 服务）、ADR-0038（不借机抽 backend 基类）。

## 1. 结论与本期边界

本期目标不是做 GPU 调度平台，而是在现有“一 backend 一容器、每个容器静态绑定一张卡”的前提下，给所有平台派发入口增加同一套跨进程显存准入：同卡按静态预算共驻，放不下时按优先级加权 LRU 驱逐，活跃请求受保护，彻底放不下时明确失败；不同卡互不阻塞。

单卡与多卡使用同一模型：**按物理资源卡分片治理**，而不是按“机器是单卡还是多卡”整体分支。当前默认双卡布局仍是 gsam2 / yolo / onnxtools / rapidocr 共用卡 0、sam3 使用卡 1，因此卡 0 仍需仲裁；只有某张卡实际至多绑定一个 backend 时，该卡才自然退化为无驱逐快路径。

本期包含：

- 静态 backend → 单张物理卡映射、每卡独立预算、账本、锁、等待队列和指标。
- `predict`、`predict_interactive`、`warmup`、`reload`、手工 `unload` 以及运行时 smoke-test 的统一生命周期门控。
- 单卡多 backend 共驻 / 驱逐，多卡共享与独占混合布局，API 与多个 Celery 进程并发。
- 把现有 `max_concurrency` 从单进程减压提升为 Redis request lease 约束下的跨进程全局并发上限；本地 semaphore 继续作为第一层背压。
- CPU fallback 与 ORT provider 的账本联动，但不改变既有 Celery 队列路由。
- 默认关闭、observe 影子决策、单卡 enforce、多卡逐卡灰度和即时回滚。

本期明确不做：

- 不做跨卡自动 bin-packing、动态迁移或“挑最空闲卡”。
- 不做同一 backend 多副本、负载均衡或副本 scale-out。
- 不做单个 backend 同时占多卡；配置出现 device set 时首版直接拒绝，另立 ADR 设计全量原子获取与死锁顺序。
- 不把活体 `gpu_info.memory_used_mb` 当准入依据；它是共享卡整卡视角，只做漂移 / 外部占用告警。
- 不引入 ML Backend 基类，不统一各 backend 的模型池内部实现。
- 不做请求级动态显存预测；首版仍使用每 backend 一个保守静态预算。

## 2. 定稿前必须关闭的决策门

以下事项不是普通实现细节。ADR-0049 定稿前必须逐项给出结论；在此之前不得开启 L2 enforce。

| ID | 当前问题 | 草案建议 | 关闭条件 |
|---|---|---|---|
| D1 | CPU fallback 计划仍为 draft，`compute` 最终形态未冻结 | 等外部 agent 合入后，以实际 `/health.compute`、平台白名单、`health_meta` 和 UI 为准 | WS1–WS4 有测试和 Outcome；五 backend 的 effective device/provider 可被平台读取 |
| D2 | `priority` 默认 0，但 ADR 排除 `victim.priority >= requester.priority`，默认 backend 彼此永远不可驱逐 | 字段明确为 `eviction_priority`；只保护严格更高优先级，受害条件为 `victim.priority <= requester.priority`，同级再按 LRU | ADR 算法、单测和 UI 文案一致 |
| D3 | ADR 把“多卡”概括成每卡至多一个 backend，与默认双卡的卡 0 四 backend 共用矛盾 | 逐资源卡判断；共享卡仲裁、独占卡快路径，不允许整机级 bypass | 单卡、双卡共享 / 独占混合拓扑写入 ADR |
| D4 | `card:{device_id}` 会把不同 GPU 主机的卡 0 合并 | 优先使用 `node_id/GPU-UUID` 或 MIG UUID；取不到时才用显式 `resource_domain/physical_device_token`，绝不使用容器内逻辑序号 | 两台主机的同号卡测试不碰撞，UUID / MIG 映射可验证 |
| D5 | `health_meta.loaded` 不是统一真值；image / video / variant pool 可同时驻留 | 新增统一 `residency` 契约，表达任一 GPU pool 的驻留、active、draining、generation 和是否支持受管驱逐 | 五 backend 契约测试一致；不再以单个旧 `loaded` 对账 |
| D6 | `/unload` 仍是可选且不等价于“全池卸载”：RapidOCR 缺端点，gsam2 未清 video pool | 只有声明受管全池卸载 + generation fencing 的 backend 才可当受害者；其余按 non-evictable 计费 | RapidOCR / gsam2 补齐；五 backend 全池卸载测试通过 |
| D7 | TTL 卡锁过期后，旧进程仍可能发迟到 `unload` | 卡锁只做短状态跃迁；每次 residency 使用 generation/fencing token，backend 拒绝旧 generation 的卸载 | 迟到 unload 故障注入测试通过 |
| D8 | 平台 lease 结束不等于 backend 已停止计算，尤其客户端超时 / worker 崩溃时 | Redis request lease + backend 内 active/draining 双层保护；backend active 非零时不得清模型 | predict 超时后仍计算的测试不会被卸载 |
| D9 | 参考预算是单模型净增，不覆盖多池、多变体、并发和 SAM3 视频瞬时工作集 | `vram_budget_mb` 定义为当前 pool cap、最大变体、窗口和并发下的保守最大运行工作集 | 每个 enforce backend 有实测口径和安全余量；未校准者按整卡预算 |
| D10 | ADR 笼统写 Redis 故障时放行，可能在最需要保护的共享小卡上重新引入 OOM | `off/observe` 保持原行为；`enforce` 在共享 / 未知资源上 fail-closed，只有静态证明无需驱逐的独占卡才允许 fail-open | ADR 明确策略、503 错误码、告警和回滚行为 |
| D11 | `exclusive_group` 没有进入算法，静态字段落列还是 JSONB 也未决 | 行为关键配置使用显式列；首版删除未消费的 `exclusive_group`。整卡保护用 `budget == allocatable` 表达，不再引入第二套互斥语义 | 数据模型只保留算法实际读取的字段 |
| D12 | 现有 module-level `asyncio.Semaphore` 只覆盖一个 OS 进程 / event loop，API、Celery prefork 和多副本会各持一份 | 保留其作进程内背压；Redis request lease 同时承担 backend 级全局 `max_concurrency` 许可；过期 lease 在 backend 仍 active 时保守保留 | 两个独立进程 / client 合计并发不超过配置，调用方崩溃也不超限；修正文档中的“全局 semaphore”表述 |
| D13 | compose 发布 backend 端口，平台外直接 `/predict`、`/warmup`、`/reload` 可加载模型而不记账 | enforce 的正确性边界必须是生产网络仅允许平台受管调用，或所有加载端点强制验证 arbiter admission token；只读 health 可豁免 | 生产拓扑与协议写明边界，绕过 token 的加载请求被拒绝 |
| D14 | task-major 多阶段流水线会在不可共驻模型间逐题切换，视频窗口间 lease 归零也可能被立即抢占 | observe 先量化；enforce 前冻结最小驻留 / cooldown、bounded wait 或 pipeline preflight 的单一规则，不用无界 job pin 掩盖问题 | 有反复切换测试、驱逐频率门槛与明确的超限行为 |

CPU fallback 分支合入后还要额外核对 `sam3-backend/video_predictor.py` 与 `pvs_video_predictor.py` 的设备路径；当前地基计划正文只点名了图片 predictor，不能据此假定视频路径已覆盖。

## 3. 成功标准与不变量

### 3.1 资源与容量

1. 一个 registry backend 在本期只能声明一个 `gpu_resource_id`；CPU backend 为 `null`。
2. `allocatable_mb` 是扣除驱动、CUDA context、桌面 / 系统进程、非平台进程和安全余量后的可分配容量，不直接等于显卡标称总显存。
3. `committed_mb` 等于该卡所有 `reserving/loading/resident/draining/unloading/unknown-conservative` allocation 的预算和。
4. enforce 下任何成功的新准入都满足 `committed_mb <= allocatable_mb`；已发现超额漂移时停止新增承诺，先对账或拒绝。
5. 一张卡的锁、状态跃迁、排队或 backend 故障不能阻塞另一张卡；共享 Redis 整体不可用属于基础设施级故障，按 D10 的全局 failure policy 处理，不能宣称天然隔离。

### 3.2 驱逐与并发

1. 同级 backend 可按 `last_used_at` 从旧到新驱逐；严格更高 `eviction_priority` 的 backend 受保护。
2. 准入、allocation 预留和 request lease 创建必须原子完成，不留“已准入但尚未记 inflight”的 TOCTOU 窗口。
3. 同一 backend 的有效 Redis request lease 数不得超过现有 `extra_params.max_concurrency`；裸整数 inflight 不满足崩溃回收要求。
4. lease heartbeat 过期只证明平台调用方失联，不证明 backend 已停止计算；backend 仍 active 时保守占住并发许可和 allocation，直到对账确认空闲。
5. 被选为受害者后先进入 `draining`，不再发新 lease；平台 lease 与 backend active 均为 0 后才能全池卸载。
6. 卡锁不覆盖 drain、HTTP unload 或整个 predict；这些长操作在锁外执行，由 generation token 和 CAS 提交保护。
7. 旧 generation 的进程不能写回账本，也不能卸载新 generation 已重新使用的模型。
8. 卸载成功但响应丢失、backend 不可达或结果不确定时继续保守计费为 `unknown`，不得先减 committed。

### 3.3 用户行为

1. `off` 模式不访问仲裁 Redis key、不改变现有请求顺序、错误和性能。
2. `observe` 模式计算 would-admit / would-evict / would-reject，但绝不调用 `/unload`、不阻断业务。
3. `enforce` 无容量时在发 backend HTTP 前返回结构化 503，例如 `gpu_capacity_unavailable`，交互式、批量、二次推理和视频路径使用同一根因语义。
4. 已明确 `effective_device=cpu` 或实际 provider 为 CPU 的 backend 不占 GPU budget；`None` 表示未加载 / 未知，仍按配置 GPU 保守准入。
5. 因硬件失效而 CPU fallback 与因预算不足被仲裁拒绝必须可区分；容量不足不能用静默 CPU 降级掩盖。

## 4. 目标资源与静态配置模型

### 4.1 物理资源标识

草案采用单资源 claim：

```text
gpu_resource_id = <gpu_node_id>/<gpu_device_token>

示例：
gpu-node-a/GPU-6ab3...
gpu-node-a/index:0
gpu-node-b/index:0
```

`gpu_node_id` 必须由运维显式配置，不能从 backend URL hostname 猜测：同一 GPU 主机上的不同容器通常有不同 service DNS，而不同主机又都可能暴露逻辑 `cuda:0`。`gpu_device_token` 使用 compose 实际绑定的物理 device token；容器内重映射后的逻辑 `cuda:0` 不能作为跨 backend 真值。

CPU fallback 地基合入后，要复核共享 runtime 是否能报告稳定的 GPU UUID / MIG UUID，并补齐当前只可靠解析数字 `CUDA_VISIBLE_DEVICES` 的限制；在 UUID 映射尚不可验证的部署上，只能使用运维显式声明的 resource domain + physical token，不能由平台猜测。

首版数据库字段建议直接进入 `ml_backend_registry`：

| 字段 | 类型 / 缺省 | 语义 |
|---|---|---|
| `gpu_node_id` | `str | null` | 物理 GPU 资源域；CPU backend 为空 |
| `gpu_device_id` | `str | null` | 物理 device token；保留字符串以兼容 GPU UUID，禁止逗号 / 多值 |
| `vram_budget_mb` | `int | null` | 该 backend 的保守最大运行工作集 |
| `eviction_priority` | `int = 0` | 越大越难被驱逐；不表示请求排队优先级 |

`evictable` 不由管理员随意勾选，而由 backend `/setup` + `/health.residency` 的受管生命周期能力派生，避免把没有可靠全池卸载能力的第三方 backend 错当受害者。静态字段使用显式列而不是 `extra_params`，因为它们需要类型校验、列表展示、迁移与配置变更护栏。

卡容量使用平台配置 `GPU_ARBITER_RESOURCES_JSON`（`gpu_resource_id -> allocatable_mb`）；单个 `CARD_TOTAL_MB` 无法表达多卡和多主机。L1 可用 `gpu_info.memory_total_mb` 给出建议值和不一致告警；L2 不在缺少明确 allocatable 时猜测容量。新增 / 修改 URL、资源映射、预算时，若该 backend 尚有 allocation 或 active lease，返回 409，要求先 drain + unload，不做热迁移。

现有 `extra_params.max_concurrency` 暂保留兼容，不在本计划顺带搬列；它在 L2 下由 Redis lease 执行真正的跨进程上限，现有本地 semaphore 只负责减少单进程排队压力。后续若单独做注册表强类型化，再迁移该字段。

### 4.2 预算口径

`vram_budget_mb` 必须覆盖：

- backend 内所有允许同时存在的 image / video / variant pool cap。
- `max_concurrency` 下可同时发生的推理临时 buffer。
- 当前最大允许视频窗口；SAM3 16 帧工作集不能套用仅图像模型的约 6GB 建议值。
- CUDA / ORT 上下文中归属于该 backend 且在全池卸载后仍不会释放的必要基线。
- 校准误差安全余量。

性能基准里的默认模型净增只作为首轮测量种子，不能直接复制为 enforce 预算。未完成峰值校准的 backend 暂将预算设为该卡 `allocatable_mb`，等价于保守整卡驻留；本期不另加 `exclusive_group` 或请求级动态 budget。

L1 告警分四级，避免把“允许驱逐”误报成故障：

| 条件 | 级别 | 含义 |
|---|---|---|
| 单 backend `budget > allocatable` 或必填配置缺失 | blocker | 该 backend 在此卡永远无法安全运行 |
| 同卡全部配置预算和 `> allocatable` | warning | 正常弹性超售；运行时将发生驱逐和冷启动 |
| Redis `committed > allocatable` | critical | 账本不变量破坏或重建未完成 |
| 去重后的整卡 observed 与 committed 明显偏离 | warning | 预算漂移或存在平台外 GPU 占用，仅用于校准 |

## 5. 受管 backend 生命周期契约

CPU 地基的 `compute` 只回答“实际在哪种设备执行”，还不足以安全驱逐。本计划在其上增加统一 `residency`：

```json
{
  "compute": {
    "configured_device": "cuda",
    "effective_device": "cuda:0",
    "effective_provider": null
  },
  "residency": {
    "state": "resident",
    "gpu_loaded": true,
    "active_requests": 0,
    "draining": false,
    "evictable": true,
    "generation": "opaque-generation-token",
    "pools": {
      "image": {"resident": true},
      "video": {"resident": false}
    }
  }
}
```

要求：

- `gpu_loaded` 表示任一 GPU image pool、video pool、ORT session 或 GPU tensor cache 仍驻留；不能只镜像旧顶层 `loaded`。
- `/unload` 的受管语义是清空该 backend 的全部 GPU pool / session / GPU tensor cache，并返回实际 generation；只卸 image pool 不合格。
- predict / warmup / reload 进入 backend 内部 active guard；draining 后拒绝新工作。受管 unload 只在 active 为 0 且 generation 匹配时执行。enforce 下所有可能加载的端点还必须验证 admission token，防止平台外直连绕过账本。
- 不支持该契约的 backend 仍可运行和计入预算，但 `evictable=false`，绝不能进入自动受害者集合。
- 旧 `loaded`、`pool`、`video_pool` 保留兼容展示；平台对账以 `residency` 为真值。
- 不为此抽统一 backend 基类；五个 backend 分别在现有生命周期锁 / pool 边界做最小改造，共享的只应是协议 schema / header 常量。

当前必须补的已知差异：

- RapidOCR 新增全池 `/unload`，清引擎池、锁 / meta 引用并确认 ORT GPU session 释放。
- Grounded-SAM2 `/unload` 同时清 `_pool` 与 `_video_pool`；当前仅清图片池。
- SAM3 的 `gpu_loaded` 必须合并 image、multiplex video、PVS video，而非只看 `_predictor`。
- YOLO、ONNXTools、RapidOCR 从 `pool.current_size` 统一映射 residency。

## 6. Redis 账本、状态机与公平性

### 6.1 Key 与真值边界

Redis 使用版本化 namespace，并让同一卡的 key 可进入同一 Redis Cluster hash slot：

```text
gpu-arbiter:v1:{resource_id}:card
gpu-arbiter:v1:{resource_id}:allocations
gpu-arbiter:v1:{resource_id}:queue
gpu-arbiter:v1:{resource_id}:leases:<backend_id>
gpu-arbiter:v1:{resource_id}:transition
```

PostgreSQL 保存静态 claim；Redis 保存运行时 allocation、generation、LRU、等待 ticket 和 request lease。每个请求使用独立 token + heartbeat deadline；deadline 过期后标为 stale，若 backend 仍报告 active 则继续保守计数，待 backend 确认空闲后才清理，不能用一个裸 `inflight` 整数代替。只有 queue / lease / transition owner 有过期 / 接管语义；驻留 allocation 不得因 TTL 自动消失。`committed_mb` 由 allocation 集合原子求和 / 校验，不依赖容易漂移的裸增减计数。

### 6.2 状态机

```mermaid
stateDiagram-v2
  [*] --> Unknown
  Unknown --> Unloaded: health confirms empty
  Unknown --> Resident: health confirms GPU residency
  Unknown --> CpuFallback: health confirms effective CPU
  Unloaded --> Reserving: atomic admission + lease
  Reserving --> Loading: backend call accepted
  Loading --> Resident: load/predict succeeds
  Loading --> Unknown: timeout or uncertain failure
  Resident --> Draining: selected as victim
  Draining --> Resident: drain timeout / rollback
  Draining --> Unloading: platform leases = 0 and backend active = 0
  Unloading --> Unloaded: fenced full-unload succeeds
  Unloading --> Unknown: timeout / response lost / generation mismatch
  Resident --> Unloaded: idle or manual unload reconciled
  Resident --> CpuFallback: health confirms GPU to CPU fallback
  CpuFallback --> Reserving: health indicates GPU recovery requires admission
```

`Unknown` 保守占用上一份 budget，直到可信 health 证明为空或 CPU fallback；不能因 backend 不可达释放额度。

### 6.3 原子准入

最终 L2b 的 `MLBackendClient` 请求上下文顺序固定为（P4 的 L2a 遇到 busy victim 时在第 6 步直接返回 503，不进入主动 drain）：

1. 先取得现有 per-backend 本地 semaphore，避免还在本进程排队的请求提前占 Redis lease；该 semaphore 不再被描述为全局闸。
2. `off` 直接调用；`observe` 只记录影子决策；`enforce` 进入对应 `resource_id`。
3. 在短卡锁 / Lua 原子区内清理过期 lease、读取 allocation、分配 FIFO ticket（仅需要新 allocation / 驱逐的慢路径）。
4. target 已 resident 且未 draining：原子增加带 TTL + heartbeat 的 request lease、更新 LRU，立即放行。
5. target 未 resident 且 free 足够：创建 `Reserving` allocation、generation 和 request lease，再释放卡锁。
6. free 不足：从 `evictable=true`、严格不高于 requester priority 的 allocation 中按 `(priority asc, last_used_at asc)` 选足够受害者，标 `Draining` 后释放卡锁。
7. 锁外等待平台 leases 清零并调用受管 drain / unload；超时则回滚 victim 状态并返回 503，绝不在卡锁内等待网络。
8. 重新取得短锁，用 transition owner + generation CAS 提交卸载结果并为 target 预留；旧 owner 的结果只能被丢弃。
9. backend 调用结束后在 `finally` 删除 request lease；成功转 `Resident`，确定性加载失败可回滚，超时 / 断连等不确定结果转 `Unknown` 等待对账。

已 resident 且不参与当前 drain 的 backend 使用快路径，不因另一个慢请求排队而无条件 head-of-line blocking。需要新 allocation / 驱逐的慢路径按卡 FIFO；首版不增加“交互请求优先于批量”的第二种请求优先级，避免与 `eviction_priority` 混淆和引入饥饿。视频追踪仍按现有窗口逐次持 lease，不锁整个作业；每窗结束重新参与排队，避免长视频永久霸卡。

API lifespan 与 Celery 中多次 `asyncio.run` 会使用不同 event loop；实现不得跨 loop 复用一个 module-global `redis.asyncio` client / pool。P3 必须选择按 event loop 管理并显式关闭的异步 client，或封装同步 Redis 调用，并用重复创建 / 销毁 loop 的测试证明不会复用失效连接。

平台内的统一 client gate 只能保证平台派发不绕过。生产 enforce 还必须关闭 backend 对外直连加载面，或由 backend 强制校验短期 admission token；否则 Redis 账本只能被称为 best-effort，不能作为 OOM 安全保证。

## 7. 单卡、多卡与 CPU 行为矩阵

| 场景 | 预期行为 |
|---|---|
| 单卡、单 backend、预算合法 | 建一次 allocation；之后 resident 快路径，无受害者选择 |
| 单卡、多 backend、预算和不超卡 | 可同时 resident，不发生驱逐 |
| 单卡、多 backend、弹性超售 | 按同卡 priority + LRU 驱逐；active victim 先有界 drain |
| 单卡、target 自身预算超卡 | 配置 blocker；enforce 在发 HTTP 前拒绝 |
| 双卡，每卡一个 backend | 两张卡各自快路径，可完全并行 |
| 双卡，卡 0 四 backend、卡 1 一个 backend | 只在卡 0 选择受害者；卡 1 不受卡 0 的资源锁 / 队列 / backend 故障影响 |
| 两台 GPU 主机各有 card 0 | 通过不同 `gpu_node_id` 成为两个 resource，账本与锁完全隔离 |
| backend 配置 GPU、`effective=None` | 视为未加载 / 未知，按 GPU budget 准入 |
| backend 已明确 effective CPU / CPU provider | 转 `CpuFallback`，不占 GPU budget；仍沿原静态 Celery 队列运行 |
| health 从 CPU 恢复到 GPU | 不直接记 resident，下一次 GPU 调用必须重新准入 |
| 未实现受管 unload 的第三方 backend | 可以计费并运行，但固定 non-evictable；放不下时驱逐别家或拒绝 |
| 单 backend 声明多个 device | 首版 422 / 配置 blocker；不尝试逐卡拿锁 |

多阶段 pipeline 当前按“每 task 跑完全部 stage”执行；若两个同卡大 backend 互相放不下，仍可能在 task 间反复冷切换。这是本期明确观测的物理 / 调度限制，不在本计划顺带重写成 stage-major pipeline。先用 eviction / reload 指标量化，达到独立性能门槛后另立计划。

## 8. 工作分解

### P0 · 外部地基复核与 ADR 收口

依赖：CPU fallback agent 完成并提交。

工作：

- 审查真实 diff，确认 torch / ORT 的 `compute` 契约、五 backend 覆盖范围、平台白名单、PerfHud 和 UI 已落地。
- 特别补审 SAM3 image / multiplex video / PVS video 三条设备路径。
- 关闭 §2 的 D1–D14，把必要纠偏写回 ADR-0049；ADR 从 Proposed 转 Accepted 后才进入 P1。
- 冻结错误码：至少区分 `gpu_arbiter_not_ready`、`gpu_capacity_unavailable`、`gpu_drain_timeout`、`gpu_arbiter_unavailable`、`gpu_config_invalid`。

验收：ADR 写明本计划全部不变量，CPU 地基测试通过且 Outcome 可追溯。

### P1 · 受管 backend 驱逐契约（仍不自动驱逐）

主要触点：

- `apps/grounded-sam2-backend/main.py`、`video_pool.py`
- `apps/sam3-backend/main.py`
- `apps/yolo-backend/main.py`、`model_pool.py`
- `apps/onnxtools-backend/main.py`、`predictor.py`
- `apps/rapidocr-backend/main.py`、`predictor.py`
- CPU fallback 分支最终落下的共享 runtime device / compute probe
- 五 backend 对应 contract / idle-unload 测试
- `docs-site/dev/reference/ml-backend-protocol.md`

工作：统一 `residency`、全池 unload、backend active/draining、generation fencing；不抽生命周期基类。旧调用保持兼容，但不具备完整契约者自报 `evictable=false`。

验收：未加载、image-only、video-only、image+video、多 variant、active、draining、旧 generation、全池 unload、CPU provider 各状态都有无 GPU 契约测试；RapidOCR 与 gsam2 的已知缺口关闭。

### P2 · L1 静态 claim、配置校验与 observe 模式

主要触点：

- `apps/api/app/db/models/ml_backend_registry.py`
- `apps/api/app/schemas/ml_backend.py`
- `apps/api/alembic/versions/<next>_ml_backend_gpu_claim.py`
- `apps/api/app/config.py`
- `apps/api/app/services/ml_backend.py`、`ml_backend_env_sync.py`
- `apps/api/app/api/v1/admin_ml_integrations.py`
- `apps/api/app/services/ml_client.py`、`apps/api/app/workers/ml_health.py` 的 health 字段透传
- `apps/web/src/pages/ModelMarket/GlobalBackendFormModal.tsx`
- `apps/web/src/pages/ModelMarket/RegisteredBackendsTab.tsx`
- `apps/web/src/pages/ModelMarket/RuntimeObservePanel.tsx`
- `.env.example`、compose 中 API / 全部相关 worker 的环境透传

工作：新增显式静态字段、每卡 allocatable 映射、`off|observe|enforce`（默认 off）、配置变更 409 护栏和四级告警；平台 schema / health worker 完整保留 `compute`、`residency`、GPU UUID 和进程显存诊断字段。observe 在真实派发点计算 would-*，但绝不卸载或拒绝。

验收：单卡、同宿主双卡、两宿主同号卡聚合正确；observe 零副作用；卡容量 / budget 缺失与不合法均可在管理端看到；OpenAPI / codegen / env 文档同步。

### P3 · Redis 原子账本、lease、慢路径队列与对账

主要触点：

- 新增 `apps/api/app/services/gpu_arbiter.py`
- 如 Lua 规模需要再拆 `apps/api/app/services/gpu_arbiter_store.py`，不预先抽更多层
- `apps/api/app/workers/ml_health.py`
- `apps/api/app/observability/metrics.py`
- `apps/api/tests/test_gpu_arbiter_policy.py`
- `apps/api/tests/test_gpu_arbiter_redis.py`

工作：实现 versioned key、allocation 状态机、短卡锁、generation CAS、request lease TTL + heartbeat、backend 级全局 `max_concurrency`、慢路径 FIFO、取消 / 超时清理、bootstrap 与 60 秒 repair loop。Redis 为空时必须先从 DB 静态 claim + live backend health 重建；完成前 enforce 不得把空账本当空卡。Redis client 生命周期必须兼容 API 长驻 event loop 与 Celery 反复创建 event loop。

验收：两个独立 Redis client 模拟 API / Celery 并发时不超卖；进程在每个状态跃迁点崩溃都能收敛；卡 A 的延迟 / 锁故障不影响卡 B；unload 响应丢失不提前释放额度。

### P4 · 单卡 L2a enforce、空闲驱逐与全部入口收口

主要触点：

- `apps/api/app/services/ml_client.py`
- `apps/api/app/services/ml_backend.py`
- `apps/api/app/api/v1/ml_backends.py`
- `apps/api/app/api/v1/admin_ml_integrations.py` 的 smoke-test
- `apps/api/app/services/secondary_inference.py`
- `apps/api/app/workers/tasks.py`
- `apps/api/app/workers/frame_preannotate.py`
- `apps/api/app/services/video_tracker_adapters.py` / `video_tracker_runner.py`
- `apps/api/app/workers/predictions_retry.py`

工作：把 semaphore 与 arbiter context 组合进 `MLBackendClient`，覆盖 predict / interactive / warmup / reload / unload；注册 backend 的 smoke-test 改走受管 client，未注册 URL 在 enforce 下只能做只读 health、不得直接加载。统一 503 错误和批量失败记录；手工 unload 成功后立即对账，不等 60 秒。首个 enforce 子阶段只驱逐平台 lease 与 backend active 均已为 0 的 victim；受害者仍忙时立即返回带 `Retry-After` 的结构化 503，不在第一步启用主动 drain。

验收：可共驻、刚好容量、逐个驱逐多个空闲 victim、同级 LRU、高优先保护、busy fail-fast、完全放不下、Redis 故障、CPU fallback、warmup / reload / raw smoke-test 绕过尝试全部通过。`off` 模式的现有 ML client 行为无回归。

### P5 · L2b 有界 drain、多卡验证与防抖护栏

工作：

- 每卡独立展示 allocatable / committed / observed、resident / draining / non-evictable backend。
- 增加 admission、would-evict、eviction、drain、reject、fail-open/closed、reconcile 和 budget drift 指标。
- 在 P4 稳定后才启用 `draining`：阻止 victim 新 lease，锁外有界等待平台 lease 与 backend active 清零，超时回滚并返回 503。
- 根据 observe / canary 数据关闭 D14：采用一个有界的最小驻留 / cooldown 或 pipeline preflight 规则；不引入无界整 job pin。
- 后端删除、URL / 卡 / budget 修改前检查 allocation + active lease；首版只允许 unloaded 状态修改。
- 同宿主双卡与两宿主同号卡分别做集成测试；显式拒绝多卡 device set。

验收：active victim 能有界 drain 且不会被新请求续住；超时不误卸载；高频 pipeline 不会无界冷切；卡 0 驱逐不触碰卡 1；两卡可并行；资源映射修改在驻留 / active 时 409；默认双卡布局不会被错误整体 bypass。

### P6 · 灰度、回滚、正式文档与收尾

灰度顺序：

```text
off
  → observe 全量并校准预算
  → enforce 单张测试卡
  → 单卡多 backend canary
  → 多卡部署中的一张共享卡
  → 全部已校准共享卡
```

回滚只把模式切回 observe / off，停止新驱逐；不清 Redis、不假定真实模型已卸载，先跑一次 reconciliation，再让现有 backend 按自身 idle 策略自然收敛。API、GPU worker 和其它调用 ML client 的 worker 必须全部部署同一版本并重启后才能开启 enforce，避免旧进程绕过 gate。

## 9. 测试与验收矩阵

| 维度 | 必测场景 | 关键断言 |
|---|---|---|
| 纯策略 | `<`、`==`、`>` 容量，差 1MB，单 budget 超卡 | 选择结果确定，超卡不发 HTTP |
| 优先级 | 同级、低请求遇高 victim、高请求遇低 / 同级 | 同级 LRU；只保护严格更高者 |
| 原子性 | API + 两个 Celery client 同时准入 | allocation + lease 原子，committed 不超 allocatable |
| 快慢路径 | resident 命中、慢路径 FIFO、非 victim resident | 快路径不被无关 drain 阻塞 |
| drain | L2a busy fail-fast；L2b victim 活跃、持续新流量、超时、取消 | L2a 不冒险等待；L2b draining 后不发新 lease并有界结束 |
| generation | 卡锁 TTL 过期、旧 owner 恢复、迟到 unload | 旧写回和旧 unload 均无效 |
| backend 真值 | 客户端超时后 backend 继续算 | active 非零时不能清模型 |
| unload | 成功、失败、超时、成功但响应丢失、重复调用 | 只在可信成功后释放；不确定转 unknown |
| 对账 | idle unload、手工 unload、backend 重启、Redis flush | 丢账后先 bootstrap；最终与 health 收敛 |
| residency | image / video / PVS / 多 variant / ORT session | 任一 GPU pool 驻留即 `gpu_loaded=true` |
| CPU | configured CPU、effective CPU、None、CPU→GPU | CPU 不计费；None 保守；恢复重新准入 |
| 单卡 | 多小 backend 共驻、大 backend 驱逐、多阶段交替 | 不 OOM；驱逐 / 冷载次数可观测 |
| 多卡 | 同机两卡、两主机各 card 0、卡 A Redis 慢 | 无 key 碰撞、跨卡并行、故障隔离 |
| 管理入口 | warmup、reload、manual unload、smoke-test、删除 / 改卡 | 无加载绕过；有 active 时拒绝配置变更 |
| 模式 | off、observe、enforce、运行时回滚 | off 零回归；observe 零副作用；回滚不清状态 |
| 长任务 | SAM3 视频逐窗、job cancel、Celery revoke | 每窗租约；不整 job 霸卡；临时 ticket 清理 |
| 防抖 | task-major 不可共驻 pipeline、连续 tracker 窗口 | 驱逐频率有界；cooldown / preflight 行为确定且可观测 |
| 绕过 | 未注册 smoke-test、平台外直连加载端点 | enforce 不产生账本外 GPU residency |

验证层次：

1. 纯策略和状态机单测不依赖 GPU。
2. Redis 集成测试使用独立 key 前缀和两个以上独立 client，验证 Lua / CAS 真原子性。
3. 五 backend contract test 用 mock 模型覆盖 lifecycle，不要求 worktree 内有 GPU。
4. 主工作区合入后跑 API 定向 pytest、backend 定向 pytest、前端定向 Vitest、OpenAPI、typecheck、CSS token 检查和 docs build。
5. 真机单卡用人为缩小 allocatable / 放大 budget 强制走共驻、驱逐、拒绝；真机双卡并发验证卡间隔离，并用 `nvidia-smi` / health 仅作旁证。

每个 Redis 测试使用唯一 namespace 并在 fixture `finally` 删除；fake backend、临时 socket、探测缓存、pytest / Playwright 临时目录和真机测试生成物在测试结束后清理。不得删除运行环境原有数据或用户已有未提交产物。

## 10. 正式文档与发布检查

实施时按阶段同步，而不是最后补写：

- 架构决策：更新并接受 `docs/adr/0049-cross-backend-gpu-memory-arbitration.md`。
- 协议：`docs-site/dev/reference/ml-backend-protocol.md` 增 `compute` / `residency` / 受管 unload / generation。
- 开发概念：`docs-site/dev/concepts/ai-models.md`、`prediction-pipeline.md`、`deployment-topology.md` 说明真正的跨进程并发闸、逐卡治理与多卡边界。
- 运维：`docs-site/ops/deploy/docker-compose.md`、`observability/index.md`、`runbooks/ml-backend-down.md` 增配置、告警、排障和回滚。
- 用户手册：`docs-site/user-guide/superadmin/model-market.md`、`ml-backend-registry.md` 与项目 ML backend / 预标文档更正 `max_concurrency` 语义，并增加卡预算、驻留 / 驱逐状态和配置 blocker。
- 环境变量：更新 `.env.example`，运行 `pnpm docs:gen-env-vars`，核对 worker / production compose 透传。
- 用户可见变更按类型写入 `CHANGELOG.md` 的 `Unreleased`，正式文档只描述当前状态，不写可见版本流水账。
- API / schema 变化刷新 OpenAPI snapshot 与前端 codegen，并检查 SDK 手写类型是否同步。

## 11. 待 CPU fallback agent 完成后的复核清单

- [ ] 记录该 agent 的 commit、实际改动文件与测试结果，不只依据原计划文本。
- [ ] 冻结 `compute.configured_device`、`effective_device`、`effective_provider` 的空值和兼容语义。
- [ ] 确认五 backend `/health`、平台 `health_meta`、PerfHud 和管理 UI 都没有再次丢字段。
- [ ] 补审 SAM3 image / multiplex / PVS 三条路径与 RapidOCR / ONNXTools 实际 provider。
- [ ] 确认 CPU latch 后何时释放 GPU allocation、何时允许再次尝试 GPU。
- [ ] 重新跑本计划涉及的 `rg` 审计，更新已漂移的文件 / 行号与 P1 触点。
- [ ] 将 D1–D14 的最终选择写回 ADR-0049，完成评审并改为 Accepted。
- [ ] 基于最终 ADR 把本文件从 draft 改为 ready，必要时删去未采纳分支，不保留双方案。

## Outcome

待实施后回填：各阶段 commit、正式文档路径、灰度结果、预算校准数据、测试记录与未尽事项。
