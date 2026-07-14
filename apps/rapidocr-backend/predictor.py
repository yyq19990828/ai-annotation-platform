"""rapidocr-backend 推理器：RapidOCR 引擎池 + det/rec/e2e 三能力运行 → 协议 v2 result。

引擎按 ``ResolvedEngine.pool_key``（det+cls+rec 三件套路径）懒加载、LRU 限容。一次调用：
设 use_det/use_cls/use_rec 开关 → 走 RapidOCR 的 load→preprocess→run_ocr_steps→build_final_output。

cls 内化：rec/e2e 内部跑 cls 做 180° 校正，``attributes.orientation`` 取 cls 标签。
build_final_output 会按「空文本 + text_score 阈值」二次过滤 boxes/txts，因此
orientation 必须**在 build_final_output 之后**按 ``final.txts`` ↔ ``rec_res.txts`` 顺序
游标回填（详见 ``_align_orientations``）。

并发：池化的 ``RapidOCR`` 实例不为并发使用设计 —— ``update_params`` 改阈值 + 之后的
``run_ocr_steps`` 必须串行，否则后请求会覆盖前请求的 text_score/box_thresh/unclip_ratio。
每个 pool_key 配一把 ``threading.Lock``（``self._engine_locks``），整段 update + run +
build 在锁内执行。

坐标：RapidOCR 出像素四点框 → 归一化 0-100 百分比的 polygonlabels（与其余 backend 同源）。
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

import numpy as np
from rapidocr import OCRVersion, RapidOCR

from catalog import RUNTIME_PARAM_DEFAULTS, ResolvedEngine
import catalog as catalog_mod

logger = logging.getLogger("rapidocr-backend.predictor")

POLY_LABEL = "text"  # OCR 文本框无类别，用通用占位 label。
UTC = timezone.utc


def _primary_provider(session: Any) -> str | None:
    """Return an ORT session's current primary provider, or unknown."""
    try:
        providers = session.get_providers()
    except Exception:  # noqa: BLE001
        return None
    if not providers:
        return None
    return str(providers[0])


def _probe_ort_cuda_use() -> bool:
    """功能探测 CUDA 是否真的可用 (不止 ``get_device`` 软检查)，决定 RapidOCR 的 ``use_cuda``。

    RapidOCR 不接受 ``providers`` list，只接受 ``use_cuda`` 布尔。它内部的 CUDA 判定是
    「软」的 (仅 ``onnxruntime.get_device() == "GPU"`` + provider 列出)，驱动 / cuDNN 损坏
    时 ``InferenceSession()`` 仍会抛错 → ``RapidOCR(params)`` 构造硬失败。这里在构造前先
    用一个真实 det 模型文件开 ``CUDAExecutionProvider`` session 做功能探测：能开起来才让
    ``use_cuda=True``，否则降级 CPU。

    探测目标用 catalog SSOT 的默认 det 模型路径 (``catalog.resolve(DET_MODEL_ID, None)``
    取默认 v5-mobile variant 的 det_path)；模型文件不存在 (如启动时未落盘) 则退回软检查，
    不阻塞启动 —— 此路径降级由 RapidOCR 自身 ``use_cuda=False`` 兜底。
    """
    try:
        import onnxruntime  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return False
    if "CUDAExecutionProvider" not in onnxruntime.get_available_providers():
        return False
    probe_path = catalog_mod.resolve(catalog_mod.DET_MODEL_ID, None).det_path
    if not os.path.exists(probe_path):
        # 启动期模型可能尚未落盘：退回软检查 (与 RapidOCR 原判定口径一致)，避免误降级。
        return onnxruntime.get_device() == "GPU"
    try:
        probe_session = onnxruntime.InferenceSession(
            probe_path, providers=["CUDAExecutionProvider"]
        )
        actual = _primary_provider(probe_session)
        if actual == "CUDAExecutionProvider":
            return True
        logger.warning(
            "ORT CUDA 探测 session 已静默退回 %s；rapidocr 改用 CPU",
            actual or "unknown provider",
        )
        return False
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "ORT CUDA 探测失败 (%s) — CUDA 已列出但不可用 (驱动/cuDNN 不匹配?)，"
            "rapidocr 退回 use_cuda=False (CPU)。", exc,
        )
        return False


def _box_to_points(box: np.ndarray, w: int, h: int) -> list[list[float]]:
    """像素四点 (4,2) → 0-100 百分比 [[x,y],...]。"""
    return [[float(p[0]) / w * 100.0, float(p[1]) / h * 100.0] for p in box]


_FULL_CROP_POLY = [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]]


