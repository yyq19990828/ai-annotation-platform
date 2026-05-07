# v0.9.0 — grounded-sam2-backend 容器化（M0）实施计划

## Context

v0.9.x 是首版 AI 基座，把 `IDEA-Research/Grounded-SAM-2` 打包成独立 ML Backend，吃下「文本批量预标 + 点/框→mask 交互式精修」两种模式。本计划只做 **M0 — backend 容器化**：把服务跑起来 + 暴露协议 4 端点 + 接进 docker-compose + 项目「测试连接」绿灯。M1 缓存 / M2 工作台 S 工具 / M3 polygon 调参 / M4 `/ai-pre` UI / M5 运维收口都在后续 patch 版本（v0.9.1 ~ v0.9.5）单独切片，本计划不涉及。

完成后影响面：
- 新服务 `apps/grounded-sam2-backend/` 上线，可被 `apps/api` 通过 `MLBackendClient.predict_interactive` / `predict` 调用（这两个客户端方法在 [apps/api/app/services/ml_client.py:44-106](apps/api/app/services/ml_client.py:44) 已就位，**不动**）。
- 协议契约 `docs-site/dev/ml-backend-protocol.md` §2.2 v0.8.6 已扩 `text` 类型（**不动**），本计划仅在 backend 侧实现该 type 的实际处理。
- ProjectSettings「测试连接」会调到 `/health`，依赖 v0.8.6 已落的健康检查 Celery beat（**不动**）。

## 范围边界（M0 只做这些）

- ✅ 4 个端点跑通（`/health` `/setup` `/versions` `/predict`），三种 prompt（point / bbox / text）都能返回有效 polygonlabels
- ✅ docker-compose service + GPU profile（`profiles: ["gpu"]`）
- ✅ checkpoints 启动时按需下载（HuggingFace）
- ✅ 协议响应符合 [docs-site/dev/ml-backend-protocol.md](docs-site/dev/ml-backend-protocol.md) §2.2 schema
- ❌ 不做 LRU embedding 缓存（M1）
- ❌ 不做工作台 UI / `/ai-pre` 页面（M2 / M4）
- ❌ 不做 polygon tolerance 调参评估（M3，本期用默认 1.0）
- ❌ 不做中→英翻译层（M2 一起做）
- ❌ 不做显存监控 / ADR-0010 / ADR-0011（M5）

## 推荐方案

### 1. 目录结构（新建）

```
apps/grounded-sam2-backend/
├── pyproject.toml              # Python 3.10 + 依赖锁
├── Dockerfile                  # 基于 pytorch/pytorch:2.3.1-cuda11.8-cudnn8-runtime
├── README.md                   # 启动 + vendor 同步说明
├── .dockerignore
├── main.py                     # FastAPI app + 4 端点（仿 echo-ml-backend/main.py 骨架）
├── predictor.py                # 封装三种 prompt 的推理路径
├── schemas.py                  # PredictRequest / PredictResponse / Context（与协议对齐）
├── checkpoints/                # .gitkeep；启动时拉权重
│   └── .gitkeep
├── scripts/
│   ├── download_checkpoints.py # 启动前下载 DINO-T + SAM 2.1 tiny
│   └── sync_vendor.sh          # 从 IDEA-Research/Grounded-SAM-2 拉指定 commit
└── vendor/
    └── grounded-sam-2/         # vendored copy（固定 commit hash，写进 README）
        └── ...                  # 上游内容
```

**vendor 形态决策**：vendored copy（不用 submodule）。原因：
- 上游 demo 脚本结构频繁变；submodule 跟踪 main 易踩坑
- vendored copy + `scripts/sync_vendor.sh` 一次同步可控
- CI / 构建无需 `git submodule update --init` 额外步骤

### 2. 关键文件设计

#### 2.1 `pyproject.toml`
- Python 3.10（与 pytorch 2.3.1 / CUDA 11.8 对齐；不要混 3.11，避免与 vendor 编译扩展不兼容）
- 依赖：`fastapi>=0.110`、`uvicorn[standard]>=0.27`、`pydantic>=2.5`、`torch==2.3.1`、`torchvision==0.18.1`、`opencv-python-headless`、`shapely`、`numpy`、`huggingface_hub`、`pillow`、`transformers`（GroundingDINO 需要）、`supervision`（vendor 用到）
- 不引入 `apps/_shared/mask_utils/`（M0 backend 内联简化，M3 再统一收编）—— 这是为了避免 backend 镜像挂 monorepo 路径的复杂性；M3 改用 `pip install -e ../_shared/mask_utils` 时再切

#### 2.2 `Dockerfile`
- Base: `pytorch/pytorch:2.3.1-cuda11.8-cudnn8-runtime`
- 安装系统依赖：`git`、`libgl1`、`libglib2.0-0`（OpenCV 运行时）
- 安装 vendor 内 `Grounded-SAM-2/` 的本地包（`pip install -e ./vendor/grounded-sam-2`，按上游 README 指引）
- COPY 应用代码
- ENTRYPOINT: 先跑 `scripts/download_checkpoints.py`（幂等，已下载就跳过），再 `uvicorn main:app --host 0.0.0.0 --port 8001 --workers 1`
- workers=1（GPU 模型不可多进程共享显存；多 worker 等于多份模型加载）

