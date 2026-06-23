"""v0.18.1 · 多阶段预标注 ROI 裁剪 (路径 B M1).

平台按上游检测框 bbox 裁 crop, 以 data URI (base64) 内联喂下游分类 backend——backend
无感, 只收到一张小图跑它本就支持的分类, 把结果塞 attributes 返回 (协议 §3 已有能力)。
这样任意现成 classify backend 零改造即可作下游 (ROADMAP §3.4 决议)。

本期 (M1) 只处理 rectanglelabels (轴对齐 bbox); 旋转框 / 多边形等几何留 M2。
crop 经 data URI 内存传递, 不落临时对象 (依赖下游 load_image_bgr 支持 ``data:`` 前缀)。
"""

from __future__ import annotations

import base64
import io

from PIL import Image


def _bbox_pixels_from_ls_value(
    value: dict, img_w: int, img_h: int
) -> tuple[float, float, float, float] | None:
    """LS 标准 value(x/y/width/height, 百分比 0-100) → 像素 (left, top, right, bottom)。

    旋转框 (value.rotation 非 0) 本期不裁, 返回 None (留 M2)。无效数值返回 None。
    """
    if value.get("rotation"):
        return None
    raw = (value.get("x"), value.get("y"), value.get("width"), value.get("height"))
    if any(v is None for v in raw):
        return None
    try:
        x, y, w, h = (float(v) for v in raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    left = x / 100.0 * img_w
    top = y / 100.0 * img_h
    right = (x + w) / 100.0 * img_w
    bottom = (y + h) / 100.0 * img_h
    return left, top, right, bottom


def crop_inputs_from_boxes(
    image: Image.Image,
    boxes: list[dict],
    *,
    pad: float = 0.05,
    jpeg_quality: int = 90,
) -> list[dict]:
    """对 boxes 里的 bbox 框逐个裁 ROI crop, 返回喂下游 /predict 的 inputs。

    Args:
        image: 任务原图 (PIL Image)。
        boxes: 上游 stage 返回的 LS 标准 result 列表 (每项 ``{type, value, ...}``)。
        pad: 按框宽高比例外扩的边界 padding (0.05 = 各边外扩 5%)。
        jpeg_quality: crop 重编码 JPEG 质量。

    Returns:
        inputs 列表, 每项 ``{"id": "<box_idx>", "file_path": "data:image/jpeg;base64,..."}``。
        ``id`` 即 boxes 中的下标 (字符串), 供下游结果按 id 回写到对应父框。
        非 bbox / 旋转框 / 退化框 (宽高 ≤0) 被跳过, 不进 inputs。
    """
    img_w, img_h = image.size
    inputs: list[dict] = []
    for idx, box in enumerate(boxes):
        if not isinstance(box, dict) or box.get("type") != "rectanglelabels":
            continue
        px = _bbox_pixels_from_ls_value(box.get("value") or {}, img_w, img_h)
        if px is None:
            continue
        left, top, right, bottom = px
        bw = right - left
        bh = bottom - top
        if bw <= 0 or bh <= 0:
            continue
        left = max(0.0, left - bw * pad)
        top = max(0.0, top - bh * pad)
        right = min(float(img_w), right + bw * pad)
        bottom = min(float(img_h), bottom + bh * pad)
        crop = image.crop((int(left), int(top), int(round(right)), int(round(bottom))))
        if crop.width <= 0 or crop.height <= 0:
            continue
        buf = io.BytesIO()
        crop.convert("RGB").save(buf, format="JPEG", quality=jpeg_quality)
        data_uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(
            "ascii"
        )
        inputs.append({"id": str(idx), "file_path": data_uri})
    return inputs


def merge_classify_attributes(
    boxes: list[dict],
    classify_results: list,
    *,
    write_keys: list[str] | None = None,
) -> int:
    """把下游分类结果的 attributes 合并 (union) 进对应父框的 attributes。

    下游每个结果的 ``task_id`` 是 crop 输入的 id (= 父框在 boxes 中的下标字符串)。
    取该结果 ``result`` 列表里**置信度最高**项的 ``attributes`` (下游若返回几何一并丢弃,
    本期只取属性, ROADMAP §3.3 write=attributes)。若声明 write_keys 则只取这些键。

    Args:
        boxes: 父框 LS result 列表 (原地修改, 写入 box["attributes"])。
        classify_results: 下游 ``client.predict`` 返回的 PredictionResult 列表。
        write_keys: 本阶段声明写哪些属性键; None=全取下游返回的键。

    Returns:
        成功合并属性的父框数量 (供统计)。
    """
    merged = 0
    for cr in classify_results:
        try:
            box_idx = int(cr.task_id)
        except (TypeError, ValueError):
            continue
        if not (0 <= box_idx < len(boxes)):
            continue
        shapes = cr.result or []
        # 取置信度最高的结果项的 attributes
        best_attrs: dict = {}
        best_score = -1.0
        for s in shapes:
            if not isinstance(s, dict):
                continue
            attrs = s.get("attributes")
            if not isinstance(attrs, dict) or not attrs:
                continue
            score = float(s.get("score") or s.get("confidence") or 0.0)
            if score >= best_score:
                best_score = score
                best_attrs = attrs
        if not best_attrs:
            continue
        if write_keys:
            best_attrs = {k: v for k, v in best_attrs.items() if k in write_keys}
            if not best_attrs:
                continue
        box = boxes[box_idx]
        existing = box.get("attributes")
        box["attributes"] = {**existing, **best_attrs} if isinstance(existing, dict) else dict(best_attrs)
        merged += 1
    return merged
