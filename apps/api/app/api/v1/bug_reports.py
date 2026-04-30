import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ratelimit import limiter
from app.deps import get_db, get_current_user, require_roles
from app.db.enums import UserRole
from app.db.models.user import User
from app.schemas.bug_report import (
    BugReportCreate,
    BugReportUpdate,
    BugReportOut,
    BugReportDetail,
    BugReportList,
    BugCommentCreate,
    BugCommentOut,
)
from app.services.bug_report import BugReportService
from app.services.audit import AuditService

router = APIRouter()


@router.post("/bug_reports", response_model=BugReportOut, status_code=201)
@limiter.limit("10/hour")
async def create_bug_report(
    data: BugReportCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BugReportService(db)
    create_fields = data.model_dump(exclude_unset=True)
    route = create_fields.pop("route", "") or str(request.url.path)
    report = await svc.create(
        reporter_id=current_user.id,
        user_role=current_user.role,
        route=route,
        **create_fields,
    )
    await AuditService.log(
        db,
        actor=current_user,
        action="bug_report.created",
        target_type="bug_report",
        target_id=str(report.id),
        request=request,
        status_code=201,
        detail={"display_id": report.display_id, "route": route},
    )
    await db.commit()
    await db.refresh(report)
    return report


@router.get("/bug_reports", response_model=BugReportList)
async def list_bug_reports(
    status: str | None = Query(None),
    severity: str | None = Query(None),
    route: str | None = Query(None),
    format: str | None = Query(None, alias="format"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)),
):
    svc = BugReportService(db)
    if format == "markdown":
        from fastapi.responses import PlainTextResponse
        md = await svc.list_markdown(status=status or "new")
        return PlainTextResponse(content=md, media_type="text/markdown; charset=utf-8")

    items, total = await svc.list(status=status, severity=severity, route=route, limit=limit, offset=offset)
    return BugReportList(items=items, total=total)


@router.get("/bug_reports/mine", response_model=BugReportList)
async def list_my_bug_reports(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BugReportService(db)
    items, total = await svc.list(reporter_id=current_user.id, limit=limit, offset=offset)
    return BugReportList(items=items, total=total)


@router.get("/bug_reports/{report_id}", response_model=BugReportDetail)
async def get_bug_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BugReportService(db)
    report, comments = await svc.get_with_comments(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Bug report not found")
    is_admin = current_user.role in (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)
    if not is_admin and report.reporter_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return BugReportDetail(**{**report.__dict__, "comments": comments})


@router.patch("/bug_reports/{report_id}", response_model=BugReportOut)
async def update_bug_report(
    report_id: uuid.UUID,
    data: BugReportUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)),
):
    svc = BugReportService(db)
    report = await svc.update(report_id, **data.model_dump(exclude_unset=True))
    if not report:
        raise HTTPException(status_code=404, detail="Bug report not found")
    await AuditService.log(
        db,
        actor=current_user,
        action="bug_report.status_changed",
        target_type="bug_report",
        target_id=str(report.id),
        request=request,
        status_code=200,
        detail={"display_id": report.display_id, "new_status": report.status},
    )
    await db.commit()
    await db.refresh(report)
    return report


@router.post("/bug_reports/{report_id}/comments", response_model=BugCommentOut, status_code=201)
async def add_bug_comment(
    report_id: uuid.UUID,
    data: BugCommentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BugReportService(db)
    comment = await svc.add_comment(report_id, current_user.id, data.body)
    if not comment:
        raise HTTPException(status_code=404, detail="Bug report not found")
    await AuditService.log(
        db,
        actor=current_user,
        action="bug_comment.created",
        target_type="bug_report",
        target_id=str(report_id),
        request=request,
        status_code=201,
    )
    await db.commit()
    await db.refresh(comment)
    return comment


@router.post("/bug_reports/cluster")
async def cluster_bug_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)),
):
    svc = BugReportService(db)
    items, _ = await svc.list(status="new", limit=50)
    merged: list[dict] = []
    for item in items:
        similar = await svc.cluster_similar(item.id)
        if similar:
            merged.append({"report_id": str(item.id), "similar_ids": [str(s) for s in similar]})
    return {"clusters": merged}
