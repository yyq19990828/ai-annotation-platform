"""YOLO 推理 + 结果映射到协议 v2 result types (v0.14.12).

四 task 分支:
- detection    → result.type=rectanglelabels, value={x,y,width,height,rectanglelabels:[cls]}
- segmentation → result.type=polygonlabels,   value={points:[[x,y]...], polygonlabels:[cls]}
- keypoint     → result.type=keypointlabels,  value={points:[{x,y,v}...], keypointlabels:[cls]}
- obb          → result.type=rectanglelabels + value.rotation=度, 用 cx/cy/w/h 等
                (apps/api services/prediction.py 在 rotation 字段存在时转 internal rotated_bbox)

坐标统一归一化百分比 (与 LabelStudio 风格一致, apps/api 已支持). ultralytics 出的
原始坐标是像素, 这里除 image (W, H) × 100.
"""

from __future__ import annotations

import io
import logging
import math
import time
from base64 import b64decode
from typing import Any
from urllib.parse import urlparse

import re

import httpx
from PIL import Image

from model_registry import POOL_TASK_OPENVOCAB, openvocab_family
from observability import record_inference
from schemas import Context, Variants

logger = logging.getLogger("yolo-backend.predictor")


def _parse_open_classes(text: str | None) -> list[str]:
    """开放词表文本 → 类名列表. 逗号/换行/分号分隔, 去空白. 顺序保留 (= cls index 映射)."""
    if not text:
        return []
    out: list[str] = []
    for part in re.split(r"[,\n;]+", text):
        name = part.strip()
        if name:
            out.append(name)
    return out


def _ensure_open_classes(model: Any, classes: list[str], family: str) -> None:
    """把开放词表写入模型. 同一组类名 (含顺序) 已设过则跳过, 省去 CLIP/MobileCLIP 重复编码.

    批量同一 prompt 跑 N 图时只编码一次; YOLOE 另存 PE 字典, 切换 prompt 再切回也命中.
    """
    key = tuple(classes)
    if getattr(model, "_aap_classes", None) == key:
        return
    if family == "yoloe":
        cache: dict[tuple[str, ...], Any] = getattr(model, "_aap_pe_cache", None) or {}
        pe = cache.get(key)
        if pe is None:
            pe = model.get_text_pe(list(classes))
            cache[key] = pe
            model._aap_pe_cache = cache
        model.set_classes(list(classes), pe)
    else:  # world: set_classes 无 embeddings 形参, 内部自做 CLIP 编码.
        model.set_classes(list(classes))
    model._aap_classes = key

# COCO 17 keypoints (与 ultralytics pose 模型默认顺序一致). 用作 keypointlabels
# value.keypointlabels 的节点名 / value.points 的 v(可见性)填充顺序参考.
COCO_KEYPOINT_NAMES: tuple[str, ...] = (
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
)


def _load_image(file_path: str, *, http_timeout: float = 10.0) -> Image.Image:
    """支持 http(s):// presigned URL / data: base64 / 本地绝对路径."""
    if file_path.startswith("data:"):
        # data:image/jpeg;base64,XXXX
        _, _, b64 = file_path.partition(",")
        raw = b64decode(b64)
        return Image.open(io.BytesIO(raw)).convert("RGB")
    parsed = urlparse(file_path)
    if parsed.scheme in ("http", "https"):
        with httpx.Client(timeout=http_timeout, follow_redirects=True) as client:
            resp = client.get(file_path)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
    return Image.open(file_path).convert("RGB")


def _bbox_to_rectanglelabels(
    x1: float, y1: float, x2: float, y2: float,
    cls_name: str, score: float, img_w: int, img_h: int,
) -> dict[str, Any]:
    return {
        "type": "rectanglelabels",
        "value": {
            "x": (x1 / img_w) * 100.0,
            "y": (y1 / img_h) * 100.0,
            "width": ((x2 - x1) / img_w) * 100.0,
            "height": ((y2 - y1) / img_h) * 100.0,
            "rectanglelabels": [cls_name],
        },
        "score": score,
    }


