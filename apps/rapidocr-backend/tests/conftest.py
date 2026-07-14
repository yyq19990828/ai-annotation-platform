"""Small import shim for source tests that do not construct the real RapidOCR package."""

from __future__ import annotations

import sys
import types
from enum import Enum


try:
    import rapidocr as _rapidocr  # noqa: F401
except ImportError:
    fake_rapidocr = types.ModuleType("rapidocr")

    class _OCRVersion(str, Enum):
        PPOCRV5 = "PP-OCRv5"
        PPOCRV6 = "PP-OCRv6"

    class _UnavailableRapidOCR:
        def __init__(self, *args, **kwargs) -> None:
            raise RuntimeError("real RapidOCR is unavailable in this source-test env")

    fake_rapidocr.OCRVersion = _OCRVersion
    fake_rapidocr.RapidOCR = _UnavailableRapidOCR
    sys.modules["rapidocr"] = fake_rapidocr
