"""v0.5.4 逐框评论路由：annotation_comments 表 CRUD + audit_log 通知钩子。

注册到 api/v1/router.py 后端点路径形如：
- GET    /annotations/{aid}/comments
- POST   /annotations/{aid}/comments
- PATCH  /comments/{id}
- DELETE /comments/{id}（软删）
- POST   /annotations/{aid}/comment-attachments/upload-init  (v0.6.2)
"""

import base64
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import assert_project_visible, get_db, require_roles
from app.db.enums import UserRole
from app.db.models.annotation import Annotation
from app.db.models.annotation_comment import AnnotationComment
from app.db.models.project_member import ProjectMember
from app.db.models.user import User
from app.schemas.annotation_comment import (
    ATTACHMENT_KEY_PREFIX,
    AnnotationCommentCreate,
    AnnotationCommentListPage,
    AnnotationCommentOut,
    AnnotationCommentUpdate,
    CommentAttachmentUploadInitRequest,
    CommentAttachmentUploadInitResponse,
)
from app.services.audit import AuditAction, AuditService
from app.services.storage import storage_service

router = APIRouter()

_ALL_ANNOTATORS = (
    UserRole.SUPER_ADMIN,
    UserRole.PROJECT_ADMIN,
    UserRole.REVIEWER,
    UserRole.ANNOTATOR,
)


def _to_out(
    c: AnnotationComment, author_name: str | None = None
) -> AnnotationCommentOut:
    return AnnotationCommentOut(
        id=c.id,
        annotation_id=c.annotation_id,
        project_id=c.project_id,
        author_id=c.author_id,
        author_name=author_name,
        body=c.body,
        is_resolved=c.is_resolved,
        is_active=c.is_active,
        mentions=c.mentions or [],
        attachments=c.attachments or [],
        canvas_drawing=c.canvas_drawing,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


async def _validate_project_members(
    db: AsyncSession,
    project_id: uuid.UUID,
    user_ids: list[uuid.UUID],
) -> None:
    """mentions[].userId 必须是该项目的成员（含 owner / project_admin / super_admin 不强制走 project_members 表）。
    出于简化，仅校验 user 存在且是该项目 project_members 表成员；超管不在表里时也允许。"""
    if not user_ids:
        return
    rows = (
        await db.execute(
            select(ProjectMember.user_id).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id.in_(user_ids),
            )
        )
    ).all()
    found = {r[0] for r in rows}
    # 超管 / 项目所有者 也允许（不一定在 project_members 表中）
    super_rows = (
        await db.execute(
            select(User.id).where(
                User.id.in_(user_ids),
                User.role.in_(
                    [UserRole.SUPER_ADMIN.value, UserRole.PROJECT_ADMIN.value]
                ),
            )
        )
    ).all()
    found |= {r[0] for r in super_rows}
    missing = [str(uid) for uid in user_ids if uid not in found]
    if missing:
        raise HTTPException(
            status_code=422,
            detail={"error": "mentions_invalid", "non_member_user_ids": missing},
        )


@router.get(
    "/annotations/{annotation_id}/comments", response_model=list[AnnotationCommentOut]
)
async def list_comments(
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    """v0.8.8 · 旧端点保留作向后兼容；新调用方走 ``/comments/page`` keyset 分页。"""
    rows = (
        await db.execute(
            select(AnnotationComment, User.name)
            .join(User, User.id == AnnotationComment.author_id)
            .where(
                AnnotationComment.annotation_id == annotation_id,
                AnnotationComment.is_active.is_(True),
            )
            .order_by(AnnotationComment.created_at.desc())
        )
    ).all()
    return [_to_out(c, name) for c, name in rows]


def _encode_comment_cursor(ts: datetime, cid: uuid.UUID) -> str:
    """v0.8.8 · base64-urlsafe(<iso_ts>|<uuid_hex>)，与 task cursor 同款，避免 + / 在 URL 中的问题。"""
    iso = ts.isoformat()
    return base64.urlsafe_b64encode(f"{iso}|{cid.hex}".encode()).decode()


def _decode_comment_cursor(raw: str) -> tuple[datetime, uuid.UUID]:
    try:
        decoded = base64.urlsafe_b64decode(raw.encode()).decode()
        ts_part, id_hex = decoded.split("|", 1)
        return datetime.fromisoformat(ts_part), uuid.UUID(id_hex)
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=400, detail="invalid_cursor") from exc


