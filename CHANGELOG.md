# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.21.x | [docs/changelogs/0.21.x.md](docs/changelogs/0.21.x.md) |
| 0.20.x | [docs/changelogs/0.20.x.md](docs/changelogs/0.20.x.md) |
| 0.19.x | [docs/changelogs/0.19.x.md](docs/changelogs/0.19.x.md) |
| 0.18.x | [docs/changelogs/0.18.x.md](docs/changelogs/0.18.x.md) |
| 0.17.x | [docs/changelogs/0.17.x.md](docs/changelogs/0.17.x.md) |
| 0.16.x | [docs/changelogs/0.16.x.md](docs/changelogs/0.16.x.md) |
| 0.15.x | [docs/changelogs/0.15.x.md](docs/changelogs/0.15.x.md) |
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## [Unreleased]

### Fixed

- 修复视频 mask 导入、关键帧可见性与批量追踪种子处理，确保无损导入、outside 帧编辑和 mask 多轨延展保持正确。
- 修复视频追踪入口的模型与目标类别校验：已有轨迹可继续使用 SAM3，画布级无源追踪不会写入缺失或越界标签。
- 修复视频追踪迁移在存在无源或多源任务时无法回滚的问题；回滚会先移除旧 schema 无法表达的任务。
- 修复并发复用旧 mask 对象时可能被后台回收的问题；引用写入与回收现在按对象键协调并在删除前做最终引用检查。

## [0.22.4] - 2026-07-17

### Added

