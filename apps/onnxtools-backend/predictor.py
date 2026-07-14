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
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import cv2
import numpy as np
from aap_backend_runtime import fetch_image

logger = logging.getLogger("onnxtools-backend.predictor")


def _primary_provider(session: Any) -> str | None:
    """Return an ORT session's current primary provider, or unknown."""
    try:
        providers = session.get_providers()
    except Exception:  # noqa: BLE001
        return None
    if not providers:
        return None
    return str(providers[0])


def _class_name_of(names: Any, cls: int) -> str:
    """从检测器 ``class_names`` 取下标 ``cls`` 的类名，兼容 dict / list 两种载体。

    ``BaseORT.class_names`` 读自 ONNX metadata，是 ``{int: str}`` dict；早先经 pipeline
    ``_resolve_class_names`` 转成 list。原子层直接读 ``detector.class_names``（dict），但保留
    list 兼容以防注入端形态不同。
    """
    if isinstance(names, Mapping):
        return names.get(cls) or names.get(str(cls)) or "unknown"
    if isinstance(names, Sequence) and not isinstance(names, (str, bytes)):
        return names[cls] if 0 <= cls < len(names) else "unknown"
    return "unknown"


def load_image_bgr(file_path: str, *, http_timeout: float = 10.0) -> np.ndarray:
    """加载图像为 BGR ndarray（VehicleAttributePipeline 期望 cv2 BGR 输入）。

    下载/解码（``data:`` base64 / ``http(s)://`` presigned URL / 本地绝对路径）复用共享
    :func:`aap_backend_runtime.fetch_image`（出 RGB ``PIL.Image``）, 再转 cv2 BGR。

    Args:
        file_path: 图像来源。
        http_timeout: http 下载超时（秒）。

    Returns:
        BGR 图像 ndarray [H, W, 3]。
    """
    img = fetch_image(file_path, timeout=http_timeout)
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def classification_to_result(
    vehicle_type: str,
    color: str,
    *,
    vehicle_type_conf: float = 0.0,
    color_conf: float = 0.0,
) -> dict[str, Any]:
    """把纯分类结果(整张输入图 = 一辆车)映射为单条协议 v2 result。

    用于「检测→分类」多阶段编排的下游分类阶段:上游已裁好单车 ROI,本 backend 只跑
    VehicleAttributeORT,跳过 rtdetr 检测。几何取整图框 ——下游阶段的几何会被平台 merge
    丢弃,只取 ``attributes``;``rectanglelabels`` 填车型,便于单 backend 直接调用时仍可读。

    Args:
        vehicle_type: 车型类别 (VEHICLE_TYPE_MAP 的 value)。
        color: 颜色类别 (VEHICLE_COLOR_MAP 的 value)。
        vehicle_type_conf: 车型分类置信度。
        color_conf: 颜色分类置信度。

    Returns:
        单条协议 result (type=rectanglelabels, 整图框 + attributes)。
    """
    return {
        "type": "rectanglelabels",
        "value": {
            "x": 0.0,
            "y": 0.0,
            "width": 100.0,
            "height": 100.0,
            "rectanglelabels": [vehicle_type],
        },
        "score": float(min(vehicle_type_conf, color_conf)),
        "attributes": {"vehicle_type": vehicle_type, "color": color},
    }


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
    """三句柄推理器:detect 原子(RtdetrORT)、classify 原子(VehicleAttributeORT)、
    composite 一锅端(VehicleAttributePipeline),按需懒加载。

    原子层直架单模型推理类(经注入的工厂构造),不再「伸手」借 pipeline 子模型——
    detect-only 部署只加载检测器、classify-only 只加载分类器。composite 路径仍跑
    ``VehicleAttributePipeline``(过渡保留,迟早由平台层编排两原子取代)。

    本类不 import onnxtools:三个句柄由 ``*_factory`` 零参工厂(在 main.py 内 import
    onnxtools 后注入)首调时构造并缓存,故纯映射 + 懒加载逻辑可用 fake 工厂隔离单测。
    """

    def __init__(
        self,
        *,
        detector_factory: Callable[[], Any],
        va_factory: Callable[[], Any],
        pipeline_factory: Callable[[], Any],
    ) -> None:
        """Args: 三个零参工厂,分别构造 RtdetrORT / VehicleAttributeORT / VehicleAttributePipeline。"""
        self._detector_factory = detector_factory
        self._va_factory = va_factory
        self._pipeline_factory = pipeline_factory
        self._detector: Any = None
        self._va_classifier: Any = None
        self._pipeline: Any = None

    @property
    def detector(self) -> Any:
        if self._detector is None:
            logger.info("lazy-loading detector (RtdetrORT)")
            self._detector = self._detector_factory()
        return self._detector

    @property
    def va_classifier(self) -> Any:
        if self._va_classifier is None:
            logger.info("lazy-loading va_classifier (VehicleAttributeORT)")
            self._va_classifier = self._va_factory()
        return self._va_classifier

    @property
    def pipeline(self) -> Any:
        if self._pipeline is None:
            logger.info("lazy-loading pipeline (VehicleAttributePipeline)")
            self._pipeline = self._pipeline_factory()
        return self._pipeline

    def loaded_count(self) -> int:
        """当前已加载(非 None)的句柄数,供 /health 与 idle 判定。"""
        return sum(h is not None for h in (self._detector, self._va_classifier, self._pipeline))

    def loaded_handles(self) -> list[str]:
        """已加载句柄名列表 (供 /health.pool.loaded_keys 展示)。"""
        names: list[str] = []
        if self._pipeline is not None:
            names.append("pipeline")
        if self._detector is not None:
            names.append("detector")
        if self._va_classifier is not None:
            names.append("va")
        return names

    def effective_provider(self) -> str | None:
        """Aggregate the actual primary provider of every loaded business session.

        Empty/lazy state, a missing private session handle, or mixed providers is
        reported as unknown instead of guessing from construction preferences.
        """
        sessions: list[Any] = []
        expected_sessions = 0

        detector = self._detector
        if detector is not None:
            expected_sessions += 1
            sessions.append(getattr(detector, "_onnx_session", None))

        va_classifier = self._va_classifier
        if va_classifier is not None:
            expected_sessions += 1
            sessions.append(getattr(va_classifier, "_onnx_session", None))

        pipeline = self._pipeline
        if pipeline is not None:
            expected_sessions += 2
            pipeline_detector = getattr(pipeline, "detector", None)
            pipeline_va = getattr(pipeline, "va_classifier", None)
            sessions.extend(
                [
                    getattr(pipeline_detector, "_onnx_session", None),
                    getattr(pipeline_va, "_onnx_session", None),
                ]
            )

        if expected_sessions == 0 or len(sessions) != expected_sessions:
            return None
        providers = [_primary_provider(session) for session in sessions if session is not None]
        if len(providers) != expected_sessions or any(provider is None for provider in providers):
            return None
        unique = set(providers)
        return providers[0] if len(unique) == 1 else None

    def warm(self, model_id: str | None) -> bool:
        """按 model_id 触发对应句柄懒加载 (无则预热一锅端 pipeline)。

        返回 cache_hit: True 表示目标句柄此前已加载 (本次未新增)。供 /warmup 响应。
        """
        before = self.loaded_count()
        if model_id == "vehicle-attr-classify":
            _ = self.va_classifier
        elif model_id == "vehicle-detect":
            _ = self.detector
        else:  # 默认 / vehicle-attr → 一锅端 pipeline
            _ = self.pipeline
        return self.loaded_count() == before

    def unload(self) -> int:
        """释放全部已加载句柄,返回释放数(供 /unload 与 idle-unload)。"""
        n = self.loaded_count()
        self._detector = None
        self._va_classifier = None
        self._pipeline = None
        return n

    def predict_one(self, file_path: str) -> tuple[list[dict[str, Any]], int]:
        """一锅端:整跑 composite pipeline(检测→ROI→属性分类)。

        Args:
            file_path: 图像来源（见 :func:`load_image_bgr`）。

        Returns:
            (协议 result 数组, 推理耗时毫秒)。
        """
        img = load_image_bgr(file_path)
        img_h, img_w = img.shape[:2]
        t0 = time.time()
        output = self.pipeline(img)
        infer_ms = int((time.time() - t0) * 1000)
        return detections_to_results(output, img_w, img_h), infer_ms

    def detect_one(self, file_path: str) -> tuple[list[dict[str, Any]], int]:
        """纯检测原子:直跑独立 ``RtdetrORT``,只产检测框,不写 vehicle_type / color 属性。

        用于多阶段编排的上游检测阶段——出框后交给下游纯分类原子补属性。类名取自
        ``detector.class_names``(ONNX metadata),不绕 pipeline。

        Args:
            file_path: 图像来源(见 :func:`load_image_bgr`)。

        Returns:
            (协议 result 数组(纯 bbox, 无 attributes), 推理耗时毫秒)。
        """
        img = load_image_bgr(file_path)
        img_h, img_w = img.shape[:2]
        detector = self.detector
        t0 = time.time()
        result = detector(img)
        infer_ms = int((time.time() - t0) * 1000)
        names = detector.class_names
        output: list[dict[str, Any]] = []
        for i in range(len(result)):
            xyxy = [float(c) for c in result.boxes[i]]
            cls = int(result.class_ids[i])
            output.append(
                {"type": _class_name_of(names, cls), "box2d": xyxy, "score": float(result.scores[i])}
            )
        return detections_to_results(output, img_w, img_h), infer_ms

    def classify_one(self, file_path: str) -> tuple[list[dict[str, Any]], int]:
        """纯分类原子:直跑独立 ``VehicleAttributeORT``,把整张输入图当作一辆车分类。

        用于多阶段编排的下游分类阶段——上游检测器(如 gsam2)已框出并裁好 ROI,
        这里不再重复检测。

        Args:
            file_path: 图像来源(见 :func:`load_image_bgr`)。

        Returns:
            (单元素协议 result 数组, 推理耗时毫秒)。
        """
        img = load_image_bgr(file_path)
        t0 = time.time()
        va = self.va_classifier(img)
        infer_ms = int((time.time() - t0) * 1000)
        item = classification_to_result(
            va.labels[0],
            va.labels[1],
            vehicle_type_conf=float(va.confidences[0]),
            color_conf=float(va.confidences[1]),
        )
        return [item], infer_ms
