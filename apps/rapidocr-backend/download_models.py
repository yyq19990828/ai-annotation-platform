#!/usr/bin/env python3
"""RapidOCR onnx 权重下载器（自包含、幂等、SHA256 校验）。

平台 rapidocr-backend 选用的 13 个 onnx 权重（det 5 + cls 2 + rec 6），来自 RapidOCR
v3.9.0 的 ModelScope 仓库。权重不入 git（见 models/.gitignore）、由本脚本拉到
``models/<版本>/<组件>/<文件>.onnx``、再经 docker-compose bind-mount 注入容器。

能力对应（详见 docs/plans/2026-06-29-v0.20.0-rapidocr-backend.md「锁定模型矩阵」）：
  det  原子（detection）：v5 mobile/server + v6 tiny/small/medium
  cls  内化共享（方向，语言/版本无关）：mobile/server
  rec  原子（ocr）：通用(中英) v5 mobile/server + v6 tiny/small/medium、英文 v5 mobile

用法：
  python3 download_models.py            # 下载缺失/校验失败的；已存在且校验通过的跳过
  python3 download_models.py --force    # 全部重下
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent / "models"

# (版本, 组件, URL, SHA256)。文件名取 URL basename。
MANIFEST: list[tuple[str, str, str, str]] = [
    (
        "PP-OCRv5",
        "det",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx",
        "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae",
    ),
    (
        "PP-OCRv5",
        "det",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_server.onnx",
        "0f8846b1d4bba223a2a2f9d9b44022fbc22cc019051a602b41a7fda9667e4cad",
    ),
    (
        "PP-OCRv5",
        "cls",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv5/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx",
        "54379ae5174d026780215fc748a7f31910dee36818e63d49e17dc598ecc82df7",
    ),
    (
        "PP-OCRv5",
        "cls",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv5/cls/ch_PP-LCNet_x1_0_textline_ori_cls_server.onnx",
        "7d3c02ef6c7da8ae08b4347cc7695b2081aae68c325d64375724ecf39c99e743",
    ),
    (
        "PP-OCRv5",
        "rec",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx",
        "5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5",
    ),
    (
        "PP-OCRv5",
        "rec",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_server.onnx",
        "e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a",
    ),
    (
        "PP-OCRv5",
        "rec",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx",
        "c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8",
    ),
    (
        "PP-OCRv6",
        "det",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx",
        "f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5",
    ),
    (
        "PP-OCRv6",
        "det",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx",
        "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    ),
    (
        "PP-OCRv6",
        "det",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv6/det/PP-OCRv6_det_medium.onnx",
        "92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2",
    ),
    (
        "PP-OCRv6",
        "rec",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx",
        "e16e242de5937ad92609223f19bc2aff3727ee40b095f996907c24749bad251b",
    ),
    (
        "PP-OCRv6",
        "rec",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx",
        "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
    ),
    (
        "PP-OCRv6",
        "rec",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_medium.onnx",
        "eef444829dbbe18d7fea59a3f6eb75647518d2b3a9568d27c92e42940204894b",
    ),
]


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description="下载 RapidOCR onnx 权重")
    ap.add_argument("--force", action="store_true", help="忽略已存在文件，全部重下")
    args = ap.parse_args()

    ok = skipped = 0
    for ver, comp, url, sha in MANIFEST:
        dest = MODELS_DIR / ver / comp / url.rsplit("/", 1)[-1]
        if dest.exists() and not args.force:
            if _sha256(dest) == sha:
                print(f"✓ 跳过（已校验）{dest.relative_to(MODELS_DIR)}")
                skipped += 1
                continue
            print(f"! 校验不符，重下 {dest.relative_to(MODELS_DIR)}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"↓ 下载 {dest.relative_to(MODELS_DIR)} …", flush=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)  # noqa: S310 — 固定可信 ModelScope URL
        got = _sha256(tmp)
        if got != sha:
            tmp.unlink(missing_ok=True)
            print(
                f"✗ SHA256 不符：{dest.name}\n  期望 {sha}\n  实得 {got}",
                file=sys.stderr,
            )
            return 1
        tmp.replace(dest)
        ok += 1

    print(
        f"\n完成：新下 {ok} · 跳过 {skipped} · 共 {len(MANIFEST)} 个权重 → {MODELS_DIR}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