- **ONNXTools 真实 GPU 验收收紧为可复核的镜像内门禁**：验收器在触发 CUDA 前必须核对检测/属性模型的批准 SHA-256 和审批引用，未批准的结构相似模型不能关闭门禁。它使用代表性车辆图执行三条业务路由，核对复合管道实际进入属性分类、四个 ORT session 全部以 CUDA 为 primary provider，并连续两轮验证受签 full-pool unload、稳定显存基线与至少 90% 工作集回收。参考镜像、内测检测/属性模型和 RTX 3090 已通过该门禁并冻结 provider、显存与最终 residency 证据；各部署的 capability 仍默认关闭，只有匹配参考证据或重新验收后才可开启。
- **跨宿主同号卡关闭最终实物门禁**：RTX 3090 节点与 RTX 4060 Laptop GPU 节点各自在物理卡 0 上并行执行 Grounded-SAM2 和 ONNXTools，外部 verifier 在 PostgreSQL 时钟探针 RTT 收缩后重算出 1370.722 ms 的保守重叠；两端的节点、物理 UUID 与 `gpu_resource_id` 均不同。远端完成 HTTP 后注入 `response-lost-after-http` 只会收紧远端精确 generation 坐标，本地资源清空 ephemera、刷新证明后仍通过 preflight。跨宿主隔离、并行与单侧故障门禁已经关闭，release latch 继续默认关闭并由运维逐资源灰度。
- **GPU enforce 灰度获得持久逐资源 rollout 与安全回滚**：每张物理卡以 PostgreSQL 冻结 `off/promoting/enforcing/demoting/blocked` 状态、保守 effective mode、目标模式和 exact transition identity。release latch 开启后，health worker 按 pending membership 激活、signed full-reset、enforce-mode 与 Redis proof reset 顺序推进，每步都必须等 post-horizon fresh health，Redis ready 也强制绑定 exact `enforce` gate。每个 Backend 的 reset/mode 操作会把 rollout transition、membership、boot、control epoch 和 token horizon 持久到 fence，响应丢失或 worker 重启后可重签同一意图。回滚先停止新准入并锁存 Redis not-ready，等 lease、queue 和 transition 归零后逐 Backend 切回 legacy，全部 fresh health 确认才结束 `demoting`；它不清 Redis，也不假定已驻留模型卸载。单卡成员串行，多卡最多四路并行且故障隔离。业务派发在 Backend HTTP 前读取 rollout 真值，对缺行、过渡态、未知资源越界与数据库失联 fail-closed，而显式 CPU backend 不承担 GPU rollout 数据库依赖。管理面同时展示持久 rollout、解析后 effective mode 和 Redis runtime。外部实物门禁已关闭，生产 release latch 仍按安全默认值关闭并要求运维显式启用。
- **GPU 显存仲裁获得可重算的非生产验收工具链**：严格 manifest 驱动的 runner 可只读预检 PostgreSQL、Redis、Backend challenge health 与物理 GPU 身份，并在 exact run-id 二次确认后通过真实 authority 执行单卡、多卡或跨宿主 workload。容量拒绝场景只接受 grant 和 Backend HTTP 前的精确 `gpu_capacity_unavailable` 503，并证明账本不变。机器证据冻结有界 queue/transition、显存样本、HTTP 执行窗口和三类软件故障；跨宿主窗口按 PostgreSQL 时钟探针 RTT 收缩为保守重叠下界。外部 verifier 会从无故障主报告的原始快照重算结论，并拒绝伪造摘要、冻结阈值或脱敏后的拓扑/action 元数据漂移，故障报告则在注入现场完成机器检查。五个 Backend 统一报告宿主物理卡 token，避免容器逻辑 `cuda:0` 混淆卡号。工具仅限完整 GPU 的非生产验收，本机与真实第二宿主门禁均已关闭。
- **GPU Backend 启动时拒绝多卡可见集合**：五个受管 backend 在构造模型池或 ORT session 之前统一检查 NVIDIA/CUDA/ROCm 可见设备配置。单索引、单 GPU/MIG UUID 与显式无设备值保持可用；逗号列表、多 UUID 和已暴露 GPU runtime 的无界 `all` 会直接使服务启动失败，防止单资源 lifecycle 账本误管多张物理卡；CUDA 基础镜像在未挂载 GPU runtime 时的默认 `all` 不影响显式 CPU 部署。
- **GPU busy victim 主动驱逐获得跨进程互斥编排**：cold authority 仅在空闲候选累计预算不足时选择 busy victim，strict drain ACK 后以新鲜 Redis lease 快照和新 challenge backend health 双域确认归零，再进入受签 full-unload。Redis transition owner 会持久冻结唯一 cancel/unload 分支，两个进程并发时只有一个方向成功；unload 获胜后绝不发送 RESUME。超时、异常或调用方取消会精确重放 durable cancel intent，按“稳定签名 → arm cancel → 真实 RESUME → strict ACK + fresh health → Resident/Unknown CAS”收口。DRAIN、等待和 UNLOAD 使用工作期限，owner 另保留完整 30 秒取消窗口；冻结 marker 只能由 exact 分支终态或 proof reset 清理，损坏与丢 key 均 fail-closed。单卡与多卡沿完整物理资源 ID 隔离，实物单卡、多卡与跨宿主验收均已通过。
- **GPU busy drain cancel 获得被动 RESUME 证明闭环**：平台可从持久 cancel intent 稳定重签 exact generation/JTI/owner/`operation=evict` 的 RESUME token，并严格要求 cancel ACK 与新 challenge health 同时证明 result generation 已恢复为 Resident、GPU 仍加载、可驱逐且完整 pool-id 未漂移，active/builder/borrower 非零仍是合法恢复现场。证明成立后才允许 Redis 从原 Draining generation 回切 result generation；ACK 或 health 任一不可信只会保留旧 lease 与预算并收紧为 Unknown，响应丢失只做同一 CAS 重放。该证明层不单独发送 RESUME，而由主动驱逐编排在持久分支冻结后调用。
- **GPU busy drain cancel 获得持久精确重放意图**：平台在签发 RESUME 前，会在 PostgreSQL 同一事务内推进 cancel generation 与 token horizon，并持久绑定 source/result generation、membership/boot/control/runtime 身份、transition owner/hard deadline、`operation=evict`、token expiry/JTI 及稳定 pool-id 集合。并发、响应丢失或进程重启后，只有全字段精确匹配才复用原 generation 和 JTI，身份或时域冲突会 fail-closed，不会通过盲目重试烧掉下一代。真实 RESUME 与 authority 主动 busy drain 仍保持关闭。
- **GPU busy victim 获得严格现场证明与只读 drain 分类**：busy-capable victim subject 在保持 Resident、evictable、capability、challenge、membership、boot、generation、control/runtime epoch 与 resource identity 精确绑定的同时，允许旧 workload 仍在 active/borrow，并冻结稳定 pool-id 集合防止后续健康回执遗漏 pool。drain generation 的 fresh health 使用单次 MVCC 快照只读分类为 `draining_busy`、`ready_to_unload` 或 `uncertain`；只有 active/builder/borrower 全部清零且 Draining residency 完整可信时才就绪。严格 wire 与 ML client 同时固定了合法 busy drain ACK，但本阶段不调用 Redis transition，也不授权 authority 主动驱逐 busy victim。
- **GPU busy victim 获得原子 drain 状态机地基**：Redis 驱逐 begin 可在 exact card ticket 队首按既定 priority + LRU 选择仍持有 workload lease 的 Resident，原子保留旧 lease、推进 allocation generation、绑定 transition owner 并进入 Draining。旧 generation lease 仍能 heartbeat/release，新 admission 被关闭，同卡非 victim Resident 快路保持可用；只有 lease 清零才可进入 Unloading。更新 generation 的 cancel CAS 可在保留旧 lease 与原 cooldown 的同时回滚 Resident，结果不确定时可携带 lease 保守落 Unknown，响应丢失精确重放不重复推进。durable cancel generation、双域 health 等待与 authority 主动 busy drain 仍保持关闭。
- **GPU cooldown 阻断可在卡级队首有界等待**：cold authority 会保留 exact card ticket，按 Redis 快照给出的累计最早时刻等待，再重新读取容量快照后才开始 victim health、代际推进与驱逐。等待同时受 admission deadline 和固定 ticket TTL 约束，不续期，也不会提前消耗驱逐终态清理预留；超时或取消均精确清票，不同物理资源的等待互不阻塞。busy drain、实物多卡验收与生产 effective enforce 仍保持关闭。
- **GPU 新驻留获得原子 cooldown 保护**：Redis allocation schema 新增绝对保护截止时间，Resident 必须持有正截止时间且不能由普通 transition 绕过 cold finalize 生成。正常 cold 路径只有首次可信的 Loading→Resident 终态 CAS 才用 Redis 时钟开始窗口；proof reset 重建 Resident 时按 prepared 时刻保守恢复窗口，以上精确重放与 Resident 快路均不续期。Python 快照选择和驱逐 Lua 都会排除未到期 victim，Lua 可返回累计释放足够容量的最早时刻且在阻断时不推进任何驱逐状态。普通旧账本只会 fail-close 并经证明重建，不会原地补字段；升级时遗留的合法 v2 prepared reset 只能沿用原上下文 COMMIT 原子收敛为 v3。保护窗口默认 30 秒且可独立配置；busy drain、实物多卡验收与生产 effective enforce 仍保持关闭。
- **GPU authority 接通有界两级 FIFO**：Resident 请求只在 backend 全局并发饱和后进入 backend 队列，cold slow path 先取得卡级精确队首，再做容量检查和空闲驱逐。同一 card ticket 贯穿 cooldown 等待、多 victim 与最终准入，只在成功时原子消费；独立超时、固定 ticket TTL、驱逐终态清理预留和取消安全清理使等待不会无界挂起。busy drain、实物多卡验收与生产 effective enforce 仍保持关闭。
- **GPU 冷建容量不足时可编排同卡空闲 Backend 驱逐**：惰性 authority 现在只从同一完整 `gpu_resource_id` 选择 exact Resident、可驱逐且零 lease 的 victim，按优先级、LRU 与 backend id 稳定排序，并可依次释放多个预算。每个 victim 必须经过持久 generation/owner、严格 drain ACK、新鲜 health proof、受签 full-unload 与幂等终态 CAS；响应丢失只做 exact 重放，任一不确定结果保守收口 Unknown 并停止继续驱逐。预算释放后以新 challenge 重读 target 再进入 cold admission；单卡与逻辑多卡共用同一条逐资源路径。忙碌 victim 等待、取消防抖、实物多卡灰度与生产 effective enforce 仍保持关闭。
- **GPU 冷建派发可以在响应后立即收敛显存终态**：完整 HTTP 响应后，平台使用新 challenge 重新探测 backend，并在逐卡持久锁内把 Loading 严格分类为 Resident、CPU fallback、Unloaded 或保守 Unknown。只有全池显式空的可信证明才释放显存预算；代际或成员漂移会保留不确定租约等待修复。Redis 响应丢失使用精确 owner/lease/generation 重试，单卡与多卡均按完整物理资源隔离；生产 effective enforce 仍保持关闭。
- **GPU 冷启准入获得持久 generation 授权地基**：平台只会为具备新鲜 challenge proof、enforce gate、绑定 identity、全池显式空且零活跃的 backend 持久推进新 generation；提交前会在 membership→fence 锁序内二次复验，generation 与保守 token horizon 在同一事务推进，失败代际不回滚。Redis 保留尚未接通，生产 effective enforce 仍保持关闭。
- **GPU 驱逐控制线具备可验证的锁外 transition wire**：平台可以用成对 generation/token 调用受管 drain、cancel 与 full-pool unload，并在解析前保留完整 HTTP transport outcome。远端 ACK 必须包含精确字段和严格类型，重复 JSON key 或矛盾 residency 均不能作为显存释放证据。该接缝尚未接入生产驱逐，effective enforce 仍保持关闭。
- **ML Backend 注册表新增强类型逐卡显存声明**：超管可为全局 backend 设置稳定 `gpu_resource_id`、保守 `vram_budget_mb` 与驱逐优先级；平台从显式逐卡资源映射校验单体预算，并通过只诊断端点区分配置阻断与允许驱逐的弹性超售。单卡、同机多卡和多主机同号卡均按资源 key 隔离；管理 API 分开报告 desired/effective mode，observe 影子派发就绪时 effective 为 `observe`，enforce 在账本与 gate 握手就绪前仍为 `off`。过期或失败的 health 不会被当作 CPU/UUID 证据。
- **模型市场新增逐卡 GPU 配置与 residency 观测**：超管可编辑 backend 的物理资源、显存预算和驱逐优先级，并查看每张卡的容量、静态超售、desired → effective mode、CPU fallback 与逐池驻留。没有绑定项目的全局 backend 仍可做健康检查与卸载，操作成功文案不再将请求已接受误报为显存已释放。
- **GPU observe 影子仲裁覆盖真实加载派发口**：predict、交互预测、warmup、reload 与注册 smoke-test 在发送 backend HTTP 前使用同卡静态预算和新鲜 residency 输出非权威 `would-admit|would-evict|would-reject` 决策；legacy unload 只记录请求，不能作为显存减账证据。单卡、同机多卡和多主机同号卡始终按完整资源 key 隔离；旁路查询超时后 fail-open，不会拒绝、排队或驱逐业务请求，enforce 在 Redis 账本与 lifecycle gate 就绪前仍保持关闭。
- **受管 GPU 生命周期获得共享 wire 与非对称验签契约**：共享 ML Backend 协议新增 canonical generation/control epoch、residency、transition、八类结构化错误和 admission claims schema，并固定使用带 `kid` 的 Ed25519 / EdDSA token；平台签发进程独占私钥，backend 只持可轮换公钥 keyring。
- **YOLO 成为首个具备受管 GPU 生命周期的 Backend**：模型池现在先预留再构建，并以 borrower 与逐模型使用锁保护 LRU、可变模型状态和全池卸载；请求取消或 build 超时后仍跟踪真实 executor/builder 完成，tracker 会在截断和异常时关闭流。`/health` 暴露可信 residency，加载入口支持 EdDSA admission、generation fencing、replay 防护、drain/cancel、受管 unload、mode/reset 与 legacy 兼容。其他 Backend 与平台仲裁账本尚未接入，enforce 仍保持关闭。
- **ONNXTools 获得受保护的固定句柄池与受管生命周期纵切**：pipeline、detector、va 冷启动现在 single-flight，并以 borrower、逐句柄使用锁和真实 executor/builder 跟踪防止重复构建、推理中卸载及取消后的隐藏 GPU session。`/health` 聚合四个业务 ORT session 的真实 provider chain，manual、idle、shutdown 与受管 reset/unload 共用全池清理；Docker 依赖固定到已审计上游提交。部署完成真实 GPU 回落验证前不会在 `/setup` 宣告 managed capability，也不会进入自动驱逐集合。
- **RapidOCR 获得动态 composite 引擎池与受管 GPU 生命周期**：六种权重三件套现在通过 slot 预留、同 key single-flight、borrower 和逐引擎使用锁保护 det/cls/rec 三条 ORT session；LRU 会先完整释放空闲旧引擎再构造替代。`/health` 新增可验证 residency，predict/warmup 接入 admission，并支持 drain/cancel、generation fencing、受管 unload、mode/reset、idle 与 shutdown 全池清理。经确认的设备错误才允许 CPU replacement，部分 CUDA 构造的释放未经全池清理确认时保持 Unknown。参考镜像和模型已通过真实满池 GPU 回落及显式 CPU 推理验证；能力门槛仍由每个部署显式开启。
- **Grounded-SAM2 获得图像/视频双池受管 GPU 生命周期**：两个变体池现在共享冷构建串行锁，并通过 single-flight、容量预留、borrower 和逐条目使用锁保护 predictor、embedding cache 与 video tracker；请求取消后会继续跟踪真实 executor 和 builder。受管 unload/reset 会完整清理双池，`/health` 聚合三态 residency，predict/warmup/reload 接入 generation fencing、admission、drain/cancel 与 mode/reset。参考镜像与六份 checkpoint 已通过双池 LRU、两轮 generation 冷启及物理显存回落验证；能力门槛仍由每个部署显式开启。
- **SAM3 获得图像与两类视频三池受管 GPU 生命周期**：image、multiplex 文本追踪和 PVS 点框追踪现在通过独立池与共享冷构建锁管理，single-flight、borrower/use lock 和取消安全 executor 保护真实 owner。`/health` 聚合三池 residency，受管 reset/unload/shutdown 覆盖全部模型与 embedding cache，predict/warmup/reload 接入 admission、generation fencing、drain/cancel 与 mode/reset。参考制品完成图像及两类视频真实推理、两轮冷启与三池物理显存回落验收；部署能力门槛仍默认关闭并需显式验证。

