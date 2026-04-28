from __future__ import annotations

import uuid
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.prediction import Prediction, PredictionMeta, FailedPrediction
from app.db.models.task import Task


class PredictionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_from_ml_result(
        self,
        task_id: uuid.UUID,
        project_id: uuid.UUID,
        ml_backend_id: uuid.UUID | None,
        result: list[dict],
        score: float | None = None,
        model_version: str | None = None,
        inference_time_ms: int | None = None,
        token_meta: dict | None = None,
    ) -> Prediction:
        prediction = Prediction(
            id=uuid.uuid4(),
            task_id=task_id,
            project_id=project_id,
            ml_backend_id=ml_backend_id,
            model_version=model_version,
            score=score,
            result=result,
        )
        self.db.add(prediction)
        await self.db.flush()

        meta_data = token_meta or {}
        meta = PredictionMeta(
            id=uuid.uuid4(),
            prediction_id=prediction.id,
            inference_time_ms=inference_time_ms,
            prompt_tokens=meta_data.get("prompt_tokens"),
            completion_tokens=meta_data.get("completion_tokens"),
            total_tokens=meta_data.get("total_tokens"),
            prompt_cost=meta_data.get("prompt_cost"),
            completion_cost=meta_data.get("completion_cost"),
            total_cost=meta_data.get("total_cost"),
        )
        self.db.add(meta)

        await self.db.execute(
            select(Task).where(Task.id == task_id).with_for_update()
        )
        task = await self.db.get(Task, task_id)
        if task:
            task.total_predictions = (task.total_predictions or 0) + 1

        await self.db.flush()
        return prediction

    async def create_failed(
        self,
        task_id: uuid.UUID | None,
        project_id: uuid.UUID,
        ml_backend_id: uuid.UUID | None,
        error_type: str,
        message: str,
        model_version: str | None = None,
    ) -> FailedPrediction:
        failed = FailedPrediction(
            id=uuid.uuid4(),
            task_id=task_id,
            project_id=project_id,
            ml_backend_id=ml_backend_id,
            model_version=model_version,
            error_type=error_type,
            message=message,
        )
        self.db.add(failed)
        await self.db.flush()
        return failed

    async def list_by_task(self, task_id: uuid.UUID, model_version: str | None = None) -> list[Prediction]:
        q = select(Prediction).where(Prediction.task_id == task_id)
        if model_version:
            q = q.where(Prediction.model_version == model_version)
        q = q.order_by(Prediction.created_at.desc())
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def get_latest_for_task(self, task_id: uuid.UUID) -> Prediction | None:
        result = await self.db.execute(
            select(Prediction)
            .where(Prediction.task_id == task_id)
            .order_by(Prediction.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()
