#!/usr/bin/env python3
"""幂等下载 SAM 3.1 checkpoint + config (v0.10.0 / M0).

启动容器时由 Dockerfile ENTRYPOINT 调用; 已下载则跳过, 缺失则从 HuggingFace 拉.
任一文件下载失败则 sys.exit(1) 让容器启动失败 (避免带半残模型上线).

文件清单与 vendor/sam3/sam3/model_builder.py:download_ckpt_from_hf() 一致:
  - facebook/sam3.1/sam3.1_multiplex.pt  (~3.2 GB 权重)
  - facebook/sam3.1/config.json          (模型配置, build_sam3_image_model 需要)

⚠️ facebook/sam3.1 是 gated repo, 必须配置 HF_TOKEN 环境变量并在 HuggingFace 接受 license.
   申请: https://huggingface.co/facebook/sam3.1

为什么不直接靠 vendor 内置 download_ckpt_from_hf?
  - 启动时 fail-fast: HF_TOKEN 缺失 / license 没接受 / 网络不通 → 立刻报错退出, 不让
    uvicorn 起来后第一次 /predict 才挂掉
  - 走 docker volume gsam3_checkpoints 持久化, 避免每次重启重新下 3.2 GB
  - 与 grounded-sam2-backend 的启动脚本风格统一

Env:
    HF_TOKEN              = HuggingFace access token (required)
    CHECKPOINT_DIR        = /app/checkpoints (default)
    SAM3_HF_REPO_ID       = facebook/sam3.1 (default; 改成 facebook/sam3 用旧版 non-multiplex)
    SAM3_CHECKPOINT_FILE  = sam3.1_multiplex.pt (默认; sam3 版用 sam3.pt)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

CHECKPOINT_DIR = Path(os.getenv("CHECKPOINT_DIR", "/app/checkpoints"))
HF_REPO_ID = os.getenv("SAM3_HF_REPO_ID", "facebook/sam3.1")
CHECKPOINT_FILE = os.getenv("SAM3_CHECKPOINT_FILE", "sam3.1_multiplex.pt")
CONFIG_FILE = "config.json"


def _download(target: Path, repo_id: str, filename: str, token: str) -> None:
    if target.exists() and target.stat().st_size > 0:
        print(f"[skip] {target.name} already exists ({target.stat().st_size // 1024} KB)")
        return
    print(f"[download] {repo_id}/{filename} → {target}")
    from huggingface_hub import hf_hub_download

    cached = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=str(target.parent),
        token=token,
    )
    cached_path = Path(cached)
    if cached_path != target:
        cached_path.replace(target)
    print(f"[done] {target} ({target.stat().st_size // 1024} KB)")


def main() -> int:
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not hf_token:
        print(
            f"ERROR: HF_TOKEN is required to download {HF_REPO_ID} (gated repo).\n"
            "       Set HF_TOKEN in your .env and ensure docker-compose injects it,\n"
            f"       and accept the license at https://huggingface.co/{HF_REPO_ID}",
            file=sys.stderr,
        )
        return 1

    plan = [
        (CHECKPOINT_DIR / CHECKPOINT_FILE, HF_REPO_ID, CHECKPOINT_FILE),
        (CHECKPOINT_DIR / CONFIG_FILE,     HF_REPO_ID, CONFIG_FILE),
    ]
    for target, repo_id, filename in plan:
        try:
            _download(target, repo_id, filename, hf_token)
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: failed to fetch {repo_id}/{filename}: {exc}", file=sys.stderr)
            return 1

    print(f"[ok] sam3 checkpoint + config ready in {CHECKPOINT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