### Changed

- **GPU 受管派发新增显式传输结果回报**：predict、交互预测、warmup、reload 与 unload 现在会在完整 HTTP 响应返回后、状态或 JSON 解析前同步记录结果，因此可以把明确的 4xx/5xx 与未收到完整响应的传输超时、断连、取消区分开。这个回报仅用于后续租约安全收敛，不会把 HTTP 成功误当作显存已驻留或已释放；生产 enforce 仍保持关闭。
- **受签 lifecycle mode ACK 接入不可逆 membership 激活**：平台新增不经过 workload dispatch、shadow 或 semaphore 的 `/lifecycle/mode` 客户端，请求只带 admission token 而不带 generation。desired-enforce 周期任务会先以新鲜、完整且绑定受管能力的 legacy residency 证明重验当前物理卡，并在全局短 barrier 中阻断任意 current membership 间的 canonical endpoint 或新鲜 boot 别名。promotion 先非阻塞尝试逐卡锁，取得后再非阻塞尝试全局 barrier；逐卡锁忙立即 fail-closed，全局短竞争则先释放事务并以 deadline + jitter 有界重试，耗尽后才阻断。普通 claim、membership insert 与 health proof 写入按逐卡锁→全局 barrier 排序；数据库 trigger 对两级锁均 fail-fast，以 `40001` 要求整事务重试，防止多资源写事务持有全局锁再等待下一张卡。任何成员需要推进时域，或 signer、证明、别名与 ACK 阻断时，平台都会在推进或返回前将 Redis 旧 ready 降为 not-ready；只有 Redis 明确确认 `not_ready` 才允许推进数据库时域。平台随后于同一短事务推进 runtime epoch、激活 membership，并推进 control epoch 与 token 过期上界；提交后才签名并取得严格 ACK。远端响应从原始 JSON 拒绝重复 key，并严格校验完整 response、residency、pool、boot 与 identity，缺省字段或字符串布尔/计数不再能伪造成功确认。签名、网络或 ACK 失败不会回滚 active 状态；整卡超时、普通异常与批次取消也会使用预留时间片再次锁存 not-ready，等待后续新证明以更大 epoch 恢复。`off/observe` 不加载 signer、不调用 mode，也不访问仲裁 Redis。ACK 本身不直接打开 ready；只有晚于 token horizon、绑定当前 active identity 与 exact control high-water 的新证明才能让 Redis 收敛 ready。业务 token、驱逐与 effective enforce 仍关闭。
- **受管生命周期能力纳入 challenge 健康证明**：平台只接受 `/setup.managed_lifecycle` 的完整严格九字段声明，不再用 schema 默认值或类型转换把旧 backend 静默升级；同轮 `/health` 与 `/setup` 完成后才取得数据库观测时间，并将规范能力哈希绑定到 exact membership proof。并发扫描以探测开始时间封闭迟到写回，慢 setup 不能给旧 health 续鲜。缺失或远端非法声明会规范化为无能力，仍可保持 connected，但不能激活 membership 或形成 Redis ready；快照篡改、成员漂移或缺少 exact signed identity/control 也一律保持 not-ready。
- **GPU admission signer 使用服务级文件 secret 隔离私钥**：平台以严格 JSON 私钥文件和显式 active kid 延迟构造 Ed25519 signer，拒绝重复 key、非规范编码和缺失 active key；`off/observe` 不读取私钥。Compose 只向 API、通用 worker 与 GPU worker 挂载该 secret，ML backend 继续只持公钥环，避免私钥随全局环境扩散到 CPU/export/beat、Web 或推理容器。
- **ML Backend 的 GPU 驻留变更调用收口到统一派发边界**：平台 API/worker 现在直接消费共享 lifecycle wire，predict、交互预测、warmup、reload 与 unload 共用可注入的 async context，并建立七类结构化仲裁错误、`Retry-After`、受管 generation/token header 与 unload generation body 接缝；生命周期 API 与注册 smoke-test 的加载准入会保留仲裁根因。预测仍先经过进程内背压；semaphore 缓存由 event loop 自身持有，Celery 重复创建 loop 时既不会复用旧 loop 的同步原语，也不会反向保活已关闭 loop。派发以逐卡 effective mode 为准，支持 demotion 与多卡部分灰度；任一卡 effective enforce 时，缺失/未知 claim 和未注册 raw reload 都会在 backend HTTP 前拒绝，只有新鲜可信的显式 CPU backend 可绕过。effective off/observe 保持无权威状态写入与 headerless；effective enforce 已接通 Redis runtime authority、admission lease、业务 token、outcome report 和 exact enforce gate，外部实物门禁关闭后仍需通过默认关闭的 release latch 由运维显式启用。
- **跨 Backend GPU 显存仲裁按逐物理资源治理**：ADR-0049 按稳定 `gpu_resource_id` 分片的静态预算准入与优先级加权 LRU 驱逐，统一单卡、多卡共享和多主机同号卡语义，并冻结 residency 真值、request lease、generation fencing、锁外卸载、enforce fail-closed、错误码与阶段门禁。五个 backend 的受管代码纵切、静态 claim、observe 影子派发、持久 fencing 高水位以及 Redis allocation/lease/FIFO/transition 原子账本已经落地；账本重建以 revision + incarnation 双重 CAS、全域镜像校验和有界 deadline fail-closed。独立持久 membership/tombstone 现会在 claim 事务内建立并保留退役证据，RESTRICT fence 不会先于墓碑丢失，pending 成员以 runtime baseline 为基准受控激活，冻结墓碑在 proof-backed GC 前不可改删；签发新 fence 或复用既有 epoch 时都能按 exact membership epoch 单调持久化令牌过期上界，探活写回会按 registry→resource barrier→global promotion barrier→membership 顺序重验 epoch/state。Redis v3 账本把 all-domain、携带 epoch/state 的 membership-domain、active-domain 与 allocation cooldown 纳入同一资源 CAS；新准入和排队只接受 exact active epoch，retiring 成员仍可收敛已有 lease、ticket 与 transition，域变化先 fail-close 再单调扩张，响应丢失重试与旧 schema 均不会绕过门禁。`generation=null` 现只能以 non-evictable Unknown 全额计费，且不能准入、排队或参与普通 generation transition；已知 generation 不会在普通 repair 中退回 null。GPU backend 的 `/health` 现支持 header/query 双通道 challenge 精确回显，平台只把唯一响应回显与数据库时钟、backend/resource 和当前 membership 绑定为实时证据候选；旧 backend 或代理丢失回显时仍可保持 connected，严格拒绝未知 query 的实现会降级到一次普通探活，但兼容响应不能形成仲裁证明。Redis proof reset 现以独立 begin/commit 两阶段原语冻结 prepared 资源，进程重启可恢复持久 context，commit 会按封闭域一次性清理 active/retiring child；Unknown、不完整证明和超额承诺只会落 not-ready，精确重试会重新校验当前 deadline 与完整 post-state，无法用未推进 revision 的 partial corruption 回放 ready。平台证明消费器通过逐资源 advisory barrier 封闭并发新增成员，并在全量 membership→fence 锁内重验 token horizon、严格 residency、identity 与 generation/control 高水位后调用 Redis；pending/retiring 和不可信证据保持 Unknown/not-ready，Resident 即使绑定了独立 lifecycle capability，在完成受签激活前也不会获得驱逐权限。ready deadline 只从固定 live health 派生，not-ready 使用 canonical `0`，陈旧 prepared 不会在重启后永久冻结整卡；同卡串行恢复而异卡仍可并行。retiring 成员现在以不可复用 `retirement_id` 绑定新鲜 live-unloaded 证明；Redis 在复验全封闭域 child 后原子缩域，并写入不绑定后续全局 revision 的 per-target completion receipt，再由数据库锁内删除 exact tombstone 与孤立 fence。per-target receipt 以自身结果域复验，数据库 sibling 域演进不会破坏崩溃恢复，proof reset 后旧 incarnation receipt 也不会阻塞新鲜证明重新收集；冻结 health 或缺失 registry 不会被当作删除证据。每分钟健康扫描后的 task-local repair 同时处理 desired-enforce 与持久非 off rollout 资源，并通过过期消息、防重入锁、批次总时限、四路公平时间片和单卡隔离避免慢卡堆积；管理 API 在释放数据库读事务后以最多四路并发读取 Redis，结构化结果同步暴露逐资源账本、队列和 GC 状态。`off/observe` 不访问仲裁 Redis；collector 已由独立 `gpu.control` 单并发进程和最小权限数据库角色隔离，ONNXTools 参考制品与跨宿主同号卡均已通过实卡验收，外部门禁全部关闭；release latch 继续保持安全默认值并由运维逐资源启用。

