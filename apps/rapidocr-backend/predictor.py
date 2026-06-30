"""rapidocr-backend 推理器：RapidOCR 引擎池 + det/rec/e2e 三能力运行 → 协议 v2 result。

引擎按 ``ResolvedEngine.pool_key``（det+cls+rec 三件套路径）懒加载、LRU 限容。一次调用：
设 use_det/use_cls/use_rec 开关 → 走 RapidOCR 的 load→preprocess→run_ocr_steps→build_final_output。

cls 内化：rec/e2e 内部跑 cls 做 180° 校正，``attributes.orientation`` 取 cls 标签。由于
build_final_output 会按「空文本」过滤 boxes/txts，cls_res 在过滤前快照、按同一 valid 索引对齐。

坐标：RapidOCR 出像素四点框 → 归一化 0-100 百分比的 polygonlabels（与其余 backend 同源）。
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict
from typing import Any

import numpy as np
from rapidocr import OCRVersion, RapidOCR

from catalog import ResolvedEngine

logger = logging.getLogger("rapidocr-backend.predictor")

POLY_LABEL = "text"  # OCR 文本框无类别，用通用占位 label。


def _box_to_points(box: np.ndarray, w: int, h: int) -> list[list[float]]:
    """像素四点 (4,2) → 0-100 百分比 [[x,y],...]。"""
    return [[float(p[0]) / w * 100.0, float(p[1]) / h * 100.0] for p in box]


_FULL_CROP_POLY = [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]]


class RapidOCRPredictor:
    """RapidOCR 引擎池。线程安全（FastAPI 默认单 worker 多线程）。"""

    def __init__(self) -> None:
        self.use_cuda = os.environ.get("RAPIDOCR_DEVICE", "gpu").lower() == "gpu"
        self.pool_cap = int(os.environ.get("RAPIDOCR_POOL_CAP", "3"))
        self._pool: OrderedDict[str, RapidOCR] = OrderedDict()
        self._meta: dict[str, dict[str, Any]] = {}  # pool_key → {loaded_at,last_used,hit}
        self._lock = threading.Lock()

    # ---------------- 引擎池 ----------------
    def _get_engine(self, r: ResolvedEngine) -> RapidOCR:
        key = r.pool_key
        with self._lock:
            eng = self._pool.get(key)
            if eng is not None:
                self._pool.move_to_end(key)
                m = self._meta[key]
                m["last_used"] = time.time()
                m["hit"] += 1
                return eng
        # 构造在锁外（加载耗时），构造后再登记。
        eng = self._construct(r)
        with self._lock:
            self._pool[key] = eng
            self._pool.move_to_end(key)
            self._meta[key] = {"loaded_at": time.time(), "last_used": time.time(), "hit": 1}
            while len(self._pool) > self.pool_cap:
                old_key, _ = self._pool.popitem(last=False)
                self._meta.pop(old_key, None)
                logger.info("pool evict (lru): %s", old_key)
        return eng

    def _construct(self, r: ResolvedEngine) -> RapidOCR:
        # 传 model_path（指定本地权重）+ ocr_version（Enum）+ use_cuda。
        # - cls 输入尺寸由 ocr_version 决定（CLS_SHAPE_BY_OCR_VERSION：PPOCRV5→[3,80,160]，
        #   PPOCRV4→[3,48,192]）；我们的 cls 是 PP-OCRv5 LCNet textline_ori，固定传 PPOCRV5。
        # - det 动态尺寸、rec 读静态 rec_img_shape，均与版本无关，但仍按真实版本传 ocr_version 求稳。
        # - lang_type 不传（onnx 内嵌字符字典，无需 dict 解析；且 v6 rec 的 "multi" 不在 LangRec 枚举里）。
        params = {
            "Global.use_det": True,
            "Global.use_cls": True,
            "Global.use_rec": True,
            "Det.model_path": r.det_path,
            "Det.ocr_version": OCRVersion(r.det_meta[0]),
            "Cls.model_path": r.cls_path,
            "Cls.ocr_version": OCRVersion.PPOCRV5,
            "Rec.model_path": r.rec_path,
            "Rec.ocr_version": OCRVersion(r.rec_meta[0]),
            "EngineConfig.onnxruntime.use_cuda": self.use_cuda,
        }
        logger.info("lazy-load RapidOCR engine cuda=%s key=%s", self.use_cuda, r.pool_key)
        return RapidOCR(params=params)

    # ---------------- 三能力运行 ----------------
    def _run(
        self,
        eng: RapidOCR,
        img_content: str,
        *,
        use_det: bool,
        use_cls: bool,
        use_rec: bool,
        params: dict[str, Any] | None = None,
    ):
        """走 RapidOCR 内部步骤，返回 (ori_img, final_output, orientations)。

        orientations 在 build_final_output 过滤前按 valid 索引快照，与最终 boxes/txts 对齐。

        params（可选，来自 /predict context.params）透传给 update_params，与 RapidOCR.__call__
        同口径的三个运行时阈值；缺省（None）= 引擎默认（text_score/box_thresh≈0.5、unclip≈1.6）。
        """
        p = params or {}

        def _f(key: str) -> float | None:
            v = p.get(key)
            return float(v) if v is not None else None

        eng.update_params(
            use_det=use_det,
            use_cls=use_cls,
            use_rec=use_rec,
            text_score=_f("text_score"),
            box_thresh=_f("box_thresh"),
            unclip_ratio=_f("unclip_ratio"),
        )
        ori = eng.load_img(img_content)
        img, op = eng.preprocess_img(ori)
        det_res, cls_res, rec_res, crops = eng.run_ocr_steps(img, op)

        orientations: list[str] | None = None
        cls_labels = getattr(cls_res, "cls_res", None) if cls_res is not None else None
        if cls_labels is not None:
            if det_res.boxes is not None and rec_res.txts is not None:
                valid = [i for i, t in enumerate(rec_res.txts) if t.strip()]
                orientations = [str(cls_labels[i][0]) for i in valid]
            elif det_res.boxes is None and rec_res.txts is not None:
                orientations = [str(c[0]) for c in cls_labels]  # rec-only：每 crop 一条

        final = eng.build_final_output(ori, det_res, cls_res, rec_res, crops, op)
        return ori, final, orientations

    def det_one(
        self, r: ResolvedEngine, file_path: str, params: dict[str, Any] | None = None
    ) -> tuple[list[dict[str, Any]], int]:
        eng = self._get_engine(r)
        t0 = time.time()
        ori, final, _ = self._run(
            eng, file_path, use_det=True, use_cls=False, use_rec=False, params=params
        )
        infer_ms = int((time.time() - t0) * 1000)
        h, w = ori.shape[:2]
        items: list[dict[str, Any]] = []
        boxes = getattr(final, "boxes", None)
        scores = getattr(final, "scores", None)
        if boxes is not None:
            for i, box in enumerate(boxes):
                items.append({
                    "type": "polygonlabels",
                    "value": {"points": _box_to_points(box, w, h), "polygonlabels": [POLY_LABEL]},
                    "score": float(scores[i]) if scores is not None else 0.0,
                })
        return items, infer_ms

    def rec_one(
        self, r: ResolvedEngine, file_path: str, params: dict[str, Any] | None = None
    ) -> tuple[list[dict[str, Any]], int]:
        eng = self._get_engine(r)
        t0 = time.time()
        _, final, orientations = self._run(
            eng, file_path, use_det=False, use_cls=True, use_rec=True, params=params
        )
        infer_ms = int((time.time() - t0) * 1000)
        txts = getattr(final, "txts", None)
        scores = getattr(final, "scores", None)
        if not txts:
            return [], infer_ms
        # rec 原子吃单 crop：取首条识别结果（整 crop = 一行文本）。
        attrs: dict[str, Any] = {"text": txts[0], "language": r.lang}
        if orientations:
            attrs["orientation"] = orientations[0]
        item = {
            "type": "polygonlabels",
            "value": {"points": _FULL_CROP_POLY, "polygonlabels": [POLY_LABEL]},
            "score": float(scores[0]) if scores else 0.0,
            "attributes": attrs,
        }
        return [item], infer_ms

    def e2e_one(
        self, r: ResolvedEngine, file_path: str, params: dict[str, Any] | None = None
    ) -> tuple[list[dict[str, Any]], int]:
        eng = self._get_engine(r)
        t0 = time.time()
        ori, final, orientations = self._run(
            eng, file_path, use_det=True, use_cls=True, use_rec=True, params=params
        )
        infer_ms = int((time.time() - t0) * 1000)
        h, w = ori.shape[:2]
        items: list[dict[str, Any]] = []
        boxes = getattr(final, "boxes", None)
        txts = getattr(final, "txts", None)
        scores = getattr(final, "scores", None)
        if boxes is None or txts is None:
            return items, infer_ms
        for i, box in enumerate(boxes):
            attrs: dict[str, Any] = {"text": txts[i], "language": r.lang}
            if orientations and i < len(orientations):
                attrs["orientation"] = orientations[i]
            items.append({
                "type": "polygonlabels",
                "value": {"points": _box_to_points(box, w, h), "polygonlabels": [POLY_LABEL]},
                "score": float(scores[i]) if scores is not None else 0.0,
                "attributes": attrs,
            })
        return items, infer_ms

    # ---------------- 观测 ----------------
    def pool_snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "cap": self.pool_cap,
                "current_size": len(self._pool),
                "loaded_keys": list(self._pool.keys()),
            }
