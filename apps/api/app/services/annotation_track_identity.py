from __future__ import annotations

from copy import deepcopy

from app.services.annotation_propagation import _new_track_id


COMPACT_VIDEO_TRACK_TYPES = frozenset(
    {
        "video_track_bbox",
        "video_track_polygon",
        "video_track_polyline",
        "video_track_mask",
    }
)


def prepare_compact_track_identity(
    geometry: dict,
    track_id: str | None = None,
    *,
    reject_identity_change: bool = False,
) -> tuple[dict, str | None]:
    """Return geometry/column values with one compact-track identity.

    Non-track geometries pass through unchanged. For compact tracks the column is
    authoritative once present; new tracks adopt the geometry value or allocate a
    platform track id. Generic PATCH callers can reject an attempted identity swap.
    """
    normalized = deepcopy(geometry or {})
    if normalized.get("type") not in COMPACT_VIDEO_TRACK_TYPES:
        return normalized, track_id

    geometry_track_id = normalized.get("track_id")
    if geometry_track_id is not None:
        geometry_track_id = str(geometry_track_id)
        if len(geometry_track_id) > 64:
            raise ValueError("track_id must be at most 64 characters")
    if track_id is not None:
        track_id = str(track_id)
        if reject_identity_change and geometry_track_id not in {None, track_id}:
            raise ValueError("track_id cannot be changed through geometry update")

    resolved = track_id or geometry_track_id or _new_track_id()
    normalized["track_id"] = resolved
    return normalized, resolved