### Fixed

- **GPU proof recovery 不再把 legacy gate 提交为可派发 ready**：无论 Backend 当前是空驻留还是已驻留，只有 fresh health 明确证明 exact `enforce` lifecycle gate，才能完成 Redis proof reset；`legacy` 一律保留 Unknown/not-ready，防止 rollout 在 Backend 尚未受管时误开业务派发。
- **本机 GPU 验收不再套用跨宿主时钟收缩门槛**：单卡与同宿主双卡报告按 runner 进程内 monotonic HTTP 窗口重算；只有跨宿主并发证据才要求 PostgreSQL 时钟探针 RTT 收缩后仍有保守重叠，避免毫秒级快速 warmup 因探针耗时更长而被 verifier 误拒。
- **GPU 双卡与跨宿主验收不再在请求完成边界误报未执行**：验收器会把 workload 全部返回后立即采集的最终快照纳入 Resident GPU 执行证明；当最后一个轮询样本仍为 Loading、紧随其后的可信快照已为 Resident 时，不会再因采样停止竞态阻断真实通过的并发场景。
- **GPU 显存实物验收不再因暂停周期性健康扫描而读取陈旧证明**：验收 `run` 现在会在 workload HTTP 前为范围内每个 Backend 持久化新的 challenge-bound health，任一刷新失败均提前阻断，避免只读预检已观测到实时状态，真实 authority 却因数据库旧回执误判 not-ready。
- **多卡 Backend 不再把宿主卡 1 误报为逻辑卡 0**：Compose 现从各 Backend 既有的 `*_GPU_DEVICE_ID` 派生独立物理卡 token，`/health.gpu_info` 优先消费它。即使 NVIDIA container runtime 把 PID 1 的 `NVIDIA_VISIBLE_DEVICES` 重写为 `void`、CUDA 将挂载卡重编号为 `cuda:0`，仍能精确报告宿主 `index:N` 或 GPU/MIG UUID，避免双卡仲裁预检误判资源域。
- **五个 GPU Backend 的 drain cancel 不再接受变更 operation**：YOLO、ONNXTools、RapidOCR、Grounded-SAM2 与 SAM3 现在要求 RESUME token 同时精确匹配原 drain 的 owner 和 operation；仅 owner 相同但 operation 不同会保持 Draining 并返回 transition conflict，同一正确 token 仍可幂等重放，cancel 后迟到 unload 继续由 generation fence 拒绝。
- **GPU FIFO 票据不再能在缺失或过期后绕过队首**：Redis admission 现在要求显式 ticket 必须仍是匹配 backend、owner 与 membership 的存活精确队首；空闲驱逐 begin 也能在同一原子操作内绑定卡级队首并保持多 victim 重放，直到目标冷建准入成功才消费 ticket。生产 effective enforce 仍保持关闭。
- **GPU 冷建 reservation 不再向非 owner 泄漏并发许可**：Redis 准入现在在同一原子区内拒绝其他调用方加入处于 `Reserving/Loading` 的 allocation，仅保留原 reservation lease + owner 的幂等重试。这避免同一模型被重复冷启，也防止第二条 lease 卡住失败回滚。生产 effective enforce 仍保持关闭。
- **异步 ML 任务不再丢失 GPU 仲裁根因**：批量预标、跨 Backend 下游阶段、逐帧预标、失败重试和视频追踪现在统一保留稳定仲裁错误码、HTTP 状态与可选重试窗口。失败预测明细继续可按根因检索，批量与逐帧任务使用按错误码聚合的有界摘要；逐帧任务不会为每帧制造不可正确重试的失败行，普通 Backend 异常与现有任务终态保持不变。
- **项目管理员不再能通过项目旧路由改写全局 ML Backend**：全局 backend 的 URL、鉴权、名称与调用参数已与 GPU 资源声明一并收口到超级管理员；项目管理员仍可在项目设置中启用或停用已注册 backend，不会再影响其他项目共享的端点。
- **YOLO 与 ONNXTools 冷启动取消不再遗留池外 GPU owner**：模型或句柄 builder 现在会等底层 executor、失败清理和状态提交全部结束后才释放 reservation；重复取消也无法打断 unload 真值提交。失败或取消后的未知驻留会阻止继续冷建，直到受管全池清理重新建立可信空状态，避免隐藏对象突破物理显存上限。
- **YOLO 受管生命周期在重复取消和进程 shutdown 时不再提前丢失真实 owner**：取消冷启动请求会在不再次让出事件循环的情况下登记仍运行的 builder，borrower 释放与 shutdown 即使连续收到取消也会先等待 active、builder、waiter、borrower 和全池清理完成，再向调用方重抛取消，避免健康状态短暂早于真实 GPU 工作归零。
- **Grounded-SAM2 的淘汰取消与失败清理不再丢失 GPU artifact owner**：替换 builder 在首次调度前取消时，被摘除的 LRU victim 仍由独立 cleanup owner 接管；attachment cleanup 失败会隔离保留强引用供后续 force cleanup 重试，只有所有失败 artifact 与 CUDA 清理均可信完成后才恢复空驻留，避免隐藏显存被误报为已释放。
- **SAM3 全池卸载不再遗留 BF16 权重转换缓存**：vendor 原先把 autocast 永久进入进程上下文，真实推理后即使三池逻辑上已空，PyTorch 仍会持有数 GiB 的转换权重。图像、multiplex 与 PVS 现均使用请求级 autocast，严格清理同时清空 cast cache，卸载驻留真值与物理显存恢复一致。
- **ML Backend 设备失效观测不再误报可回退性和实际 provider**：共享 torch 设备 latch 现在线程安全且向 CPU 单调，Grounded-SAM2 与 YOLO 只在识别为设备错误且 CPU replacement 成功后提交回退；CUDA runtime 查询本身失败时，两者的 `/health` 仍可用，YOLO 也会在 CPU replacement 后尝试释放 CUDA allocator 缓存。SAM3 image、Multiplex 与 PVS 明确为 GPU-only，模型加载检测到 GPU 不可用时返回可重试的结构化 503。RapidOCR 与 ONNXTools 改为读取已加载业务 session 的实际 primary provider，ONNXTools composite 的检测与分类 session 共用同一份功能探测后的 provider 偏好；空池、缺失或混合 provider 返回 `null`（unknown 语义）。注册表快照与实时 `/observe` 均透传 `compute`，Runtime Observe 与 PerfHUD 的前端消费共用同一 CPU fallback 判定，不再误报显式 CPU、实时空状态或 GPU-only backend。

