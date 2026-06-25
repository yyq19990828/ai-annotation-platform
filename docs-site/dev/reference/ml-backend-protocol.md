---
audience: [dev, ops]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-06-08
---

# ML Backend 协议契约

> 适用读者：要把自家推理服务接入到本平台的工程师；项目管理员配置 ML Backend 时遇到调试问题。
>
> 平台侧实现：
> - 服务: `apps/api/app/services/ml_backend.py` · `ml_client.py`
> - HTTP 接入点: `apps/api/app/api/v1/ml_backends.py`
> - 数据模型: `apps/api/app/db/models/{ml_backend,prediction}.py`

平台不内置任何具体模型。它把每个项目可挂接的「推理服务」抽象成 `MLBackend` 行——一个 URL + 鉴权信息 + 几个布尔位（`is_interactive` / `state`）。本文规定接入方需要实现的 4 个 HTTP 端点与请求/响应 schema。只要遵循，就能在「项目设置 → ML Backends」里挂接。

---

## 项目作用域与数量上限

`ml_backends.project_id` 按 1:N 设计；同一个项目可以注册多条 backend 记录，前端的多 backend 选择器也会在配额放开后自然生效。当前开发环境默认 `MAX_ML_BACKENDS_PER_PROJECT=1`，是为了避免单机同时常驻 grounded-sam2 与 sam3 等大模型导致显存爆掉；生产环境可按机器显存和并发预算调大该值。

这个限制只影响「一个项目能注册多少条 backend」。新建项目时选择「复用 backend」仍会复制一条 backend 行到新项目；未注册 backend 但已启用 AI 的项目也会出现在模型市场，便于从模型市场直接注册第一条 backend。

---

## 端点总览

| 端点 | 方法 | 用途 | 必需 | 平台调用点 |
|---|---|---|---|---|
| `/health` | GET | 健康检查 | ✅ | `MLBackendClient.health` (`ml_client.py:31`) |
| `/predict` | POST | 批量 / 交互式预测 | ✅ | `MLBackendClient.predict` (`ml_client.py:41`) / `predict_interactive` (`ml_client.py:64`) |
| `/setup` | GET | 返回模型配置（schema、超参） | ⚪ | `MLBackendClient.setup` (`ml_client.py:84`) |
| `/warmup` | POST | 显式预热模型权重到 pool | ⚪ | `MLBackendClient.warmup` |
| `/versions` | GET | 列出可用模型版本 | ⚪ | `MLBackendClient.get_versions` (`ml_client.py:90`) |

base URL 由项目管理员在前端 ProjectSettings → ML Backends 录入；末尾 `/` 会被平台自动 `rstrip` (`ml_client.py:21`)。

---

## 鉴权

`MLBackend.auth_method` 二选一（`ml_backend.py:22`）：

- `none`（默认）— 平台不发送任何认证头。
- `token` — 平台在所有请求加 `Authorization: Bearer <auth_token>`（`ml_client.py:25-29`）。`auth_token` 在 ProjectSettings 录入，存 PG 加密列，仅服务端可见。

未来扩展（如 mTLS、HMAC 签名）走新 `auth_method` 值，不破坏现有 backend。

---

## 1. `GET /health`

**用途**：握手 / 周期探活。返回 200 表示在线。

**请求**：无 body。可能携带 `Authorization: Bearer ...`。

**响应**：HTTP 状态码即结论。`MLBackendClient.health` 不解析 body，只看 `status_code == 200`（`ml_client.py:33-39`）。

**超时**：服务端配置 `ml_health_timeout`（默认 10s，`config.py:55`）。超时或任何 `httpx.RequestError` 视为不健康，平台将 `ml_backends.state` 改写为 `"error"`（`ml_backend.py:63`）。

平台侧调用时机：
- 项目管理员在前端点「测试连接」（`POST /api/v1/projects/{pid}/ml-backends/{bid}/health`）。
- 周期健康检查可按 ROADMAP 的 ML Backend 健康检查方案扩展。

> **`pool` 子对象**（v0.14.14 起三 backend 统一为 `PoolStatus` 结构，详见 §4.3）：`{ cap, current_size, loaded_keys: [{key, loaded_at, last_used_at, hit_count}], last_evict: {key, at, reason} | null }`。`key` 是 backend-defined 的 opaque 字符串（yolo `{series}/{size}/{task}`、gsam2 `sam=X/dino=Y`、sam3 `sam3.1`），前端只做相等比较。`last_evict.reason` 受控为 `lru | manual | idle_timeout`。平台 `health_meta()` 一并缓存到 `ml_backends.health_meta.pool`，模型市场列表用 `loaded_keys[]` 反查每行 variant 的运行时态。**老 backend**（v0.14.13 及之前）的 `pool` 字段结构是各家各异的旧格式，平台层向后兼容；新接入的 backend 必须按 §4.3 落地。

> **可选模型管理端点 `POST /reload` / `POST /unload`**（非协议必需，grounded-sam2 实现）：`/unload` 清空整池释放显存；`/reload` 预热模型进 pool。`/reload` 接受可选 body `{ "sam_variant": "small", "dino_variant": "B" }` 预热**指定变体**（缺省回退 backend 启动默认变体；非法变体值 422，校验同 `/predict` 的 `context.model_variants`）；也接受可选 `"task_type": "image" | "video"`（默认 `image`，向后兼容）：`task_type="video"` 时**只认 `sam_variant`**（video tracker 不用 DINO），预热**独立 video 池** `VideoPool`，返回 `{ ok, loaded, reloaded, sam_variant, task_type: "video" }`。平台经 `POST /api/v1/projects/{pid}/ml-backends/{bid}/reload`（同 body）代理，模型市场「变体」面板按图像 / 视频两组分别走此链路。新 backend 应优先实现 §4.4 `/warmup`。

---

## 2. `POST /predict`

平台用同一个端点跑两种工作流。请求体 schema 由 backend 类型决定。

### 2.1 批量预测（同步）

适用：项目级「自动预标注」。Celery worker 把 task 切片成 batch，逐 batch 调一次 `/predict`。

**请求**：
```json
{
  "tasks": [
    { "id": "<task_uuid>", "file_path": "<presigned_url_or_relative_path>" },
    ...
  ]
}
```

`tasks` 是一个数组；具体每项的字段由平台与 backend 协商，但平台调用方至少传 `id` + 可访问的 `file_path`。详见 `app/workers/tasks.py:batch_predict` 任务（自动预标注的实际生产者）。

**响应**：
```json
{
  "results": [
    {
      "task": "<task_uuid>",                 // 必填；与请求 tasks[i].id 对应
      "result": [<annotation>, ...],         // 必填；标注 schema 见下文 §3
      "score": 0.92,                         // 可选；整体置信度，写入 predictions.score
      "model_version": "v1.2.3",             // 可选；写入 predictions.model_version
      "inference_time_ms": 245,              // 可选；写入 prediction_metas.inference_time_ms
      "cache_hit": true,                     // v0.14.14 可选；true=权重在 pool 内复用,false=本次触发加载
      "model_load_ms": 0,                    // v0.14.14 可选；本次加载耗时(ms)，cache_hit=true 时通常为 0
      "pool_state": { "current_size": 2, "cap": 4 }  // v0.14.14 可选；轻量 pool 快照
    },
    ...
  ]
}
```

> **v0.14.14 运行时观测三件套**（`cache_hit` / `model_load_ms` / `pool_state`）：详见 §4.2。所有 backend 应在 `/predict` 与 `/warmup`（§4.4）响应里至少填 `cache_hit` 与 `model_load_ms`，前端据此切换"加载中…"和"推理中…"按钮文案。三个字段都是可选的，缺省时前端走"未知"路径（按热路径渲染，第一次响应回来后修正）。

平台侧解析：`MLBackendClient.predict` (`ml_client.py:41-62`) 把每项映射到 `PredictionResult` dataclass，再由调用方落到 `predictions` / `prediction_metas` 表。

**超时**：服务端配置 `ml_predict_timeout`（默认 100s，`config.py:54`）。超时由 worker 捕获，写一行 `failed_predictions` 并继续下一 batch（不阻断）。

### 2.1.1 几何 prompt 批量（下游编排 stage） <!-- since 协议 v2.2 -->

适用：多阶段预标注的**下游 stage** —— 上游检测器（YOLO / onnxtools-detect / grounded-sam2-detection）已产出 bbox，下游一个**非交互、批量**的 model（如 grounded-sam2 `box-seg`）消费这些框、对每框出 mask/polygon。

**载荷形态（form 1a：全图 + 原图坐标框列表）**：下游 stage 收**全图 presigned URL**（复用上游 stage 的同一 URL）+ 该图的 **N 个父框（原图归一化坐标）列表**，而非逐 crop 裁图。这样 backend 对一张图只 `set_image` 一次（SAM2 encoder 成本由 `set_image` 次数决定，与裁多小无关），N 个框共享同一份 image embedding，跑轻量 decoder：

```json
{
  "tasks": [
    {
      "id": "<task_uuid>",
      "file_path": "<presigned_url>",          // 全图，与上游 stage 同一 URL
      "prompts": [                              // 单图多框：上游框列表
        { "box": [x1, y1, x2, y2], "parent_box_idx": 0 },   // 原图归一化坐标 [0,1]
        { "box": [x1, y1, x2, y2], "parent_box_idx": 1 }
      ]
    }
  ]
}
```

**响应**：与 §2.1 同构，但下游每框输出按 `parent_box_idx` 标回，平台据此 merge 回对应父框（polygon 已是原图坐标，**无需坐标回映**）：

