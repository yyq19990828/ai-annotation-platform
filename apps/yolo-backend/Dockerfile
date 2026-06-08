# yolo-backend (v0.14.12) · ultralytics 多任务多系列推理.
# Base 与 grounded-sam2-backend 共用 (本地已缓存, 镜像源 mirror 容易拉到),
# torch 2.3.1 满足 ultralytics 8.4.x 的下限. yolo 不编译 CUDA 扩展, devel 多带的 nvcc
# 用不到但同 base 减镜像层数; 后续若要切 runtime 镜像再单独 PR.
#
# 端口 8003 (compose profile gpu-yolo); 与 grounded-sam2 (8001) / sam3 (8002) 解耦.
FROM pytorch/pytorch:2.3.1-cuda12.1-cudnn8-devel

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # ultralytics 默认会向 settings.yaml / ~/.config/Ultralytics 写遥测开关; 容器内固定目录避免漂移.
    YOLO_CONFIG_DIR=/app/.config/Ultralytics

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# build context 是 apps/ (与 sam3 / gsam2 一致); 所有 COPY 路径以 apps/ 为根.
# 启动方式: `docker compose --profile gpu-yolo build yolo-backend`
# 直接 build: `docker build -f apps/yolo-backend/Dockerfile apps/`

# 共享 protocol_v2 包 (apps/_shared/protocol_v2). yolo / sam3 / gsam2 共用,
# 单一来源避免协议字段在各 backend 之间漂移.
COPY _shared/protocol_v2/ /app/protocol_v2/
RUN pip install --no-build-isolation -e /app/protocol_v2

# 本仓代码 + 测试.
COPY yolo-backend/pyproject.toml ./
RUN pip install --upgrade "pip" "setuptools>=68" "wheel" && \
    pip install --no-build-isolation \
        "fastapi>=0.110" \
        "uvicorn[standard]>=0.27" \
        "pydantic>=2.5" \
        "httpx>=0.27" \
        "numpy>=1.24,<3.0" \
        "pillow>=10.0" \
        "opencv-python-headless>=4.9" \
        "prometheus-client>=0.20" \
        "ultralytics>=8.4.0,<8.5" \
        "pynvml>=11.5" \
        "psutil>=5.9"

COPY yolo-backend/main.py yolo-backend/predictor.py yolo-backend/schemas.py \
     yolo-backend/model_pool.py yolo-backend/model_registry.py \
     yolo-backend/observability.py ./
COPY yolo-backend/scripts/ ./scripts/
COPY yolo-backend/tests/ ./tests/

RUN mkdir -p /app/checkpoints /app/.config/Ultralytics

EXPOSE 8003

# 启动: 不预热, 等首个 /predict 触发 lazy load. /setup 始终可访问.
ENTRYPOINT ["/bin/bash", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8003 --workers 1"]
