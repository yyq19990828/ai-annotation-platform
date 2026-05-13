from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.ml_backend import MLBackend
from app.db.models.prediction_job import PredictionJob, PredictionJobStatus
from app.services.ml_client import MLBackendClient


class MLBackendDeleteBlocked(Exception):
    """B-28 · ml_backend 上仍有 running prediction job，拒绝删除。"""

    def __init__(self, running_jobs: int) -> None:
        super().__init__(f"ml backend has {running_jobs} running prediction job(s)")
        self.running_jobs = running_jobs


class MLBackendService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self, project_id: uuid.UUID, name: str, url: str, **kwargs
    ) -> MLBackend:
        backend = MLBackend(
            id=uuid.uuid4(), project_id=project_id, name=name, url=url, **kwargs
        )
        self.db.add(backend)
        await self.db.flush()
        return backend

    async def get(self, backend_id: uuid.UUID) -> MLBackend | None:
        result = await self.db.execute(
            select(MLBackend).where(MLBackend.id == backend_id)
        )
        return result.scalar_one_or_none()

    async def list_by_project(self, project_id: uuid.UUID) -> list[MLBackend]:
        result = await self.db.execute(
            select(MLBackend)
            .where(MLBackend.project_id == project_id)
            .order_by(MLBackend.created_at.desc())
        )
        return list(result.scalars().all())

    async def update(self, backend_id: uuid.UUID, **kwargs) -> MLBackend | None:
        backend = await self.get(backend_id)
        if not backend:
            return None
        for key, value in kwargs.items():
            if hasattr(backend, key):
                setattr(backend, key, value)
        await self.db.flush()
        return backend

    async def delete(self, backend_id: uuid.UUID) -> bool:
        backend = await self.get(backend_id)
        if not backend:
            return False
        running = await self.db.execute(
            select(PredictionJob).where(
                PredictionJob.ml_backend_id == backend_id,
                PredictionJob.status == PredictionJobStatus.RUNNING.value,
            )
        )
        running_jobs = list(running.scalars().all())
        if running_jobs:
            raise MLBackendDeleteBlocked(len(running_jobs))
        await self.db.delete(backend)
        await self.db.flush()
        return True

    async def unload(self, backend_id: uuid.UUID) -> dict | None:
        backend = await self.get(backend_id)
        if not backend:
            return None
        client = MLBackendClient(backend)
        return await client.unload()

    async def reload(self, backend_id: uuid.UUID) -> dict | None:
        backend = await self.get(backend_id)
        if not backend:
            return None
        client = MLBackendClient(backend)
        return await client.reload()

    async def check_health(self, backend_id: uuid.UUID) -> bool:
        from datetime import UTC, datetime

        backend = await self.get(backend_id)
        if not backend:
            return False
        client = MLBackendClient(backend)
        # v0.9.6 · 用 health_meta 一次性拉 ok + meta, 把深度指标缓存到表
        healthy, meta = await client.health_meta()
        backend.state = "connected" if healthy else "error"
        backend.last_checked_at = datetime.now(UTC)
        if meta is not None:
            backend.health_meta = meta
        await self.db.flush()
        return healthy

    async def get_interactive_backend(self, project_id: uuid.UUID) -> MLBackend | None:
        result = await self.db.execute(
            select(MLBackend).where(
                MLBackend.project_id == project_id,
                MLBackend.is_interactive.is_(True),
                MLBackend.state == "connected",
            )
        )
        return result.scalar_one_or_none()

    async def get_project_backend(self, project_id: uuid.UUID) -> MLBackend | None:
        """v0.8.6 F3 · 优先返回 project.ml_backend_id 显式绑定，否则 fallback 到旧逻辑。"""
        from app.db.models.project import Project

        proj = await self.db.get(Project, project_id)
        if proj is not None and proj.ml_backend_id is not None:
            backend = await self.get(proj.ml_backend_id)
            if backend is not None:
                return backend
        return await self.get_interactive_backend(project_id)
