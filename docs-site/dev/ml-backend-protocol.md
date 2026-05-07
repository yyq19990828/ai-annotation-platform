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
    "type": "point" | "bbox" | "polygon" | "text",
    "points": [[x, y], ...],                // type=point 时
    "bbox": [x1, y1, x2, y2],               // type=bbox 时
    "labels": [1, 0, ...],                  // 可选；point 类型，1=positive 0=negative
    "text": "ripe apples",                  // type=text 时（v0.9.x Grounded-SAM-2 文本批量入口）
    "output": "box" | "mask" | "both",      // v0.9.4 phase 2 · 仅 type=text 生效, 默认 "mask" 老前端兼容
    "box_threshold": 0.35,                  // 可选; type=text 时 backend 的 DINO 阈值 override
    "text_threshold": 0.25                  // 可选; 同上
  }
}
```

`context` 是个开放 dict——平台和 backend 协商具体字段，平台不做 schema 校验（`ml_client.py:64-82`）。

> **`type=text`**：v0.9.x（Grounded-SAM-2）一次性引入。GroundingDINO 文本 → boxes → SAM mask 链路，返回 `result[]` 为多 polygon。`exemplar`（图像示例 prompt）类型留给 v0.10.x SAM 3。

> **`output: "box" | "mask" | "both"`**（v0.9.4 phase 2，仅 `type=text` 生效）：
> - `box`：仅 GroundingDINO 出框，跳过 SAM image embedding + mask 推理 + cv2/shapely 简化。返回 `result[]` 全为 `rectanglelabels`，单图 ~50-100ms（4060 / tiny），相比 mask 全链路 200-500ms 快 50-80%。**适用 image-det 项目**：标注员要的就是 bbox annotation。
> - `mask`（**默认**）：当前 v0.9.2 行为，DINO + SAM mask → polygon，返回 `polygonlabels`。
> - `both`：同 instance 配对返回 `[rectanglelabels, polygonlabels, ...]` 严格交错（box 优先，对应 polygon 在后）。前端 `Tab` 切活跃几何，`Enter` 接受当前形态。
> - **老 backend 兼容**：缺 `output` 字段时按 `"mask"` 路径返回，零回归。
> - **老前端兼容**：不识别 `rectanglelabels` 候选时只显示 `polygonlabels`（v0.9.4 phase 2 已让前端按 type discriminator 渲染）。
> - **point/bbox/polygon 类型**：`output` 字段无意义，始终走 SAM mask → polygon。

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

平台不强校验 schema，但前端 `<ImageStage>` 当前只渲染 `rectanglelabels` / `polygonlabels`。返回其它 type 不会报错但也不显示。

---

## 4. `GET /setup`（可选）

**用途**：让前端在「测试预测」对话框中预览模型期望的输入 schema、类别、超参。

**响应**：自由 JSON，平台原样透传到前端调试面板。常见字段：
```json
{
  "name": "GroundingDINO-T",
  "labels": ["person", "car", "bicycle"],
  "params": { "box_threshold": 0.35, "text_threshold": 0.25 },
  "is_interactive": false,
  "supported_prompts": ["point", "bbox", "text"],
  "supported_text_outputs": ["box", "mask", "both"]
}
```

> **`supported_prompts`**（v0.9.4 phase 2）：自描述当前 backend 实际支持的 prompt 类型。前端按此动态渲染 SAM 子工具栏（`<ToolDock>`）—— 老 backend 缺字段时前端走兜底 `["point","bbox","text"]`，老前端忽略字段不影响。未来扩展 `sketch / scribble / exemplar` 时仅需 backend 加字段，前端零改。
>
> **`supported_text_outputs`**（v0.9.4 phase 2）：自描述 text 路径支持的 `Context.output` 取值。简单 backend（如老镜像）仅支持 `["mask"]` 时前端 segmented control 自动隐藏 `box / both` 选项。

未实现时返回 404 即可，平台不阻断流程。

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
- 交互式（`/predict` 单条）：错误向上抛到 HTTP 端点 (`ml_backends.py:153-186`)，FastAPI 返回 502 给前端，前端弹 toast。

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
