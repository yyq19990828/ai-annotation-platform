from __future__ import annotations

import logging
import random
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import BatchStatus
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.dataset import DatasetItem
from app.db.models.project import Project
from app.schemas.batch import BatchCreate, BatchUpdate, BatchSplitRequest
from app.services.display_id import next_display_id

logger = logging.getLogger(__name__)

VALID_TRANSITIONS: dict[str, set[str]] = {
    BatchStatus.DRAFT: {BatchStatus.ACTIVE},
    BatchStatus.ACTIVE: {BatchStatus.ANNOTATING, BatchStatus.ARCHIVED},
    BatchStatus.ANNOTATING: {BatchStatus.REVIEWING, BatchStatus.ARCHIVED},
    BatchStatus.REVIEWING: {BatchStatus.APPROVED, BatchStatus.REJECTED},
    BatchStatus.APPROVED: {BatchStatus.ARCHIVED},
    BatchStatus.REJECTED: {BatchStatus.ACTIVE, BatchStatus.ARCHIVED},
}


class BatchService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Queries ────────────────────────────────────────────────────────────

    async def list_by_project(
        self, project_id: uuid.UUID, status: str | None = None,
    ) -> list[TaskBatch]:
        q = select(TaskBatch).where(TaskBatch.project_id == project_id)
        if status:
            q = q.where(TaskBatch.status == status)
        q = q.order_by(TaskBatch.priority.desc(), TaskBatch.created_at)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def get(self, batch_id: uuid.UUID) -> TaskBatch | None:
        return await self.db.get(TaskBatch, batch_id)

    async def get_default_batch(self, project_id: uuid.UUID) -> TaskBatch | None:
        result = await self.db.execute(
            select(TaskBatch).where(
                TaskBatch.project_id == project_id,
                TaskBatch.display_id == "B-DEFAULT",
            )
        )
        return result.scalar_one_or_none()

    # ── Mutations ──────────────────────────────────────────────────────────

    async def create(
        self,
        project_id: uuid.UUID,
        data: BatchCreate,
        created_by: uuid.UUID,
    ) -> TaskBatch:
        batch = TaskBatch(
            project_id=project_id,
            dataset_id=data.dataset_id,
            display_id=await next_display_id(self.db, "batches"),
            name=data.name,
            description=data.description,
            status=BatchStatus.DRAFT,
            priority=data.priority,
            deadline=data.deadline,
            assigned_user_ids=[str(uid) for uid in data.assigned_user_ids],
            created_by=created_by,
        )
        self.db.add(batch)
        await self.db.flush()
        return batch

    async def update(self, batch_id: uuid.UUID, data: BatchUpdate) -> TaskBatch:
        batch = await self.db.get(TaskBatch, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        fields = data.model_dump(exclude_unset=True)
        if "assigned_user_ids" in fields and fields["assigned_user_ids"] is not None:
            fields["assigned_user_ids"] = [str(uid) for uid in fields["assigned_user_ids"]]
        for k, v in fields.items():
            setattr(batch, k, v)
        await self.db.flush()
        return batch

    async def transition(
        self, batch_id: uuid.UUID, target_status: str, actor_id: uuid.UUID | None = None,
    ) -> TaskBatch:
        batch = await self.db.get(TaskBatch, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")

        allowed = VALID_TRANSITIONS.get(batch.status, set())
        if target_status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition from '{batch.status}' to '{target_status}'",
            )

        old_status = batch.status
        batch.status = target_status
        await self.db.flush()

        if target_status == BatchStatus.APPROVED:
            await self.on_batch_approved(batch_id)

        return batch

    async def delete(self, batch_id: uuid.UUID) -> bool:
        batch = await self.db.get(TaskBatch, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if batch.display_id == "B-DEFAULT":
            raise HTTPException(status_code=400, detail="Cannot delete the default batch")

        default = await self.get_default_batch(batch.project_id)
        if default:
            await self.db.execute(
                update(Task)
                .where(Task.batch_id == batch_id)
                .values(batch_id=default.id)
            )
            await self.recalculate_counters(default.id)

        await self.db.execute(delete(TaskBatch).where(TaskBatch.id == batch_id))
        await self.db.flush()
        return True

    # ── Split strategies ───────────────────────────────────────────────────

    async def split(
        self,
        project_id: uuid.UUID,
        data: BatchSplitRequest,
        created_by: uuid.UUID,
    ) -> list[TaskBatch]:
        if data.strategy == "random":
            return await self._split_random(project_id, data, created_by)
        elif data.strategy == "metadata":
            batches = await self._split_metadata(project_id, data, created_by)
            return [batches]
        elif data.strategy == "id_range":
            batches = await self._split_by_ids(project_id, data, created_by)
            return [batches]
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {data.strategy}")

    async def _split_random(
        self, project_id: uuid.UUID, data: BatchSplitRequest, created_by: uuid.UUID,
    ) -> list[TaskBatch]:
        n = data.n_batches
        if not n:
            raise HTTPException(status_code=400, detail="n_batches is required for random strategy")

        default = await self.get_default_batch(project_id)
        if not default:
            raise HTTPException(status_code=400, detail="No default batch found")

        result = await self.db.execute(
            select(Task.id).where(Task.batch_id == default.id)
        )
        task_ids = [row[0] for row in result.fetchall()]
        if not task_ids:
            raise HTTPException(status_code=400, detail="No tasks in default batch to split")

        random.shuffle(task_ids)
        chunk_size = len(task_ids) // n
        remainder = len(task_ids) % n

        batches: list[TaskBatch] = []
        offset = 0
        for i in range(n):
            size = chunk_size + (1 if i < remainder else 0)
            chunk = task_ids[offset : offset + size]
            offset += size

            batch = TaskBatch(
                project_id=project_id,
                display_id=await next_display_id(self.db, "batches"),
                name=f"{data.name_prefix} {i + 1}",
                status=BatchStatus.DRAFT,
                priority=data.priority,
                deadline=data.deadline,
                assigned_user_ids=[str(uid) for uid in data.assigned_user_ids],
                created_by=created_by,
            )
            self.db.add(batch)
            await self.db.flush()

            await self._assign_tasks(batch.id, chunk)
            await self.recalculate_counters(batch.id)
            batches.append(batch)

        await self.recalculate_counters(default.id)
        return batches

    async def _split_metadata(
        self, project_id: uuid.UUID, data: BatchSplitRequest, created_by: uuid.UUID,
    ) -> TaskBatch:
        if not data.metadata_key or data.metadata_value is None:
            raise HTTPException(status_code=400, detail="metadata_key and metadata_value are required")

        default = await self.get_default_batch(project_id)
        if not default:
            raise HTTPException(status_code=400, detail="No default batch found")

        result = await self.db.execute(
            select(Task.id)
            .join(DatasetItem, Task.dataset_item_id == DatasetItem.id)
            .where(
                Task.batch_id == default.id,
                DatasetItem.metadata_[data.metadata_key].astext == data.metadata_value,
            )
        )
        task_ids = [row[0] for row in result.fetchall()]
        if not task_ids:
            raise HTTPException(status_code=400, detail="No tasks match the metadata filter")

        batch = TaskBatch(
            project_id=project_id,
            display_id=await next_display_id(self.db, "batches"),
            name=f"{data.name_prefix} ({data.metadata_key}={data.metadata_value})",
            status=BatchStatus.DRAFT,
            priority=data.priority,
            deadline=data.deadline,
            assigned_user_ids=[str(uid) for uid in data.assigned_user_ids],
            created_by=created_by,
        )
        self.db.add(batch)
        await self.db.flush()

        await self._assign_tasks(batch.id, task_ids)
        await self.recalculate_counters(batch.id)
        await self.recalculate_counters(default.id)
        return batch

    async def _split_by_ids(
        self, project_id: uuid.UUID, data: BatchSplitRequest, created_by: uuid.UUID,
    ) -> TaskBatch:
        if not data.item_ids:
            raise HTTPException(status_code=400, detail="item_ids is required for id_range strategy")

        default = await self.get_default_batch(project_id)
        if not default:
            raise HTTPException(status_code=400, detail="No default batch found")

        result = await self.db.execute(
            select(Task.id).where(
                Task.batch_id == default.id,
                Task.dataset_item_id.in_(data.item_ids),
            )
        )
        task_ids = [row[0] for row in result.fetchall()]
        if not task_ids:
            raise HTTPException(status_code=400, detail="No tasks match the provided item IDs")

        batch = TaskBatch(
            project_id=project_id,
            display_id=await next_display_id(self.db, "batches"),
            name=data.name_prefix,
            status=BatchStatus.DRAFT,
            priority=data.priority,
            deadline=data.deadline,
            assigned_user_ids=[str(uid) for uid in data.assigned_user_ids],
            created_by=created_by,
        )
        self.db.add(batch)
        await self.db.flush()

        await self._assign_tasks(batch.id, task_ids)
        await self.recalculate_counters(batch.id)
        await self.recalculate_counters(default.id)
        return batch

    # ── Task assignment ────────────────────────────────────────────────────

    async def _assign_tasks(self, batch_id: uuid.UUID, task_ids: list[uuid.UUID]) -> int:
        if not task_ids:
            return 0
        await self.db.execute(
            update(Task).where(Task.id.in_(task_ids)).values(batch_id=batch_id)
        )
        return len(task_ids)

    async def assign_tasks_to_batch(self, batch_id: uuid.UUID, task_ids: list[uuid.UUID]) -> int:
        count = await self._assign_tasks(batch_id, task_ids)
        await self.recalculate_counters(batch_id)
        return count

    # ── Counters ───────────────────────────────────────────────────────────

    async def recalculate_counters(self, batch_id: uuid.UUID) -> None:
        batch = await self.db.get(TaskBatch, batch_id)
        if not batch:
            return

        result = await self.db.execute(
            select(
                func.count().label("total"),
                func.count().filter(Task.status == "completed").label("completed"),
                func.count().filter(Task.status == "review").label("review"),
            ).where(Task.batch_id == batch_id)
        )
        row = result.one()
        batch.total_tasks = row.total
        batch.completed_tasks = row.completed
        batch.review_tasks = row.review

        await self.db.flush()
        await self._sync_project_counters(batch.project_id)

    async def _sync_project_counters(self, project_id: uuid.UUID) -> None:
        project = await self.db.get(Project, project_id)
        if not project:
            return

        result = await self.db.execute(
            select(
                func.count().label("total"),
                func.count().filter(Task.status == "completed").label("completed"),
                func.count().filter(Task.status == "review").label("review"),
            ).where(Task.project_id == project_id)
        )
        row = result.one()
        project.total_tasks = row.total
        project.completed_tasks = row.completed
        project.review_tasks = row.review
        await self.db.flush()

    # ── Auto-transitions ───────────────────────────────────────────────────

    async def check_auto_transitions(self, batch_id: uuid.UUID | None) -> None:
        if not batch_id:
            return
        batch = await self.db.get(TaskBatch, batch_id)
        if not batch:
            return

        if batch.status == BatchStatus.ACTIVE:
            has_in_progress = await self.db.execute(
                select(Task.id).where(
                    Task.batch_id == batch_id,
                    Task.status == "in_progress",
                ).limit(1)
            )
            if has_in_progress.scalar_one_or_none():
                batch.status = BatchStatus.ANNOTATING
                await self.db.flush()

        elif batch.status == BatchStatus.ANNOTATING:
            pending_or_ip = await self.db.execute(
                select(Task.id).where(
                    Task.batch_id == batch_id,
                    Task.status.in_(["pending", "in_progress"]),
                ).limit(1)
            )
            if not pending_or_ip.scalar_one_or_none():
                batch.status = BatchStatus.REVIEWING
                await self.db.flush()

    # ── Batch rejection ────────────────────────────────────────────────────

    async def reject_batch(self, batch_id: uuid.UUID) -> tuple[TaskBatch, int]:
        batch = await self.db.get(TaskBatch, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")

        allowed = VALID_TRANSITIONS.get(batch.status, set())
        if BatchStatus.REJECTED not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot reject batch in status '{batch.status}'",
            )

        result = await self.db.execute(
            update(Task)
            .where(Task.batch_id == batch_id)
            .values(status="pending", is_labeled=False)
        )
        affected = result.rowcount

        batch.status = BatchStatus.REJECTED
        await self.db.flush()
        await self.recalculate_counters(batch_id)
        return batch, affected

    # ── AI/ML hook ─────────────────────────────────────────────────────────

    async def on_batch_approved(self, batch_id: uuid.UUID) -> None:
        logger.info("on_batch_approved hook: batch_id=%s — no-op (reserved for active learning)", batch_id)
