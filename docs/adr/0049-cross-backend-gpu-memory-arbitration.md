# 0049 — 跨 backend 显存互斥编排:单卡显存预算准入 + LRU 驱逐 + 跨进程仲裁

- **Status:** Proposed
- **Date:** 2026-07-13（提出日期；Accepted 后回填正式决策日）
- **Deciders:** core team
- **Supersedes:** —

## Context

平台可同时注册多个 GPU backend（grounded-sam2 / sam3 / yolo / onnxtools / rapidocr），每个常驻 3–5GB 显存。当前的隔离手段是**容器级空间隔离**：`*_GPU_DEVICE_ID` 只作用于 compose 的 `NVIDIA_VISIBLE_DEVICES` + `deploy.resources.reservations.devices[].device_ids`，容器内 backend 代码硬编码 `cuda:0` / `"cuda"`，对显存无任何感知。

默认布局是**双卡**（`SAM3_GPU_DEVICE_ID` 默认 `1`，其余默认 `0`，见 `docker-compose.ml.yml`、`.env.example:299`）。多卡时各 backend 错开到不同物理卡——空间隔离绕开了竞争。但**单卡机器必须把 `SAM3_GPU_DEVICE_ID=0`**，于是 5 个 GPU backend 全部挤在卡 0，**彼此不知道对方占了多少显存**。

单卡放不下时不会 OOM 报错，而是**静默退化**：`cudaMalloc` 反复失败 → 清缓存 → 重试，模型加载慢一个数量级（8G 卡实测 SAM 3 冷启动 `8.5s` → `159s`），随后撞上 `ml_predict_timeout`（`config.py:146`，默认 100s）超时。表象是「推理超时」，根因是显存竞争，极易误诊成「模型本来就慢」而去调大超时——治标且掩盖问题。

现状的能力与缺口盘点：

| 维度 | 现状 | 缺口 |
|---|---|---|
| 卸载能力 | `MLBackendClient.unload()`（`ml_client.py:264`）+ `POST .../ml-backends/{id}/unload`（`ml_backends.py:304`，super_admin）真释放显存；各 backend 另有 `IDLE_UNLOAD_SECONDS`（默认 600s）定时卸载 | 只有**手动 / 定时**入口，无按需自动编排 |
| 显存账本 | 注册表 `MLBackendRegistry`（`ml_backend_registry.py:16`）**零** vram / priority / device 字段；仅 `health_meta.gpu_info` 是 60s 陈旧的单 backend 自报快照 | 无跨 backend 的显存预算 / 占用聚合 |
| 共享卡归因 | 单卡共驻时每个 backend 的 `gpu_info.memory_used_mb` 报的是**整卡**用量（含他人模型），不能相加 | 活体用量无法归因到单个 backend |
| 并发协调 | 唯一限流是**进程内** `asyncio.Semaphore`（`ml_client.py:17`，默认 4）；API 进程与每个 Celery worker 各持一份 | **无跨进程锁**，会互相拆台（worker A 卸 sam3 跑 yolo，worker B 立刻重载 sam3） |
| 降级可见性 | `effective_device` 由 yolo `/health` 产出（`yolo-backend/main.py:284`），但被平台客户端白名单（`ml_client.py:139`、`ml_health.py:41`）丢弃 | 平台看不到某 backend 是否已静默退回 CPU |

派发路径有三条，都会打同一个 backend 的同一个 `/predict`、共用同一把 per-backend 信号量、同一 100s 超时：① 交互式 SAM（同步 HTTP）② 「运行当前题」/ 批量预标（Celery `_run_batch`，`tasks.py:481`，逐 task 顺序 await）③ 视频追踪（`video_tracker_runner.py:800`，逐窗串行 `predict_interactive`，长占用）。且「显存不足→卸载 backend」的 helpful 文案只在二次推理路径（`secondary_inference.py:214` 的 504），另两条给 502 / 落 failed prediction，对同一根因反馈不一致。

