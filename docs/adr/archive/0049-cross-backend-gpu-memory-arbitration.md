# 0049 — 按物理 GPU 资源进行跨 Backend 显存预算准入与驱逐

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** core team
- **Supersedes:** —

## Context

平台以“一 backend 一容器”的方式运行 Grounded-SAM2、SAM3、YOLO、ONNXTools 与 RapidOCR，
每个容器静态绑定一张物理 GPU。静态绑卡只能把不同卡上的负载隔开，不能治理同卡竞争：默认双卡布局中
SAM3 使用卡 1，其余四个 backend 仍共用卡 0；单卡部署则五个 backend 都可能竞争同一张卡。

竞争发生时，模型加载可能直接 OOM，也可能在 CUDA 分配失败和重试后表现为冷启动骤增、推理超时或
静默 CPU fallback。单纯调大请求超时会掩盖根因。现有能力不足以安全自动驱逐：

- `MLBackendClient` 的 semaphore 只在单个进程和 event loop 内生效，API 与多个 Celery worker 之间没有
  统一并发闸；
- `/health.compute` 已能诊断配置设备和实际计算路径，但不能证明所有 GPU pool、ORT session 或 tensor
  cache 已释放；
- legacy `/unload` 没有统一的全池释放、active/draining 和 generation fencing 契约，不能作为减记显存的
  可靠依据；
- `gpu_info.memory_used_mb` 是共享卡的整卡视角，无法按 backend 相加，活体测量不能直接充当准入账本；
- 不同 GPU 主机都可能暴露容器内 `cuda:0`，裸 device index 不能标识跨容器的同一物理资源；
- 平台外直连 predict、warmup 或 reload 可以绕开平台派发路径，单靠客户端 gate 不能提供 OOM 安全保证。

候选方案如下：

| 方案 | 优点 | 主要问题 |
|---|---|---|
| **逐物理卡静态预算准入 + 优先级加权 LRU 驱逐** | 小 backend 可共驻；共享卡受控；不同卡并行 | 需要 Redis 原子账本、受管生命周期、对账与防抖 |
| 单驻留 exclusive group | 实现简单、不会超售 | 多阶段 pipeline 会在阶段间频繁卸载和重载 |
| 仅告警 | 无派发风险、实施成本低 | 只能暴露问题，仍需人工卸载，不能消除竞争 |
| 活体显存测量准入 | 看似贴近真实用量 | 共享卡数据无法可靠归因，容易重复计费或漏计 |
| 多卡自动放置 / backend 多副本 | 能提高整机利用率 | 改变当前静态部署和路由模型，属于独立 epic |

## Decision

采用**按稳定 `gpu_resource_id` 分片的静态显存预算准入，并在同一物理资源内按
`eviction_priority` + LRU 有界驱逐**。PostgreSQL 保存静态资源 claim 与 durable fencing high-water，Redis
保存运行时 allocation、request lease、队列与 fencing 副本。单卡和多卡采用同一模型：共享卡执行仲裁，实际独占卡自然命中
无受害者快路径，不允许按“整机是否多卡”整体绕过。

本 ADR 接受的是架构决策，不代表仲裁已经实现或可以开启。运行模式默认保持 `off`；只有各阶段的实现与
验收完成后才能依次进入 `observe` 和 `enforce`。

### 冻结决策

| ID | 决策 |
|---|---|
| D1 | `compute` 只作诊断。SAM3 明确 GPU-only；ORT 只报告实际业务 session provider；allocation 释放不读取 `compute`。 |
| D2 | 驱逐字段命名为 `eviction_priority`；只保护严格更高优先级，`victim.eviction_priority <= requester.eviction_priority` 可被选，同级按 LRU。 |
| D3 | 单卡、多卡统一逐 `gpu_resource_id` 治理；共享卡仲裁、独占卡快路径，禁止整机级 bypass。 |
| D4 | registry 显式引用稳定 `gpu_resource_id`；优先绑定 GPU / MIG UUID，取不到时使用显式 resource domain + physical token，禁止用容器内 `cuda:0` 猜测物理身份。 |
| D5 | `residency.gpu_loaded` 是释放 allocation 的唯一 backend 真值，并聚合逐 pool device/provider、active、draining 与 generation。 |
| D6 | 只有通过受管 full-pool unload 与 fencing 契约的 backend 才能 `evictable=true`；其他 backend 固定 non-evictable 并保守计费。 |
| D7 | 卡锁只覆盖短状态跃迁；generation high-water 持久化后再签发 fencing token，backend 拒绝旧 generation。 |
| D8 | Redis request lease 与 backend active/draining 双层保护；lease、active operation、builder 或 borrower 任一未清零都不得卸载。 |
| D9 | `vram_budget_mb` 是部署配置下的保守最大运行工作集；未校准 backend 按整卡 `allocatable_mb` 计费。 |
| D10 | `off` / `observe` 保持现有业务路径；`enforce` 对所有 GPU resource 在 Redis 或仲裁器不可用时 fail-closed，独占卡没有隐式例外。 |
| D11 | registry 只新增算法实际读取的强类型列；不引入 `exclusive_group`，整卡保护由 `budget == allocatable` 表达。 |
| D12 | 本地 semaphore 保留为进程内背压；Redis request lease 执行 backend 级全局 `max_concurrency`，stale lease 在 backend 仍 active 时继续保守占用。 |
| D13 | `enforce` 下所有可能加载 GPU 的 predict / warmup / reload / unload 端点必须验证短期 admission token；平台与 backend 通过 control epoch 握手 enforce gate，生产网络同时限制加载端点直连，只读 health / setup 可豁免。 |
| D14 | 每次新 residency 写入 `not_evict_before`；慢路径按卡 FIFO 有界等待，超时返回结构化 503 与 `Retry-After`，不采用无界 job pin 或 pipeline 特判。 |
| D15 | admission token 使用带 `kid` 的 Ed25519 / EdDSA compact JWS；平台签发进程独占私钥，backend 只持可重叠轮换的公钥 keyring，禁止复用用户 JWT key 或把可签名秘密下发给 backend。 |

