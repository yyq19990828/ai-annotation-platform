from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.config import settings
from app.db.models.project import Project

RasterMaskCapabilityReason = Literal[
    "read_disabled",
    "deployment_disabled",
    "project_disabled",
    "region_disabled",
    "enabled",
]


@dataclass(frozen=True)
class RasterMaskCapabilities:
    read_enabled: bool
    write_enabled: bool
    legacy_polygon_commit_enabled: bool
    project_enabled: bool
    region_enabled: bool
    reason: RasterMaskCapabilityReason


def region_tool_enabled(tool_bindings: dict | None) -> bool:
    if not isinstance(tool_bindings, dict):
        return False
    binding = tool_bindings.get("region")
    return isinstance(binding, dict) and binding.get("enabled") is True


def evaluate_raster_mask_capabilities(
    project: Project | None,
) -> RasterMaskCapabilities:
    """Return the single source of truth for image raster-mask rollout."""
    read_enabled = bool(settings.raster_mask_read_enabled)
    deployment_enabled = bool(settings.raster_mask_create_enabled)
    project_enabled = bool(
        project is not None and project.raster_mask_native_editing_enabled
    )
    region_enabled = region_tool_enabled(project.tool_bindings if project else None)

    reason: RasterMaskCapabilityReason
    if not read_enabled:
        reason = "read_disabled"
    elif not deployment_enabled:
        reason = "deployment_disabled"
    elif not project_enabled:
        reason = "project_disabled"
    elif not region_enabled:
        reason = "region_disabled"
    else:
        reason = "enabled"

    return RasterMaskCapabilities(
        read_enabled=read_enabled,
        write_enabled=reason == "enabled",
        legacy_polygon_commit_enabled=region_enabled,
        project_enabled=project_enabled,
        region_enabled=region_enabled,
        reason=reason,
    )
