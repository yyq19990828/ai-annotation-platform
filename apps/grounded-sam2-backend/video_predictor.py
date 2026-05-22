"""SAM 2.1 video tracker 推理封装 (v0.10.35 §B).

平行于 predictor.py 的图片栈, 但走 **video** 入口:
    build_sam2_video_predictor (vendor/grounded-sam-2/sam2/build_sam.py:100)
      → SAM2VideoPredictor.init_state / add_new_points_or_box / propagate_in_video

权重独立: 与图片 `build_sam2` + `SAM2ImagePredictor` 不共享实例 (各自一份显存),
由 video_pool.py 管理 (平行于 model_pool.py, 不挤占图片池预算)。

协议契约 (apps/api video_tracker_adapters.MLBackendVideoTrackerAdapter):
    请求 context: {type:"video_tracker", from_frame, to_frame, direction,
                   prompt, source_geometry, model_key, ...}
    seed bbox 取自 prompt.geometry / source_geometry 的归一化 {x,y,w,h} (0-1)。
    响应 result 每条: {frame_index(源帧号), geometry:{type:"bbox",x,y,w,h},
                        confidence, outside}, x/y/w/h 归一化到 [0,1]。

vendor SAM2 video API 关键事实 (以实际 vendor 代码为准, commit 见 sync_vendor.sh):
  - init_state(video_path, ...): video_path 可为 .mp4 文件 (走 decord) 或
    "<frame_index>.jpg" JPEG 目录 (走 PIL)。一次性把整段加载进显存, **无窗口参数**。
    → 为把单次 init_state 显存/帧数压到 VIDEO_TRACKER_MAX_WINDOW_FRAMES 安全上限,
      我们用 OpenCV (已在镜像内, 不引 decord) 只解码窗内帧到临时 JPEG 目录,
      窗内重编号 0..N-1, 传播完再映射回源帧号。
  - add_new_points_or_box(state, frame_idx, obj_id, box=[x1,y1,x2,y2], normalize_coords=True):
    box 为**像素** xyxy (normalize_coords=True 时内部按 video_W/video_H 归一化)。
  - propagate_in_video(state, start_frame_idx, max_frame_num_to_track, reverse):
    yield (frame_idx, obj_ids, video_res_masks); masks 是原始视频分辨率的 logits
    (shape [num_obj, 1, H, W]), >0 为前景。
  - 会话清理: reset_state(state) 反向清理 + del state + torch.cuda.empty_cache()。

坐标归一化约定照搬 predictor.py: 像素 / (w 或 h), clamp 到 [0,1], 与 _box_to_rect_label 同源。
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
from typing import Any

# 与 predictor.py 一致: 把 vendor 根注入 sys.path 供上游隐式包名解析。
_VENDOR_ROOT = "/app/vendor/grounded-sam-2"
if os.path.isdir(_VENDOR_ROOT) and _VENDOR_ROOT not in sys.path:
    sys.path.insert(0, _VENDOR_ROOT)

import cv2  # opencv-python-headless, 已在镜像内
import numpy as np
import torch

logger = logging.getLogger("grounded-sam2-backend.video")

CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "/app/checkpoints")

# 复用 predictor.py 的 SAM2_CONFIGS (同一 checkpoint 路径; video predictor 走
# build_sam2_video_predictor 这个不同入口, 但 config / 权重文件名相同)。
from predictor import SAM2_CONFIGS  # noqa: E402

# 单次 init_state 安全上限 (帧). 防止超长窗口一次性灌爆显存; main.py 解析 env 注入。
DEFAULT_MAX_WINDOW_FRAMES = int(os.getenv("VIDEO_TRACKER_MAX_WINDOW_FRAMES", "300"))

# 该 obj 的固定 id (单目标传播; 平台一次只跟一个 annotation)。
_OBJ_ID = 1


class SAM2VideoTracker:
    """单容器内 sam_variant 维度的 SAM 2.1 video predictor 封装。

    权重在 __init__ 时 build (冷启 1-3s), 之后每个 job 调 propagate(); 会话状态
    (init_state) 按 job 结束即释放, 模型权重留给下个 job 复用 (由 video_pool 管 LRU)。
    """

    def __init__(
        self,
        sam_variant: str = "tiny",
        *,
        max_window_frames: int = DEFAULT_MAX_WINDOW_FRAMES,
    ) -> None:
        self.sam_variant = sam_variant
        self.max_window_frames = max_window_frames
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self._predictor = self._load_video_predictor()
        # 当前活跃会话数 (0/1; 单 worker 串行, 仅用于 /health 观测)。
        self.active_sessions = 0

    def _load_video_predictor(self):
        from sam2.build_sam import build_sam2_video_predictor  # type: ignore[import-not-found]

        cfg_name, ckpt_name = SAM2_CONFIGS[self.sam_variant]
        ckpt_path = os.path.join(CHECKPOINT_DIR, ckpt_name)
        if not os.path.isfile(ckpt_path):
            # 与图片池一致: checkpoint 未预置交给 main.py 翻成 503。
            raise FileNotFoundError(ckpt_path)
        logger.info("building video predictor variant=%s ckpt=%s", self.sam_variant, ckpt_name)
        return build_sam2_video_predictor(cfg_name, ckpt_path, device=self.device)

    # ---------- 公开接口 ----------

    def propagate(
        self,
        video_path: str,
        from_frame: int,
        to_frame: int,
        direction: str,
        seed_bbox: dict[str, float],
    ) -> list[dict[str, Any]]:
        """在 [from_frame, to_frame] 窗内传播 seed bbox, 返回逐帧 bbox 结果。

        seed_bbox: 归一化 {x, y, w, h} (0-1), 锚在窗首帧 (forward=from_frame,
        backward=to_frame; 与平台 _tracker_windows 的窗口方向一致)。

        返回: [{frame_index(源帧号), geometry:{type:"bbox",x,y,w,h(归一化)},
                confidence, outside}], 含 seed 帧在内的整个窗。
        """
        lo, hi = int(min(from_frame, to_frame)), int(max(from_frame, to_frame))
        span = hi - lo + 1
        if span > self.max_window_frames:
            raise ValueError(
                f"video tracker window {span} frames exceeds "
                f"VIDEO_TRACKER_MAX_WINDOW_FRAMES={self.max_window_frames}"
            )
        reverse = direction == "backward"
        # 窗首帧 (源帧号): forward 从 lo, backward 从 hi。
        seed_src_frame = hi if reverse else lo

        self.active_sessions += 1
        tmp_dir = tempfile.mkdtemp(prefix="sam2vid_")
        inference_state = None
        try:
            # 1) 只解码窗内帧到临时 JPEG 目录, 窗内重编号 0..span-1。
            frame_w, frame_h, local_count = self._extract_window_jpegs(
                video_path, lo, hi, tmp_dir
            )
            if local_count == 0:
                raise ValueError(
                    f"no frames decoded from {video_path[:80]} for window [{lo},{hi}]"
                )

            # 源帧号 → 窗内局部帧号 (0-based)。解码可能因视频实际帧数不足而截断。
            local_seed = seed_src_frame - lo
            local_seed = max(0, min(local_seed, local_count - 1))

            # 2) init_state 加载该窗 JPEG 目录。
            inference_state = self._predictor.init_state(video_path=tmp_dir)

            # 3) 窗首帧加 seed prompt (归一化 → 像素 xyxy)。
            box_px = self._seed_to_pixel_xyxy(seed_bbox, frame_w, frame_h)
            self._predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=local_seed,
                obj_id=_OBJ_ID,
                box=box_px,
                normalize_coords=True,
            )

            # 4) 逐帧传播拿 mask → bbox。
            results: list[dict[str, Any]] = []
            for local_idx, _obj_ids, video_res_masks in self._predictor.propagate_in_video(
                inference_state,
                start_frame_idx=local_seed,
                reverse=reverse,
            ):
                src_idx = int(local_idx) + lo
                mask = self._first_obj_mask(video_res_masks)
                bbox_norm, outside = self._mask_to_bbox_norm(mask, frame_w, frame_h)
                results.append(
                    {
                        "frame_index": src_idx,
                        "geometry": {"type": "bbox", **bbox_norm},
                        "confidence": 0.0 if outside else 1.0,
                        "outside": outside,
                    }
                )
            results.sort(key=lambda r: r["frame_index"], reverse=reverse)
            return results
        finally:
            # 会话状态反向清理 + 释放显存; 模型权重保留供下个 job。
            if inference_state is not None:
                try:
                    self._predictor.reset_state(inference_state)
                except Exception:  # noqa: BLE001
                    logger.exception("reset_state failed; dropping inference_state")
                del inference_state
            self._cleanup_tmp(tmp_dir)
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            self.active_sessions = max(0, self.active_sessions - 1)

    # ---------- 内部工具 ----------

    @staticmethod
    def _extract_window_jpegs(
        video_path: str, lo: int, hi: int, out_dir: str
    ) -> tuple[int, int, int]:
        """用 OpenCV 把源帧 [lo, hi] 解码为 out_dir/<local_idx>.jpg。

        返回 (frame_w, frame_h, 实际写出的帧数)。窗内重编号从 0 起 (vendor JPEG
        loader 要求文件名为 "<int>.jpg" 且按数值排序)。
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"OpenCV cannot open video: {video_path[:80]}")
        try:
            frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
            frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
            # 直接 seek 到窗首帧 (源帧号), 然后顺序读 span 帧。
            cap.set(cv2.CAP_PROP_POS_FRAMES, lo)
            written = 0
            for src in range(lo, hi + 1):
                ok, frame = cap.read()
                if not ok:
                    break  # 视频实际帧数不足, 窗被截断。
                local_idx = src - lo
                # OpenCV 读出 BGR; cv2.imwrite 也期望 BGR, 写盘正确。vendor JPEG
                # loader 再用 PIL.convert("RGB") 读回, 通道顺序由 PIL 处理。
                cv2.imwrite(os.path.join(out_dir, f"{local_idx}.jpg"), frame)
                if frame_w == 0 or frame_h == 0:
                    frame_h, frame_w = frame.shape[:2]
                written += 1
            return frame_w, frame_h, written
        finally:
            cap.release()

    @staticmethod
    def _seed_to_pixel_xyxy(seed_bbox: dict[str, float], w: int, h: int) -> list[float]:
        """归一化 {x,y,w,h} (左上+宽高) → 像素 xyxy。

        与 predictor.predict_bbox 的"归一化 * 宽高"约定同源。
        """
        x = float(seed_bbox.get("x", 0.0))
        y = float(seed_bbox.get("y", 0.0))
        bw = float(seed_bbox.get("w", seed_bbox.get("width", 0.0)))
        bh = float(seed_bbox.get("h", seed_bbox.get("height", 0.0)))
        x1 = x * w
        y1 = y * h
        x2 = (x + bw) * w
        y2 = (y + bh) * h
        return [x1, y1, x2, y2]

    @staticmethod
    def _first_obj_mask(video_res_masks: Any) -> np.ndarray:
        """propagate_in_video 的 video_res_masks: tensor [num_obj, 1, H, W] (logits)。

        单目标传播取第 0 个 obj, 阈值 >0 为前景, 返回 bool HxW numpy。
        """
        m = video_res_masks
        if hasattr(m, "detach"):
            m = m.detach()
        if hasattr(m, "cpu"):
            m = m.cpu()
        arr = np.asarray(m)
        # 展平到 (H, W)
        if arr.ndim == 4:  # (num_obj, 1, H, W)
            arr = arr[:, 0]
        if arr.ndim == 3:  # (num_obj, H, W)
            arr = arr[0]
        return arr > 0.0

    @staticmethod
    def _mask_to_bbox_norm(
        mask: np.ndarray, w: int, h: int
    ) -> tuple[dict[str, float], bool]:
        """mask 外接框 → 归一化 {x,y,w,h}; 空 mask → outside=True (零框)。

        归一化照搬 predictor._box_to_rect_label: 像素 / 宽高, clamp 到 [0,1]。
        """
        ys, xs = np.where(mask)
        if xs.size == 0 or ys.size == 0:
            return {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}, True
        x1, x2 = int(xs.min()), int(xs.max())
        y1, y2 = int(ys.min()), int(ys.max())
        # x2/y2 是包含端点的像素索引, 宽高 +1 像素。
        bw = (x2 - x1 + 1) / w
        bh = (y2 - y1 + 1) / h

        def _clamp(v: float) -> float:
            return max(0.0, min(1.0, v))

        return {
            "x": _clamp(x1 / w),
            "y": _clamp(y1 / h),
            "w": _clamp(bw),
            "h": _clamp(bh),
        }, False

    @staticmethod
    def _cleanup_tmp(tmp_dir: str) -> None:
        import shutil

        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:  # noqa: BLE001
            logger.debug("failed to remove tmp dir %s", tmp_dir)
