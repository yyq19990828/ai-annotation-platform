"""v0.9.3 · 超管 ML 集成总览。

聚合返回：
- storage：复用 storage.summarize_bucket 的两个 bucket 概览（仅 super_admin 走该端点）
- projects：跨所有项目的 ml_backends 列表，按 project 分组（保留 backend.url 但不返回 auth_token）
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project
from app.db.models.user import User
from app.deps import get_db, require_roles
from app.schemas.ml_backend import MLBackendOut
from app.schemas.storage import BucketSummary
from app.services.storage import storage_service

router = APIRouter()


class ProjectMLBackendsGroup(BaseModel):
    project_id: str
    project_name: str
    backends: list[MLBackendOut]


class StorageOverview(BaseModel):
    items: list[BucketSummary]
    total_object_count: int
    total_size_bytes: int


class MLIntegrationsOverview(BaseModel):
    storage: StorageOverview
    projects: list[ProjectMLBackendsGroup]
    total_backends: int
    connected_backends: int


@router.get("/overview", response_model=MLIntegrationsOverview)
async def get_overview(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    bucket_roles = {
        storage_service.bucket: "annotations",
        storage_service.datasets_bucket: "datasets",
    }
    items: list[BucketSummary] = []
    for b, role in bucket_roles.items():
        try:
            summary = storage_service.summarize_bucket(b)
            items.append(BucketSummary(role=role, **summary))
        except Exception as e:
            items.append(
                BucketSummary(
                    name=b,
                    status="error",
                    object_count=0,
                    total_size_bytes=0,
                    error=str(e)[:200],
                    role=role,
                )
            )
    storage_overview = StorageOverview(
        items=items,
        total_object_count=sum(i.object_count for i in items),
        total_size_bytes=sum(i.total_size_bytes for i in items),
    )

    res = await db.execute(
        select(MLBackend).order_by(
            MLBackend.project_id, MLBackend.created_at.desc()
        )
    )
    backends = list(res.scalars().all())
    project_ids = {b.project_id for b in backends}
    projects_by_id: dict = {}
    if project_ids:
        pres = await db.execute(select(Project).where(Project.id.in_(project_ids)))
        for p in pres.scalars().all():
            projects_by_id[p.id] = p

    grouped: dict[str, ProjectMLBackendsGroup] = {}
    for b in backends:
        proj = projects_by_id.get(b.project_id)
        pid_str = str(b.project_id)
        if pid_str not in grouped:
            grouped[pid_str] = ProjectMLBackendsGroup(
                project_id=pid_str,
                project_name=proj.name if proj else "(已删除项目)",
                backends=[],
            )
        grouped[pid_str].backends.append(MLBackendOut.model_validate(b))

    return MLIntegrationsOverview(
        storage=storage_overview,
        projects=list(grouped.values()),
        total_backends=len(backends),
        connected_backends=sum(1 for b in backends if b.state == "connected"),
    )
