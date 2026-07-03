"""视频轨迹跨帧传播的纯逻辑簇。

从 services/annotation.py 抽出的模块级纯函数与共享上下文 dataclass(无 DB 依赖):
整批传播上下文 _PropagateContext、track_id 生成、bbox/keyframe/outside 区间的几何
处理。annotation.py 经 import 回这些符号自用(端点/类方法照旧调用),
`from app.services.annotation import ...` 旧入口经 re-export 保持不变。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.db.models.task import Task
from app.services.video_tracks import (
    frame_is_outside,
    normalize_outside_ranges,
    sorted_keyframes,
)


@dataclass
class _PropagateContext:
    """propagate_batch 整批共享的预解析上下文。

    一次 batch 内所有框共享同一 source_task / target_task,故 scene/frame、
    目标 axis_convention、源/目标帧 ego pose 对整批恒定。循环外解析一次,逐框
    复用,消除原先逐条 propagate 重复解析造成的 N+1(框数 20-50+ 时尤甚)。
    box_3d 专用字段(axis_convention / pose_src / pose_dst)首次遇到 box_3d 时
    才解析并缓存 —— 2D 几何不付这部分 DB 往返。
    """

    src_task: Task
    target_task: Task
    src_scene_id: uuid.UUID | None
    src_frame_index: int | None
    target_scene_id: uuid.UUID | None
    target_frame_index: int | None
    axis_convention: str | None = None
    pose_src: object | None = None
    pose_dst: object | None = None
    _box3d_resolved: bool = False


def _new_track_id() -> str:
    # v0.21.2 · 全局唯一 track_id 工厂 (跨帧对象一等标识)。检测式追踪 ingestion
    # (_remap_track_ids)、交互式传播、3D 存量回填共用本工厂, 统一 `trk_<hex>` 形态。
    return f"trk_{uuid.uuid4().hex}"


def _clean_bbox_geometry(geometry: dict) -> dict:
    return {
        "x": float(geometry.get("x", 0)),
        "y": float(geometry.get("y", 0)),
        "w": float(geometry.get("w", 0)),
        "h": float(geometry.get("h", 0)),
    }


def _composition_keyframe(
    frame_index: int, bbox: dict, *, source: str = "manual"
) -> dict:
    return {
        "frame_index": int(frame_index),
        "bbox": _clean_bbox_geometry(bbox),
        "source": "prediction" if source == "prediction" else "manual",
        "occluded": False,
    }


def _track_visible_keyframes(geometry: dict) -> list[dict]:
    return [
        kf
        for kf in sorted_keyframes(geometry)
        if not frame_is_outside(geometry, int(kf.get("frame_index", 0)))
    ]


def _clip_outside_ranges(
    geometry: dict, *, start: int | None, end: int | None
) -> list[dict]:
    out: list[dict] = []
    for range_ in geometry.get("outside") or []:
        from_frame = int(range_.get("from", 0))
        to_frame = int(range_.get("to", 0))
        if start is not None:
            from_frame = max(from_frame, start)
        if end is not None:
            to_frame = min(to_frame, end)
        if from_frame <= to_frame:
            out.append(
                {
                    "from": from_frame,
                    "to": to_frame,
                    "source": "prediction"
                    if range_.get("source") == "prediction"
                    else "manual",
                }
            )
    return normalize_outside_ranges(out)