### Security

- **GPU tombstone collector 改为独立最小权限控制面**：显存 repair/GC 只投递到 `gpu.control` 单并发 worker，collector 数据库 URL 仅通过该进程可见的只读文件挂载。每轮 enforce repair 会核对普通应用与 collector 的实际 PostgreSQL 角色和有效权限：两者必须不同，普通角色不得直接删除 membership/fence，collector 只能读取/锁定 GPU 真值并完成受证明约束的删除；验证失败会先把资源闩为 not-ready。新增 fence 删除触发器，只有 exact GC receipt、同事务逐卡锁且 registry/membership 均已消失时才允许清理孤立 fence；健康扫描与 repair 使用独立队列和锁，防止控制面饥饿。
- **受管 GPU header 不再降级绕过 legacy 生命周期门禁**：五个 GPU backend 现在只在 generation 与 admission token 都完全缺失时接受 legacy workload；部分、重复或非法 header 会在业务 body 处理前 fail-closed，携带受管 header 的 bodyless unload 也不再忽略凭据后执行兼容清理。

## [0.22.3] - 2026-07-14

### Added
- **ML Backend 有效计算设备可观测地基**：五个 ML 后端镜像（yolo / grounded-sam2 / sam3 / rapidocr / onnxtools）在 `/health` 暴露顶层 `compute: {configured_device, effective_device | effective_provider}`，并建立共享 torch 设备探测与初始 ORT provider 功能探测。平台将该字段传入注册表 `health_meta` 与 PerfHUD 实时快照，管理端可显示 GPU 配置与 CPU 生效路径的偏离。该交付建立了 ADR-0049 所需的诊断传输链；具体 fallback 是否成立以各 backend 能力为准，不由一次启动探测推断。

