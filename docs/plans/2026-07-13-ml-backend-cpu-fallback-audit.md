# ML backend GPU 失效 → CPU fallback 健壮性审计（四镜像）+ effective_device 平台可观测

- 状态：**v0.22.3 · 执行中**
- 日期：2026-07-13（计划），2026-07-14（执行）
- 关联：
  - 黄金标准：`apps/yolo-backend/main.py`、`apps/yolo-backend/predictor.py`（yolo 已开路，共享 helper 已收敛到 `aap_backend_runtime.device`）。
  - 上层依赖：[ADR-0049 跨 backend 显存互斥编排](../adr/0049-cross-backend-gpu-memory-arbitration.md) —— 本计划的 **WS4** 交付该 ADR 的 **L0 观测地基**（`effective_device` 放行 + 落库），两者是「地基 ↔ 上层」关系，本计划先行。
  - ROADMAP §B「性能 / 扩展 · ML 后端 GPU 失效 → CPU fallback 健壮性审计（剩余四镜像，P2）」。
  - 共享包：`apps/_shared/backend_runtime/`（包名 `aap_backend_runtime`，五镜像 `pip install -e`）。

---

## 1. 背景

yolo-backend 已把「GPU 失效 → CPU fallback」做对，四个要素齐备：

- **真实设备探测**（不是裸 `is_available()`）：`effective_device(configured)`（`aap_backend_runtime/device.py`）用 `torch.zeros(1, device=configured)` 真分配一块显存探测；`is_available()` 只查驱动可见性，GPU 上下文损坏时它仍返回 True，但任何 CUDA 算子会抛错。
- **失败 latch CPU**：`latch_cpu(reason)` + 模块级 cache，探过 / 退回后不再反复试 CUDA。
- **显式贯通**：`_build_model()`（`main.py:130-175`）`model.to(dev)` 失败即 latch 并**强制把模型搬到 CPU**（否则 predict 仍走 CUDA 硬 500）；predict 四处显式传 `device=str(model.device)`（`predictor.py:237/309/383/448`）。
- **`/health` 暴露**：统一顶层 `compute: {configured_device, effective_device}`（`None`=未加载、`"cpu"`=已静默退回）。

其余四镜像仍是**裸判定**，坏上下文时会硬 500 或黑盒退化且不可观测：

| 镜像 | 框架 | 现状 device 判定 | 问题 |
|---|---|---|---|
| grounded-sam2 | torch | `self.device = "cuda" if is_available() else "cpu"`（`predictor.py:106`、`video_predictor.py:86`） | 无探测/latch；坏上下文 → `build_sam2`/predict 抛 CUDA error → 硬 500 |
| sam3 | torch | 同款（`predictor.py:105`；autocast 三处 `torch.autocast(self.device, enabled=(self.device=="cuda"))` @ `217/302/363` 绑定该值） | 同上；autocast 会跟随 `self.device` |
| rapidocr | onnxruntime | `RAPIDOCR_DEVICE` env → `use_cuda` 布尔透传给 RapidOCR（`predictor.py:101/142-155`） | 无显式 provider 优先级、无探测；`use_cuda` 透传后不验证是否生效、生效 provider 不可观测 |
| onnxtools | onnxruntime | backend 无 ORT 代码，全在仓库外 `onnxtools` 包（`main.py:119-120`） | fallback 纯靠 ORT 自身行为；`/health` 无任何 device/provider 字段 |

且 **`effective_device` 即便产出也被平台丢弃**：客户端两处白名单（`ml_client.py:139-153`、`ml_health.py:41-51`）不含 `compute`/`effective_device`，注册表 `health_meta` 与 PerfHud 快照都拿不到 —— 平台无法判断某 backend 是否已静默退回 CPU，下游告警也无从建。

## 2. 目标 / 非目标

**目标**
- 五镜像统一「真实设备探测 + 失败 latch + `/health` 暴露有效设备/provider」：torch 系（yolo/gsam2/sam3）用共享 helper `aap_backend_runtime.device` 复用；ORT 系（rapidocr/onnxtools）启动期功能探测报生效 provider。
- 平台放行 `compute`（`effective_device` / `effective_provider`）进 `health_meta`，管理端出「GPU 静默退回 CPU」角标 —— 即 ADR-0049 的 L0 观测地基。

