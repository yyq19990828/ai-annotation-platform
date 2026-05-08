"""v0.9.6 · /admin/preannotate-queue 简化版.

返回"AI 预标已就绪 (batch.status='pre_annotated') 的批次列表" + 各自的
prediction_count / failed_count / last_run_at, 让 admin 在 /ai-pre 页面看到
"哪些批次跑完了, 需要去工作台接管 review".

完整 job 历史追踪 (含已结束/已重置批次, 当时 prompt / cost / 耗时) 需要新增
prediction_jobs 表 + worker 写入逻辑, 推迟到 v0.9.7.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import BatchStatus, UserRole
from app.db.models.prediction import FailedPrediction, Prediction
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.user import User
from app.deps import get_db, require_roles

router = APIRouter()


class PreannotateQueueItem(BaseModel):
    batch_id: uuid.UUID
    batch_name: str
    batch_status: str
    project_id: uuid.UUID
    project_name: str
    project_display_id: str | None = None
    total_tasks: int
    prediction_count: int
    failed_count: int
    last_run_at: datetime | None = None
    can_retry: bool


class PreannotateQueueResponse(BaseModel):
    items: list[PreannotateQueueItem]


@router.get("/admin/preannotate-queue", response_model=PreannotateQueueResponse)
async def list_preannotate_queue(
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_roles(UserRole.PROJECT_ADMIN, UserRole.SUPER_ADMIN)),
) -> PreannotateQueueResponse:
    """列出已预标 (pre_annotated 状态) 的批次, 按最近一次预标时间倒序.

    含 prediction / failed 计数 + 项目元数据, 供 AIPreAnnotatePage 历史表渲染.
    """
    # 1. 拉所有 pre_annotated 批次 (limit 前)
    bres = await db.execute(
        select(TaskBatch)
        .where(TaskBatch.status == BatchStatus.PRE_ANNOTATED)
        .order_by(TaskBatch.updated_at.desc())
        .limit(limit)
    )
    batches = list(bres.scalars().all())
    if not batches:
        return PreannotateQueueResponse(items=[])

    batch_ids = [b.id for b in batches]
    project_ids = list({b.project_id for b in batches})

    # 2. project 信息
    pres = await db.execute(select(Project).where(Project.id.in_(project_ids)))
    projects_by_id = {p.id: p for p in pres.scalars().all()}

    # 3. 每 batch 的 task count
    task_count_q = await db.execute(
        select(Task.batch_id, func.count(Task.id))
        .where(Task.batch_id.in_(batch_ids))
        .group_by(Task.batch_id)
    )
    task_counts = {bid: cnt for bid, cnt in task_count_q.all()}

    # 4. 每 batch 的 prediction count + max created_at (从 predictions JOIN tasks)
    pred_q = await db.execute(
        select(
            Task.batch_id,
            func.count(Prediction.id),
            func.max(Prediction.created_at),
        )
        .select_from(Prediction)
        .join(Task, Task.id == Prediction.task_id)
        .where(Task.batch_id.in_(batch_ids))
        .group_by(Task.batch_id)
    )
    pred_counts: dict[uuid.UUID, tuple[int, datetime | None]] = {
        bid: (int(cnt), last) for bid, cnt, last in pred_q.all()
    }

    # 5. 每 batch 的 failed count (排除 dismissed)
    fail_q = await db.execute(
        select(Task.batch_id, func.count(FailedPrediction.id))
        .select_from(FailedPrediction)
        .join(Task, Task.id == FailedPrediction.task_id)
        .where(
            Task.batch_id.in_(batch_ids),
            FailedPrediction.dismissed_at.is_(None),
        )
        .group_by(Task.batch_id)
    )
    fail_counts = {bid: int(cnt) for bid, cnt in fail_q.all()}

    items: list[PreannotateQueueItem] = []
    for b in batches:
        proj = projects_by_id.get(b.project_id)
        pred_n, last_run = pred_counts.get(b.id, (0, None))
        fail_n = fail_counts.get(b.id, 0)
        items.append(
            PreannotateQueueItem(
                batch_id=b.id,
                batch_name=b.name,
                batch_status=b.status,
                project_id=b.project_id,
                project_name=proj.name if proj else "(已删除项目)",
                project_display_id=getattr(proj, "display_id", None) if proj else None,
                total_tasks=task_counts.get(b.id, 0),
                prediction_count=pred_n,
                failed_count=fail_n,
                last_run_at=last_run,
                can_retry=fail_n > 0,
            )
        )

    return PreannotateQueueResponse(items=items)
