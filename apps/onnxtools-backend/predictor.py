"""onnxtools-backend 推理 + 结果映射到协议 v2 result types。

二阶段管道(检测 → 机动车 ROI → 车型/颜色)的输出映射到 LabelStudio 风格 result：

- 每个检测 → ``type=rectanglelabels``，``value={x,y,width,height(百分比), rectanglelabels:[det类]}``
- 机动车额外 → ``attributes={vehicle_type, color}``

坐标统一归一化百分比（与平台 / LabelStudio 一致）。VehicleAttributePipeline 出像素
xyxy，这里 / image(W, H) × 100。

本模块不依赖 onnxtools / 协议包，只做纯映射 + 图像解码，便于隔离单测。
"""

from __future__ import annotations

import logging
import time
from base64 import b64decode
from typing import Any
from urllib.parse import urlparse

import cv2
import numpy as np

logger = logging.getLogger("onnxtools-backend.predictor")


def load_image_bgr(file_path: str, *, http_timeout: float = 10.0) -> np.ndarray:
    """加载图像为 BGR ndarray（VehicleAttributePipeline 期望 cv2 BGR 输入）。

    支持 ``data:`` base64 / ``http(s)://`` presigned URL / 本地绝对路径。

    Args:
        file_path: 图像来源。
        http_timeout: http 下载超时（秒）。

    Returns:
        BGR 图像 ndarray [H, W, 3]。

    Raises:
        ValueError: 解码失败时。
    """
    if file_path.startswith("data:"):
        _, _, b64 = file_path.partition(",")
        raw = b64decode(b64)
    else:
        parsed = urlparse(file_path)
        if parsed.scheme in ("http", "https"):
            import httpx  # 延迟导入：纯映射测试无需 httpx

            with httpx.Client(timeout=http_timeout, follow_redirects=True) as client:
                resp = client.get(file_path)
                resp.raise_for_status()
                raw = resp.content
        else:
            with open(file_path, "rb") as f:
                raw = f.read()

    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"failed to decode image: {file_path[:80]}")
    return img


def detections_to_results(output: list[dict[str, Any]], img_w: int, img_h: int) -> list[dict[str, Any]]:
    """把 VehicleAttributePipeline 输出映射为协议 v2 result 数组。

    Args:
        output: pipeline 输出，每项含 ``type`` / ``box2d`` / ``score``，机动车额外含
            ``vehicle_type`` / ``color``。
        img_w: 原图宽（像素），用于归一化。
        img_h: 原图高（像素）。

    Returns:
        协议 result 数组，每项 ``type=rectanglelabels``，机动车带 ``attributes``。
    """
    items: list[dict[str, Any]] = []
    for d in output:
        x1, y1, x2, y2 = d["box2d"]
        item: dict[str, Any] = {
            "type": "rectanglelabels",
            "value": {
                "x": x1 / img_w * 100.0,
                "y": y1 / img_h * 100.0,
                "width": (x2 - x1) / img_w * 100.0,
                "height": (y2 - y1) / img_h * 100.0,
                "rectanglelabels": [d["type"]],
            },
            "score": float(d.get("score", 0.0)),
        }
        if "vehicle_type" in d:
            item["attributes"] = {"vehicle_type": d["vehicle_type"], "color": d["color"]}
        items.append(item)
    return items


class VehicleAttributePredictor:
    """围绕 VehicleAttributePipeline 的薄封装：加载图像 → 推理 → 映射协议 result。"""

    def __init__(self, pipeline: Any) -> None:
        """Args: pipeline: onnxtools.pipeline.VehicleAttributePipeline 实例。"""
        self._pipeline = pipeline

    def predict_one(self, file_path: str) -> tuple[list[dict[str, Any]], int]:
        """对单张图像推理。

        Args:
            file_path: 图像来源（见 :func:`load_image_bgr`）。

        Returns:
            (协议 result 数组, 推理耗时毫秒)。
        """
        img = load_image_bgr(file_path)
        img_h, img_w = img.shape[:2]
        t0 = time.time()
        output = self._pipeline(img)
        infer_ms = int((time.time() - t0) * 1000)
        return detections_to_results(output, img_w, img_h), infer_ms