**非目标（本次不做）**
- **不做显存仲裁 / 卸载编排**：那是 ADR-0049（L1/L2），本计划只交付它依赖的观测地基。
- **不改仓库外 `onnxtools` / RapidOCR 包内部**：只在 backend 侧显式声明 provider 优先级 + 启动探测报生效 provider。`VehicleAttributePipeline` 不接受 providers kwarg（第三方限制），标为残留。
- **不重构 yolo 的推理逻辑**：yolo 仅从自有实现平移到共享 helper（同逻辑，收敛单一真值），行为不变。

**决策点（已定）**
- ✅ **`compute` 字段统一为顶层新键**：五镜像同形 `compute: {configured_device, effective_device | effective_provider}`。yolo 删除旧 `provisioning.effective_device`（已确认平台侧与前端零消费方），`provisioning` 仅保留 device/strict_offline/checkpoints_dir。gsam2 的 `provisioning`（checkpoint 下载状态）不碰。

## 3. 工作分解

### WS1 · 共享 helper（`aap_backend_runtime/device.py`，torch 系）✅

- 新增 `device.py`：`effective_device(configured) -> str`（真实 `torch.zeros(1, device=)` 探测 + 缓存 latch）、`latch_cpu(reason)`、`effective_device_value()`（读 cache 原值供 `/health`）。torch 懒引入（包裹在 try 内，与 `gpu.py` 的 `free_gpu_memory` 一致）。
- 从 `__init__.py` 导出。
- **yolo 迁移完成**：删除自有 `_effective_device_cache`/`_effective_device()`/`_latch_cpu()`，改 import 共享 helper；`_build_model` 调用点改为 `effective_device(DEVICE)` / `latch_cpu(...)`。`/health` 从 `provisioning.effective_device` 迁到顶层 `compute`。
- ⚠️ 改共享包 → **rebuild 全部五镜像**（五镜像都 editable 装它）。

### WS2 · torch 系 gsam2 / sam3（7 处构建点）

- 用 `effective_device("cuda")` 替换裸 `self.device = "cuda" if is_available() else "cpu"`；`self.device` 改为运行期可变，build 失败时 `latch_cpu()` 并重试（有 device kwarg 的传 `"cpu"` 重构，无 kwarg 的对返回对象 `.to("cpu")`）。
- sam3 三处 `autocast(self.device, ..., enabled=(self.device=="cuda"))` **自动跟随**（值变 `"cpu"` 时 device_type=cpu、enabled=False，语义正确），无需单独改。

**7 处构建点明细：**

| 镜像 | 文件 | 函数 | 构建 API | device 传法 |
|---|---|---|---|---|
| gsam2 | `predictor.py` | `_load_sam` :120 | `build_sam2(..., device=)` | 失败重试传 `"cpu"` |
| gsam2 | `predictor.py` | `_load_dino` :135 | `load_model(..., device=)` | 失败重试传 `"cpu"` |
| gsam2 | `video_predictor.py` | `_load_video_predictor` :100 | `build_sam2_video_predictor(..., device=)` | 失败重试传 `"cpu"` |
| sam3 | `predictor.py` | `_load_model` :137 | `build_sam3_image_model(..., device=)` | 失败重试传 `"cpu"` |
| sam3 | `predictor.py` | `_build_processor` :150 | `Sam3Processor(..., device=)` | 跟随 model 重试 |
| sam3 | `video_predictor.py` | `_load_predictor` :83 | `build_sam3_multiplex_video_predictor(...)`（无 device kwarg） | 失败后对返回对象 `.to("cpu")` |
| sam3 | `pvs_video_predictor.py` | `_load_predictor` :90 | `build_sam3_video_model(...)`（无 device kwarg） | 失败后对返回对象 `.to("cpu")` |

- `/health` 暴露：五镜像统一顶层 `compute: {configured_device, effective_device}`。⚠️ **不碰 gsam2 的 `provisioning`**（checkpoint 下载状态，语义不同）。