def _polygon_to_polygonlabels(
    points_xy: list[tuple[float, float]],
    cls_name: str, score: float, img_w: int, img_h: int,
) -> dict[str, Any] | None:
    """ultralytics mask 已经吐出 polygon 点列 (像素), 这里只做归一化."""
    if len(points_xy) < 3:
        return None
    pts = [[(x / img_w) * 100.0, (y / img_h) * 100.0] for x, y in points_xy]
    return {
        "type": "polygonlabels",
        "value": {
            "points": pts,
            "polygonlabels": [cls_name],
        },
        "score": score,
    }


def _keypoints_to_keypointlabels(
    kp_xyv: list[tuple[float, float, float]],
    cls_name: str, score: float, img_w: int, img_h: int,
) -> dict[str, Any]:
    """COCO 17 点. v 阈值: ultralytics keypoints.conf > 0.5 视为可见, > 0 为遮挡."""
    points: list[dict[str, float | int]] = []
    for x, y, v in kp_xyv:
        if v > 0.5:
            visibility = 2
        elif v > 0.0:
            visibility = 1
        else:
            visibility = 0
        points.append({
            "x": (x / img_w) * 100.0,
            "y": (y / img_h) * 100.0,
            "v": visibility,
        })
    return {
        "type": "keypointlabels",
        "value": {
            "points": points,
            "keypointlabels": [cls_name],
        },
        "score": score,
    }


def _obb_to_rectanglelabels(
    cx: float, cy: float, w: float, h: float, rot_rad: float,
    cls_name: str, score: float, img_w: int, img_h: int,
) -> dict[str, Any]:
    """OBB → rectanglelabels + value.rotation (度). apps/api 走 rectanglelabels +
    rotation 分支转 internal rotated_bbox."""
    angle_deg = math.degrees(rot_rad) % 360
    # rotation 时 LS 约定 x/y 是旋转中心? 还是左上? 看 apps/api prediction.py:187 ——
    # 它把 x,y 视为旋转前左上, 旋转后中心算 cx/cy. 这里反向: 我们有真实 cx,cy,
    # 倒推得到「未旋转时的左上 x,y」 = (cx - w/2, cy - h/2).
    x_topleft = cx - w / 2.0
    y_topleft = cy - h / 2.0
    return {
        "type": "rectanglelabels",
        "value": {
            "x": (x_topleft / img_w) * 100.0,
            "y": (y_topleft / img_h) * 100.0,
            "width": (w / img_w) * 100.0,
            "height": (h / img_h) * 100.0,
            "rotation": angle_deg,
            "rectanglelabels": [cls_name],
        },
        "score": score,
    }


