"""SAM 3 推理封装 (v0.10.0 / M0).

vendor 形态: vendor/sam3/ 下放上游 facebookresearch/sam3 副本 (固定 commit,
通过 scripts/sync_vendor.sh 同步). 本模块对 vendor 内的 SAM 3 image predictor 做
一层 prompt 适配, 返回平台协议要求的 polygonlabels / rectanglelabels 字典数组.

SAM 3 vs Grounded-SAM-2 推理路径差异:
- text 路径: SAM 3 PCS 单模型一步出 mask, 不再走 DINO → SAM 复合链
- exemplar 路径 (新增): SAM 3 PCS 接受视觉示例 bbox → 全图相似实例 masks
- point / bbox: 与 SAM 2 image predictor 行为对齐

mask → polygon 简化逻辑与 grounded-sam2-backend 共用 apps/_shared/mask_utils,
单一来源避免重写 (v0.9.4 phase 3 抽到 _shared 时就为 v0.10.x 留接口).

⚠️ vendor API 接入提示: facebookresearch/sam3 的具体 Python 入口 (类名 /
build_* 工厂 / 字段命名) 以 sync_vendor.sh 拉到的 commit 为准. 本文件在每个
vendor 调用点都打了 `# vendor:` 注释; 升级 commit 时按注释逐个核对.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

# vendor/sam3/ 内 Python 包通常按 `import sam3` 暴露 (与官仓 facebookresearch/sam3 的
# pyproject 一致). vendor 根写入 sys.path 让 import 走得通; 容器内由 Dockerfile
# `pip install -e ./vendor/sam3` 提供, 本地 pytest 走 conftest 注入.
_VENDOR_ROOT = "/app/vendor/sam3"
if os.path.isdir(_VENDOR_ROOT) and _VENDOR_ROOT not in sys.path:
    sys.path.insert(0, _VENDOR_ROOT)

import numpy as np
import torch
from PIL import Image

from embedding_cache import CacheEntry, EmbeddingCache
from mask_utils import MultiPolygonRing, mask_to_multi_polygon

logger = logging.getLogger(__name__)

# 与 grounded-sam2-backend 一致的默认 simplify tolerance (像素).
DEFAULT_SIMPLIFY_TOLERANCE = 1.0
# polygon 顶点数 > 阈值时 logger.warning, 提示 simplify 没收敛 (运维信号, 非阻塞).
VERTEX_COUNT_WARN_THRESHOLD = 200

CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "/app/checkpoints")
# SAM 3 当前仅一档 848M; 路线图 §1.1 明确. 未来量化版本接入时改这里 + 启动脚本.
MODEL_VARIANT = "sam3.1"
CHECKPOINT_FILE = os.getenv("SAM3_CHECKPOINT_FILE", "sam3.1.pt")

# SAM 3 PCS 推理时 score 过滤阈值 (text / exemplar 路径生效).
# context.score_threshold 可单次覆盖; 缺省时走此环境默认.
DEFAULT_SCORE_THRESHOLD = float(os.getenv("SAM3_SCORE_THRESHOLD", "0.5"))


class SAM3Predictor:
    """四种 prompt 路由到 SAM 3; 返回归一化 polygon / rectangle 字典列表."""

    def __init__(
        self,
        *,
        checkpoint_dir: str = CHECKPOINT_DIR,
        embedding_cache: EmbeddingCache | None = None,
        score_threshold: float = DEFAULT_SCORE_THRESHOLD,
    ) -> None:
        self.checkpoint_dir = checkpoint_dir
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.embedding_cache = embedding_cache
        self.score_threshold = score_threshold

        self._image_predictor = self._load_image_predictor()

    # ---------- 模型加载 ----------

    def _load_image_predictor(self):
        """加载 SAM 3 image predictor (point / bbox / text / exemplar 共享 backbone).

        vendor: facebookresearch/sam3 暴露 `build_sam3_image_model()` 工厂 (路线图 §0.10.0).
        升级 vendor commit 时若工厂签名变, 改这一段即可; 其余调用面走 self._image_predictor
        的方法属性, 命名跟随上游.
        """
        # vendor: from sam3 import build_sam3_image_model  (sync_vendor.sh 拉到 commit 后核对)
        from sam3 import build_sam3_image_model  # type: ignore[import-not-found]

        ckpt_path = os.path.join(self.checkpoint_dir, CHECKPOINT_FILE)
        predictor = build_sam3_image_model(checkpoint=ckpt_path, device=self.device)
        return predictor

    # ---------- SAM 3 内部状态 snapshot / restore ----------
    #
    # 字段名跟随 vendor facebookresearch/sam3 image predictor; sync_vendor.sh 升级 commit
    # 时必须人肉跑 5-clicks 集成验收, 确认这几个属性名未变.

    def _snapshot_sam(self, w: int, h: int) -> CacheEntry:
        sp = self._image_predictor
        # vendor: SAM 3 image predictor 在 set_image() 后把 image features 写到 _features /
        # _orig_hw 等实例属性; 与 SAM 2 设计一脉相承.
        orig_hw = sp._orig_hw[0] if isinstance(sp._orig_hw, list) else sp._orig_hw
        return CacheEntry(
            features=sp._features,
            orig_hw=tuple(orig_hw),  # type: ignore[arg-type]
            is_batch=getattr(sp, "_is_batch", False),
            wh=(w, h),
        )

    def _restore_sam(self, entry: CacheEntry) -> None:
        sp = self._image_predictor
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
        masks, scores, _ = self._image_predictor.predict(
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
        masks, scores, _ = self._image_predictor.predict(
            point_coords=None, point_labels=None, box=box_px[None, :], multimask_output=False
        )
        return self._masks_to_results(masks, scores, w, h, simplify_tolerance), hit

    def predict_text(
        self,
        image: Image.Image,
        text: str,
        *,
        output: str = "mask",
        cache_key: str | None = None,
        simplify_tolerance: float | None = None,
        score_threshold: float | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        """SAM 3 PCS 文本 prompt 单模型一步出 mask (与 grounded-sam2 协议对齐):
        - "box":  仅取 PCS 返回的 boxes, 跳过 mask → polygon 简化, 返回 rectanglelabels
        - "mask": 默认; PCS 返回的 mask → polygon, 返回 polygonlabels
        - "both": 同 instance 配对返回 [rectangle, polygon] 两条

        与 grounded-sam2 的 DINO → SAM 复合不同, SAM 3 PCS 是单 backbone 一次前向,
        但平台对外的 output 形态约定保持一致, 让前端 segmented control 复用.
        """
        w, h, hit = self._prime_sam(image, cache_key)
        eff_score_th = (
            self.score_threshold if score_threshold is None else float(score_threshold)
        )
        # vendor: SAM 3 PCS text prompt 接口签名以 vendor commit 为准. 通常返回
        # masks (N, H, W) + boxes (N, 4) + scores (N,) + labels (N,) 四元组.
        boxes_px, masks, scores, phrases = self._image_predictor.predict_text(
            text=text.strip(),
            score_threshold=eff_score_th,
        )
        if masks is None or len(masks) == 0:
            logger.info("SAM 3 PCS returned 0 instances for text=%r", text)
            return [], hit

        if masks.ndim == 4:
            masks = masks[:, 0]
        default_label = text.strip()

        def _label(i: int) -> str:
            return phrases[i] if phrases is not None and i < len(phrases) else default_label

        def _score(i: int) -> float:
            return float(scores[i]) if scores is not None and i < len(scores) else 0.0

        # box 模式: 跳过 mask → polygon 简化, 直接出 rectanglelabels
        if output == "box":
            return [
                self._box_to_rect_label(boxes_px[i], w, h, _label(i), _score(i))
                for i in range(len(boxes_px))
            ], hit

        eff_tol = (
            DEFAULT_SIMPLIFY_TOLERANCE if simplify_tolerance is None else float(simplify_tolerance)
        )
        results: list[dict[str, Any]] = []
        for i, mask in enumerate(masks):
            label = _label(i)
            score = _score(i)
            rings = mask_to_multi_polygon(mask, tolerance=eff_tol, normalize_to=(w, h))
            if not rings:
                continue
            self._maybe_warn_vertex_count(rings, eff_tol, int(mask.sum()), prompt="text")
            if output == "both":
                results.append(self._box_to_rect_label(boxes_px[i], w, h, label, score))
                results.append(self._rings_to_polygon_label(rings, label, score))
            else:
                results.append(self._rings_to_polygon_label(rings, label, score))
        return results, hit

    def predict_exemplar(
        self,
        image: Image.Image | None,
        exemplar_bbox: list[float],
        *,
        cache_key: str | None = None,
        simplify_tolerance: float | None = None,
        score_threshold: float | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        """v0.10.0 新增: SAM 3 PCS 视觉示例 prompt.

        输入: 图中已有的一个 bbox (归一化 [0,1]) 作为视觉示例.
        输出: 全图相似实例的 polygonlabels, label 统一为 "object" (前端按当前 active label
              批量改写; 与 point/bbox 路径对齐).
        """
        w, h, hit = self._prime_sam(image, cache_key)
        x1, y1, x2, y2 = exemplar_bbox
        exemplar_px = np.array([x1 * w, y1 * h, x2 * w, y2 * h], dtype=np.float32)
        eff_score_th = (
            self.score_threshold if score_threshold is None else float(score_threshold)
        )
        # vendor: SAM 3 PCS exemplar prompt 接口以 vendor commit 为准.
        boxes_px, masks, scores = self._image_predictor.predict_exemplar(
            exemplar_box=exemplar_px,
            score_threshold=eff_score_th,
        )
        if masks is None or len(masks) == 0:
            logger.info(
                "SAM 3 PCS returned 0 similar instances for exemplar=%s", exemplar_bbox
            )
            return [], hit

        if masks.ndim == 4:
            masks = masks[:, 0]
        eff_tol = (
            DEFAULT_SIMPLIFY_TOLERANCE if simplify_tolerance is None else float(simplify_tolerance)
        )
        results: list[dict[str, Any]] = []
        for i, mask in enumerate(masks):
            score = float(scores[i]) if scores is not None and i < len(scores) else 0.0
            rings = mask_to_multi_polygon(mask, tolerance=eff_tol, normalize_to=(w, h))
            if not rings:
                continue
            self._maybe_warn_vertex_count(rings, eff_tol, int(mask.sum()), prompt="exemplar")
            results.append(self._rings_to_polygon_label(rings, "object", score))
        return results, hit

    # ---------- 共用 prime / 形状转换 ----------

    def _prime_sam(
        self, image: Image.Image | None, cache_key: str | None
    ) -> tuple[int, int, bool]:
        """命中: restore state, 返回 (w, h, True). 未命中: set_image + put, 返回 (w, h, False).

        cache_key=None 时绕过缓存.
        """
        if cache_key and self.embedding_cache is not None:
            entry = self.embedding_cache.get(cache_key)
            if entry is not None:
                self._restore_sam(entry)
                return entry.wh[0], entry.wh[1], True
        if image is None:
            raise ValueError("image is required when cache miss")
        np_img, w, h = self._to_numpy(image)
        self._image_predictor.set_image(np_img)
        if cache_key and self.embedding_cache is not None:
            self.embedding_cache.put(cache_key, self._snapshot_sam(w, h))
        return w, h, False

    @staticmethod
    def _box_to_rect_label(
        box_px: np.ndarray | list[float],
        w: int,
        h: int,
        label: str,
        score: float,
    ) -> dict[str, Any]:
        """像素 xyxy → 归一化 [0,1] 的 rectanglelabels 字典."""
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
    def _rings_to_polygon_label(
        rings: list[MultiPolygonRing], label: str, score: float
    ) -> dict[str, Any]:
        """mask_to_multi_polygon 输出 → LabelStudio polygonlabels shape.

        与 grounded-sam2-backend 字面完全一致 (v0.9.14 智能选择):
        - 单连通无 hole → {points, polygonlabels}
        - 单连通带 hole → {points, holes, polygonlabels}
        - 多连通       → {polygons:[{points,holes?},...], polygonlabels}
        """
        if len(rings) == 1 and not rings[0]["holes"]:
            return {
                "type": "polygonlabels",
                "value": {
                    "points": rings[0]["exterior"],
                    "polygonlabels": [label],
                },
                "score": score,
            }
        if len(rings) == 1:
            return {
                "type": "polygonlabels",
                "value": {
                    "points": rings[0]["exterior"],
                    "holes": rings[0]["holes"],
                    "polygonlabels": [label],
                },
                "score": score,
            }
        return {
            "type": "polygonlabels",
            "value": {
                "polygons": [
                    {"points": r["exterior"], "holes": r["holes"]}
                    if r["holes"]
                    else {"points": r["exterior"]}
                    for r in rings
                ],
                "polygonlabels": [label],
            },
            "score": score,
        }

    @staticmethod
    def _maybe_warn_vertex_count(
        rings: list[MultiPolygonRing], eff_tol: float, mask_area: int, *, prompt: str
    ) -> None:
        total = sum(
            len(r["exterior"]) + sum(len(h) for h in r["holes"]) for r in rings
        )
        if total > VERTEX_COUNT_WARN_THRESHOLD:
            logger.warning(
                "polygon vertex count %d > %d (tolerance=%.2f, mask area=%d, prompt=%s, rings=%d)",
                total,
                VERTEX_COUNT_WARN_THRESHOLD,
                eff_tol,
                mask_area,
                prompt,
                len(rings),
            )

    @staticmethod
    def _to_numpy(image: Image.Image) -> tuple[np.ndarray, int, int]:
        arr = np.array(image)
        h, w = arr.shape[:2]
        return arr, w, h

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
            rings = mask_to_multi_polygon(
                mask, tolerance=eff_tol, normalize_to=(w, h)
            )
            if not rings:
                continue
            self._maybe_warn_vertex_count(
                rings, eff_tol, int(mask.sum()), prompt="point/bbox"
            )
            score = float(scores[i]) if scores is not None and i < len(scores) else None
            entry = self._rings_to_polygon_label(rings, "object", score or 0.0)
            if score is None:
                entry.pop("score", None)
            out.append(entry)
        return out
