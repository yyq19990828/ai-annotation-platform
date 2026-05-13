# Base image / 编译工具链对齐 vendor/sam3/README.md (commit 4cbac14):
#   - torch >= 2.7 (vendor README §70 写下限); 选 2.7.1 是该系列最末稳定版
#   - CUDA >= 12.6 (同上下限); 选 12.8 与 vendor 的 cu128 wheel index 对齐
#   - cudnn9-devel (devel 而非 runtime — vendor 某些 CUDA 扩展需 nvcc 现场编译;
#     `cudnn9` 是 cudnn 大版本号必须带的后缀)
# torch / torchvision 已由 base image 预装 (2.7.1 + 对应 torchvision),
# pyproject.toml 不重复锁; 与 grounded-sam2-backend 同款策略.
#
# mirror 注意: 若你的 docker mirror 无该 tag, 备选:
#   - pytorch/pytorch:2.7.1-cuda12.6-cudnn9-devel  (CUDA 12.6 下限)
#   - pytorch/pytorch:2.8.0-cuda12.8-cudnn9-devel  (更新更好, 不一定存在)
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel

ARG USE_CUDA=1
# 覆盖 A100 (8.0) / RTX 30 (8.6) / RTX 40 / Ada (8.9) / H100 / H200 (9.0).
# 不含 7.x (V100/T4) — 路线图明确 SAM 3 不部 4060/老卡; sam3 显存吃紧.
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
    CUDA_HOME=/opt/conda \
    PATH=/opt/conda/bin:${PATH}

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        ninja-build \
        gcc \
        g++ \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 平台 backend 自身依赖 (不含 torch / torchvision; base image 已锁 2.7.1).
# setuptools 锁 <81: 81 起移除 pkg_resources, 而 vendor/sam3/model_builder.py 仍 `import pkg_resources`.
# base image 自带 setuptools 75.8 已满足, 这里不升级即可, 显式上限防止 transient 依赖把它顶上 81+.
RUN pip install --upgrade "pip" "setuptools>=68,<81" "wheel" && \
    pip install \
        "fastapi>=0.110" \
        "uvicorn[standard]>=0.27" \
        "pydantic>=2.5" \
        "httpx>=0.27" \
        "numpy>=1.26,<2.0" \
        "pillow>=10.0" \
        "opencv-python-headless>=4.9" \
        "shapely>=2.0" \
        "prometheus-client>=0.20" \
        "huggingface_hub>=0.23" \
        "transformers>=4.45" \
        "supervision>=0.21" \
        "pynvml>=11.5" \
        "psutil>=5.9" \
        "einops>=0.7" \
        "hydra-core>=1.3" \
        "omegaconf>=2.3" \
        "scipy>=1.11" \
        "scikit-image>=0.22" \
        "scikit-learn>=1.3" \
        "pycocotools>=2.0" \
        "open_clip_torch>=2.24"

# 上面 8 个补丁是 vendor/sam3 在 pyproject 里漏列的运行时 import (grep sam3/ 拿到):
#   einops          — sam3/sam/rope.py 用; SAM 注意力机制必经
#   hydra-core      — sam3 模型构造走 hydra config 系统
#   omegaconf       — hydra 底层 schema; 与 hydra-core 配套
#   scipy / scikit-image / scikit-learn — segmentation 后处理 / 评估指标常用
#   pycocotools     — mask 编解码 (RLE) 工具
#   open_clip_torch — sam3 text encoder backbone
# 如启动时再报新 ModuleNotFoundError, 加到这块 + sync_vendor.sh 升级 commit 时复核.

# build context 是 apps/ (与 grounded-sam2-backend 一致); 所有 COPY 路径以 apps/ 为根.
# 启动方式: `docker compose --profile gpu-sam3 build sam3-backend`
# 直接 build: `docker build -f apps/sam3-backend/Dockerfile apps/`

# vendor 含上游 facebookresearch/sam3 全树 (commit 见 vendor/sam3/.commit);
# 通过 scripts/sync_vendor.sh 同步并固定 commit.
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

# 启动时下载 sam3.1 权重 + config (gated, 必须 HF_TOKEN), 然后启 uvicorn.
# 已下载会跳过, 失败 fail-fast 避免半残上线.
ENTRYPOINT ["/bin/bash", "-c", "python /app/scripts/download_checkpoints.py && exec uvicorn main:app --host 0.0.0.0 --port 8002 --workers 1"]
