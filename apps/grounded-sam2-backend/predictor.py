"""Grounded-SAM-2 推理封装.

vendor 形态: vendor/grounded-sam-2/ 下放上游官方仓库副本 (固定 commit, 通过 scripts/sync_vendor.sh 同步).
本模块只对 vendor 内的 SAM 2.1 image_predictor + GroundingDINO inference utilities 做一层 prompt 适配,
返回平台协议要求的 polygonlabels / rectanglelabels 字典数组.

mask → polygon 简化策略 (v0.9.4 phase 3 起抽到 apps/_shared/mask_utils, 与 v0.10.x sam3-backend 共用):
    cv2.findContours(RETR_EXTERNAL, CHAIN_APPROX_NONE)
    → 取面积最大的外环
    → shapely.simplify(tolerance=DEFAULT_SIMPLIFY_TOLERANCE, preserve_topology=True)
    → 像素坐标归一化到 [0,1] (6 位精度对齐协议)

tolerance 默认值见 DEFAULT_SIMPLIFY_TOLERANCE; 单次请求可由 Context.simplify_tolerance 覆盖.
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

import numpy as np
import torch
from PIL import Image

from embedding_cache import CacheEntry, EmbeddingCache
from mask_utils import mask_to_polygon

logger = logging.getLogger(__name__)

# v0.9.4 phase 3 默认 tolerance (像素). docs/research/13-simplify-tolerance-eval.md
# 跑出来的合理默认 — 50 张 SAM mask 样本 95% 满足 IoU≥0.95, 顶点数中位 ~70.
# 单次请求可由 Context.simplify_tolerance 覆盖.
DEFAULT_SIMPLIFY_TOLERANCE = 1.0

# 顶点数 > 该阈值时 logger.warning, 提示 simplify 没收敛到合理形态 (异常长 contour /
# tolerance 过低). 不影响返回正确性, 仅是运维信号.
VERTEX_COUNT_WARN_THRESHOLD = 200

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
        embedding_cache: EmbeddingCache | None = None,
    ) -> None:
        self.sam_variant = sam_variant
        self.dino_variant = dino_variant
        self.box_threshold = box_threshold
        self.text_threshold = text_threshold
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.embedding_cache = embedding_cache

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

    # ---------- SAM 内部状态 snapshot / restore ----------
    #
    # SAM2ImagePredictor.set_image() 把 image embedding 写到几个实例属性上;
    # 缓存命中时把这些字段写回, 等价于 set_image() 但跳过编码器.
    # 字段名跟随 vendor IDEA-Research/Grounded-SAM-2 (commit b7a9c29) 内的
    # sam2/sam2_image_predictor.py; sync_vendor.sh 升级 commit 时务必跑 5-clicks 集成验收.

    def _snapshot_sam(self, w: int, h: int) -> CacheEntry:
        sp = self._sam_predictor
        orig_hw = sp._orig_hw[0] if isinstance(sp._orig_hw, list) else sp._orig_hw
        return CacheEntry(
            features=sp._features,
            orig_hw=tuple(orig_hw),  # type: ignore[arg-type]
            is_batch=getattr(sp, "_is_batch", False),
            wh=(w, h),
        )

    def _restore_sam(self, entry: CacheEntry) -> None:
        sp = self._sam_predictor
        sp._features = entry.features
        sp._orig_hw = [tuple(entry.orig_hw)]
        sp._is_image_set = True
        if hasattr(sp, "_is_batch"):
            sp._is_batch = entry.is_batch

    # ---------- 公开 prompt 接口 ----------

    def predict_point(
        self,
        image: Image.Image | None,
        points: list[list[float]],
        labels: list[int],
        *,
        cache_key: str | None = None,
        simplify_tolerance: float | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        """返回 (results, cache_hit). image=None 仅在 cache_key 命中时可省."""
        w, h, hit = self._prime_sam(image, cache_key)
        px = np.array([[p[0] * w, p[1] * h] for p in points], dtype=np.float32)
        lab = np.array(labels, dtype=np.int32)
        masks, scores, _ = self._sam_predictor.predict(
            point_coords=px, point_labels=lab, multimask_output=False
        )
        return self._masks_to_results(masks, scores, w, h, simplify_tolerance), hit

    def predict_bbox(
        self,
        image: Image.Image | None,
        bbox: list[float],
        *,
        cache_key: str | None = None,
        simplify_tolerance: float | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        w, h, hit = self._prime_sam(image, cache_key)
        x1, y1, x2, y2 = bbox
        box_px = np.array([x1 * w, y1 * h, x2 * w, y2 * h], dtype=np.float32)
        masks, scores, _ = self._sam_predictor.predict(
            point_coords=None, point_labels=None, box=box_px[None, :], multimask_output=False
        )
        return self._masks_to_results(masks, scores, w, h, simplify_tolerance), hit

    def _prime_sam(
        self, image: Image.Image | None, cache_key: str | None
    ) -> tuple[int, int, bool]:
        """命中: restore state, 返回 (w, h, True). 未命中: set_image + put, 返回 (w, h, False).

        cache_key=None 时绕过缓存(等价 v0.9.0 行为).
        """
        if cache_key and self.embedding_cache is not None:
            entry = self.embedding_cache.get(cache_key)
            if entry is not None:
                self._restore_sam(entry)
                return entry.wh[0], entry.wh[1], True
        if image is None:
            raise ValueError("image is required when cache miss")
        np_img, w, h = self._to_numpy(image)
        self._sam_predictor.set_image(np_img)
        if cache_key and self.embedding_cache is not None:
            self.embedding_cache.put(cache_key, self._snapshot_sam(w, h))
        return w, h, False

    def predict_text(
        self,
        image: Image.Image,
        text: str,
        *,
        output: str = "mask",
        cache_key: str | None = None,
        box_threshold: float | None = None,
        text_threshold: float | None = None,
        simplify_tolerance: float | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        """v0.9.4 phase 2 · output 三分支:
        - "box":  仅 DINO, 跳过 SAM image embedding + mask + 简化, 返回 rectanglelabels
        - "mask": 当前默认行为, DINO + SAM mask → polygon, 返回 polygonlabels
        - "both": 同 instance 配对返回 [rectangle, polygon] 两条 (前端按需消费)

        cache_hit 仅在 mask/both 路径有意义; box 路径恒为 False (不读不写 cache).
        """
        from groundingdino.util.inference import predict as dino_predict  # type: ignore[import-not-found]

        np_img, w, h = self._to_numpy(image)
        # GroundingDINO predict() 期望 caption 以 . 结尾的小写短语.
        caption = text.strip().lower()
        if not caption.endswith("."):
            caption = caption + "."

        image_tensor = self._dino_image_tensor(np_img)
        # v0.9.2 · 项目级阈值 override；缺省回退到 instance 默认值（来自 backend env）
        eff_box = self.box_threshold if box_threshold is None else float(box_threshold)
        eff_text = self.text_threshold if text_threshold is None else float(text_threshold)
        boxes, _, phrases = dino_predict(
            model=self._dino_model,
            image=image_tensor,
            caption=caption,
            box_threshold=eff_box,
            text_threshold=eff_text,
            device=self.device,
        )
        if boxes is None or len(boxes) == 0:
            logger.info("DINO returned 0 boxes for caption=%r", caption)
            return [], False

        # 归一化 cxcywh → 像素 xyxy
        boxes_xyxy = self._cxcywh_to_xyxy(boxes.cpu().numpy(), w, h)
        default_label = caption.rstrip(".")

        # box 模式: DINO 直出, 跳过 SAM 全部步骤, cache 不读不写
        if output == "box":
            results: list[dict[str, Any]] = []
            for i, box_px in enumerate(boxes_xyxy):
                label = phrases[i] if i < len(phrases) else default_label
                results.append(self._box_to_rect_label(box_px, w, h, label, score=1.0))
            return results, False

        # mask / both 共享 SAM image embedding + mask 推理路径.
        # 注意 text 路径 image 永远不为 None(DINO 要原图), 这里不会触发 ValueError.
        hit = False
        if cache_key and self.embedding_cache is not None:
            entry = self.embedding_cache.get(cache_key)
            if entry is not None:
                self._restore_sam(entry)
                hit = True
        if not hit:
            self._sam_predictor.set_image(np_img)
            if cache_key and self.embedding_cache is not None:
                self.embedding_cache.put(cache_key, self._snapshot_sam(w, h))
        masks, scores, _ = self._sam_predictor.predict(
            point_coords=None, point_labels=None, box=boxes_xyxy, multimask_output=False
        )
        # masks shape: (N, 1, H, W) 或 (N, H, W); 统一展平
        if masks.ndim == 4:
            masks = masks[:, 0]

        results = []
        eff_tol = (
            DEFAULT_SIMPLIFY_TOLERANCE if simplify_tolerance is None else float(simplify_tolerance)
        )
        for i, mask in enumerate(masks):
            score = float(scores[i] if i < len(scores) else 0.0)
            label = phrases[i] if i < len(phrases) else default_label
            poly = mask_to_polygon(mask, tolerance=eff_tol, normalize_to=(w, h))
            if not poly:
                continue
            if len(poly) > VERTEX_COUNT_WARN_THRESHOLD:
                logger.warning(
                    "polygon vertex count %d > %d (tolerance=%.2f, mask area=%d, prompt=text)",
                    len(poly),
                    VERTEX_COUNT_WARN_THRESHOLD,
                    eff_tol,
                    int(mask.sum()),
                )
            if output == "both":
                # 配对返回: 同 instance 一对 rect + poly (前端按需选).
                results.append(self._box_to_rect_label(boxes_xyxy[i], w, h, label, score))
                results.append(self._poly_to_polygon_label(poly, label, score))
            else:  # mask
                results.append(self._poly_to_polygon_label(poly, label, score))
        return results, hit

    @staticmethod
    def _box_to_rect_label(
        box_px: np.ndarray | list[float],
        w: int,
        h: int,
        label: str,
        score: float,
    ) -> dict[str, Any]:
        """像素 xyxy → 归一化 [0,1] 的 rectanglelabels 字典 (与 polygonlabels 协议同源).

        x/y 是矩形左上, width/height 也都归一化; 与平台 BboxAnnotation 字段一致.
        """
        x1, y1, x2, y2 = float(box_px[0]), float(box_px[1]), float(box_px[2]), float(box_px[3])
        return {
            "type": "rectanglelabels",
            "value": {
                "x": max(0.0, min(1.0, x1 / w)),
                "y": max(0.0, min(1.0, y1 / h)),
                "width": max(0.0, min(1.0, (x2 - x1) / w)),
                "height": max(0.0, min(1.0, (y2 - y1) / h)),
                "rectanglelabels": [label],
            },
            "score": score,
        }

    @staticmethod
    def _poly_to_polygon_label(
        poly: list[list[float]], label: str, score: float
    ) -> dict[str, Any]:
        return {
            "type": "polygonlabels",
            "value": {"points": poly, "polygonlabels": [label]},
            "score": score,
        }

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
        self,
        masks: np.ndarray,
        scores: np.ndarray | None,
        w: int,
        h: int,
        simplify_tolerance: float | None = None,
    ) -> list[dict[str, Any]]:
        if masks.ndim == 4:
            masks = masks[:, 0]
        out: list[dict[str, Any]] = []
        eff_tol = (
            DEFAULT_SIMPLIFY_TOLERANCE if simplify_tolerance is None else float(simplify_tolerance)
        )
        for i, mask in enumerate(masks):
            poly = mask_to_polygon(mask, tolerance=eff_tol, normalize_to=(w, h))
            if not poly:
                continue
            if len(poly) > VERTEX_COUNT_WARN_THRESHOLD:
                logger.warning(
                    "polygon vertex count %d > %d (tolerance=%.2f, mask area=%d, prompt=point/bbox)",
                    len(poly),
                    VERTEX_COUNT_WARN_THRESHOLD,
                    eff_tol,
                    int(mask.sum()),
                )
            score = float(scores[i]) if scores is not None and i < len(scores) else None
            entry: dict[str, Any] = {
                "type": "polygonlabels",
                "value": {"points": poly, "polygonlabels": ["object"]},
            }
            if score is not None:
                entry["score"] = score
            out.append(entry)
        return out
