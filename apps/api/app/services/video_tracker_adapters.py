from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from app.config import settings
from app.services.ml_client import MLBackendClient

if TYPE_CHECKING:
    from app.db.models.ml_backend import MLBackend


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


class TrackerAdapter(Protocol):
    model_key: str

    def propagate(self, ctx: TrackerContext) -> AsyncIterator[TrackerFrameResult]: ...


def _bbox_from_geometry(geometry: dict) -> dict:
    if geometry.get("type") == "video_track":
        keyframes = sorted(
            geometry.get("keyframes") or [],
            key=lambda item: int(item.get("frame_index", 0)),
        )
        if keyframes:
            return dict(keyframes[0].get("bbox") or {})

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
        result = await client.predict_interactive(
            task_data=ctx.task_data,
            context={
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
            },
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
