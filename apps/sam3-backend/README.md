# sam3-backend

> v0.10.x AI 基座的 ML Backend — 把 [`facebookresearch/sam3`](https://github.com/facebookresearch/sam3) (848M, 2025-11) + `facebook/sam3.1` (2026-03 权重) 打包成独立 GPU 服务, 遵循平台 [ML Backend 协议契约](../../docs-site/dev/reference/ml-backend-protocol.md).
>
> 当前版本: **v0.10.0 (M0 — 容器化 + exemplar 协议落地)**. 后续 v0.10.1 ~ v0.10.3 在 [`ROADMAP/0.10.x.md`](../../ROADMAP/0.10.x.md) 切片.

---

## 与 grounded-sam2-backend 的关系

两个 backend **并存** — sam3-backend 是高精度首选, grounded-sam2-backend 兜底 (笔记本能跑). 路由策略见路线图 §3.3, v0.10.1 在 apps/api 落地.

| 能力 | grounded-sam2-backend | sam3-backend |
|---|---|---|
| `point` / `bbox` prompt | ✅ SAM 2.1 直接 | ✅ SAM 3 image predictor |
| `text` prompt | ✅ DINO → SAM 复合链 | ✅ SAM 3 PCS 单模型一步出 |
| **`exemplar` prompt** | ❌ | ✅ SAM 3 PCS 视觉示例 → 全图相似实例 |
| 推荐 GPU | 4060 / 3090 / A100 | **3090 / A100** (不部署 4060) |
| Python / CUDA | 3.10 / 12.1 | 3.12 / 12.6 |

---

## 能力盘点

> v0.10.0 选项 A: 不启用 `enable_inst_interactivity`. SAM 3 原生 image API 不包含 point prompt, 单点交互让 grounded-sam2-backend 兜底.

| Prompt | 链路 | 用途 |
|---|---|---|
| `context.type=point` | ❌ 不支持 | 返回 400; workbench 应挂 grounded-sam2-backend |
| `context.type=bbox` | `add_geometric_prompt(box, label=True)` → 全图相似实例 | ⚠️ 行为与 SAM 2 不同: 不是「box 内出一个 mask」, 而是「找全图与 box 内对象相似的实例」(SAM 3 PCS 视觉示例语义). 单框单 mask 场景请走 grounded-sam2 |
| `context.type=text` | `set_text_prompt(prompt)` → PCS 一步出全图匹配概念 | 文本批量预标 / `/ai-pre` |
| `context.type=exemplar` | 与 bbox 同底层调用 | v0.10.1 工作台 Shift+拖框入口; 协议层独立类型方便前端 UI 区分 |

返回数据均为 `polygonlabels` / `rectanglelabels` (归一化 [0,1]) + score + model_version + inference_time_ms.

---

## 目录结构

```
apps/sam3-backend/
├── pyproject.toml          Python 3.12 依赖锁 (不含 torch/torchvision, 由 base image 锁定)
├── Dockerfile              基于 pytorch/pytorch:2.7.0-cuda12.6-cudnn-devel
├── .dockerignore
├── main.py                 FastAPI app + 6 端点 (含 /metrics、/cache/stats)
├── predictor.py            SAM3Predictor: 四种 prompt 推理 + mask→polygon + cache snapshot/restore
├── embedding_cache.py      SAM 3 image embedding LRU 缓存 (cap 默认 32)
├── observability.py        Prometheus Counter/Histogram/Gauge (sam3_* 前缀)
├── schemas.py              Pydantic schema (协议对齐, 含 exemplar)
├── tests/                  pytest 单测 (无 GPU 即可跑)
├── checkpoints/            权重落盘点 (启动时下载, 挂 volume)
├── scripts/
│   ├── download_checkpoints.py   幂等拉 sam3.1 权重 (gated, 需 HF_TOKEN)
│   └── sync_vendor.sh            同步上游到 vendor/
├── vendor/
│   └── sam3/               vendored copy (须先跑 sync_vendor.sh)
└── README.md
```

---

## Vendor & 固定 commit

vendor 形态选 **vendored copy** 而非 git submodule (与 grounded-sam2-backend 一致, 同步脚本可控).

**首次接入 / 升级**:

```bash
cd apps/sam3-backend
bash scripts/sync_vendor.sh <commit-sha>
git add vendor/sam3 && git commit -m "vendor: bump sam3 to <commit-sha>"
```

**当前固定 commit**: `4cbac146c1b5a1e3a7f5c6a894901090b4dfd65b` (2026-05-13 拉取, main HEAD: "Fix PYRE_MISSING_ANNOTATIONS issues in fbcode/deeplearning/projects/sam3_release/sam3/model/io_utils.py").

> ✅ **2026-05-13 状态**: vendor 已就位 + `predictor.py` / `embedding_cache.py` / `tests/` 已按真实 API 重写 (45 单测全绿). v0.10.0 选项 A: 不启用 `enable_inst_interactivity`, 放弃 point prompt, 让 grounded-sam2-backend 兜底单点交互. 等首位 GPU 部署者跑端到端验收 (HF_TOKEN + `--profile gpu-sam3`).

升级 commit 时务必跑 5-clicks 集成验收, 复核 `Sam3Processor` 公共方法签名 (`set_image` / `set_text_prompt` / `add_geometric_prompt` / `reset_all_prompts`) 与 `state` dict 字段 (`backbone_out` / `geometric_prompt` / `masks` / `boxes` / `scores`) 是否仍然存在.

---

## HF_TOKEN 配置

`facebook/sam3.1` 是 **gated repo**, 必须:

1. 在 [https://huggingface.co/facebook/sam3.1](https://huggingface.co/facebook/sam3.1) 接受 license.
2. 创建一个 read-only access token: [https://huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
3. 写到根 `.env`:

   ```
   HF_TOKEN=hf_xxxxxxxxxxxx
   ```

4. docker-compose 通过 `environment: HF_TOKEN: ${HF_TOKEN}` 注入容器.

`download_checkpoints.py` 启动时检查 `HF_TOKEN`; 未设置则 fail-fast 让容器启动失败.

---

## 本地启动 (GPU 主机)

前置条件:
- NVIDIA driver ≥ **555** (CUDA 12.6 minimum); 老机房需先升驱动.
- `nvidia-container-toolkit` 已装好.
- 主机 GPU 架构在 `TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0"` 范围内 (A100 / RTX 30 / RTX 40 / H100 / H200).
- 显存建议 ≥ 16 GB (FP16 下 sam3 单图 ~6-7 GB, 留余量做 batch).
- `.env` 已配 `HF_TOKEN` 并接受 sam3.1 license.

```bash
# 1. 同步 vendor (一次性)
bash apps/sam3-backend/scripts/sync_vendor.sh <commit-sha>

# 2. 通过 docker compose GPU profile 启动
docker compose --profile gpu-sam3 up --build sam3-backend

# 3. 端到端验证 (四种 prompt 都试一遍)
curl http://localhost:8002/health
curl -X POST http://localhost:8002/predict \
  -H 'content-type: application/json' \
  -d '{"task":{"id":"t1","file_path":"https://example.com/sample.jpg"},
       "context":{"type":"text","text":"person"}}'
curl -X POST http://localhost:8002/predict \
  -H 'content-type: application/json' \
  -d '{"task":{"id":"t1","file_path":"https://example.com/sample.jpg"},
       "context":{"type":"exemplar","bbox":[0.2,0.2,0.45,0.55]}}'
```

首次启动会下载 sam3.1 权重 (~3.2 GB), 冷启动 3-8 分钟取决于网速.

---

## 端点速查

完整规范以 [`docs-site/dev/reference/ml-backend-protocol.md`](../../docs-site/dev/reference/ml-backend-protocol.md) 为准. 本 backend 实现版本 `sam3.1`.

```
GET  /health        → {"ok": true, "gpu": true, "model_version": "sam3.1", "loaded": true, ...}
GET  /setup         → {"name":"sam3", "supported_prompts":["point","bbox","text","exemplar"], ...}
GET  /versions      → {"versions": ["sam3.1"]}
POST /predict       → 交互式 (task+context) 或 批量 (tasks[])
GET  /metrics       → Prometheus exposition (sam3_* 指标)
GET  /cache/stats   → {"size": N, "capacity": 32, "hits":..., "misses":..., "hit_rate": 0.85, "variant": "sam3.1"}
```

`POST /predict` 按 body shape 自动分流, 与 grounded-sam2-backend 完全一致:

```jsonc
// 交互式 point
{"task": {"id":1, "file_path":"https://..."}, "context": {"type":"point", "points":[[0.5,0.5]], "labels":[1]}}

// 交互式 exemplar (v0.10.0 新增)
{"task": {"id":1, "file_path":"https://..."}, "context": {"type":"exemplar", "bbox":[0.2,0.2,0.45,0.55]}}

// 批量 text
{"tasks": [{"id":1,"file_path":"..."}, {"id":2,"file_path":"..."}], "context": {"type":"text", "text":"ripe apples"}}
```

---

## 环境变量

| Env | 默认 | 说明 |
|---|---|---|
| `HF_TOKEN` | — | **必填**; sam3.1 是 gated repo. |
| `CHECKPOINT_DIR` | `/app/checkpoints` | 权重落盘点 (volume 挂载). |
| `SAM3_HF_REPO_ID` | `facebook/sam3.1` | HuggingFace repo. |
| `SAM3_CHECKPOINT_FILE` | `sam3.1.pt` | 文件名 (以官仓 README 实际名为准). |
| `SAM3_EMBEDDING_CACHE_SIZE` | `32` | LRU 容量; A100 充裕可调到 64. |
| `SAM3_SCORE_THRESHOLD` | `0.5` | text / exemplar 路径 PCS score 过滤阈值. |
| `LOG_LEVEL` | `INFO` | DEBUG / INFO / WARNING. |
| `IMAGE_DOWNLOAD_TIMEOUT` | `30` | 拉远端图片超时 (秒). |
| `SAM3_IDLE_UNLOAD_SECONDS` | `600` | 空闲多少秒后自动卸载模型释放显存; ≤0 关闭定时卸载. |
| `SAM3_IDLE_CHECK_INTERVAL` | `60` | idle 检查器轮询间隔 (秒). |

---

## Idle Unload (双 backend 并存的关键)

sam3.1 FP16 常驻 ~7GB 显存, 3090 单卡若同时挂 grounded-sam2 (~2GB) 与平台其他 GPU 任务, 必须靠 idle unload 互让显存. 机制:

1. **自动卸载**: 后台 `_idle_watcher` 每 `SAM3_IDLE_CHECK_INTERVAL` 秒检查; 若 `_predictor` 已加载且 `last_request_age >= SAM3_IDLE_UNLOAD_SECONDS` → 释放模型 + `torch.cuda.empty_cache()` + clear embedding cache (避免悬挂的 GPU 张量).
2. **懒重载**: 下一次 `/predict` 请求触发 `_ensure_predictor_loaded()`, 在 `asyncio.Lock` 内 `run_in_executor` 异步重建, 冷启动 ~8-12s; 并发请求串行化, 不会双重构造 OOM.
3. **手动**: `POST /unload` 显式释放, `POST /reload` 显式重载. 已为目标状态时返回 `unloaded=false` / `reloaded=false`.

`/health` 返回字段:
```json
{
  "loaded": true,
  "idle_unload_seconds": 600,
  "last_request_age_seconds": 123.45
}
```

关闭机制 (常驻显存): `SAM3_IDLE_UNLOAD_SECONDS=0` 或 `SAM3_IDLE_UNLOAD_SECONDS=-1`. 仍可通过 `/unload` 手动卸载.

---

## 性能参考 (FP16 实测目标; 实际数据待 v0.10.0 落地后回填)

| 硬件 | text 全链单图 | 缓存命中点击 |
|---|---|---|
| 3090 24 GB | 200-400 ms | < 50 ms |
| A100 40 GB | 100-200 ms | < 30 ms |
| H200 | 30-60 ms / 100+ obj | < 20 ms |

---

## License

- facebookresearch/sam3 code: 见上游 `LICENSE` (商用前逐条核对; 不与 SAM 2 自动等价).
- 本 backend 代码: Apache 2.0 (与平台一致).

---

## 排错

**vendor/sam3 为空**: 先跑 `bash scripts/sync_vendor.sh <commit>`. Dockerfile 在 build 期检测到空目录会 fail-fast.

**HF_TOKEN 未设置**: 容器启动后 `download_checkpoints.py` 立即 fail-fast 退出. 检查 `.env` 与 docker-compose 的 environment 注入是否一致.

**license not accepted**: HuggingFace API 返回 401/403. 浏览器登 [https://huggingface.co/facebook/sam3.1](https://huggingface.co/facebook/sam3.1) 接受 license 后重试.

**首次启动卡住 > 8 分钟**: `docker compose --profile gpu-sam3 logs -f sam3-backend` 查看下载进度. HuggingFace 偶发限速, 重试即可.

**CUDA OOM**: 减小 `SAM3_EMBEDDING_CACHE_SIZE` (默认 32 → 16); 4060 笔记本不要部署 sam3, 走 grounded-sam2.

**driver too old**: 升级主机驱动到 ≥ 555 (CUDA 12.6 minimum).

**ProjectSettings 测试连接红灯**: `http://sam3-backend:8002` 是 docker 内部地址; 如平台 api 在 host 跑 (dev 模式), 改为 `http://localhost:8002` 或 `http://172.17.0.1:8002` (Linux bridge gateway).

---

## 后续切片 (v0.10.x 路线图)

- v0.10.0 M0: 容器化 + exemplar 协议落地 ✅ (本文档)
- v0.10.1 M1: 工作台 Shift+拖框 = exemplar 入口 + apps/api 路由策略
- v0.10.2 M2: AB 对比工具 (同任务跑两 backend, 平台显示对比)
- v0.10.3 M3: ADR-0012 双 backend 永久共存 + deploy.md 双拓扑
