from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class TrackerFrameResult:
    frame_index: int
    geometry: dict
    confidence: float | None = None
    outside: bool = False


@dataclass(frozen=True)
class TrackerContext:
    job_id: uuid.UUID
    dataset_item_id: uuid.UUID
    annotation_id: uuid.UUID
    from_frame: int
    to_frame: int
    direction: str
    prompt: dict
    source_geometry: dict


class TrackerAdapter(Protocol):
    model_key: str

    def propagate(self, ctx: TrackerContext) -> Iterator[TrackerFrameResult]:
        ...


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

    def propagate(self, ctx: TrackerContext) -> Iterator[TrackerFrameResult]:
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


_REGISTRY: dict[str, TrackerAdapter] = {
    MockBboxTrackerAdapter.model_key: MockBboxTrackerAdapter(),
}


def get_tracker_adapter(model_key: str) -> TrackerAdapter:
    try:
        return _REGISTRY[model_key]
    except KeyError as exc:
        raise ValueError(f"Unsupported tracker model: {model_key}") from exc


def registered_tracker_models() -> list[str]:
    return sorted(_REGISTRY)