### 资源与静态配置

每个 registry backend 本期最多声明一个资源：

```text
gpu_resource_id = <resource_domain>/<physical_device_token>

gpu-node-a/GPU-6ab3...
gpu-node-a/index:0
gpu-node-b/index:0
```

resource domain 必须由运维显式配置，不能从 backend URL hostname 推断。资源表由
`GPU_ARBITER_RESOURCES_JSON` 提供 `gpu_resource_id -> {node_id, physical_device_token,
allocatable_mb, mode}`；`allocatable_mb` 是扣除驱动、CUDA context、桌面 / 系统进程、外部占用和安全余量后的
可分配容量，不等于显卡标称总显存。

逐卡灰度采用“全局安全开关 + 每资源模式”：`GPU_ARBITER_MODE=off|observe|enforce` 是全局上限和
紧急回滚开关，默认 `off`；resource 可以在 `GPU_ARBITER_RESOURCES_JSON` 中声明同一三态，缺失时安全地
按 `off`，但要进入 observe/enforce 必须显式声明。资源的 desired mode 取两者中更保守者
（`off < observe < enforce`）。因此可以只把
一张测试卡提升到 enforce，而其他卡继续 observe；把全局模式切回 observe/off 会立即停止所有资源的新驱逐。

`ml_backend_registry` 使用强类型静态列：

- `gpu_resource_id: str | null`：显式 CPU backend 为 `null`；GPU backend 即使运行时 fallback 到 CPU，
  仍保留原 resource claim；
- `vram_budget_mb: int | null`：覆盖所有允许共存的 image / video / variant pool、并发临时 buffer、最大视频
  窗口和安全余量；
- `eviction_priority: int = 0`：越大越难被驱逐，不表示请求排队优先级。

单 backend budget 超过卡容量、资源缺失、未知资源、多 device set 或其他不完整 claim 都是配置 blocker。
同卡所有 backend 的静态预算和超过 `allocatable_mb` 只是允许驱逐的弹性超售 warning。活体整卡用量只用于
预算漂移和平台外占用告警，不进入准入计算。已有 allocation 或 active lease 时禁止修改 URL、资源映射或
预算，首版要求先 drain + unload，不做热迁移。

### 受管 Backend 生命周期

五个 backend 在保留既有 `compute`、`loaded` 和 pool 展示字段的同时，提供统一 `residency`：

```json
{
  "residency": {
    "state": "resident",
    "gpu_loaded": true,
    "active_requests": 0,
    "draining": false,
    "evictable": true,
    "generation": "42",
    "pools": {
      "image": {"resident": true, "device": "cuda:0", "provider": null},
      "video": {"resident": false, "device": null, "provider": null}
    }
  }
}
```

- 任一 GPU image pool、video pool、variant、ORT session 或 GPU tensor cache 驻留时，
  `gpu_loaded=true`；逐 pool device/provider 不可读时按 unknown 保守计费；
- `residency.state` 固定为 `unloaded|loading|resident|draining|unloading|unknown`；CPU fallback 与 mixed
  不另造 state，而由 `compute`、`gpu_loaded` 和逐 pool device/provider 联合表达；
- `pools` 以稳定 pool id 为 key，每项至少包含 `resident: bool | null`、`device: str | null`、
  `provider: str | null`；其中 `resident` 专指该 pool 是否仍持有 GPU residency，纯 CPU handle 应报告
  `resident=false` 并用 `device=cpu` 或 CPU provider 表达；
- `compute=cpu` 与 `gpu_loaded=true` 是合法 mixed 状态，不能据此减账；只有可信确认
  `gpu_loaded=false` 才释放 allocation；
- 受管 `/unload` 必须清空全部 GPU pool/session/cache，并返回实际 generation；predict、warmup 与 reload
  进入 backend active guard，draining 后拒绝新工作；
- 受管 unload 只在 backend active 为 0 且 generation 匹配时执行；旧 generation 的调用不得卸载新一代
  已重新加载的模型；
