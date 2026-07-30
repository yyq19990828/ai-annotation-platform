# rapidocr-backend · RapidOCR ML backend（OCR：det 原子 + rec 原子 + e2e composite）。
#
# Base 与瘦身后的 onnxtools-backend 共享 nvidia/cuda cudnn9 runtime（见 v0.20.0 plan「镜像 base 决策」）：
# cuda12.8 + cudnn9 满足 onnxruntime-gpu 的 CUDAExecutionProvider，系统 cuDNN 走标准 ldconfig 路径，
# 无需 LD_LIBRARY_PATH hack。RapidOCR 官方 GPU 镜像即同模式（third-party/rapidocr/docker/Dockerfile.onnxruntime-gpu，
# 用 12.4）。应用只在明确设备错误时构造 CPU replacement；显式 CPU 模式不申请 GPU。
#
# 端口 8005（compose profile gpu-rapidocr）；与 gsam2(8001)/sam3(8002)/yolo(8003)/onnxtools(8004) 解耦。
#
# build context 是 apps/（与其余 backend 一致）；所有 COPY 路径以 apps/ 为根。
#   docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu-rapidocr build rapidocr-backend
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# nvidia/cuda base 无 python；装 python3.10(ubuntu22.04 默认) + pip + opencv/pyclipper/shapely 运行/编译库。
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip \
        git curl ca-certificates \
        libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 gcc g++ \
    && rm -rf /var/lib/apt/lists/*

# 先升级构建工具（同 onnxtools：ubuntu 自带 setuptools 59 不支持 PEP 660，src-layout 的 -e 会指错目录）。
RUN python3 -m pip install --upgrade pip "setuptools>=68" wheel

# 共享 protocol_v2 包（apps/_shared/protocol_v2）。与其余 backend 共用，单一来源。
COPY _shared/protocol_v2/ /app/protocol_v2/
RUN python3 -m pip install --no-build-isolation -e /app/protocol_v2

# 共享 backend_runtime 包 (apps/_shared/backend_runtime). 仅消费 versions_payload
# (RapidOCR.load_img 自带下载, 不用 fetch_image)。与其余 backend 单一来源。
COPY _shared/backend_runtime/ /app/backend_runtime/
RUN python3 -m pip install --no-build-isolation -e /app/backend_runtime

# RapidOCR（pin v3.9.0）+ GPU onnxruntime + backend 轻依赖。RapidOCR 拉 opencv_python(全量)，
# 容器无 GUI → 换 opencv-python-headless（仿 RapidOCR 官方 Dockerfile）。
RUN python3 -m pip install "rapidocr==3.9.0" "onnxruntime-gpu==1.23.2" \
        "cryptography>=43.0.0" "PyJWT>=2.10,<3" \
        "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2.5" "httpx>=0.27" "numpy>=1.24,<3.0" "Pillow>=10" \
    && python3 -m pip uninstall -y opencv-python opencv-contrib-python 2>/dev/null; \
       python3 -m pip install "opencv-python-headless>=4.5.1"

COPY rapidocr-backend/main.py rapidocr-backend/predictor.py \
     rapidocr-backend/schemas.py rapidocr-backend/catalog.py \
     rapidocr-backend/engine_pool.py rapidocr-backend/gpu_lifecycle.py ./
COPY rapidocr-backend/scripts/validate_managed_lifecycle.py /app/scripts/

# 模型目录：13 个 onnx 由 bind mount 注入（download_models.py 下载，见 docker-compose.ml.yml）。
RUN mkdir -p /app/models

ENV RAPIDOCR_MODEL_DIR=/app/models \
    RAPIDOCR_DEVICE=gpu

EXPOSE 8005

# 系统 cuDNN/CUDA 在标准 ldconfig 路径，onnxruntime 自动找到 → 无需 LD_LIBRARY_PATH hack。
ENTRYPOINT ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8005", "--workers", "1"]