@router.get(
    "/annotations/{annotation_id}/comments/page",
    response_model=AnnotationCommentListPage,
)
async def list_comments_paged(
    annotation_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    """v0.8.8 · keyset 分页：DESC(created_at, id)。

    单条标注 100+ 评论时初始化卡顿明显（CommentsPanel 全量拉），改为「最新 50
    + 加载更早」按需拉取。返回 ``next_cursor=None`` 即末尾。
    """
    q = (
        select(AnnotationComment, User.name)
        .join(User, User.id == AnnotationComment.author_id)
        .where(
            AnnotationComment.annotation_id == annotation_id,
            AnnotationComment.is_active.is_(True),
        )
    )
    if cursor:
        last_ts, last_id = _decode_comment_cursor(cursor)
        q = q.where(
            or_(
                AnnotationComment.created_at < last_ts,
                and_(
                    AnnotationComment.created_at == last_ts,
                    AnnotationComment.id < last_id,
                ),
            )
        )
    q = q.order_by(
        AnnotationComment.created_at.desc(), AnnotationComment.id.desc()
    ).limit(limit)

    rows = (await db.execute(q)).all()
    items = [_to_out(c, name) for c, name in rows]
    next_cursor: str | None = None
    if len(rows) == limit and rows:
        last = rows[-1][0]
        next_cursor = _encode_comment_cursor(last.created_at, last.id)
    return AnnotationCommentListPage(items=items, next_cursor=next_cursor)


@router.post(
    "/annotations/{annotation_id}/comments",
    response_model=AnnotationCommentOut,
    status_code=201,
)
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

    # mentions 必须是项目成员
    if data.mentions and ann.project_id is not None:
        await _validate_project_members(
            db, ann.project_id, [m.user_id for m in data.mentions]
        )

    comment = AnnotationComment(
        id=uuid.uuid4(),
        annotation_id=annotation_id,
        project_id=ann.project_id,
        author_id=current_user.id,
        body=data.body,
        mentions=[m.model_dump(by_alias=True, mode="json") for m in data.mentions],
        attachments=[
            a.model_dump(by_alias=True, mode="json") for a in data.attachments
        ],
        canvas_drawing=data.canvas_drawing,
    )
    db.add(comment)
    await db.flush()
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_COMMENT_ADD,
        target_type="annotation",
        target_id=str(annotation_id),
        request=request,
        status_code=201,
        detail={
            "project_id": str(ann.project_id) if ann.project_id else None,
            "comment_id": str(comment.id),
            "preview": data.body[:120],
            "mention_count": len(data.mentions),
            "attachment_count": len(data.attachments),
            "has_canvas_drawing": data.canvas_drawing is not None,
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
    if c.author_id != current_user.id and current_user.role not in {
        UserRole.SUPER_ADMIN,
        UserRole.PROJECT_ADMIN,
    }:
        raise HTTPException(
            status_code=403, detail="Only the author can edit this comment"
        )
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
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    c = await db.get(AnnotationComment, comment_id)
    if not c or not c.is_active:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.author_id != current_user.id and current_user.role not in {
        UserRole.SUPER_ADMIN,
        UserRole.PROJECT_ADMIN,
    }:
        raise HTTPException(
            status_code=403, detail="Only the author can delete this comment"
        )
    c.is_active = False
    # v0.7.2 · annotation 编辑历史可追溯
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_COMMENT_DELETE,
        target_type="annotation",
        target_id=str(c.annotation_id),
        request=request,
        status_code=204,
        detail={"comment_id": str(comment_id), "preview": (c.body or "")[:120]},
    )
    await db.commit()
    return


@router.post(
    "/annotations/{annotation_id}/comment-attachments/upload-init",
    response_model=CommentAttachmentUploadInitResponse,
)
async def comment_attachment_upload_init(
    annotation_id: uuid.UUID,
    data: CommentAttachmentUploadInitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    """v0.6.2：评论附件签发预签名 PUT URL。

    storage_key 形如 `comment-attachments/{aid}/{uuid}-{filename}`，固定前缀使得后端可
    校验 attachments[].storageKey；同时让 MinIO 桶层级清晰。"""
    ann = await db.get(Annotation, annotation_id)
    if not ann or not ann.is_active:
        raise HTTPException(status_code=404, detail="Annotation not found")
    safe_name = data.file_name.replace("/", "_").replace("\\", "_")
    storage_key = f"{ATTACHMENT_KEY_PREFIX}{annotation_id}/{uuid.uuid4()}-{safe_name}"
    upload_url = storage_service.generate_upload_url(storage_key, data.content_type)
    return CommentAttachmentUploadInitResponse(
        storage_key=storage_key,
        upload_url=upload_url,
        expires_in=900,
    )


@router.get("/annotations/{annotation_id}/comment-attachments/download")
async def comment_attachment_download(
    annotation_id: uuid.UUID,
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    """v0.6.3 P0：评论附件下载。校验 key 前缀防越权 + 项目可见性，302 跳转预签名 URL。"""
    expected_prefix = f"{ATTACHMENT_KEY_PREFIX}{annotation_id}/"
    if not key.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="invalid attachment key")
    ann = await db.get(Annotation, annotation_id)
    if not ann or not ann.is_active:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if ann.project_id is not None:
        await assert_project_visible(ann.project_id, db, current_user)
    url = storage_service.generate_download_url(key, expires_in=300)
    return RedirectResponse(url, status_code=302)