- 不实现该契约的 backend 仍可运行并计费，但 `evictable=false`；不从管理员开关或一次 health 推测
  evictable；
- 不为此抽统一 backend 基类；各 backend 在现有 pool 和 lifecycle lock 边界最小改造，共享协议 schema 与
  header 常量。
- backend active 真值必须覆盖等待 pool、模型构建、executor/threadpool future、推理和仍持有模型/engine 的
  borrower；HTTP coroutine 超时或取消不能让仍在运行的底层 future 提前减 active。pool 只可淘汰
  borrower=0 的 entry，全部繁忙时返回可重试错误，不能从索引删除仍被局部变量使用的 GPU 对象。
- 同 key 构造必须 single-flight；提交 builder/executor 前在 pool 锁内原子预留 build slot，并始终满足
  `resident_entries + reserved_build_slots <= cap`。没有空 slot 或可淘汰的 idle entry 时返回可重试错误；
  构建失败、超时或取消只在底层 future 真正结束后释放 reservation。
- 一个 registry backend URL 只能对应一个生命周期状态域。当前单进程/单 worker 部署可使用进程内 guard；
  多 worker 或多副本必须分别注册，或把 active、state、generation、borrow 与 replay 状态放入共享外部存储。

#### 受管生命周期 wire

受管 workload 与 drain/unload transition 使用两个独立 header，不复用 backend 的 `Authorization`：

- `X-AAP-GPU-Generation: <canonical positive int64 string>`；
- `X-AAP-GPU-Admission-Token: <compact EdDSA JWS>`。

token 固定使用 Ed25519 / EdDSA 签名，protected header 必须是
`{"alg":"EdDSA","typ":"aap-gpu+jwt","kid":"<key-id>"}`。平台 API / Celery 签发进程从 secret
store 读取私钥，backend 只接收 `kid -> Ed25519 public key` keyring；私钥不得进入 GPU backend，且不得复用
用户登录 JWT 的 `SECRET_KEY`。未知 `kid`、其他算法、其他 token type 或验签失败一律按 admission denied
处理，不能根据 token header 动态选择算法。

claims 的 wire 名固定为 `aud`、`backend_registry_id`、`gpu_resource_id`、`boot_id`、`generation`、
`control_epoch`、`scope`、`jti`、`exp`，transition/control token 另含 `owner` 与 `operation`。`aud` 固定为
`aap-gpu-lifecycle`；scope 为
`predict|warmup|reload|drain|unload|resume|mode|reset` 之一。header generation、token
claim 与 transition body 中的 generation 必须完全一致。generation 与 control epoch 在 JSON、token 与 health
中始终编码为无符号、无前导零的十进制字符串，取值 `1..9223372036854775807`，避免 JavaScript 整数精度
问题；`exp` 仍使用标准 JWT NumericDate 整数。`scope=mode|reset` 是例外：它只携带 control epoch、不携带
模型 generation，也不要求 generation header。

轮换采用先扩后缩：先把新公钥与旧公钥同时部署到所有 backend，再让 signer 切换 active `kid`；只有旧
token 全部过期且对应 replay tombstone / lease 已安全收敛后，才能移除旧公钥与私钥。无法加载 keyring、找不到
active signing key 或 backend 尚未确认新 keyring 时，资源不具备 enforce readiness。

workload token 的 `jti` 就是 Redis request lease id。backend 必须在自己的单一生命周期状态域内原子消费，
并把 replay tombstone 保留到 token 过期；普通 predict/warmup/reload token 不可重放。transition token 的
`jti` 绑定 Redis transition owner 与 operation；相同 owner、route、generation 的重试必须 single-flight / 幂等，
不同 operation 或 owner 不能复用 token，也不能执行第二次清理。
token `exp` 不得晚于对应 lease / transition owner 的 hard deadline。平台只有在明确证明请求未被接受或已经
完成后才删除 capability record；timeout/cancel/断连等不确定结果必须保留计费记录，使尚未消费的迟到 token
在有效期内仍对应一份真实 lease，而不是绕过全局并发。

generation 是 fencing epoch，不是模型 load id，也不由 backend 自行生成。PostgreSQL 的
`gpu_backend_fences` 为每个 registry backend 持久化单调 `generation_high_water` 与
`control_epoch_high_water`。建立新的 allocation ownership、drain owner 或 cancel 时，平台先原子推进
generation high-water；建立新的 mode/reset 控制 operation 时先推进 control-epoch high-water；同一
drain -> unload、mode/reset operation 的后续 token 与幂等重试复用已取得的 epoch。副本随后写入 Redis。
Redis flush、
API/Celery 重启或所有 backend 同时重启都不能令 high-water 回退；若 durable high-water 不可信，则
`enforce` 保持 `gpu_arbiter_not_ready`，不得从 1 猜测重建。

同一个 drain -> unload operation 在同一 generation 内完成；新的 allocation、drain ownership 或 drain cancel
才取得更大 generation。普通 workload 只能使用 backend 当前 generation；旧值拒绝。只有
`active_requests=0`、所有 builder/borrower 均为 0 且 `gpu_loaded=false` 时，新的 allocation 才能采用更大
generation。managed unload 成功后保留 unloaded generation tombstone，同 generation workload 仍不得重载。

