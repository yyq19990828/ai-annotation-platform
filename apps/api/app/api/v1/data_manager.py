from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import assert_project_visible, get_current_user, get_db
from app.db.models.user import User
from app.schemas.data_manager import (
    DataManagerMatchesRequest,
    DataManagerMatchesResponse,
    DataManagerEntityLocation,
    DataManagerEntityQueryRequest,
    DataManagerEntityScope,
    DataManagerObjectDetailResponse,
    DataManagerObjectQueryResponse,
    DataManagerSchemaResponse,
    DataManagerSummaryRequest,
    DataManagerSummaryResponse,
    DataManagerTrackDetailResponse,
    DataManagerTrackQueryResponse,
)
from app.services.data_management.service import (
    DataManagerService,
    build_data_manager_schema,
)
from app.services.data_management.entities import DataManagerObjectService
from app.services.data_management.entity_filters import validate_entity_view
from app.services.data_management.tracks import DataManagerTrackService


router = APIRouter()


@router.get(
    "/projects/{project_id}/data-manager/schema",
    response_model=DataManagerSchemaResponse,
)
async def get_data_manager_schema(
    project_id: uuid.UUID,
    entity_scope: DataManagerEntityScope = Query(default="tasks"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    return build_data_manager_schema(project, entity_scope)


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


@router.post(
    "/projects/{project_id}/data-manager/objects/query",
    response_model=DataManagerObjectQueryResponse,
)
async def query_data_manager_objects(
    project_id: uuid.UUID,
    payload: DataManagerEntityQueryRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    validate_entity_view(
        entity_scope="objects",
        filter_json=payload.filter_json,
        sort_json=payload.sort_json,
        columns_json=payload.columns_json,
        project=project,
    )
    return await DataManagerObjectService(db).query(
        project_id=project_id,
        payload=payload,
        user=user,
        project=project,
    )


@router.get(
    "/projects/{project_id}/data-manager/objects/{annotation_id}/location",
    response_model=DataManagerEntityLocation,
)
async def get_data_manager_object_location(
    project_id: uuid.UUID,
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    return await DataManagerObjectService(db).location(
        project_id=project_id,
        annotation_id=annotation_id,
        user=user,
        project=project,
    )


@router.get(
    "/projects/{project_id}/data-manager/objects/{annotation_id}/detail",
    response_model=DataManagerObjectDetailResponse,
)
async def get_data_manager_object_detail(
    project_id: uuid.UUID,
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    return await DataManagerObjectService(db).detail(
        project_id=project_id,
        annotation_id=annotation_id,
        user=user,
        project=project,
    )


@router.post(
    "/projects/{project_id}/data-manager/tracks/query",
    response_model=DataManagerTrackQueryResponse,
)
async def query_data_manager_tracks(
    project_id: uuid.UUID,
    payload: DataManagerEntityQueryRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    validate_entity_view(
        entity_scope="tracks",
        filter_json=payload.filter_json,
        sort_json=payload.sort_json,
        columns_json=payload.columns_json,
        project=project,
    )
    return await DataManagerTrackService(db).query(
        project_id=project_id,
        payload=payload,
        user=user,
        project=project,
    )


@router.get(
    "/projects/{project_id}/data-manager/tracks/{track_ref}/detail",
    response_model=DataManagerTrackDetailResponse,
)
async def get_data_manager_track_detail(
    project_id: uuid.UUID,
    track_ref: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    return await DataManagerTrackService(db).detail(
        project_id=project_id,
        track_ref=track_ref,
        user=user,
        project=project,
    )
