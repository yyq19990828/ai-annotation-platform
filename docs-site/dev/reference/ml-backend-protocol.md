---
audience: [dev, ops]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
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

## 端点总览

| 端点 | 方法 | 用途 | 必需 | 平台调用点 |
|---|---|---|---|---|
| `/health` | GET | 健康检查 | ✅ | `MLBackendClient.health` (`ml_client.py:31`) |
| `/predict` | POST | 批量 / 交互式预测 | ✅ | `MLBackendClient.predict` (`ml_client.py:41`) / `predict_interactive` (`ml_client.py:64`) |
| `/setup` | GET | 返回模型配置（schema、超参） | ⚪ | `MLBackendClient.setup` (`ml_client.py:84`) |
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
- v0.8.x 之后可能加入周期 cron（参见 ROADMAP §A「ML Backend 健康检查」）。

> **`pool` 子对象**（v0.10.23, 仅 grounded-sam2 返回，运维观测用，平台不强制解析）：`{ cap, loaded_variants: [{sam_variant, dino_variant}], evict_count, per_variant_lru_ts: {"sam/dino": <monotonic_ts>} }`，反映 ModelPool 当前并存的变体及 LRU 顺序。`cache` 子对象同步聚合各变体桶（`buckets["sam/dino"]` 各自独立 hits/misses），`/cache/stats` 与 `/metrics` 口径一致。idle 超时后整池清空、`loaded` 变 false。v0.10.26 起平台 `health_meta()` 把 `pool` 一并缓存到 `ml_backends.health_meta`，供模型市场「变体」面板展示。

> **可选模型管理端点 `POST /reload` / `POST /unload`**（非协议必需，grounded-sam2 实现）：`/unload` 清空整池释放显存；`/reload` 预热模型进 pool。v0.10.26 起 `/reload` 接受可选 body `{ "sam_variant": "small", "dino_variant": "B" }` 预热**指定变体**（缺省回退 backend 启动默认变体；非法变体值 422，校验同 `/predict` 的 `context.sam_variant`）；返回 `{ ok, loaded, reloaded, sam_variant, dino_variant }`。平台经 `POST /api/v1/projects/{pid}/ml-backends/{bid}/reload`（同 body）代理，模型市场「变体」面板的「预热」按钮即走此链路。

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
      "inference_time_ms": 245               // 可选；写入 prediction_metas.inference_time_ms
    },
    ...
  ]
}
```

平台侧解析：`MLBackendClient.predict` (`ml_client.py:41-62`) 把每项映射到 `PredictionResult` dataclass，再由调用方落到 `predictions` / `prediction_metas` 表。

**超时**：服务端配置 `ml_predict_timeout`（默认 100s，`config.py:54`）。超时由 worker 捕获，写一行 `failed_predictions` 并继续下一 batch（不阻断）。

### 2.2 交互式预测

适用：标注员在工作台内点「AI 助手」工具发起的单次推理（v0.8.x SAM 模式将主要走这条路）。

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
    "text": "ripe apples",                  // type=text 时（v0.9.x Grounded-SAM-2 / v0.10.x SAM 3 PCS 文本入口）
    "output": "box" | "mask" | "both",      // v0.9.4 phase 2 · 仅 type=text 生效, 默认 "mask" 老前端兼容
    "box_threshold": 0.35,                  // 可选; type=text 时 backend 的 DINO 阈值 override (grounded-sam2 专属)
    "text_threshold": 0.25,                 // 可选; 同上
    "score_threshold": 0.5,                 // v0.10.0 · SAM 3 PCS text/exemplar 路径 score 过滤阈值
    "simplify_tolerance": 1.0,              // v0.9.4 phase 3 · shapely.simplify 像素级覆盖, 仅 mask/both 路径生效
    "sam_variant": "large",                 // v0.10.23 · grounded-sam2 请求级模型变体热切换 (tiny|small|base_plus|large); 缺省回退 backend env 默认
    "dino_variant": "B"                     // v0.10.23 · 同上 (T|B); 非法值 422
  }
}
```