受管 drain 固定为三步：

1. `POST /drain {"generation":"<new_g>"}`：`new_g > current`，原子进入 draining 并停止接收新 workload；
2. `POST /unload {"generation":"<same_g>"}`：仅 current generation 匹配且处于 draining 时执行。
   active/builder/borrower 任一非零时返回冲突并保持 draining；全部归零后，先在短生命周期锁内 CAS 为
   unloading，再在锁外执行全池清理；
3. 超时或放弃使用 `POST /drain/cancel {"generation":"<newer_g>"}`：只允许从 draining 进入新的
   generation 并恢复接单；一旦进入 unloading 就不能 cancel，从而使迟到 unload/cancel 均被 fencing 拒绝。

响应至少包含：

- drain / cancel：`{ok,generation,draining,active_requests,ready_to_unload,residency}`；
- managed unload：`{ok,generation,unloaded,unloaded_count,residency}`。

`residency.gpu_loaded` 与逐 pool `resident` 为 `bool | null`；只有显式确认所有 pool 的 GPU residency 均为
`false`，且 GPU session/cache、builder 与 borrower 均为空时，才能返回 `gpu_loaded=false`；managed unload
成功还必须返回 `state=unloaded`。清理异常必须返回
`state=unknown,gpu_loaded=null`，平台保持计费。错误沿用现有 FastAPI envelope：
`{"detail":{"error_code":"...","message":"..."}}`。

- draining workload：`503 gpu_backend_draining` + `Retry-After`；
- active unload：`409 gpu_backend_active`；旧 generation：`409 gpu_generation_conflict`；非法状态跃迁：
  `409 gpu_transition_conflict`；
- generation 格式错误或 header/body/token 不一致：`422 gpu_generation_invalid|gpu_generation_mismatch`；
- enforce 下 token 缺失、过期、audience/scope/backend/lease 不符或重放：`403 gpu_admission_denied`；
- 清理异常：`500 gpu_unload_failed`。

`/health` 始终免 token、可读并返回 200。

`/setup.managed_lifecycle` 用于发现能力：

```json
{
  "protocol_version": "1",
  "generation_fencing": true,
  "drain_endpoint": "/drain",
  "drain_cancel_endpoint": "/drain/cancel",
  "unload_endpoint": "/unload",
  "mode_endpoint": "/lifecycle/mode",
  "reset_endpoint": "/lifecycle/reset",
  "generation_header": "X-AAP-GPU-Generation",
  "token_header": "X-AAP-GPU-Admission-Token"
}
```

缺少该声明的 backend 固定 non-evictable。运行时 `/health.residency.evictable` 只有在当前 residency 受 managed
generation 约束且 full-pool unload 可验证时才为 true。

平台资源配置是三态 mode 的唯一 desired-state 真值；backend 不复制三态，只维护
`lifecycle_gate=legacy|enforce`。平台 `off` 与 `observe` 都映射为 backend `legacy`：P2 observe 只是平台 shadow
决策，backend 可继续接收 headerless workload，不依赖 P3 的 durable control epoch。backend 启动为 legacy。

只有 promotion 到 enforce 才通过受签名
`POST /lifecycle/mode {"gate":"enforce","control_epoch":"<n>"}` 建立 gate，`/health.residency` 回报
`lifecycle_gate` 与 `control_epoch`。promotion 必须先完成账本 bootstrap，再暂停该资源新 workload、让所有
相关 backend 确认目标 control epoch，最后切换平台 effective mode；任何 backend 未确认时资源保持 not-ready。
demotion 会先立即停止新 drain/eviction，同时继续以旧 enforce epoch 发送已获准 workload，再让 backend 确认
`gate=legacy`；只有全部确认后平台才进入 observe/off。确认失败时保持 enforce 或 fail-closed，绝不能出现
平台 legacy、backend enforce（或反向）的 split-brain。

mode endpoint 只允许平台控制网络访问；backend 重启后在新的 durable control epoch 握手完成前不具备
enforce readiness，平台不得派发 enforce workload。off/observe legacy 路径不受此握手阻断。迟到的更小
control epoch 一律拒绝。

backend 每次进程启动生成随机 `boot_id` 并由 `/health.residency.boot_id` 暴露；所有 mode、reset、workload 与
transition token 必须绑定该值。平台只能在读取当前 boot_id 后签发 token，因此前一进程尚未过期的 token 在
新进程中一律无效。`/lifecycle/mode` 对相同 boot_id + control epoch + gate + owner 的重试返回同一成功结果；
同 epoch 不同 gate/owner 或更小 epoch 返回 `409 gpu_transition_conflict`。

backend 在首次有效的 `scope=mode|reset` 控制调用中，把 token 的 audience、registry id 与
`gpu_resource_id` 原子绑定到当前 boot 的 lifecycle domain；后续所有 token 必须 exact-match，并在 health 中
回报绑定身份。相同 canonical URL 指向多个 registry id、URL alias 指向同一进程或单 URL 背后存在多个独立
进程状态域都是 enforce 配置 blocker。

