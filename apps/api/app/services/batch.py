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
    # v0.9.5：active → pre_annotated 由 batch_predict task 末尾自动触发
    BatchStatus.ACTIVE: {
        BatchStatus.ANNOTATING,
        BatchStatus.PRE_ANNOTATED,
        BatchStatus.ARCHIVED,
    },
    # v0.9.5：pre_annotated → annotating 与 active 同语义（scheduler 自动驱动）；
    # → active 是 owner 兜底重置（逆向，丢弃预标 predictions）；→ archived 任意 owner
    BatchStatus.PRE_ANNOTATED: {
        BatchStatus.ANNOTATING,
        BatchStatus.ACTIVE,
        BatchStatus.ARCHIVED,
    },
    BatchStatus.ANNOTATING: {BatchStatus.REVIEWING, BatchStatus.ARCHIVED},
    BatchStatus.REVIEWING: {BatchStatus.APPROVED, BatchStatus.REJECTED},
    # v0.7.3：approved → reviewing 重开审核（owner 兜底，需 reason）
    BatchStatus.APPROVED: {BatchStatus.ARCHIVED, BatchStatus.REVIEWING},
    # v0.7.3：rejected → reviewing 跳过重标直接复审（owner 兜底，需 reason）
    BatchStatus.REJECTED: {
        BatchStatus.ACTIVE,
        BatchStatus.ARCHIVED,
        BatchStatus.REVIEWING,
    },
    # v0.7.3：archived → active 撤销归档（owner 兜底，需 reason）；后续由 scheduler 自动推进到正确阶段
    BatchStatus.ARCHIVED: {BatchStatus.ACTIVE},
}

# v0.7.3：owner-only 逆向迁移白名单。命中时必须传 reason（1-500 字），写入 audit_log.detail_json.reason。
REVERSE_TRANSITIONS: set[tuple[str, str]] = {
    (BatchStatus.ARCHIVED, BatchStatus.ACTIVE),
    (BatchStatus.APPROVED, BatchStatus.REVIEWING),
    (BatchStatus.REJECTED, BatchStatus.REVIEWING),
    # v0.9.5：丢弃 AI 预标 predictions 重置（owner 兜底，需 reason）
    (BatchStatus.PRE_ANNOTATED, BatchStatus.ACTIVE),
}


# v0.7.0：transition 鉴权矩阵 — (from, to) 元组 → 允许角色集合 / 特殊判定
# 'owner' = super_admin 或项目 owner（require_project_owner 等价）
# 'reviewer' = super_admin / project_admin(owner) / reviewer
# 'annotator_assigned' = 标注员且 user_id == batch.annotator_id（v0.7.2 单值语义）
def _is_owner(user: User, project: Project) -> bool:
    return user.role == UserRole.SUPER_ADMIN or project.owner_id == user.id


def _is_reviewer(user: User, project: Project) -> bool:
    return _is_owner(user, project) or user.role == UserRole.REVIEWER


def _is_annotator_assigned(user: User, batch: TaskBatch) -> bool:
    """v0.7.2：单值语义 — batch.annotator_id == user.id。"""
    if user.role != UserRole.ANNOTATOR:
        return False
    return batch.annotator_id is not None and batch.annotator_id == user.id


