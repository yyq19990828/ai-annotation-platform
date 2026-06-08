#!/usr/bin/env python
"""离线预下载脚本. 把指定 (task, series, size) 组合的预训练权重拉到 checkpoints/.

用途: 离线 / 内网部署 (STRICT_OFFLINE=1) 时, 启容器前先在有网环境跑一遍此脚本,
把 .pt 文件落到挂载卷, 容器启动后直接 load 不再走 GH download.

用法:
    # 拉全 36 组合 (~10GB):
    python scripts/download_weights.py --all

    # 拉单个 (yolo11s 检测):
    python scripts/download_weights.py --task detection --series yolo11 --size s

    # 拉一组 series, 全 task / 全 size 子集 (如 v26 全栈):
    python scripts/download_weights.py --series yolo26
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# 让此脚本独立可跑 (不依赖 backend 进程已起).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from model_registry import (  # noqa: E402
    MODEL_MATRIX,
    UnsupportedVariantError,
    iter_supported_combinations,
    resolve_weight_filename,
)


def _download_one(task: str, series: str, size: str, target_dir: Path) -> bool:
    try:
        filename = resolve_weight_filename(task, series, size)
    except UnsupportedVariantError as exc:
        print(f"skip {task}/{series}/{size}: {exc}", file=sys.stderr)
        return False
    weight_path = target_dir / filename
    if weight_path.exists():
        print(f"hit  {filename}")
        return True

    from ultralytics import YOLO  # noqa: PLC0415

    cwd = os.getcwd()
    try:
        os.chdir(target_dir)
        print(f"pull {filename} ...")
        YOLO(filename)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"fail {filename}: {exc}", file=sys.stderr)
        return False
    finally:
        os.chdir(cwd)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=list(MODEL_MATRIX.keys()), default=None)
    parser.add_argument("--series", default=None)
    parser.add_argument("--size", default=None)
    parser.add_argument("--all", action="store_true")
    parser.add_argument(
        "--target-dir",
        default=os.environ.get("YOLO_CHECKPOINTS_DIR", "/app/checkpoints"),
    )
    args = parser.parse_args()

    target_dir = Path(args.target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    combos = iter_supported_combinations()
    if not args.all:
        if args.task:
            combos = [c for c in combos if c[0] == args.task]
        if args.series:
            combos = [c for c in combos if c[1] == args.series]
        if args.size:
            combos = [c for c in combos if c[2] == args.size]

    ok = 0
    for task, series, size in combos:
        if _download_one(task, series, size, target_dir):
            ok += 1
    print(f"done: {ok}/{len(combos)} weights ready in {target_dir}")
    return 0 if ok == len(combos) else 1


if __name__ == "__main__":
    raise SystemExit(main())
