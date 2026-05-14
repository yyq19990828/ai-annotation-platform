"""SAM 3 推理封装 (v0.10.0 / M0, vendor 对齐重写于 2026-05-13).

vendor: facebookresearch/sam3 @ 4cbac14, 通过 scripts/sync_vendor.sh 同步.
入口: `from sam3 import build_sam3_image_model` + `from sam3.model.sam3_image_processor import Sam3Processor`.

支持的 prompt (v0.10.0 选项 A: 不启用 inst_interactivity):
  - text:     processor.set_text_prompt(prompt, state) → 全图所有匹配概念的 mask + box
  - bbox:     processor.add_geometric_prompt(box, label=True, state) → 全图与 box 内对象相似的所有实例
  - exemplar: 与 bbox 同一底层调用; 协议层语义不同, 物理上是 alias
  - point:    ❌ 不支持. SAM 3 image API 没有点 prompt; 需要 enable_inst_interactivity=True
              额外加载 ~2-3GB tracker base. 选项 A 显式放弃, 让 grounded-sam2-backend 兜底.

API 形态关键点 (与 SAM 2 / grounded-sam2 完全不同):
  1. Sam3Processor 是 stateful wrapper, state 是 dict. set_image() 把图像 features 写到
     state["backbone_out"], 后续 prompt 调用是副作用修改 state.
  2. _forward_grounding 写 state["masks" / "boxes" / "scores" / "masks_logits"]:
       - boxes: 像素 xyxy (已转换好)
       - masks: bool tensor (N, 1, H, W), 已 interpolate 到原图分辨率
       - scores: float (N,), 已经 sigmoid 过
  3. confidence_threshold 是 processor 实例属性; 单 worker 串行下可临时修改实现 per-request override.
  4. reset_all_prompts(state) 清掉 language_features + geometric_prompt + boxes/masks/scores,
     但保留 backbone_out 中的图像 features. 缓存命中时只缓存 backbone_out + 原图尺寸.
  5. 没有 label / phrase 输出. 一次 text prompt 是单 phrase, 所有 N 个 mask 共用同一 label.
  6. bbox 输入: 归一化 cxcywh (中心 + 宽高), 用 vendor/sam3/sam3/model/box_ops.box_xywh_to_cxcywh
     转换. 我们对外协议用归一化 xyxy, 转换在 predictor 内部完成.

mask → polygon 简化复用 apps/_shared/mask_utils; 与 grounded-sam2-backend 同源.

Idle unload 集成: __init__ 加载到 self.device; main.py 在 idle 后 del self._predictor +
torch.cuda.empty_cache(); 重建是再调一次 __init__.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

# vendor: container 内由 Dockerfile `pip install -e ./vendor/sam3` 提供; 本地测试通过
# pyproject.toml 的 pythonpath 注入. 显式把 vendor 根加进 sys.path 兜底.
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
VERTEX_COUNT_WARN_THRESHOLD = 200

CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "/app/checkpoints")
# SAM 3 当前仅一档 848M; 路线图 §1.1 明确.
MODEL_VARIANT = "sam3.1"

# Sam3Processor 默认 confidence_threshold; per-request 由 context.score_threshold 覆盖.
DEFAULT_SCORE_THRESHOLD = float(os.getenv("SAM3_SCORE_THRESHOLD", "0.5"))
# Sam3Processor 默认推理分辨率 (vendor 默认值, 不暴露 env).
SAM3_RESOLUTION = 1008


class SAM3Predictor:
    """三种 prompt (text / bbox / exemplar) 路由到 Sam3Processor; 返回归一化 polygon dict 列表."""

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

        self._model = self._load_model()
        self._processor = self._build_processor()

    # ---------- 模型加载 ----------

    def _load_model(self):
        """加载 SAM 3 image model. 选项 A: 不启用 inst_interactivity (无点 prompt)."""
        # vendor: facebookresearch/sam3 commit 4cbac14
        from sam3 import build_sam3_image_model  # type: ignore[import-not-found]

        # 优先用本地 checkpoint (容器启动时由 download_checkpoints.py 拉到 /app/checkpoints),
        # fallback 走 vendor 内置 hf_hub_download (`load_from_HF=True`).
        ckpt_path: str | None = None
        candidate = os.path.join(self.checkpoint_dir, "sam3.1_multiplex.pt")
        if os.path.isfile(candidate):
            ckpt_path = candidate
            logger.info("using local checkpoint: %s", ckpt_path)

        model = build_sam3_image_model(
            checkpoint_path=ckpt_path,
            load_from_HF=(ckpt_path is None),
            device=self.device,
            enable_segmentation=True,
            enable_inst_interactivity=False,  # 选项 A
            eval_mode=True,
        )
        return model

    def _build_processor(self):
        from sam3.model.sam3_image_processor import Sam3Processor  # type: ignore[import-not-found]

        return Sam3Processor(
            self._model,
            resolution=SAM3_RESOLUTION,
            device=self.device,
            confidence_threshold=self.score_threshold,
        )

    # ---------- 缓存辅助 ----------

    def _prime_state(
        self, image: Image.Image | None, cache_key: str | None
    ) -> tuple[dict, int, int, bool]:
        """获取一个干净 state dict (含 backbone_out + 原图尺寸). 命中 cache 跳过 set_image."""
        if cache_key and self.embedding_cache is not None:
            entry = self.embedding_cache.get(cache_key)
            if entry is not None:
                # 复用缓存的 backbone_out (内含 GPU 张量, 同 device, 不需拷贝).
                state = {
                    "backbone_out": dict(entry.features),  # shallow copy: 外层 dict 隔离, 内层张量共享
                    "original_height": entry.orig_hw[0],
                    "original_width": entry.orig_hw[1],
                }
                return state, entry.wh[0], entry.wh[1], True

        if image is None:
            raise ValueError("image is required when cache miss")
        # set_image 内部会 normalize + resize + backbone.forward_image, 写入 state.
        state = self._processor.set_image(image)
        w, h = image.size
        if cache_key and self.embedding_cache is not None:
            # 缓存的是干净 backbone_out (此时还没跑过任何 prompt, 没有 language_features 污染).
            self.embedding_cache.put(
                cache_key,
                CacheEntry(
                    features=dict(state["backbone_out"]),  # shallow copy
                    orig_hw=(state["original_height"], state["original_width"]),
                    is_batch=False,
                    wh=(w, h),
                ),
            )
        return state, w, h, False

    def _apply_score_threshold(self, score_threshold: float | None) -> None:
        """per-request 阈值覆盖. 单 worker 串行执行下安全; 多 worker 需重新设计."""
        eff = self.score_threshold if score_threshold is None else float(score_threshold)
        self._processor.confidence_threshold = eff

    # ---------- 公开 prompt 接口 ----------

    def predict_text(
        self,
        image: Image.Image | None,
        text: str,
        *,
        output: str = "mask",
        cache_key: str | None = None,
        simplify_tolerance: float | None = None,
        score_threshold: float | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        """SAM 3 PCS text prompt 单模型一步出 mask.
        - "box":  跳过 mask → polygon 简化, 返回 rectanglelabels
        - "mask": 默认; mask → polygon, 返回 polygonlabels
        - "both": 同 instance 配对返回 [rect, poly]
        """
        self._apply_score_threshold(score_threshold)
        # SAM3.1 multiplex ckpt 部分权重 (vision_backbone.convs.3.*) 缺失, 默认 init 为 fp32,
        # 其余权重以 bf16 加载 → 不包 autocast 会 dtype 冲突. vendor 也是这样用 (见 examples/).
        with torch.autocast(self.device, dtype=torch.bfloat16, enabled=(self.device == "cuda")):
            state, w, h, hit = self._prime_state(image, cache_key)
            self._processor.reset_all_prompts(state)
            state = self._processor.set_text_prompt(text.strip(), state)
            boxes, masks, scores = self._extract_outputs(state)
        # cleanup: reset 让 backbone_out 回到干净态, 下次缓存命中可用.
        self._processor.reset_all_prompts(state)

        if masks is None or len(masks) == 0:
            logger.info("SAM 3 returned 0 instances for text=%r", text)
            return [], hit

        return self._build_results(
            boxes, masks, scores, w, h, label=text.strip(), output=output,
            simplify_tolerance=simplify_tolerance, prompt_name="text",
        ), hit

    def predict_bbox(
        self,
        image: Image.Image | None,
        bbox: list[float],
        *,
        output: str = "mask",
        cache_key: str | None = None,
        simplify_tolerance: float | None = None,
        score_threshold: float | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        """SAM 3 image API 中 bbox prompt 与 exemplar 是同一调用 (add_geometric_prompt),
        语义都是「找全图与 box 内对象相似的所有实例」. 没有 SAM-2-style 的「这个 box 内部出一个 mask」.
        用户期待单框单 mask 的场景请走 grounded-sam2-backend.
        """
        return self._predict_geometric(
            image, bbox, output=output, cache_key=cache_key,
            simplify_tolerance=simplify_tolerance,
            score_threshold=score_threshold, prompt_name="bbox",
        )

    def predict_exemplar(
        self,
        image: Image.Image | None,
        exemplar_bbox: list[float],
        *,
        output: str = "mask",
        cache_key: str | None = None,
        simplify_tolerance: float | None = None,
        score_threshold: float | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        """v0.10.0 新增 exemplar prompt; 与 predict_bbox 同底层调用, 协议层语义不同."""
        return self._predict_geometric(
            image, exemplar_bbox, output=output, cache_key=cache_key,
            simplify_tolerance=simplify_tolerance,
            score_threshold=score_threshold, prompt_name="exemplar",
        )

    def _predict_geometric(
        self,
        image: Image.Image | None,
        bbox: list[float],
        *,
        output: str,
        cache_key: str | None,
        simplify_tolerance: float | None,
        score_threshold: float | None,
        prompt_name: str,
    ) -> tuple[list[dict[str, Any]], bool]:
        self._apply_score_threshold(score_threshold)
        # 同 predict_text: ckpt fp32/bf16 混搭, 必须包 autocast.
        with torch.autocast(self.device, dtype=torch.bfloat16, enabled=(self.device == "cuda")):
            state, w, h, hit = self._prime_state(image, cache_key)
            self._processor.reset_all_prompts(state)

            # 协议 bbox 是归一化 xyxy → 转 归一化 cxcywh
            x1, y1, x2, y2 = bbox
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            bw = x2 - x1
            bh = y2 - y1
            state = self._processor.add_geometric_prompt(
                [cx, cy, bw, bh], True, state
            )

            boxes, masks, scores = self._extract_outputs(state)
        self._processor.reset_all_prompts(state)

        if masks is None or len(masks) == 0:
            logger.info(
                "SAM 3 returned 0 similar instances for %s bbox=%s", prompt_name, bbox
            )
            return [], hit

        # geometric prompt 没有自然 label, 用 "object" 占位; workbench 会按当前 active label 重写.
        return self._build_results(
            boxes, masks, scores, w, h, label="object", output=output,
            simplify_tolerance=simplify_tolerance, prompt_name=prompt_name,
        ), hit

    # ---------- 输出处理 ----------

    @staticmethod
    def _extract_outputs(state: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """把 state 中的 GPU 张量提到 numpy."""
        boxes_t = state.get("boxes")
        masks_t = state.get("masks")
        scores_t = state.get("scores")
        if masks_t is None or len(masks_t) == 0:
            return (
                np.empty((0, 4), dtype=np.float32),
                np.empty((0,), dtype=bool),
                np.empty((0,), dtype=np.float32),
            )
        # autocast(bf16) 下 boxes/scores 是 bf16, numpy 不支持 BFloat16 → 先 .float().
        boxes = boxes_t.detach().float().cpu().numpy()
        # masks shape: (N, 1, H, W) bool → (N, H, W); bool 张量不受 autocast 影响.
        if masks_t.ndim == 4:
            masks = masks_t[:, 0].detach().cpu().numpy()
        else:
            masks = masks_t.detach().cpu().numpy()
        scores = (
            scores_t.detach().float().cpu().numpy()
            if scores_t is not None
            else np.zeros(len(boxes))
        )
        return boxes, masks, scores

    def _build_results(
        self,
        boxes: np.ndarray,
        masks: np.ndarray,
        scores: np.ndarray,
        w: int,
        h: int,
        *,
        label: str,
        output: str,
        simplify_tolerance: float | None,
        prompt_name: str,
    ) -> list[dict[str, Any]]:
        eff_tol = (
            DEFAULT_SIMPLIFY_TOLERANCE if simplify_tolerance is None else float(simplify_tolerance)
        )
        results: list[dict[str, Any]] = []

        if output == "box":
            for i in range(len(boxes)):
                results.append(self._box_to_rect_label(boxes[i], w, h, label, float(scores[i])))
            return results

        for i, mask in enumerate(masks):
            score = float(scores[i])
            rings = mask_to_multi_polygon(
                mask.astype(np.uint8), tolerance=eff_tol, normalize_to=(w, h)
            )
            if not rings:
                continue
            self._maybe_warn_vertex_count(
                rings, eff_tol, int(mask.sum()), prompt=prompt_name
            )
            if output == "both":
                results.append(self._box_to_rect_label(boxes[i], w, h, label, score))
                results.append(self._rings_to_polygon_label(rings, label, score))
            else:
                results.append(self._rings_to_polygon_label(rings, label, score))
        return results

    @staticmethod
    def _box_to_rect_label(
        box_px: np.ndarray | list[float],
        w: int,
        h: int,
        label: str,
        score: float,
    ) -> dict[str, Any]:
        """像素 xyxy → 归一化 [0,1] 的 rectanglelabels 字典 (与 grounded-sam2 同源)."""
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
        """与 grounded-sam2 完全一致的 polygonlabels 智能字面 (v0.9.14)."""
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