**术语纠偏**：平台是「一 backend 一容器」（非多副本），经典的「请求级负载均衡」不适用。这里要治理的是两件事——**共享卡上的显存仲裁**（单卡核心问题）与**跨卡放置**（多卡）。本 ADR 聚焦前者，后者维持现状。

候选方案对比（论证见 *Alternatives Considered*）：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **显存预算准入 + LRU 驱逐（选）** | 小 backend 可共驻、大的才驱逐；支持多阶段流水线共存 | 需 Redis 账本 + 跨进程锁 + 驱逐 + 防抖，最重 |
| 单驻留（exclusive-group） | 极简、彻底消除竞争 | 多阶段流水线在阶段间抖动卸载/重载 |
| 仅告警（status quo+） | 廉价、零仲裁风险 | 不解决竞争，只是把静默退化变可见 |
| 多卡自动放置 / 副本 scale-out | 提升利用率 | 空间隔离已够用，属过度工程 |

## Decision

采用**显存预算准入 + LRU 驱逐**，按 L0 → L1 → L2 三层落地，**L3 多卡自动放置 defer**。整体由**功能开关 `gpu_arbiter_enabled` 控制，默认关**；单卡多 backend 部署显式开启。多卡（空间隔离，每卡 ≤1 backend）下仲裁器天然是 no-op，开着也安全。

### L0 · 显存账本地基（前置，与 CPU fallback 审计计划共享）

1. **放行 `effective_device` + per-backend 显存**：从 `ml_client.py:139` 与 `ml_health.py:41` 两处白名单放行 `effective_device`（及 ORT 系的生效 provider），落进注册表 `health_meta`。此步由 [ML backend CPU fallback 审计计划](../plans/2026-07-13-ml-backend-cpu-fallback-audit.md) 的 WS4 交付，本 ADR 直接消费。
2. **账本落 Redis**（跨进程真值），按物理卡 key：
   - `card:{device_id}` → `{ total_mb, committed_mb }`
   - `backend:{registry_id}` → `{ card_id, budget_mb, priority, loaded: bool, last_used_at, inflight: int }`
   - 选 Redis 而非 Postgres 列：派发热路径高频读写 + 需跨进程原子操作 + 已有 Redis 基建（Celery / PerfHud）。注册表只加**静态配置列**（下）。
3. **静态预算而非活体测量**：共享卡上 `gpu_info.memory_used_mb` 是整卡聚合、`process_memory_mb` 的归因语义待核实（可能是进程 GPU 显存或宿主 RSS），都不可靠。故账本以**每 backend 静态声明的 `budget_mb`**（含安全余量系数）为基准；活体 `gpu_info` 仅用于**漂移告警**（声明与实测偏离时提醒运维校准），不进准入决策。

### L1 · 静态配置 + 超额告警

注册表 `MLBackendRegistry` 增静态列（或先落 `extra_params` JSONB 避免迁移，待稳定再提列）：

- `vram_budget_mb: int | null` — 该 backend 满载常驻显存预算
- `priority: int`（默认 0，越大越不易被驱逐）
- `gpu_device_id: int | null` — 物理卡号（与 compose 的 `*_GPU_DEVICE_ID` 对齐，供账本按卡聚合）
- `exclusive_group: str | null`（可选，标注「同组建议互斥」）

**参考预算（RTX 3090 实测足迹，见 [ML Backend 性能基准](../../docs-site/user-guide/superadmin/ml-backend-performance.md)）**——`vram_budget_mb` 取实测常驻足迹并留余量：

| backend（默认变体） | 实测常驻足迹 | 建议 `vram_budget_mb` |
|---|---|---|
| yolo（yolo11s；n→x 约 0.16–0.46GB） | ~0.3GB | 1024 |
| grounded-sam2（SAM tiny 交互） | ~0.8GB | 1536 |
| grounded-sam2（DINO+SAM 文本） | ~3.6GB | 4096 |
| sam3（图像） | ~5.3GB | 6144 |
| rapidocr（onnxruntime CUDA 常驻） | ~0.7GB | 1024 |

