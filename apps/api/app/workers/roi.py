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
from collections.abc import Callable
from dataclasses import dataclass, field

from PIL import Image


@dataclass
class CropBatch:
    """v0.18.4 · crop_inputs_from_boxes 的返回: 喂下游的 inputs + 几何跳过统计。

    skipped_geometry: 命中本阶段路由 (类别匹配) 但因几何不支持 (非 bbox / 旋转框 / 退化框)
    无法裁 crop 而被跳过的父框数。供逐阶段统计暴露「N 框因几何不支持未富集」, 不再静默。
    """

    inputs: list[dict] = field(default_factory=list)
    skipped_geometry: int = 0


def box_class_name(box: dict) -> str | None:
    """从 LS 标准 shape 提取 class_name (value.rectanglelabels[0] / value.labels[0])。

    v0.18.2 · parent_class_filter 类别路由用。取不到返回 None。
    """
    value = box.get("value") or {}
    labels = value.get("rectanglelabels") or value.get("labels")
    if isinstance(labels, list) and labels:
        return labels[0]
    return None


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
    parent_class_filter: list[str] | None = None,
    delivery: str = "data_uri",
    upload_fn: Callable[[int, bytes], str] | None = None,
    cache: dict | None = None,
) -> CropBatch:
    """对 boxes 里的 bbox 框逐个裁 ROI crop, 返回喂下游 /predict 的 inputs + 几何跳过统计。

    Args:
        image: 任务原图 (PIL Image)。
        boxes: 上游 stage 返回的 LS 标准 result 列表 (每项 ``{type, value, ...}``)。
        pad: 按框宽高比例外扩的边界 padding (0.05 = 各边外扩 5%)。
        jpeg_quality: crop 重编码 JPEG 质量。
        parent_class_filter: v0.18.2 · 只对 class_name 在此集合的父框裁 crop (空/None=全部)。
            类别路由: 不同下游阶段设不相交类别集 = 不同类走不同模型。
        delivery: v0.18.4 · crop 投递方式。``"data_uri"`` (默认, 纯函数自足, 单测/已知支持
            ``data:`` 的后端) 内联 base64; ``"presigned"`` (worker 生产默认) 经 ``upload_fn``
            上传对象存储回 URL——对所有走 ``httpx.get`` 的下游后端 (gsam2/sam3) 通用。
        upload_fn: v0.18.4 · ``delivery="presigned"`` 时必传, ``(box_idx, jpeg_bytes) -> url``。
        cache: v0.18.4 · 可选 ``{(box_idx, pad_rounded): input}``。并行兄弟阶段 target 同一批父框
            时按 ``(box_idx, pad)`` 复用已裁/已上传 crop, 不重复裁剪 + 重编码 + 重上传。

    Returns:
        :class:`CropBatch` —— ``inputs`` 每项 ``{"id": "<box_idx>", "file_path": <data uri | url>}``,
        ``id`` 即 boxes 中的下标 (字符串, **保留原下标**即使被类别过滤), 供下游结果回写到对应父框;
        ``skipped_geometry`` 为命中路由但几何不支持被跳过的父框数。类别不匹配的父框是路由跳过, 不计入。
    """
    img_w, img_h = image.size
    filter_set = set(parent_class_filter) if parent_class_filter else None
    inputs: list[dict] = []
    skipped_geometry = 0
    for idx, box in enumerate(boxes):
        if not isinstance(box, dict):
            continue
        # 类别路由: 不匹配目标类的父框是路由跳过 (非几何), 不计入 skipped_geometry。
        if filter_set is not None and box_class_name(box) not in filter_set:
            continue
        cache_key = (idx, round(pad, 4))
        if cache is not None and cache_key in cache:
            inputs.append(cache[cache_key])
            continue
        # 几何门控: 非 bbox / 旋转框 / 退化框 → 本阶段无法裁 crop, 计入 skipped_geometry。
        if box.get("type") != "rectanglelabels":
            skipped_geometry += 1
            continue
        px = _bbox_pixels_from_ls_value(box.get("value") or {}, img_w, img_h)
        if px is None:
            skipped_geometry += 1
            continue
        left, top, right, bottom = px
        bw = right - left
        bh = bottom - top
        if bw <= 0 or bh <= 0:
            skipped_geometry += 1
            continue
        left = max(0.0, left - bw * pad)
        top = max(0.0, top - bh * pad)
        right = min(float(img_w), right + bw * pad)
        bottom = min(float(img_h), bottom + bh * pad)
        crop = image.crop((int(left), int(top), int(round(right)), int(round(bottom))))
        if crop.width <= 0 or crop.height <= 0:
            skipped_geometry += 1
            continue
        buf = io.BytesIO()
        crop.convert("RGB").save(buf, format="JPEG", quality=jpeg_quality)
        jpeg_bytes = buf.getvalue()
        if delivery == "presigned":
            if upload_fn is None:
                raise ValueError("delivery='presigned' 需要 upload_fn")
            file_path = upload_fn(idx, jpeg_bytes)
        else:
            file_path = "data:image/jpeg;base64," + base64.b64encode(
                jpeg_bytes
            ).decode("ascii")
        inp = {"id": str(idx), "file_path": file_path}
        if cache is not None:
            cache[cache_key] = inp
        inputs.append(inp)
    return CropBatch(inputs=inputs, skipped_geometry=skipped_geometry)


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
