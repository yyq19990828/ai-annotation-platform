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

# git: v0.18.21 开集文本模型需 ultralytics CLIP fork (pip git+...); 也作 ultralytics
# 运行时 AutoUpdate 任何 git 依赖的兜底 (无 git 则 set_classes 直接失败).
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        git \
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

# v0.18.21 · 开集文本编码器依赖.
#   - YOLO-World: build_text_model("clip:ViT-B/32") 需 ultralytics CLIP fork (含 ftfy/regex).
#   - YOLOE: 默认走 MobileCLIPTS (TorchScript), 仅需 clip.tokenize + mobileclip_blt.ts 权重,
#     不需要 mobileclip python 包 (实测 8.4.77).
# 烤入 CLIP fork 避免首个文本 /predict 现场 pip 安装 (慢 + 依赖运行时外网/git).
RUN pip install --no-build-isolation "git+https://github.com/ultralytics/CLIP.git"

# 文本编码器权重 (CLIP ViT-B/32 ~338MB + mobileclip_blt.ts ~572MB) 经 ultralytics
# WEIGHTS_DIR 下载. WEIGHTS_DIR = Path(SETTINGS["weights_dir"]) 默认相对 "weights",
# 运行期 cwd=/app → 落 /app/weights (非持久卷, 每次重启重下 900MB). 软链到 checkpoints
# 持久卷子目录, 让相对 "weights" 透明落进卷, 首下后跨重启复用 (不烤 900MB 进镜像层).
RUN ln -sfn /app/checkpoints/weights /app/weights

COPY yolo-backend/main.py yolo-backend/predictor.py yolo-backend/schemas.py \
     yolo-backend/model_pool.py yolo-backend/model_registry.py \
     yolo-backend/observability.py ./
COPY yolo-backend/scripts/ ./scripts/
COPY yolo-backend/tests/ ./tests/

RUN mkdir -p /app/checkpoints /app/.config/Ultralytics

EXPOSE 8003

# 启动: 不预热, 等首个 /predict 触发 lazy load. /setup 始终可访问.
ENTRYPOINT ["/bin/bash", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8003 --workers 1"]
