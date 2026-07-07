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

import logging
import math
import os
import tempfile
import time
from typing import Any

import re

import numpy as np
from aap_backend_runtime import fetch_image
from fastapi import HTTPException

from model_registry import (
    POOL_TASK_OPENVOCAB,
    POOL_TASK_OPENVOCAB_VP,
    openvocab_family,
)
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


_PE_CACHE_PER_MODEL = 16  # claude[bot] P2 · 开词表 PE 缓存上限 (每模型 LRU)。


def _ensure_open_classes(model: Any, classes: list[str], family: str) -> None:
    """把开放词表写入模型. 同一组类名 (含顺序) 已设过则跳过, 省去 CLIP/MobileCLIP 重复编码.

    批量同一 prompt 跑 N 图时只编码一次; YOLOE 另存 PE 字典, 切换 prompt 再切回也命中.

    claude[bot] P2 · PE 缓存改用 OrderedDict 做 LRU (上限 _PE_CACHE_PER_MODEL):
    多变文本提示场景此前会无界增长直到模型句柄被外层 LRU 淘汰; 加上限避免内存爆炸。
    """
    key = tuple(classes)
    if getattr(model, "_aap_classes", None) == key:
        return
    if family == "yoloe":
        from collections import OrderedDict  # noqa: PLC0415

        cache = getattr(model, "_aap_pe_cache", None)
        if not isinstance(cache, OrderedDict):
            cache = OrderedDict()
        pe = cache.get(key)
        if pe is None:
            pe = model.get_text_pe(list(classes))
            cache[key] = pe
            while len(cache) > _PE_CACHE_PER_MODEL:
                cache.popitem(last=False)
        else:
            cache.move_to_end(key)
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


def _bbox_to_rectanglelabels(
    x1: float, y1: float, x2: float, y2: float,
    cls_name: str, score: float, img_w: int, img_h: int,
    normalized: bool = False,
) -> dict[str, Any]:
    # 批量入库走 Label Studio 百分比 (0-100); 交互候选浮层 (sam3/gsam2 约定) 走归一化 (0-1)。
    # 同一 emit 两种消费方坐标系不同, 由调用方按 wire (批量/交互) 指定 normalized。
    s = 1.0 if normalized else 100.0
    return {
        "type": "rectanglelabels",
        "value": {
            "x": (x1 / img_w) * s,
            "y": (y1 / img_h) * s,
            "width": ((x2 - x1) / img_w) * s,
            "height": ((y2 - y1) / img_h) * s,
            "rectanglelabels": [cls_name],
        },
        "score": score,
    }


