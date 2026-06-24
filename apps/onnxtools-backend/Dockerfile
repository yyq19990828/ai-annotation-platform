# onnxtools-backend · 二阶段车辆属性预标注 (rtdetr 检测 + va 车辆属性).
#
# Base 复用本地已缓存的 pytorch cudnn9 镜像 (省 base 下载): cuda12.8 + cudnn9 满足
# onnxruntime-gpu 1.22 的 GPU 需求 (CUDAExecutionProvider 真正可用; cudnn8 base 会退 CPU).
# onnxtools 用 git 装 main (含 inference extra: onnxruntime-gpu / opencv-contrib / supervision).
# onnxruntime-gpu 缺 GPU 时自动 fallback CPU, 功能仍可用.
#
# 端口 8004 (compose profile gpu-onnxtools); 与 gsam2(8001)/sam3(8002)/yolo(8003) 解耦.
#
# build context 是 apps/ (与其余 backend 一致); 所有 COPY 路径以 apps/ 为根.
#   docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu-onnxtools build onnxtools-backend
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# pytorch base 已自带 python + pip (conda); 仅补 opencv 运行库 + git (pip 装 onnxtools).
RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 共享 protocol_v2 包 (apps/_shared/protocol_v2). 与其余 backend 共用, 单一来源.
COPY _shared/protocol_v2/ /app/protocol_v2/
RUN pip install --no-build-isolation -e /app/protocol_v2

# backend 自身轻依赖 + onnxtools (git 装 main, 带 inference extra: onnxruntime-gpu/opencv/supervision).
# VehicleAttributePipeline 已合入 onnxtools main; 迭代 onnxtools 后重新 build (pip 缓存失效).
RUN pip install --upgrade pip "setuptools>=68" wheel \
    && pip install "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2.5" "httpx>=0.27" "numpy>=1.24,<3.0" \
    && pip install "onnxtools[inference] @ git+https://github.com/yyq19990828/onnxtools.git@main"

COPY onnxtools-backend/main.py onnxtools-backend/predictor.py \
     onnxtools-backend/schemas.py onnxtools-backend/attribute_schema.py ./

# 模型目录: rtdetr-2024080100.onnx + va_260612.onnx 由 volume 挂载注入 (见 docker-compose.ml.yml).
RUN mkdir -p /app/models

EXPOSE 8004

# pytorch base 的 cudnn/cublas 等在 conda site-packages, 不在 onnxruntime 默认查找路径;
# 启动前把 torch 自带的 nvidia 库目录加进 LD_LIBRARY_PATH, 让 onnxruntime CUDAExecutionProvider 可用
# (否则退回 CPU). 缺 GPU 时 onnxruntime 仍自动 fallback CPU, 不受影响.
ENTRYPOINT ["/bin/bash", "-c", "export LD_LIBRARY_PATH=$(ls -d /opt/conda/lib/python3.11/site-packages/nvidia/*/lib 2>/dev/null | tr '\\n' ':')$LD_LIBRARY_PATH; exec uvicorn main:app --host 0.0.0.0 --port 8004 --workers 1"]
