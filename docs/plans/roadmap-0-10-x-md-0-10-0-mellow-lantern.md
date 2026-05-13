# v0.10.0 — sam3-backend 容器化（M0）

> 路线图来源：`ROADMAP/0.10.x.md` §4 v0.10.0
> 范围：仅 M0（容器化 + 协议落地）；UI 入口 / 路由 / AB / 运维收口在 v0.10.1 ~ v0.10.3
> 预计：~5 工作日

## Context

v0.9.x 已经把 ML Backend 协议、`MLBackendClient`、工作台 `S` 工具（point/bbox/text）、`/ai-pre` UI、embedding 缓存、`mask_utils` 共享包、prediction 持久化、健康检查、AdminDashboard 成本卡片全部落到位。SAM 3（2025-11 由 Meta 开源 848M 单档模型，2026-03 发 sam3.1 权重）相对 grounded-sam2 的差异点是：
- 文本 prompt 走 PCS 单模型一步出（不再 DINO→SAM 复合链）
- 新增 **exemplar prompt**（图像示例引导），是 ROADMAP §C.3 「Magic Box / Snap」的天然实现
- Python 3.12 / PyTorch 2.7 / CUDA 12.6，与 grounded-sam2 的 3.10 / 2.3 / 11.8 不兼容 → 各跑各的容器

v0.10.0 的目标是把 `apps/sam3-backend/` 跑通：复用 ~80% 的 grounded-sam2-backend 结构，新增 `exemplar` prompt 类型在协议、`schemas.py`、`predictor.py` 层落地（前端入口和 apps/api 路由留 v0.10.1）。两个 backend 在 docker-compose 用独立 GPU profile，互不干扰。

## 决策摘要

| 维度 | 决策 |
|---|---|
| docker-compose | 主 `docker-compose.yml` 加 `sam3-backend` service，profile `gpu-sam3`（与 grounded-sam2 的 `gpu` profile 解耦，让用户单独控制） |
| HF_TOKEN | 从 `.env` 读 → docker-compose `environment` 注入 → `download_checkpoints.py` 用 `huggingface_hub` 拉权重；`.env.example` 加占位 |
| Embedding cache cap | 默认 32（路线图默认值），通过 env `SAM3_EMBEDDING_CACHE_SIZE` 覆盖 |
| GPU 型号 | docker-compose 不锁型号；README 写明推荐 3090 / A100，4060 不部署 |
| exemplar 协议 | v0.10.0 落地 `schemas.py` + `predictor.py` + 协议文档；前端 UI 入口和 apps/api 路由留 v0.10.1 |
| Vendor | `vendor/sam3/` 完整副本，固定 commit；`scripts/sync_vendor.sh` 同步流程参考 grounded-sam2 |
| 模型权重 | `facebook/sam3.1`（2026-03 发布），通过 HuggingFace Hub 拉，容器启动时下载，volume 持久化 |
| 端口 | 8002（grounded-sam2 占 8001） |
| model_version 字符串 | `sam3.1`（与 grounded-sam2 的 `grounded-sam2-dinoT-sam2.1tiny` 风格一致） |

## 实现计划

### Step 1 — 目录骨架与共享包接入

新建 `apps/sam3-backend/` 目录，文件清单（结构镜像 `apps/grounded-sam2-backend/`）：

```
apps/sam3-backend/
├── Dockerfile
├── pyproject.toml
├── main.py
├── predictor.py
├── embedding_cache.py
├── observability.py
├── schemas.py
├── scripts/
│   ├── download_checkpoints.py
│   └── sync_vendor.sh
├── tests/
│   ├── test_embedding_cache.py
│   ├── test_predictor_exemplar.py
│   └── test_predict_text_output_modes.py
├── checkpoints/    # 启动时落盘，volume 挂载
├── vendor/sam3/    # facebookresearch/sam3 固定 commit
└── README.md
```

复用 `apps/_shared/mask_utils/`：在 Dockerfile 里 `pip install -e /app/mask_utils`（与 grounded-sam2-backend 完全一致）。

→ **verify**：`ls apps/sam3-backend/` 显示完整文件树，`import mask_utils` 能在容器里 import 成功。

### Step 2 — Dockerfile + 依赖锁