### Changed
- **视频时间轴两态提升信息密度与窗口辨识度**：展开面板不再为章节、书签、问题、AI 预测、所选轨迹、AI 影响范围与循环区间保留空行，并把播放、逐帧和缩放控件压缩到底部状态栏，不再用大号图标单独占据一整行；缩放 / 适配按钮固定在底栏最右侧，展开 / 收起通过尊重系统动态偏好的平滑过渡衔接，两态也保持同一贴底位置。紧凑态继续呈现语义摘要，并把状态信息移到独立一行，为主时间条保留更多宽度。展开、收起态均显示当前 / 总时长和明确的全片窗口读数，未缩放时也保留完整窗口选区，缩放后可直接判断当前窗口位于全片的哪一段。
- **视频追踪的目标种子改为逐目标摘要**：种子区现在每个目标单独一行，直接列出点数、框数和具体所在帧，同时标记后续操作会归入的当前目标；多目标与跨帧纠偏不再只显示难以对应的汇总数。
- **视频追踪模型选择器只显示当前项目真正可执行的模型**：模型列表现在按项目已启用、已连接且能力可达的 ML Backend 过滤，并在模型名后显示提供它的后端；组合追踪只有同一后端同时提供文本发现与点框追踪时才出现。后端也会在排队前拒绝不可执行的真实模型，不再创建随后必然失败的任务。
- **视频工作台明确分离画布发现、单轨延展与多选延展**：顶部入口改为「发现目标」，单条轨迹卡与右键菜单改为「延展此轨迹」，多选入口改为「批量延展」；追踪面板首屏显示操作作用范围，提交按钮随之变化。文本发现模型与「+ 新目标」只保留在画布级入口，单轨操作不再混入新建多目标语义。
- **视频 AI 追踪面板改为紧凑的画布检查器**：方向、范围、模型、种子与影响摘要现按任务层级分区，追踪进度和候选审阅共用同一视觉语言；配置面板停靠在中间画布右上角，避免遮挡主要标注区域。入口迁移到顶部 AI 单题按钮左侧并采用相同样式，两个 AI 面板保持互斥；打开后的面板也共用相同的紫色语义边框、渐变头部与表单分区骨架，并与单题面板一样支持画布内拖动、右下角缩放及位置/尺寸偏好恢复。
- **视频 AI 追踪的 `mock · 测试框` 不再出现在生产界面**：mock 模型只是无 ML backend 时验证流程的开发兜底，此前项目没绑后端时仍会露给用户。现生产构建里彻底隐藏它（无论是否绑后端），仅开发构建保留以便本地无 GPU 验证；绑了真实后端的项目行为不变。

