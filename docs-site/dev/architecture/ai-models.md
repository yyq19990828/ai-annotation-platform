# AI 模型集成（grounded-sam2-backend / 后续 sam3-backend）

> 配套版本：v0.9.1（M1 — embedding 缓存）。后续 v0.10.x SAM 3 接入后本文继续扩展。
> 协议契约见 [`ml-backend-protocol.md`](../ml-backend-protocol.md)；版本切片见 [`ROADMAP/0.9.x.md`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/ROADMAP/0.9.x.md)。

---

## 1. 部署拓扑

```
apps/api (FastAPI 3.11) ──HTTP /predict──▶ grounded-sam2-backend  (v0.9.x)
                                            FastAPI + PyTorch 2.3 + CUDA 12.1
                                            GroundingDINO + SAM 2.1
                                            + LRU embedding cache (M1)
                       └──HTTP /predict──▶ sam3-backend            (v0.10.x，并存)
                                            FastAPI + PyTorch 2.7 + CUDA 12.6
                                            SAM 3
```

**SAM 系列必须独立服务进程**：v0.9.x 锁 Python 3.10 / torch 2.3 / CUDA 12.1（GroundingDINO Deformable Attention 算子要 nvcc 现场编译），与 v0.10.x SAM 3 的 3.12 / 2.7 / 12.6 互不兼容。共用进程会触发 ABI 冲突（TORCH_CUDA_ARCH_LIST、cudnn 版本）。

### 1.1 docker-compose profile + nvidia 资源预留

> **v0.9.14 通用模板**：以 `grounded-sam2-backend` 为参考实例，v0.10.x `sam3-backend` 接入时复用相同骨架（仅替换 service 名 / 镜像 / 端口）。

每个 backend service 必备四项：① 独立 service + 独立端口；② `profiles: ["gpu"]` opt-in（dev 默认 CPU mock 不启 GPU profile，避免开发机被占用）；③ `deploy.resources.reservations.devices` 申请 nvidia GPU；④ `healthcheck start_period=120s`（首次冷启 ~900MB checkpoint 下载）。

```yaml
# docker-compose.yml 节选
services:
  grounded-sam2-backend:
    profiles: ["gpu"]                     # 默认不启, --profile gpu opt-in
    build:
      context: ./apps/grounded-sam2-backend
      dockerfile: Dockerfile
    image: ai-annotation/grounded-sam2-backend:0.9
    ports:
      - "8001:8000"                       # host:container
    environment:
      SAM_VARIANT: tiny                   # tiny|small|base_plus|large; 显存预算见 §1.2
      DINO_VARIANT: T                     # T|B
      CHECKPOINT_DIR: /app/checkpoints
    volumes:
      - ./checkpoints:/app/checkpoints    # 持久化, 避免 image 重建拉权重
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      start_period: 120s                  # 首次冷启 + checkpoint 加载
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1                    # 每 backend 1 张卡; 多变体并存看 §1.2
              capabilities: [gpu]
```

**dev vs 生产差异**：

| 场景 | 启动命令 | GPU 需求 | 显存预算 | 备注 |
|---|---|---|---|---|
| **dev (无 GPU 机)** | `docker compose up` | 0 | 0 | grounded-sam2-backend 不启动, ml_backends 行 state=stopped, 标注页前端走 disabled UI |
| **dev (有 GPU)** | `docker compose --profile gpu up` | 1 卡 | ~3GB (tiny) | 单变体常驻; 改变体 = 改 env + rebuild |
| **生产 (单租户)** | `docker compose --profile gpu up -d` | ≥ 1 卡 | 见 §1.2 | 按显存档位选 SAM_VARIANT |
| **生产 (多变体并存)** | 拆 service: `gsam2-tiny` / `gsam2-large` (各自 profile) | ≥ 2 卡 (推荐) 或 1 张 ≥ 24GB | 累加 §1.2 | C → B 升级路径见 ROADMAP §A 注册 backend 选变体 |

