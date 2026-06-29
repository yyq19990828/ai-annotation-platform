"""fetch_image: data: base64 与本地路径解码 (http 路径不在单测覆盖, 需真实网络)。"""

from __future__ import annotations

import io
from base64 import b64encode

import pytest

from aap_backend_runtime import fetch_image

Image = pytest.importorskip("PIL.Image")


def _png_bytes(color: tuple[int, int, int] = (10, 20, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 3), color).save(buf, format="PNG")
    return buf.getvalue()


def test_fetch_image_data_uri() -> None:
    data_uri = "data:image/png;base64," + b64encode(_png_bytes()).decode()
    img = fetch_image(data_uri)
    assert img.mode == "RGB"
    assert img.size == (4, 3)


def test_fetch_image_local_path(tmp_path) -> None:
    p = tmp_path / "sample.png"
    p.write_bytes(_png_bytes())
    img = fetch_image(str(p))
    assert img.mode == "RGB"
    assert img.size == (4, 3)


def test_fetch_image_converts_to_rgb(tmp_path) -> None:
    # 灰度图也应统一转成 RGB。
    p = tmp_path / "gray.png"
    buf = io.BytesIO()
    Image.new("L", (2, 2), 128).save(buf, format="PNG")
    p.write_bytes(buf.getvalue())
    img = fetch_image(str(p))
    assert img.mode == "RGB"
