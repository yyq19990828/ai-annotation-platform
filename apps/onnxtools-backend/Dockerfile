# onnxtools-backend · 二阶段车辆属性预标注 (rtdetr 检测 + va 车辆属性).
#
# onnxtools 用 git 安装 (含 inference extra: onnxruntime-gpu / opencv-contrib / supervision).
# onnxruntime-gpu 缺 GPU/cuDNN 时自动 fallback CPUExecutionProvider, 功能仍可用 (仅变慢),
# 所以 cuDNN 版本不严格匹配也能起栈验证.
#
# 端口 8004 (compose profile gpu-onnxtools); 与 gsam2(8001)/sam3(8002)/yolo(8003) 解耦.
#
# build context 是 apps/ (与其余 backend 一致); 所有 COPY 路径以 apps/ 为根.
#   docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu-onnxtools build onnxtools-backend
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3-pip git curl ca-certificates libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

# 共享 protocol_v2 包 (apps/_shared/protocol_v2). 与其余 backend 共用, 单一来源.
COPY _shared/protocol_v2/ /app/protocol_v2/
RUN pip install --no-build-isolation -e /app/protocol_v2

# backend 自身轻依赖 + onnxtools (git, 带 inference extra).
# onnxtools 分支需先推到 origin (github) 才能拉取; 迭代时改 @<ref> 并重 build.
RUN pip install --upgrade pip "setuptools>=68" wheel \
    && pip install "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2.5" "httpx>=0.27" "numpy>=1.24,<3.0" \
    && pip install "onnxtools[inference] @ git+https://github.com/yyq19990828/onnxtools.git@feat/vehicle-attribute-pipeline"

COPY onnxtools-backend/main.py onnxtools-backend/predictor.py \
     onnxtools-backend/schemas.py onnxtools-backend/attribute_schema.py ./

# 模型目录: rtdetr-2024080100.onnx + va_260612.onnx 由 volume 挂载注入 (见 docker-compose.ml.yml).
RUN mkdir -p /app/models

EXPOSE 8004

ENTRYPOINT ["/bin/bash", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8004 --workers 1"]
