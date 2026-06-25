"""v0.18.22 · 开集文本推理的 output 分支 (box / mask / both) 单测.

不依赖 ultralytics / GPU: 用 fake pool + fake YOLOE 模型 (带 boxes + masks) 注入,
验证 ``_predict_open_text`` 按 ctx.output 取检测框 / 分割多边形 / 两者。
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock

import numpy as np
import pytest

sys.modules.setdefault(
    "torch", MagicMock(cuda=MagicMock(is_available=MagicMock(return_value=False)))
)

import predictor as pred  # noqa: E402
from predictor import YoloPredictor  # noqa: E402
from schemas import Context  # noqa: E402


class _FakeBoxes:
    def __init__(self) -> None:
        self.xyxy = np.array([[10.0, 20.0, 110.0, 220.0]])
        self.conf = np.array([0.9])
        self.cls = np.array([0.0])

    def __len__(self) -> int:
        return 1


class _FakeMasks:
    # ultralytics masks.xy: list[ndarray[N,2]] 像素点列 (一个多边形).
    xy = [np.array([[10.0, 20.0], [110.0, 20.0], [110.0, 220.0], [10.0, 220.0]])]


class _FakeResult:
    def __init__(self, with_mask: bool) -> None:
        self.boxes = _FakeBoxes()
        self.masks = _FakeMasks() if with_mask else None
        self.names = {0: "cat"}


class _FakeYoloe:
    """假 YOLOE: set_classes 后 names 映射到文本类名; predict 出一框 + (可选)一 mask."""

    def __init__(self, with_mask: bool = True) -> None:
        self._with_mask = with_mask
        self.names = {0: "cat"}

    def get_text_pe(self, classes: list[str]):
        return "PE"

    def set_classes(self, classes: list[str], pe=None) -> None:
        self.names = {i: c for i, c in enumerate(classes)}

    def predict(self, img, **kw):
        return [_FakeResult(self._with_mask)]


class _FakePool:
    def __init__(self, model) -> None:
        self._model = model

    async def get(self, task: str, series: str, size: str):
        return self._model, True, None


@pytest.fixture(autouse=True)
def _fake_image(monkeypatch):
    img = MagicMock()
    img.size = (200, 240)  # (W, H)
    monkeypatch.setattr(pred, "_load_image", lambda *a, **k: img)
    return img


def _ctx(output: str, series: str = "yoloe-11"):
    return Context.model_validate({
        "type": "text",
        "text": "cat",
        "output": output,
        "model_variants": {"series": series, "size": "s"},
    })


async def test_output_box_emits_only_rectangles() -> None:
    p = YoloPredictor(_FakePool(_FakeYoloe()))
    items, *_ = await p.predict_one("x", _ctx("box"))
    assert [i["type"] for i in items] == ["rectanglelabels"]
    assert items[0]["value"]["rectanglelabels"] == ["cat"]


async def test_output_mask_emits_only_polygons() -> None:
    p = YoloPredictor(_FakePool(_FakeYoloe()))
    items, *_ = await p.predict_one("x", _ctx("mask"))
    assert [i["type"] for i in items] == ["polygonlabels"]
    assert items[0]["value"]["polygonlabels"] == ["cat"]


async def test_output_both_emits_rectangles_and_polygons() -> None:
    p = YoloPredictor(_FakePool(_FakeYoloe()))
    items, *_ = await p.predict_one("x", _ctx("both"))
    assert {i["type"] for i in items} == {"rectanglelabels", "polygonlabels"}


async def test_world_mask_falls_back_to_box() -> None:
    """world 无分割头: 即便 output=mask 也退回检测框 (family != yoloe)."""
    p = YoloPredictor(_FakePool(_FakeYoloe(with_mask=False)))
    items, *_ = await p.predict_one("x", _ctx("mask", series="yolo-worldv2"))
    assert [i["type"] for i in items] == ["rectanglelabels"]


async def test_empty_text_returns_empty() -> None:
    p = YoloPredictor(_FakePool(_FakeYoloe()))
    ctx = Context.model_validate({
        "type": "text",
        "text": "",
        "output": "mask",
        "model_variants": {"series": "yoloe-11", "size": "s"},
    })
    items, _hit, _load, infer_ms = await p.predict_one("x", ctx)
    assert items == []
    assert infer_ms == 0