def _polygon_to_polygonlabels(
    points_xy: list[tuple[float, float]],
    cls_name: str, score: float, img_w: int, img_h: int,
    normalized: bool = False,
) -> dict[str, Any] | None:
    """ultralytics mask 已经吐出 polygon 点列 (像素), 这里只做缩放.
    normalized=False → 百分比 (批量入库); True → 0-1 (交互候选浮层)。"""
    if len(points_xy) < 3:
        return None
    s = 1.0 if normalized else 100.0
    pts = [[(x / img_w) * s, (y / img_h) * s] for x, y in points_xy]
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

        # v0.18.23 · YOLOE visual prompt exemplar: type=exemplar, 框样例 → 找全图同类.
        if task == "exemplar":
            return await self._predict_visual_prompt(file_path, ctx)

        # v0.21.1 · 检测式视频追踪: type=tracker, 整段视频 → ultralytics model.track → 聚合轨迹.
        if task == "tracker":
            return await self._predict_tracker(file_path, ctx)

        model, cache_hit, load_ms = await self._pool.get(task, variants.series, variants.size)
        img = fetch_image(file_path)
        img_w, img_h = img.size

        t0 = time.time()
        # v0.14.17 · 类别白名单: 非空时传 ultralytics classes= 只检出选中 index (原生过滤, 不后处理).
        class_filter = getattr(ctx, "classes", None) or None
        # 显式传 device=模型实际所在设备: model 已由 _build_model 放到有效设备 (CUDA 坏时是 CPU),
        # 若不传, ultralytics 会因 torch.cuda.is_available()==True 自动选回 cuda:0 → 硬 500。
        results = model.predict(
            img,
            conf=params.conf,
            iou=params.iou,
            max_det=params.max_det,
            classes=class_filter,
            device=str(model.device),
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

        # claude[bot] P2 · YOLO-World 无分割头, 请求 mask/both 此前静默降级回 box; 改为 422,
        # 让上游知道这个组合不被支持 (与 /setup.supported_text_outputs=["box"] 声明一致)。
        if family == "world" and ctx.output in ("mask", "both"):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"YOLO-World ({series}) 仅支持 output='box' "
                    f"(无分割头), 收到 output='{ctx.output}'。"
                ),
            )

        model, cache_hit, load_ms = await self._pool.get(
            POOL_TASK_OPENVOCAB, series, size
        )
        img = fetch_image(file_path)
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
            device=str(model.device),
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

    async def _predict_visual_prompt(
        self, file_path: str, ctx: Context
    ) -> tuple[list[dict[str, Any]], bool, int | None, int]:
        """YOLOE visual prompt exemplar (v0.18.23): 框样例 → 找全图同类 → box / mask.

        统一用 ``YOLOEVPSegPredictor`` (在 ``-seg`` 权重上同时产出 box + masks; 若强用
        ``YOLOEVPDetectPredictor`` 会在 NMS 收到 seg 头的 tuple 输出而崩)。**同图样例**:
        ``refer_image`` 必须显式传 (= source 自身), 缺省 None 会得 0 结果。

        独立 pool key (POOL_TASK_OPENVOCAB_VP): 与文本句柄隔离, 避免 VP 改写模型状态污染
        文本 PE 缓存。MVP 单类 (cls 全 0), 仅取正框 (label=True), 无负框 / 跨图。
        """
        from ultralytics.models.yolo.yoloe.predict import (  # noqa: PLC0415
            YOLOEVPSegPredictor,
        )

        variants: Variants = ctx.variants
        series, size = variants.series, variants.size

        model, cache_hit, load_ms = await self._pool.get(
            POOL_TASK_OPENVOCAB_VP, series, size
        )
        img = fetch_image(file_path)
        img_w, img_h = img.size

        # 仅取正框 (YOLOE 无负框), 归一化 xyxy → 像素.
        exemplars = ctx.exemplars or []
        pos_boxes = [
            [e.bbox[0] * img_w, e.bbox[1] * img_h, e.bbox[2] * img_w, e.bbox[3] * img_h]
            for e in exemplars
            if e.label and len(e.bbox) == 4
        ]
        if not pos_boxes:
            # 无正框样例: 不推理, 返回空 (会话首拖前 / 仅负框的退化, 不报错).
            return [], cache_hit, load_ms, 0

        visual_prompts = {
            "bboxes": np.array(pos_boxes, dtype=float),
            "cls": np.zeros(len(pos_boxes), dtype=int),  # MVP 单类 object.
        }
        conf = ctx.score_threshold if ctx.score_threshold is not None else ctx.params.conf

        t0 = time.time()
        results = model.predict(
            img,
            visual_prompts=visual_prompts,
            refer_image=img,  # 同图: refer 必须显式 = source, 否则 0 结果.
            predictor=YOLOEVPSegPredictor,
            conf=conf,
            iou=ctx.params.iou,
            max_det=ctx.params.max_det,
            device=str(model.device),
            verbose=False,
        )
        elapsed = time.time() - t0
        record_inference(POOL_TASK_OPENVOCAB_VP, series, size, elapsed)
        inference_ms = int(elapsed * 1000)

        if not results:
            return [], cache_hit, load_ms, inference_ms
        r0 = results[0]
        names: dict[int, str] = getattr(r0, "names", {}) or getattr(model, "names", {})

        # exemplar 输出形态 box/mask/both (VPSeg 同时产出, 按 output 取用)。output 受
        # Literal 约束恒为三者之一, 直接读即可 (无需文本路径那种 not want_mask 兜底)。
        want_mask = ctx.output in ("mask", "both")
        want_box = ctx.output in ("box", "both")
        # exemplar 是交互单数 wire, 候选走前端浮层 (SamCandidateOverlay) → 坐标须归一化 0-1
        # (与 sam3/gsam2 交互候选一致); 批量入库的百分比仅用于闭集四 task / 文本批量路径。
        items: list[dict[str, Any]] = []
        if want_box:
            items += _emit_detection(r0, names, img_w, img_h, normalized=True)
        if want_mask:
            items += _emit_segmentation(r0, names, img_w, img_h, normalized=True)
        return items, cache_hit, load_ms, inference_ms

    async def _predict_tracker(
        self, file_path: str, ctx: Context
    ) -> tuple[list[dict[str, Any]], bool, int | None, int]:
        """v0.21.1 · 检测式视频追踪 (detect-then-track). 整段视频喂 ultralytics
        ``model.track(stream=True)``, 逐帧收 ``boxes.id``, 按 track_id 聚合成
        ``video_track_bbox`` item (每项一条已聚合轨迹, 平台不再做时间关联)。

        - 复用 detection 权重 (pool key task=tracker → MODEL_MATRIX 别名解出 det 权重)。
        - 坐标**直接归一 0-1** (对齐 VideoTrackKeyframe + 平台"直信 0-1 不做百分比探测"约定)。
        - track_id 返回 ultralytics 原生 int; 平台 ingestion 再映射成 ``trk_<uuid>``。
        - 首版**单次整段** track (不分窗), 帧数超 ``YOLO_TRACKER_MAX_FRAMES`` 截断并 log
          (不静默丢), 避免长视频爆内存 / 超时。
        """
        variants: Variants = ctx.variants
        params = ctx.params
        model, cache_hit, load_ms = await self._pool.get(
            "tracker", variants.series, variants.size
        )
        tracker_yaml = f"{params.tracker}.yaml"  # bytetrack.yaml / botsort.yaml (ultralytics 内建)
        class_filter = getattr(ctx, "classes", None) or None
        max_frames = int(os.environ.get("YOLO_TRACKER_MAX_FRAMES", "900"))

        video_path, cleanup = _fetch_video(file_path)
        # track_id → {class_counts, scores, keyframes[]} 聚合累加器。
        tracks: dict[int, dict[str, Any]] = {}
        frame_idx = 0
        truncated = False
        t0 = time.time()
        try:
            # persist=False: 每段视频独立起追 —— 池化 model 可能残留上一段视频的 tracker 状态,
            # persist=True 会错误续接上一段的 track_id。单次整段一个 track() 调用内, 帧间状态天然
            # 保持, 无需 persist。
            stream = model.track(
                source=video_path,
                stream=True,
                persist=False,
                tracker=tracker_yaml,
                conf=params.conf,
                iou=params.iou,
                classes=class_filter,
                device=str(model.device),
                verbose=False,
            )
            for r in stream:
                if frame_idx >= max_frames:
                    truncated = True
                    break
                _accumulate_track_frame(r, frame_idx, tracks)
                frame_idx += 1
        finally:
            if cleanup:
                _safe_unlink(video_path)
        elapsed = time.time() - t0
        record_inference("tracker", variants.series, variants.size, elapsed)
        inference_ms = int(elapsed * 1000)
        if truncated:
            logger.warning(
                "tracker 视频超帧上限 %d, 已截断 (track_id 数=%d); 首版单次整段限制, "
                "长视频请拆分或调高 YOLO_TRACKER_MAX_FRAMES",
                max_frames,
                len(tracks),
            )
        return _emit_tracks(tracks), cache_hit, load_ms, inference_ms