class YoloPredictor:
    """围绕 model_pool 的薄分发. /predict 单 task 调用一次.

    v0.14.14: predict_one 返回 (results, cache_hit, model_load_ms, inference_time_ms)
    四元组, main /predict 把后三项透传到 PredictionResult 供前端冷启动反馈.
    """

    def __init__(self, model_pool: Any) -> None:
        self._pool = model_pool

    async def predict_one(
        self, file_path: str, ctx: Context
    ) -> tuple[list[dict[str, Any]], bool, int | None, int]:
        """返回 (results, cache_hit, model_load_ms, inference_time_ms)."""
        variants: Variants = ctx.variants
        task = ctx.type
        params = ctx.params

        # v0.18.21 · 开集文本路径: type=text, series=world/yoloe, 文本 → 类名 → set_classes.
        if task == "text":
            return await self._predict_open_text(file_path, ctx)

        model, cache_hit, load_ms = await self._pool.get(task, variants.series, variants.size)
        img = _load_image(file_path)
        img_w, img_h = img.size

        t0 = time.time()
        # v0.14.17 · 类别白名单: 非空时传 ultralytics classes= 只检出选中 index (原生过滤, 不后处理).
        class_filter = getattr(ctx, "classes", None) or None
        # ultralytics .predict() 返回 list[Results] (一图一项).
        results = model.predict(
            img,
            conf=params.conf,
            iou=params.iou,
            max_det=params.max_det,
            classes=class_filter,
            verbose=False,
        )
        elapsed = time.time() - t0
        record_inference(task, variants.series, variants.size, elapsed)
        inference_ms = int(elapsed * 1000)

        if not results:
            return [], cache_hit, load_ms, inference_ms
        r0 = results[0]
        names: dict[int, str] = getattr(r0, "names", {}) or getattr(model, "names", {})

        if task == "detection":
            items = _emit_detection(r0, names, img_w, img_h)
        elif task == "segmentation":
            items = _emit_segmentation(r0, names, img_w, img_h)
        elif task == "keypoint":
            items = _emit_keypoint(r0, names, img_w, img_h)
        elif task == "obb":
            items = _emit_obb(r0, names, img_w, img_h)
        else:
            raise ValueError(f"unsupported task: {task}")
        return items, cache_hit, load_ms, inference_ms

    async def _predict_open_text(
        self, file_path: str, ctx: Context
    ) -> tuple[list[dict[str, Any]], bool, int | None, int]:
        """开集文本推理 (v0.18.21 检测 / v0.18.22 分割). series 决定 family (world/yoloe),
        文本 → 类名 → 框 / mask.

        pool key 用 (POOL_TASK_OPENVOCAB, series, size): yoloe 的 det/seg 同权重共用一份,
        detect-yoloe 与 segment-yoloe 走同一句柄, 仅 ctx.output 决定取 box / mask / 两者.

        - output=box  → 检测框 (rectanglelabels). world/yoloe 皆可.
        - output=mask → 实例分割 (polygonlabels). 仅 yoloe -seg 权重有 mask 头;
          world 无分割头时退回检测框.
        - output=both → 同时返回框 + mask.
        """
        variants: Variants = ctx.variants
        series, size = variants.series, variants.size
        family = openvocab_family(series)
        classes = _parse_open_classes(ctx.text)

        model, cache_hit, load_ms = await self._pool.get(
            POOL_TASK_OPENVOCAB, series, size
        )
        img = _load_image(file_path)
        img_w, img_h = img.size

        if not classes:
            # 无类名: 不推理, 返回空 (前端文本框为空时的退化, 不报错).
            return [], cache_hit, load_ms, 0

        _ensure_open_classes(model, classes, family)
        params = ctx.params
        t0 = time.time()
        results = model.predict(
            img,
            conf=params.conf,
            iou=params.iou,
            max_det=params.max_det,
            verbose=False,
        )
        elapsed = time.time() - t0
        record_inference(POOL_TASK_OPENVOCAB, series, size, elapsed)
        inference_ms = int(elapsed * 1000)

        if not results:
            return [], cache_hit, load_ms, inference_ms
        r0 = results[0]
        # set_classes 后 model.names = 设入的类名, cls index 映射回类名.
        names: dict[int, str] = getattr(r0, "names", {}) or getattr(model, "names", {})

        # mask 仅 yoloe -seg 权重有; world 即便请求 mask 也无分割头 → 退回检测框.
        want_mask = ctx.output in ("mask", "both") and family == "yoloe"
        want_box = ctx.output == "box" or ctx.output == "both" or not want_mask
        items: list[dict[str, Any]] = []
        if want_box:
            items += _emit_detection(r0, names, img_w, img_h)
        if want_mask:
            items += _emit_segmentation(r0, names, img_w, img_h)
        return items, cache_hit, load_ms, inference_ms