```json
{
  "results": [
    {
      "task": "<task_uuid>",
      "result": [
        { "type": "polygonlabels", "value": { "points": [...], "polygonlabels": ["object"] },
          "parent_box_idx": 0 },
        { "type": "polygonlabels", "value": { "points": [...], "polygonlabels": ["object"] },
          "parent_box_idx": 1 }
      ]
    }
  ]
}
```

**判别器**：投递方式是「产物形态」（下游阶段 `write.target`）与「投递方式」（下游 model 的 `supported_inputs`，见 §3.1）二维决定的：

- `write.target=attributes` → **crop 模式**：平台逐父框裁 crop 图上传，下游收单张 ROI 回属性（如 onnxtools 纯分类）。
- `write.target ∈ {geometry, intermediate}` 且下游 `supported_inputs` 含 `bbox_prompt` → **geometry 模式**：全图 + 父框归一化列表喂 box-seg 原子，回原图坐标 polygon。
- `write.target ∈ {geometry, intermediate}` 且下游 `supported_inputs` 含 `crop`（普通检测器） → **crop-detect 模式**：平台裁父框 ROI 喂检测器，检出几何按 crop 仿射变换**回映回原图坐标**，作为新框追加 / 供下游消费（支持几何 depth-3，如 `person → 在 person crop 上检测 hat → 给 hat 分类 color`）。

平台在 `POST /preannotate` 端点按子模型 `supported_inputs` 解析投递方式并烘焙进阶段 `input.mode`，worker 直接消费；产几何的子若 `supported_inputs` 既不含 `bbox_prompt` 也不含 `crop`，端点 422 拒绝（不可达）。老 backend 缺 `supported_inputs` 时平台按 `supported_prompts` 合成兼容默认（见 §3.1），零退化。本约定纯加法。

### 2.2 交互式预测

适用：标注员在工作台内点「AI 助手」工具发起的单次推理。

只有 `is_interactive=True` 且 `state="connected"` 的 backend 才会被路由到这条路径（`ml_backend.py:67-75`）。

**请求**：
```json
{
  "task": { "id": "<task_uuid>", "file_path": "..." },
  "context": {
    "type": "point" | "bbox" | "polygon" | "text" | "exemplar",
    "points": [[x, y], ...],                // type=point 时
    "bbox": [x1, y1, x2, y2],               // type=bbox 时 (prompt 框) 或 type=exemplar 时 (视觉示例框)
    "labels": [1, 0, ...],                  // 可选；point 类型，1=positive 0=negative
    "text": "ripe apples",                  // type=text 时（Grounded-SAM-2 / SAM 3 PCS 文本入口）
    "output": "box" | "mask" | "both",      // 仅 type=text 生效, 默认 "mask" 老前端兼容
    "box_threshold": 0.35,                  // 可选; type=text 时 backend 的 DINO 阈值 override (grounded-sam2 专属)
    "text_threshold": 0.25,                 // 可选; 同上
    "score_threshold": 0.5,                 // SAM 3 PCS text/exemplar 路径 score 过滤阈值
    "simplify_tolerance": 1.0,              // shapely.simplify 像素级覆盖, 仅 mask/both 路径生效
    "model_variants": {                     // v2.1 通用模型变体轴, key 来自 /setup.supported_variants[].key
      "sam_variant": "large",
      "dino_variant": "B"
    }
  }
}
```

`context` 是个开放 dict——平台和 backend 协商具体字段，平台不做 schema 校验（`ml_client.py:64-82`）。

> **`type=text`**：Grounded-SAM-2 走 GroundingDINO 文本 → boxes → SAM mask 复合链路；SAM 3 走 PCS 单模型一步出 mask。两者返回 `result[]` 字面一致（多 polygon / 多 rect / 配对）。`box_threshold` / `text_threshold` 仅 grounded-sam2 消费；`score_threshold` 仅 SAM 3 消费。

> **`context.model_variants`（v2.1）**：请求级模型变体热切换。结构是扁平 `dict[axis_key, axis_value]`，`axis_key` 必须来自当前 model 的 `/setup.supported_variants[].key`。yolo 示例：`{"series":"yolov11","size":"s"}`；grounded-sam2 示例：`{"sam_variant":"large","dino_variant":"B"}`；sam3 示例：`{"model_variant":"sam3.1"}`。backend 内 ModelPool 按这些轴组成 cache key：命中复用、miss 冷启；非法值或非法组合返回 422；变体合法但权重缺失 / 显存不可服务返回 503 + `Retry-After`。返回 `model_version` 可按本次请求变体拼（如 `grounded-sam2-dinoB-sam2.1large`）。embedding cache 按变体分桶（不同变体张量不可跨用），命中只在同变体同图。
>
> **兼容期旧字段**：v2.1 backend 必须继续接受一版旧写法并 normalize 到 `context.model_variants`：yolo 的 `context.variants`、grounded-sam2 的 `context.sam_variant` / `context.dino_variant`、sam3 的 `context.model_variant`。收到旧字段时应记录 deprecation warning；若新旧字段同时存在，新字段优先。

> **`type=exemplar`**（仅 SAM 3 支持）：取图中已有的一个 bbox 作为视觉示例，由 SAM 3 PCS 一步出全图相似实例的 masks。`bbox` 字段承载 4 坐标（与 `type=bbox` 共用字段，语义靠 `type` 区分）。返回 `result[]` 是多个 `polygonlabels`，`polygonlabels: ["object"]`（前端按当前 active label 批量改写）。apps/api 仅在项目挂了支持 exemplar 的 backend（`/setup.supported_prompts` 含 `exemplar`）时才放行；未挂返回 400。前端 UI 入口在工作台 Shift+拖框。

> **`type=video_tracker`**：由 `VideoTrackerJob` worker 使用，gsam2 backend 接通真实 `sam2_video`。平台会按 `VIDEO_TRACKER_WINDOW_SIZE_FRAMES` 把长区间分窗，多次调用项目绑定的 connected ML Backend。请求 `task.file_path` 是视频 signed URL；`context` 包含 `model_key`（`sam2_video` / `sam3_video`）、`job_id`、`dataset_item_id`、`annotation_id`、`from_frame`、`to_frame`、`direction`、`prompt` 和 `source_geometry`。响应 `result[]` 每项为 `{ frame_index, geometry, confidence?, outside? }`；低于平台阈值的 `confidence` 会被写成 outside prediction range。
>
> 落地细节：
> - **真实推理（gsam2）**：backend 用 `build_sam2_video_predictor` + `SAM2VideoPredictor`（带跨帧 memory bank 的有状态预测，非循环调图片接口），逐帧 mask → 外接 bbox → 归一化坐标。视频解码用容器内 opencv 抽窗内帧到临时 JPEG 目录喂 `init_state`。`confidence` 非空 mask 记 1.0、空 mask（outside）记 0.0。
> - **独立显存池**：video predictor 用独立的 `VideoPool`（按 `sam_variant` 分桶），与图片 `ModelPool` 显存预算分离、互不驱逐，按 job 结束释放会话状态。遵循 [ADR-0012](../adr/0012-sam-backend-as-independent-gpu-service)，predictor 不入 `apps/api`。
> - **`sam_variant`**：请求链路可传——AI 传播对话框选 SAM 尺寸 → `VideoTrackerPropagateRequest.sam_variant` → 存入 `job.prompt` → `TrackerContext` → adapter 在 `context.model_variants.sam_variant` 透传；缺省（未选）时 backend 回退默认 tiny。backend `/predict` video_tracker 分支按 `context.model_variants.sam_variant` 从 `VideoPool` 取对应尺寸 tracker。
> - **跨窗续追（平台侧）**：`video_tracker_runner.py` 窗 1 用原始 keyframe seed，后续窗用上一窗末帧（非 outside）geometry 作 `source_geometry` 续追，避免每窗从首帧框重新起追导致目标漂移。
> - **只回填网格帧（平台侧）**：采样开启时 `apply_tracker_results` 按项目 `derive_step` 只持久化 `frame_index % step == 0` 的预测帧（tracker 仍逐源帧跑，off-grid 帧丢弃），与导航 / 导出网格一致。
>
> **能力声明（`/setup`）**：支持 video tracker 的 backend 在 `/setup` 返回 `supported_trackers: ["sam2_video", ...]`，平台动态消费并用于模态校验。
>
> **观测（`/health` + `/metrics`）**：开了 video 独立池的 backend，`/health` 返回 `video_pool` 区块（PoolStatus：`cap/current_size/loaded_keys/last_evict`，外加 `active_sessions/idle_seconds`）；`/metrics` 增 `video_tracker_frames_processed_total{sam_variant}` / `video_tracker_latency_seconds{sam_variant}`，并对推理指标加 `task_type="image|video"` 维度。模型市场观测页据此按图像 / 视频分类。

> **`output: "box" | "mask" | "both"`**（仅 `type=text` 生效）：
> - `box`：仅 GroundingDINO 出框，跳过 SAM image embedding + mask 推理 + cv2/shapely 简化。返回 `result[]` 全为 `rectanglelabels`，单图 ~50-100ms（4060 / tiny），相比 mask 全链路 200-500ms 快 50-80%。**适用 image-det 项目**：标注员要的就是 bbox annotation。
> - `mask`（**默认**）：DINO + SAM mask → polygon，返回 `polygonlabels`。
> - `both`：同 instance 配对返回 `[rectanglelabels, polygonlabels, ...]` 严格交错（box 优先，对应 polygon 在后）。前端 `Tab` 切活跃几何，`Enter` 接受当前形态。
> - **老 backend 兼容**：缺 `output` 字段时按 `"mask"` 路径返回，零回归。
> - **老前端兼容**：不识别 `rectanglelabels` 候选时只显示 `polygonlabels`。
> - **point/bbox/polygon 类型**：`output` 字段无意义，始终走 SAM mask → polygon。

