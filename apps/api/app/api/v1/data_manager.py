from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import assert_project_visible, get_current_user, get_db
from app.db.models.user import User
from app.schemas.data_manager import (
    DataManagerMatchesRequest,
    DataManagerMatchesResponse,
    DataManagerSchemaResponse,
    DataManagerSummaryRequest,
    DataManagerSummaryResponse,
)
from app.services.data_manager import DataManagerService, build_data_manager_schema


router = APIRouter()


@router.get(
    "/projects/{project_id}/data-manager/schema",
    response_model=DataManagerSchemaResponse,
)
async def get_data_manager_schema(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    return build_data_manager_schema(project)


@router.post(
    "/projects/{project_id}/data-manager/summary",
    response_model=DataManagerSummaryResponse,
)
async def get_data_manager_summary(
    project_id: uuid.UUID,
    payload: DataManagerSummaryRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    return await DataManagerService(db).summary(
        project_id=project_id,
        filter_json=payload.filter_json,
        user=user,
        project=project,
    )


@router.post(
    "/projects/{project_id}/tasks/{task_id}/data-manager/matches",
    response_model=DataManagerMatchesResponse,
)
async def get_data_manager_matches(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    payload: DataManagerMatchesRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    return await DataManagerService(db).matches(
        project_id=project_id,
        task_id=task_id,
        filter_json=payload.filter_json,
        limit=payload.limit,
        offset=payload.offset,
        user=user,
        project=project,
    )