> 更大变体显著抬升足迹（SAM2 large ~1.7GB、GroundingDINO Swin-B ~2.2GB），预算按实际部署变体取。这也印证了本 ADR 的取舍：共享卡上活体 `gpu_info` 只做漂移校准、不作准入基准，静态声明的 `budget_mb` 才是账本依据。

卡容量取 `gpu_info.memory_total_mb` 或配置 `CARD_TOTAL_MB` 兜底。当某卡上**已启用 backend 的 `budget_mb` 之和 > 卡容量**时，管理端 + PerfHud 出「显存超额」告警——把静默退化变成部署期就能看见的警告。此层可独立先上，不依赖 L2。

### L2 · 准入 + 驱逐（核心）

新增 `GpuArbiter` 服务（API 与 Celery worker 共用），派发前经它准入。派发到卡 `C` 上的 backend `A` 时：

1. **持卡级仲裁锁** `lock:card:{C}`（Redis 锁，带 TTL 防死锁）——**只锁「准入决策 + 驱逐卸载」这一小段，不锁整个 predict**（predict 可能很长，其并发仍由 per-backend 信号量治理）。
2. `A` 已 `loaded`（账本）→ 更新 `last_used_at` → 释放锁 → 派发。
3. `A` 未加载：`need = A.budget_mb`；`free = card.total_mb - card.committed_mb`。
   - `need ≤ free` → 账本标 `A.loaded=true` + `committed_mb += need` → 释放锁 → warmup/派发。
   - `need > free` → **驱逐**：在卡 `C` 上 `loaded` 的 backend 里，排除 `priority ≥ A.priority` 者与**有 in-flight 者**，按 `(priority asc, last_used_at asc)`（priority 加权 LRU）依次挑受害者，`unload()` 之并 `committed_mb -= victim.budget`，直到 `free ≥ need`。
   - 驱逐完仍不够（可驱逐者全卸也放不下 `A`）→ **fail-fast**：返回带 `secondary_inference.py:214` 同款指引的错误（「显存不足，请卸载暂不用的 backend / 检查预算配置」），**不静默退化**。是否 fail-fast 可配（保守派可选「仍派发、接受退化并告警」）。
4. 释放锁；`A` 保持 `loaded`，后续并发请求命中 `loaded` 分支直接走。

**卸载期 in-flight 语义**：驱逐**优先选无 in-flight 的 backend**（账本 `inflight==0`）；若无足够空闲者，对 LRU 受害者做**有界 drain**（等其 in-flight 结束，超时则放弃转下一受害者或 fail-fast）。in-flight 计数在 `_acquire()`/释放信号量处顺带增减写入账本。

**账本 ↔ 现实对账**：backend 自身的 `IDLE_UNLOAD_SECONDS` 仍在跑，可能**在仲裁器不知情的情况下自行卸载**；手动 `/unload` 亦然。故每次 60s 健康探测（`check_ml_backends_health`）后用 `health_meta.loaded` 校正账本：backend 报未加载而账本说 loaded → 修正为卸载并回收 `committed_mb`；反之亦然。账本是「决策真值」但需按实测对账。

### L3 · 多卡自动放置 / 副本 scale-out（defer）

维持手动 `*_GPU_DEVICE_ID` 空间隔离。自动 bin-packing 放置、同 backend 多副本铺多卡 + 请求路由，属独立 epic，本 ADR 不做。仲裁器按卡分片的设计对未来多卡不设障（每卡一把锁一本账）。

## Consequences

正向：

- **消除单卡静默退化**：竞争被转化为三种确定性结果——放得下则共驻、放不下则干净驱逐（成本是有界的重载冷启动，而非 10× 的竞争拖慢）、彻底放不下则 fail-fast 明确报错。
- **显存状态可观测**：账本 + `effective_device` 放行让「谁在哪张卡、占多少、是否退回 CPU」在管理端可见（L0/L1 即交付此价值，不必等 L2）。
- **多卡零影响**：空间隔离下每卡 ≤1 backend，仲裁器 no-op；开关默认关，存量部署不受影响。
- **复用既有能力**：卸载走已有 `unload()` + `/unload`；协调走已有 Redis；信号量并发闸保留。