> **`simplify_tolerance: number`**（可选；缺省走 backend 默认 1.0）：
> - 像素级 shapely.simplify 容差。**大物体 / 大致形状** 调高（2-3）减顶点、提速；**精细物体** 调低（0.3-0.5）保细节。
> - 仅 `output ∈ {"mask", "both"}` 路径生效；`output="box"` 不简化。
> - 单次请求级覆盖；项目级常量化未实现（运维 / dev 通过 `Context.simplify_tolerance` 注入足够，未来可加 ProjectSettings 字段，触发条件：客户提需求）。
> - 后端在返回 polygon 顶点 > 200 时 `logger.warning`（非阻塞，仅运维信号）。

**响应**：单条 `PredictionResult`，**没有外层 `results` 数组**：
```json
{
  "result": [<annotation>, ...],
  "score": 0.85,
  "model_version": "sam-vit-h",
  "inference_time_ms": 180
}
```

---

## 3. `result` 字段 — 标注 schema

`result` 是一个 annotation 对象数组，与 Label Studio 风格兼容。每项至少包含：

```json
{
  "type": "rectanglelabels" | "polygonlabels" | "polylinelabels" | "keypointlabels",
  "value": {
    // type=rectanglelabels：Label Studio 百分比 [0,100]，平台也兼容 [0,1]
    "x": 0.12, "y": 0.34, "width": 0.45, "height": 0.20,
    "rotation": 30,                         // 可选; 存在时读为 rotated_bbox
    "rectanglelabels": ["car"],

    // type=polygonlabels
    "points": [[x, y], ...],   // 同样兼容 [0,100] 与 [0,1]
    "polygonlabels": ["road"],

    // type=polylinelabels
    "points": [[x, y], ...],
    "polylinelabels": ["lane"],

    // type=keypointlabels
    "points": [{"x": 10, "y": 20, "v": 2}, {"x": 30, "y": 40, "v": 1}],
    "keypointlabels": ["person"]
  },
  "score": 0.91                // 单框置信度，可与外层 score 并存
}
```

平台不强校验 schema。图片工作台当前渲染 `rectanglelabels` / `polygonlabels` / `polylinelabels` / `keypointlabels`；`rectanglelabels.value.rotation` 存在时会按旋转框读取，缺失时仍按普通 bbox 读取。`keypointlabels.value.points[]` 使用 `{x,y,v}`，`v` 保留 COCO 可见性 0/1/2。

---

## 4. `GET /setup`

**用途**：自描述 backend 能力，前端 `useMLCapabilities` hook 据此决定哪些 AI 工具可用、参数面板渲染哪些字段。

> 协议背后的架构决策：[ADR-0020 — ML Backend Capability 协商协议](../adr/0020-ml-backend-capability-negotiation.md)。该 ADR 解释了为什么 `params` 限制为 Draft-07 子集、为什么走 apps/api 代理而非前端直连。

**响应**：JSON Schema 自描述协议。**必填**三元组：`name` / `version` / `model_version`；`supported_prompts` 决定 ToolDock 工具置灰；`params` 是 JSON Schema (Draft-07 子集)，前端 schema-form 自动渲染；`supported_variants` 可选，用于给变体选择器补充显存 / 档位 / 推荐等富元数据。

```jsonc
{
  "name": "sam3-backend",                       // 必填. backend 标识
  "version": "0.10.1",                          // 必填. backend 镜像/代码版本
  "protocol_version": "2.1",                     // v0.14.15 起推荐；缺省按 2.0/legacy 兼容
  "compat_protocol_versions": ["2.0"],           // 本 backend 仍接受的旧 minor 版本
  "model_version": "sam3.1",                    // 必填. 实际加载的模型 ckpt 版本
  "is_interactive": true,
  "labels": [],                                 // 可选. backend 已知类别 hint
  "supported_prompts": ["text", "exemplar"],     // 选项 A 的 sam3 不暴露 point/bbox: 物理上只有 PCS 找相似(exemplar)与 text; 单物体点/框需 grounded-sam2 或开 inst_interactivity
  "supported_text_outputs": ["box", "mask", "both"],
  "supported_variants": [
    {
      "key": "sam_variant",
      "title": "SAM 2 变体",
      "variants": [
        { "value": "tiny", "label": "SAM 2.1 Tiny", "vram_gb": 1.5, "tier": "fast" },
        { "value": "small", "label": "SAM 2.1 Small", "vram_gb": 2.5, "tier": "balanced", "recommended": true }
      ]
    }
  ],
  "params": {
    "type": "object",
    "properties": {
      "box_threshold": {
        "type": "number", "minimum": 0, "maximum": 1,
        "default": 0.35, "title": "Box 置信度阈值",
        "x-platform-role": "confidence"
      },
      "sam_variant": {
        "type": "string", "enum": ["tiny", "small", "base_plus", "large"],
        "default": "tiny", "title": "SAM 2 变体",
        "x-platform-role": "modelVariant"
      }
    }
  }
}
```

> **变体 `modelVariant` 语义**：v2.1 起变体选择由 `/setup.supported_variants[].key` 声明，前端发送 `/predict` 时统一放进 `context.model_variants`（详见 §2.2）。如果老 backend 只在 `params.properties.*` 里暴露 enum，则应给该字段标 `x-platform-role: "modelVariant"`；前端会把它移出普通参数表单，渲染到模型变体选择器。
>
> **`supported_variants`（可选）**：用于声明 model variant 轴并补富元数据。结构为数组，每项代表一个轴：`{ key, title?, description?, variants: [{ value, label?, vram_gb?, tier?, recommended?, note? }] }`。`key` 是 `context.model_variants` 的 axis key；`value` 必须与 backend runtime 校验来源一致。前端优先读 `supported_variants` 渲染富选择器，缺失或为空时回落 `params` 中 `x-platform-role=modelVariant` 或 legacy `*_variant.enum` 字段，因此老 backend 不需要立即升级。`tier` 建议使用 `fast | balanced | accurate`，但前端会容忍未知字符串。
>
> v0.14.10 起，超管运行时观测端点 `GET /admin/ml-integrations/observe` 也会把 `/setup.supported_variants` 原样透传到每个 `ObserveTarget.supported_variants`，用于 env-only 容器的只读多轴变体展示。旧 grounded-sam2/sam3 的 `sam_variant` / `dino_variant` enum 仍会通过 `variant_catalog` 双发；仅声明通用 `supported_variants` 的容器暂不启用「试启动」，`POST /admin/ml-integrations/observe/smoke-test` 收到 `variant: {axis: value}` 时返回 `skipped=true`，直到 backend 实现通用 warm 接口。

> **`supported_prompts`**：枚举 `point | bbox | text | exemplar | sketch | scribble | …`。**交互式用户 prompt**，前端 ToolDock 据此置灰不支持的工具。
>
> **`supported_inputs`**（一等输入契约）：枚举 `full_image | crop | bbox_prompt | point_prompt`，声明本 model 能吃哪些**投递形态**，与 `supported_prompts`（交互 prompt）**解耦**——纯分类器 `supported_prompts=[]` 但 `supported_inputs=["full_image","crop"]`；box-seg `supported_inputs=["bbox_prompt","full_image"]`。多阶段编排据此判定父子可达性（产几何的子须含 `bbox_prompt` 或 `crop`）并选择投递方式（见 §2.1.1 判别器）；模型市场「可接受输入」行也由它驱动。**老 backend 缺字段时平台合成兼容默认**：含 `bbox` prompt → `["bbox_prompt","full_image"]`；含 `point` → 加 `point_prompt`；非交互模型额外含 `crop`；任何模型都含 `full_image`（见 services/ml_capabilities.py `_synthesize_supported_inputs`）。
>
> **`supported_text_outputs`**：text 路径支持的 `Context.output` 取值。
>
> **`params` JSON Schema**：当前前端消费的最小类型集 `number | integer | string (含 enum) | boolean`；`readOnly: true` 字段在 UI 上展示但不可改。
>
> **`x-platform-role`（v2.1）**：`params.properties.*` 可用该扩展字段声明平台语义，前端用统一标签渲染但仍按原字段名发送。当前受控值：`confidence` / `iou` / `maxDet` / `textThreshold` / `simplifyTolerance` / `modelVariant`。本版**不统一物理参数名**：yolo 仍用 `conf/iou/max_det`，grounded-sam2 仍用 `box_threshold/text_threshold/simplify_tolerance`，sam3 仍用 `score_threshold/simplify_tolerance`。

**平台代理端点**：前端通过 `GET /api/v1/projects/{id}/ml-backends/{bid}/setup` 拉取；apps/api 30s TTL 进程内缓存，update/delete backend 时自动 invalidate。

**前端兜底**：返回体缺 `supported_prompts` 时前端回落 `["point","bbox","text"]` 并 `console.warn` 提示升级 backend。`/setup` 502 时整套 AI 工具置灰。

