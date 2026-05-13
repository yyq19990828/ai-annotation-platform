#!/usr/bin/env python3
"""幂等下载 SAM 3.1 checkpoint (v0.10.0 / M0).

启动容器时由 Dockerfile ENTRYPOINT 调用; 已下载则跳过, 缺失则从 HuggingFace 拉.
任一权重下载失败则 sys.exit(1) 让容器启动失败 (避免带半残模型上线).

⚠️ facebook/sam3.1 是 gated repo, 必须配置 HF_TOKEN 环境变量并在 HuggingFace 接受 license.
   申请: https://huggingface.co/facebook/sam3.1

Env:
    HF_TOKEN          = HuggingFace access token (required)
    CHECKPOINT_DIR    = /app/checkpoints (default)
    SAM3_CHECKPOINT_FILE = sam3.1.pt (default; 以官仓 README 实际文件名为准)
    SAM3_HF_REPO_ID   = facebook/sam3.1 (default)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

CHECKPOINT_DIR = Path(os.getenv("CHECKPOINT_DIR", "/app/checkpoints"))
HF_REPO_ID = os.getenv("SAM3_HF_REPO_ID", "facebook/sam3.1")
CHECKPOINT_FILE = os.getenv("SAM3_CHECKPOINT_FILE", "sam3.1.pt")


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
        local_dir_use_symlinks=False,
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
            "ERROR: HF_TOKEN is required to download facebook/sam3.1 (gated repo).\n"
            "       Set HF_TOKEN in your .env and ensure docker-compose injects it,\n"
            "       and accept the license at https://huggingface.co/facebook/sam3.1",
            file=sys.stderr,
        )
        return 1

    target = CHECKPOINT_DIR / CHECKPOINT_FILE
    try:
        _download(target, HF_REPO_ID, CHECKPOINT_FILE, hf_token)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: failed to fetch {HF_REPO_ID}/{CHECKPOINT_FILE}: {exc}", file=sys.stderr)
        return 1

    print(f"[ok] sam3 checkpoint ready in {CHECKPOINT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
