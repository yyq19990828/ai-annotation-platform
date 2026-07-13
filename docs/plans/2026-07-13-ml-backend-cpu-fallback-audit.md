# ML backend GPU 失效 → CPU fallback 健壮性审计（四镜像）+ effective_device 平台可观测

- 状态：draft
- 日期：2026-07-13
- 关联：
  - 黄金标准：`apps/yolo-backend/main.py`、`apps/yolo-backend/predictor.py`（yolo 已开路，本计划照抄到四镜像）。
  - 上层依赖：[ADR-0049 跨 backend 显存互斥编排](../adr/0049-cross-backend-gpu-memory-arbitration.md) —— 本计划的 **WS4** 交付该 ADR 的 **L0 观测地基**（`effective_device` 放行 + 落库），两者是「地基 ↔ 上层」关系，本计划先行。
  - ROADMAP §B「性能 / 扩展 · ML 后端 GPU 失效 → CPU fallback 健壮性审计（剩余四镜像，P2）」。
  - 共享包：`apps/_shared/backend_runtime/`（包名 `aap_backend_runtime`，五镜像 `pip install -e`）。

---

## 1. 背景

yolo-backend 已把「GPU 失效 → CPU fallback」做对，四个要素齐备：

- **真实设备探测**（不是裸 `is_available()`）：`_effective_device()`（`yolo-backend/main.py:96-119`）用 `torch.zeros(1, device=DEVICE)` 真分配一块显存探测；`is_available()` 只查驱动可见性，GPU 上下文损坏时它仍返回 True，但任何 CUDA 算子会抛错。
- **失败 latch CPU**：`_latch_cpu()`（`main.py:122-127`）+ `_effective_device_cache` 全局，探过 / 退回后不再反复试 CUDA。
- **显式贯通**：`_build_model()`（`main.py:165-175`）`model.to(dev)` 失败即 latch 并**强制把模型搬到 CPU**（否则 predict 仍走 CUDA 硬 500）；predict 四处显式传 `device=str(model.device)`（`predictor.py:237/309/383/450`）。
- **`/health` 暴露**：`provisioning.effective_device`（`main.py:280-287`），`None`=未加载、`"cpu"`=已静默退回。

其余四镜像仍是**裸判定**，坏上下文时会硬 500 或黑盒退化且不可观测：

| 镜像 | 框架 | 现状 device 判定 | 问题 |
|---|---|---|---|
| grounded-sam2 | torch | `self.device = "cuda" if is_available() else "cpu"`（`predictor.py:106`、`video_predictor.py:86`） | 无探测/latch；坏上下文 → `build_sam2`/predict 抛 CUDA error → 硬 500 |
| sam3 | torch | 同款（`predictor.py:105`；autocast 三处 `torch.autocast(self.device, enabled=(self.device=="cuda"))` @ `217/302/363` 绑定该值） | 同上；autocast 会跟随 `self.device` |
| rapidocr | onnxruntime | `RAPIDOCR_DEVICE` env → `use_cuda` 布尔透传给 RapidOCR（`predictor.py:101/142-155`） | 无显式 provider 优先级、无探测、`use_cuda` 只进日志、生效 provider 不可观测 |
| onnxtools | onnxruntime | backend 无 ORT 代码，全在仓库外 `onnxtools` 包（`main.py:119-120`） | fallback 纯靠 ORT 自身行为；`/health` 无任何 device/provider 字段 |

且 **`effective_device` 即便产出也被平台丢弃**：客户端两处白名单（`ml_client.py:139-153`、`ml_health.py:41-51`）不含 `provisioning`/`effective_device`，注册表 `health_meta` 与 PerfHud 快照都拿不到 —— 平台无法判断某 backend 是否已静默退回 CPU，下游告警也无从建。

## 2. 目标 / 非目标

**目标**
- 五镜像统一「真实设备探测 + 失败 latch + `/health` 暴露有效设备/provider」：torch 系（yolo/gsam2/sam3）抽共享 helper 复用；ORT 系（rapidocr/onnxtools）显式声明 provider 优先级 + 探实际生效 provider。
- 平台放行 `effective_device`/生效 provider 进 `health_meta`，管理端出「GPU 静默退回 CPU」信号 —— 即 ADR-0049 的 L0 观测地基。

**非目标（本次不做）**
- **不做显存仲裁 / 卸载编排**：那是 ADR-0049（议题一），本计划只交付它依赖的观测地基。
- **不改仓库外 `onnxtools` 包内部**：onnxtools/rapidocr 只在 backend 侧显式声明 provider 优先级 + 启动探测报生效 provider，不深挖第三方包 ORT 会话实现。
- **不重构 yolo 的推理逻辑**：yolo 仅从自有实现平移到共享 helper（同逻辑，收敛单一真值），行为不变。

## 3. 工作分解

### WS1 · 共享 helper（`aap_backend_runtime/device.py`，torch 系）