> **能力快照持久化**：除上述代理端点的实时拉取外，平台在 `check_health`（services/ml_backend.py）拉完 `/health` 后会 best-effort 再探一次 `/setup`，把能力快照（`supported_prompts` / `supported_trackers` / `supported_text_outputs` / `supported_geometric_outputs` + 平台派生的 `modalities`）落进 `ml_backends.health_meta["capabilities"]`，供「按模态分流 / 绑定校验 / 列表只读展示」消费（无需每处实时拉 `/setup`）。模态派生规则：`supported_prompts` 非空 ⇒ image、`supported_trackers` 非空 ⇒ video（见 services/ml_capabilities.py）。
>
> **`is_interactive` 改派生**：`is_interactive` 不再由注册表单手填，而是以 backend `/setup.is_interactive` 自报为真值，在 `check_health` 时回写 `MLBackend.is_interactive`。backend 必须在 `/setup` 如实声明该位。
>
> **绑定按 data_type 校验**：`PATCH /projects/{id}` 绑定 backend 时实时探 `/setup` 派生模态，与项目 `data_type` 不兼容 → 422；探测失败则 fail-open 放行（mismatch 留到 `/predict` 暴露）。

---

## 4.1 能力声明协议 v2（多模型目录 + infra）

> 协议背后的架构决策：[ADR-0036 — ML Backend 能力声明协议 v2（多模型目录 + infra）](../adr/0036-ml-backend-capability-protocol-v2-multi-model.md)。

§4 描述的 `/setup` 是**单模型快照**形态——隐含「1 个 backend ≈ 1 个模型族」。协议 v2 在**完全向后兼容**前提下，把能力声明下沉到 **model 粒度**，让一个 backend 暴露一份 model list（一个 backend = N 个 model），每个 model 自带能力 + infra + variants。典型消费者是未来的 **YOLO 官仓 backend**（一个仓覆盖 det/seg/pose/obb/cls × series × size）与 **ONNX 聚合 backend**（一个进程聚合检测 / 关键点 / OCR / 抠图等异构模型）。

`/setup` 仍是能力的唯一真相源（SoT），目录是其派生缓存 + UI 视图。`infra` / `models[]` 只影响能力声明与目录展示，**不改 `/predict` 请求/响应 schema**。

### 4.1.1 `/setup` 顶层结构（v2）

```jsonc
{
  // ── 必填三元组（协议 v1 已有，不变）──
  "name": "yolo-ultralytics-backend",
  "version": "0.1.0",              // backend 镜像/代码版本
  "protocol_version": "2.1",       // v0.14.15: model_variants + x-platform-role + 422/503 错误模型
  "compat_protocol_versions": ["2.0"],
  "model_version": "ultralytics-8.3.x",

  // ── v2 新增 ──
  "infra": "pytorch",             // backend 默认基础设施；可被 model.infra 覆盖
  "warmup_endpoint": true,        // v0.14.14: 声明本 backend 支持 POST /warmup（详见 §4.4）
  "models": [ /* §4.1.2 model 条目数组 */ ],

  // ── v1 顶层字段：仍可用，作为「隐式单 model」的兜底（§4.1.5）──
  "is_interactive": false,
  "supported_prompts": [],
  "supported_geometric_outputs": [],
  "supported_variants": [],
  "params": {}
}
```

- `protocol_version="2.1"` ⇒ backend 支持 `context.model_variants`、`x-platform-role` 与标准 422/503 错误模型。`compat_protocol_versions` 用于声明仍接受的旧 minor 版本；v0.14.15 backend 填 `["2.0"]`。
- `protocol_version="2.2"` ⇒ 在 2.1 基础上额外支持 model 条目 `composition`（§4.1.3）与几何 prompt 批量入参 `tasks[].prompts[]`（§2.1.1）。两者均纯加法，2.2 backend 应填 `compat_protocol_versions: ["2.1", "2.0"]`；平台对缺这两项的 2.1/2.0 backend 完全兼容（composition 回落 atom、下游走 crop 模式）。
- `models[]` 存在 ⇒ 平台按多模型目录解析，**忽略顶层能力字段**（顶层仅留 name/version/protocol_version/infra/warmup_endpoint 等 backend 级元数据）。
- `models[]` 缺省 ⇒ 平台用顶层字段合成一个隐式 model（老 backend 路径，§4.1.5）。

### 4.1.2 model 条目结构

```jsonc
{
  "id": "detect",                       // 必填. backend 内唯一,(backend_id,id) 构成目录主键
  "display_name": "YOLO 目标检测",       // UI 展示名
  "task": "detection",                  // 必填. 受控词表,条目边界,决定输出几何与项目兼容性
  "model_family": "yolo",               // 可选. 家族标签(yolo/sam/paddleocr…),UI 二级分组用
  "infra": "pytorch",                   // 可选. 缺省继承 backend.infra
  "is_interactive": false,              // 该 model 是否支持交互式 /predict
  "composition": "atom",                // 可选. atom=单次推理原子; composite=内部编排多原子. 缺省 atom

  "supported_prompts": ["none"],        // 受控. none = 纯批量,无交互 prompt
  "supported_geometric_outputs": ["bbox"],   // 受控,复用现有字段名
  "output_attribute_types": [],         // 受控. OCR: ["text","language"]; cls: ["class"]
  "supported_text_outputs": [],         // v1 已有,text 路径专用(box/mask/both)
  "supported_trackers": [],             // v1 已有,video tracker 专用

  "supported_variants": [ /* series/size 多轴,§4.1.6 */ ],
  "variant_combinations": [ /* 可选,§4.1.6: 多轴非真笛卡尔积时显式列举合法组合 */ ],
  "variants_shared_across_tasks": false, /* 可选,§4.1.6: True 表同 backend 内多 task 共享同一份物理权重 */
  "default_variants": { "series": "yolo11", "size": "s" }, /* 可选,§4.1.6: backend 自报该 model 默认 variant 组合 */
  "default_thresholds": { "conf": 0.25, "iou": 0.7 },
  "resource_profile": { "device": "gpu", "batchable": true },
  "params": { /* 该 model 专属 JSON Schema(Draft-07 子集),前端 schema-form 渲染 */ }
}
```

### 4.1.3 受控词表（capability vocabulary）

能力声明的关键是**一套受控枚举**，且与平台内部类型锚点对齐（`TOOL_UNIT_IDS` / LabelStudio result type / `data_type`）。

**`task`（任务能力，条目边界，必填）** —— 项目兼容性校验的主轴；`model_family` 仅作展示分组，不参与校验：

| `task` | 输出几何 | 对应 result type | 备注 |
|---|---|---|---|
| `detection` | `bbox` | `rectanglelabels` | |
| `obb` | `rotated_bbox` | `rectanglelabels`（带 `rotation`） | 与 detection 输出几何不同，单列 |
| `segmentation` | `polygon` | `polygonlabels` | 实例/语义分割统一 polygon 落地 |
| `keypoint` | `keypoint` | `keypointlabels` | pose / 关键点 |
| `classification` | `none` | 无几何，写 attribute | 整图/区域分类 |
| `ocr` | `bbox`/`rotated_bbox`/`polygon` | 对应几何 + `attributes.text` | §4.1.8 |
| `doc_layout` | `bbox`/`polygon` | 对应几何，class=版面类别 | §4.1.8 |
| `tracker` | per-frame geometry | （video tracker 协议，§2.2） | 模态=video |
| `interactive_seg` | `polygon`/`mask` | `polygonlabels` | SAM 类，prompt 驱动 |

**`supported_geometric_outputs`（几何输出，复用现有字段）** —— 枚举与 `TOOL_UNIT_IDS` 对齐：

`bbox` / `rotated_bbox` / `polygon` / `polyline` / `keypoint` / `none`。
（3D 的 `lidar_box_3d` / `point_mask_3d` 暂不在本版 backend 范围，留位。）

**`output_attribute_types`（属性输出，半开放）** —— `text`（OCR 文本） / `language` / `orientation` / `class`（分类标签）。其余按需扩展；layout 版面类别走 `class_name`（而非 attribute）。

**`infra`（基础设施，受控，v2 新增）** —— `pytorch` / `onnx` / `paddle` / `tensorrt` / `openvino` / `other`（兜底）：

- **层级**：backend 顶层声明默认值；model 条目可覆盖（如 YOLO 仓里部分条目导出 onnx）。
- **缺省**：老 backend 不报 `infra` ⇒ 缓存标 `unknown`，UI 不渲染 badge 或显示「未声明」。
- **边界**：`infra` 是纯元数据 —— 不改 `/predict` 协议、不影响 result schema、不参与项目兼容性的硬校验（仅展示 badge + 排障溯源）。

**`supported_prompts`（沿用 v1，新增 `none`）** —— `none`（纯批量，无交互） / `point` / `bbox` / `text` / `exemplar` / `sketch` / `scribble`。YOLO / OCR / layout 是 `["none"]`（批量自动）；SAM 类仍是 point/bbox/text/exemplar。

**`composition`（原子 vs 内部编排，可选）** <!-- since 协议 v2.2 --> —— `atom`（单次推理 / 单原子） / `composite`（一个 model 内部编排多个原子、一次 `/predict` 一气呵成）：