# ── v0.21.1 · 检测式视频追踪辅助 ──────────────────────────────────────────────


def _fetch_video(file_path: str) -> tuple[str, bool]:
    """把视频取到本地路径供 ultralytics ``model.track(source=path)`` 消费.

    返回 ``(path, cleanup)``: http(s) presigned URL 下载到临时文件 (cleanup=True, 用后删);
    本地绝对路径 / ``file://`` 原样返回 (cleanup=False)。与 fetch_image 的来源并集对齐,
    但视频不进内存 (交给 ultralytics 解帧), 故落磁盘临时文件而非 PIL。
    """
    from urllib.parse import urlparse  # noqa: PLC0415

    parsed = urlparse(file_path)
    if parsed.scheme in ("http", "https"):
        import httpx  # noqa: PLC0415

        suffix = os.path.splitext(parsed.path)[1] or ".mp4"
        fd, tmp = tempfile.mkstemp(suffix=suffix, prefix="yolo-track-")
        try:
            with os.fdopen(fd, "wb") as f, httpx.stream(
                "GET", file_path, timeout=60.0, follow_redirects=True
            ) as resp:
                resp.raise_for_status()
                for chunk in resp.iter_bytes(chunk_size=1 << 20):
                    f.write(chunk)
        except Exception:
            _safe_unlink(tmp)
            raise
        return tmp, True
    if parsed.scheme == "file":
        return parsed.path, False
    return file_path, False