- 新增 `device.py`：`effective_device(configured: str) -> str`（真实 `torch.zeros(1, device=)` 探测 + 缓存 latch）、`latch_cpu(reason: str)`。**torch 懒引入**（包裹在 try 内，与现有 `free_gpu_memory` 一致——`torch` 刻意不在 `aap_backend_runtime` 依赖里，避免 `pip install -e` 覆盖 base image 预装 torch）。
- 从 `__init__.py` 导出。
- **yolo 迁移**：把 `_effective_device()`/`_latch_cpu()` 换成共享 helper 调用，收敛成一份实现。
- ⚠️ 改共享包 → **rebuild 全部五镜像**（五镜像都 editable 装它）。

### WS2 · torch 系 gsam2 / sam3

- 用 `effective_device(configured)` 替换裸 `self.device = "cuda" if is_available() else "cpu"`；`self.device` 改为运行期可变，`build`/predict 失败时 `latch_cpu()` 并强制 `.to("cpu")`（照 yolo `_build_model` 模式）。
- sam3 的三处 `autocast(self.device, ..., enabled=(self.device=="cuda"))` 会**自动跟随**（值变 `"cpu"` 时 device_type=cpu、enabled=False，语义正确），无需单独改。
- `/health` 暴露有效设备：⚠️ **避开 gsam2 的 `provisioning` 撞名**——gsam2 的 `provisioning`（`main.py:466`）语义是 checkpoint 下载状态。统一改用新键 `compute: { configured_device, effective_device }`，**五镜像同形**（含把 yolo 的 `provisioning.effective_device` 也并到 `compute`，或保留兼容别名，最终形态待定，见 §5 决策点）。

### WS3 · ORT 系 rapidocr / onnxtools

- 显式声明 `providers=['CUDAExecutionProvider', 'CPUExecutionProvider']`（让 ORT 在 CUDA 初始化失败时自动落 CPU）。
- **启动探测**：构造一个极小 ORT session，用 `session.get_providers()[0]` 读**实际生效 provider**，写进 `/health`（`compute.effective_provider`）。
- rapidocr：核实 RapidOCR 能否把 provider 优先级透传（当前只透传 `use_cuda` 布尔）；拿不到就在 backend 侧另建探测 session 旁证。
- **坏上下文（非缺 provider）能否降级**：需真机验证。⚠️ **timebox**：拿不到深度内省就交付「声明优先级 + 启动探测报生效 provider」，把「坏上下文自动降级」验证标为残留（需一个坏 GPU 测试台）。

### WS4 · 平台放行 + 消费（= ADR-0049 L0 地基）

- 白名单放行：`ml_client.py:139-153` 与 `ml_health.py:41-51` 加入 `compute`（`effective_device` / `effective_provider`）。
- 落进注册表 `health_meta`（走已有 `MLBackendService.check_health` 路径）。
- 管理端：ML backend 列表 / 详情加「配置 GPU 但实际跑在 CPU」角标 + 告警信号（PerfHud 可选联动）。

## 4. 测试

- **共享 helper 单测**：mock `torch.zeros` 抛异常 → 断言 `effective_device` 返回 `"cpu"` 且 latch（二次调用不再试 CUDA）；正常路径断言返回 configured。
- **各 backend `/health` 契约测**：断言返回含 `compute.effective_device`（torch 系）/ `compute.effective_provider`（ORT 系）。
- **平台放行断言**：`health_meta()` 抽取后含 `compute`；`check_health` 落库后注册表可读。
- 真实 GPU 失效难在 CI 复现，latch 逻辑靠 mock 覆盖；坏上下文 ORT 降级留真机手测（见 WS3 timebox）。
- 完成后清理测试中间产物（临时脚本 / 探测缓存）。

## 5. 风险 / 决策点

- **五镜像同时 rebuild**：改共享包 `aap_backend_runtime` 会波及全部五镜像（editable 安装），改完须 `docker compose ... build <service>`，`restart` 不生效。分批验证：先 yolo（回归黄金标准不变），再 gsam2/sam3，最后 ORT 两个。
- **`compute` 字段最终形态（决策点）**：是把 yolo 的 `provisioning.effective_device` 也搬进 `compute` 统一五镜像，还是新老键并存留兼容别名？倾向统一为 `compute`，但会动 yolo `/health` 契约与任何已消费 `provisioning.effective_device` 的代码——落地时先 grep 确认消费方（现状：平台侧尚无消费方，仅 backend 自产）。
- **ORT 坏上下文验证**：见 WS3 timebox，可能交付「声明 + 探测生效 provider」而将深度降级验证移交残留。
- **/health 五镜像形状已漂移**（yolo `status`+`provisioning` vs gsam2/sam3 `ok`+`gpu` vs rapidocr/onnxtools 无 gpu_info），新增 `compute` 时需分别贴合各自现有结构，不强行合并外层。

## 6. 交付顺序

WS1 → （WS2 ‖ WS3）→ WS4。WS4 完成即解锁 ADR-0049 的 L1/L2。

## Outcome

（待实施后回填：落地版本 / commit、正式文档路径、CHANGELOG 条目、未尽事项）