- **动机**：model 目录把「原子」与「内部编排」平铺为平级条目，`task` 只描述输出形态、与「原子/复合」正交。`composition` 把「是原子还是内部编排」做成机器可读字段，取代早期靠读 `display_name` + 经验判断的做法。
- **唯一的可见性/过滤轴**：`composition` 是平台过滤选用入口的唯一依据。**编排下游 stage 选择器只收 `atom`**（编排只组合原子，不把一锅端复合体当 stage）；单阶段 / 工作台多模型选择器不过滤，`composite` 可直接选用（开箱即用）。例：grounded-sam2 `segmentation` = `composite`（单步可选、但不作编排下游）；onnxtools 一锅端 `vehicle-attr` = `composite`（单阶段默认、不作编排下游）；`vehicle-detect` / `vehicle-attr-classify` = `atom`（可作编排上/下游）。
- **缺省**：`atom`（绝大多数 model 是单次推理；老 backend 不报字段即按原子）。平台 `extract_capabilities` 透传，缺省回落 `atom`。
- **边界**：不改 `/predict` 协议、不参与兼容性校验。消费方：模型市场据此给卡片打「原子 / 内置流程」徽标；编排下游选择器 + 属性导入源据此过滤（只取 `atom`）。

### 4.1.4 平台派生形态（health_meta）

`extract_capabilities(setup)`（`services/ml_capabilities.py`）从「抽单层快照」升级为「遍历 `models[]` 派生 model 列表」，落进 `ml_backends.health_meta["capabilities"]`：

```jsonc
{
  "infra": "pytorch",                 // backend 默认
  "models": [
    { "id": "detect", "task": "detection", "model_family": "yolo", "infra": "pytorch",
      "supported_prompts": ["none"], "supported_geometric_outputs": ["bbox"],
      "output_attribute_types": [], "supported_variants": [/*…*/],
      "default_thresholds": {/*…*/}, "resource_profile": {/*…*/}, "modality": "image" }
    /* … */
  ],
  // 兼容字段:老消费方仍能读到「扁平并集」(所有 model 的 prompts/geometry 去重合并)
  "supported_prompts": ["none"], "supported_geometric_outputs": ["bbox","polygon","keypoint","rotated_bbox"],
  "modalities": ["image"]
}
```

保留顶层「扁平并集」字段，让现有 `useMLCapabilities` / 绑定校验在改造完成前零回归。模态派生升级为 **per-model 派生 + backend 汇总**：`task=tracker` 或 `supported_trackers` 非空 ⇒ video；几何含 `lidar_box_3d` / `point_mask_3d` ⇒ lidar（留位）；否则 ⇒ image（含 `supported_prompts=["none"]` 的批量模型）。backend `modalities` = 各 model modality 去重并集。

### 4.1.5 向后兼容规则

| backend 形态 | 平台解析 |
|---|---|
| 无 `models[]` | 顶层 `supported_*` / `params` 合成 1 个隐式 model：`id="default"`，`task` 由现有信号推断（`supported_trackers` 非空 → `tracker`、`supported_prompts` 含 point/bbox/text/exemplar → `interactive_seg`、否则 `detection`），`infra="unknown"` |
| 无 `infra` | model.infra = backend.infra = `"unknown"` |
| 有 `models[]` 但条目缺 `task` | 该条目按 `unknown` task 入目录，UI 标「能力未声明」，兼容性校验 fail-open（放行，留到 `/predict` 暴露） |

老 backend（grounded-sam2 / sam3 / echo）**不需要任何改动**即可继续工作 —— 它们落到「隐式单 model」路径。

### 4.1.6 范例：YOLO 官仓 backend（按任务分条目 + series/size 多轴）

