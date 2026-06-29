# rapidocr-backend

RapidOCR（ONNX）ML backend，平台首个真实 OCR backend。把 RapidOCR 的 `det → cls → rec`
三段拆为**原子能力 + 端到端编排**，对外自报三个 model：

| model_id | 任务 | 输入 → 输出 | composition |
|---|---|---|---|
| `ocr-det` | `detection` | full_image → polygon 文本框 | atom |
| `ocr-rec` | `ocr` | crop → `attributes.text`(+orientation/language) | atom（内部跑 cls 方向校正）|
| `ocr-e2e` | `ocr` | full_image → polygon + text + orientation | composite（det→cls→rec）|

cls（文本行方向 0/180）语言/版本无关，内化进 rec 与 e2e、不单独暴露。平台 pipeline 可把
`ocr-det（源阶段）→ ocr-rec（下游吃 crop）` 串成编排。

## 变体（version × size × lang）

- **det**：v5 mobile/server · v6 tiny/small/medium（语言无关）
- **rec / e2e**：通用(中英) = v5 mobile/server + v6 tiny/small/medium；英文 = v5 mobile
- `cls` 按 size 选 mobile/server 档，rec/e2e 共享

经 `context.model_variants`（`{version,size,lang}`）选档，缺省取 v5/mobile/universal。

## 模型权重

13 个 onnx（det 5 + cls 2 + rec 6，共 ~369MB），来自 RapidOCR v3.9.0 的 ModelScope 仓库。
不入 git、bind-mount 注入。起栈前先下载：

```bash
python3 apps/rapidocr-backend/download_models.py   # SHA256 校验、幂等
```

## 运行（dev）

```bash
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu-rapidocr up -d rapidocr-backend
curl -s localhost:8005/health
curl -s localhost:8005/setup | python3 -m json.tool
```

端口 8005。base 与瘦身后的 onnxtools-backend 共享 `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04`，
GPU 可选（缺 GPU 时 onnxruntime 自动 fallback CPU）。环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `RAPIDOCR_MODEL_DIR` | `/app/models` | 权重根目录 |
| `RAPIDOCR_DEVICE` | `gpu` | `gpu` 启用 CUDAExecutionProvider；`cpu` 走 CPU |
| `RAPIDOCR_POOL_CAP` | `3` | 引擎池容量（LRU 淘汰）|

## 接入平台

注册 backend URL 用 `172.17.0.1:8005`（宿主端口，非 compose 服务名；见 ml-backend-url-dev memo）。
`resource_profile.device`/`batchable` 决定 v0.19.5 设备感知队列路由（GPU→ml / CPU→ml.cpu）。
