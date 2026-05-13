# Base image / 编译工具链与官仓 facebookresearch/sam3/Dockerfile 对齐:
#   - cuda12.6-cudnn-devel (而非 runtime): SAM 3 训练相关算子需 nvcc; 推理 image predictor
#     在某些 CUDA kernel (FlashAttention / custom ops) 上也需现场编译.
#   - gcc-10 / g++-10: 与 CUDA 12.6 兼容性以官仓推荐为准, 升级 vendor commit 时复核.
# torch / torchvision 已由 base image 预装, pyproject.toml 不重复锁.
FROM pytorch/pytorch:2.7.0-cuda12.6-cudnn-devel

ARG USE_CUDA=1
# 覆盖 A100 (8.0) / RTX 30 (8.6) / RTX 40 / Ada (8.9) / H100 (9.0) / H200 (9.0).
# 不包含 7.x (V100/T4) — 路线图明确 SAM 3 不部署在老卡; 4060 显存也吃紧, 走 grounded-sam2.
ARG TORCH_ARCH="8.0;8.6;8.9;9.0"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/.cache/huggingface \
    AM_I_DOCKER=True \
    BUILD_WITH_CUDA=${USE_CUDA} \
    TORCH_CUDA_ARCH_LIST=${TORCH_ARCH} \
    CUDA_HOME=/usr/local/cuda-12.6/ \
    PATH=/usr/local/cuda-12.6/bin:${PATH} \
    LD_LIBRARY_PATH=/usr/local/cuda-12.6/lib64:${LD_LIBRARY_PATH}

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        ninja-build \
        gcc-10 \
        g++-10 \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV CC=gcc-10 \
    CXX=g++-10

# 平台 backend 自身依赖 (不含 torch / torchvision; base image 已锁 2.7.0).
RUN pip install --upgrade "pip" "setuptools>=68" "wheel" && \
    pip install \
        "fastapi>=0.110" \
        "uvicorn[standard]>=0.27" \
        "pydantic>=2.5" \
        "httpx>=0.27" \
        "numpy>=1.26,<3.0" \
        "pillow>=10.0" \
        "opencv-python-headless>=4.9" \
        "shapely>=2.0" \
        "prometheus-client>=0.20" \
        "huggingface_hub>=0.23" \
        "transformers>=4.45" \
        "supervision>=0.21" \
        "pynvml>=11.5" \
        "psutil>=5.9"

# build context 是 apps/ (与 grounded-sam2-backend 一致); 所有 COPY 路径以 apps/ 为根.
# 启动方式: `docker compose --profile gpu-sam3 build sam3-backend`
# 直接 build: `docker build -f apps/sam3-backend/Dockerfile apps/`

# vendor 含上游 facebookresearch/sam3 全树; 通过 scripts/sync_vendor.sh 同步并固定 commit.
COPY sam3-backend/vendor/ ./vendor/
RUN if [ ! -d "vendor/sam3" ] || [ -z "$(ls -A vendor/sam3 2>/dev/null)" ]; then \
        echo "ERROR: vendor/sam3 is empty. Run sam3-backend/scripts/sync_vendor.sh <commit> on host before 'docker build'." >&2; \
        exit 1; \
    fi && \
    pip install --no-build-isolation -e ./vendor/sam3

# 共享 mask_utils 包 (apps/_shared/mask_utils) editable 安装, 与 grounded-sam2-backend 共用.
COPY _shared/mask_utils/ /app/mask_utils/
RUN pip install --no-build-isolation -e /app/mask_utils

COPY sam3-backend/scripts/ ./scripts/
COPY sam3-backend/main.py sam3-backend/predictor.py sam3-backend/schemas.py sam3-backend/embedding_cache.py sam3-backend/observability.py ./
COPY sam3-backend/tests/ ./tests/
RUN mkdir -p /app/checkpoints /app/.cache/huggingface

EXPOSE 8002

# 启动时下载 sam3.1 权重 (gated, 必须 HF_TOKEN), 然后启 uvicorn.
# 已下载会跳过, 失败 fail-fast 避免半残上线.
ENTRYPOINT ["/bin/bash", "-c", "python /app/scripts/download_checkpoints.py && exec uvicorn main:app --host 0.0.0.0 --port 8002 --workers 1"]