mode 切换使用资源级 barrier。promotion/demotion 都先停止签发新 admission，等待旧 control epoch 的 token
已经被 backend 原子消费并完成，或被撤销/过期且相应 lease 已安全收敛，再推进 backend control epoch。
多 backend partial ACK 时资源进入 mode-transition fail-closed；若放弃切换，平台必须用更大的补偿 control
epoch 把已切换 backend 恢复到原 gate并等待全部确认，不能在混合 gate 下继续派发。

unmanaged residency 的 enforce 清场不复用不可信 legacy unload，也不把非空 `generation=null` 直接收编为
managed workload。平台在 legacy gate 下先暂停该资源 workload并限制直连，确认 active/builder/borrower 为 0，
再以绑定当前 boot_id 的 `scope=reset` token 调用
`POST /lifecycle/reset {"control_epoch":"<n>"}`。backend 在短生命周期锁内再次确认零活跃并进入 unloading，
随后执行可验证的 full-pool cleanup；成功返回 `generation=null,state=unloaded,gpu_loaded=false`，失败返回
Unknown/null 并阻断 promotion。health 再次确认空池后，平台才用更大的 control epoch 建立 enforce gate 和新的
managed generation。reset body 与 token control epoch 必须 exact-match；相同 boot_id + epoch + owner 的 reset
重试 single-flight 幂等，同 epoch 不同 owner/operation 或更小 epoch 返回 `409 gpu_transition_conflict`。
active 时返回 `409 gpu_backend_active`。

off 下无 header 的 predict/warmup/reload 与无 body 的 legacy `/unload` 保持原行为和响应；observe 不阻断；
enforce 才强制 generation + token。health/setup 始终豁免。off/observe 下任何未通过有效 token + generation 的
workload 都是 unmanaged：若命中原 managed residency，立即保守 taint 为
`generation=null,evictable=false`，直至受签名 reset 可信 full-unload 后以更大 generation 冷启动。进入
enforce 前必须先把所有 generation=null 的既有 residency 通过 `/lifecycle/reset` 清空并由 health 确认
`gpu_loaded=false`，不允许直接收编。
无法参与 mode handshake 与 token 校验的 backend 或 admission proxy 会形成资源级 enforce blocker。

### Redis 账本与状态机

Redis key 使用版本化 namespace，并让同一卡的 key 进入同一 Redis Cluster hash slot：

```text
resource_tag = sha256(exact gpu_resource_id)
gpu-arbiter:v1:{resource_tag}:card
gpu-arbiter:v1:{resource_tag}:allocations
gpu-arbiter:v1:{resource_tag}:queue
gpu-arbiter:v1:{resource_tag}:backend_queue:<backend_id>
gpu-arbiter:v1:{resource_tag}:leases:<backend_id>
gpu-arbiter:v1:{resource_tag}:transition
```

花括号内是 Redis Cluster hash tag，不直接放未经编码的资源 ID。`resource_tag` 对完整
`gpu_resource_id` 做确定性 SHA-256，避免资源 ID 自带花括号时改变分槽；`card.resource_id` 仍保存原始值，
所有原子脚本都必须 exact-match 原始身份，摘要碰撞或 key 身份不一致时 fail-closed。

逐资源 key、队列和 transition owner 隔离的是逻辑状态与应用层 head-of-line blocking；standalone Redis 的
命令执行仍是共享延迟域。Lua 必须保持有界，Redis 服务整体拥塞或不可用仍按 D10 作为基础设施故障处理，
不能把 hash slot 设计误写成当前部署已经具备物理延迟隔离或 Redis Cluster client 能力。

PostgreSQL 保存静态 claim 与 `gpu_backend_fences` 的 generation/control-epoch high-water 持久 fencing 真值；Redis 保存运行时
allocation、generation 副本、LRU、FIFO ticket 和带 heartbeat 的 request lease。驻留 allocation 不设置自动
过期；只有 queue、lease 和 transition owner 有过期 / 接管语义。`committed_mb` 由计费状态的 allocation
集合原子求和或校验，不用容易漂移的裸增减计数。

allocation 状态至少包含 `Unknown`、`Unloaded`、`Reserving`、`Loading`、`Resident`、`Draining`、
`Unloading` 与 `CpuFallback`。`Unknown` 保留上一份 budget，直到可信 health 确认 `gpu_loaded=false`。
Redis 为空时必须先从 PostgreSQL claim、durable generation high-water 与 live backend health bootstrap；
重建完成前，`enforce` 不得把空账本当作空卡。health generation 高于 durable high-water、数据库恢复点不可信
或身份不一致时保持 not-ready 并要求显式灾难恢复，不得自动降低 generation。60 秒 repair loop 收敛
idle/manual unload、backend 重启、Redis flush 和不确定写回。