负向：

- **静态预算需维护**：模型换代 / 变体切换会让 `budget_mb` 漂移；靠活体 `gpu_info` 漂移告警兜底，但仍是运维负担。
- **Redis 进入派发热路径**：准入决策每次派发都读写 Redis（此前 predict 路径无 Redis 依赖）；锁只锁准入小段以限制影响，但引入了新失败模式（Redis 抖动 → 需降级为「放行不仲裁」）。
- **流水线交替大 backend 仍付重载**：预算准入只在「装得下」时避免抖动；若两个大 backend 在同一单卡上交替且**互相放不下**，每次切换仍要驱逐+重载（这是物理约束，非本方案缺陷；单驻留同样如此，且更糟）。
- **对账是隐蔽 bug 源**：idle-unload / 手动卸载与账本的竞态需靠 60s 对账收敛，窗口内账本可能短暂失真。
- **给核心派发路径加复杂度**：必须功能开关 + 默认关 + 充分测试，避免拖累主流程。

## Alternatives Considered（详）

**单驻留（exclusive-group）**：同组至多一个 backend 驻留，切换即卸载。实现极简、彻底无竞争。**否决**：多阶段预标流水线（如 yolo 检测 → rapidocr OCR，`_run_task_pipeline` 逐阶段调不同 backend）会在**每个阶段边界**抖动卸载/重载，把一次流水线拖成串行冷启动，退化比它要治的竞争更严重。仅当「单卡且 backend 之间几乎不混用」才成立，与流水线诉求冲突。

**仅告警 / status quo+**：只放行 `effective_device`、加超额告警，不做仲裁。**部分采纳为 L1 子层**，但作为终态**否决**：告警把问题变可见，却不解决——运维看到超额后仍只能手动 `/unload`，与现状差别有限。用户已明确要做到自动仲裁（L2）。

**活体显存测量作账本基准**：用 `gpu_info` 实时用量做准入。**否决**：共享卡上 device 级 `used_mb` 整卡聚合会重复计数，`process_memory_mb` 归因语义不可靠；静态声明预算虽需维护但确定、可预测，更适合做准入基准，活体数据退居漂移校准。

**纯进程内协调（不引 Redis）**：在 `asyncio.Semaphore` 之上加进程内编排。**否决**：API 与每个 Celery worker 是独立进程各持一份信号量（`ml_client.py:17` 模块级 dict），进程内编排无法阻止跨进程互相驱逐/重载的抖动，跨进程锁不可省。

**多卡自动放置 / 副本 scale-out（L3）**：defer，理由见 Decision L3。

## Notes

- **前置依赖**：L0 的 `effective_device` 放行由 [ML backend CPU fallback 审计计划](../plans/2026-07-13-ml-backend-cpu-fallback-audit.md)（WS4）交付；本 ADR 与该计划是「地基 ↔ 上层」关系，建议该计划先行。
- **主要代码触点**：仲裁 gate 加在 `ml_client.py`（`predict` / `predict_interactive` 的 `_acquire()` 前）；派发方 `tasks.py:481`（`_run_batch`）、`video_tracker_runner.py:800`；注册表列 `ml_backend_registry.py:16` + alembic 迁移；开关与卡容量 `config.py`；新增 `app/services/gpu_arbiter.py` + Redis 账本；卸载复用 `ml_backends.py:304`。
- **配置**：`gpu_arbiter_enabled`（默认 false）、`card_total_mb` 兜底、per-backend `vram_budget_mb` / `priority` / `gpu_device_id`。
- **触发 / 灰度**：默认关；单卡多 backend 部署开启。上线先 L1（超额告警）验证预算数值，再开 L2 仲裁。
- **相关**：ADR-0044（全局注册表）、ADR-0012（backend 独立 GPU 服务）、ADR-0038（backend 基类推迟）、ROADMAP §A「跨 backend 显存互斥编排」。
