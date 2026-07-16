# yolo-backend

ai-annotation-platform 的第三个 ML backend（v0.14.12）—— 基于 [ultralytics](https://github.com/ultralytics/ultralytics) 8.4.x 提供 **detection / segmentation(实例) / keypoint / obb** 四任务批量预标。

与 `apps/grounded-sam2-backend` / `apps/sam3-backend` 平级，使用同一份 ml-backend 协议 v2 接入平台。

## 范围

| series   | det | seg | pose | obb | sizes |
|----------|:--:|:---:|:----:|:---:|:------|
| YOLOv8   | ✅ | ✅  | ✅   | ✅  | n/s/m/l/x |
| YOLOv9   | ✅ | c/e | –   | –   | t/s/m/c/e |
| YOLOv10  | ✅ | –   | –   | –   | n/s/m/b/l/x |
| YOLO11   | ✅ | ✅  | ✅   | ✅  | n/s/m/l/x |
| YOLO12   | ✅ | –   | –   | –   | n/s/m/l/x |
| YOLO26   | ✅ | ✅  | ✅   | ✅  | n/s/m/l/x |
| RT-DETR  | ✅ | –   | –   | –   | l/x |

矩阵基于 [`ultralytics/assets` release v8.3.0 + v8.4.0](https://github.com/ultralytics/assets/releases) 实际预训练权重核对（2026-06-08）；不在矩阵内的组合，`/setup` 不暴露 + `/predict` 返回 422 `variant_not_supported`。

**不做**：classification、YOLO26 的 sem/depth/reid/s3d/objv1 头、tracker、训练（`/fit`）、TensorRT/ONNX 加速、batch 推理优化。具体见 v0.14.12 计划文件 §2.2。

## 端点

| 端点 | 用途 |
|---|---|
| `GET /health`  | 健康检查 + 池状态 + GPU/容器 PerfHud |
| `GET /setup`   | 协议 v2 多模型目录（4 model × series × size variants） |
| `GET /versions`| backend / ultralytics 版本 |
| `POST /predict`| 批量预测；入参 `context.{type, variants, params}` + `tasks[]` |
| `POST /warmup` | 受 borrower 保护的模型预热 |
| `POST /drain` / `/drain/cancel` | 受签名 generation fencing 控制的排空 / 恢复 |
| `POST /unload` | 无 body 保留 legacy 兼容；带 generation body 时执行受管全池卸载 |
| `POST /lifecycle/mode` / `/lifecycle/reset` | gate 握手与 unmanaged 驻留可信清场 |
| `GET /metrics` | Prometheus |

详见 [`docs-site/dev/reference/ml-backend-protocol.md`](../../docs-site/dev/reference/ml-backend-protocol.md) §4.1。

## 环境变量

| 名 | 默认 | 作用 |
|---|---|---|
| `YOLO_DEVICE` | `cuda:0` | torch device |
| `YOLO_MODEL_POOL_CAP` | `2` | LRU 池容量 |
| `YOLO_BUILD_TIMEOUT` | `30` | 单次 build 超时(秒) |
| `YOLO_IDLE_UNLOAD_SECONDS` | `600` | 空闲卸载触发阈值；`<=0` 关闭 |
| `YOLO_IDLE_CHECK_INTERVAL` | `60` | 空闲检查周期(秒) |
| `YOLO_STRICT_OFFLINE` | `0` | 1 时缺权重报 400, 不去 GH download |
| `YOLO_CHECKPOINTS_DIR` | `/app/checkpoints` | 权重落盘位置 |
| `GPU_LIFECYCLE_VERIFY_KEYS_JSON` | 空 | Ed25519 验签公钥 keyring JSON；空值只启用 legacy gate |
| `LOG_LEVEL` | `INFO` | python logging |

## 部署

```bash
# 容器启动
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu-yolo up yolo-backend

# 健康
curl http://localhost:8003/health

# 能力探测
curl http://localhost:8003/setup | jq .

# 离线场景: 先在有网环境预下载
python scripts/download_weights.py --series yolo11
```

## 结果映射

| task | result.type | apps/api Geometry |
|---|---|---|
| detection    | `rectanglelabels` | `bbox` |
| segmentation | `polygonlabels`   | `polygon` |
| keypoint     | `keypointlabels`  | `keypoint`（17 点 COCO） |
| obb          | `rectanglelabels` + `value.rotation` | `rotated_bbox` |

零 adapter——四种 result type 命中 `apps/api/app/services/prediction.py::to_internal_shape` 现有分支（v0.10.28 已就位）。

## 类名

backend 默认输出 ultralytics 内置类名：

- detection / segmentation / keypoint → **COCO-80**（`person`, `car`, ...）
- keypoint → COCO 17 keypoint（hardcoded 顺序见 `predictor.py::COCO_KEYPOINT_NAMES`）
- obb → **DOTA-15**（`plane`, `ship`, `vehicle`, ...）

平台侧 v0.14.11 已经处理 backend 类名与项目 LabelConfig 不匹配的"未匹配分桶"，本 backend 不在协议层做映射。

## 测试

```bash
# 单测（不需 GPU / ultralytics）
cd apps/yolo-backend
uv run pytest tests/ -q

# 端到端冒烟（需 GPU + ultralytics 权重）
# 见 v0.14.12 计划 §6.2
```
