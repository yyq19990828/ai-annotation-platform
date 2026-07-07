"""SAM 3.1 multiplex video tracker 推理封装 (v0.21.19 §PR3).

平行于 grounded-sam2 的 video_predictor.py, 但走 **text-driven** 视频追踪:
    build_sam3_multiplex_video_predictor
      → handle_request(start_session) / handle_request(add_prompt, text=...)
      → handle_stream_request(propagate_in_video) → 每帧多目标 mask
      → handle_request(close_session)

与 grounded-sam2 的 seed-bbox 传播不同: SAM3 按**文本 query** 在每帧检测目标
(multiplex 多目标), 平台首切片按单目标消费——用 seed_bbox 在种子帧挑重叠最大的
目标 obj_id, 跨帧跟随该 obj_id。mask 复用图片栈 mask_to_polygon 矢量化。

协议契约 (apps/api video_tracker_adapters + runner):
    请求 context: {type:"video_tracker", from_frame, to_frame, direction, text,
                   source_geometry(种子几何), output_geometry, ...}
    响应 result 每条: {frame_index(源帧号), geometry:{type:"polygon"|"bbox", ...},
                        confidence, outside}, 坐标归一化到 [0,1]。

显存现实 (单卡 8GB): 图像 sam3.pt(~5.8GB) 与视频 multiplex(~3.2GB) 无法并存,
main.py 采「互斥常驻」——加载视频前先卸载图像模型 (见 _ensure_video_tracker_loaded)。
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
from typing import Any

_VENDOR_ROOT = "/app/vendor/sam3"
if os.path.isdir(_VENDOR_ROOT) and _VENDOR_ROOT not in sys.path:
    sys.path.insert(0, _VENDOR_ROOT)

import cv2  # opencv-python-headless, 已在镜像内
import numpy as np
import torch

from mask_utils.polygon import mask_to_polygon  # 与图片栈共用的 mask→polygon 矢量化

logger = logging.getLogger("sam3-backend.video")

CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "/app/checkpoints")
_VIDEO_CKPT = os.path.join(CHECKPOINT_DIR, "sam3.1_multiplex.pt")
_BPE_PATH = os.path.join(_VENDOR_ROOT, "sam3/assets/bpe_simple_vocab_16e6.txt.gz")
# FlashAttention-3 仅 Hopper(SM90) 优化; 消费级 Ada(4060, SM89) 默认关。可用 env 覆盖。
_USE_FA3 = os.getenv("SAM3_VIDEO_USE_FA3", "0") == "1"
# 单次窗口安全上限 (帧), 防超长窗口灌爆显存。
DEFAULT_MAX_WINDOW_FRAMES = int(os.getenv("SAM3_VIDEO_MAX_WINDOW_FRAMES", "300"))
# mask→polygon 简化容差 (像素), 与图片栈同源默认。
_POLYGON_TOLERANCE = 1.0


class SAM3MultiplexVideoTracker:
    """SAM 3.1 multiplex video predictor 封装 (单模型, 无变体维)。

    权重在 __init__ build (冷启数十秒), 之后每个 job 起独立 session; session 结束即
    close_session 释放, 模型权重留给下个 job 复用 (由 main.py 持有/idle 卸载)。
    """

    def __init__(self, *, use_fa3: bool = _USE_FA3,
                 max_window_frames: int = DEFAULT_MAX_WINDOW_FRAMES) -> None:
        self.max_window_frames = max_window_frames
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.active_sessions = 0
        self._predictor = self._load_predictor(use_fa3)

    def _load_predictor(self, use_fa3: bool):
        from sam3.model_builder import (  # type: ignore[import-not-found]
            build_sam3_multiplex_video_predictor,
        )

        if not os.path.isfile(_VIDEO_CKPT):
            raise FileNotFoundError(_VIDEO_CKPT)
        logger.info("building sam3 multiplex video predictor ckpt=%s use_fa3=%s",
                    _VIDEO_CKPT, use_fa3)
        # max_num_objects / multiplex_count 锁定 16 (checkpoint 按此训练, 调小会
        # state_dict 形状不匹配加载失败)——不暴露为可调项。
        predictor = build_sam3_multiplex_video_predictor(
            checkpoint_path=_VIDEO_CKPT,
            bpe_path=_BPE_PATH if os.path.isfile(_BPE_PATH) else None,
            use_fa3=use_fa3,
            warm_up=False,
        )
        _patch_init_state_kwargs(predictor)
        return predictor

    # ---------- 公开接口 ----------

    def propagate(
        self,
        video_path: str,
        from_frame: int,
        to_frame: int,
        direction: str,
        text: str,
        seed_bbox: dict[str, float] | None = None,
        output_geometry: str = "bbox",
    ) -> list[dict[str, Any]]:
        """在 [from_frame, to_frame] 窗内按 text 检测+追踪目标, 返回逐帧几何。

        text: 文本 query (必填; SAM3 每帧按此检测目标)。
        seed_bbox: 归一化 {x,y,w,h}; 用于在种子帧从 multiplex 多目标里挑目标 obj_id
                   (单目标消费)。None 时取种子帧最高分目标。
        output_geometry: "polygon"→mask 矢量化多边形; 否则 mask 外接框 bbox。
        """
        if not text or not text.strip():
            raise ValueError("sam3_video tracker requires non-empty text query")
        lo, hi = int(min(from_frame, to_frame)), int(max(from_frame, to_frame))
        span = hi - lo + 1
        if span > self.max_window_frames:
            raise ValueError(
                f"video tracker window {span} frames exceeds "
                f"SAM3_VIDEO_MAX_WINDOW_FRAMES={self.max_window_frames}"
            )
        reverse = direction == "backward"
        seed_src_frame = hi if reverse else lo

        self.active_sessions += 1
        tmp_dir = tempfile.mkdtemp(prefix="sam3vid_")
        session_id = None
        try:
            _fw, _fh, local_count = self._extract_window_jpegs(
                video_path, lo, hi, tmp_dir
            )
            if local_count == 0:
                raise ValueError(
                    f"no frames decoded from {video_path[:80]} for window [{lo},{hi}]"
                )
            local_seed = max(0, min(seed_src_frame - lo, local_count - 1))

            session_id = self._predictor.handle_request(
                dict(type="start_session", resource_path=tmp_dir)
            )["session_id"]

            # 种子帧加文本 prompt → multiplex 多目标输出。
            seed_out = self._predictor.handle_request(
                dict(type="add_prompt", session_id=session_id,
                     frame_index=local_seed, text=text.strip())
            )["outputs"]
            target_obj_id = self._pick_target_obj(seed_out, seed_bbox)
            if target_obj_id is None:
                logger.info("sam3_video: text=%r matched no object at seed frame", text)
                return []

            # 收集逐帧输出 (含种子帧)。
            per_frame: dict[int, dict] = {local_seed: seed_out}
            for response in self._predictor.handle_stream_request(
                dict(type="propagate_in_video", session_id=session_id)
            ):
                per_frame[int(response["frame_index"])] = response["outputs"]

            results: list[dict[str, Any]] = []
            for local_idx in sorted(per_frame, reverse=reverse):
                if local_idx < 0 or local_idx >= local_count:
                    continue
                mask = self._obj_mask(per_frame[local_idx], target_obj_id)
                src_idx = local_idx + lo
                if mask is None or not mask.any():
                    results.append({
                        "frame_index": src_idx,
                        "geometry": {"type": output_geometry_type(output_geometry)},
                        "confidence": 0.0,
                        "outside": True,
                    })
                    continue
                geometry, outside = self._mask_geometry(mask, output_geometry)
                results.append({
                    "frame_index": src_idx,
                    "geometry": geometry,
                    "confidence": 0.0 if outside else 1.0,
                    "outside": outside,
                })
            return results
        finally:
            if session_id is not None:
                try:
                    self._predictor.handle_request(
                        dict(type="close_session", session_id=session_id)
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("close_session failed")
            self._cleanup_tmp(tmp_dir)
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            self.active_sessions = max(0, self.active_sessions - 1)

    # ---------- 内部工具 ----------

    @staticmethod
    def _extract_window_jpegs(
        video_path: str, lo: int, hi: int, out_dir: str
    ) -> tuple[int, int, int]:
        """OpenCV 把源帧 [lo,hi] 解码为 out_dir/<local_idx>.jpg (窗内重编号 0..N-1)。"""
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"OpenCV cannot open video: {video_path[:80]}")
        try:
            frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
            frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
            cap.set(cv2.CAP_PROP_POS_FRAMES, lo)
            written = 0
            for src in range(lo, hi + 1):
                ok, frame = cap.read()
                if not ok:
                    break
                cv2.imwrite(os.path.join(out_dir, f"{src - lo}.jpg"), frame)
                if frame_w == 0 or frame_h == 0:
                    frame_h, frame_w = frame.shape[:2]
                written += 1
            return frame_w, frame_h, written
        finally:
            cap.release()

    @staticmethod
    def _obj_mask(outputs: dict, obj_id: int) -> np.ndarray | None:
        """从某帧 multiplex 输出取指定 obj_id 的二值 mask (HxW bool); 无则 None。"""
        obj_ids = _to_numpy(outputs.get("out_obj_ids"))
        masks = _to_numpy(outputs.get("out_binary_masks"))
        if obj_ids is None or masks is None:
            return None
        for idx, oid in enumerate(obj_ids.tolist()):
            if int(oid) == obj_id:
                return masks[idx] > 0
        return None

    @staticmethod
    def _pick_target_obj(outputs: dict, seed_bbox: dict[str, float] | None) -> int | None:
        """种子帧从 multiplex 多目标里挑目标 obj_id。

        有 seed_bbox: 取归一化外接框与 seed_bbox IoU 最大的目标; 无: 取最高分 (或首个)。
        """
        obj_ids = _to_numpy(outputs.get("out_obj_ids"))
        masks = _to_numpy(outputs.get("out_binary_masks"))
        if obj_ids is None or masks is None or len(obj_ids) == 0:
            return None
        probs = _to_numpy(outputs.get("output_probs"))
        if seed_bbox is None or not any(seed_bbox.get(k) for k in ("w", "h")):
            # 无种子: 最高分 / 首个
            if probs is not None and len(probs) == len(obj_ids):
                return int(obj_ids[int(np.argmax(probs))])
            return int(obj_ids[0])
        best_id, best_iou = None, -1.0
        for idx, oid in enumerate(obj_ids.tolist()):
            m = masks[idx] > 0
            if not m.any():
                continue
            iou = _bbox_iou(_mask_bbox_norm(m), seed_bbox)
            if iou > best_iou:
                best_iou, best_id = iou, int(oid)
        if best_id is None:  # 全空 mask, 退最高分
            if probs is not None and len(probs) == len(obj_ids):
                return int(obj_ids[int(np.argmax(probs))])
            return int(obj_ids[0])
        return best_id

    @staticmethod
    def _mask_geometry(mask: np.ndarray, output_geometry: str) -> tuple[dict, bool]:
        """mask → geometry; 空/退化 → outside。"""
        h, w = mask.shape[:2]
        if output_geometry == "polygon":
            points = mask_to_polygon(mask, _POLYGON_TOLERANCE, normalize_to=(w, h))
            if len(points) < 3:
                return {"type": "polygon", "points": []}, True
            return {"type": "polygon", "points": points}, False
        bbox = _mask_bbox_norm(mask)
        if bbox["w"] <= 0 or bbox["h"] <= 0:
            return {"type": "bbox", **bbox}, True
        return {"type": "bbox", **bbox}, False

    @staticmethod
    def _cleanup_tmp(tmp_dir: str) -> None:
        import shutil

        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:  # noqa: BLE001
            logger.debug("failed to remove tmp dir %s", tmp_dir)


def _patch_init_state_kwargs(predictor: Any) -> None:
    """兼容垫片: vendor Sam3BasePredictor.start_session 无条件给 init_state 传
    offload_state_to_cpu / video_loader_type, 但 multiplex 模型的 init_state 签名不收
    (sam3_multiplex_tracking.init_state 只认 resource_path/offload_video_to_cpu/
    async_loading_frames/use_*), 直接调用会 TypeError。包一层按真实签名过滤 kwargs。
    """
    import inspect

    model = getattr(predictor, "model", None)
    if model is None or not hasattr(model, "init_state"):
        return
    orig = model.init_state
    try:
        accepted = set(inspect.signature(orig).parameters)
    except (TypeError, ValueError):
        return
    if any(p in accepted for p in ("kwargs", "args")):
        return  # 已收 **kwargs, 无需过滤

    def _filtered(*args: Any, **kwargs: Any) -> Any:
        return orig(*args, **{k: v for k, v in kwargs.items() if k in accepted})

    model.init_state = _filtered


def output_geometry_type(output_geometry: str) -> str:
    return "polygon" if output_geometry == "polygon" else "bbox"


def _to_numpy(x: Any) -> np.ndarray | None:
    if x is None:
        return None
    if hasattr(x, "detach"):
        x = x.detach()
    if hasattr(x, "cpu"):
        x = x.cpu()
    return np.asarray(x)


def _mask_bbox_norm(mask: np.ndarray) -> dict[str, float]:
    """二值 mask → 归一化外接框 {x,y,w,h}; 空 mask → 零框。"""
    ys, xs = np.where(mask)
    if xs.size == 0 or ys.size == 0:
        return {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
    h, w = mask.shape[:2]
    x1, x2 = int(xs.min()), int(xs.max())
    y1, y2 = int(ys.min()), int(ys.max())

    def _clamp(v: float) -> float:
        return max(0.0, min(1.0, v))

    return {
        "x": _clamp(x1 / w),
        "y": _clamp(y1 / h),
        "w": _clamp((x2 - x1 + 1) / w),
        "h": _clamp((y2 - y1 + 1) / h),
    }


def _bbox_iou(a: dict[str, float], b: dict[str, float]) -> float:
    ax1, ay1 = a["x"], a["y"]
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx1, by1 = b.get("x", 0.0), b.get("y", 0.0)
    bx2 = b.get("x", 0.0) + b.get("w", 0.0)
    by2 = b.get("y", 0.0) + b.get("h", 0.0)
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    union = a["w"] * a["h"] + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0