#### 2.3 `main.py`（仿 [docs-site/dev/examples/echo-ml-backend/main.py](docs-site/dev/examples/echo-ml-backend/main.py) 骨架）

```python
@app.get("/health") -> {"ok": True, "gpu": torch.cuda.is_available()}
@app.get("/setup")  -> {"name": "grounded-sam2", "labels": [], "is_interactive": True}
@app.get("/versions") -> {"versions": ["grounded-sam2-dinoT-sam2.1tiny"]}
@app.post("/predict") -> 分流：
    if "task" in body and "context" in body:   # 交互式（点/框/文本）
        return PredictionResult
    else:                                       # 批量（tasks 数组）—— 暂只支持 text 类型批量
        return {"results": [...]}
```

`/predict` 的请求体字段以 [docs-site/dev/ml-backend-protocol.md](docs-site/dev/ml-backend-protocol.md) §2.2 为准。`task.file_path` 是 MinIO presigned URL 或 `s3://` 路径——M0 仅支持 HTTP(S) URL（用 `httpx` 同步下载到内存 BytesIO）。

#### 2.4 `predictor.py`

三个公开函数，都返回 `list[dict]`（直接是协议中的 `result[]` 元素，归一化坐标）：

```python
class GroundedSAM2Predictor:
    def __init__(self, sam_variant="tiny", dino_variant="T",
                 box_threshold=0.35, text_threshold=0.25): ...
    def predict_text(self, image: PIL.Image, text: str) -> list[dict]:
        # GroundingDINO → boxes → SAM 2.1 → masks → polygon
    def predict_point(self, image, points, labels) -> list[dict]:
        # 跳过 DINO，直接 SAM image_predictor
    def predict_bbox(self, image, bbox) -> list[dict]:
        # 跳过 DINO，直接 SAM image_predictor
```

mask→polygon 用 `cv2.findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)` + `shapely.geometry.Polygon(...).simplify(tolerance=1.0, preserve_topology=True)`，保留外环顶点 → 归一化到 [0,1]。简化版 inline 在 `predictor.py`，**M3 再抽公共**。

变体选择（env 可覆盖）：
- `SAM_VARIANT=tiny` (default) | small | base_plus | large
- `DINO_VARIANT=T` (default) | B
- `BOX_THRESHOLD=0.35` / `TEXT_THRESHOLD=0.25`

#### 2.5 `scripts/download_checkpoints.py`

幂等：检查 `checkpoints/sam2.1_hiera_tiny.pt` 与 `checkpoints/groundingdino_swint_ogc.pth` 是否存在，缺失才下。用 `huggingface_hub.hf_hub_download` 拉权重，URL 来源记入 `README.md` 表格。下载失败 sys.exit(1) 让容器启动失败而不是带半残模型上线。

#### 2.6 `scripts/sync_vendor.sh`

```bash
# Usage: bash scripts/sync_vendor.sh <commit-sha>
# Clones IDEA-Research/Grounded-SAM-2, checkout sha, rsync into vendor/grounded-sam-2/, drops .git
```

固定 commit 写在 `README.md` 顶部（M0 选定一次后不再变；M5 升级再改）。

### 3. docker-compose 集成

修改 [docker-compose.yml](docker-compose.yml)（参考现有 services 风格，仿 celery-worker section）：

```yaml
services:
  grounded-sam2-backend:
    build:
      context: ./apps/grounded-sam2-backend
    profiles: ["gpu"]
    ports:
      - "8001:8001"
    environment:
      SAM_VARIANT: ${SAM_VARIANT:-tiny}
      DINO_VARIANT: ${DINO_VARIANT:-T}
      BOX_THRESHOLD: ${BOX_THRESHOLD:-0.35}
      TEXT_THRESHOLD: ${TEXT_THRESHOLD:-0.25}
      HF_HOME: /app/.cache/huggingface
    volumes:
      - gsam2_checkpoints:/app/checkpoints
      - gsam2_hf_cache:/app/.cache/huggingface
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 120s   # 模型加载需时间

volumes:
  gsam2_checkpoints:
  gsam2_hf_cache:
```

启用方式：`docker compose --profile gpu up grounded-sam2-backend`。dev 默认 profile 不启动（无 GPU 笔记本场景不卡）。

### 4. 协议文档

[docs-site/dev/ml-backend-protocol.md](docs-site/dev/ml-backend-protocol.md) §2.2 v0.8.6 已扩 `text` 类型 docstring，本期**不动**；只在 `apps/grounded-sam2-backend/README.md` 引用一次「实现版本：v0.9.0」。

### 5. 关键文件清单