def _align_orientations(det_res, cls_res, rec_res, final) -> list[str] | None:
    """按 final.txts 与 rec_res.txts 顺序游标回填 orientation。

    RapidOCR 的 ``build_final_output`` 会按「空文本 + text_score 阈值」二次过滤
    boxes/txts;直接按「rec_res.txts 非空」索引快照 cls 标签,在 text_score>0 时会跟
    final.boxes 错位(过滤掉的低分文本对应的方向标签会贴到后一条文本上)。

    本函数在 build_final_output 之后被调用,按 ``final.txts`` 在 ``rec_res.txts``
    中按顺序游标推进 —— build_final_output 保留 rec 原始顺序、不重排,游标推进足以
    把每条 final 文本映射回它在 cls_res.cls_res 里对应的方向标签。

    rec-only 路径(det_res.boxes is None):每 crop 一条 cls 输出,与 final 一一对应。
    """
    cls_labels = getattr(cls_res, "cls_res", None) if cls_res is not None else None
    if cls_labels is None:
        return None

    final_txts = getattr(final, "txts", None)
    if final_txts is None:
        return None

    # rec-only:无 det,每个 crop 单独跑 rec/cls,cls_labels 与 final 同序同长。
    if det_res is None or getattr(det_res, "boxes", None) is None:
        return [str(c[0]) for c in cls_labels]

    rec_txts = getattr(rec_res, "txts", None) if rec_res is not None else None
    if rec_txts is None:
        return None

    orientations: list[str] = []
    cursor = 0
    for ft in final_txts:
        # build_final_output 保留 rec 原始顺序,这里按顺序游标推进:对每条 final 文本,
        # 在 rec_txts 中向前找到第一条与之相等的位置,取该位置的 cls 标签。
        while cursor < len(rec_txts) and rec_txts[cursor] != ft:
            cursor += 1
        if cursor >= len(rec_txts) or cursor >= len(cls_labels):
            return None  # 异常:final 出现 rec 之外的文本,放弃回填避免误标。
        orientations.append(str(cls_labels[cursor][0]))
        cursor += 1
    return orientations