### Fixed
- **图片与视频画布的缩放浮条贴齐可用区域右侧**：浮条此前仍为已收窄的反馈按钮触发区保留额外空档，看起来悬在画布中间；现在直接以画布容器右边缘为锚点，侧栏宽度变化时也会跟随画布边界。
- **工作台右下角反馈按钮不再干扰画布与视频时间轴**：BUG / Issue 悬浮按钮的自动唤出区此前远大于实际入口，操作右侧缩放浮条或时间轴控件时可能意外出现并抢占点击；现在只在右下角窄触发带唤出，出现后由按钮自身维持展开，画布控件与时间轴可以保持贴底而不与其冲突。
- **折叠时间轴上的活动区间恢复可见反馈**：循环区间、章节圈选草稿和 AI 影响范围此前虽然已生效，却会被紧凑态样式隐藏；现在拖动和受控范围在展开、折叠两态下都能立即确认。
- **视频追踪的「追踪方向」标题不再被分段按钮遮挡**：方向字段现在显式重置原生 `fieldset / legend` 间距并使用正常行高，中文字形下沿可完整显示。
- **SAM3 文本追踪跨分窗不再从第二窗开始无输出**：multiplex 每个分窗都会新建会话，此前平台虽传入上一窗实例种子，SAM3 文本分支却没有消费，窗首文本暂时未检出时整窗会返回空。后续分窗现在把上一窗所有实例的有效外接框作为正提示与文本一起下发，单实例、多实例及 Mask 轨迹都能继续追踪。
- **视频 AI 追踪对话框选 SAM3 系模型时不再显示无效的「尺寸」档位**：SAM 尺寸档位（tiny/small/base_plus/large）是 SAM2 checkpoint 概念，此前对所有非 mock 模型都显示，选 SAM3 文本检测 / 点框交互 / 发现追踪时也能选——但这些模型用各自 SAM3 权重、忽略该档位，误导用户以为能调 SAM3 模型大小。现「尺寸」选择器只对 `sam2_video` 显示，提交时也只对它透传 `sam_variant`。

## [0.22.2] - 2026-07-13

### Added
- **视频 AI 追踪新增「发现追踪」(combo):按文本自动发现目标再逐对象记忆追踪**:选 SAM3「发现追踪 (combo)」并填文本(如 car)后,一个作业内先用 multiplex 在起始帧按文本检测出画面里的多个目标,再把每个目标当作独立种子交给 PVS 逐对象 memory 追踪——兼得「文本自动发现」与「跨帧干净身份」,发现的目标各建独立新轨迹(需指定目标类别)。仅在 sam3 backend 同时声明文本检测与点框交互能力时可选。
- **视频 AI 追踪支持多选批量:一次延展多条已有轨迹**:在轨迹清单或选中卡里多选 ≥2 条轨迹后,新增「AI 追踪」批量入口一次发起——各源轨迹在同一个作业里被并行追踪,各自回填各自轨迹,只产生一条审阅记录、一次接受(而非按轨迹逐条 fan-out)。对话框摘要显示「延展 N 条轨迹」及类别(同类显类名、混类显「N 类」)。
- **DEV 截图 seed 使用可追溯的真实场景和期望状态**：`screenshots` profile 从固定来源拉取真实道路图片、城市交通视频、PCL 室内点云与 RapidOCR 示例，经确定性裁剪/转码/无效深度过滤后，按显式媒体路径创建 4 个项目、14 个任务和多状态批次；`--repair` 仅重建能够证明由截图 seed 管理的对象。DEV 媒体改走同源 `/minio` 代理，远程浏览器不再依赖直连 9000 端口或 Docker 私网 IP。
- **截图 seed 按场景能力绑定 ML Backend**：live 模式通过 `/health` 与 `/setup` 为图片交互、视频追踪和 OCR 项目选择可用 backend，并精确创建项目启用关联和主绑定；无 GPU 环境可启动同协议 stub，catalog 会对连接状态、能力快照、tracker 路由及 OCR 输出契约 fail-closed。
- **截图场景改由 seed catalog 和真实角色驱动**：Playwright 在导航前统一校验项目、任务、批次、ML Backend 与场景能力，标注员和审核员页面使用真实成员关系；截图时钟、语言、时区、DPR、动画和资源就绪条件现已固定，并提供不覆盖资产的全场景验证模式。
- **截图资产建立可校验清单与视觉回归基线**：完整矩阵成功后才会原子重建含场景来源、seed、浏览器、SHA-256 和尺寸的 manifest，Markdown、`img` 与 `AutoImage` 引用统一进入严格门禁；8 个高价值真实场景使用同一 catalog 和协议 stub 做 Chromium 像素回归，流程临时产物与重复 GIF 不再进入仓库。
- **ML Backend 性能基准文档（RTX 3090）**：新增超管文档《ML Backend 性能基准》，实测 grounded-sam2 / sam3 / yolo / rapidocr 各任务的纯推理 / 端到端延迟、重新加载耗时、显存足迹、并发标注吞吐、视频轨迹转播（含 sam3 16 帧分窗口耗时拆解）与模型变体（yolo11 尺寸 / SAM2 档位 / GroundingDINO T·B / OCR mobile·server）对照，供客户做硬件规划与 backend / 模型选型参考。

### Changed
- **文档站首页改为可验证的真实产品场景叙事**：产品实证区现展示 SAM3 Magic Box 从粗框、候选到人工确认的短流程，并复用 OCR、项目预标注与模型市场截图解释完整 AI 生产链路；移动端与减弱动效环境使用静态海报，文档入口同时补齐独立的部署与运维路径。
- **用户手册截图已按真实 seed 场景全量刷新**：正式矩阵现包含 60 张自动 PNG、3 张手工 PNG 和 12 个多帧流程 GIF，图片、视频、点云与 OCR 工作台均展示固定来源的真实媒体；发布门禁同时校验当前 seed revision、文档引用、文件摘要、孤儿和重复内容，视频场景会主动恢复统一布局并清理残留追踪候选。
- **视频工作台工具栏改按单帧与轨迹分组**：选择工具保持独立，SAM 工具归入单帧子组，手工轨迹与 AI 追踪集中到轨迹组；矩形框轨迹改用叠帧方框图标，不再与 SAM 智能点混淆。
- **视频 AI 追踪发起后对话框内即时显示进度**:此前点「开始追踪」对话框立即关闭,追踪进度只散落在轨迹卡的作业徽标和结果就绪后的审阅条上,发起到出结果之间对话框内毫无反馈。现对话框就地转为「追踪中…」轻量进行态(有分窗回报时显示「第 c/t 窗」),结果就绪自动让位给候选审阅条,失败则收起;「后台继续」可随时关闭对话框而不影响后台追踪,对齐图片侧交互式 AI 的即时反馈。

