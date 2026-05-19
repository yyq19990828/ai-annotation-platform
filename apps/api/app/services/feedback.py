"""I18 · AnnotationFeedback service.

ADR-0027 第二阶段 (v0.10.20): 旧 bug_reports / annotation_comments / tasks.reject_reason
写路径加双写, 通过 mirror_* helper 在同事务内 INSERT 新表 + 失败一起回滚.
"""

from __future__ import annotations

import base64
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation_feedback import AnnotationFeedback

logger = logging.getLogger(__name__)


class FeedbackService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        *,
        author_id: uuid.UUID,
        kind: str,
        anchor_type: str,
        project_id: uuid.UUID,
        task_id: uuid.UUID | None,
        annotation_id: uuid.UUID | None,
        anchor_position: dict | None,
        severity: str | None,
        title: str | None,
        body: str,
        attachments: list[dict],
        thread_parent_id: uuid.UUID | None,
    ) -> AnnotationFeedback:
        entry = AnnotationFeedback(
            kind=kind,
            anchor_type=anchor_type,
            project_id=project_id,
            task_id=task_id,
            annotation_id=annotation_id,
            anchor_position=anchor_position,
            severity=severity,
            title=title,
            body=body,
            attachments=attachments,
            thread_parent_id=thread_parent_id,
            author_id=author_id,
            status="open",
            is_active=True,
        )
        self.db.add(entry)
        await self.db.flush()
        return entry

    async def patch(
        self,
        feedback_id: uuid.UUID,
        *,
        actor_id: uuid.UUID,
        status: str | None = None,
        severity: str | None = None,
        title: str | None = None,
        body: str | None = None,
    ) -> AnnotationFeedback:
        entry = await self.db.get(AnnotationFeedback, feedback_id)
        if entry is None or not entry.is_active:
            raise HTTPException(status_code=404, detail="feedback not found")
        if status is not None and status != entry.status:
            entry.status = status
            if status in ("resolved", "wont_fix"):
                entry.resolved_at = datetime.now(timezone.utc)
                entry.resolved_by_id = actor_id
            else:
                entry.resolved_at = None
                entry.resolved_by_id = None
        if severity is not None:
            entry.severity = severity
        if title is not None:
            entry.title = title
        if body is not None:
            entry.body = body
        await self.db.flush()
        return entry

    # ------------------------------------------------------------------
    # ADR-0027 第二段 (v0.10.20) · 旧三表双写 mirror helpers
    #
    # 设计: 各 helper 接受 legacy 模型实例, 提取字段构造 AnnotationFeedback INSERT
    # 在同一 session/事务中执行. 调用方在 legacy 写后立刻调, db.commit() 时一起落库;
    # 任一失败 → 整体回滚, 不留半边写.
    # ------------------------------------------------------------------

    async def mirror_bug_report(self, bug_report) -> AnnotationFeedback:
        """legacy bug_reports.INSERT 后镜像写入 annotation_feedbacks (kind=bug)."""
        anchor_type = "task" if bug_report.task_id is not None else "project"
        # project_id NOT NULL in annotation_feedbacks; bug_reports.project_id may be null
        # → 该情况下不 mirror (无项目归属的 bug 仍只在 bug_reports 存在; v0.10.21 切单源时
        #   单独处理 — 那批通常是登录页 / 未进项目的 bug 反馈)
        if bug_report.project_id is None:
            logger.debug(
                "[ADR-0027] skip mirror bug_report=%s (project_id is null)",
                bug_report.id,
            )
            return None  # type: ignore[return-value]
        feedback = AnnotationFeedback(
            kind="bug",
            anchor_type=anchor_type,
            project_id=bug_report.project_id,
            task_id=bug_report.task_id,
            annotation_id=None,
            anchor_position=None,
            status="open",
            severity=bug_report.severity,
            title=bug_report.title,
            body=bug_report.description,
            attachments=[],
            thread_parent_id=None,
            author_id=bug_report.reporter_id,
            is_active=True,
        )
        self.db.add(feedback)
        await self.db.flush()
        logger.info(
            "[ADR-0027 double-write] bug_reports %s → feedback %s",
            bug_report.id,
            feedback.id,
        )
        return feedback

    async def mirror_annotation_comment(
        self, comment, *, task_id: uuid.UUID
    ) -> AnnotationFeedback:
        """legacy annotation_comments.INSERT 后镜像写入 (kind=comment, anchor=annotation).

        task_id 由调用方从 Annotation 实例取出 (annotation_feedbacks.anchor_type='annotation'
        CHECK 要求 task_id NOT NULL).
        """
        feedback = AnnotationFeedback(
            kind="comment",
            anchor_type="annotation",
            project_id=comment.project_id,
            task_id=task_id,
            annotation_id=comment.annotation_id,
            anchor_position=None,
            status="open",
            severity=None,
            title=None,
            body=comment.body,
            attachments=comment.attachments or [],
            thread_parent_id=None,
            author_id=comment.author_id,
            is_active=True,
        )
        self.db.add(feedback)
        await self.db.flush()
        logger.info(
            "[ADR-0027 double-write] annotation_comments %s → feedback %s",
            comment.id,
            feedback.id,
        )
        return feedback

    async def mirror_task_reject(
        self,
        task,
        *,
        reviewer_id: uuid.UUID,
    ) -> AnnotationFeedback:
        """legacy tasks.reject_reason 设置后镜像写入 (kind=reject, anchor=task).

        reject_reason_type → severity (info/warn/blocker 不强制, 沿用枚举原值).
        """
        feedback = AnnotationFeedback(
            kind="reject",
            anchor_type="task",
            project_id=task.project_id,
            task_id=task.id,
            annotation_id=None,
            anchor_position=None,
            status="open",
            severity=task.reject_reason_type,
            title=None,
            body=task.reject_reason or "",
            attachments=[],
            thread_parent_id=None,
            author_id=reviewer_id,
            is_active=True,
        )
        self.db.add(feedback)
        await self.db.flush()
        logger.info(
            "[ADR-0027 double-write] tasks.reject %s → feedback %s",
            task.id,
            feedback.id,
        )
        return feedback

    async def soft_delete(self, feedback_id: uuid.UUID) -> AnnotationFeedback:
        entry = await self.db.get(AnnotationFeedback, feedback_id)
        if entry is None or not entry.is_active:
            raise HTTPException(status_code=404, detail="feedback not found")
        entry.is_active = False
        await self.db.flush()
        return entry

    async def list_paged(
        self,
        *,
        project_id: uuid.UUID,
        task_id: uuid.UUID | None = None,
        annotation_id: uuid.UUID | None = None,
        kind: str | None = None,
        anchor_type: str | None = None,
        status: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[AnnotationFeedback], str | None]:
        q = select(AnnotationFeedback).where(
            AnnotationFeedback.project_id == project_id,
            AnnotationFeedback.is_active.is_(True),
        )
        if task_id is not None:
            q = q.where(AnnotationFeedback.task_id == task_id)
        if annotation_id is not None:
            q = q.where(AnnotationFeedback.annotation_id == annotation_id)
        if kind is not None:
            q = q.where(AnnotationFeedback.kind == kind)
        if anchor_type is not None:
            q = q.where(AnnotationFeedback.anchor_type == anchor_type)
        if status is not None:
            q = q.where(AnnotationFeedback.status == status)
        if cursor:
            last_ts, last_id = _decode_cursor(cursor)
            q = q.where(
                or_(
                    AnnotationFeedback.created_at < last_ts,
                    and_(
                        AnnotationFeedback.created_at == last_ts,
                        AnnotationFeedback.id < last_id,
                    ),
                )
            )
        q = q.order_by(
            AnnotationFeedback.created_at.desc(), AnnotationFeedback.id.desc()
        ).limit(limit + 1)
        rows = list((await self.db.execute(q)).scalars().all())
        next_cursor: str | None = None
        if len(rows) > limit:
            anchor = rows[limit - 1]
            next_cursor = _encode_cursor(anchor.created_at, anchor.id)
            rows = rows[:limit]
        return rows, next_cursor


def _encode_cursor(created_at: datetime, fid: uuid.UUID) -> str:
    ts = (
        created_at.astimezone(timezone.utc).isoformat()
        if created_at.tzinfo
        else created_at.isoformat()
    )
    return base64.urlsafe_b64encode(f"{ts}|{fid.hex}".encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    ts_str, id_hex = raw.split("|", 1)
    return datetime.fromisoformat(ts_str), uuid.UUID(id_hex)