### 1.2 显存预算 + variant 选型

每个 backend 常驻 = SAM 模型权重 + GroundingDINO 权重 + 推理时 mask buffer + embedding cache buffer。**SAM_VARIANT 与 DINO_VARIANT 通过 env 锁死**（v0.9.x 阶段一变体一容器, 运行期不可变；v0.10.x 阶段 1 计划升级为注册时声明，参见 ROADMAP §A AI 模型）。

| SAM 变体 | 模型权重 | 推理时峰值 | 推荐显存 | 推荐卡 |
|---|---|---|---|---|
| `tiny` (default) | ~155MB | ~3GB | 6GB+ | 4060 8GB / 3070 8GB |
| `small` | ~185MB | ~4GB | 8GB+ | 3070 / 4070 |
| `base_plus` | ~320MB | ~5GB | 10GB+ | 3080 / 4070 Ti |
| `large` | ~895MB | ~7GB | 12GB+ | 3090 24GB / A4000 |

GroundingDINO 额外占用：`T` ~700MB / `B` ~1.5GB（仅 mask + box 模式需要，box 模式跳过 SAM 仍占 DINO）。

embedding cache buffer（v0.9.1）：`EMBEDDING_CACHE_CAPACITY` 默认 32 entries，每 entry ~5MB（HxW 256-d feature map 浮点），cap=32 ≈ 160MB；按 GPU 显存富余度调到 16~64。

**显存预算表（典型 dev / 生产组合）**：

| GPU | 推荐 SAM | 推荐 DINO | 单实例总显存 | 可同卡跑变体数 |
|---|---|---|---|---|
| 4060 / 3060 (8GB) | tiny | T | ~3.7GB | 1 (单变体) |
| 3070 / 4070 (12GB) | small / base_plus | T | ~4.7-5.7GB | 1-2 |
| 3090 / A4000 (24GB) | large | T 或 B | ~7.7-8.5GB | 2-3 (多容器并存) |
| A100 40GB / H100 | large | B | ~8.5GB | 4+ (整租户多变体池) |

**多容器并存**（生产高负载）：把 `grounded-sam2-backend` 拆成 `gsam2-tiny` / `gsam2-large` 两个 service（独立 profile + 独立端口），按业务 tier 路由不同 batch（tier-A 高精度走 large，tier-B 快通走 tiny）。运行期切换 / 模型 pool 在 ROADMAP §A 阶段 2 (B) 触发后做。

### 1.3 镜像基础 + checkpoint 同步

镜像基于 `pytorch/pytorch:2.3.1-cuda12.1-cudnn8-devel`（**devel** 必需，runtime 镜像缺 nvcc 触发 GroundingDINO 编译失败）。Dockerfile 末段 `pip install -e ../_shared/mask_utils` 把共享 mask 转换包链入容器（v0.9.14 起包内含 `mask_to_multi_polygon`，详 ADR-0013）。

checkpoint 同步：`apps/grounded-sam2-backend/scripts/download_checkpoints.py` 按 SAM_VARIANT / DINO_VARIANT env 拉 hf-mirror 镜像；首次冷启或换 variant 时跑一次。生产环境推荐挂 PV / EBS 把 `/app/checkpoints` 持久化（~900MB-2GB），避免 image rebuild 重新下载。

---

## 2. 三种 prompt 路由

```
context.type == "point"  ┐
context.type == "bbox"   ├─▶ SAM 2.1 image_predictor → mask → polygon
context.type == "text"   ┘   先 GroundingDINO(caption→boxes)，再 SAM
```

返回值统一是 `polygonlabels` 数组（归一化 [0,1] 顶点列表 + score）。`text` 一次可能返回 N 个 polygon（DINO 召回多目标）。

---

## 3. SAM 2 image embedding 缓存（v0.9.1 / M1）

### 3.1 为什么缓存
工作台 `S` 工具的典型操作是同一张图反复点击 / 拖框（先 positive point 再 negative point 修边、调 bbox 看效果）。每次 SAM 2 `set_image()` 计算 image embedding ≈ 1.5 s（4060 / tiny），是热点。