def _emit_detection(r0: Any, names: dict[int, str], img_w: int, img_h: int) -> list[dict]:
    out: list[dict] = []
    boxes = getattr(r0, "boxes", None)
    if boxes is None or len(boxes) == 0:
        return out
    xyxy = boxes.xyxy.cpu().numpy() if hasattr(boxes.xyxy, "cpu") else boxes.xyxy
    confs = boxes.conf.cpu().numpy() if hasattr(boxes.conf, "cpu") else boxes.conf
    clss = boxes.cls.cpu().numpy().astype(int) if hasattr(boxes.cls, "cpu") else boxes.cls.astype(int)
    for i in range(len(xyxy)):
        x1, y1, x2, y2 = (float(v) for v in xyxy[i])
        cls_idx = int(clss[i])
        cls_name = names.get(cls_idx, str(cls_idx))
        out.append(_bbox_to_rectanglelabels(
            x1, y1, x2, y2, cls_name, float(confs[i]), img_w, img_h
        ))
    return out


def _emit_segmentation(r0: Any, names: dict[int, str], img_w: int, img_h: int) -> list[dict]:
    out: list[dict] = []
    masks = getattr(r0, "masks", None)
    boxes = getattr(r0, "boxes", None)
    if masks is None or boxes is None:
        return out
    # ultralytics masks.xy 是 list[ndarray[N,2]], 每项一个 polygon 点列 (像素).
    polys_xy = masks.xy if hasattr(masks, "xy") else []
    confs = boxes.conf.cpu().numpy() if hasattr(boxes.conf, "cpu") else boxes.conf
    clss = boxes.cls.cpu().numpy().astype(int) if hasattr(boxes.cls, "cpu") else boxes.cls.astype(int)
    for i, poly in enumerate(polys_xy):
        pts = [(float(p[0]), float(p[1])) for p in poly]
        cls_idx = int(clss[i]) if i < len(clss) else 0
        cls_name = names.get(cls_idx, str(cls_idx))
        score = float(confs[i]) if i < len(confs) else 0.0
        item = _polygon_to_polygonlabels(pts, cls_name, score, img_w, img_h)
        if item is not None:
            out.append(item)
    return out


def _emit_keypoint(r0: Any, names: dict[int, str], img_w: int, img_h: int) -> list[dict]:
    out: list[dict] = []
    kp = getattr(r0, "keypoints", None)
    boxes = getattr(r0, "boxes", None)
    if kp is None or boxes is None:
        return out
    # ultralytics keypoints.data: tensor[N,17,3] (x,y,v).
    data = kp.data.cpu().numpy() if hasattr(kp.data, "cpu") else kp.data
    confs = boxes.conf.cpu().numpy() if hasattr(boxes.conf, "cpu") else boxes.conf
    clss = boxes.cls.cpu().numpy().astype(int) if hasattr(boxes.cls, "cpu") else boxes.cls.astype(int)
    for i in range(len(data)):
        kp_xyv = [(float(p[0]), float(p[1]), float(p[2])) for p in data[i]]
        cls_idx = int(clss[i]) if i < len(clss) else 0
        cls_name = names.get(cls_idx, str(cls_idx))
        score = float(confs[i]) if i < len(confs) else 0.0
        out.append(_keypoints_to_keypointlabels(kp_xyv, cls_name, score, img_w, img_h))
    return out


def _emit_obb(r0: Any, names: dict[int, str], img_w: int, img_h: int) -> list[dict]:
    out: list[dict] = []
    obb = getattr(r0, "obb", None)
    if obb is None or len(obb) == 0:
        return out
    # ultralytics obb.xywhr: tensor[N,5] = cx, cy, w, h, rotation(弧度).
    xywhr = obb.xywhr.cpu().numpy() if hasattr(obb.xywhr, "cpu") else obb.xywhr
    confs = obb.conf.cpu().numpy() if hasattr(obb.conf, "cpu") else obb.conf
    clss = obb.cls.cpu().numpy().astype(int) if hasattr(obb.cls, "cpu") else obb.cls.astype(int)
    for i in range(len(xywhr)):
        cx, cy, w, h, rot = (float(v) for v in xywhr[i])
        cls_idx = int(clss[i])
        cls_name = names.get(cls_idx, str(cls_idx))
        out.append(_obb_to_rectanglelabels(
            cx, cy, w, h, rot, cls_name, float(confs[i]), img_w, img_h
        ))
    return out