class RapidOCRPredictor:
    """RapidOCR 引擎池。

    每个池化引擎一把 per-key 互斥锁:`update_params` 改阈值 + 之后的 `load_img` /
    `run_ocr_steps` 必须串行,否则两个并发请求落同一 variant 时,后请求会覆盖前请求的
    `text_score` / `box_thresh` / `unclip_ratio`,前请求实际跑错阈值。RapidOCR 内部状态
    本不为并发设计,池层加锁是上层最小可行修补。
    """

    def __init__(self) -> None:
        # 配置层：RAPIDOCR_DEVICE=gpu → 想用 CUDA；cpu → 明确禁用。
        # 功能层：use_cuda 由 _probe_ort_cuda_use() 决定 —— 配置 gpu 但 CUDA 列出不可用
        # 时，这里探测失败即翻 False，避免 RapidOCR(params) 构造硬失败。
        configured = os.environ.get("RAPIDOCR_DEVICE", "gpu").lower() == "gpu"
        self._configured_cuda = configured  # 配置原值，供 /health.configured_device 暴露
        self.use_cuda = _probe_ort_cuda_use() if configured else False
        self.pool_cap = int(os.environ.get("RAPIDOCR_POOL_CAP", "3"))
        self._pool: OrderedDict[str, RapidOCR] = OrderedDict()
        self._meta: dict[str, dict[str, Any]] = {}  # pool_key → {loaded_at,last_used,hit}
        # per-key 引擎使用锁;单独于 self._lock 之外,后者只保护 _pool/_meta dict 本身。
        self._engine_locks: dict[str, threading.Lock] = {}
        self._lock = threading.Lock()

    # ---------------- 引擎池 ----------------
    def _get_engine(self, r: ResolvedEngine) -> tuple[RapidOCR, threading.Lock]:
        """返回 (engine, engine_lock)。调用方必须在 lock 内完成 update_params + run_ocr_steps。"""
        key = r.pool_key
        with self._lock:
            eng = self._pool.get(key)
            if eng is not None:
                self._pool.move_to_end(key)
                m = self._meta[key]
                m["last_used"] = time.time()
                m["hit"] += 1
                return eng, self._engine_locks[key]
        # 构造在锁外（加载耗时），构造后再登记。
        eng = self._construct(r)
        with self._lock:
            self._pool[key] = eng
            self._pool.move_to_end(key)
            self._meta[key] = {"loaded_at": time.time(), "last_used": time.time(), "hit": 1}
            # setdefault 防止并发构造同 key 时拿到两把锁(后者覆盖前者会丢锁)。
            engine_lock = self._engine_locks.setdefault(key, threading.Lock())
            while len(self._pool) > self.pool_cap:
                old_key, _ = self._pool.popitem(last=False)
                self._meta.pop(old_key, None)
                self._engine_locks.pop(old_key, None)
                logger.info("pool evict (lru): %s", old_key)
        return eng, engine_lock

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
        r: ResolvedEngine,
        img_content: str,
        *,
        use_det: bool,
        use_cls: bool,
        use_rec: bool,
        params: dict[str, Any] | None = None,
    ):
        """走 RapidOCR 内部步骤，返回 (ori_img, final_output, orientations)。

        **并发安全**：整段 update_params + load_img + preprocess + run_ocr_steps +
        build_final_output 在 per-key 引擎锁内执行，避免两个并发请求落同一 variant 时，
        后请求覆盖前请求的阈值（text_score / box_thresh / unclip_ratio）。

        **orientation 对齐**：build_final_output 会按「空文本 + text_score 阈值」二次
        过滤 boxes/txts，因此 orientation 必须**在 build_final_output 之后**按
        ``final.txts`` ↔ ``rec_res.txts`` 顺序游标回填，而不是预快照 valid 索引——
        后者只在「仅空文本被过滤」的假设下才对齐，过滤掉低分文本时方向标签会贴错框。

        params（可选，来自 /predict context.params）透传给 update_params，与
        RapidOCR.__call__ 同口径的三个运行时阈值。缺参回落到 RUNTIME_PARAM_DEFAULTS
        并**显式下发**（不传 None）—— det/rec/e2e 同 variant 共享池化引擎，
        update_params 对 None 是跳过不重置，缺参传 None 会让上一次请求的阈值粘在引擎上
        污染后续请求（含跨原子类型、跨项目）。
        """
        p = params or {}

        def _f(key: str) -> float:
            v = p.get(key)
            return float(v) if v is not None else RUNTIME_PARAM_DEFAULTS[key]

        eng, eng_lock = self._get_engine(r)
        with eng_lock:
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
            final = eng.build_final_output(ori, det_res, cls_res, rec_res, crops, op)

        orientations = _align_orientations(det_res, cls_res, rec_res, final)
        return ori, final, orientations

    def det_one(
        self, r: ResolvedEngine, file_path: str, params: dict[str, Any] | None = None
    ) -> tuple[list[dict[str, Any]], int]:
        t0 = time.time()
        ori, final, _ = self._run(
            r, file_path, use_det=True, use_cls=False, use_rec=False, params=params
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
        t0 = time.time()
        _, final, orientations = self._run(
            r, file_path, use_det=False, use_cls=True, use_rec=True, params=params
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
        t0 = time.time()
        ori, final, orientations = self._run(
            r, file_path, use_det=True, use_cls=True, use_rec=True, params=params
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
    def configured_device(self) -> str:
        """配置层设备原值 (RAPIDOCR_DEVICE)，供 /health.compute.configured_device 暴露。"""
        return "cuda" if self._configured_cuda else "cpu"

    def effective_provider(self) -> str | None:
        """汇总当前池内所有 RapidOCR 业务 session 的实际 primary provider。

        空池、任一 det/cls/rec session 无法检查，或 provider 不一致时返回
        ``None``；``use_cuda`` 只是构造偏好，不作为 health 真值。
        """
        with self._lock:
            engines = list(self._pool.values())
        if not engines:
            return None

        providers: list[str] = []
        for engine in engines:
            for component_name in ("text_det", "text_cls", "text_rec"):
                component = getattr(engine, component_name, None)
                wrapper = getattr(component, "session", None)
                session = getattr(wrapper, "session", None)
                provider = _primary_provider(session) if session is not None else None
                if provider is None:
                    return None
                providers.append(provider)
        unique = set(providers)
        return providers[0] if len(unique) == 1 else None

    def pool_snapshot(self) -> dict[str, Any]:
        """协议 §4.3 PoolStatus: loaded_keys 需为 [{key, loaded_at, last_used_at, hit_count}]。"""
        with self._lock:
            loaded_keys = []
            for key in self._pool:
                m = self._meta[key]
                loaded_keys.append({
                    "key": key,
                    "loaded_at": datetime.fromtimestamp(m["loaded_at"], UTC).isoformat(),
                    "last_used_at": datetime.fromtimestamp(m["last_used"], UTC).isoformat(),
                    "hit_count": m["hit"],
                })
            return {
                "cap": self.pool_cap,
                "current_size": len(self._pool),
                "loaded_keys": loaded_keys,
            }