`context` 是个开放 dict——平台和 backend 协商具体字段，平台不做 schema 校验（`ml_client.py:64-82`）。

> **`type=text`**：v0.9.x（Grounded-SAM-2）走 GroundingDINO 文本 → boxes → SAM mask 复合链路；v0.10.x（SAM 3）走 PCS 单模型一步出 mask。两者返回 `result[]` 字面一致（多 polygon / 多 rect / 配对）。`box_threshold` / `text_threshold` 仅 grounded-sam2 消费；`score_threshold` 仅 SAM 3 消费。

> **`sam_variant` / `dino_variant`**（v0.10.23 新增，仅 grounded-sam2 消费）：请求级模型变体热切换。backend 内 ModelPool 按 `(sam_variant, dino_variant)` 做 LRU 缓存：命中复用、miss 冷启 1–3s（超 cap 驱逐最久未用变体）、pool 满 + 并发排队超 `MODEL_POOL_BUILD_TIMEOUT` 返回 503。缺省回退 backend env 默认 (`SAM_VARIANT`/`DINO_VARIANT`)；非法值（不在 `SAM2_CONFIGS`/`DINO_CONFIGS` key 内）返回 422，不影响后续请求。变体合法但其 checkpoint 未预拉到 `CHECKPOINT_DIR`（不在 `PREFETCH_SAM_VARIANTS`/`PREFETCH_DINO_VARIANTS` 内）返回 503，提示把该变体加入 prefetch 后重建容器。返回 `model_version` 按本次请求变体拼（如 `grounded-sam2-dinoB-sam2.1large`）。embedding cache 按变体分桶（不同变体张量不可跨用），命中只在同变体同图。SAM 3 忽略这两个字段。

> **`type=exemplar`**（v0.10.0 新增，仅 SAM 3 支持）：取图中已有的一个 bbox 作为视觉示例，由 SAM 3 PCS 一步出全图相似实例的 masks。`bbox` 字段承载 4 坐标（与 `type=bbox` 共用字段，语义靠 `type` 区分）。返回 `result[]` 是多个 `polygonlabels`，`polygonlabels: ["object"]`（前端按当前 active label 批量改写）。apps/api 仅在项目挂了支持 exemplar 的 backend（`/setup.supported_prompts` 含 `exemplar`）时才放行；未挂返回 400。前端 UI 入口（工作台 Shift+拖框）在 v0.10.1 落地。

> **`type=video_tracker`**：v0.9.36 起由 `VideoTrackerJob` worker 使用。平台会按 `VIDEO_TRACKER_WINDOW_SIZE_FRAMES` 把长区间分窗，多次调用项目绑定的 connected ML Backend。请求 `task.file_path` 是视频 signed URL；`context` 包含 `model_key`（`sam2_video` / `sam3_video`）、`job_id`、`dataset_item_id`、`annotation_id`、`from_frame`、`to_frame`、`direction`、`prompt` 和 `source_geometry`。响应 `result[]` 每项为 `{ frame_index, geometry, confidence?, outside? }`；低于平台阈值的 `confidence` 会被写成 outside prediction range。

> **`output: "box" | "mask" | "both"`**（v0.9.4 phase 2，仅 `type=text` 生效）：
> - `box`：仅 GroundingDINO 出框，跳过 SAM image embedding + mask 推理 + cv2/shapely 简化。返回 `result[]` 全为 `rectanglelabels`，单图 ~50-100ms（4060 / tiny），相比 mask 全链路 200-500ms 快 50-80%。**适用 image-det 项目**：标注员要的就是 bbox annotation。
> - `mask`（**默认**）：当前 v0.9.2 行为，DINO + SAM mask → polygon，返回 `polygonlabels`。
> - `both`：同 instance 配对返回 `[rectanglelabels, polygonlabels, ...]` 严格交错（box 优先，对应 polygon 在后）。前端 `Tab` 切活跃几何，`Enter` 接受当前形态。
> - **老 backend 兼容**：缺 `output` 字段时按 `"mask"` 路径返回，零回归。
> - **老前端兼容**：不识别 `rectanglelabels` 候选时只显示 `polygonlabels`（v0.9.4 phase 2 已让前端按 type discriminator 渲染）。
> - **point/bbox/polygon 类型**：`output` 字段无意义，始终走 SAM mask → polygon。

