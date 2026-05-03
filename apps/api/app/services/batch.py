from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, func, update, delete, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import BatchStatus, UserRole
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.dataset import DatasetItem
from app.db.models.project import Project
from app.db.models.user import User
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


# v0.7.0：transition 鉴权矩阵 — (from, to) 元组 → 允许角色集合 / 特殊判定
# 'owner' = super_admin 或项目 owner（require_project_owner 等价）
# 'reviewer' = super_admin / project_admin(owner) / reviewer
# 'annotator_assigned' = 标注员且 user_id 在 batch.assigned_user_ids 中
def _is_owner(user: User, project: Project) -> bool:
    return user.role == UserRole.SUPER_ADMIN or project.owner_id == user.id


def _is_reviewer(user: User, project: Project) -> bool:
    return _is_owner(user, project) or user.role == UserRole.REVIEWER


def _is_annotator_assigned(user: User, batch: TaskBatch) -> bool:
    if user.role != UserRole.ANNOTATOR:
        return False
    assigned = batch.assigned_user_ids or []
    return str(user.id) in [str(x) for x in assigned]


def assert_can_transition(
    user: User, project: Project, batch: TaskBatch, target_status: str,
) -> None:
    """v0.7.0：按 (from, to) 校验角色权限，403 携带可读 detail。
    语法层（VALID_TRANSITIONS）由 transition() 内部检查；本函数只做角色门禁。
    """
    src = batch.status
    dst = target_status

    # owner / super_admin 始终放行（包含 archived 出口、rejected 重激活）
    if _is_owner(user, project):
        return

    # draft → active：仅 owner（已被上面拦截）；其他角色拒绝
    if (src, dst) == (BatchStatus.DRAFT, BatchStatus.ACTIVE):
        raise HTTPException(status_code=403, detail=f"{user.role} cannot transition draft -> active")

    # active → annotating：仅 check_auto_transitions 内部驱动；REST 一律拒绝
    if (src, dst) == (BatchStatus.ACTIVE, BatchStatus.ANNOTATING):
        raise HTTPException(status_code=403, detail="active -> annotating is auto-driven only")

    # annotating → reviewing：标注员（被分派）可主动整批提交质检
    if (src, dst) == (BatchStatus.ANNOTATING, BatchStatus.REVIEWING):
        if _is_annotator_assigned(user, batch):
            return
        raise HTTPException(status_code=403, detail=f"{user.role} cannot transition annotating -> reviewing")

    # reviewing → approved / rejected：reviewer
    if src == BatchStatus.REVIEWING and dst in (BatchStatus.APPROVED, BatchStatus.REJECTED):
        if _is_reviewer(user, project):
            return
        raise HTTPException(status_code=403, detail=f"{user.role} cannot transition reviewing -> {dst}")

    # rejected → active：仅 owner（已被上面拦截）
    if (src, dst) == (BatchStatus.REJECTED, BatchStatus.ACTIVE):
        raise HTTPException(status_code=403, detail=f"{user.role} cannot reactivate rejected batch")

    # 任意 → archived：仅 owner（已被上面拦截）
    if dst == BatchStatus.ARCHIVED:
        raise HTTPException(status_code=403, detail=f"{user.role} cannot archive batch")

    # approved → 其他：仅 archived 合法（VALID_TRANSITIONS 已限），owner 已放行；其他拒
    raise HTTPException(status_code=403, detail=f"{user.role} cannot transition {src} -> {dst}")


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

    async def _splittable_task_ids(
        self, project_id: uuid.UUID, default: TaskBatch | None,
    ) -> list[uuid.UUID]:
        # v0.6.8 B-14：可被 split 的「未归类任务」= batch_id IS NULL ∪ 老项目残留 B-DEFAULT 中的任务。
        # v0.6.7 后新项目不再有 B-DEFAULT；删完批次后任务回退为 batch_id=NULL，仍能被 split。
        conds = [Task.batch_id.is_(None)]
        if default is not None:
            conds.append(Task.batch_id == default.id)
        result = await self.db.execute(
            select(Task.id).where(Task.project_id == project_id).where(or_(*conds))
        )
        return [row[0] for row in result.fetchall()]

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

        # v0.7.0：draft → active 必须有任务（拒绝空批次激活）
        if batch.status == BatchStatus.DRAFT and target_status == BatchStatus.ACTIVE:
            count = (await self.db.execute(
                select(func.count()).select_from(Task).where(Task.batch_id == batch_id)
            )).scalar() or 0
            if count == 0:
                raise HTTPException(status_code=400, detail="cannot activate empty batch")

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

        # v0.6.8 B-14：老项目仍走「回收到 B-DEFAULT」路径；新项目无 B-DEFAULT 时把任务回退为
        # batch_id=NULL（成为「未归类任务」），由 split 流程兜底，避免删完所有批次后死锁。
        default = await self.get_default_batch(batch.project_id)
        if default:
            await self.db.execute(
                update(Task)
                .where(Task.batch_id == batch_id)
                .values(batch_id=default.id)
            )
            await self.recalculate_counters(default.id)
        else:
            await self.db.execute(
                update(Task)
                .where(Task.batch_id == batch_id)
                .values(batch_id=None)
            )

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
        task_ids = await self._splittable_task_ids(project_id, default)
        if not task_ids:
            raise HTTPException(status_code=400, detail="No unassigned tasks to split")

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

        if default is not None:
            await self.recalculate_counters(default.id)
        return batches

    async def _split_metadata(
        self, project_id: uuid.UUID, data: BatchSplitRequest, created_by: uuid.UUID,
    ) -> TaskBatch:
        if not data.metadata_key or data.metadata_value is None:
            raise HTTPException(status_code=400, detail="metadata_key and metadata_value are required")

        default = await self.get_default_batch(project_id)
        # v0.6.8 B-14：metadata 过滤同样作用于「未归类 ∪ B-DEFAULT」任务集合
        conds = [Task.batch_id.is_(None)]
        if default is not None:
            conds.append(Task.batch_id == default.id)
        result = await self.db.execute(
            select(Task.id)
            .join(DatasetItem, Task.dataset_item_id == DatasetItem.id)
            .where(
                Task.project_id == project_id,
                or_(*conds),
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
        if default is not None:
            await self.recalculate_counters(default.id)
        return batch

    async def _split_by_ids(
        self, project_id: uuid.UUID, data: BatchSplitRequest, created_by: uuid.UUID,
    ) -> TaskBatch:
        if not data.item_ids:
            raise HTTPException(status_code=400, detail="item_ids is required for id_range strategy")

        default = await self.get_default_batch(project_id)
        # v0.6.8 B-14：id_range 同样作用于「未归类 ∪ B-DEFAULT」任务集合
        conds = [Task.batch_id.is_(None)]
        if default is not None:
            conds.append(Task.batch_id == default.id)
        result = await self.db.execute(
            select(Task.id).where(
                Task.project_id == project_id,
                or_(*conds),
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
        if default is not None:
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
                func.count().filter(Task.status == "in_progress").label("in_progress"),
            ).where(Task.project_id == project_id)
        )
        row = result.one()
        project.total_tasks = row.total
        project.completed_tasks = row.completed
        project.review_tasks = row.review
        project.in_progress_tasks = row.in_progress
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

    async def reject_batch(
        self,
        batch_id: uuid.UUID,
        *,
        feedback: str,
        reviewer_id: uuid.UUID,
    ) -> tuple[TaskBatch, int]:
        """v0.7.0 方案 A · 软重置语义：
        - 仅把 review/completed 任务回退到 pending（让标注员可继续动它们）
        - **不**改 is_labeled，**不**清 annotations.is_active（保留历史标注）
        - 批次写入 review_feedback / reviewed_at / reviewed_by
        """
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
            .where(
                Task.batch_id == batch_id,
                Task.status.in_(["review", "completed"]),
            )
            .values(status="pending")
        )
        affected = result.rowcount

        batch.status = BatchStatus.REJECTED
        batch.review_feedback = feedback
        batch.reviewed_at = datetime.now(timezone.utc)
        batch.reviewed_by = reviewer_id
        await self.db.flush()
        await self.recalculate_counters(batch_id)
        return batch, affected

    # ── AI/ML hook ─────────────────────────────────────────────────────────

    async def on_batch_approved(self, batch_id: uuid.UUID) -> None:
        # TODO(v0.7.x+)：active learning 闭环 — 把已通过批次推回 ML backend 训练队列。
        # 依赖 ML backend / 训练队列基座（ROADMAP A · AI/模型 区）落地后再实现。
        logger.info("on_batch_approved hook: batch_id=%s — no-op (reserved for active learning)", batch_id)