### WS3 · ORT 系 rapidocr / onnxtools

**关键发现**：RapidOCR 不接受 providers list，只接受 `use_cuda` 布尔；其内部 fallback 仅软检查（`get_device()=="GPU"`），CUDA 列出但损坏时 `InferenceSession()` 会硬抛错。`onnxtools` 包的 `create_detector`/`VehicleAttributeORT` 接受 `providers=` kwarg，且有现成 `get_best_available_providers(model_path)` 模板。

- **rapidocr**：`lifespan` 启动期功能探测 ORT CUDA（真建 `InferenceSession(providers=['CUDAExecutionProvider'])`，模仿 `onnxtools/infer_utils.get_best_available_providers`），探失败则 `use_cuda=False`，再构造 predictor。`/health` 加 `compute: {configured_device, effective_provider}`。
- **onnxtools**：`lifespan` 启动期调用 provider 探测，缓存 provider list；`_make_detector`/`_make_va_classifier` 透传 `providers=`。`/health` 加 `compute`。
- ⚠️ **timebox**：坏上下文（非缺 provider）降级靠 mock 覆盖启动探测；真机深度验证标残留（需坏 GPU 测试台）。

### WS4 · 平台放行 + 消费（= ADR-0049 L0 地基）

- **白名单放行（2 处 gating chokepoint）**：`ml_client.py:141-151` 与 `ml_health.py:41-51` 加入 `"compute"`。
- **落进注册表 `health_meta`**（走已有 `MLBackendService.check_health` 路径，写整个 meta dict，无需改）。
- **API schema**：`HealthMeta`（`extra="allow"`）自动透传；显式加 `ComputeInfo` 类型化字段 + `MLBackendStatsSnapshot` 同步。
- **前端**：`adminMlIntegrations.ts` `BackendHealthMeta` + `useMLBackendStats.ts` `BackendSnapshot` 加 `compute` 类型；`RuntimeObservePanel.tsx` `RegisteredRuntimeCard` + PerfHud `backendMeta` 加「⚠ CPU 回退」警示色角标（配置了 GPU 但 effective 为 CPU 时显示）。

## 4. 测试

- **共享 helper 单测**（✅ `tests/test_device.py`，7 测）：mock `torch.zeros` 抛异常 → 断言 `effective_device` 返回 `"cpu"` 且 latch（二次调用不再试 CUDA）；正常路径断言返回 configured；configured=cpu 直返；无 torch 回退。
- **各 backend `/health` 契约测**：断言返回含 `compute.effective_device`（torch 系）/ `compute.effective_provider`（ORT 系）。
- **平台放行断言**：`health_meta()` 抽取后含 `compute`；`check_health` 落库后注册表可读。
- 真实 GPU 失效难在 CI 复现，latch 逻辑靠 mock 覆盖；坏上下文 ORT 降级留真机手测（见 WS3 timebox）。

## 5. 风险 / 决策点

- **五镜像同时 rebuild**：改共享包 `aap_backend_runtime` 会波及全部五镜像（editable 安装），改完须 `docker compose ... build <service>`，`restart` 不生效。分批验证：先 yolo（回归黄金标准不变），再 gsam2/sam3，最后 ORT 两个。
- ✅ **`compute` 字段最终形态（已定）**：统一为顶层 `compute`，yolo 删除旧 `provisioning.effective_device`。已 grep 确认平台侧与前端零消费方，无破坏。
- **ORT 坏上下文验证**：见 WS3 timebox，交付「声明 + 探测生效 provider」，深度降级验证移交残留。
- **/health 五镜像形状已漂移**（yolo `status`+`provisioning` vs gsam2/sam3 `ok`+`gpu` vs rapidocr/onnxtools 无 gpu_info），新增 `compute` 时分别贴合各自现有结构，不强行合并外层。

## 6. 交付顺序

WS1（✅）→ （WS2 ‖ WS3）→ WS4。WS4 完成即解锁 ADR-0049 的 L1/L2。

## Outcome

- v0.22.3 执行中。WS1 已提交（commit `2b059307`）。WS2/WS3/WS4 并行执行中。