def assert_can_transition(
    user: User,
    project: Project,
    batch: TaskBatch,
    target_status: str,
) -> None:
    """v0.7.0：按 (from, to) 校验角色权限，403 携带可读 detail。
    语法层（VALID_TRANSITIONS）由 transition() 内部检查；本函数只做角色门禁。
    """
    src = batch.status
    dst = target_status

    # v0.7.3：逆向迁移（撤销归档 / 重开审核 / 跳标复审）owner-only，非 owner 直接拒
    if (src, dst) in REVERSE_TRANSITIONS:
        if not _is_owner(user, project):
            raise HTTPException(
                status_code=403,
                detail=f"{user.role} cannot reverse-transition {src} -> {dst}",
            )
        return

    # owner / super_admin 始终放行（包含 archived 出口、rejected 重激活）
    if _is_owner(user, project):
        return

    # draft → active：仅 owner（已被上面拦截）；其他角色拒绝
    if (src, dst) == (BatchStatus.DRAFT, BatchStatus.ACTIVE):
        raise HTTPException(
            status_code=403, detail=f"{user.role} cannot transition draft -> active"
        )

    # active → annotating：仅 check_auto_transitions 内部驱动；REST 一律拒绝
    if (src, dst) == (BatchStatus.ACTIVE, BatchStatus.ANNOTATING):
        raise HTTPException(
            status_code=403, detail="active -> annotating is auto-driven only"
        )

    # v0.9.5：active → pre_annotated 仅 batch_predict task 内部驱动；REST 一律拒绝
    if (src, dst) == (BatchStatus.ACTIVE, BatchStatus.PRE_ANNOTATED):
        raise HTTPException(
            status_code=403, detail="active -> pre_annotated is auto-driven only"
        )

    # v0.9.5：pre_annotated → annotating 与 active 同语义，scheduler 内部驱动
    if (src, dst) == (BatchStatus.PRE_ANNOTATED, BatchStatus.ANNOTATING):
        raise HTTPException(
            status_code=403, detail="pre_annotated -> annotating is auto-driven only"
        )

    # annotating → reviewing：标注员（被分派）可主动整批提交质检
    if (src, dst) == (BatchStatus.ANNOTATING, BatchStatus.REVIEWING):
        if _is_annotator_assigned(user, batch):
            return
        raise HTTPException(
            status_code=403,
            detail=f"{user.role} cannot transition annotating -> reviewing",
        )

    # reviewing → approved / rejected：reviewer
    if src == BatchStatus.REVIEWING and dst in (
        BatchStatus.APPROVED,
        BatchStatus.REJECTED,
    ):
        if _is_reviewer(user, project):
            return
        raise HTTPException(
            status_code=403, detail=f"{user.role} cannot transition reviewing -> {dst}"
        )

    # rejected → active：仅 owner（已被上面拦截）
    if (src, dst) == (BatchStatus.REJECTED, BatchStatus.ACTIVE):
        raise HTTPException(
            status_code=403, detail=f"{user.role} cannot reactivate rejected batch"
        )

    # 任意 → archived：仅 owner（已被上面拦截）
    if dst == BatchStatus.ARCHIVED:
        raise HTTPException(status_code=403, detail=f"{user.role} cannot archive batch")

    # approved → 其他：仅 archived 合法（VALID_TRANSITIONS 已限），owner 已放行；其他拒
    raise HTTPException(
        status_code=403, detail=f"{user.role} cannot transition {src} -> {dst}"
    )


