from __future__ import annotations

import json
import logging
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import datetime, timezone

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.annotation import Annotation
from app.db.models.dataset import DatasetItem
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus
from app.services.annotation_propagation import _new_track_id
from app.services.gpu_arbitration.contracts import (
    GPUDispatchContextFactory,
    GPUShadowSessionFactory,
    gpu_arbiter_failure_record,
)
from app.services.ml_backend import MLBackendService
from app.services.raster_mask_storage import (
    load_coco_rle,
    store_coco_rle,
    validate_mask_geometry_for_task,
    lock_raster_mask_references,
)
from app.services.storage import resolve_task_url
from app.services.video_frame_service import derive_step
from app.services.video_tracking.adapters import (
    TrackerContext,
    TrackerFrameResult,
    get_tracker_adapter,
)
from app.services.video_tracks import is_polygon_track
from app.services.video_tracks import is_mask_track, resolve_track_at_frame
from app.utils.raster_mask_rle import coco_rle_bbox_norm

log = logging.getLogger(__name__)

TrackerEventPublisher = Callable[[str, dict], Awaitable[None]]
MAX_TRACKER_STAGED_BYTES = 64 * 1024 * 1024

# v0.22.2 · B-combo · 发现趟窗口帧数。multiplex 需多帧传播才在种子帧填充 obj_id (单帧窗
# 不出检测), 故发现趟跑这么多帧但只取种子帧的框铸种; 取小值以压低 multiplex 显存与耗时。
COMBO_DISCOVERY_WINDOW_FRAMES = 5


