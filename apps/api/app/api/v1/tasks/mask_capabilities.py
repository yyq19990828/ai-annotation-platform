from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks._shared import _assert_task_visible, _load_task_or_404
from app.config import settings
from app.db.models.project import Project
from app.db.models.user import User
from app.deps import get_current_user, get_db, require_scopes
from app.schemas.task import MaskCapabilityReason, TaskMaskCapabilitiesResponse
from app.services.raster_mask_storage import MAX_RLE_OBJECT_BYTES
from app.utils.raster_mask_rle import (
    MAX_MASK_DIMENSION,
    MAX_MASK_PIXELS,
    MAX_MASK_RUNS,
)

router = APIRouter()


def _region_enabled(tool_bindings: dict | None) -> bool:
    if not isinstance(tool_bindings, dict):
        return False
    binding = tool_bindings.get("region")
    return isinstance(binding, dict) and binding.get("enabled") is True


def _capability_reason(
    *,
    read_enabled: bool,
    deployment_enabled: bool,
    project_enabled: bool,
    region_enabled: bool,
) -> MaskCapabilityReason:
    if not read_enabled:
        return "read_disabled"
    if not deployment_enabled:
        return "deployment_disabled"
    if not project_enabled:
        return "project_disabled"
    if not region_enabled:
        return "region_disabled"
    return "enabled"


@router.get(
    "/{task_id}/mask-capabilities",
    response_model=TaskMaskCapabilitiesResponse,
    dependencies=[Depends(require_scopes("annotations:read"))],
)
async def get_mask_capabilities(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskMaskCapabilitiesResponse:
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)

    project = await db.get(Project, task.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Task not found")

    read_enabled = bool(settings.raster_mask_read_enabled)
    deployment_enabled = bool(settings.raster_mask_create_enabled)
    project_enabled = bool(project.raster_mask_native_editing_enabled)
    region_enabled = _region_enabled(project.tool_bindings)
    reason = _capability_reason(
        read_enabled=read_enabled,
        deployment_enabled=deployment_enabled,
        project_enabled=project_enabled,
        region_enabled=region_enabled,
    )

    return TaskMaskCapabilitiesResponse(
        read_enabled=read_enabled,
        write_enabled=reason == "enabled",
        legacy_polygon_commit_enabled=region_enabled,
        project_enabled=project_enabled,
        region_enabled=region_enabled,
        reason=reason,
        max_dimension=MAX_MASK_DIMENSION,
        max_pixels=MAX_MASK_PIXELS,
        max_runs=MAX_MASK_RUNS,
        max_bytes=MAX_RLE_OBJECT_BYTES,
    )
