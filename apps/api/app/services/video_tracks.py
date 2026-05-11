from __future__ import annotations

VIDEO_FRAME_MODES = {"keyframes", "all_frames"}


def sorted_keyframes(geometry: dict) -> list[dict]:
    keyframes = geometry.get("keyframes")
    if not isinstance(keyframes, list):
        return []
    return sorted(
        [kf for kf in keyframes if isinstance(kf, dict)],
        key=lambda kf: int(kf.get("frame_index", 0)),
    )


def clean_keyframe(kf: dict, *, include_attributes: bool = True) -> dict:
    row = {
        "frame_index": int(kf.get("frame_index", 0)),
        "bbox": kf.get("bbox") or {},
        "source": kf.get("source", "manual"),
        "absent": bool(kf.get("absent", False)),
        "occluded": bool(kf.get("occluded", False)),
    }
    if include_attributes and isinstance(kf.get("attributes"), dict):
        row["attributes"] = kf["attributes"]
    return row


def lerp_bbox(before: dict, after: dict, ratio: float) -> dict:
    before_bbox = before.get("bbox") or {}
    after_bbox = after.get("bbox") or {}
    return {
        key: round(
            float(before_bbox.get(key, 0))
            + (float(after_bbox.get(key, 0)) - float(before_bbox.get(key, 0))) * ratio,
            6,
        )
        for key in ("x", "y", "w", "h")
    }


def has_absent_between(keyframes: list[dict], from_frame: int, to_frame: int) -> bool:
    return any(
        bool(kf.get("absent"))
        and int(kf.get("frame_index", 0)) > from_frame
        and int(kf.get("frame_index", 0)) < to_frame
        for kf in keyframes
    )


def resolve_track_at_frame(keyframes: list[dict], frame_index: int) -> dict | None:
    exact = next(
        (kf for kf in keyframes if int(kf.get("frame_index", 0)) == frame_index),
        None,
    )
    if exact:
        if exact.get("absent"):
            return None
        return {
            "frame_index": frame_index,
            "bbox": exact.get("bbox") or {},
            "source": exact.get("source", "manual"),
            "occluded": bool(exact.get("occluded", False)),
        }

    before = next(
        (
            kf
            for kf in reversed(keyframes)
            if int(kf.get("frame_index", 0)) < frame_index and not kf.get("absent")
        ),
        None,
    )
    after = next(
        (
            kf
            for kf in keyframes
            if int(kf.get("frame_index", 0)) > frame_index and not kf.get("absent")
        ),
        None,
    )
    if not before or not after:
        return None
    before_frame = int(before.get("frame_index", 0))
    after_frame = int(after.get("frame_index", 0))
    if after_frame == before_frame or has_absent_between(
        keyframes, before_frame, after_frame
    ):
        return None
    ratio = (frame_index - before_frame) / (after_frame - before_frame)
    return {
        "frame_index": frame_index,
        "bbox": lerp_bbox(before, after, ratio),
        "source": "interpolated",
        "occluded": False,
    }


def resolved_track_frames(
    geometry: dict,
    *,
    frame_mode: str,
    frame_count: int | None = None,
) -> list[dict]:
    if frame_mode not in VIDEO_FRAME_MODES:
        raise ValueError("video_frame_mode must be one of: keyframes, all_frames")

    keyframes = sorted_keyframes(geometry)
    if frame_mode == "keyframes":
        return [
            {
                "frame_index": int(kf.get("frame_index", 0)),
                "bbox": kf.get("bbox") or {},
                "source": kf.get("source", "manual"),
                "occluded": bool(kf.get("occluded", False)),
            }
            for kf in keyframes
            if not kf.get("absent")
        ]

    max_keyframe = max((int(kf.get("frame_index", 0)) for kf in keyframes), default=0)
    total = max(int(frame_count or max_keyframe + 1), max_keyframe + 1)
    return [
        resolved
        for frame_index in range(total)
        if (resolved := resolve_track_at_frame(keyframes, frame_index))
    ]
