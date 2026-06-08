from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.async_job import AsyncJob, AsyncJobStatus
from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project
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
        # v0.10.49 · prediction_jobs 已收敛进 async_jobs；按 payload.ml_backend_id 查 running
        running = await self.db.execute(
            select(AsyncJob).where(
                AsyncJob.kind == "batch_predict",
                AsyncJob.payload["ml_backend_id"].astext == str(backend_id),
                AsyncJob.status == AsyncJobStatus.RUNNING.value,
            )
        )
        running_jobs = list(running.scalars().all())
        if running_jobs:
            raise MLBackendDeleteBlocked(len(running_jobs))
        bound_projects = await self.db.execute(
            select(Project).where(Project.ml_backend_id == backend_id)
        )
        for project in bound_projects.scalars():
            project.ml_backend_id = None
        await self.db.delete(backend)
        await self.db.flush()
        return True

    async def unload(self, backend_id: uuid.UUID) -> dict | None:
        backend = await self.get(backend_id)
        if not backend:
            return None
        client = MLBackendClient(backend)
        return await client.unload()

    async def reload(
        self,
        backend_id: uuid.UUID,
        sam_variant: str | None = None,
        dino_variant: str | None = None,
        task_type: str | None = None,
    ) -> dict | None:
        backend = await self.get(backend_id)
        if not backend:
            return None
        client = MLBackendClient(backend)
        return await client.reload(
            sam_variant=sam_variant, dino_variant=dino_variant, task_type=task_type
        )

    async def warmup(self, backend_id: uuid.UUID, body: dict) -> dict | None:
        """v0.14.14 协议 §4.4 · 转发 /warmup. body 原样上抛 backend, 各 backend schema 不同."""
        backend = await self.get(backend_id)
        if not backend:
            return None
        client = MLBackendClient(backend)
        return await client.warmup(body)

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
            # v0.10.37 · 顺带探 /setup, 把能力快照落进 health_meta["capabilities"]
            # (epic 阶段 1); 探测失败不影响 health 结果, 静默跳过.
            from app.services.ml_capabilities import extract_capabilities

            try:
                caps = extract_capabilities(await client.setup())
            except Exception:
                caps = None
            if caps is not None:
                meta = {**meta, "capabilities": caps}
                # is_interactive 改派生对账: 以 /setup 自报为真值
                backend.is_interactive = caps["is_interactive"]
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
