"""Grounded-SAM-2 推理封装.

vendor 形态: vendor/grounded-sam-2/ 下放上游官方仓库副本 (固定 commit, 通过 scripts/sync_vendor.sh 同步).
本模块只对 vendor 内的 SAM 2.1 image_predictor + GroundingDINO inference utilities 做一层 prompt 适配,
返回平台协议要求的 polygonlabels / rectanglelabels 字典数组.

mask → polygon 简化策略 (M0 inline; M3 抽到 apps/_shared/mask_utils):
    cv2.findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)
    → 取面积最大的外环
    → shapely.simplify(tolerance=1.0, preserve_topology=True)
    → 像素坐标归一化到 [0,1]
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

# vendor 内 grounding_dino/groundingdino/util/inference.py 用 `import grounding_dino.groundingdino...`
# 把 vendor 根当顶层包名 (上游 demo 依赖 cwd 在 sys.path 隐式提供). 我们显式注入.
_VENDOR_ROOT = "/app/vendor/grounded-sam-2"
if os.path.isdir(_VENDOR_ROOT) and _VENDOR_ROOT not in sys.path:
    sys.path.insert(0, _VENDOR_ROOT)

import cv2
import numpy as np
import torch
from PIL import Image
from shapely.geometry import Polygon

logger = logging.getLogger(__name__)

CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "/app/checkpoints")
# config 路径走 hydra `pkg://sam2` search path, 必须带 configs/sam2.1/ 前缀
# (与 vendor 内 grounded_sam2_local_demo.py:20 一致).
SAM2_CONFIGS = {
    "tiny": ("configs/sam2.1/sam2.1_hiera_t.yaml", "sam2.1_hiera_tiny.pt"),
    "small": ("configs/sam2.1/sam2.1_hiera_s.yaml", "sam2.1_hiera_small.pt"),
    "base_plus": ("configs/sam2.1/sam2.1_hiera_b+.yaml", "sam2.1_hiera_base_plus.pt"),
    "large": ("configs/sam2.1/sam2.1_hiera_l.yaml", "sam2.1_hiera_large.pt"),
}
DINO_CONFIGS = {
    "T": ("GroundingDINO_SwinT_OGC.py", "groundingdino_swint_ogc.pth"),
    "B": ("GroundingDINO_SwinB_cogcoor.py", "groundingdino_swinb_cogcoor.pth"),
}


class GroundedSAM2Predictor:
    """三种 prompt 路由到 SAM 2.1 / GroundingDINO; 返回归一化 polygon dict 列表."""

    def __init__(
        self,
        sam_variant: str = "tiny",
        dino_variant: str = "T",
        box_threshold: float = 0.35,
        text_threshold: float = 0.25,
    ) -> None:
        self.sam_variant = sam_variant
        self.dino_variant = dino_variant
        self.box_threshold = box_threshold
        self.text_threshold = text_threshold
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        self._sam_predictor = self._load_sam()
        self._dino_model = self._load_dino()

    # ---------- 模型加载 ----------

    def _load_sam(self):
        from sam2.build_sam import build_sam2  # type: ignore[import-not-found]
        from sam2.sam2_image_predictor import SAM2ImagePredictor  # type: ignore[import-not-found]

        cfg_name, ckpt_name = SAM2_CONFIGS[self.sam_variant]
        ckpt_path = os.path.join(CHECKPOINT_DIR, ckpt_name)
        sam2_model = build_sam2(cfg_name, ckpt_path, device=self.device)
        return SAM2ImagePredictor(sam2_model)

    def _load_dino(self):
        # vendor/grounded-sam-2/ 仓库内 GroundingDINO 通过 grounding_dino 子目录暴露 inference utils.
        from groundingdino.util.inference import load_model  # type: ignore[import-not-found]

        cfg_name, ckpt_name = DINO_CONFIGS[self.dino_variant]
        # 上游 demo 把 config 放到 vendor/grounded-sam-2/grounding_dino/groundingdino/config/ 下;
        # 实际加载路径以 vendor 同步后的目录为准, 通过环境变量可覆盖.
        cfg_path = os.getenv(
            "DINO_CONFIG_PATH",
            f"/app/vendor/grounded-sam-2/grounding_dino/groundingdino/config/{cfg_name}",
        )
        ckpt_path = os.path.join(CHECKPOINT_DIR, ckpt_name)
        return load_model(cfg_path, ckpt_path, device=self.device)

    # ---------- 公开 prompt 接口 ----------

    def predict_point(
        self, image: Image.Image, points: list[list[float]], labels: list[int]
    ) -> list[dict[str, Any]]:
        np_img, w, h = self._to_numpy(image)
        self._sam_predictor.set_image(np_img)
        # 入参 points 假定归一化 [0,1] → 像素
        px = np.array([[p[0] * w, p[1] * h] for p in points], dtype=np.float32)
        lab = np.array(labels, dtype=np.int32)
        masks, scores, _ = self._sam_predictor.predict(
            point_coords=px, point_labels=lab, multimask_output=False
        )
        return self._masks_to_results(masks, scores, w, h)

    def predict_bbox(self, image: Image.Image, bbox: list[float]) -> list[dict[str, Any]]:
        np_img, w, h = self._to_numpy(image)
        self._sam_predictor.set_image(np_img)
        # 入参 bbox=[x1,y1,x2,y2] 假定归一化 [0,1] → 像素
        x1, y1, x2, y2 = bbox
        box_px = np.array([x1 * w, y1 * h, x2 * w, y2 * h], dtype=np.float32)
        masks, scores, _ = self._sam_predictor.predict(
            point_coords=None, point_labels=None, box=box_px[None, :], multimask_output=False
        )
        return self._masks_to_results(masks, scores, w, h)

    def predict_text(self, image: Image.Image, text: str) -> list[dict[str, Any]]:
        from groundingdino.util.inference import predict as dino_predict  # type: ignore[import-not-found]

        np_img, w, h = self._to_numpy(image)
        # GroundingDINO predict() 期望 caption 以 . 结尾的小写短语.
        caption = text.strip().lower()
        if not caption.endswith("."):
            caption = caption + "."
        # vendor 内 inference.predict(model, image_tensor, caption, box_threshold, text_threshold)
        # 返回 boxes(归一化 cxcywh)、logits、phrases.
        from groundingdino.util.inference import load_image  # type: ignore[import-not-found]

        # load_image 需要文件路径; 直接用 numpy → tensor 旁路:
        image_tensor = self._dino_image_tensor(np_img)
        boxes, logits, phrases = dino_predict(
            model=self._dino_model,
            image=image_tensor,
            caption=caption,
            box_threshold=self.box_threshold,
            text_threshold=self.text_threshold,
            device=self.device,
        )
        if boxes is None or len(boxes) == 0:
            logger.info("DINO returned 0 boxes for caption=%r", caption)
            return []

        # 归一化 cxcywh → 像素 xyxy
        boxes_xyxy = self._cxcywh_to_xyxy(boxes.cpu().numpy(), w, h)

        self._sam_predictor.set_image(np_img)
        masks, scores, _ = self._sam_predictor.predict(
            point_coords=None, point_labels=None, box=boxes_xyxy, multimask_output=False
        )
        # masks shape: (N, 1, H, W) 或 (N, H, W); 统一展平
        if masks.ndim == 4:
            masks = masks[:, 0]
        results: list[dict[str, Any]] = []
        for i, mask in enumerate(masks):
            score = float(scores[i] if i < len(scores) else 0.0)
            label = phrases[i] if i < len(phrases) else caption.rstrip(".")
            poly = self._mask_to_polygon(mask, w, h)
            if poly:
                results.append(
                    {
                        "type": "polygonlabels",
                        "value": {"points": poly, "polygonlabels": [label]},
                        "score": score,
                    }
                )
        return results

    # ---------- 内部工具 ----------

    @staticmethod
    def _to_numpy(image: Image.Image) -> tuple[np.ndarray, int, int]:
        arr = np.array(image)  # RGB
        h, w = arr.shape[:2]
        return arr, w, h

    def _dino_image_tensor(self, np_img: np.ndarray) -> torch.Tensor:
        """GroundingDINO 期望 transform 后的 tensor (3,H,W). 复用 vendor 内 transforms."""
        import groundingdino.datasets.transforms as T  # type: ignore[import-not-found]

        transform = T.Compose(
            [
                T.RandomResize([800], max_size=1333),
                T.ToTensor(),
                T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
            ]
        )
        # 上游 transform 接受 (PIL.Image, target=None)
        pil = Image.fromarray(np_img)
        tensor, _ = transform(pil, None)
        return tensor

    @staticmethod
    def _cxcywh_to_xyxy(boxes: np.ndarray, w: int, h: int) -> np.ndarray:
        cx, cy, bw, bh = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        x1 = (cx - bw / 2) * w
        y1 = (cy - bh / 2) * h
        x2 = (cx + bw / 2) * w
        y2 = (cy + bh / 2) * h
        return np.stack([x1, y1, x2, y2], axis=1).astype(np.float32)

    def _masks_to_results(
        self, masks: np.ndarray, scores: np.ndarray | None, w: int, h: int
    ) -> list[dict[str, Any]]:
        if masks.ndim == 4:
            masks = masks[:, 0]
        out: list[dict[str, Any]] = []
        for i, mask in enumerate(masks):
            poly = self._mask_to_polygon(mask, w, h)
            if not poly:
                continue
            score = float(scores[i]) if scores is not None and i < len(scores) else None
            entry: dict[str, Any] = {
                "type": "polygonlabels",
                "value": {"points": poly, "polygonlabels": ["object"]},
            }
            if score is not None:
                entry["score"] = score
            out.append(entry)
        return out

    @staticmethod
    def _mask_to_polygon(
        mask: np.ndarray, w: int, h: int, tolerance: float = 1.0
    ) -> list[list[float]]:
        """二值 mask → 归一化 polygon 顶点列表 (取面积最大的外环)."""
        binary = (mask > 0).astype(np.uint8)
        if binary.sum() == 0:
            return []
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return []
        contour = max(contours, key=cv2.contourArea)
        if len(contour) < 3:
            return []
        coords = [(float(p[0][0]), float(p[0][1])) for p in contour]
        try:
            poly = Polygon(coords)
            if not poly.is_valid:
                poly = poly.buffer(0)
            simplified = poly.simplify(tolerance=tolerance, preserve_topology=True)
            if simplified.is_empty:
                return []
            ext = (
                simplified.exterior
                if simplified.geom_type == "Polygon"
                else max(simplified.geoms, key=lambda g: g.area).exterior
            )
            verts = list(ext.coords)
        except Exception:  # noqa: BLE001 — shapely 偶发拓扑错误降级到原始 contour
            verts = coords
        # 闭环去重 + 归一化
        if verts and verts[0] == verts[-1]:
            verts = verts[:-1]
        return [[round(x / w, 6), round(y / h, 6)] for x, y in verts]
