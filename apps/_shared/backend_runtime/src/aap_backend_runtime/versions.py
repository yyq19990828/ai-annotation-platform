"""/versions 端点载荷 (五 backend 共性形状)。"""

from __future__ import annotations

from typing import Any


def versions_payload(
    model_version: str, backend_version: str, **extra: Any
) -> dict[str, Any]:
    """统一 ``GET /versions`` 载荷形状。

    ``extra`` 收 backend 特有字段 (如 yolo 的 ``ultralytics`` 版本)。
    """
    return {"versions": [model_version], "backend_version": backend_version, **extra}
