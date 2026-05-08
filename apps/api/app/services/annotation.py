from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.prediction import Prediction
from app.db.models.task import Task
from app.db.models.task_lock import AnnotationDraft


class AnnotationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        annotation_type: str,
        class_name: str,
        geometry: dict,
        confidence: float | None = None,
        parent_prediction_id: uuid.UUID | None = None,
        lead_time: float | None = None,
        attributes: dict | None = None,
    ) -> Annotation:
        task = await self.db.get(Task, task_id)
        source = "prediction_based" if parent_prediction_id else "manual"

        annotation = Annotation(
            id=uuid.uuid4(),
            task_id=task_id,
            project_id=task.project_id if task else None,
            user_id=user_id,
            source=source,
            annotation_type=annotation_type,
            class_name=class_name,
            geometry=geometry,
            confidence=confidence,
            parent_prediction_id=parent_prediction_id,
            lead_time=lead_time,
            attributes=attributes or {},
        )
        self.db.add(annotation)
        await self.db.flush()

        await self._update_task_stats(task_id)
        return annotation

    async def accept_prediction(
        self, prediction_id: uuid.UUID, user_id: uuid.UUID
    ) -> Annotation | None:
        prediction = await self.db.get(Prediction, prediction_id)
        if not prediction:
            return None

        # v0.9.7 fix · prediction.result 是 LabelStudio 标准, 转内部 schema 后入 annotation
        from app.services.prediction import to_internal_shape

        for raw_shape in prediction.result:
            shape = to_internal_shape(raw_shape)
            annotation = Annotation(
                id=uuid.uuid4(),
                task_id=prediction.task_id,
                project_id=prediction.project_id,
                user_id=user_id,
                source="prediction_based",
                annotation_type=shape.get("type", "bbox"),
                class_name=shape.get("class_name", ""),
                geometry=shape.get("geometry", {}),
                confidence=shape.get("confidence"),
                parent_prediction_id=prediction_id,
            )
            self.db.add(annotation)

        await self.db.flush()
        await self._update_task_stats(prediction.task_id)
        return annotation

    async def list_by_task(
        self, task_id: uuid.UUID, include_cancelled: bool = False
    ) -> list[Annotation]:
        q = select(Annotation).where(
            Annotation.task_id == task_id, Annotation.is_active.is_(True)
        )
        if not include_cancelled:
            q = q.where(Annotation.was_cancelled.is_(False))
        q = q.order_by(Annotation.created_at)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def list_by_task_keyset(
        self,
        task_id: uuid.UUID,
        *,
        limit: int = 200,
        cursor: tuple[datetime, uuid.UUID] | None = None,
        include_cancelled: bool = False,
    ) -> tuple[list[Annotation], tuple[datetime, uuid.UUID] | None]:
        """v0.7.6 · keyset 分页：created_at DESC, id DESC。next_cursor=None 时已末页。

        cursor 元组语义：取「严格小于」该 (ts, id) 的下一页。
        排序键参考 alembic 0031 的 ix_annotations_task_created_id 复合索引。
        """
        q = select(Annotation).where(
            Annotation.task_id == task_id, Annotation.is_active.is_(True)
        )
        if not include_cancelled:
            q = q.where(Annotation.was_cancelled.is_(False))
        if cursor is not None:
            cur_ts, cur_id = cursor
            q = q.where(
                (Annotation.created_at < cur_ts)
                | ((Annotation.created_at == cur_ts) & (Annotation.id < cur_id))
            )
        q = q.order_by(Annotation.created_at.desc(), Annotation.id.desc()).limit(limit)
        rows = list((await self.db.execute(q)).scalars().all())
        next_cursor: tuple[datetime, uuid.UUID] | None = None
        if len(rows) == limit and rows:
            tail = rows[-1]
            next_cursor = (tail.created_at, tail.id)
        return rows, next_cursor

    async def delete(self, annotation_id: uuid.UUID) -> bool:
        annotation = await self.db.get(Annotation, annotation_id)
        if not annotation:
            return False
        annotation.is_active = False
        await self.db.flush()
        await self._update_task_stats(annotation.task_id)
        return True

    async def update(
        self,
        annotation_id: uuid.UUID,
        geometry: dict | None = None,
        class_name: str | None = None,
        confidence: float | None = None,
        attributes: dict | None = None,
    ) -> Annotation | None:
        """Surgical update of mutable fields. Increments version for optimistic concurrency."""
        annotation = await self.db.get(Annotation, annotation_id)
        if not annotation or not annotation.is_active:
            return None
        if geometry is not None:
            annotation.geometry = geometry
        if class_name is not None:
            annotation.class_name = class_name
        if confidence is not None:
            annotation.confidence = confidence
        if attributes is not None:
            annotation.attributes = attributes
        annotation.version += 1
        await self.db.flush()
        return annotation

    async def save_draft(
        self, task_id: uuid.UUID, user_id: uuid.UUID, result: dict
    ) -> AnnotationDraft:
        existing = await self.db.execute(
            select(AnnotationDraft).where(
                AnnotationDraft.task_id == task_id,
                AnnotationDraft.user_id == user_id,
            )
        )
        draft = existing.scalar_one_or_none()
        if draft:
            draft.result = result
        else:
            draft = AnnotationDraft(
                id=uuid.uuid4(),
                task_id=task_id,
                user_id=user_id,
                result=result,
            )
            self.db.add(draft)
        await self.db.flush()
        return draft

    async def get_draft(
        self, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> AnnotationDraft | None:
        result = await self.db.execute(
            select(AnnotationDraft).where(
                AnnotationDraft.task_id == task_id,
                AnnotationDraft.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def _update_task_stats(self, task_id: uuid.UUID) -> None:
        count_result = await self.db.execute(
            select(func.count()).where(
                Annotation.task_id == task_id,
                Annotation.is_active.is_(True),
                Annotation.was_cancelled.is_(False),
            )
        )
        count = count_result.scalar() or 0

        task = await self.db.get(Task, task_id)
        if task:
            task.total_annotations = count
            task.is_labeled = count > 0
        await self.db.flush()