**新建**：
- `apps/grounded-sam2-backend/pyproject.toml`
- `apps/grounded-sam2-backend/Dockerfile`
- `apps/grounded-sam2-backend/.dockerignore`
- `apps/grounded-sam2-backend/README.md`
- `apps/grounded-sam2-backend/main.py`
- `apps/grounded-sam2-backend/predictor.py`
- `apps/grounded-sam2-backend/schemas.py`
- `apps/grounded-sam2-backend/scripts/download_checkpoints.py`
- `apps/grounded-sam2-backend/scripts/sync_vendor.sh`
- `apps/grounded-sam2-backend/checkpoints/.gitkeep`
- `apps/grounded-sam2-backend/vendor/grounded-sam-2/`（vendor copy，固定 commit）

**修改**：
- `docker-compose.yml`（加 service + 2 个 volume）
- `.env.example`（加 `SAM_VARIANT` / `DINO_VARIANT` / `BOX_THRESHOLD` / `TEXT_THRESHOLD` 注释行）
- `CHANGELOG.md`（开新段 `## v0.9.0`）

**不动（已就位、本期复用）**：
- [apps/api/app/services/ml_client.py:44-106](apps/api/app/services/ml_client.py:44) — `MLBackendClient.predict` / `predict_interactive` / `health`
- [docs-site/dev/ml-backend-protocol.md](docs-site/dev/ml-backend-protocol.md) §2.2
- [apps/_shared/mask_utils/](apps/_shared/mask_utils/) — M3 再切共享，本期 backend 内联
- v0.8.6 的 `apps/api/app/workers/ml_health.py` 健康检查 Celery beat
- ProjectSettings GeneralSection 的 backend URL 配置 + 「测试连接」按钮

## 验证（端到端）

按顺序跑通：

1. **build 通过**：`docker compose --profile gpu build grounded-sam2-backend`，无 vendor 编译错误。
2. **启动且权重下载**：`docker compose --profile gpu up grounded-sam2-backend`，日志显示 checkpoints 下载完成 + uvicorn 监听 8001。首次冷启动 ≤ 5 分钟。
3. **`/health` 200**：`curl http://localhost:8001/health` → `{"ok": true, "gpu": true}`。
4. **`/setup` `/versions`**：返回符合 schema 的 JSON。
5. **交互式 bbox**：
   ```
   curl -X POST http://localhost:8001/predict \
     -H 'content-type: application/json' \
     -d '{"task":{"id":1,"file_path":"https://<minio-presigned>/sample.jpg"},
          "context":{"type":"bbox","bbox":[0.2,0.2,0.5,0.5]}}'
   ```
   → 返回单 polygonlabels，`value.points` 顶点数 ∈ [4, 200]，全部坐标 ∈ [0,1]。
6. **交互式 text**：同上 `context: {"type":"text","text":"person"}`，三张含人的样本图都能返回 ≥ 1 个 polygon。
7. **批量 text**：`{"tasks":[{...},{...}]}` + 顶层 `text` prompt（schemas.py 设计中），返回 `{"results":[...]}` 数组长度 = 输入长度。
8. **平台对接**：在 `/admin/ml-backends` 新建一个 backend 指向 `http://grounded-sam2-backend:8001`，点「测试连接」绿灯；项目 ProjectSettings 关联后看 `predictions` 表 `model_version="grounded-sam2-dinoT-sam2.1tiny"`。
9. **失败路径**：故意停容器 → `/admin/ml-backends` 红灯 ≤ 70s（v0.8.6 健康检查周期 60s + 抖动）。
10. **CHANGELOG.md** 新增 `## v0.9.0` 段记录上述能力。

## 时间预估

| 子任务 | 工时 |
|---|---|
| vendor copy + sync 脚本 + commit 选定 | 0.5 d |
| pyproject + Dockerfile + 镜像 build 通过 | 1 d |
| predictor.py 三种 prompt 跑通 | 1.5 d |
| main.py + schemas.py + `/predict` 分流 | 0.5 d |
| download_checkpoints.py + 幂等 | 0.25 d |
| docker-compose 接入 + GPU profile | 0.25 d |
| 端到端验证 + README + CHANGELOG | 1 d |
| **合计** | **~5 工作日** |

## 风险与回退

- **vendor 上游编译失败（如 `_C.cpython-310-...so` build issue）**：固定 commit + Dockerfile 锁 base 镜像版本；记录 build 命令到 README 排错段。回退策略：上游若两周仍无法修，临时切 `MMDetection-SAM` 或拉 IDEA `Grounded-Segment-Anything` 老版顶。
- **A100 部署时 CUDA 11.8 vs 12.x 驱动不匹配**：base 镜像选 11.8 runtime（驱动 ≥ 470 即兼容），生产 A100 驱动 ≥ 525 → 兼容。M5 deploy.md 写 driver 检查清单。
- **首次启动 5 分钟超时**：healthcheck `start_period: 120s` 已留 buffer；如仍超时，README 建议 host 侧预热 `docker compose run --rm grounded-sam2-backend python scripts/download_checkpoints.py`。
- **dev 笔记本无 GPU**：`profiles: ["gpu"]` 默认不启动；dev 用 echo-backend 走通流程即可。