参考 `apps/grounded-sam2-backend/Dockerfile`（已读完），调整：
- Base 镜像：`pytorch/pytorch:2.7.0-cuda12.6-cudnn-devel`（按 facebookresearch/sam3 官仓 README 复核；若 README 给出更精确 tag 以官仓为准）
- Python：3.12（base image 内置；不需要 conda）
- `TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0"`（去掉 7.x，因为 sam3 不部署在 V100/T4）
- `gcc-10 / g++-10`（与 CUDA 12.6 兼容性走官仓推荐）
- `HF_HOME=/app/.cache/huggingface`
- ENTRYPOINT：`python /app/scripts/download_checkpoints.py && exec uvicorn main:app --host 0.0.0.0 --port 8002 --workers 1`
- 暴露 8002

`pyproject.toml` 依赖锁（torch/torchvision 由 base image 锁，不重复）：
- fastapi >= 0.110, uvicorn[standard] >= 0.27
- pydantic >= 2.5, httpx >= 0.27
- numpy, pillow, opencv-python-headless, shapely
- huggingface_hub >= 0.23
- transformers（具体下限以 SAM 3 官仓为准）
- prometheus-client, pynvml, psutil
- supervision >= 0.21（与 grounded-sam2 一致）

→ **verify**：`docker compose --profile gpu-sam3 build sam3-backend` 成功。

### Step 3 — Vendor SAM 3

写 `scripts/sync_vendor.sh`（拷 `apps/grounded-sam2-backend/scripts/sync_vendor.sh`，仅改 upstream URL 和 vendor 路径）：

```bash
bash apps/sam3-backend/scripts/sync_vendor.sh <commit-sha>
```

首次同步选 facebookresearch/sam3 main 分支 HEAD 当前可用 commit，sha 写到 `README.md` 的「当前固定 commit」段。Dockerfile 加 `pip install -e ./vendor/sam3`（如 sam3 仓有 `pyproject.toml` 或 `setup.py`）。

→ **verify**：容器里 `python -c "import sam3; print(sam3.__version__)"` 成功；vendor 目录的 `.commit` 文件值与 README 文档一致。

### Step 4 — `schemas.py` 协议落地（含 exemplar）

镜像 `apps/grounded-sam2-backend/schemas.py`，扩展 `Context.type`：

```python
class Context(BaseModel):
    type: Literal["point", "bbox", "polygon", "text", "exemplar"]
    # 已有字段（与 grounded-sam2 一致）
    points: list[list[float]] | None = None
    labels: list[int] | None = None
    bbox: list[float] | None = None        # 同时承担 bbox prompt 和 exemplar 的视觉示例框
    text: str | None = None
    output: Literal["box", "mask", "both"] = "mask"
    simplify_tolerance: float | None = None
    # SAM 3 特有（如需暴露）：top_k, score_threshold 等按官仓 API 增删
```

> `exemplar` 复用 `bbox` 字段承载 4 个坐标，避免协议字段爆炸。语义靠 `type` 区分（与协议契约 §2 一致）。

→ **verify**：`pytest apps/sam3-backend/tests/` 中加 schema 单测，确认 `type="exemplar"` + `bbox=[...]` 合法、`type="exemplar"` 缺 `bbox` 失败。

### Step 5 — `predictor.py` 模型与四种 prompt 分发

新类 `SAM3Predictor`，关键方法：

```python
class SAM3Predictor:
    def __init__(self, checkpoint_dir, device, simplify_tolerance_default):
        # 用 facebookresearch/sam3 的 build_sam3_image_model() 加载 sam3.1 checkpoint
        # 同时持有 image_predictor（point/bbox/exemplar）和 PCS predictor（text）

    def predict_point(image, points, labels, cache_key, simplify_tolerance) -> (results, cache_hit)
    def predict_bbox(image, bbox, cache_key, simplify_tolerance) -> (results, cache_hit)
    def predict_text(image, text, output, cache_key, simplify_tolerance) -> (results, cache_hit)
    def predict_exemplar(image, exemplar_bbox, cache_key, simplify_tolerance) -> (results, cache_hit)  # 新增
```

所有 mask→polygon 复用 `mask_utils.mask_to_multi_polygon(mask, tolerance, normalize_to=(w, h))`，与 grounded-sam2 完全一致（这就是 `_shared/mask_utils` 的价值）。

`predict_exemplar` 的实现：
- SAM 3 PCS 接口接受 visual prompt（exemplar bbox），返回全图相似实例的 masks 列表
- 每个 mask → polygon → `polygonlabels` 结果项
- 缓存 key：与 point/bbox 一样 `sha1(file_path|"sam3.1")`

`predict_text` 与 grounded-sam2 行为对齐 `output: box|mask|both`，但内部不需要 DINO 链，直接走 SAM 3 PCS。

