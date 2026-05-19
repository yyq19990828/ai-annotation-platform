"""I18 · AnnotationFeedback service.

只覆盖新表 CRUD; 旧 bug_reports / annotation_comments 写路径不动 (ADR-0027 第一阶段).
"""

from __future__ import annotations

import base64
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation_feedback import AnnotationFeedback


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