repair 调用方必须提交不晚于 Redis `TIME` 后五分钟的绝对证据 deadline，并由成功重建将它冻结到账本；
重建只能在该期限内，以 revision + incarnation 双重 CAS 原子提交。allocation、lease、卡级与 backend 级 FIFO、transition 的镜像
计数必须覆盖完整权威域，任何部分删除、身份不匹配或超出有界输入都保持 not-ready。完整 flush 或 revision
接近精度上限时轮换 incarnation，避免同 revision 的 ABA；响应丢失后的同 owner 精确重试只读幂等。queue、
lease 与 transition 是否过期以逻辑 deadline 为准，Redis 物理 TTL 只负责最终回收。

bootstrap/repair 的 backend 域必须来自独立持久化 membership，包含当前成员及尚未确认 Redis child 全部收敛
的 retired tombstone。活动 registry 行不是封闭域；Lua `KEYS`/`SCAN` 也不能作为遗漏 key 不存在的证明。
`gpu_backend_memberships` 与 fence 现在独立于 registry 生命周期：GPU claim 与 pending membership/fence 在同一
数据库事务建立，资源迁移或 registry 删除先把旧成员冻结为 retiring tombstone，并保存 health、generation、
control/runtime epoch 与令牌过期高水位；membership 以 RESTRICT 外键阻止 fence 高水位先行删除，同一
backend 最多一个 pending/active 成员，retiring tombstone 清理前禁止同资源重入。pending 只能在 exact
registry claim 仍匹配时，以创建时的 runtime baseline 为基准，在同一短事务新推进一档 epoch 后转 active；
membership 的 backend/resource 身份不可原地改写，membership epoch 不可回退或跳变；只有 registry
已撤销旧 claim 时才可将旧行原位转 retiring 并严格推进一档。retiring 行的冻结证据在
proof-backed GC 落地前禁止 UPDATE/DELETE。探活网络调用后锁定 registry 行并用
新语句重读 membership epoch；所有会推进 epoch 的配置变更立即清空旧 health，从而阻止配置变化、行锁等待
与 A→B 竞态写入旧证据。进入正 runtime epoch 后，直接修改端点、claim、预算、
优先级、并发参数或硬删除 registry 会被服务层与数据库 trigger 双重拒绝，必须走受管退役。退役时冻结的
health 只作诊断快照，不得代替 GC 所需的 live health。

签发 capability 前必须锁定 exact active membership。token/activation 使用 membership→fence 锁序；registry
mutation 由 registry row→membership→fence trigger 线性化，服务层不得反向预锁 membership。需要新 generation/control epoch 时，fence 与令牌时域
在同一事务推进；复用既有 epoch 的普通 workload 使用 horizon-only 更新。两条路径都必须 UPDATE-only
单调持久化 `token_expiry_high_water`，缺失 fence 视为持久状态损坏，禁止从 1 重建。Redis 连续性丢失后，
只有该时域已过且取得时域之后的 live-idle health，或完成更强的受签 reset，才可恢复 ready。
Redis 还必须区分 all-domain 与 active-domain，以 revision/incarnation CAS 原子扩缩域和清理 retired child；
partial corruption 只能通过封闭域、令牌时域和 live health 共同证明的 reset 修复。只有 health、token、lease、
队列、transition 与 Redis 域均确认收敛后才能清除 tombstone。

API lifespan 与 Celery 中反复 `asyncio.run` 会创建不同 event loop。实现不得跨 loop 复用 module-global
`redis.asyncio` client/pool；必须按 event loop 管理并显式关闭，或封装同步 Redis 调用，并用重复创建和销毁
event loop 的测试证明连接生命周期正确。

### 原子准入与驱逐

请求顺序固定为：

1. 先取得现有 per-backend 本地 semaphore，避免本进程内排队请求提前占用 Redis lease；
2. `off` 不访问仲裁 key；`observe` 只记录 would-admit / would-evict / would-reject；`enforce` 才进入
   对应 `gpu_resource_id`；
3. 在短卡锁 / Lua 原子区内同时检查 allocation 和全局 lease。backend 达到 `max_concurrency` 时进入该
   backend 自己的 FIFO 队列并在锁外有界等待，不占住卡级 allocation 队列；
4. target 已 resident、未 draining 且有全局许可时，原子创建 request lease、更新 LRU 后走快路径；
5. target 未 resident 且容量足够时，先持久取得新 generation high-water，再原子创建 `Reserving`
   allocation、generation 副本与 request lease；
6. 容量不足时，只从同卡 `evictable=true`、cooldown 已到期且
   `victim.eviction_priority <= requester.eviction_priority` 的 allocation 中按
   `(eviction_priority asc, last_used_at asc)` 选择足够受害者；为每个 victim 持久取得新 generation，绑定
   transition owner 并在 Redis 标记 `Draining`；
7. 卡锁外调用 backend `/drain`，只有明确成功后才等待平台 lease、backend active、builder 与 borrower
   全部归零。首个 enforce 阶段只选择已经空闲的 victim，但仍必须先完成 `/drain`，消除检查后新请求插入；
   后续阶段才对 busy victim 做有界等待；
