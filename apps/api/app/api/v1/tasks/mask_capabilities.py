from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks._shared import _assert_task_visible, _load_task_or_404
from app.db.models.project import Project
from app.db.models.user import User
from app.deps import get_current_user, get_db, require_scopes
from app.schemas.task import TaskMaskCapabilitiesResponse
from app.services.raster_mask_capabilities import evaluate_raster_mask_capabilities
from app.services.raster_mask_storage import MAX_RLE_OBJECT_BYTES
from app.utils.raster_mask_rle import (
    MAX_MASK_DIMENSION,
    MAX_MASK_PIXELS,
    MAX_MASK_RUNS,
)

router = APIRouter()


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

    capabilities = evaluate_raster_mask_capabilities(project)

    return TaskMaskCapabilitiesResponse(
        read_enabled=capabilities.read_enabled,
        write_enabled=capabilities.write_enabled,
        legacy_polygon_commit_enabled=capabilities.legacy_polygon_commit_enabled,
        project_enabled=capabilities.project_enabled,
        region_enabled=capabilities.region_enabled,
        reason=capabilities.reason,
        max_dimension=MAX_MASK_DIMENSION,
        max_pixels=MAX_MASK_PIXELS,
        max_runs=MAX_MASK_RUNS,
        max_bytes=MAX_RLE_OBJECT_BYTES,
    )
