"""SAM 3 PVS (Promptable Visual Segmentation) 视频追踪封装 (v0.21.26 · 阶段 B-pvs).

平行于 multiplex 的 video_predictor.py, 但走 **点/框 seed + memory 传播**(SAM2 式),
而非 text 开集检测:
    build_sam3_video_model → model.tracker (Sam3TrackerPredictor) + 嫁接 detector.backbone
      → init_state → add_new_points_or_box(obj_id, box/points) 逐对象播种
      → propagate_in_video → 每帧逐对象 mask(memory 跨帧跟随)

每个 obj_id 各自 seed, memory 逐对象跨帧跟随, **caller 指定 obj_id = 跨窗稳定身份**
(决策 #7 B-pvs: 分窗时下一窗用上一窗末帧框 + 同一 obj_id 重播种, 身份直接是 caller 账本)。
与 multiplex(text 开集、框不跨帧, 见 video_predictor.py)互补; 权重同 sam3.pt
(图像检测与 PVS tracker 共享 detector backbone, spike 已验加载正常 + 框跨帧传播)。

协议契约 (apps/api 侧后续接入):
    seeds 每条: {obj_id:int, bbox:{x,y,w,h}} 或 {obj_id:int, points:[[x,y,label],...]}, 归一化 [0,1]。
    返回 result 每条: {frame_index(源帧), instance_id(=obj_id), geometry, confidence, outside}。
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

import numpy as np
import torch

# 复用 multiplex 封装里的通用几何/IO 静态工具(抽窗解码、mask→几何、临时目录清理),
# 避免重复实现; 这些与 multiplex 逻辑无关, 纯 OpenCV/几何。
from video_predictor import SAM3MultiplexVideoTracker, _to_numpy

logger = logging.getLogger("sam3-backend.pvs")

CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "/app/checkpoints")
_IMAGE_CKPT = os.path.join(CHECKPOINT_DIR, "sam3.pt")
_BPE_PATH = os.path.join(_VENDOR_ROOT, "sam3/assets/bpe_simple_vocab_16e6.txt.gz")
# 单窗安全上限(帧)。PVS 是 SAM2 式 memory 传播(常驻 = memory bank + 当前帧, 非整窗特征),
# 显存应轻于 multiplex; 但 SAM3 1008² backbone 仍重。默认取 16 与 multiplex 齐, 阶段 B-pvs
# 用真机 VRAM 画像再调。runner 侧仍按 model_key 分窗。
DEFAULT_MAX_WINDOW_FRAMES = int(os.getenv("SAM3_PVS_MAX_WINDOW_FRAMES", "16"))


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))


def _to_np_float(x: Any) -> np.ndarray | None:
    """转 numpy, 先 float() —— PVS tracker 跑 bf16 autocast, 输出是 bfloat16,
    numpy 不支持该 dtype, 直接 np.asarray 会 TypeError。"""
    if x is None:
        return None
    if hasattr(x, "detach"):
        x = x.detach()
    if hasattr(x, "float"):
        x = x.float()
    if hasattr(x, "cpu"):
        x = x.cpu()
    return np.asarray(x)


class SAM3PVSVideoTracker:
    """SAM 3 PVS video predictor 封装(单模型, 无变体维)。

    权重在 __init__ build(冷启数十秒), 之后每个 job 起独立 session(init_state);
    session 结束即 reset_state 释放, 模型权重留给下个 job 复用(由 main.py 持有/idle 卸载)。
    """

    def __init__(
        self, *, max_window_frames: int = DEFAULT_MAX_WINDOW_FRAMES
    ) -> None:
        self.max_window_frames = max_window_frames
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.active_sessions = 0
        self._predictor = self._load_predictor()

    def _load_predictor(self):
        from sam3.model_builder import (  # type: ignore[import-not-found]
            build_sam3_video_model,
        )

        if not os.path.isfile(_IMAGE_CKPT):
            raise FileNotFoundError(_IMAGE_CKPT)
        logger.info("building sam3 PVS video predictor ckpt=%s", _IMAGE_CKPT)
        model = build_sam3_video_model(
            checkpoint_path=_IMAGE_CKPT,
            bpe_path=_BPE_PATH if os.path.isfile(_BPE_PATH) else None,
            # 图像/视频权重同容 sam3.pt, tracker 相关键齐, 但整包含非 tracker 键 →
            # 非严格加载(与官方 notebook 及 multiplex 封装一致)。
            strict_state_dict_loading=False,
        )
        predictor = model.tracker
        # 嫁接 detector 的 backbone 给 tracker(官方 notebook 配方: 二者共享视觉 backbone,
        # build 时 tracker.backbone 被剥离以省显存, 用前接回)。
        predictor.backbone = model.detector.backbone
        return predictor

    # ---------- 公开接口 ----------

    def propagate(
        self,
        video_path: str,
        from_frame: int,
        to_frame: int,
        direction: str,
        seeds: list[dict[str, Any]],
        output_geometry: str = "bbox",
    ) -> list[dict[str, Any]]:
        """在窗内按逐对象 seed(点/框)memory 传播, 返回逐帧逐对象几何。

        seeds: [{obj_id, bbox:{x,y,w,h}} | {obj_id, points:[[x,y,label],...]}], 归一化 [0,1],
               锚在窗首帧(forward=from_frame, backward=to_frame)。
        output_geometry: "polygon"→mask 矢量化多边形; 否则 mask 外接框 bbox。
        """
        if not seeds:
            raise ValueError("sam3 PVS tracker requires at least one seed")
        lo, hi = int(min(from_frame, to_frame)), int(max(from_frame, to_frame))
        span = hi - lo + 1
        if span > self.max_window_frames:
            raise ValueError(
                f"video tracker window {span} frames exceeds "
                f"SAM3_PVS_MAX_WINDOW_FRAMES={self.max_window_frames}"
            )
        reverse = direction == "backward"
        seed_src_frame = hi if reverse else lo

        self.active_sessions += 1
        tmp_dir = tempfile.mkdtemp(prefix="sam3pvs_")
        state = None
        try:
            _fw, _fh, local_count = SAM3MultiplexVideoTracker._extract_window_jpegs(
                video_path, lo, hi, tmp_dir
            )
            if local_count == 0:
                raise ValueError(
                    f"no frames decoded from {video_path[:80]} for window [{lo},{hi}]"
                )
            if seed_src_frame - lo >= local_count:
                raise ValueError(
                    f"seed frame {seed_src_frame} not in decodable range "
                    f"[{lo},{lo + local_count - 1}] (window [{lo},{hi}] decoded only "
                    f"{local_count} frames)"
                )
            local_seed = max(0, min(seed_src_frame - lo, local_count - 1))

            state = self._predictor.init_state(video_path=tmp_dir)
            for seed in seeds:
                self._add_seed(state, local_seed, seed)

            results: list[dict[str, Any]] = []
            for out in self._predictor.propagate_in_video(
                state,
                start_frame_idx=local_seed,
                max_frame_num_to_track=local_count,
                reverse=reverse,
                tqdm_disable=True,
                # 该 sam3 tracker 的 propagate 默认不跑 preflight, 需显式开启把逐对象
                # 临时 seed(temp_output_dict_per_obj)consolidate 进 cond_frame_outputs,
                # 否则报 "No points are provided"。
                propagate_preflight=True,
            ):
                frame_idx, obj_ids, _low, video_masks, obj_scores = out
                local_idx = int(frame_idx)
                if local_idx < 0 or local_idx >= local_count:
                    continue
                src_idx = local_idx + lo
                masks = _to_np_float(video_masks)  # [num_obj,1,H,W] logits (bf16→f32)
                scores = _to_np_float(obj_scores)
                ids = _to_numpy(obj_ids)
                id_list = ids.tolist() if ids is not None else list(obj_ids)
                for i, oid in enumerate(id_list):
                    mask = masks[i, 0] > 0 if masks.ndim == 4 else masks[i] > 0
                    geometry, outside = SAM3MultiplexVideoTracker._mask_geometry(
                        mask, output_geometry
                    )
                    if outside:
                        confidence = 0.0
                    elif scores is not None and i < len(scores):
                        confidence = _sigmoid(float(np.asarray(scores[i]).reshape(-1)[0]))
                    else:
                        confidence = 1.0
                    results.append(
                        {
                            "frame_index": src_idx,
                            "instance_id": str(int(oid)),
                            "geometry": geometry,
                            "confidence": confidence,
                            "outside": outside,
                        }
                    )
            return results
        finally:
            # Sam3TrackerPredictor 无 reset_state; init_state 返回的是普通 dict, 丢引用
            # + empty_cache 即释放其 GPU 张量(会话状态不跨 job 复用)。
            state = None
            SAM3MultiplexVideoTracker._cleanup_tmp(tmp_dir)
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            self.active_sessions = max(0, self.active_sessions - 1)

    # ---------- 内部工具 ----------

    def _add_seed(self, state: Any, frame_idx: int, seed: dict[str, Any]) -> None:
        """把一条 seed(框或点)按 obj_id 加到种子帧。框 = 归一化 xyxy; 点 = 归一化 [x,y]+label。"""
        obj_id = int(seed["obj_id"])
        bbox = seed.get("bbox")
        pts = seed.get("points")
        if not bbox and not pts:
            raise ValueError(f"seed for obj_id={obj_id} has neither bbox nor points")

        box_t = None
        if bbox:
            x = float(bbox.get("x", 0.0))
            y = float(bbox.get("y", 0.0))
            w = float(bbox.get("w", bbox.get("width", 0.0)))
            h = float(bbox.get("h", bbox.get("height", 0.0)))
            box_t = torch.tensor([x, y, x + w, y + h], dtype=torch.float32)

        points_t = None
        labels_t = None
        if pts:
            points_t = torch.tensor(
                [[float(p[0]), float(p[1])] for p in pts], dtype=torch.float32
            )
            labels_t = torch.tensor(
                [int(p[2]) if len(p) > 2 else 1 for p in pts], dtype=torch.int32
            )

        self._predictor.add_new_points_or_box(
            inference_state=state,
            frame_idx=frame_idx,
            obj_id=obj_id,
            points=points_t,
            labels=labels_t,
            box=box_t,
            rel_coordinates=True,
        )
