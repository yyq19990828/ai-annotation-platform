from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from app.config import settings
from app.services.ml_client import MLBackendClient

if TYPE_CHECKING:
    from app.db.models.ml_backend_registry import MLBackendRegistry as MLBackend


@dataclass(frozen=True)
class TrackerFrameResult:
    frame_index: int
    geometry: dict
    confidence: float | None = None
    outside: bool = False


@dataclass(frozen=True)
class TrackerContext:
    job_id: uuid.UUID
    task_id: uuid.UUID
    project_id: uuid.UUID
    dataset_item_id: uuid.UUID
    annotation_id: uuid.UUID
    from_frame: int
    to_frame: int
    direction: str
    prompt: dict
    source_geometry: dict
    task_data: dict
    ml_backend: "MLBackend | None" = None
    sam_variant: str | None = (
        None  # v0.10.36 · 透传到 backend /predict video_tracker 分支
    )
    # v0.21.19 · text-driven 追踪 (sam3_video): 文本 query + 视觉示例框, 显式透传到
    # backend context 顶层 (而非仅塞进自由 prompt), 与 seed-bbox tracker 区分。
    text: str | None = None
    exemplars: list[dict] | None = None
    # v0.21.20 · polygon track 回填: "polygon" 时 backend 每帧保留 mask 矢量化的多边形
    # 而非降 bbox; 缺省 "bbox" 维持既有 seed-bbox tracker 行为。由 runner 按源几何类型定。
    output_geometry: str = "bbox"


class TrackerAdapter(Protocol):
    model_key: str

    def propagate(self, ctx: TrackerContext) -> AsyncIterator[TrackerFrameResult]: ...


def _bbox_from_points(points: list) -> dict:
    """归一化多边形/折线顶点 → 外接 bbox {x,y,w,h}; 空/退化 → 零框。

    v0.21.20 · SAM2 只吃 bbox seed, polygon track 的种子 = 多边形外接框; 跨窗续追时
    上一窗结果几何也是多边形, 同样取外接框喂下一窗。
    """
    xs = [float(p[0]) for p in points if len(p) >= 2]
    ys = [float(p[1]) for p in points if len(p) >= 2]
    if not xs or not ys:
        return {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}


def _bbox_from_geometry(geometry: dict) -> dict:
    if geometry.get("type") == "video_track_bbox":
        keyframes = sorted(
            geometry.get("keyframes") or [],
            key=lambda item: int(item.get("frame_index", 0)),
        )
        if keyframes:
            return dict(keyframes[0].get("bbox") or {})

    # v0.21.20 · polygon track: 取首关键帧顶点外接框 / 单帧 polygon 结果取其顶点外接框。
    if geometry.get("type") == "video_track_polygon":
        keyframes = sorted(
            geometry.get("keyframes") or [],
            key=lambda item: int(item.get("frame_index", 0)),
        )
        if keyframes:
            return _bbox_from_points(keyframes[0].get("points") or [])

    if geometry.get("type") == "polygon":
        return _bbox_from_points(geometry.get("points") or [])

    if geometry.get("type") in {"bbox", "video_bbox"}:
        return {
            "x": float(geometry.get("x", 0)),
            "y": float(geometry.get("y", 0)),
            "w": float(geometry.get("w", geometry.get("width", 0))),
            "h": float(geometry.get("h", geometry.get("height", 0))),
        }

    return {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}


class MockBboxTrackerAdapter:
    model_key = "mock_bbox"

    async def propagate(self, ctx: TrackerContext) -> AsyncIterator[TrackerFrameResult]:
        prompt_geometry = ctx.prompt.get("geometry")
        bbox = _bbox_from_geometry(
            prompt_geometry
            if isinstance(prompt_geometry, dict)
            else ctx.source_geometry
        )
        frames = range(ctx.from_frame, ctx.to_frame + 1)
        if ctx.direction == "backward":
            frames = range(ctx.to_frame, ctx.from_frame - 1, -1)

        for frame_index in frames:
            yield TrackerFrameResult(
                frame_index=frame_index,
                geometry={"type": "bbox", **bbox},
                confidence=1.0,
                outside=False,
            )


class MLBackendVideoTrackerAdapter:
    def __init__(self, model_key: str) -> None:
        self.model_key = model_key

    async def propagate(self, ctx: TrackerContext) -> AsyncIterator[TrackerFrameResult]:
        backend = ctx.ml_backend
        if backend is None:
            raise ValueError(
                f"{self.model_key} requires a connected project ML backend"
            )
        if backend.state != "connected":
            raise ValueError(
                f"{self.model_key} requires a connected project ML backend"
            )

        client = MLBackendClient(backend)
        context: dict = {
            "type": "video_tracker",
            "model_key": self.model_key,
            "job_id": str(ctx.job_id),
            "task_id": str(ctx.task_id),
            "project_id": str(ctx.project_id),
            "dataset_item_id": str(ctx.dataset_item_id),
            "annotation_id": str(ctx.annotation_id),
            "from_frame": ctx.from_frame,
            "to_frame": ctx.to_frame,
            "direction": ctx.direction,
            "prompt": ctx.prompt,
            "source_geometry": ctx.source_geometry,
        }
        # v0.14.15 · 仅当显式指定时透传模型变体; 缺省让后端回退默认 tiny.
        if ctx.sam_variant:
            context["model_variants"] = {"sam_variant": ctx.sam_variant}
        # v0.21.19 · text-driven 追踪的 text/exemplars 显式提到 context 顶层 (seed-bbox
        # tracker 无此二键), 让 backend /predict video_tracker 分支按 text 重检测。
        if ctx.text:
            context["text"] = ctx.text
        if ctx.exemplars:
            context["exemplars"] = ctx.exemplars
        # v0.21.20 · polygon track 回填: 显式下发期望输出几何, backend 据此保留 mask
        # 矢量化的多边形; 缺省 bbox 不下发, 老 backend 无此键也不受影响。
        if ctx.output_geometry and ctx.output_geometry != "bbox":
            context["output_geometry"] = ctx.output_geometry
        result = await client.predict_interactive(
            task_data=ctx.task_data,
            context=context,
        )

        for item in result.result:
            if isinstance(item, dict):
                yield _frame_result_from_payload(item)


def _frame_result_from_payload(payload: dict) -> TrackerFrameResult:
    confidence = payload.get("confidence")
    if confidence is not None:
        confidence = float(confidence)
    outside = bool(payload.get("outside", False))
    if (
        confidence is not None
        and confidence < settings.video_tracker_low_confidence_outside_threshold
    ):
        outside = True

    geometry = payload.get("geometry")
    if not isinstance(geometry, dict):
        geometry = {k: payload[k] for k in ("type", "x", "y", "w", "h") if k in payload}
    if not geometry:
        geometry = {"type": "bbox", "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}

    return TrackerFrameResult(
        frame_index=int(payload["frame_index"]),
        geometry=geometry,
        confidence=confidence,
        outside=outside,
    )


_REGISTRY: dict[str, TrackerAdapter] = {
    MockBboxTrackerAdapter.model_key: MockBboxTrackerAdapter(),
    "sam2_video": MLBackendVideoTrackerAdapter("sam2_video"),
    "sam3_video": MLBackendVideoTrackerAdapter("sam3_video"),
}


def get_tracker_adapter(model_key: str) -> TrackerAdapter:
    try:
        return _REGISTRY[model_key]
    except KeyError as exc:
        raise ValueError(f"Unsupported tracker model: {model_key}") from exc


def registered_tracker_models() -> list[str]:
    return sorted(_REGISTRY)