`model_version = "sam3.1"`。

→ **verify**：
- 本地 curl 四种 prompt：`curl http://localhost:8002/predict -d '{"task":{...},"context":{"type":"point|bbox|text|exemplar",...}}'` 都返回 200 + 非空 result
- `test_predictor_exemplar.py` 用 fixture mask 验证 exemplar 路径返回 polygon
- `test_predict_text_output_modes.py` 覆盖 box/mask/both

### Step 6 — `embedding_cache.py` + `observability.py` + `main.py`

这三个文件几乎 1:1 拷自 grounded-sam2-backend：

- `embedding_cache.py`：直接复用，cap 默认改 32（env `SAM3_EMBEDDING_CACHE_SIZE`）；`CacheEntry` 字段按 SAM 3 image predictor 内部 features 结构调整（参考 grounded-sam2 中 `_snapshot_sam / _restore_sam` 的字段名清单，逐个验证 SAM 3 是否同名）
- `observability.py`：Prometheus 指标命名加 `sam3_` 前缀（避免与 grounded-sam2-backend 冲突，在多 backend 同时启用时 Prometheus scrape 不混淆）
- `main.py`：6 个端点（`/health` `/setup` `/versions` `/predict` `/metrics` `/cache/stats`）与 grounded-sam2 一致；`/setup` 的 `supported_prompts` 返回 `["point", "bbox", "text", "exemplar"]`；`MODEL_VERSION = "sam3.1"`

→ **verify**：
- `curl http://localhost:8002/health` → 200 且包含 `gpu`, `cache`, `model_version: "sam3.1"`, `loaded: true`
- `curl http://localhost:8002/setup` → `supported_prompts` 含 `exemplar`
- `curl http://localhost:8002/metrics` → 看到 `sam3_*` Prometheus 指标

### Step 7 — `download_checkpoints.py`

幂等拉 sam3.1 权重：

```python
# 关键：检查 HF_TOKEN 必须有（sam3.1 是 gated repo）
hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
if not hf_token:
    print("ERROR: HF_TOKEN required for facebook/sam3.1 gated repo", file=sys.stderr)
    sys.exit(1)

hf_hub_download(
    repo_id="facebook/sam3.1",
    filename="sam3.1.pt",  # 文件名以官仓 README 为准
    local_dir=CHECKPOINT_DIR,
    token=hf_token,
)
```

→ **verify**：本地 `.env` 配 `HF_TOKEN=...` 后 `docker compose --profile gpu-sam3 up sam3-backend` 看到日志「downloaded sam3.1 to /app/checkpoints/...」。

### Step 8 — `docker-compose.yml` 加 service

在主 `docker-compose.yml` 加（与 grounded-sam2-backend 块并列）：

```yaml
sam3-backend:
  build:
    context: ./apps
    dockerfile: sam3-backend/Dockerfile
  profiles: ["gpu-sam3"]
  ports:
    - "8002:8002"
  environment:
    HF_TOKEN: ${HF_TOKEN}
    HF_HOME: /app/.cache/huggingface
    SAM3_EMBEDDING_CACHE_SIZE: ${SAM3_EMBEDDING_CACHE_SIZE:-32}
    LOG_LEVEL: ${SAM3_LOG_LEVEL:-INFO}
  volumes:
    - sam3_checkpoints:/app/checkpoints
    - sam3_hf_cache:/app/.cache/huggingface
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8002/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 180s   # sam3.1 checkpoint ~3.2GB，留 180s

volumes:
  sam3_checkpoints:
  sam3_hf_cache:
```

`.env.example` 加：

```
HF_TOKEN=
SAM3_EMBEDDING_CACHE_SIZE=32
SAM3_LOG_LEVEL=INFO
```

→ **verify**：`docker compose --profile gpu-sam3 up -d sam3-backend` 容器健康；`docker compose ps` 显示 healthy；只跑 `--profile gpu`（grounded-sam2 单独）不影响。

### Step 9 — 协议文档与 README

修改两份文档：

1. `docs-site/dev/reference/ml-backend-protocol.md`
   - §2.2 `context.type` 列表加 `"exemplar"`：示例 JSON + 字段说明（`bbox` 字段承载 4 坐标）
   - § 加一段「SAM 3 vs Grounded-SAM-2 协议差异」对照

2. `apps/sam3-backend/README.md`（新文件）
   - HF_TOKEN 申请 + 接受 facebook/sam3.1 license 链接
   - GPU 部署建议（3090 / A100 推荐；4060 不支持）
   - vendor commit 同步流程（参考 grounded-sam2 README 写法）
   - 本地 curl 4 种 prompt 的示例