> **`simplify_tolerance: number`**（v0.9.4 phase 3，可选；缺省走 backend 默认 1.0）：
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
  "type": "rectanglelabels" | "polygonlabels" | "keypointlabels",
  "value": {
    // type=rectanglelabels：归一化 [0,1]
    "x": 0.12, "y": 0.34, "width": 0.45, "height": 0.20,
    "rectanglelabels": ["car"],

    // type=polygonlabels
    "points": [[x, y], ...],   // 归一化 [0,1]
    "polygonlabels": ["road"]
  },
  "score": 0.91                // 单框置信度，可与外层 score 并存
}
```

平台不强校验 schema，但图片工作台当前只渲染 `rectanglelabels` / `polygonlabels`。返回其它 type 不会报错但也不显示。

---

## 4. `GET /setup`（v0.10.1 后必填）

**用途**：自描述 backend 能力，前端 `useMLCapabilities` hook 据此决定哪些 AI 工具可用、参数面板渲染哪些字段。

> 协议背后的架构决策：[ADR-0020 — ML Backend Capability 协商协议](../adr/0020-ml-backend-capability-negotiation.md)。该 ADR 解释了为什么 `params` 限制为 Draft-07 子集、为什么走 apps/api 代理而非前端直连。

**响应**：JSON Schema 自描述协议。**必填**三元组：`name` / `version` / `model_version`；`supported_prompts` 决定 ToolDock 工具置灰；`params` 是 JSON Schema (Draft-07 子集)，前端 schema-form 自动渲染。

```jsonc
{
  "name": "sam3-backend",                       // 必填. backend 标识
  "version": "0.10.1",                          // 必填. backend 镜像/代码版本
  "model_version": "sam3.1",                    // 必填. 实际加载的模型 ckpt 版本
  "is_interactive": true,
  "labels": [],                                 // 可选. backend 已知类别 hint
  "supported_prompts": ["text", "exemplar"],     // 选项 A 的 sam3 不暴露 point/bbox: 物理上只有 PCS 找相似(exemplar)与 text; 单物体点/框需 grounded-sam2 或开 inst_interactivity
  "supported_text_outputs": ["box", "mask", "both"],
  "params": {
    "type": "object",
    "properties": {
      "box_threshold": {
        "type": "number", "minimum": 0, "maximum": 1,
        "default": 0.35, "title": "Box 置信度阈值"
      },
      "sam_variant": {
        "type": "string", "enum": ["tiny", "small", "base_plus", "large"],
        "default": "tiny", "title": "SAM 2 变体"
      }
    }
  }
}
```

> **变体 `readOnly` 语义（v0.10.23 起）**：grounded-sam2-backend 内置 ModelPool 后，`sam_variant` / `dino_variant` 去掉了 `readOnly`，前端可按会话切换，每次 `/predict` 经 `context.{sam_variant,dino_variant}` 携带请求级变体（详见 §2.2）。`sam_variant` enum 与 backend `SAM2_CONFIGS` key 一致：`tiny | small | base_plus | large`（注意是 `base_plus` 不是 `base`）。sam3-backend 单模型无 pool，其 variant 字段仍可保留 `readOnly`。

> **`supported_prompts`**：枚举 `point | bbox | text | exemplar | sketch | scribble | …`。前端 ToolDock 据此置灰不支持的工具（M2 / v0.10.2 落地）。
>
> **`supported_text_outputs`**：text 路径支持的 `Context.output` 取值。
>
> **`params` JSON Schema**：当前前端消费的最小类型集 `number | integer | string (含 enum) | boolean`；`readOnly: true` 字段在 UI 上展示但不可改。

**平台代理端点（v0.10.1）**：前端通过 `GET /api/v1/projects/{id}/ml-backends/{bid}/setup` 拉取；apps/api 30s TTL 进程内缓存，update/delete backend 时自动 invalidate。

**前端兜底**：返回体缺 `supported_prompts` 时前端回落 `["point","bbox","text"]` 并 `console.warn` 提示升级 backend。`/setup` 502 时整套 AI 工具置灰。

---

## 5. `GET /versions`（可选）

**响应**：
```json
{ "versions": ["v1.0.0", "v1.1.0", "v1.2.3"] }
```

前端会把这个列表填到「模型版本」下拉框；用户选定后写到 `MLBackend.extra_params` 并在后续 `/predict` 请求 header 或 body 携带（具体由 backend 自行约定）。未实现时返回 `{"versions": []}`。

---

## 6. 错误响应约定

平台对所有非 2xx 走 `httpx.HTTPStatusError`：

- 同步 batch（`/predict` 批量）：worker 捕获并写一行 `failed_predictions`（`apps/api/app/db/models/prediction.py:59-79`），字段 `error_type` = HTTP 状态码，`message` = response body 截断到 4KB。继续下一 batch。
- 交互式（`/predict` 单条）：服务层 `predict_interactive` (`ml_client.py`) 把上游响应映射后再抛给 HTTP 端点：**上游 4xx 原样透传 4xx**（如 SAM 3 不支持 `point` 探针返回的 400），**上游 5xx / 连接超时映射为 502** Bad Gateway，detail 带上 backend 原始文案。前端全局拦截器只对 403/≥500 弹 toast，故透传的 4xx 不会刷屏（warmup 探针的预期失败被静默吞掉），真正的 backend 故障才以 502 提示。

推荐 backend 错误格式（不强制）：
```json
{ "error": "model_not_loaded", "message": "GPU OOM, please retry" }
```

---

## 7. token / cost 透传（v0.6.x+）

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
"""Echo ML backend — 协议参考实现（最小可跑版）。

满足 ml-backend-protocol §1-3 的 4 个端点：/health、/setup、/versions、/predict。
所有 /predict 输出固定的 demo bbox，让平台端到端链路可以直接走通。
真实 backend 的 inference 替换到 predict() 内部即可。
"""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


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
    return {"name": "echo-backend", "labels": ["demo"], "is_interactive": False}


@app.get("/versions")
async def versions():
    return {"versions": ["v0.0.1"]}


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
                "model_version": "v0.0.1",
                "inference_time_ms": 1,
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
- [ ] `/predict` 批量 schema 与 §2.1 对齐，至少回填 `task` + `result`
- [ ] 如声明 `is_interactive=True`，`/predict` 也接受 §2.2 单条请求
- [ ] 每条 result 的 `type` 与项目类型匹配（image-det 项目至少要有 `rectanglelabels`）
- [ ] 非 2xx 时返回结构化错误体便于排查（推荐 §6 格式）
- [ ] 长任务考虑 backend 内部异步 + 在合理时间内（< `ml_predict_timeout`）返回结果，否则平台会判超时并落 `failed_predictions`

---

## 10. 参考实现

社区已有几种现成接入：
- **Label Studio ML Backends 模板**（兼容平台 schema）：https://github.com/HumanSignal/label-studio-ml-backend
- **GroundingDINO + SAM**：调研报告 [`docs/research/06-ai-patterns.md`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/docs/research/06-ai-patterns.md) §模式 B
- **X-AnyLabeling SAM 工厂**：调研报告 [`docs/research/04-x-anylabeling.md`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/docs/research/04-x-anylabeling.md)