DINO 端不缓存：每条 caption 不同，命中率低，且 DINO 输出是 box 不是 embedding。

### 3.2 Cache key
```
cache_key = sha1(url_path + "|" + sam_variant)
```

- `url_path` 由 `urllib.parse.urlsplit()` 取 `scheme://netloc/path`，**剥掉 query string**。MinIO presigned URL 的 `X-Amz-Signature` / `X-Amz-Date` 每次都会变，但底层对象不变；剥掉签名后跨 TTL 仍然命中。
- 拼上 `sam_variant`（`tiny` / `small` / `base_plus` / `large`）确保切大模型不会读到老 embedding。
- 本地路径（dev 用）直接以原串作 key。

### 3.3 命中后做什么
SAM2ImagePredictor `set_image()` 之后状态写在 `_features` / `_orig_hw` / `_is_image_set` / `_is_batch` 几个实例属性。命中时把这些字段从 `CacheEntry` 写回，等价于 `set_image()` 但跳过 image encoder。

| prompt | 命中能省 | 命中不能省 |
|---|---|---|
| `point` | `_fetch_image()` + SAM `set_image()` | SAM `predict()`（每次 prompt 不同） |
| `bbox` | `_fetch_image()` + SAM `set_image()` | SAM `predict()` |
| `text` | SAM `set_image()` | DINO 推理（每次 caption 不同） + image fetch（DINO 要原图） |

> 工程注意：`features` 里的 tensor 在 GPU。我们存引用、不 deepcopy；GPU 内存上限由 LRU 容量物理保证。

### 3.4 容量与显存预算

| 变体 | 单条 embedding ≈ | 默认 capacity | 总占用 ≈ |
|---|---|---|---|
| `tiny` | 4 MB | 16 | 64 MB |
| `small` | 8 MB | 16 | 128 MB |
| `base_plus` | 16 MB | 16 | 256 MB |
| `large` | 24 MB | 8 | 192 MB |

经验值，仅供参考。`EMBEDDING_CACHE_SIZE` 环境变量可调：
- 4060 8 GB → 16
- 3090 24 GB → 32
- A100 40 GB → 64

> ⚠️ `large` 变体下不要把 cache size 设到 64+：单次能吃 ~1.5 GB，叠加 SAM/DINO 模型本体 + 推理临时显存可能 OOM。

### 3.5 vendor 升级风险
`_features` / `_orig_hw` / `_is_image_set` / `_is_batch` 是 vendor `IDEA-Research/Grounded-SAM-2` 的内部 API（commit `b7a9c29`）。`scripts/sync_vendor.sh` 升级后必须人肉跑 5-clicks 集成验收（README §性能参考）。

---

## 4. 观测（v0.9.1）

### 4.1 端点
- `GET /metrics` — Prometheus exposition（`generate_latest()` 原始格式）。
- `GET /cache/stats` — 人类可读 JSON：`{size, capacity, hits, misses, hit_rate, variant}`。

### 4.2 指标

| metric | 类型 | labels | 含义 |
|---|---|---|---|
| `embedding_cache_hits_total` | Counter | `prompt_type` | 命中次数（按 `point`/`bbox`/`text`/`unknown` 分） |
| `embedding_cache_misses_total` | Counter | `prompt_type` | 未命中次数 |
| `embedding_cache_size` | Gauge | — | 当前缓存条目数 |
| `inference_latency_seconds` | Histogram | `prompt_type`, `cache` | 端到端 `/predict` 延迟，`cache ∈ {hit,miss}` |

bucket：`[0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]`，专为「miss 长尾秒级 + hit 短尾毫秒级」打的两段。

### 4.3 Prometheus scrape
本 backend 默认监听 8001。在 monitoring profile 的 prometheus 配置里增加 job：

