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

import httpx
from PIL import Image

from observability import record_inference
from schemas import Context, Variants

logger = logging.getLogger("yolo-backend.predictor")

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
    """围绕 model_pool 的薄分发. /predict 单 task 调用一次."""

    def __init__(self, model_pool: Any) -> None:
        self._pool = model_pool

    async def predict_one(self, file_path: str, ctx: Context) -> list[dict[str, Any]]:
        variants: Variants = ctx.variants
        task = ctx.type
        params = ctx.params

        model = await self._pool.get(task, variants.series, variants.size)
        img = _load_image(file_path)
        img_w, img_h = img.size

        t0 = time.time()
        # ultralytics .predict() 返回 list[Results] (一图一项).
        results = model.predict(
            img,
            conf=params.conf,
            iou=params.iou,
            max_det=params.max_det,
            verbose=False,
        )
        elapsed = time.time() - t0
        record_inference(task, variants.series, variants.size, elapsed)

        if not results:
            return []
        r0 = results[0]
        names: dict[int, str] = getattr(r0, "names", {}) or getattr(model, "names", {})

        if task == "detection":
            return _emit_detection(r0, names, img_w, img_h)
        if task == "segmentation":
            return _emit_segmentation(r0, names, img_w, img_h)
        if task == "keypoint":
            return _emit_keypoint(r0, names, img_w, img_h)
        if task == "obb":
            return _emit_obb(r0, names, img_w, img_h)
        raise ValueError(f"unsupported task: {task}")


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