> **真实参考实现**：[`apps/yolo-backend/`](https://github.com/yyq19990828/ai-annotation-platform/tree/main/apps/yolo-backend)（v0.14.12 起）。
> 实仓覆盖 4 task × 7 series × 9 size 的 80 个有效组合，与下方 jsonc 示例完全对齐；本节 jsonc 是缩写说明，实仓 `/setup` 输出是 canonical。
> 注意实仓在 `models[].task` 维度去掉了 `classify`（v0.14.12 NG1：ImageNet-1k 与项目 LabelConfig 几乎对不上），下方示例保留 classify 仅作协议形态说明。

```jsonc
{
  "name": "yolo-backend",                         // 与 apps/yolo-backend 实仓对齐
  "version": "0.1.0",
  "model_version": "ultralytics-8.4.x",
  "infra": "pytorch",
  "is_interactive": false,
  "models": [
    {
      "id": "detect", "display_name": "YOLO 目标检测",
      "task": "detection", "model_family": "yolo",
      "supported_prompts": ["none"],
      "supported_geometric_outputs": ["bbox"],
      "supported_variants": [
        { "key": "series", "title": "版本系列", "variants": [
          { "value": "yolov8", "label": "YOLOv8" },
          { "value": "yolo11", "label": "YOLO11", "recommended": true },
          { "value": "yolo12", "label": "YOLO12" } ] },
        { "key": "size", "title": "尺寸 / 精度档", "variants": [
          { "value": "n", "label": "nano",  "vram_gb": 1, "tier": "fast" },
          { "value": "s", "label": "small", "vram_gb": 2, "tier": "balanced", "recommended": true },
          { "value": "m", "label": "medium","vram_gb": 4 },
          { "value": "l", "label": "large", "vram_gb": 6 },
          { "value": "x", "label": "xlarge","vram_gb": 8, "tier": "accurate" } ] }
      ],
      "default_thresholds": { "conf": 0.25, "iou": 0.7 },
      "resource_profile": { "device": "gpu", "batchable": true },
      "params": { "type": "object", "properties": {
        "conf":   { "type": "number", "minimum": 0, "maximum": 1, "default": 0.25, "title": "置信度阈值", "x-platform-role": "confidence" },
        "iou":    { "type": "number", "minimum": 0, "maximum": 1, "default": 0.7,  "title": "NMS IoU", "x-platform-role": "iou" },
        "max_det": { "type": "integer", "minimum": 1, "maximum": 300, "default": 100, "x-platform-role": "maxDet" },
        "series": { "type": "string", "enum": ["yolov8","yolo11","yolo12"], "default": "yolo11" },
        "size":   { "type": "string", "enum": ["n","s","m","l","x"], "default": "s" } } }
    },
    { "id": "segment",  "task": "segmentation",   "supported_geometric_outputs": ["polygon"],       "model_family": "yolo", "/* variants 同上 */": null },
    { "id": "pose",     "task": "keypoint",       "supported_geometric_outputs": ["keypoint"],      "model_family": "yolo", "/* … */": null },
    { "id": "obb",      "task": "obb",            "supported_geometric_outputs": ["rotated_bbox"],  "model_family": "yolo", "/* … */": null },
    { "id": "classify", "task": "classification", "supported_geometric_outputs": ["none"], "output_attribute_types": ["class"], "model_family": "yolo", "/* … */": null }
  ]
}
```

> **关键红利**：det/seg/pose/obb 的输出几何恰好命中现有 4 种 result type（`rectanglelabels` / `polygonlabels` / `keypointlabels` / `rectanglelabels+rotation`），所以 **YOLO backend 的 `/predict` 输出零 adapter**，直接落现有渲染链路（§3）。只有 `classify` 的 class 需走 `attributes.class`。

#### `variant_combinations`（可选，v0.14.12 起）

`supported_variants` 暴露多轴时，前端默认按 axes 笛卡尔积渲染目录。但**多轴非真笛卡尔积**的 backend（如 yolo 的 `rtdetr` 只有 `l/x`、`yolov9 detect` 只有 `t/s/m/c/e`、`yolov10` 不支持 seg/pose/obb）需要显式列举合法组合，否则会列出虚假权重（如 yolov10-keypoint 这种实际不存在的 .pt）。

```jsonc
{
  "id": "detect",
  "supported_variants": [
    { "key": "series", "variants": [/* 7 个: v8/v9/v10/v11/v12/v26/rtdetr */] },
    { "key": "size",   "variants": [/* 9 个 union: n/t/s/m/b/c/l/e/x */] }
  ],
  "variant_combinations": [
    ["yolov8","n"], ["yolov8","s"], ["yolov8","m"], ["yolov8","l"], ["yolov8","x"],
    ["yolov9","t"], ["yolov9","s"], ["yolov9","m"], ["yolov9","c"], ["yolov9","e"],
    // ...
    ["rtdetr","l"], ["rtdetr","x"]   // 注意 rtdetr 只有 l/x
  ]
}
```

- inner array 顺序必须与 `supported_variants` 的 axis 顺序一致，即 `[axis0_value, axis1_value, ...]`。
- 字段缺省 ⇒ 前端按 axes 笛卡尔积处理（适用于 SAM2 × DINO 等真笛卡尔积场景）。
- 前端目录展示时严格按 `variant_combinations` 过滤；`/predict` 服务端仍独立做 `variant_not_supported` 422 兜底。

#### `variants_shared_across_tasks`（可选，v0.14.12 起）

布尔字段，缺省 `false`。决定前端列表视图如何对待"同 variant 跨多 task"的情形：

- **`false`（yolo 风格，默认）**：每 task 独立物理权重（yolov8n-det.pt / yolov8n-seg.pt / yolov8n-pose.pt / yolov8n-obb.pt 都是独立文件）。模型市场列表中每 (task, variant) 一行，行名加任务后缀（`YOLOv8-Det` / `YOLOv8-OBB`）。
- **`true`（gsam2 / sam3 风格）**：同 backend 内多 task 共享同一份权重（SAM 2.1 Tiny 一份 `.pt` 同时服务 segmentation / interactive_seg / tracker；GroundingDINO Swin-T 一份 `.pt` 同时服务 detection / segmentation）。模型市场列表按 `(backend, axis_key, axis_value)` 聚合到一行，`task` 列汇总所有用到此权重的 task。

**结合 `supported_variants` 按 task 暴露**：当 `variants_shared_across_tasks=true` 时，每个 model 只声明该 task **真正用到的 axes**（如 grounded-sam2 的 `detection` 只声明 `dino_variant` 轴而非两轴），让前端目录的 task 列准确反映哪些 task 用 SAM、哪些 task 用 DINO。

#### `default_variants`（可选，v0.14.13 起）

每个 model 自报该 task 的默认 variant 组合，前端 `VariantSelector` 在用户未显式选择时用这组值作初值。**优先级**：项目级 `projects.default_variants[backend_id]`（v0.14.13 新增字段）> backend `default_variants` > backend 启动时 env 默认。

**结构**：扁平 `dict[axis_key, axis_value]`，key 必须严格匹配该 model 的 `supported_variants[].key`，value 必须在对应 axis 的 `variants[].value` 内、且（多轴时）整体落在 `variant_combinations` 内：

```jsonc
// yolo (两轴, 严格按 variant_combinations 取合法组合):
{ "default_variants": { "series": "yolo11", "size": "s" } }

// grounded-sam2 detection (单轴 dino_variant):
{ "default_variants": { "dino_variant": "T" } }
// grounded-sam2 segmentation (两轴, DINO + SAM):
{ "default_variants": { "sam_variant": "tiny", "dino_variant": "T" } }

// sam3 (单档, 仍按对称约定声明):
{ "default_variants": { "model_variant": "sam3.1" } }
```

- **每 model 一份**：因为同 backend 不同 task 可能选不同档（yolo 通常 4 task 共用 yolo11/s；但 backend 完全有自由按 task 调整）。
- **轴必须完整**：声明了几轴 `supported_variants` 就要给齐几个值；缺轴等同于"没默认"，前端会回落到 backend 启动 env。
- **不与 `params.*_variant.default` 重复**：老协议 v1 时 `params` 里也带过 `default`（如 `params.properties.sam_variant.default`），新前端优先读 `default_variants`，老前端继续读 `params.*.default` 兼容。
- **校验**：backend 不强制运行时校验 default_variants 是否落在 supported_variants/variant_combinations 内（信任 backend 自报），前端 / API 也不校验；非法值只会让前端初值显示成不存在的选项（用户切换后即修复）。

### 4.1.7 范例：ONNX 聚合 backend（一个 backend，多家族多任务，统一 infra）

```jsonc
{
  "name": "onnx-zoo-backend",
  "version": "0.1.0", "model_version": "onnxruntime-1.x",
  "infra": "onnx", "is_interactive": false,
  "models": [
    { "id": "yolov8n-coco", "task": "detection",      "model_family": "yolo",      "supported_geometric_outputs": ["bbox"] },
    { "id": "rtmpose",      "task": "keypoint",        "model_family": "rtmpose",   "supported_geometric_outputs": ["keypoint"] },
    { "id": "ppocr",        "task": "ocr",             "model_family": "paddleocr", "supported_geometric_outputs": ["polygon"], "output_attribute_types": ["text","language"] },
    { "id": "u2net",        "task": "segmentation",    "model_family": "u2net",     "supported_geometric_outputs": ["polygon"] }
  ]
}
```

> 这里 model 都继承 `infra="onnx"`，但 `model_family` / `task` 各异 —— 正是「聚合模型带不同能力」。若某 PaddleOCR 条目用 paddle 运行时，在该条目写 `"infra": "paddle"` 覆盖即可。

### 4.1.8 OCR / Doc Layout 输出约定（v2 首发模型族）

**OCR**（`task: "ocr"`）：

- 检测文本区域：几何 = `bbox` / `rotated_bbox` / `polygon`。
- 识别文本：写入 prediction result 的 `attributes.text`（必要时 `attributes.language` / `attributes.orientation`，对应 `output_attribute_types` 声明）。
- 采纳后生成普通 annotation + text 写入 attributes；**项目未配置 text attribute 时不静默丢文本** —— 前端提示「可采纳几何，文本字段不会入库」或要求先配置。

**Doc Layout**（`task: "doc_layout"`）：

- 输出区域 class：`title` / `paragraph` / `table` / `figure` / `formula` / `list` / `header` / `footer`，落 `class_name`。
- 几何 = `bbox` / `polygon`，可选 OCR text。
- 目标场景：文档图片标注、OCR 校对、表格/版面区域检测。

result 映射（统一 adapter，不新增 prediction 表）：`ocr_text` → `attributes.text`；`layout_type` → `class_name`；`orientation` → `attributes.orientation`。

### 4.1.9 平台能力目录端点（派生视图）

能力目录是 `health_meta` 的派生视图，复用现有 `POST …/{bid}/setup`（30s TTL 缓存）的探测链路：

```text
GET  /projects/{pid}/ml-backends/{bid}/capabilities          # 返回 models[] 目录(含 infra/task/variants)
POST /projects/{pid}/ml-backends/{bid}/capabilities/refresh  # 强制重探 /setup 并刷新缓存
```

- `capabilities` 返回派生后的 model 目录（含每条 `infra` / `task` / `supported_geometric_outputs` / `output_attribute_types` / `supported_variants` / `last_seen_at`），供模型市场 / 工作台多模型选择器消费。
- `capabilities/refresh` 跳过缓存强制重探，用于 backend 升级 model_version 后立即看到新能力。
- 批量预标入口扩展 `model_id`（指向目录条目；缺省 = backend 隐式单 model，兼容老路径）；variant / threshold 经 `context` / `params` 透传。

> Phase 2 起若放开 `MAX_ML_BACKENDS_PER_PROJECT > 1` 或需要跨 backend 模型检索，再考虑独立表 `ml_model_capabilities` 与全局聚合端点 `GET /ml-backends/capabilities`。

### 4.1.10 可跑参考实现

**真实推理参考实现（v0.14.12 起）**：[`apps/yolo-backend/`](https://github.com/yyq19990828/ai-annotation-platform/tree/main/apps/yolo-backend) —— ultralytics 多任务多系列 backend，覆盖 detection / segmentation(instance) / keypoint / obb 四 task × v8/v9/v10/v11/v12/v26/rt-detr 七系列，共 80 个有效预训练组合。`/setup.models[]` 按 task 拆 4 条目，`supported_variants` 走 series × size 两轴，按预训练矩阵严格过滤。`/predict` 零 adapter 命中 4 种 result type，结果直落平台 `apps/api/app/services/prediction.py::to_internal_shape` → internal Geometry。可作为新接入 backend 的首选骨架参考。

**协议形态参考实现（无真实推理）**：[`docs-site/dev/examples/mock-v2-backend/`](https://github.com/yyq19990828/ai-annotation-platform/tree/main/docs-site/dev/examples/mock-v2-backend) —— `/setup` 暴露 YOLO 风格多任务 `models[]`（detection / segmentation / keypoint / obb / classification）+ PaddleOCR / DocLayout 条目，每条带 `task` / `infra` / 几何 / 多轴 `variants`；`/predict` 按 `context.type`（task_type）返回固定 demo 结果，OCR 条目带 `attributes.text`。无真实推理，可直接 `uvicorn main:app --port 9100` 起来做协议 v2 冒烟与接入验证。

**最小 v1 参考实现**：见下文 echo-ml-backend。

### 4.1.11 协议能力目录端点（v0.14.11）

> 决策见 [ADR-0037 — 协议能力目录与 backend 注册解耦](../adr/0037-protocol-capability-catalog-decoupling.md)。

§4.1 描述的 `/projects/{pid}/ml-backends/{bid}/capabilities` 是**实例能力视图**（已注册 backend 探测出的 `models[]` 派生）。但「模型市场 · 能力目录」面板在用户心智里要回答的是「平台支持哪些 AI 标注能力」，与 backend 是否注册无关。v0.14.11 引入**协议级**端点：

```
GET /api/v1/ml-capabilities/protocol
```

- **数据源**：`apps/api/app/services/capability_registry.py`（SSOT），与 `services/ml_capabilities.py` 的受控词表同源（后者改为 re-export）。
- **鉴权**：登录用户即可访问；不暴露任何 backend 实例信息，无需 super_admin。
- **缓存**：`Cache-Control: private, max-age=300` + ETag；二次请求带 `If-None-Match` 返回 304。

**响应结构**：

```jsonc
{
  "version": "v2",        // 与协议 v2 对齐, 受控词表不兼容变更才 bump
  "tasks": [
    {
      "id": "detection",
      "label": "目标检测",
      "summary": "在图像或视频帧中输出 bbox + 类别标签。",
      "default_geometry": ["bbox"],
      "default_modalities": ["image", "video"],
      "typical_models": ["YOLO 系", "DETR 系", "Grounding DINO"],
      "protocol_notes": "/predict 响应 result.type=rectanglelabels, ...",
      "suggested_backends": [
        {
          "name": "Label Studio ML Backend (YOLO)",
          "repo_url": "https://github.com/HumanSignal/label-studio-ml-backend",
          "summary": "官方示例覆盖 YOLOv8 / DETR, 适合上手。",
          "research_link": "docs/research/01-label-studio.md"
        }
      ]
    }
    // 共 9 个 task
  ],
  "infras":     [ { "id": "pytorch", "label": "PyTorch", "summary": "..." }, ... ],   // 6 项
  "modalities": [ { "id": "image",   "label": "图像",   "summary": "..." }, ... ],   // 3 项 (image/video/lidar)
  "geometries": [ { "id": "bbox",    "label": "bbox",   "summary": "..." }, ... ]   // 8 项
}
```

**消费方**：前端 `CapabilityCatalogPanel` 默认 `groupBy=task`，遍历 `tasks` 渲染 9 张协议卡；已注册 backend 的 model 按 `model.task` 字段挂载到对应卡下。无 backend 注册时协议卡仍可见（带「暂无接入」徽标 + 推荐 backend CTA），不再阻塞用户探索。

**协议与实例的关系**：

| 端点 | 数据源 | 何时可用 | 视角 | 鉴权 |
|------|--------|----------|------|------|
| `GET /v1/ml-capabilities/protocol` | `capability_registry.py` SSOT | 启动即可（与注册无关） | 协议层「平台支持什么」 | 登录用户 |
| `GET /v1/ml-capabilities/instances` | env-only 探测 + `ml_backends.health_meta` 合并 | docker-compose 起动或注册任一即可 | 实例层「现在跑着哪些 model 可用」 | 登录用户 |
| `GET /projects/{pid}/ml-backends/{bid}/capabilities` | `ml_backends.health_meta["capabilities"]` | backend 注册并 health 探测后 | 实例层「该项目绑的 backend 暴露了什么」 | 项目成员 |

### 4.1.12 实例能力清单端点（v0.14.11）

`GET /api/v1/ml-capabilities/instances` 解决「能力目录看不到 env-only 容器」的鸡生蛋问题——即使用户没有在任何项目里注册过 backend，只要 docker-compose 起了自带容器（如 gsam2 / sam3）或运维 env 配了 `ML_BACKEND_OBSERVE_URLS`，普通登录用户都能在能力目录看到这些 backend 实际能跑的 model 清单。

**数据源合并**：

1. **env-only**：读 `settings.ml_backend_observe_urls`（CSV / JSON 数组），对每个 URL 探测 `/setup`，复用 `extract_capabilities()` 取协议 v2 的 `models[]`。
2. **registered**：从 `ml_backends` 表查 `state="connected"` 的项，直接读 `health_meta["capabilities"]` 快照。
3. 去重：env-only URL 与已注册 URL 命中时，跳过 env-only 探测（避免重复展示）。

**字段裁剪**（与项目级 `/capabilities` 的差别）：

| 字段 | `/projects/.../capabilities` | `/v1/ml-capabilities/instances` |
|------|------------------------------|--------------------------------|
| url | ✓ | ✗（避免暴露内网拓扑） |
| gpu_info / cache / pool / video_pool | ✓ | ✗（运维敏感） |
| supported_variants / resource_profile / params | ✓ | ✗（细节给项目级视图） |
| `models[]` 的核心字段（id / display_name / task / infra / prompts / geometry / trackers / modality） | ✓ | ✓ |

**响应结构**：

```jsonc
{
  "instances": [
    {
      "source": "env_only",                          // 或 "registered"
      "name": "grounded-sam2",                       // env-only 取 /setup.name; registered 取 ml_backend.name
      "infra": "pytorch",
      "models": [
        {
          "id": "grounded-sam2-detection",
          "display_name": "Grounded-SAM 2 · 文本检测 (DINO)",
          "task": "detection",
          "infra": "pytorch",
          "is_interactive": false,
          "supported_prompts": ["text"],
          "supported_geometric_outputs": ["bbox"],
          "supported_trackers": [],
          "modality": "image"
        }
        // ...
      ]
    }
  ]
}
```

**前端消费**：`CapabilityCatalogPanel` 协议卡视图（默认 `groupBy=task`）按 `model.task` 把 instance.models 挂到 9 张协议卡上；子卡按 `source` 显示「自带」（env_only）或「已注册」（registered）徽标。

---

## 4.2 PredictionResult 运行时观测字段（v0.14.14）

为了让前端把"猜测冷启动"换成"真信号"，`PredictionResult` 新增三个**可选**字段。语义只与本次请求挂钩，不影响存储与协议主路径。

| 字段 | 类型 | 含义 |
|---|---|---|
| `cache_hit` | `bool \| null` | 本次推理是否命中 pool 内已加载权重。`true` = 权重已在内存，本次跳过加载；`false` = 触发了加载（冷启动 / pool evict 后 / 首次拉取 ckpt）；`null` = backend 未上报（前端按"未知"处理） |
| `model_load_ms` | `int \| null` | 本次加载耗时毫秒。`cache_hit=true` 时通常为 `0`；`cache_hit=false` 时是从 disk → GPU 的真实耗时；`null` 同上 |
| `pool_state` | `{current_size: int, cap: int} \| null` | 轻量 pool 快照，仅供 debug。常态下为 `null`，按需开启（避免每次响应都带） |

**gsam2 组合判断**：SAM + DINO 双池架构，`cache_hit = sam_hit AND dino_hit`；`model_load_ms = max(sam_load_ms, dino_load_ms)`（取最慢的一边）。若只 SAM hit、DINO miss，`cache_hit=false`，前端感知"冷启动"够用；分轴粒度留给未来扩展。

**sam3 单档**：第一次推理触发懒加载时 `cache_hit=false`；已加载则 `cache_hit=true`；`SAM3_IDLE_UNLOAD_SECONDS` 触发的 idle unload 后再 predict 也是 `cache_hit=false`。

**字段顺序**：响应里 `inference_time_ms`（纯 forward）与 `model_load_ms`（权重加载）分离，**互不相加**，前端按需展示。

---

## 4.3 `/health.pool` 统一 PoolStatus（v0.14.14）

v0.14.12 时三家 backend 的 `/health.pool` 字段各不相同（yolo 用 `pool.loaded[]`、gsam2 用 `pool.loaded_variants[]` + `per_variant_lru_ts`、sam3 用 `loaded: bool`）。v0.14.14 起统一为 `PoolStatus` 结构：

```jsonc
{
  "pool": {
    "cap": 4,                          // 池容量
    "current_size": 2,                 // 当前已加载条数
    "loaded_keys": [
      {
        "key": "yolov11/s/detection", // backend-defined opaque 字符串，前端只做相等比较
        "loaded_at": "2026-06-08T03:11:22Z",
        "last_used_at": "2026-06-08T03:15:00Z",
        "hit_count": 12               // 命中次数（不含 warmup）
      }
    ],
    "last_evict": {                    // 可为 null
      "key": "yolov8/x/detection",
      "at": "2026-06-08T03:14:00Z",
      "reason": "lru"                 // 受控：lru | manual | idle_timeout
    }
  }
}
```

**key 命名约定**（backend 自由选择，前端不解析，只做相等匹配）：

| backend | key 形式 |
|---|---|
| yolo-backend | `{series}/{size}/{task}`，如 `yolov11/s/detection` |
| grounded-sam2-backend | image pool 用 `sam={sam_variant}/dino={dino_variant}`，如 `sam=tiny/dino=B`；video pool 的 key 就是 `sam_variant` 字符串 |
| sam3-backend | 模型变体字符串，如 `sam3.1`；cap 永远 `1` |

**LRU evict 触发**：pool 满 + miss 时按 LRU 头部淘汰，`last_evict.reason="lru"`。`/unload` 手动卸载用 `"manual"`，sam3 的 idle 超时用 `"idle_timeout"`。

**前端消费**：模型市场列表的"运行时态"列直接从 `health_meta.pool.loaded_keys[]` 反查 `key` 即可；卡片视图按分组展示 `current_size/cap` 与 `last_evict` 摘要。

---

## 4.4 `POST /warmup`（可选，v0.14.14）

**用途**：把指定 variant 的权重显式加载到 pool，不消耗推理算力。模型市场"⚡ 预热"按钮、自动化预热脚本、CI 烟测时手动控制 pool warm 状态都走这个端点。

**前置条件**：backend 在 `/setup` 顶层声明 `warmup_endpoint: true`。未声明的 backend 视为不支持，前端 ⚡ 按钮置灰。

**请求**（per-backend 自定义结构；建议与 `/predict` 的 context 部分一致）：

```jsonc
// yolo-backend
POST /warmup
{
  "task": "detection",
  "variants": { "series": "yolov11", "size": "s" }
}

// grounded-sam2-backend (同时预热 SAM + DINO)
POST /warmup
{
  "task": "segmentation",
  "variants": { "sam_variant": "small", "dino_variant": "B" }
}

// sam3-backend
POST /warmup
{
  "variants": { "model_variant": "sam3.1" }
}
```

**响应**（统一 `WarmupResponse` schema）：

```jsonc
{
  "ok": true,
  "model_load_ms": 4500,             // 加载耗时(ms)，cache_hit=true 时 null/0
  "cache_hit": false,                // 已经在 pool 内时 true
  "evicted": "yolov8/n/detection"    // 可选；本次因 cap 上限淘汰的 key（前端 toast）
}
```

**行为约定**：

- 只加载权重，不跑真实 forward pass。若 backend 实现上需要触发权重初始化（如 lazy 算子），用最小可能 input（1×1 dummy tensor）。
- 重复预热同一 variant 直接返回 `cache_hit=true, model_load_ms=null`。
- pool 满时按 LRU 淘汰最旧的 key，把被淘汰的 key 名回填 `evicted` 字段供前端 toast 提示。
- `hit_count` 不增加（warmup 不算 hit）。
- 错误码：变体缺失或类型错返回 422（Pydantic/schema），变体值或组合不支持返回 422 + `error_code=variant_not_supported`，权重缺失 / 显存暂不可服务返回 503 + `Retry-After`。

**平台代理**：`POST /api/v1/projects/{pid}/ml-backends/{bid}/warmup`，body 原样转发，权限沿用现有 RBAC。

---

## 5. `GET /versions`（可选）

**响应**：
```json
{ "versions": ["v1.0.0", "v1.1.0", "v1.2.3"] }
```

前端会把这个列表填到「模型版本」下拉框；用户选定后写到 `MLBackend.extra_params` 并在后续 `/predict` 请求 header 或 body 携带（具体由 backend 自行约定）。未实现时返回 `{"versions": []}`。

---

## 6. 错误响应约定

v2.1 推荐 backend 使用结构化错误体。平台代理会保留上游 4xx；503 会保留为 503 并透传 `Retry-After`；其它上游 5xx / 连接超时仍映射为 502 Bad Gateway。

| 场景 | HTTP | 响应体 |
|---|---:|---|
| variant 字段缺失 / 类型错 | 422 | FastAPI/Pydantic 默认 validation error |
| variant 值合法字段但不受支持，或组合不在 `variant_combinations` 内 | 422 | `{ "detail": { "error_code": "variant_not_supported", "axis": "size", "value": "x", "allowed": ["n","s"] } }` |
| variant 合法但当前 backend 暂不可服务（权重缺失、未预下载、显存池不可用） | 503 | `{ "detail": { "error_code": "model_unavailable", "key": "yolov11/s/detection", "reason": "checkpoint missing" } }` + `Retry-After` |
| 输入图片 / prompt 本身非法 | 422 | backend 自定义 detail |
| backend bug / 未预期异常 | 500 | backend 自定义 detail；平台交互式代理会映射为 502 |

共享实现位于 `apps/_shared/protocol_v2/src/aap_protocol_v2/errors.py`：`VariantNotSupportedError` 与 `ModelUnavailableError`。三家内置 backend 已统一使用这两个错误类。

平台调用行为：

- 同步 batch（`/predict` 批量）：worker 捕获并写一行 `failed_predictions`（`apps/api/app/db/models/prediction.py:59-79`），字段 `error_type` = HTTP 状态码，`message` = response body 截断到 4KB。继续下一 batch。
- 交互式（`/predict` 单条）：服务层 `predict_interactive` (`ml_client.py`) 透传上游 4xx 与 503；其它上游 5xx / 连接超时映射为 502。前端按 422 / 503 / 500+ 分流：422 显示“参数错误，请检查输入”，503 显示“模型暂不可用，N 秒后重试”，500+ 显示“服务异常”。

---

## 7. token / cost 透传

如果你的 backend 是 LLM（Anthropic、OpenAI、本地 vLLM），可以在 `inference_time_ms` 之外补这些字段，平台会写到 `prediction_metas` 表（`prediction.py:34-56`）以后做成本卡片：

| 字段 | 类型 | 说明 |
|---|---|---|
| `prompt_tokens` | int | 输入 token 数 |
| `completion_tokens` | int | 输出 token 数 |
| `total_tokens` | int | = prompt + completion |
| `prompt_cost` | float | 美元；按 backend 计价 |
| `completion_cost` | float | 美元 |
| `total_cost` | float | 美元 |
| `extra` | object | 任意 JSON，写到 `prediction_metas.extra` |

> 当前 ROADMAP §A「预测成本统计」前端可视化未做；后端字段已经在表里。

---

## 8. 最小 echo backend 示例

> 完整可跑样板（含 Dockerfile + curl 测试脚本 + README）见 [`docs-site/dev/examples/echo-ml-backend/`](https://github.com/yyq19990828/ai-annotation-platform/tree/main/docs-site/dev/examples/echo-ml-backend)。下面的代码块由 `check-doc-snippets.mjs` 锁定到样板源文件，源端改一字 `pnpm docs:build` 即报漂移。

<!-- snippet:docs-site/dev/examples/echo-ml-backend/main.py -->
```python
"""Echo ML backend — 协议 v2.1 参考实现（最小可跑版）。

满足 ml-backend-protocol 的 4 个端点：/health、/setup、/versions、/predict。
所有 /predict 输出固定的 demo bbox，让平台端到端链路可以直接走通。
真实 backend 的 inference 替换到 predict() 内部即可。

零外部依赖（仅 fastapi + pydantic），整目录可直接拷走当 starter。
字段语义以 docs-site/dev/reference/ml-backend-protocol.md 为准。
"""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

MODEL_VERSION = "echo-v1"


class TaskItem(BaseModel):
    id: str
    file_path: str


class PredictRequest(BaseModel):
    tasks: list[TaskItem]


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/setup")
async def setup():
    # 协议 v2.1 能力声明（协议文档 §4 / §4.1）。
    # models[] 是多模型目录：echo 只有一条 detection 条目；
    # supported_prompts=["none"] 表示纯批量、无交互式 prompt。
    return {
        "name": "echo-backend",
        "version": "0.1.0",
        "protocol_version": "2.1",
        "compat_protocol_versions": ["2.0"],
        "model_version": MODEL_VERSION,
        "is_interactive": False,
        "labels": ["demo"],
        "models": [
            {
                "id": "echo-detect",
                "display_name": "Echo 固定框 demo",
                "task": "detection",
                "supported_prompts": ["none"],
                "supported_geometric_outputs": ["bbox"],
            }
        ],
    }


@app.get("/versions")
async def versions():
    return {"versions": [MODEL_VERSION]}


@app.post("/predict")
async def predict(req: PredictRequest):
    results = []
    for t in req.tasks:
        results.append(
            {
                "task": t.id,
                "result": [
                    {
                        "type": "rectanglelabels",
                        "value": {
                            "x": 0.1,
                            "y": 0.1,
                            "width": 0.2,
                            "height": 0.2,
                            "rectanglelabels": ["demo"],
                        },
                        "score": 0.5,
                    }
                ],
                "score": 0.5,
                "model_version": MODEL_VERSION,
                "inference_time_ms": 1,
                # 运行时观测字段（可选，协议文档 §4.2）：echo 无真实权重，
                # 固定上报"已命中、零加载耗时"演示字段形态。
                "cache_hit": True,
                "model_load_ms": 0,
            }
        )
    return {"results": results}
```
<!-- /snippet -->

启动（任选其一）：

```bash
# 直接 uvicorn
pip install -r docs-site/dev/examples/echo-ml-backend/requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

# Docker
cd docs-site/dev/examples/echo-ml-backend && docker build -t echo-ml-backend . && docker run --rm -p 8000:8000 echo-ml-backend
```

然后在前端 ProjectSettings → ML Backends 添加 `http://host.docker.internal:8000`（如果平台跑 Docker）或 `http://localhost:8000`，点「测试连接」应通过。或直接在样板目录跑 `./test.sh` 脚本三连击校验四个端点。

---

## 9. 接入 checklist

- [ ] `/health` 返回 200
- [ ] `/setup` 声明 `protocol_version: "2.1"` 与 `compat_protocol_versions: ["2.0"]`
- [ ] `/predict` 批量 schema 与 §2.1 对齐，至少回填 `task` + `result`
- [ ] 如声明 `is_interactive=True`，`/predict` 也接受 §2.2 单条请求
- [ ] `/predict.context.model_variants` 支持通用 axis dict；旧字段仅作为兼容期 normalize
- [ ] `/setup.params` 给阈值/数量/简化容差等字段标 `x-platform-role`
- [ ] 每条 result 的 `type` 与项目类型匹配（image-det 项目至少要有 `rectanglelabels`）
- [ ] 非法 variant 返回 422；模型暂不可用返回 503 + `Retry-After`（见 §6）
- [ ] 长任务考虑 backend 内部异步 + 在合理时间内（< `ml_predict_timeout`）返回结果，否则平台会判超时并落 `failed_predictions`

---

## 10. 兼容性与迁移

v0.14.15 是 protocol v2.1 minor bump，不是 v3。平台与内置 backend 保留 v2.0 兼容期，避免外部自建 backend 立刻中断。

| 旧字段 | 新字段 | 兼容行为 |
|---|---|---|
| `context.variants.{series,size}` | `context.model_variants.{series,size}` | yolo-backend normalize 并记录 deprecation warning |
| `context.sam_variant` / `context.dino_variant` | `context.model_variants.{sam_variant,dino_variant}` | grounded-sam2-backend normalize；新字段优先 |
| `context.model_variant` | `context.model_variants.model_variant` | sam3-backend normalize；非 `sam3.1` 仍返回 422 |
| `params.*_variant.enum` 无 role | `supported_variants[]` 或 `x-platform-role=modelVariant` | 前端仍回落渲染 legacy enum；新 backend 应声明 `supported_variants` |
| `projects.ai_model` | `projects.ml_backend_id` + backend name 展示 | v0.14.15 DB 迁移删除列；解绑过的项目若残留旧 `ai_model` 字符串会被直接丢弃 |

迁移建议：

1. 先在 `/setup` 加 `protocol_version: "2.1"` 与 `compat_protocol_versions: ["2.0"]`。
2. `/predict` 接受 `context.model_variants`，保留旧字段 normalize 一版。
3. 给参数 schema 补 `x-platform-role`，不要改物理参数名。
4. 把非法 variant 统一改为 422，把权重缺失 / 显存暂不可服务改为 503 + `Retry-After`。
5. 确认前端或第三方调用方不再读取 `projects.ai_model`；项目是否绑定 backend 只看 `projects.ml_backend_id`。

## 11. 参考实现

社区已有几种现成接入：
- **Label Studio ML Backends 模板**（兼容平台 schema）：https://github.com/HumanSignal/label-studio-ml-backend
- **GroundingDINO + SAM**：调研报告 [`docs/research/06-ai-patterns.md`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/docs/research/06-ai-patterns.md) §模式 B
- **X-AnyLabeling SAM 工厂**：调研报告 [`docs/research/04-x-anylabeling.md`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/docs/research/04-x-anylabeling.md)
