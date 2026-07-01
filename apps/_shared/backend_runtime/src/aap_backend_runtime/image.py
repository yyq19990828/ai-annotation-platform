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
    # 未知 scheme 显式拒绝,恢复抽取前 sam3/grounded-sam2 的 400 语义:让 fall-through 到
    # ``Image.open(file_path)`` 会把 s3://… / ftp://… 等当成本地路径,触发
    # FileNotFoundError/UnidentifiedImageError → FastAPI 500 + 原生 traceback,既丢了
    # 400 语义又可能泄露内部路径。空 scheme 视为本地路径(urlparse("/abs/path").scheme == "")。
    # 调用方可装一个 ``@app.exception_handler(ValueError)`` 把它转成 HTTPException(400)。
    if parsed.scheme and parsed.scheme != "file":
        raise ValueError(f"unsupported file_path scheme: {parsed.scheme}")
    return Image.open(file_path).convert("RGB")