8. 同 generation 调用受管 `/unload`，再进入短原子区以 transition owner + generation CAS 提交卸载结果并
   为 target 预留；旧 owner 的迟到结果无效。drain 超时先用更新 generation 调用 `/drain/cancel`；只有
   cancel 响应与账本 CAS 都可信成功才回滚 Resident，否则转 Unknown 并保守计费；
9. backend workload 明确完成，或明确未被 backend 接受时，才以 lease owner token 幂等 release request
   lease。timeout/cancel/断连时停止 owner heartbeat并把 lease 标记 uncertain/stale，继续占全局并发与
   allocation；只有 token 已过期且 health 可信确认 active/builder/borrower 全为 0 后，reconcile 才能清理。
   确定成功且 `gpu_loaded=true` 转 `Resident`；可信确认
   `gpu_loaded=false` 可转 `CpuFallback` / `Unloaded` 并释放预算；超时、断连、响应丢失或 residency 不可读
   一律转 `Unknown` 保守计费。

已 resident 且不参与 drain 的 backend 不因同卡另一个慢请求无条件 head-of-line blocking。需要新 allocation
或驱逐的慢路径按卡 FIFO。视频追踪按现有窗口逐次持 lease，不锁整个作业；每窗结束重新参与排队。
drain 推进 generation 后，旧 generation 的合法在途 workload 仍可凭自己的 lease owner token heartbeat 和
release；它只能操作自己的 lease，不能更新 allocation、transition 或 LRU。

### 不变量

资源与容量：

1. 一个 backend 只能 claim 一张物理卡；显式 CPU backend 不进入 GPU 账本。
2. `committed_mb` 等于该卡所有 `reserving/loading/resident/draining/unloading/unknown-conservative`
   allocation 的预算和。
3. `enforce` 下任何成功的新准入都满足 `committed_mb <= allocatable_mb`；检测到超额漂移后停止新增承诺。
4. 一张卡的锁、队列、状态跃迁或 backend 故障不能阻塞另一张卡；共享 Redis 整体不可用按 D10 处理。

驱逐与并发：

1. 同级 backend 可按 LRU 驱逐，严格更高 `eviction_priority` 的 backend 受保护。
2. allocation 预留与 request lease 创建原子完成，不存在“已准入但尚未记 inflight”的窗口。
3. 同一 backend 的有效 Redis request lease 不超过 `extra_params.max_concurrency`。
4. lease heartbeat 过期只证明调用方失联；backend 仍 active 时继续占用并发许可和 allocation。
5. victim 进入 draining 后不再接收新 lease；平台 lease 与 backend active 都为 0 后才能卸载。
6. 卡锁不覆盖 drain、HTTP unload 或整个 predict；长操作由 generation fencing 与 CAS 保护。
7. 旧 generation 不能写回 allocation/transition/LRU，也不能卸载新 generation 的模型；合法在途请求仅可
   heartbeat / release 自己的 request lease。
8. 卸载成功但响应丢失、backend 不可达或结果不确定时继续保守计费。

用户行为：

1. `off` 不访问仲裁 Redis key，不改变现有请求顺序、错误或性能。
2. `observe` 不调用 unload、不拒绝业务；唯一允许的状态变化是把未经有效 token/generation 的 residency
   保守标记为 unmanaged，不能保留 evictable 资格。
3. `enforce` 在发 backend HTTP 前返回统一结构化错误；交互式、批量、二次推理与视频路径使用同一根因语义。
4. CPU fallback 与容量拒绝可区分；预算不足不能用静默 CPU fallback 掩盖。
5. 不同卡的账本、锁、队列与受害者选择完全隔离；不做跨卡迁移或动态放置。

### 错误契约

错误响应沿用 FastAPI envelope，以稳定的 `detail.error_code` 和可选 `detail.message` 表达；有明确重试窗口时
携带 `Retry-After`：

| `detail.error_code` | 触发条件 | HTTP 行为 |
|---|---|---|
| `gpu_arbiter_not_ready` | bootstrap / reconcile、durable fence 或 mode transition 尚未建立可信状态 | `503`，不调用 backend |
| `gpu_capacity_unavailable` | 合法配置下容量不足、无可驱逐 victim，或 admission 等待超时 | `503`；可估算时带 `Retry-After` |
| `gpu_backend_concurrency_saturated` | backend 全局 lease 达上限且 FIFO 等待超时 | `503` + `Retry-After` |
| `gpu_drain_timeout` | victim 在有界时间内未达到 lease/active/builder/borrower 均为 0 | `503` + `Retry-After`；仅 cancel + generation CAS 均确认后回滚 Resident，否则转 Unknown |
| `gpu_arbiter_unavailable` | `enforce` 下 Redis、durable fence 存储不可用或原子操作失败 | `503`，对所有 GPU resource fail-closed |
| `gpu_config_invalid` | resource、budget、allocatable、device set 或 backend identity / URL 状态域配置缺失 / 非法 | 配置写入时 `422`；历史坏配置在派发时 `503`，均不调用 backend |
| `gpu_backend_retirement_required` | backend 已进入正 runtime epoch 后仍尝试直接修改端点、claim、预算、优先级、并发参数或硬删除 registry | `409`；保持原配置，必须改走受管退役流程 |

