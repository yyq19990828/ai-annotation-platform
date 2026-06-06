"""Shared point-cloud role directory patterns.

Keep importer path-role detection in one place so scene inference and frame
grouping do not drift when third-party layouts use role aliases.
"""

from __future__ import annotations

from dataclasses import dataclass

_ROLE_BOUNDARY_CHARS = ("_", "-", ".")


@dataclass(frozen=True)
class RolePatterns:
    lidar: tuple[str, ...] = ("lidar", "lidar_point_cloud", "velodyne", "points")
    camera: tuple[str, ...] = ("camera", "camera_image", "image", "cam")
    calib: tuple[str, ...] = ("calib", "calibration")


DEFAULT_ROLE_PATTERNS = RolePatterns()


def matches_role_part(part: str, patterns: tuple[str, ...]) -> bool:
    """Match exact aliases or alias + separator suffixes like camera_image_0."""
    candidate = part.lower()
    for pattern in patterns:
        p = pattern.lower()
        if candidate == p:
            return True
        if any(candidate.startswith(f"{p}{sep}") for sep in _ROLE_BOUNDARY_CHARS):
            return True
    return False


def last_role_index(parts: tuple[str, ...], patterns: tuple[str, ...]) -> int:
    """Return the last index whose path part matches one of the role patterns."""
    for i in range(len(parts) - 1, -1, -1):
        if matches_role_part(parts[i], patterns):
            return i
    return -1


def role_dir_names(
    patterns: RolePatterns = DEFAULT_ROLE_PATTERNS,
    *,
    extra: tuple[str, ...] = (),
) -> set[str]:
    return set(patterns.lidar + patterns.camera + patterns.calib + extra)


def matches_any_role_dir(
    part: str,
    patterns: RolePatterns = DEFAULT_ROLE_PATTERNS,
    *,
    extra: tuple[str, ...] = (),
) -> bool:
    return any(
        matches_role_part(part, candidates)
        for candidates in (
            patterns.lidar,
            patterns.camera,
            patterns.calib,
            extra,
        )
    )