```yaml
scrape_configs:
  - job_name: grounded-sam2-backend
    metrics_path: /metrics
    static_configs:
      - targets: ['grounded-sam2-backend:8001']
```

### 4.4 关键查询

```promql
# embedding 缓存命中率（按 prompt 类型）
sum by (prompt_type) (rate(embedding_cache_hits_total[5m]))
  / (
    sum by (prompt_type) (rate(embedding_cache_hits_total[5m]))
    + sum by (prompt_type) (rate(embedding_cache_misses_total[5m]))
  )

# /predict 命中 vs 未命中 P95 延迟
histogram_quantile(0.95,
  sum by (le, cache) (rate(inference_latency_seconds_bucket[5m]))
)
```

期望：交互式工作台流量稳定后，`prompt_type=point` 的命中率应 ≥ 70%（同图多次点击的天然分布）。

---

## 4.5 per-backend max_concurrency 限速 (v0.9.12)

`ml_backends.extra_params.max_concurrency` (JSONB 字段, 默认 4) 控制平台到该 backend 的并发 `/predict` 上限. 实现:

- `apps/api/app/services/ml_client.py` 模块级 `_semaphores: dict[backend_id, asyncio.Semaphore]` 缓存.
- `MLBackendClient.__init__` 读 `extra_params.max_concurrency`, 通过 `_get_semaphore(backend_id, max_cc)` 拿到或创建信号量.
- `predict()` / `predict_interactive()` 在 `async with await self._acquire():` 内调 httpx, 信号量 acquire/release 自动绕在请求 IO 外.
- 多个 `MLBackendClient` 实例共享同 backend_id 的信号量 (按 backend_id 索引), 跨 task / 跨请求生效.

**配置示例** (DB JSONB):

```json
// ml_backends 行
{
  "id": "abc-...",
  "url": "http://172.17.0.1:8001/",
  "extra_params": {
    "max_concurrency": 2
  }
}
```

**调整后必须重启 worker**: 信号量按 backend_id 永久缓存, 改字段后须 `docker compose restart api celery-worker` 才能生效. 工时换简洁性的取舍 — 真要运行期热更新需要把 cache key 改 `(backend_id, max_cc)` 或加 invalidation 机制, 留 v0.10.x sam3 注册 + UI 配置同窗口.

**注册表单 UI 暴露 (v0.9.13)**: `MlBackendFormModal` 在「认证方式」下方加「最大并发」number input (1-32, 留空走默认 4), 提交时合并到 `extra_params.max_concurrency` (覆盖 textarea JSON 同名键). `RegisteredBackendsTab` 列表行类型列旁显示 `≤N 并发` chip, 缺省值不渲染避免列表噪音. 不再需要直接手改 DB JSONB 字段.

**前端可见性**: `/admin/preannotate-summary` 透传 `ml_backend_max_concurrency` 给 `ProjectCardGrid` 卡片 + `ProjectDetailPanel` 头部展示「最多 N 并发」, 多 batch 并行预标时给 admin 心理预期.

**触发**: B-17 admin 反馈「多 batch 并行预标」需要并发护盾, 否则单 backend 被打爆 → grounded-sam2 GPU OOM 风险.

---

## 5. 协议契约引用

请求与响应字段以 [`ml-backend-protocol.md`](../ml-backend-protocol.md) §2 为准。`/cache/stats` / `/metrics` **不进协议契约**——它们是 backend 内部端点，平台 API 不会消费。

---

## 6. 后续切片（v0.9.x 剩余）

| 切片 | 文档影响 |
|---|---|
| v0.9.2 工作台 `S` 工具 + 文本入口 | 用户手册新增 `sam-tool.md` |
| v0.9.3 mask→polygon 调参 + 抽 `_shared/mask_utils/` | 本文 §3 增「polygon 简化策略」段 |
| v0.9.4 `/ai-pre` 文本批量预标 UI | 用户手册新增 `ai-preannotate.md` |
| v0.9.5 显存监控进 `/health` | 本文 §1 + ADR-0012 / 0013 |