def _safe_unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _accumulate_track_frame(r: Any, frame_idx: int, tracks: dict[int, dict[str, Any]]) -> None:
    """把一帧 ultralytics Results 的带 id 检测框累加进 track 聚合器 (id=None 的帧/框跳过)。"""
    boxes = getattr(r, "boxes", None)
    if boxes is None or getattr(boxes, "id", None) is None:
        return
    h, w = r.orig_shape  # (height, width) 像素
    if not w or not h:
        return
    ids = boxes.id.int().cpu().tolist()
    xyxy = boxes.xyxy.cpu().numpy() if hasattr(boxes.xyxy, "cpu") else boxes.xyxy
    confs = boxes.conf.cpu().numpy() if hasattr(boxes.conf, "cpu") else boxes.conf
    clss = boxes.cls.int().cpu().tolist() if hasattr(boxes.cls, "cpu") else [int(c) for c in boxes.cls]
    names: dict[int, str] = getattr(r, "names", {}) or {}
    for i, tid in enumerate(ids):
        x1, y1, x2, y2 = (float(v) for v in xyxy[i])
        # 归一 0-1 + clamp (防越界的亚像素/负值污染下游)。
        bbox = {
            "x": min(max(x1 / w, 0.0), 1.0),
            "y": min(max(y1 / h, 0.0), 1.0),
            "w": min(max((x2 - x1) / w, 0.0), 1.0),
            "h": min(max((y2 - y1) / h, 0.0), 1.0),
        }
        score = float(confs[i])
        entry = tracks.setdefault(tid, {"class_counts": {}, "scores": [], "keyframes": []})
        entry["keyframes"].append({"frame_index": frame_idx, "bbox": bbox, "score": score})
        cls_name = names.get(clss[i], str(clss[i]))
        entry["class_counts"][cls_name] = entry["class_counts"].get(cls_name, 0) + 1
        entry["scores"].append(score)


def _emit_tracks(tracks: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    """聚合器 → ``video_track_bbox`` result item 列表 (track_id 升序稳定输出)。

    class_name 取该轨迹跨帧多数票 (类别可能逐帧抖动); score 取帧置信度均值。
    """
    items: list[dict[str, Any]] = []
    for tid in sorted(tracks):
        entry = tracks[tid]
        counts: dict[str, int] = entry["class_counts"]
        class_name = max(counts, key=lambda k: counts[k]) if counts else ""
        scores: list[float] = entry["scores"]
        track_score = sum(scores) / len(scores) if scores else 0.0
        items.append(
            {
                "type": "video_track_bbox",
                "track_id": int(tid),  # ultralytics 原生 int; 平台 ingestion 映射 trk_<uuid>
                "class_name": class_name,
                "score": track_score,
                "keyframes": entry["keyframes"],
            }
        )
    return items


def _emit_detection(
    r0: Any, names: dict[int, str], img_w: int, img_h: int, normalized: bool = False,
) -> list[dict]:
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
            x1, y1, x2, y2, cls_name, float(confs[i]), img_w, img_h, normalized=normalized
        ))
    return out


def _emit_segmentation(
    r0: Any, names: dict[int, str], img_w: int, img_h: int, normalized: bool = False,
) -> list[dict]:
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
        item = _polygon_to_polygonlabels(pts, cls_name, score, img_w, img_h, normalized=normalized)
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
