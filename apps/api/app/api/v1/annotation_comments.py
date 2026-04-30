"""v0.5.4 逐框评论路由：annotation_comments 表 CRUD + audit_log 通知钩子。

注册到 api/v1/router.py 后端点路径形如：
- GET    /annotations/{aid}/comments
- POST   /annotations/{aid}/comments
- PATCH  /comments/{id}
- DELETE /comments/{id}（软删）
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_roles
from app.db.enums import UserRole
from app.db.models.annotation import Annotation
from app.db.models.annotation_comment import AnnotationComment
from app.db.models.user import User
from app.schemas.annotation_comment import (
    AnnotationCommentCreate,
    AnnotationCommentOut,
    AnnotationCommentUpdate,
)
from app.services.audit import AuditService

router = APIRouter()

_ALL_ANNOTATORS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER, UserRole.ANNOTATOR)


def _to_out(c: AnnotationComment, author_name: str | None = None) -> AnnotationCommentOut:
    return AnnotationCommentOut(
        id=c.id,
        annotation_id=c.annotation_id,
        project_id=c.project_id,
        author_id=c.author_id,
        author_name=author_name,
        body=c.body,
        is_resolved=c.is_resolved,
        is_active=c.is_active,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@router.get("/annotations/{annotation_id}/comments", response_model=list[AnnotationCommentOut])
async def list_comments(
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    rows = (await db.execute(
        select(AnnotationComment, User.name)
        .join(User, User.id == AnnotationComment.author_id)
        .where(AnnotationComment.annotation_id == annotation_id, AnnotationComment.is_active.is_(True))
        .order_by(AnnotationComment.created_at.desc())
    )).all()
    return [_to_out(c, name) for c, name in rows]


@router.post("/annotations/{annotation_id}/comments", response_model=AnnotationCommentOut, status_code=201)
async def create_comment(
    annotation_id: uuid.UUID,
    data: AnnotationCommentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    ann = await db.get(Annotation, annotation_id)
    if not ann or not ann.is_active:
        raise HTTPException(status_code=404, detail="Annotation not found")
    comment = AnnotationComment(
        id=uuid.uuid4(),
        annotation_id=annotation_id,
        project_id=ann.project_id,
        author_id=current_user.id,
        body=data.body,
    )
    db.add(comment)
    await db.flush()
    await AuditService.log(
        db,
        actor=current_user,
        action="annotation.comment",
        target_type="annotation",
        target_id=str(annotation_id),
        request=request,
        status_code=201,
        detail={
            "project_id": str(ann.project_id) if ann.project_id else None,
            "comment_id": str(comment.id),
            "preview": data.body[:120],
        },
    )
    await db.commit()
    await db.refresh(comment)
    return _to_out(comment, current_user.name)


@router.patch("/comments/{comment_id}", response_model=AnnotationCommentOut)
async def patch_comment(
    comment_id: uuid.UUID,
    data: AnnotationCommentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    c = await db.get(AnnotationComment, comment_id)
    if not c or not c.is_active:
        raise HTTPException(status_code=404, detail="Comment not found")
    # 仅作者或管理员可改
    if c.author_id != current_user.id and current_user.role not in {UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN}:
        raise HTTPException(status_code=403, detail="Only the author can edit this comment")
    if data.body is not None:
        c.body = data.body
    if data.is_resolved is not None:
        c.is_resolved = data.is_resolved
    await db.commit()
    await db.refresh(c)
    return _to_out(c)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    c = await db.get(AnnotationComment, comment_id)
    if not c or not c.is_active:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.author_id != current_user.id and current_user.role not in {UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN}:
        raise HTTPException(status_code=403, detail="Only the author can delete this comment")
    c.is_active = False
    await db.commit()
    return