class TrackerJobStateConflict(ValueError):
    """Requested review action is incompatible with the current job state."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def publish_tracker_event(channel: str, payload: dict) -> None:
    redis = aioredis.from_url(settings.redis_url)
    try:
        await redis.publish(channel, json.dumps(payload))
    except Exception as exc:
        log.warning(
            "video tracker event publish failed channel=%s err=%s", channel, exc
        )
    finally:
        try:
            await redis.close()
        except Exception:
            pass


def _event(job: VideoTrackerJob, type_: str, **extra: object) -> dict:
    return {
        "type": type_,
        "job_id": str(job.id),
        "task_id": str(job.task_id),
        "dataset_item_id": str(job.dataset_item_id),
        "annotation_id": str(job.annotation_id),
        "at": _now().isoformat(),
        **extra,
    }


def _normalize_bbox(geometry: dict) -> dict:
    return {
        "x": float(geometry.get("x", 0)),
        "y": float(geometry.get("y", 0)),
        "w": float(geometry.get("w", geometry.get("width", 0))),
        "h": float(geometry.get("h", geometry.get("height", 0))),
    }


def _normalize_points(geometry: dict) -> list[list[float]]:
    """result geometry ({type:"polygon", points:[[x,y],...]}) → 归一化顶点列表。"""
    points = geometry.get("points") or []
    return [[float(p[0]), float(p[1])] for p in points if len(p) >= 2]


def _materialize_tracker_mask_result(result: TrackerFrameResult) -> TrackerFrameResult:
    geometry = result.geometry or {}
    if geometry.get("type") != "mask":
        return result
    rle = geometry.get("rle")
    if not isinstance(rle, dict):
        raise ValueError("tracker mask result requires geometry.rle")
    reference = store_coco_rle(rle)
    bbox = coco_rle_bbox_norm(rle)
    return replace(
        result,
        geometry={"type": "mask", "mask": reference, "bbox": bbox},
        outside=result.outside or not bbox,
    )


def _tracker_result_json_bytes(result: TrackerFrameResult) -> int:
    return len(
        json.dumps(_serialize_results([result])[0], separators=(",", ":")).encode()
    )


def _mask_track_seed_geometry(geometry: dict, frame_index: int) -> dict:
    resolved = resolve_track_at_frame(geometry, frame_index)
    if resolved is None:
        return geometry
    rle = load_coco_rle(resolved.get("mask") or {})
    bbox = coco_rle_bbox_norm(rle)
    return {"type": "bbox", **bbox} if bbox else geometry


def _tracker_windows(job: VideoTrackerJob) -> list[tuple[int, int]]:
    size = max(1, int(settings.video_tracker_window_size_frames))
    # sam3 两档视频模型都用更小分窗(不动 sam2 的窗口, 避免回归其长程记忆):
    # - sam3_video(multiplex): 视频前向显存随窗口线性增长, 大窗 OOM@24GB。
    # - sam3_video_interactive(PVS): backend wrapper 上限 SAM3_PVS_MAX_WINDOW_FRAMES(默认 16),
    #   超限会被 backend 拒; PVS 是 SAM2 式 memory 传播、显存轻于 multiplex, 但先与之齐。
    # v0.22.2 · B-combo · sam3_video_combo 追踪趟走 PVS, 用与 PVS 齐的小分窗。
    if job.model_key in ("sam3_video", "sam3_video_interactive", "sam3_video_combo"):
        size = min(size, max(1, int(settings.video_tracker_sam3_window_size_frames)))
    windows = []
    start = job.from_frame
    while start <= job.to_frame:
        end = min(job.to_frame, start + size - 1)
        windows.append((start, end))
        start = end + 1
    if job.direction == "backward":
        windows.reverse()
    return windows


def _source_keyframe(annotation: Annotation, job: VideoTrackerJob) -> dict:
    geometry = annotation.geometry or {}
    frame_index = int(geometry.get("frame_index", job.from_frame))
    return {
        "frame_index": frame_index,
        "bbox": _normalize_bbox(geometry),
        "source": "manual",
        "occluded": False,
    }


def _coerce_video_track_geometry(
    annotation: Annotation, job: VideoTrackerJob, target_kind: str
) -> dict:
    geometry = annotation.geometry or {}
    track_id = str(annotation.track_id or geometry.get("track_id") or _new_track_id())
    target_type = {
        "polygon": "video_track_polygon",
        "mask": "video_track_mask",
    }.get(target_kind, "video_track_bbox")
    if geometry.get("type") == target_type:
        return {
            "type": target_type,
            "track_id": track_id,
            "keyframes": [dict(item) for item in geometry.get("keyframes") or []],
            "outside": [dict(item) for item in geometry.get("outside") or []],
        }
    if target_kind in {"polygon", "mask"}:
        return {
            "type": target_type,
            "track_id": track_id,
            "keyframes": [],
            "outside": [],
        }
    return {
        "type": "video_track_bbox",
        "track_id": track_id,
        "keyframes": [_source_keyframe(annotation, job)],
        "outside": [],
    }


def _merge_outside_ranges(existing: list[dict], frames: list[int]) -> list[dict]:
    ranges = [dict(item) for item in existing]
    if not frames:
        return ranges

    start = previous = frames[0]
    for frame_index in frames[1:]:
        if frame_index == previous + 1:
            previous = frame_index
            continue
        ranges.append({"from": start, "to": previous, "source": "prediction"})
        start = previous = frame_index
    ranges.append({"from": start, "to": previous, "source": "prediction"})
    return ranges


def apply_tracker_results(
    annotation: Annotation,
    job: VideoTrackerJob,
    results: list[TrackerFrameResult],
    grid_step: int = 1,
    output_geometry: str | None = None,
) -> None:
    result_kind = next(
        (
            result.geometry.get("type")
            for result in results
            if not result.outside and isinstance(result.geometry, dict)
        ),
        None,
    )
    if output_geometry in {"bbox", "polygon", "mask"}:
        target_kind = output_geometry
    else:
        target_kind = (
            "mask"
            if result_kind == "mask"
            else "polygon"
            if result_kind == "polygon"
            else "bbox"
        )
    geometry = _coerce_video_track_geometry(annotation, job, target_kind)
    is_polygon = target_kind == "polygon"
    is_mask = target_kind == "mask"
    keyframes = geometry["keyframes"]
    manual_frames = {
        int(item.get("frame_index", 0))
        for item in keyframes
        if item.get("source", "manual") == "manual"
    }
    prediction_by_frame = {
        int(item.get("frame_index", 0)): item
        for item in keyframes
        if item.get("source") != "manual"
    }
    outside_frames: list[int] = []

    for result in results:
        # 采样开启时只回填落在网格上的帧（D2：tracker 仍逐源帧算并用于跨窗续追，
        # 但只持久化网格帧，与导航/导出网格一致，避免编辑器里堆满够不到的关键帧）。
        if grid_step > 1 and result.frame_index % grid_step != 0:
            continue
        if result.outside:
            outside_frames.append(result.frame_index)
            prediction_by_frame.pop(result.frame_index, None)
            continue
        if result.frame_index in manual_frames:
            continue
        if is_mask:
            reference = result.geometry.get("mask")
            bbox = result.geometry.get("bbox") or {}
            if not isinstance(reference, dict) or float(bbox.get("w", 0)) <= 0:
                outside_frames.append(result.frame_index)
                prediction_by_frame.pop(result.frame_index, None)
                continue
            shape_field = {"mask": dict(reference)}
        elif is_polygon:
            points = _normalize_points(result.geometry)
            if len(points) < 3:
                # 退化多边形(顶点<3)当 outside 处理, 避免写坏 schema。
                outside_frames.append(result.frame_index)
                prediction_by_frame.pop(result.frame_index, None)
                continue
            shape_field = {"points": points}
        else:
            shape_field = {"bbox": _normalize_bbox(result.geometry)}
        prediction_by_frame[result.frame_index] = {
            "frame_index": result.frame_index,
            **shape_field,
            "source": "prediction",
            "occluded": False,
        }

    outside_frame_set = set(outside_frames)
    merged = [
        item
        for item in keyframes
        if item.get("source", "manual") == "manual"
        or (
            int(item.get("frame_index", 0)) not in prediction_by_frame
            and int(item.get("frame_index", 0)) not in outside_frame_set
        )
    ]
    merged.extend(prediction_by_frame.values())
    geometry["keyframes"] = sorted(
        merged, key=lambda item: int(item.get("frame_index", 0))
    )
    geometry["outside"] = _merge_outside_ranges(
        geometry.get("outside") or [], sorted(set(outside_frames))
    )

    annotation.geometry = geometry
    annotation.track_id = str(geometry["track_id"])
    annotation.annotation_type = geometry["type"]
    if is_mask:
        annotation.tool_unit_id = "region"
    annotation.version = int(annotation.version or 1) + 1


def _partition_results_by_instance(
    results: list[TrackerFrameResult],
) -> tuple[list[TrackerFrameResult], dict[str, list[TrackerFrameResult]]]:
    """把逐帧结果拆成 (主实例结果, {instance_id: 非主实例结果}) —— 阶段 0 多目标落库。

    模式 a「自动发现」下 backend 一帧可返回多实例。主实例 = 与用户种子对应的那个,
    回填源 annotation; 其余每个 instance_id 各成一条新 track。
    - 无任何 instance_id (单实例老 backend): 全部归主, 与既有单 track 行为等价 (零回归)。
    - 有 instance_id: primary 标记所属的 instance 归主; 若无一标 primary, 取最小的
      instance_id 归主 (数字 id 按数值比较, 否则字典序; 确定性兜底)。同一 instance_id 的
      所有帧整体归属同一去向。
    """
    if all(r.instance_id is None for r in results):
        return list(results), {}

    primary_id = next(
        (r.instance_id for r in results if r.primary and r.instance_id is not None),
        None,
    )
    if primary_id is None:
        # instance_id 契约上是 str(obj_id) (见 _instance_seed_obj_id), 但可能是非数字兜底。
        # 纯数字按数值取 min ("2" < "10"), 否则字典序, 避免 "10" < "2" 挑错主实例。
        primary_id = min(
            (r.instance_id for r in results if r.instance_id is not None),
            key=lambda s: (0, int(s)) if s.isdigit() else (1, s),
        )

    primary: list[TrackerFrameResult] = []
    extras: dict[str, list[TrackerFrameResult]] = {}
    for result in results:
        if result.instance_id is None or result.instance_id == primary_id:
            primary.append(result)
        else:
            extras.setdefault(result.instance_id, []).append(result)
    return primary, extras


# v0.22.2 · M · 多选批量: 单源延展时从结果推断主实例 id, 构造单源 source_map 的键。
_SOLE_SOURCE_KEY = "__sole__"


def _primary_instance_id(results: list[TrackerFrameResult]) -> str | None:
    """单源延展时推断与用户种子对应的主实例 id (primary 标记 → 最小 id → None 全无 id)。
    复用 _partition_results_by_instance 的主实例判定, 供构造单源 source_map。"""
    primary, _ = _partition_results_by_instance(results)
    return primary[0].instance_id if primary else None


def _instance_seed_obj_id(instance_id: str, fallback: int) -> int:
    """把 instance_id 还原成 backend 播种用的 obj_id。PVS 的 instance_id 就是 str(obj_id),
    直接 int; 非数字 (老 backend 兜底) 按序补 fallback。"""
    return int(instance_id) if instance_id.isdigit() else fallback


def _continuation_seeds(last_geom_by_instance: dict[str, dict]) -> list[dict]:
    """多目标跨窗续追种子: 每个实例用其上一窗末帧几何 + 同一 obj_id 重播种下一窗。

    v0.21.27 · U-pvs-1 · seed-驱动 tracker (PVS) 每窗是独立会话, 若只续主实例, 非主实例
    过一窗即丢。这里对**每个**实例各下发一条 seed (obj_id 与其 instance_id 一致 → 跨窗身份
    稳定); backend seeds 支持 geometry (自动取外接框)。text-驱动 multiplex 同样把这些框作为
    下一窗正提示，并继续按 text 发现目标。
    """
    return [
        {"obj_id": _instance_seed_obj_id(iid, idx + 1), "geometry": geom}
        for idx, (iid, geom) in enumerate(sorted(last_geom_by_instance.items()))
    ]


# ── v0.22.2 · B-combo · multiplex 发现 → PVS 种子铸造 ──────────────────────
# combo (sam3_video_combo) 两趟编排的桥: 发现趟 (multiplex 按 text 在种子帧检测) 的
# per-obj 结果 → 追踪趟 (PVS) 的逐对象种子。发现对象**无源** → 种子不带
# source_annotation_id, 落库走成熟的无源新建 (source_map 为空 → 全部 _new_discovered_track)。


def _combo_seeds_from_discovery(
    discovery_results: list["TrackerFrameResult"],
    *,
    seed_frame: int,
) -> list[dict]:
    """发现趟结果 → PVS 种子 (逐对象一条, obj_id=1..N, geometry=发现框)。

    multiplex 需多帧传播才会在**种子帧**填充检测 (单帧窗不出 obj_id), 故发现趟跑一小窗但
    只取 seed_frame 这一帧的 per-obj 框铸种 (传播帧仅为让模型锁定对象)。按 instance_id 稳定
    排序后逐个铸成 PVS 种子 (obj_id 连续从 1 起, 与 _instance_seed_obj_id 契约一致), geometry
    直接用发现框 (PVS backend seeds 支持 geometry, 自动取外接框)。outside / 空框跳过。种子
    不带 source_annotation_id → 落库全部新建。
    """
    seeds: list[dict] = []
    obj = 1
    for result in sorted(
        discovery_results, key=lambda r: (r.instance_id or "", r.frame_index)
    ):
        if result.frame_index != seed_frame or result.outside or not result.geometry:
            continue
        seeds.append({"obj_id": obj, "geometry": result.geometry})
        obj += 1
    return seeds


# ── v0.21.28 · B-mx · text-multiplex 跨窗 IoU 关联 ─────────────────────────
# multiplex (sam3_video) 按 text 每窗独立会话重检测, 窗内 obj_id 稳定但**跨窗局部**
# (窗 N 的 obj "1" 与窗 N-1 的 obj "1" 未必同物)。平台在窗边界帧按 IoU 关联, 把窗内
# obj_id remap 成跨窗稳定的全局 instance_id (未匹配 → 新 track), 供阶段 0 分组落库。


def _bbox_of_geometry(geom: dict) -> tuple[float, float, float, float]:
    """任意 geometry → 归一化 (x, y, w, h) 外接框; 取不到 → 零框。"""
    if not isinstance(geom, dict):
        return (0.0, 0.0, 0.0, 0.0)
    if geom.get("type") == "polygon":
        pts = geom.get("points") or []
        xs = [float(p[0]) for p in pts if len(p) >= 2]
        ys = [float(p[1]) for p in pts if len(p) >= 2]
        if not xs or not ys:
            return (0.0, 0.0, 0.0, 0.0)
        return (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
    if geom.get("type") == "mask":
        bbox = geom.get("bbox") or {}
        return (
            float(bbox.get("x", 0.0)),
            float(bbox.get("y", 0.0)),
            float(bbox.get("w", 0.0)),
            float(bbox.get("h", 0.0)),
        )
    return (
        float(geom.get("x", 0.0)),
        float(geom.get("y", 0.0)),
        float(geom.get("w", geom.get("width", 0.0))),
        float(geom.get("h", geom.get("height", 0.0))),
    )


def _geom_iou(g1: dict, g2: dict) -> float:
    """两 geometry 外接框的 IoU (归一化坐标)。任一零框 → 0。"""
    x1, y1, w1, h1 = _bbox_of_geometry(g1)
    x2, y2, w2, h2 = _bbox_of_geometry(g2)
    if w1 <= 0 or h1 <= 0 or w2 <= 0 or h2 <= 0:
        return 0.0
    ix1, iy1 = max(x1, x2), max(y1, y2)
    ix2, iy2 = min(x1 + w1, x2 + w2), min(y1 + h1, y2 + h2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = w1 * h1 + w2 * h2 - inter
    return inter / union if union > 0 else 0.0


def _associate_multiplex_window(
    window_results: list[TrackerFrameResult],
    prev_boundary: dict[str, dict],
    next_global: list[int],
    iou_threshold: float = 0.3,
) -> list[TrackerFrameResult]:
    """把一窗 text-multiplex 结果的窗内 instance_id remap 成跨窗稳定的全局 id。

    每个窗内实例的**边界帧**(组内首个非 outside 结果 = 传播起点, 与上一窗相邻)几何与
    ``prev_boundary``(上一窗每全局实例的末帧几何)按 IoU 贪心匹配; ≥阈值则复用该全局 id,
    否则分配新全局 id。``prev_boundary`` 就地更新为本窗每全局实例的**末帧**几何(供下一窗
    匹配)。primary 标记随结果保留(replace 只改 instance_id)。
    """
    by_local: dict[str, list[TrackerFrameResult]] = defaultdict(list)
    for r in window_results:
        by_local[r.instance_id or "0"].append(r)
    remap: dict[str, str] = {}
    used: set[str] = set()
    for local_id, group in by_local.items():
        head = next((r for r in group if not r.outside and r.geometry), None)
        gid: str | None = None
        if head is not None and prev_boundary:
            best = iou_threshold
            for cand_gid, geom in prev_boundary.items():
                if cand_gid in used:
                    continue
                iou = _geom_iou(head.geometry, geom)
                if iou >= best:
                    best, gid = iou, cand_gid
        if gid is None:
            gid = str(next_global[0])
            next_global[0] += 1
        used.add(gid)
        remap[local_id] = gid
    remapped = [
        replace(r, instance_id=remap[r.instance_id or "0"]) for r in window_results
    ]
    new_boundary: dict[str, dict] = {}
    for r in remapped:  # yield 序: 末帧最后写入 → 与下一窗相邻的边界
        if not r.outside and r.geometry and r.instance_id:
            new_boundary[r.instance_id] = r.geometry
    # 本窗全 outside / 空产出 (短暂遮挡 / backend 空窗) 时保留上一窗边界: 否则遮挡帧会把
    # 跨窗身份抹掉, 下一窗所有实例被当作新发现 → 同一物体在遮挡后被拆成两条轨迹。
    if new_boundary:
        prev_boundary.clear()
        prev_boundary.update(new_boundary)
    return remapped


@dataclass(frozen=True)
class _TrackTarget:
    """新建轨迹的归属模板: 有源延展取自源轨迹, 无源检测取自 job 的显式目标类别。"""

    task_id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID | None
    class_name: str
    tool_unit_id: str


def _target_from_source(source: Annotation) -> _TrackTarget:
    return _TrackTarget(
        task_id=source.task_id,
        project_id=source.project_id,
        user_id=source.user_id,
        class_name=source.class_name,
        tool_unit_id=source.tool_unit_id,
    )


def _target_from_job(job: VideoTrackerJob, task: Task) -> _TrackTarget:
    # v0.22.1 · B · 无源检测: 类别由 job.target_* 显式指定 (缺省兜底空类 / bbox 单位)。
    return _TrackTarget(
        task_id=job.task_id,
        project_id=task.project_id,
        user_id=job.created_by,
        class_name=job.target_class_name or "",
        tool_unit_id=job.target_tool_unit_id or "bbox",
    )


def _seed_source_map(job: VideoTrackerJob) -> dict[str, uuid.UUID]:
    """从 job.prompt.seeds 读 {instance_id: 源 annotation id} —— v0.22.2 · M · 多选批量。

    每个 seed 可带 source_annotation_id (该 obj 延展哪条已有轨迹); 无该字段的 seed
    (无源检测 / B-combo 发现) 不入映射。instance_id 契约 = str(obj_id)。
    """
    seeds = ((job.prompt or {}).get("seeds")) or []
    mapping: dict[str, uuid.UUID] = {}
    for seed in seeds:
        if not isinstance(seed, dict):
            continue
        src = seed.get("source_annotation_id")
        obj_id = seed.get("obj_id")
        if not src or obj_id is None:
            continue
        try:
            mapping[str(obj_id)] = uuid.UUID(str(src))
        except (ValueError, TypeError):
            continue
    return mapping


def _new_discovered_track(target: _TrackTarget, output_geometry: str) -> Annotation:
    """为一个新发现的实例建一条空 video_track annotation。

    归属由 _TrackTarget 提供 (有源继承源 label, 无源用 job 显式目标类别), 标
    source="ai_tracker" (与批量预标 prediction_based 区分, 不被批量清理误删), 新 track_id
    走统一工厂 _new_track_id()。几何先空, 由 apply_tracker_results 填预测帧。
    """
    track_id = _new_track_id()
    geom_type = {
        "polygon": "video_track_polygon",
        "mask": "video_track_mask",
    }.get(output_geometry, "video_track_bbox")
    return Annotation(
        id=uuid.uuid4(),
        task_id=target.task_id,
        project_id=target.project_id,
        user_id=target.user_id,
        source="ai_tracker",
        annotation_type=geom_type,
        tool_unit_id="region" if output_geometry == "mask" else target.tool_unit_id,
        class_name=target.class_name,
        geometry={
            "type": geom_type,
            "track_id": track_id,
            "keyframes": [],
            "outside": [],
        },
        track_id=track_id,
    )


def _persist_tracker_results(
    db: AsyncSession,
    source_map: dict[str, Annotation],
    target: _TrackTarget,
    job: VideoTrackerJob,
    results: list[TrackerFrameResult],
    grid_step: int,
    output_geometry: str,
) -> list[Annotation]:
    """落库逐帧结果: 按 instance_id 分组, 命中 source_map 的实例回填对应源 annotation,
    未命中的每个 instance 各建一条新 track。

    source_map 语义 (instance_id → 源 annotation):
    - 单源延展 (0.22.1 及以前): 恰一个条目 {主实例 id: 源};
    - 多源批量 (v0.22.2 · M · 多选): N 个条目 {obj_id: 各自源}, 各回填各源;
    - 无源检测 / B-combo 发现: 空映射, 全部新建 (归属取自 target)。

    无 instance_id 的老单实例 backend: 整体回填 source_map 的唯一源 (若有), 否则新建 ——
    与既有单 track 行为等价, 零回归。返回新建的 annotation 列表 (调用方负责 commit)。
    """
    created: list[Annotation] = []
    if all(r.instance_id is None for r in results):
        sole_source = next(iter(source_map.values()), None)
        if sole_source is not None:
            apply_tracker_results(sole_source, job, results, grid_step, output_geometry)
        else:
            main_ann = _new_discovered_track(target, output_geometry)
            db.add(main_ann)
            apply_tracker_results(main_ann, job, results, grid_step, output_geometry)
            created.append(main_ann)
        return created

    by_instance: dict[str, list[TrackerFrameResult]] = {}
    for result in results:
        by_instance.setdefault(result.instance_id or "", []).append(result)
    for instance_id in sorted(by_instance):
        inst_results = by_instance[instance_id]
        source = source_map.get(instance_id)
        if source is not None:
            apply_tracker_results(source, job, inst_results, grid_step, output_geometry)
        else:
            new_ann = _new_discovered_track(target, output_geometry)
            db.add(new_ann)
            apply_tracker_results(
                new_ann, job, inst_results, grid_step, output_geometry
            )
            created.append(new_ann)
    return created


# ---------- v0.21.28 · 候选/接受流: 暂存 + accept/discard ----------


def _serialize_results(results: list[TrackerFrameResult]) -> list[dict]:
    return [
        {
            "frame_index": r.frame_index,
            "geometry": r.geometry,
            "confidence": r.confidence,
            "outside": r.outside,
            "instance_id": r.instance_id,
            "primary": r.primary,
        }
        for r in results
    ]


def _deserialize_results(rows: list[dict]) -> list[TrackerFrameResult]:
    return [
        TrackerFrameResult(
            frame_index=int(row["frame_index"]),
            geometry=row.get("geometry") or {},
            confidence=row.get("confidence"),
            outside=bool(row.get("outside", False)),
            instance_id=row.get("instance_id"),
            primary=bool(row.get("primary", False)),
        )
        for row in rows
    ]


def _stage_tracker_results(
    job: VideoTrackerJob,
    results: list[TrackerFrameResult],
    grid_step: int,
    output_geometry: str,
) -> None:
    """把逐帧结果暂存进 job.staged_result (候选), **不碰 annotation**。用户接受时反序列化后
    走 _persist_tracker_results 落库。grid_step / output_geometry 一并存, 供 accept 复用同一
    落库逻辑 (无需在 accept 时重新推导)。"""
    staged = {
        "results": _serialize_results(results),
        "grid_step": grid_step,
        "output_geometry": output_geometry,
    }
    if (
        len(json.dumps(staged, separators=(",", ":")).encode())
        > MAX_TRACKER_STAGED_BYTES
    ):
        raise ValueError("tracker_candidate_too_large: staged payload exceeds 64 MiB")
    job.staged_result = staged


async def accept_tracker_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    publisher: TrackerEventPublisher = publish_tracker_event,
) -> VideoTrackerJob | None:
    """接受候选: 把 job.staged_result 应用到 annotation (主实例回填源 + 每个新 instance 各建
    一条 track), status=ACCEPTED。幂等 (已 ACCEPTED 直接返回)。状态不符 / 无 staged → 原样返回。"""
    job = await _load_job_for_update(db, job_id)
    if job is None:
        return None
    if job.status == VideoTrackerJobStatus.ACCEPTED.value:
        await db.commit()
        return job
    staged = job.staged_result or {}
    rows = staged.get("results") or []
    reviewable = job.status in (
        VideoTrackerJobStatus.PENDING_REVIEW.value,
        VideoTrackerJobStatus.CANCELLED.value,
    )
    if not reviewable or not rows:
        current_status = job.status
        await db.rollback()
        raise TrackerJobStateConflict(
            f"Video tracker job cannot be accepted from status {current_status}"
        )
    # v0.22.1 · B · 源轨迹可选 (无源检测 → 全新建); v0.22.2 · M · 多选批量: prompt.seeds
    # 每条可带 source_annotation_id (obj_id ↔ 源轨迹), 各实例回填各自源。
    results = _deserialize_results(rows)
    task = await db.get(Task, job.task_id)
    if task is None:
        await db.rollback()
        raise ValueError("Task not found")
    seed_sources = _seed_source_map(job)
    source_map: dict[str, Annotation] = {}
    if seed_sources:
        # 多源批量: 各 instance 回填各自源; 某源在 job 期间被软删 → 该源 per-source 降级
        # (跳过映射 → 该 instance 落新建), 不整 job 失败。
        for instance_id, ann_id in seed_sources.items():
            ann = await db.get(Annotation, ann_id)
            if ann is not None and ann.is_active:
                source_map[instance_id] = ann
        target = (
            _target_from_source(next(iter(source_map.values())))
            if source_map
            else _target_from_job(job, task)
        )
    elif job.annotation_id is not None:
        # 单源延展 (0.22.1 及以前): 主实例回填源; 整源软删 → 丢弃孤儿候选 (409 告知前端)。
        annotation = await db.get(Annotation, job.annotation_id)
        if annotation is None or not annotation.is_active:
            job.status = VideoTrackerJobStatus.DISCARDED.value
            job.staged_result = None
            await db.commit()
            await db.refresh(job)
            await publisher(job.event_channel, _event(job, "job_discarded"))
            raise TrackerJobStateConflict(
                "Source annotation no longer exists; candidate discarded"
            )
        primary_iid = _primary_instance_id(results)
        source_map = {
            primary_iid if primary_iid is not None else _SOLE_SOURCE_KEY: annotation
        }
        target = _target_from_source(annotation)
    else:
        # 无源检测 (画布级文本/种子发起): 全部新建, 归属取 job 显式目标类别。
        target = _target_from_job(job, task)
    created = _persist_tracker_results(
        db,
        source_map,
        target,
        job,
        results,
        int(staged.get("grid_step", 1)),
        staged.get("output_geometry", "bbox"),
    )
    try:
        for src in source_map.values():
            await validate_mask_geometry_for_task(db, task, src.geometry or {})
        for created_annotation in created:
            await validate_mask_geometry_for_task(
                db, task, created_annotation.geometry or {}
            )
        await lock_raster_mask_references(
            db,
            [
                *(src.geometry or {} for src in source_map.values()),
                *(annotation.geometry or {} for annotation in created),
            ],
        )
    except ValueError:
        await db.rollback()
        raise
    # v0.22.2 · M · 记录本 job 触及的轨迹 id (回填源 + 新建) 供前端刷新/审计。落 job.prompt JSONB
    # (免 DB 迁移); accept 后 job 终态, prompt 不再被 runner 读, 写此键安全。JSONB 须重赋新 dict
    # 才能让 SQLAlchemy 检测到脏 (同一 dict 引用 in-place 改不触发 UPDATE)。
    touched = [str(src.id) for src in source_map.values()] + [
        str(created_annotation.id) for created_annotation in created
    ]
    job.prompt = {**(job.prompt or {}), "touched_annotation_ids": touched}
    job.status = VideoTrackerJobStatus.ACCEPTED.value
    await db.commit()
    await db.refresh(job)
    await publisher(job.event_channel, _event(job, "job_accepted"))
    return job


async def discard_tracker_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    publisher: TrackerEventPublisher = publish_tracker_event,
) -> VideoTrackerJob | None:
    """丢弃可审候选并保持 annotation 零改动；重复丢弃幂等。"""
    job = await _load_job_for_update(db, job_id)
    if job is None:
        return None
    if job.status == VideoTrackerJobStatus.DISCARDED.value:
        await db.commit()
        return job
    staged_rows = (job.staged_result or {}).get("results") or []
    reviewable = job.status in (
        VideoTrackerJobStatus.PENDING_REVIEW.value,
        VideoTrackerJobStatus.CANCELLED.value,
    )
    if not reviewable or not staged_rows:
        current_status = job.status
        await db.rollback()
        raise TrackerJobStateConflict(
            f"Video tracker job cannot be discarded from status {current_status}"
        )
    job.status = VideoTrackerJobStatus.DISCARDED.value
    job.staged_result = None
    await db.commit()
    await db.refresh(job)
    await publisher(job.event_channel, _event(job, "job_discarded"))
    return job


async def _load_job_for_update(
    db: AsyncSession, job_id: uuid.UUID
) -> VideoTrackerJob | None:
    return (
        await db.execute(
            select(VideoTrackerJob)
            .where(VideoTrackerJob.id == job_id)
            .with_for_update()
        )
    ).scalar_one_or_none()


async def _mark_failed(
    db: AsyncSession,
    job_id: uuid.UUID,
    message: str,
    publisher: TrackerEventPublisher,
    *,
    gpu_arbiter_error: dict | None = None,
) -> VideoTrackerJob | None:
    await db.rollback()
    job = await _load_job_for_update(db, job_id)
    if job is None:
        return None
    if job.status != VideoTrackerJobStatus.CANCELLED.value:
        job.status = VideoTrackerJobStatus.FAILED.value
        job.error_message = message[:2000]
        job.staged_result = None
        job.completed_at = _now()
    await db.commit()
    event = _event(job, "job_failed", error=message)
    if gpu_arbiter_error is not None:
        event["gpu_arbiter_error"] = gpu_arbiter_error
    await publisher(job.event_channel, event)
    return job


async def run_tracker_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    publisher: TrackerEventPublisher = publish_tracker_event,
    shadow_session_factory: GPUShadowSessionFactory | None = None,
    dispatch_context_factory: GPUDispatchContextFactory | None = None,
    failure_recorder: Callable[[dict], None] | None = None,
) -> VideoTrackerJob | None:
    job = await _load_job_for_update(db, job_id)
    if job is None:
        return None
    if job.status == VideoTrackerJobStatus.CANCELLED.value:
        await db.commit()
        return job
    if job.status != VideoTrackerJobStatus.QUEUED.value:
        await db.commit()
        return job

    job.status = VideoTrackerJobStatus.RUNNING.value
    job.started_at = job.started_at or _now()
    await db.commit()
    await db.refresh(job)
    await publisher(job.event_channel, _event(job, "job_started"))

    try:
        # v0.22.1 · B · 源轨迹可选: 无源检测 (job.annotation_id is None) 时不加载 source,
        # 种子来自 prompt (text/seeds), 主实例落库时新建。
        annotation = (
            await db.get(Annotation, job.annotation_id) if job.annotation_id else None
        )
        if job.annotation_id and (annotation is None or not annotation.is_active):
            raise ValueError("Annotation not found")
        task = await db.get(Task, job.task_id)
        if task is None:
            raise ValueError("Task not found")
        item = await db.get(DatasetItem, job.dataset_item_id)
        if item is None:
            raise ValueError("Dataset item not found")
        # v0.22.2 · B-combo · sam3_video_combo = multiplex 发现 → PVS 追踪 两趟编排。
        # 两趟都在 sam3-backend (声明 sam3_video + sam3_video_interactive); 后端按 PVS 能力
        # 解析 (同一 backend), 追踪趟 adapter 用 PVS, 发现趟另取 multiplex adapter (见下)。
        is_combo = job.model_key == "sam3_video_combo"
        # v0.21.25 (阶段 R) · 按 tracker 能力选后端而非项目单一绑定: sam3_video 挑声明了
        # sam3_video 的 backend(sam3-backend), 而非静默落到项目绑定的 grounded-sam2。
        tracker_capability = "sam3_video_interactive" if is_combo else job.model_key
        ml_svc = MLBackendService(db)
        backend = await ml_svc.get_tracker_backend_for_capabilities(
            task.project_id,
            ["sam3_video", "sam3_video_interactive"]
            if is_combo
            else [tracker_capability],
        )
        # v0.23.3 ADR-0050 §11 · tracker pins one instance per job (stateful session).
        # 经 MLBackendRouter 取得 job-scope route lease (enforce) 或记录 would-select
        # 证据 (observe); off 模式行为不变 (legacy instance dispatch)。lease 在整个 job
        # 期间按 heartbeat_interval 周期续命, job 结束时 finish/cancel exactly once。
        from app.services.ml_routing.router import MLBackendRouter, make_ledger_from_settings
        from app.services.ml_routing.contracts import RouterMode, RouteOutcome

        tracker_pool_id = None
        tracker_lease = None
        tracker_router = None
        heartbeat_stop = None
        if backend is not None:
            tracker_pool_id = await ml_svc.pool_id_for_registry(backend.id)
        adapter = get_tracker_adapter(tracker_capability)

        # 采样网格步长：只回填网格帧（见 apply_tracker_results）。
        project = await db.get(Project, task.project_id)
        source_fps = ((item.metadata_ or {}).get("video") or {}).get("fps")
        grid_step = derive_step(
            source_fps, (project.video_sampling or {}) if project else {}
        )

        results: list[TrackerFrameResult] = []
        staged_bytes = 0
        total = max(1, job.to_frame - job.from_frame + 1)
        progress = 0
        # v0.23.3 ADR-0050 §11 · 取得 job-scope route lease (enforce) / 记录 would-select
        # (observe)。tracker 整 job pin 一个实例, lease 周期 heartbeat 续命 (不能中途换实例)。
        if backend is not None and tracker_pool_id is not None:
            try:
                _ledger = make_ledger_from_settings() if RouterMode(settings.ml_backend_router_mode) != RouterMode.OFF else None
            except Exception:  # noqa: BLE001 — ledger build failure must not block tracker
                _ledger = None
            tracker_router = MLBackendRouter(db, ledger=_ledger)
            _sel = await tracker_router.acquire(
                tracker_pool_id,
                owner=f"tracker:{job_id}",
                operation="tracker",
                project_id=task.project_id,
            )
            if _sel.rejection is None and _sel.instance_id is not None:
                # off/observe: instance = legacy (unchanged). enforce: router-selected.
                # tracker pins the acquired instance for the whole job (stateful session).
                if _sel.lease is not None:
                    tracker_lease = _sel.lease
                    # heartbeat loop: renew lease periodically until job ends.
                    import asyncio as _asyncio

                    async def _heartbeat_loop():
                        while True:
                            await _asyncio.sleep(
                                settings.ml_backend_router_heartbeat_interval_seconds
                            )
                            if tracker_lease is None:
                                return
                            try:
                                ok = await tracker_router.heartbeat(tracker_lease)
                                if not ok:
                                    return
                            except Exception:  # noqa: BLE001
                                return

                    heartbeat_task = _asyncio.ensure_future(_heartbeat_loop())

                    def heartbeat_stop():
                        heartbeat_task.cancel()

                # observe: record would-select evidence (non-gating).
                if _sel.would_select is not None:
                    log.info(
                        "tracker job %s observe would_select=%s actual=%s pool=%s",
                        job_id, _sel.would_select, _sel.instance_id, tracker_pool_id,
                    )
            # v0.23.3 · pool/instance dual-ID recorded via structured log (audit lineage, §5.4).
            log.info(
                "tracker job %s routed pool=%s instance=%s mode=%s",
                job_id, tracker_pool_id, backend.id, settings.ml_backend_router_mode,
            )
        task_data = {
            "id": str(task.id),
            "file_path": resolve_task_url(task),
            "dataset_item_id": str(item.id),
            "file_name": item.file_name,
            "file_type": item.file_type,
        }

        # Cross-window continuation: window 1 seeds from the original keyframe,
        # each subsequent window seeds from the previous window's last
        # non-outside frame geometry so the tracker keeps following a moving
        # target instead of restarting from the original box every window.
        source_geometry = (annotation.geometry or {}) if annotation else {}
        last_geometry = (
            _mask_track_seed_geometry(source_geometry, job.from_frame)
            if is_mask_track(source_geometry)
            else source_geometry
        )
        # v0.21.27 · U-pvs-1 · 多目标跨窗续追: 记每个实例的末帧 (非 outside) 几何, 后续窗对
        # 每个实例各用其上一窗末帧几何 + 同一 obj_id 重播种 (否则非主实例过一窗即丢)。仅当
        # 有多实例 (backend 发了 ≥2 个 instance_id) 时启用; 单目标 / None-instance 不触发。
        last_geom_by_instance: dict[str, dict] = {}
        # v0.21.28 · B-mx · text-multiplex (sam3_video) 每窗独立会话重检测, 窗内 obj_id 局部;
        # 平台在窗边界帧按 IoU 关联把窗内 id remap 成跨窗稳定的全局 instance_id (未匹配 → 新
        # track)。mp_prev_boundary = 上一窗每全局实例的末帧几何; mp_next_global = 新全局 id 计数。
        associate_multiplex = job.model_key == "sam3_video"
        mp_prev_boundary: dict[str, dict] = {}
        mp_next_global = [1]
        # v0.21.20 · polygon track: 让 backend 逐帧保留 mask 矢量化的多边形而非降 bbox。
        output_geometry = (job.prompt or {}).get("output_geometry") or (
            (
                "mask"
                if is_mask_track(annotation.geometry or {})
                else "polygon"
                if is_polygon_track(annotation.geometry or {})
                else "bbox"
            )
            if annotation
            else "bbox"
        )

        tracker_windows = _tracker_windows(job)
        # v0.21.27 · U-pvs-1 · PVS 点/多目标种子 (画布点 → PVS track) 从 prompt JSONB 读出。
        # 只在种子窗 (首窗, 含原始种子帧) 下发: points 锚在种子帧, 后续窗靠 last_geometry
        # (上一窗末帧框) 续追, 不重发点种子。缺省无 seeds 时行为与 B-pvs 框种子完全一致。
        prompt_seeds = (job.prompt or {}).get("seeds")

        # v0.22.2 · B-combo · 发现趟 (先于追踪窗循环, 串行 → 中间 idle 可卸载 multiplex 再载
        # PVS, 避两模型同容峰值)。multiplex 在种子帧按 text 检测 → per-obj 框 → 铸成 PVS 种子
        # (无源, 落库全新建)。发现不到目标即失败 (无种子无法追踪)。
        if is_combo:
            discovery_text = (job.prompt or {}).get("text")
            if not discovery_text:
                raise ValueError("sam3_video_combo requires prompt.text for discovery")
            # 发现窗从种子帧向后铺 COMBO_DISCOVERY_WINDOW_FRAMES 帧 (受 job 范围与 backend
            # 窗上限约束); multiplex 传播这几帧后在种子帧填充 obj_id, 只取种子帧的框铸种。
            disc_span = min(
                COMBO_DISCOVERY_WINDOW_FRAMES,
                max(1, int(settings.video_tracker_sam3_window_size_frames)),
            )
            disc_to = min(job.to_frame, job.from_frame + disc_span - 1)
            discovery_ctx = TrackerContext(
                job_id=job.id,
                task_id=task.id,
                project_id=task.project_id,
                dataset_item_id=job.dataset_item_id,
                annotation_id=job.annotation_id,
                from_frame=job.from_frame,
                to_frame=disc_to,
                direction="forward",
                prompt=job.prompt or {},
                source_geometry={},
                task_data=task_data,
                ml_backend=backend,
                shadow_session_factory=shadow_session_factory,
                dispatch_context_factory=dispatch_context_factory,
                text=discovery_text,
                exemplars=(job.prompt or {}).get("exemplars"),
                output_geometry=output_geometry,
            )
            discovery_adapter = get_tracker_adapter("sam3_video")
            discovery_results = [
                _materialize_tracker_mask_result(r)
                async for r in discovery_adapter.propagate(discovery_ctx)
            ]
            prompt_seeds = _combo_seeds_from_discovery(
                discovery_results, seed_frame=job.from_frame
            )
            if not prompt_seeds:
                raise ValueError(
                    f"sam3_video_combo discovery found no objects for text: {discovery_text!r}"
                )

        for win_idx, (from_frame, to_frame) in enumerate(tracker_windows):
            # 种子窗下发原始点/框种子; 后续窗若多实例则各自续种 (见 _continuation_seeds),
            # 单实例则靠 source_geometry=last_geometry 兜底 (零回归)。
            if win_idx == 0:
                window_seeds = prompt_seeds or None
            elif len(last_geom_by_instance) > 1:
                window_seeds = _continuation_seeds(last_geom_by_instance)
            else:
                window_seeds = None
            ctx = TrackerContext(
                job_id=job.id,
                task_id=task.id,
                project_id=task.project_id,
                dataset_item_id=job.dataset_item_id,
                annotation_id=job.annotation_id,
                from_frame=from_frame,
                to_frame=to_frame,
                direction=job.direction,
                prompt=job.prompt or {},
                source_geometry=last_geometry,
                task_data=task_data,
                ml_backend=backend,
                shadow_session_factory=shadow_session_factory,
                dispatch_context_factory=dispatch_context_factory,
                sam_variant=(job.prompt or {}).get("sam_variant"),  # v0.10.36
                # v0.21.19 · text-driven 追踪的 text/exemplars 从 prompt JSONB 读出透传。
                text=(job.prompt or {}).get("text"),
                exemplars=(job.prompt or {}).get("exemplars"),
                # v0.21.20 · polygon track 回填: 期望输出几何 (polygon/bbox)。
                output_geometry=output_geometry,
                # v0.21.27 · U-pvs-1 · 种子窗原始种子 / 后续窗多实例续种 (见上)。
                seeds=window_seeds,
            )
            # v0.21.28 · B-mx · 逐窗缓冲结果; 窗末对 text-multiplex 做跨窗 IoU 关联 (remap
            # 窗内 obj_id → 全局 instance_id) 后再并入 results。非 multiplex 时缓冲即透传。
            window_results: list[TrackerFrameResult] = []
            async for result in adapter.propagate(ctx):
                result = _materialize_tracker_mask_result(result)
                staged_bytes += _tracker_result_json_bytes(result)
                if staged_bytes > MAX_TRACKER_STAGED_BYTES:
                    raise ValueError(
                        "tracker_candidate_too_large: staged payload exceeds 64 MiB"
                    )
                await db.refresh(job)
                if (
                    job.cancel_requested_at is not None
                    or job.status == VideoTrackerJobStatus.CANCELLED.value
                ):
                    # v0.21.28 · 取消也暂存部分结果 (候选); multiplex 先关联本窗已收部分。
                    if associate_multiplex and window_results:
                        window_results = _associate_multiplex_window(
                            window_results, mp_prev_boundary, mp_next_global
                        )
                    results.extend(window_results)
                    if results:
                        _stage_tracker_results(job, results, grid_step, output_geometry)
                        await lock_raster_mask_references(db, job.staged_result)
                    job.status = VideoTrackerJobStatus.CANCELLED.value
                    job.completed_at = job.completed_at or _now()
                    await db.commit()
                    await publisher(job.event_channel, _event(job, "job_cancelled"))
                    return job

                window_results.append(result)
                progress += 1
                # live 预览事件用窗内 id (瞬态); 最终暂存的 results 用关联后的全局 id。
                frame_payload = {
                    "frame_index": result.frame_index,
                    "geometry": result.geometry,
                    "confidence": result.confidence,
                    "outside": result.outside,
                    "source": "prediction",
                }
                await publisher(
                    job.event_channel, _event(job, "frame_result", **frame_payload)
                )
                await publisher(
                    job.event_channel,
                    _event(
                        job,
                        "job_progress",
                        current=min(progress, total),
                        total=total,
                    ),
                )

            # 窗末: text-multiplex 关联 remap 窗内 obj_id → 跨窗全局 instance_id。
            if associate_multiplex:
                window_results = _associate_multiplex_window(
                    window_results, mp_prev_boundary, mp_next_global
                )
            results.extend(window_results)
            # 续种状态 (关联后 id): 逐实例记末帧几何 (供多实例续种); 主实例 (或单实例 None)
            # 另记 last_geometry 供 source_geometry 兜底 (与既有单 track 续追一致)。
            for result in window_results:
                if not result.outside and result.geometry:
                    if result.instance_id is not None:
                        last_geom_by_instance[result.instance_id] = result.geometry
                    if result.instance_id is None or result.primary:
                        last_geometry = result.geometry

        await db.refresh(job)
        if job.cancel_requested_at is not None:
            # v0.21.28 · 取消也暂存部分结果 (候选)。
            if results:
                _stage_tracker_results(job, results, grid_step, output_geometry)
                await lock_raster_mask_references(db, job.staged_result)
            job.status = VideoTrackerJobStatus.CANCELLED.value
            job.completed_at = job.completed_at or _now()
            await db.commit()
            await publisher(job.event_channel, _event(job, "job_cancelled"))
            # v0.23.3 · cancel route lease (caller-initiated cancel; never trips circuit).
            if tracker_lease is not None and tracker_router is not None:
                try:
                    await tracker_router.cancel(tracker_lease)
                except Exception:  # noqa: BLE001
                    log.warning("tracker route lease cancel failed job_id=%s", job_id)
            if heartbeat_stop is not None:
                heartbeat_stop()
            return job

        # v0.21.28 · 候选/接受流: 完成时**暂存**结果 (不落 annotation), 待用户接受/丢弃。
        # PENDING_REVIEW = 追踪完、结果已暂存、committed annotations 未改。
        _stage_tracker_results(job, results, grid_step, output_geometry)
        await lock_raster_mask_references(db, job.staged_result)
        job.status = VideoTrackerJobStatus.PENDING_REVIEW.value
        job.completed_at = _now()
        await db.commit()
        await db.refresh(job)
        await publisher(job.event_channel, _event(job, "job_completed"))
        # v0.23.3 · finish route lease (success outcome releases + updates circuit/metrics).
        if tracker_lease is not None and tracker_router is not None:
            try:
                await tracker_router.finish(tracker_lease, RouteOutcome.SUCCESS, duration_ms=0)
            except Exception:  # noqa: BLE001
                log.warning("tracker route lease finish failed job_id=%s", job_id)
        if heartbeat_stop is not None:
            heartbeat_stop()
        return job
    except Exception as exc:
        log.exception("video tracker job failed job_id=%s", job_id)
        # v0.23.3 · cancel route lease on failure (not a transport failure → no circuit trip).
        if tracker_lease is not None and tracker_router is not None:
            try:
                await tracker_router.cancel(tracker_lease)
            except Exception:  # noqa: BLE001
                log.warning("tracker route lease cancel failed job_id=%s", job_id)
        if heartbeat_stop is not None:
            heartbeat_stop()
        gpu_arbiter_error = gpu_arbiter_failure_record(exc)
        if gpu_arbiter_error is not None and failure_recorder is not None:
            failure_recorder(gpu_arbiter_error)
        message = (
            gpu_arbiter_error["message"] if gpu_arbiter_error is not None else str(exc)
        )
        return await _mark_failed(
            db,
            job_id,
            message,
            publisher,
            gpu_arbiter_error=gpu_arbiter_error,
        )
