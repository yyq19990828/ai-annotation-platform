"""图片下载 / 解码 (五 backend 共性叶子函数)。"""

from __future__ import annotations

import io
from base64 import b64decode
from urllib.parse import urlparse
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from PIL.Image import Image


def fetch_image(file_path: str, *, timeout: float = 10.0) -> "Image":
    """统一三种来源加载图片为 RGB ``PIL.Image``。

    支持 ``data:`` base64 / ``http(s)://`` presigned URL / 本地绝对路径 —— 取五个
    backend 各自实现的并集 (yolo/onnxtools 已支持 data:, sam3/gsam2 此前只认 http+本地)。

    Args:
        file_path: 图片来源。
        timeout: http 下载超时 (秒)。

    httpx / PIL 惰性 import: 仅消费 ``versions_payload`` 的 backend (如 rapidocr) 无需装这些。
    """
    from PIL import Image  # noqa: PLC0415

    if file_path.startswith("data:"):
        # data:image/jpeg;base64,XXXX
        _, _, b64 = file_path.partition(",")
        raw = b64decode(b64)
        return Image.open(io.BytesIO(raw)).convert("RGB")
    parsed = urlparse(file_path)
    if parsed.scheme in ("http", "https"):
        import httpx  # noqa: PLC0415

        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(file_path)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
    return Image.open(file_path).convert("RGB")