3. `CHANGELOG.md` 加 v0.10.0 段（功能：sam3-backend 容器化 + 协议 exemplar 落地）

→ **verify**：`pnpm docs:dev` → http://localhost:5173 看 ml-backend-protocol 页面渲染正常，exemplar 段在 §2.2。

### Step 10 — apps/api 兼容性确认（不改代码）

v0.10.0 不改 apps/api 任何代码，但要验证：
- ProjectSettings 创建一条新的 ml_backend 行，url 指向 `http://sam3-backend:8002`，「测试连接」绿灯
- `MLBackendClient` 与 sam3-backend 协议一致（4 端点 + 现有 PredictionResult 结构兼容）
- `predictions.model_version` 列出现 `sam3.1` 行，与 `grounded-sam2-dinoT-sam2.1tiny` 行可共存

→ **verify**：UI 上能创建 sam3-backend，测试连接绿，curl `/predict-test` 跑通 point prompt 落 prediction 行。

## 关键文件清单（待新增/修改）

**新增**：
- `apps/sam3-backend/Dockerfile`
- `apps/sam3-backend/pyproject.toml`
- `apps/sam3-backend/main.py`
- `apps/sam3-backend/predictor.py`
- `apps/sam3-backend/embedding_cache.py`
- `apps/sam3-backend/observability.py`
- `apps/sam3-backend/schemas.py`
- `apps/sam3-backend/scripts/download_checkpoints.py`
- `apps/sam3-backend/scripts/sync_vendor.sh`
- `apps/sam3-backend/tests/test_embedding_cache.py`
- `apps/sam3-backend/tests/test_predictor_exemplar.py`
- `apps/sam3-backend/tests/test_predict_text_output_modes.py`
- `apps/sam3-backend/README.md`
- `apps/sam3-backend/vendor/sam3/...`（vendored）

**修改**：
- `docker-compose.yml`（加 `sam3-backend` service + 2 个 volume）
- `.env.example`（加 `HF_TOKEN` / `SAM3_*`）
- `docs-site/dev/reference/ml-backend-protocol.md`（§2.2 加 exemplar）
- `CHANGELOG.md`（v0.10.0 段）
- `ROADMAP/0.10.x.md`（M0 任务清单逐项打勾，标 v0.10.0 done）

**复用（不动）**：
- `apps/_shared/mask_utils/`
- `apps/api/app/services/ml_client.py`
- `apps/api/app/api/v1/ml_backends.py`
- `apps/web/` 全部（v0.10.1 才动）

## 端到端验证清单（与路线图 §4 v0.10.0 验收对齐）

1. **容器启动**：`docker compose --profile gpu-sam3 up -d sam3-backend` 健康 healthcheck = healthy
2. **健康端点**：`curl http://localhost:8002/health` → 200，body 含 `model_version: "sam3.1"` + `loaded: true` + `gpu` 信息
3. **四种 prompt**：分别 curl `/predict` 带 `type=point | bbox | text | exemplar`，全部返回 200 + 非空 result + 合法 polygon/rectangle
4. **ProjectSettings 接入**：在 web UI 创建 sam3-backend 行，url=`http://sam3-backend:8002`，「测试连接」绿灯
5. **预测落库**：用 `/predict-test` 跑一张测试图，DB 出现新 `predictions` 行，`model_version="sam3.1"`，与既有 grounded-sam2 行可在 admin UI 共存
6. **缓存 hit**：同一张图连发 5 次 point prompt，`/cache/stats` `hits >= 4`
7. **隔离性**：只 `--profile gpu` 启动 grounded-sam2 不带 sam3 时，端口 8002 不监听、grounded-sam2 健康
8. **Prometheus 不撞名**：`/metrics` 输出含 `sam3_inference_latency_seconds`，不与 grounded-sam2 的同名指标冲突

## 不在 v0.10.0 范围（明确不做）

- 工作台 `S` 工具 Shift+拖框 = exemplar 入口 → v0.10.1
- ProjectSettings 「默认 text backend」单选 + 优先级标签 → v0.10.1
- apps/api `route_interactive_request()` 路由表 → v0.10.1
- AB 对比工具 / `/ai-pre/compare` 页 → v0.10.2
- ADR-0012 / 部署文档章节 / `ai-models.md` 路由章节 → v0.10.3
- 用户文档 exemplar / AB 教程 → v0.10.2 / v0.10.3