class BatchService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Queries ────────────────────────────────────────────────────────────

    async def list_by_project(
        self,
        project_id: uuid.UUID,
        status: str | None = None,
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
        self,
        project_id: uuid.UUID,
        default: TaskBatch | None,
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
            annotator_id=data.annotator_id,
            reviewer_id=data.reviewer_id,
            created_by=created_by,
        )
        self._sync_assigned_user_ids(batch)
        self.db.add(batch)
        await self.db.flush()
        return batch

    async def update(self, batch_id: uuid.UUID, data: BatchUpdate) -> TaskBatch:
        batch = await self.db.get(TaskBatch, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        fields = data.model_dump(exclude_unset=True)
        for k, v in fields.items():
            setattr(batch, k, v)

        # v0.7.2：annotator_id / reviewer_id 变更时，自动派生 assigned_user_ids
        # （前端旧路径仍读这个 list；同时回填 task 级 assignee_id / reviewer_id）
        annotator_changed = "annotator_id" in fields
        reviewer_changed = "reviewer_id" in fields
        if annotator_changed or reviewer_changed:
            self._sync_assigned_user_ids(batch)

        await self.db.flush()

        if annotator_changed:
            await self._cascade_task_assignee(batch.id, batch.annotator_id)
        if reviewer_changed:
            await self._cascade_task_reviewer(batch.id, batch.reviewer_id)
        return batch

    @staticmethod
    def _sync_assigned_user_ids(batch: TaskBatch) -> None:
        """v0.7.2：派生 assigned_user_ids = [annotator_id, reviewer_id] filter None。
        旧的 multi-select 数据由 alembic 0030 已迁移到单值列；此处保持双向写。
        """
        ids: list[str] = []
        if batch.annotator_id:
            ids.append(str(batch.annotator_id))
        if batch.reviewer_id:
            ids.append(str(batch.reviewer_id))
        batch.assigned_user_ids = ids

    async def _cascade_task_assignee(
        self,
        batch_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> None:
        """v0.7.2：batch 改 annotator → 该 batch 下所有 task.assignee_id 跟随。
        v0.8.4：同步写 assigned_at = now()（user_id 非空时）/ 清空（user_id 为空时）。
        """
        values: dict[str, Any] = {"assignee_id": user_id}
        values["assigned_at"] = func.now() if user_id is not None else None
        await self.db.execute(
            update(Task).where(Task.batch_id == batch_id).values(**values)
        )

    async def _cascade_task_reviewer(
        self,
        batch_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> None:
        """v0.7.2：batch 改 reviewer → 该 batch 下所有 task.reviewer_id 跟随。"""
        await self.db.execute(
            update(Task).where(Task.batch_id == batch_id).values(reviewer_id=user_id)
        )

    async def transition(
        self,
        batch_id: uuid.UUID,
        target_status: str,
        actor_id: uuid.UUID | None = None,
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
            count = (
                await self.db.execute(
                    select(func.count())
                    .select_from(Task)
                    .where(Task.batch_id == batch_id)
                )
            ).scalar() or 0
            if count == 0:
                raise HTTPException(
                    status_code=400, detail="cannot activate empty batch"
                )

        # v0.7.3：approved → reviewing 重开审核 — 清空原审核元数据（reviewed_at / reviewed_by / review_feedback）
        # rejected → reviewing 不清反馈：复审时 reviewer 需要看到上次原因
        from_status = batch.status
        if (from_status, target_status) == (
            BatchStatus.APPROVED,
            BatchStatus.REVIEWING,
        ):
            batch.review_feedback = None
            batch.reviewed_at = None
            batch.reviewed_by = None

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
            raise HTTPException(
                status_code=400, detail="Cannot delete the default batch"
            )

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
                update(Task).where(Task.batch_id == batch_id).values(batch_id=None)
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
        raise HTTPException(
            status_code=400, detail=f"Unknown strategy: {data.strategy}"
        )

    async def _split_random(
        self,
        project_id: uuid.UUID,
        data: BatchSplitRequest,
        created_by: uuid.UUID,
    ) -> list[TaskBatch]:
        n = data.n_batches
        if not n:
            raise HTTPException(
                status_code=400, detail="n_batches is required for random strategy"
            )

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
                annotator_id=data.annotator_id,
                reviewer_id=data.reviewer_id,
                created_by=created_by,
            )
            self._sync_assigned_user_ids(batch)
            self.db.add(batch)
            await self.db.flush()

            await self._assign_tasks(batch.id, chunk)
            await self.recalculate_counters(batch.id)
            batches.append(batch)

        if default is not None:
            await self.recalculate_counters(default.id)
        return batches

    async def _split_metadata(
        self,
        project_id: uuid.UUID,
        data: BatchSplitRequest,
        created_by: uuid.UUID,
    ) -> TaskBatch:
        if not data.metadata_key or data.metadata_value is None:
            raise HTTPException(
                status_code=400, detail="metadata_key and metadata_value are required"
            )

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
            raise HTTPException(
                status_code=400, detail="No tasks match the metadata filter"
            )

        batch = TaskBatch(
            project_id=project_id,
            display_id=await next_display_id(self.db, "batches"),
            name=f"{data.name_prefix} ({data.metadata_key}={data.metadata_value})",
            status=BatchStatus.DRAFT,
            priority=data.priority,
            deadline=data.deadline,
            annotator_id=data.annotator_id,
            reviewer_id=data.reviewer_id,
            created_by=created_by,
        )
        self._sync_assigned_user_ids(batch)
        self.db.add(batch)
        await self.db.flush()

        await self._assign_tasks(batch.id, task_ids)
        await self.recalculate_counters(batch.id)
        if default is not None:
            await self.recalculate_counters(default.id)
        return batch

    async def _split_by_ids(
        self,
        project_id: uuid.UUID,
        data: BatchSplitRequest,
        created_by: uuid.UUID,
    ) -> TaskBatch:
        if not data.item_ids:
            raise HTTPException(
                status_code=400, detail="item_ids is required for id_range strategy"
            )

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
            raise HTTPException(
                status_code=400, detail="No tasks match the provided item IDs"
            )

        batch = TaskBatch(
            project_id=project_id,
            display_id=await next_display_id(self.db, "batches"),
            name=data.name_prefix,
            status=BatchStatus.DRAFT,
            priority=data.priority,
            deadline=data.deadline,
            annotator_id=data.annotator_id,
            reviewer_id=data.reviewer_id,
            created_by=created_by,
        )
        self._sync_assigned_user_ids(batch)
        self.db.add(batch)
        await self.db.flush()

        await self._assign_tasks(batch.id, task_ids)
        await self.recalculate_counters(batch.id)
        if default is not None:
            await self.recalculate_counters(default.id)
        return batch

    # ── Task assignment ────────────────────────────────────────────────────

    async def _assign_tasks(
        self, batch_id: uuid.UUID, task_ids: list[uuid.UUID]
    ) -> int:
        if not task_ids:
            return 0
        await self.db.execute(
            update(Task).where(Task.id.in_(task_ids)).values(batch_id=batch_id)
        )
        return len(task_ids)

    async def assign_tasks_to_batch(
        self, batch_id: uuid.UUID, task_ids: list[uuid.UUID]
    ) -> int:
        count = await self._assign_tasks(batch_id, task_ids)
        await self.recalculate_counters(batch_id)
        return count

    async def distribute_batches_in_project(
        self,
        project_id: uuid.UUID,
        *,
        annotator_ids: list[uuid.UUID],
        reviewer_ids: list[uuid.UUID],
        only_unassigned: bool = True,
    ) -> dict[str, Any]:
        """v0.7.2：把项目下的 batch 圆周分派给所选 annotator / reviewer。
        - 一 batch = 一标注员 + 一审核员
        - only_unassigned=True：仅 annotator_id IS NULL 的 batch 写 annotator；reviewer 同理
        - 不会处理 archived 状态的 batch
        - 同时回填 batch 下所有 task 的 assignee_id / reviewer_id
        """
        if not annotator_ids and not reviewer_ids:
            raise HTTPException(
                status_code=400, detail="annotator_ids or reviewer_ids required"
            )

        # 取项目下非 archived 的 batch
        batches = (
            (
                await self.db.execute(
                    select(TaskBatch)
                    .where(TaskBatch.project_id == project_id)
                    .where(TaskBatch.status != BatchStatus.ARCHIVED)
                    .order_by(TaskBatch.priority.desc(), TaskBatch.created_at)
                )
            )
            .scalars()
            .all()
        )
        if not batches:
            raise HTTPException(status_code=400, detail="No batches to distribute")

        annotator_per_batch: dict[str, str | None] = {}
        reviewer_per_batch: dict[str, str | None] = {}
        affected = 0
        a_idx = 0
        r_idx = 0
        for b in batches:
            changed = False
            if annotator_ids and (not only_unassigned or b.annotator_id is None):
                pick = annotator_ids[a_idx % len(annotator_ids)]
                a_idx += 1
                if b.annotator_id != pick:
                    b.annotator_id = pick
                    await self._cascade_task_assignee(b.id, pick)
                    changed = True
                annotator_per_batch[str(b.id)] = str(pick)
            else:
                annotator_per_batch[str(b.id)] = (
                    str(b.annotator_id) if b.annotator_id else None
                )

            if reviewer_ids and (not only_unassigned or b.reviewer_id is None):
                pick = reviewer_ids[r_idx % len(reviewer_ids)]
                r_idx += 1
                if b.reviewer_id != pick:
                    b.reviewer_id = pick
                    await self._cascade_task_reviewer(b.id, pick)
                    changed = True
                reviewer_per_batch[str(b.id)] = str(pick)
            else:
                reviewer_per_batch[str(b.id)] = (
                    str(b.reviewer_id) if b.reviewer_id else None
                )

            if changed:
                self._sync_assigned_user_ids(b)
                affected += 1

        await self.db.flush()

        return {
            "distributed_batches": affected,
            "annotator_per_batch": annotator_per_batch,
            "reviewer_per_batch": reviewer_per_batch,
        }

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

        if batch.status in (BatchStatus.ACTIVE, BatchStatus.PRE_ANNOTATED):
            has_in_progress = await self.db.execute(
                select(Task.id)
                .where(
                    Task.batch_id == batch_id,
                    Task.status == "in_progress",
                )
                .limit(1)
            )
            if has_in_progress.scalar_one_or_none():
                batch.status = BatchStatus.ANNOTATING
                await self.db.flush()

        elif batch.status == BatchStatus.ANNOTATING:
            pending_or_ip = await self.db.execute(
                select(Task.id)
                .where(
                    Task.batch_id == batch_id,
                    Task.status.in_(["pending", "in_progress"]),
                )
                .limit(1)
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

    # ── Reset to draft (v0.7.6) ────────────────────────────────────────────

    async def reset_to_draft(self, batch_id: uuid.UUID) -> tuple[TaskBatch, int]:
        """v0.7.6 · 终极重置：任意状态 → draft。

        - task 全部回 pending（不论 review / completed / in_progress）
        - 保留 annotation 记录与 is_active（参考 reject_batch 模式）
        - 删除该批次下所有 task_locks（释放标注员锁）
        - 清空 review_feedback / reviewed_at / reviewed_by
        - 不调用 VALID_TRANSITIONS — 这是绕过状态机的 owner 兜底操作

        调用方负责：鉴权（owner-only）、reason 校验（schema 层 min_length=10）、audit 打点。
        """
        from app.db.models.task_lock import TaskLock

        batch = await self.db.get(TaskBatch, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")

        result = await self.db.execute(
            update(Task)
            .where(
                Task.batch_id == batch_id,
                Task.status != "pending",
            )
            .values(status="pending")
        )
        affected = result.rowcount

        await self.db.execute(
            delete(TaskLock).where(
                TaskLock.task_id.in_(select(Task.id).where(Task.batch_id == batch_id))
            )
        )

        batch.status = BatchStatus.DRAFT
        batch.review_feedback = None
        batch.reviewed_at = None
        batch.reviewed_by = None

        await self.db.flush()
        await self.recalculate_counters(batch_id)
        return batch, affected

    # ── Bulk operations (v0.7.3) ───────────────────────────────────────────

    async def _list_batches_in_project(
        self,
        project_id: uuid.UUID,
        batch_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, TaskBatch]:
        if not batch_ids:
            return {}
        result = await self.db.execute(
            select(TaskBatch).where(
                TaskBatch.project_id == project_id,
                TaskBatch.id.in_(batch_ids),
            )
        )
        return {b.id: b for b in result.scalars().all()}

    async def bulk_archive(
        self,
        project_id: uuid.UUID,
        batch_ids: list[uuid.UUID],
    ) -> dict[str, list[dict]]:
        """逐个 transition → archived。已 archived 算 skipped。
        语法层不允许的迁移（如 draft → archived）目前 VALID_TRANSITIONS 不收，会回 failed。"""
        loaded = await self._list_batches_in_project(project_id, batch_ids)
        succeeded: list[uuid.UUID] = []
        skipped: list[dict] = []
        failed: list[dict] = []
        for bid in batch_ids:
            batch = loaded.get(bid)
            if batch is None:
                failed.append({"batch_id": bid, "reason": "not found"})
                continue
            if batch.status == BatchStatus.ARCHIVED:
                skipped.append({"batch_id": bid, "reason": "already archived"})
                continue
            allowed = VALID_TRANSITIONS.get(batch.status, set())
            if BatchStatus.ARCHIVED not in allowed:
                failed.append(
                    {"batch_id": bid, "reason": f"cannot archive from '{batch.status}'"}
                )
                continue
            batch.status = BatchStatus.ARCHIVED
            succeeded.append(bid)
        await self.db.flush()
        return {"succeeded": succeeded, "skipped": skipped, "failed": failed}

    async def bulk_delete(
        self,
        project_id: uuid.UUID,
        batch_ids: list[uuid.UUID],
    ) -> dict[str, list[dict]]:
        loaded = await self._list_batches_in_project(project_id, batch_ids)
        succeeded: list[uuid.UUID] = []
        skipped: list[dict] = []
        failed: list[dict] = []
        default = await self.get_default_batch(project_id)
        for bid in batch_ids:
            batch = loaded.get(bid)
            if batch is None:
                failed.append({"batch_id": bid, "reason": "not found"})
                continue
            if batch.display_id == "B-DEFAULT":
                skipped.append(
                    {"batch_id": bid, "reason": "B-DEFAULT cannot be deleted"}
                )
                continue
            # 复用单个删除路径里的 task 接管逻辑（按 default 是否存在二选一）
            if default is not None:
                await self.db.execute(
                    update(Task).where(Task.batch_id == bid).values(batch_id=default.id)
                )
            else:
                await self.db.execute(
                    update(Task).where(Task.batch_id == bid).values(batch_id=None)
                )
            await self.db.execute(delete(TaskBatch).where(TaskBatch.id == bid))
            succeeded.append(bid)
        await self.db.flush()
        if default is not None and succeeded:
            await self.recalculate_counters(default.id)
        return {"succeeded": succeeded, "skipped": skipped, "failed": failed}

    async def bulk_reassign(
        self,
        project_id: uuid.UUID,
        batch_ids: list[uuid.UUID],
        *,
        annotator_id: uuid.UUID | None,
        reviewer_id: uuid.UUID | None,
        annotator_set: bool,
        reviewer_set: bool,
    ) -> dict[str, list[dict]]:
        """单事务原子改派。annotator_set/reviewer_set 为 True 时表示该字段需要更新（值可以是 None 表示清空）。"""
        if not annotator_set and not reviewer_set:
            raise HTTPException(
                status_code=400, detail="annotator_id or reviewer_id required"
            )
        loaded = await self._list_batches_in_project(project_id, batch_ids)
        succeeded: list[uuid.UUID] = []
        failed: list[dict] = []
        for bid in batch_ids:
            batch = loaded.get(bid)
            if batch is None:
                failed.append({"batch_id": bid, "reason": "not found"})
                continue
            if annotator_set:
                batch.annotator_id = annotator_id
                await self._cascade_task_assignee(bid, annotator_id)
            if reviewer_set:
                batch.reviewer_id = reviewer_id
                await self._cascade_task_reviewer(bid, reviewer_id)
            self._sync_assigned_user_ids(batch)
            succeeded.append(bid)
        await self.db.flush()
        return {"succeeded": succeeded, "skipped": [], "failed": failed}

    async def bulk_activate(
        self,
        project_id: uuid.UUID,
        batch_ids: list[uuid.UUID],
    ) -> dict[str, list[dict]]:
        """逐个 draft → active。前置不满足（无 annotator / 0 task）→ failed。"""
        loaded = await self._list_batches_in_project(project_id, batch_ids)
        succeeded: list[uuid.UUID] = []
        skipped: list[dict] = []
        failed: list[dict] = []
        for bid in batch_ids:
            batch = loaded.get(bid)
            if batch is None:
                failed.append({"batch_id": bid, "reason": "not found"})
                continue
            if batch.status == BatchStatus.ACTIVE:
                skipped.append({"batch_id": bid, "reason": "already active"})
                continue
            if batch.status != BatchStatus.DRAFT:
                failed.append(
                    {
                        "batch_id": bid,
                        "reason": f"cannot activate from '{batch.status}'",
                    }
                )
                continue
            if batch.annotator_id is None:
                failed.append({"batch_id": bid, "reason": "no annotator assigned"})
                continue
            count = (
                await self.db.execute(
                    select(func.count()).select_from(Task).where(Task.batch_id == bid)
                )
            ).scalar() or 0
            if count == 0:
                failed.append({"batch_id": bid, "reason": "batch has no tasks"})
                continue
            batch.status = BatchStatus.ACTIVE
            succeeded.append(bid)
        await self.db.flush()
        return {"succeeded": succeeded, "skipped": skipped, "failed": failed}

    # ── AI/ML hook ─────────────────────────────────────────────────────────

    async def on_batch_approved(self, batch_id: uuid.UUID) -> None:
        # TODO(v0.7.x+)：active learning 闭环 — 把已通过批次推回 ML backend 训练队列。
        # 依赖 ML backend / 训练队列基座（ROADMAP A · AI/模型 区）落地后再实现。
        logger.info(
            "on_batch_approved hook: batch_id=%s — no-op (reserved for active learning)",
            batch_id,
        )
