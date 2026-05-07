#!/usr/bin/env python3
"""幂等下载 SAM 2.1 + GroundingDINO checkpoints.

启动容器时由 Dockerfile ENTRYPOINT 调用; 已下载的文件跳过, 缺失则从 HuggingFace 拉.
任一权重下载失败则 sys.exit(1) 让容器启动失败 (避免带半残模型上线).

Env:
    SAM_VARIANT   = tiny | small | base_plus | large   (default: tiny)
    DINO_VARIANT  = T | B                              (default: T)
    CHECKPOINT_DIR = /app/checkpoints                  (default)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

CHECKPOINT_DIR = Path(os.getenv("CHECKPOINT_DIR", "/app/checkpoints"))
SAM_VARIANT = os.getenv("SAM_VARIANT", "tiny")
DINO_VARIANT = os.getenv("DINO_VARIANT", "T")

# (filename, hf_repo_id, hf_filename)
SAM2_FILES = {
    "tiny":      ("sam2.1_hiera_tiny.pt",      "facebook/sam2.1-hiera-tiny",      "sam2.1_hiera_tiny.pt"),
    "small":     ("sam2.1_hiera_small.pt",     "facebook/sam2.1-hiera-small",     "sam2.1_hiera_small.pt"),
    "base_plus": ("sam2.1_hiera_base_plus.pt", "facebook/sam2.1-hiera-base-plus", "sam2.1_hiera_base_plus.pt"),
    "large":     ("sam2.1_hiera_large.pt",     "facebook/sam2.1-hiera-large",     "sam2.1_hiera_large.pt"),
}

DINO_FILES = {
    "T": ("groundingdino_swint_ogc.pth",      "ShilongLiu/GroundingDINO", "groundingdino_swint_ogc.pth"),
    "B": ("groundingdino_swinb_cogcoor.pth",  "ShilongLiu/GroundingDINO", "groundingdino_swinb_cogcoor.pth"),
}


def _download(target: Path, repo_id: str, filename: str) -> None:
    if target.exists() and target.stat().st_size > 0:
        print(f"[skip] {target.name} already exists ({target.stat().st_size // 1024} KB)")
        return
    print(f"[download] {repo_id}/{filename} → {target}")
    from huggingface_hub import hf_hub_download

    cached = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=str(target.parent),
        local_dir_use_symlinks=False,
    )
    cached_path = Path(cached)
    if cached_path != target:
        cached_path.replace(target)
    print(f"[done] {target} ({target.stat().st_size // 1024} KB)")


def main() -> int:
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

    if SAM_VARIANT not in SAM2_FILES:
        print(f"ERROR: unknown SAM_VARIANT={SAM_VARIANT}", file=sys.stderr)
        return 1
    if DINO_VARIANT not in DINO_FILES:
        print(f"ERROR: unknown DINO_VARIANT={DINO_VARIANT}", file=sys.stderr)
        return 1

    plan = [
        (CHECKPOINT_DIR / SAM2_FILES[SAM_VARIANT][0], SAM2_FILES[SAM_VARIANT][1], SAM2_FILES[SAM_VARIANT][2]),
        (CHECKPOINT_DIR / DINO_FILES[DINO_VARIANT][0], DINO_FILES[DINO_VARIANT][1], DINO_FILES[DINO_VARIANT][2]),
    ]

    for target, repo_id, filename in plan:
        try:
            _download(target, repo_id, filename)
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: failed to fetch {repo_id}/{filename}: {exc}", file=sys.stderr)
            return 1

    print(f"[ok] checkpoints ready in {CHECKPOINT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