### 阶段门禁

- P0：接受本 ADR，只冻结设计；不代表自动仲裁可用。
- P1：五个 backend 完成 residency、active/draining、全池 unload、generation fencing 与 admission token 契约。
- P2：强类型静态 claim、配置 blocker、四级告警与 `observe` 模式完成。
- P3：Redis 原子账本、lease、FIFO、跨 event-loop client 生命周期、fail-closed 重建原语以及独立
  durable membership/tombstone 已完成；Redis 双域演进、live health 与 bootstrap/repair worker 接通后才算通过。
- P4：全部平台派发入口收口，首个 `enforce` 仅驱逐空闲 victim。
- P5：启用有界 drain、cooldown、防抖以及单卡、多卡和多主机同号卡验证。
- P6：按 `off -> observe -> 单卡 enforce -> 共享卡逐卡灰度` 推进，并验证回滚和生产网络限制。

P1–P5 的对应验收未通过前不得开启 `enforce`。ONNXTools 在真实运行实例与完整生命周期契约验证完成前保持
non-evictable，不进入 enforce allowlist。

## Consequences

正向：

- 同一套逐资源模型覆盖单卡、多卡共享和多主机同号卡，不会把不同物理资源误合并；
- 小 backend 能在预算内共驻，空间不足时得到可解释、可观测且有界的驱逐或拒绝；
- request lease 与 backend active 双层保护消除跨进程“边算边卸载”和全局并发上限失真；
- generation fencing、锁外网络调用和 unknown 保守计费避免迟到 unload 与响应丢失提前释放额度；
- `off` / `observe` / `enforce` 提供可验证的渐进上线；回滚会立即停止新驱逐，并通过 control epoch 握手避免平台/backend mode split-brain。

负向：

- 静态预算需随模型变体、视频窗口与并发参数校准，配置不准会降低利用率或形成 blocker；
- Redis 进入 `enforce` 派发热路径，基础设施故障会按 fail-closed 阻断 GPU 请求；
- 五个 backend 都要维护真实 pool residency、active/draining 与全池 unload，生命周期测试面显著扩大；
- 两个互相放不下的大 backend 交替时仍需承担冷重载，cooldown 只能限制频率，不能消除物理成本；
- admission token 与生产网络策略是安全保证的一部分，部署不同版本或保留直连会把语义降级为 best-effort；
- Redis、backend health 与真实显存之间存在对账窗口，必须持续观测 unknown、drift 和 repair 指标。

## Alternatives Considered

**单驻留 / exclusive group**：拒绝。它会让 YOLO -> OCR 等多阶段 pipeline 在每个阶段边界卸载和重载，
对可共驻的小模型造成不必要抖动。需要整卡保护时直接配置 `budget == allocatable`。

**仅告警**：作为 P2 的 `observe` 和预算校准层采纳，但不作为终态。它不能消除自动化任务之间的竞争。

**活体显存测量作准入真值**：拒绝。共享卡整卡数据无法可靠归因到 backend；活体数据只用于 drift 和外部占用
告警，准入使用保守静态预算。

**纯进程内协调**：拒绝。API 和 Celery worker 各有独立 event loop 与 semaphore，无法实现跨进程原子准入、
全局并发或崩溃回收。

**Redis 故障时 fail-open**：拒绝。`enforce` 同时承担显存不超卖与跨进程 `max_concurrency`，放行会绕过两项
核心保证。需要保留现有行为时显式切回 `observe` 或 `off`。

**多卡自动放置 / backend 多副本**：推迟。当前继续由 compose 静态绑卡；本 ADR 只治理已绑定物理卡内的竞争，
不做 bin-packing、热迁移、跨卡原子获取或请求路由。

## Notes

- 实施计划：[跨 Backend GPU 显存互斥编排](https://github.com/yyq19990828/ai-annotation-platform/blob/main/docs/plans/2026-07-14-v0.22.4-cross-backend-gpu-memory-arbitration.md)
- P0a 地基：[ML Backend GPU 失效诊断与 CPU fallback 地基审计](https://github.com/yyq19990828/ai-annotation-platform/blob/main/docs/plans/2026-07-13-v0.22.3-ml-backend-cpu-fallback-audit.md)
- 协议现状与后续契约：[ML Backend 协议契约](https://yyq19990828.github.io/ai-annotation-platform/dev/reference/ml-backend-protocol)
- 相关决策：ADR-0012（backend 独立 GPU 服务）、ADR-0038（不借机抽 backend 基类）、ADR-0044（全局注册表）
- 主要实现触点：`apps/api/app/services/ml_client.py`、待新增 `gpu_arbiter.py`、
  `apps/api/app/workers/ml_health.py`、`apps/api/app/db/models/ml_backend_registry.py` 及五个 backend 的现有 pool / predictor。
- 本次接受只证明 P0 设计门已关闭；Redis 账本、受管驱逐与 `observe` / `enforce` 仍按阶段实施。