### Fixed
- **远程 DEV 工作台不再因 WebSocket 误连而持续重连**：远程浏览器此前会把默认 `localhost:8000` 解释为访问者本机，视频项目还会因实时与媒体链路不可达退回总览。现在远程 DEV 默认通过当前页面同源 `/ws` 和 `/minio` 代理连接，本机调试仍保留直连 API，显式 `VITE_WS_HOST` 配置优先。
- **视频 AI 追踪对话框不再与右侧「选中卡」视觉相撞**:顶部居中的追踪工具条打开时,右侧浮动的选中标注卡会自动收起为紧凑标签让位(仍显示类别标题作上下文),对话框关闭后复位到用户原本的展开/折叠状态,不改动其持久化偏好。

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.22.x 版本段累积在本区；进入 0.23.x 后整体移到 docs/changelogs/0.22.x.md。
-->

## [0.22.1] - 2026-07-13

### Added
- **DEV 截图 seed 增加可审计素材与 catalog 地基**：版本化清单固定上游来源、摘要、大小和媒体公开状态，下载器提供原子缓存、离线模式与安全解压；非生产环境可通过稳定逻辑键解析截图用户/项目/任务，并在 ML Backend 主绑定、启用关联、连接状态或能力快照缺失时明确失败。
- **视频 AI 追踪对话框新增「本次影响」摘要**:发起前即显示本次会延展选中轨迹还是新建轨迹、各新建几条;文本检测模式额外提示新目标将继承源轨迹类别,避免「选中 car 轨迹却按文本检测行人」时类别被误标。
- **视频 AI 追踪新增画布级入口,可不选轨迹直接检测新目标**:左侧工具栏 AI 工具组新增「AI 追踪」按钮,无需先选中轨迹即可发起——用文本(如 car)或点/框种子让 tracker 一次检测并追踪画面里的多个新目标(各建独立新轨迹),新目标类别显式指定、不再借用选中轨迹类别。原「选中轨迹发起延展」路径(Ctrl+B / 右键 / 卡片)完全保留。

### Changed
- **视频「AI 追踪」功能对外命名统一**:工作台此前混用「AI 传播 / 发起传播 / AI 追踪传播」指代同一个视频追踪能力,既与另一套纯几何的「标注传播」撞名,又让「传播」盖过了实际的多目标追踪语义。现统一为「AI 追踪」(主按钮「开始追踪」、时间轴泳道「AI 追踪」、方向与错误提示同步),交互与后端行为不变。

## [0.22.0] - 2026-07-13

### Added
- **视频工作台新增原生栅格 Mask 轨迹与 DAVIS 导出**：标注员可用 `M` 在当前帧创建或编辑逐像素 Mask 关键帧，笔刷 / 橡皮支持逐 stroke 撤销重做，帧间按 hold 语义显示并以 alpha 精确选择；SAM2 / SAM3 tracker 可直接产出 Mask 候选，接受前后保持同一 RLE。Mask 使用内容寻址存储并支持 AAP JSON 无损迁移、Video JSON、COCO RLE、bbox-only 外接框降级及标准 DAVIS Full-Resolution palette PNG；导出包内不同 target 可保留各自帧编号规则。

### Fixed
- **视频 Mask 笔刷现在按视频固有分辨率保存**：视频工作台此前错误复用了尚未初始化的图片舞台尺寸，编辑 buffer 会退化成 1×1；绘制后虽然显示“未保存”，实际没有像素、确认也不会提交。上传后创建轨迹时，等价的元组尺寸也会被误判不匹配并返回 500。现视频任务从 manifest 取得宽高，服务端同时接受规范化后的尺寸序列，笔刷叠加与 Mask 轨迹保存恢复正常。
- **视频追踪任务刷新后不再卡在「运行中」**：页面刷新时若登录态尚未恢复，运行中的追踪任务不会重连进度通道，UI 会一直显示 running、不冒出「完成待接受」，直到用户手动切走再切回。现登录态到位后会自动补连尚未连接的运行中任务。
- **跨任务切换不再把上一个任务的 AI 候选挂到新任务画布**：在追踪候选预览请求在途时切到新任务，回来的候选此前会写成孤儿，并可能因视频项目跨任务共用 track / annotation id 而渲染到新任务、令接受 / 丢弃按钮打到旧任务的作业。现按任务归属校验后再写入。
- **大任务打开 Data Manager「匹配详情」不再拉全表**：匹配抽屉的标注 / 预测候选 / 追踪作业三路查询此前无分页、全量物化进内存再切片，含数万条标注的任务即使只取一页也会内存尖峰、阻塞事件循环。现把分页下推到 SQL（预测候选也只对当前页做昂贵的形状转换），返回结构、总数与排序不变。
- **等值属性不再被误判为「不一致」**：Scene 轨迹聚合此前用 `repr()` 比较字典 / 列表型属性值，键顺序不同的等值对象（如导入 JSON 与编辑器写回）会被错标 `inconsistent_attributes` 并丢掉该字段的公共值。现改用规范化 JSON（键排序）比较。
- **失效的内置任务视图现在能说明原因**：当内置视图引用了已删除的属性字段而失效时，前端此前只拿到空数量、拿不到失效字段名。现内置视图与保存视图一致回传 `invalid_fields`。
- **COCO 逐帧分割导出不再静默把未知类名并进 0 号类别**：类名缺失 / 被删 / 为空的标注此前会静默落到 `category_id=0`——删类后的旧标注会污染训练集，项目未定义类时还会产生让 `pycocotools` 加载即 `KeyError` 的悬空引用。现改为跳过该标注，并在导出摘要与日志中汇总被跳过的数量与类名。
- **Data Manager 图表柱条在主题切换后正确换色**：任务状态柱条颜色此前被 `useMemo` 空依赖缓存，浅色主题打开图表再切深色时柱条仍是浅色、与深色卡片对比失衡。现跟随主题重算。
- **从 Data Manager 跳入工作台后不再被 URL 焦点反复拉回**：带 `?focus=…&frame=…` 进入工作台后，用户改选别的标注 / 帧，随后任何标注增删改触发的刷新此前会把选中与帧位置拉回 URL 初值。现 URL 焦点仅在首次命中时应用一次。
- **`project_task_views` ORM 补齐 0119 新增的复合索引**：`ix_project_task_views_scope_visibility` 此前只存在于迁移、未声明进 ORM，导致测试建表缺索引、`alembic --autogenerate` 与生产库反向漂移。现已在模型侧对齐。
