from __future__ import annotations

VIDEO_FRAME_MODES = {"keyframes", "all_frames"}


def _clean_frame(value: object) -> int | None:
    try:
        frame = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return max(0, frame)


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


def clean_outside_range(range_: dict) -> dict | None:
    from_frame = _clean_frame(range_.get("from"))
    to_frame = _clean_frame(range_.get("to"))
    if from_frame is None or to_frame is None:
        return None
    start = min(from_frame, to_frame)
    end = max(from_frame, to_frame)
    return {
        "from": start,
        "to": end,
        "source": "prediction" if range_.get("source") == "prediction" else "manual",
    }


def normalize_outside_ranges(ranges: list[dict] | None) -> list[dict]:
    cleaned = [
        range_
        for range_ in (clean_outside_range(item) for item in ranges or [])
        if range_ is not None
    ]
    cleaned.sort(key=lambda item: (item["from"], item["to"]))
    merged: list[dict] = []
    for range_ in cleaned:
        previous = merged[-1] if merged else None
        if previous and range_["from"] <= previous["to"] + 1:
            previous["to"] = max(previous["to"], range_["to"])
            if range_["source"] == "prediction":
                previous["source"] = "prediction"
            continue
        merged.append(dict(range_))
    return merged


def legacy_absent_ranges(keyframes: list[dict]) -> list[dict]:
    return normalize_outside_ranges(
        [
            {
                "from": int(kf.get("frame_index", 0)),
                "to": int(kf.get("frame_index", 0)),
                "source": "prediction"
                if kf.get("source") == "prediction"
                else "manual",
            }
            for kf in keyframes
            if bool(kf.get("absent"))
        ]
    )


def effective_outside_ranges(geometry: dict) -> list[dict]:
    return normalize_outside_ranges(
        [
            *(geometry.get("outside") or []),
            *legacy_absent_ranges(sorted_keyframes(geometry)),
        ]
    )


def frame_is_outside(geometry: dict, frame_index: int) -> bool:
    return any(
        int(range_["from"]) <= frame_index <= int(range_["to"])
        for range_ in effective_outside_ranges(geometry)
    )


def range_intersects_outside(
    ranges: list[dict], from_frame: int, to_frame: int
) -> bool:
    start = min(from_frame, to_frame)
    end = max(from_frame, to_frame)
    return any(
        int(range_["from"]) <= end and int(range_["to"]) >= start for range_ in ranges
    )


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


def _coerce_geometry(geometry_or_keyframes: dict | list[dict]) -> dict:
    if isinstance(geometry_or_keyframes, list):
        return {
            "type": "video_track",
            "track_id": "",
            "keyframes": geometry_or_keyframes,
        }
    return geometry_or_keyframes


def resolve_track_at_frame(
    geometry_or_keyframes: dict | list[dict], frame_index: int
) -> dict | None:
    geometry = _coerce_geometry(geometry_or_keyframes)
    keyframes = sorted_keyframes(geometry)
    outside_ranges = effective_outside_ranges(geometry)
    if range_intersects_outside(outside_ranges, frame_index, frame_index):
        return None

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
            if int(kf.get("frame_index", 0)) < frame_index
            and not kf.get("absent")
            and not range_intersects_outside(
                outside_ranges,
                int(kf.get("frame_index", 0)),
                int(kf.get("frame_index", 0)),
            )
        ),
        None,
    )
    after = next(
        (
            kf
            for kf in keyframes
            if int(kf.get("frame_index", 0)) > frame_index
            and not kf.get("absent")
            and not range_intersects_outside(
                outside_ranges,
                int(kf.get("frame_index", 0)),
                int(kf.get("frame_index", 0)),
            )
        ),
        None,
    )
    if not before or not after:
        return None
    before_frame = int(before.get("frame_index", 0))
    after_frame = int(after.get("frame_index", 0))
    if after_frame == before_frame or range_intersects_outside(
        outside_ranges, before_frame + 1, after_frame - 1
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
    outside_ranges = effective_outside_ranges(geometry)
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
            and not range_intersects_outside(
                outside_ranges,
                int(kf.get("frame_index", 0)),
                int(kf.get("frame_index", 0)),
            )
        ]

    max_keyframe = max((int(kf.get("frame_index", 0)) for kf in keyframes), default=0)
    total = max(int(frame_count or max_keyframe + 1), max_keyframe + 1)
    return [
        resolved
        for frame_index in range(total)
        if (resolved := resolve_track_at_frame(geometry, frame_index))
    ]
