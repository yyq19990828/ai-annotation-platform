# onnxtools-backend

二阶段车辆属性预标注 ML backend（ml-backend 协议 v2.1）：rtdetr 检测 → 对机动车框裁剪
ROI → va 模型出车型（13 类）+ 颜色（11 类）→ 写入框属性。基于 [onnxtools](https://github.com/yyq19990828/onnxtools)
的 `VehicleAttributePipeline`。

与 yolo / gsam2 / sam3 backend 同构（独立 FastAPI 微服务、HTTP 协议），但**单一固定
pipeline、无 variant / pool / warmup** —— 启动时加载一次模型常驻。

## 端点

| 端点 | 说明 |
|------|------|
| `GET /health` | 健康检查（含 `ready`）|
| `GET /setup` | 协议 v2.1 model 目录：单 model `vehicle-attr`（task=detection），自报 `output_attribute_schema`（vehicle_type / color 两个 select，含 options）|
| `GET /versions` | 版本 |
| `POST /predict` | 批量预测，返回 `result[]`：每检测 `rectanglelabels`，机动车带 `attributes{vehicle_type,color}` |

## 标注 schema 约定

- `class_name` = rtdetr 粗检测类（`car`/`truck`/`heavy_truck`/`van`/`bus`/`motorcycle` 等）
- `attributes.vehicle_type` = va 细车型（13 类）、`attributes.color` = va 颜色（11 类）
- 非机动车（pedestrian/plate/…）只出几何，不做属性分类

`output_attribute_schema` 的 options 见 `attribute_schema.py`，value 与 onnxtools 枚举严格对齐。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `ONNXTOOLS_MODEL_DIR` | `/app/models` | 模型目录 |
| `ONNXTOOLS_DET_MODEL` | `rtdetr-2024080100.onnx` | 检测模型文件名 |
| `ONNXTOOLS_VA_MODEL` | `va_260612.onnx` | 车辆属性模型文件名 |
| `ONNXTOOLS_CONF_THRES` | `0.5` | 检测置信度阈值 |

## 模型放置

模型不打进镜像，由 volume 挂载。把两个 onnx 复制到挂载目录：

```bash
mkdir -p apps/onnxtools-backend/models
cp /home/tyjt/Desktop/onnxtools/models/rtdetr-2024080100.onnx apps/onnxtools-backend/models/
cp /home/tyjt/Desktop/onnxtools/models/va_260612.onnx        apps/onnxtools-backend/models/
```

## 起栈（端口 8004，profile `gpu-onnxtools`）

> 前置：`onnxtools` 的 `feat/vehicle-attribute-pipeline` 分支需先推到 GitHub origin
> （Dockerfile 用 `git+https://...@feat/vehicle-attribute-pipeline` 安装）。迭代 onnxtools
> 后改 Dockerfile 的 `@<ref>` 并重新 build。

```bash
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu-onnxtools build onnxtools-backend
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu-onnxtools up -d onnxtools-backend
curl -s localhost:8004/setup | python -m json.tool
```

onnxruntime-gpu 缺 GPU / cuDNN 不匹配时自动 fallback CPU，功能仍可用（仅变慢）。

## 测试

```bash
# 纯映射 + schema 对齐（需带 opencv 的环境，如 onnxtools 的 .venv）
cd apps/onnxtools-backend && pytest tests/ -v
```
