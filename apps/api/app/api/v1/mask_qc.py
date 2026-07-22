"""Mask quality scan, issue, and task-summary APIs."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks._shared import _REVIEWERS, _assert_task_visible, _visible_task_ids
from app.db.models.annotation import Annotation
from app.db.models.async_job import AsyncJob
from app.db.models.mask_qc import MaskQCIssue, MaskQCRun
from app.db.models.mask_repair_batch import MaskRepairBatch
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.deps import get_db, require_project_visible, require_roles, require_scopes
from app.schemas.mask_qc import (
    MASK_QC_RULE_CODES,
    MaskCompareBaseline,
    MaskCompareOut,
    MaskQCIssueOut,
    MaskQCIssuePage,
    MaskQCIssuePatch,
    MaskQCRunOut,
    MaskQCRunRequest,
    TaskMaskQCSummary,
)
from app.schemas.mask_repair import (
    MaskRepairBatchOut,
    MaskRepairDryRunRequest,
    MaskRepairDryRunResponse,
    MaskRepairExecuteRequest,
    MaskRepairRollbackRequest,
)
from app.schemas._jsonb_types import CocoRleContent
from app.services.mask_qc.compare import (
    build_mask_compare,
    resolve_annotation_side,
)
from app.services.mask_qc.service import (
    MaskQCError,
    create_mask_qc_run,
    dispatch_mask_qc_run,
    effective_issue_status,
    effective_issue_statuses,
    list_issues,
    task_qc_summary,
)
from app.services import async_job as async_job_svc
from app.services.audit import AuditAction, AuditService
from app.services.mask_repair import (
    MaskRepairError,
    batch_out,
    create_repair_plan,
    dispatch_repair_batch,
    execute_repair_plan,
    request_repair_rollback,
    resume_repair_batch,
)
from app.services.scheduler import is_privileged_for_project

router = APIRouter()


def _raise_mask_repair_error(exc: MaskRepairError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


async def _load_visible_compare_annotation(
    db: AsyncSession, *, annotation_id: uuid.UUID, user: User
) -> tuple[Annotation, Task]:
    from app.api.v1.annotations import _load_visible_mask_annotation

    annotation, task, _geometry = await _load_visible_mask_annotation(
        annotation_id, db, user
    )
    return annotation, task


def _raise_mask_qc_error(exc: MaskQCError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _run_out(run: MaskQCRun, *, reused: bool) -> MaskQCRunOut:
    source_versions = {
        str(item["annotation_id"]): int(item["version"])
        for item in run.source_snapshot or []
    }
    return MaskQCRunOut(
        id=run.id,
        project_id=run.project_id,
        async_job_id=run.async_job_id,
        status=run.status,
        progress_pct=run.progress_pct,
        config_revision=run.config_revision,
        config_digest=run.config_digest,
        source_snapshot_digest=run.source_snapshot_digest,
        source_versions=source_versions,
        summary=run.summary or {},
        created_at=run.created_at,
        completed_at=run.completed_at,
        reused=reused,
    )


async def _issue_out(
    db: AsyncSession,
    issue: MaskQCIssue,
    *,
    effective_status: str | None = None,
) -> MaskQCIssueOut:
    payload = {
        column.name: getattr(issue, column.name)
        for column in MaskQCIssue.__table__.columns
        if column.name not in {"severity_rank", "dedupe_key"}
    }
    payload["effective_status"] = (
        effective_status
        if effective_status is not None
        else await effective_issue_status(db, issue)
    )
    return MaskQCIssueOut.model_validate(payload)


async def _assert_run_scope_visible(
    db: AsyncSession,
    *,
    project: Project,
    user: User,
    request: MaskQCRunRequest,
) -> None:
    if request.scope == "project":
        if not is_privileged_for_project(user, project):
            raise HTTPException(
                status_code=403,
                detail="project-wide Mask QC requires project owner",
            )
        return

    if request.scope == "task_ids":
        task_ids = set(request.task_ids)
    else:
        rows = (
            await db.execute(
                select(Annotation.id, Annotation.task_id).where(
                    Annotation.project_id == project.id,
                    Annotation.id.in_(request.annotation_ids),
                )
            )
        ).all()
        if {row.id for row in rows} != set(request.annotation_ids):
            raise HTTPException(status_code=404, detail="Mask annotation not found")
        task_ids = {row.task_id for row in rows}

    rows = list(
        (
            await db.execute(
                select(Task).where(
                    Task.project_id == project.id,
                    Task.id.in_(task_ids),
                )
            )
        ).scalars()
    )
    if {task.id for task in rows} != task_ids:
        raise HTTPException(status_code=404, detail="Task not found")
    for task in rows:
        await _assert_task_visible(db, task, user)


@router.post(
    "/projects/{project_id}/mask-qc/runs",
    response_model=MaskQCRunOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_run(
    body: MaskQCRunRequest,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> MaskQCRunOut:
    await _assert_run_scope_visible(
        db, project=project, user=current_user, request=body
    )
    try:
        run, job, created = await create_mask_qc_run(
            db,
            project=project,
            actor_id=current_user.id,
            request=body,
        )
    except MaskQCError as exc:
        _raise_mask_qc_error(exc)
    await db.commit()
    if created and job is not None:
        try:
            await dispatch_mask_qc_run(db, run_id=run.id, async_job_id=job.id)
        except MaskQCError as exc:
            _raise_mask_qc_error(exc)
    await db.refresh(run)
    return _run_out(run, reused=not created)


@router.get(
    "/projects/{project_id}/mask-qc/issues",
    response_model=MaskQCIssuePage,
)
async def get_project_issues(
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
    issue_status: Literal["open", "resolved", "wont_fix", "stale"] | None = Query(
        default=None, alias="status"
    ),
    severity: Literal["blocker", "warning", "info"] | None = None,
    code: str | None = None,
    task_id: uuid.UUID | None = None,
    annotation_id: uuid.UUID | None = None,
    frame: int | None = Query(default=None, ge=0),
) -> MaskQCIssuePage:
    if code is not None and code not in MASK_QC_RULE_CODES:
        raise HTTPException(status_code=422, detail="unknown Mask QC rule code")

    allowed_task_ids: set[uuid.UUID] | None = None
    if task_id is not None:
        task = await db.get(Task, task_id)
        if task is None or task.project_id != project.id:
            raise HTTPException(status_code=404, detail="Task not found")
        await _assert_task_visible(db, task, current_user)
    elif not is_privileged_for_project(current_user, project):
        all_task_ids = list(
            (
                await db.execute(select(Task.id).where(Task.project_id == project.id))
            ).scalars()
        )
        allowed_task_ids = await _visible_task_ids(
            db, project, current_user, all_task_ids
        )

    try:
        rows, next_cursor = await list_issues(
            db,
            project_id=project.id,
            limit=limit,
            cursor=cursor,
            status=issue_status,
            severity=severity,
            code=code,
            task_id=task_id,
            annotation_id=annotation_id,
            frame=frame,
            allowed_task_ids=allowed_task_ids,
        )
    except MaskQCError as exc:
        _raise_mask_qc_error(exc)
    effective_status_by_id = await effective_issue_statuses(db, rows)
    return MaskQCIssuePage(
        items=[
            await _issue_out(
                db,
                issue,
                effective_status=effective_status_by_id[issue.id],
            )
            for issue in rows
        ],
        next_cursor=next_cursor,
    )


@router.get(
    "/tasks/{task_id}/mask-qc/summary",
    response_model=TaskMaskQCSummary,
)
async def get_task_summary(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> TaskMaskQCSummary:
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    await _assert_task_visible(db, task, current_user)
    project = await db.get(Project, task.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return TaskMaskQCSummary.model_validate(
        await task_qc_summary(db, task=task, project=project)
    )


@router.get(
    "/annotations/{annotation_id}/mask-compare",
    response_model=MaskCompareOut,
    dependencies=[Depends(require_scopes("annotations:read"))],
)
async def get_mask_compare(
    annotation_id: uuid.UUID,
    baseline: MaskCompareBaseline,
    annotation_version: int = Query(ge=1),
    frame_index: int | None = Query(default=None, ge=0),
    candidate_job_id: uuid.UUID | None = None,
    candidate_job_revision: int | None = Query(default=None, ge=1),
    candidate_digest: str | None = None,
    candidate_instance_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> MaskCompareOut:
    annotation, _task = await _load_visible_compare_annotation(
        db, annotation_id=annotation_id, user=current_user
    )
    try:
        return await build_mask_compare(
            db,
            annotation=annotation,
            annotation_version=annotation_version,
            baseline_kind=baseline,
            frame_index=frame_index,
            candidate_job_id=candidate_job_id,
            candidate_job_revision=candidate_job_revision,
            candidate_digest=candidate_digest,
            candidate_instance_id=candidate_instance_id,
        )
    except MaskQCError as exc:
        _raise_mask_qc_error(exc)


@router.get(
    "/annotations/{annotation_id}/mask-compare/content",
    response_model=CocoRleContent,
    dependencies=[Depends(require_scopes("annotations:read"))],
)
async def get_mask_compare_content(
    annotation_id: uuid.UUID,
    request: Request,
    annotation_version: int = Query(ge=1),
    digest: str = Query(pattern=r"^[0-9a-f]{64}$"),
    frame_index: int | None = Query(default=None, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> Response:
    annotation, _task = await _load_visible_compare_annotation(
        db, annotation_id=annotation_id, user=current_user
    )
    try:
        side = await resolve_annotation_side(
            db,
            annotation=annotation,
            annotation_version=annotation_version,
            frame_index=frame_index,
            missing_reason="baseline_expired",
        )
    except MaskQCError as exc:
        _raise_mask_qc_error(exc)
    if side.reference.get("sha256") != digest:
        raise HTTPException(
            status_code=409,
            detail={"reason": "mask_compare_content_digest_conflict"},
        )
    from app.api.v1.annotations import _mask_content_response

    return await _mask_content_response(
        annotation_id=annotation.id,
        mask_ref=side.reference,
        request=request,
    )


@router.get(
    "/mask-qc/issues/{issue_id}/region-content",
    response_model=CocoRleContent,
    dependencies=[Depends(require_scopes("annotations:read"))],
)
async def get_issue_region_content(
    issue_id: uuid.UUID,
    request: Request,
    digest: str = Query(pattern=r"^[0-9a-f]{64}$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> Response:
    issue = await db.get(MaskQCIssue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Mask QC issue not found")
    annotation, task = await _load_visible_compare_annotation(
        db, annotation_id=issue.annotation_id, user=current_user
    )
    if task.id != issue.task_id or annotation.project_id != issue.project_id:
        raise HTTPException(status_code=409, detail={"reason": "mask_qc_issue_scope_conflict"})
    reference = issue.region_mask_ref
    if not isinstance(reference, dict):
        raise HTTPException(
            status_code=404,
            detail={"reason": "mask_qc_issue_region_unavailable"},
        )
    if reference.get("sha256") != digest or issue.region_digest != digest:
        raise HTTPException(
            status_code=409,
            detail={"reason": "mask_qc_issue_region_digest_conflict"},
        )
    from app.api.v1.annotations import _mask_content_response

    return await _mask_content_response(
        annotation_id=annotation.id,
        mask_ref=reference,
        request=request,
    )


@router.get("/mask-qc/issues/{issue_id}", response_model=MaskQCIssueOut)
async def get_issue(
    issue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> MaskQCIssueOut:
    issue = await db.get(MaskQCIssue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Mask QC issue not found")
    task = await db.get(Task, issue.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    await _assert_task_visible(db, task, current_user)
    return await _issue_out(db, issue)


@router.patch("/mask-qc/issues/{issue_id}", response_model=MaskQCIssueOut)
async def patch_issue(
    issue_id: uuid.UUID,
    body: MaskQCIssuePatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> MaskQCIssueOut:
    issue = (
        await db.execute(
            select(MaskQCIssue).where(MaskQCIssue.id == issue_id).with_for_update()
        )
    ).scalar_one_or_none()
    if issue is None:
        raise HTTPException(status_code=404, detail="Mask QC issue not found")
    task = await db.get(Task, issue.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    await _assert_task_visible(db, task, current_user)
    if await effective_issue_status(db, issue) == "stale":
        raise HTTPException(
            status_code=409,
            detail={"reason": "mask_qc_issue_stale"},
        )
    issue.status = body.status
    if body.status == "open":
        issue.resolved_by_id = None
        issue.resolved_at = None
    else:
        issue.resolved_by_id = current_user.id
        issue.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(issue)
    return await _issue_out(db, issue)


async def _assert_repair_issues_visible(
    db: AsyncSession,
    *,
    project: Project,
    user: User,
    issue_ids: list[uuid.UUID],
) -> None:
    rows = list(
        (
            await db.execute(
                select(MaskQCIssue).where(
                    MaskQCIssue.project_id == project.id,
                    MaskQCIssue.id.in_(issue_ids),
                )
            )
        ).scalars()
    )
    task_ids = sorted({row.task_id for row in rows}, key=str)
    tasks = list(
        (await db.execute(select(Task).where(Task.id.in_(task_ids)))).scalars()
    )
    for task in tasks:
        await _assert_task_visible(db, task, user)


async def _load_visible_repair_batch(
    db: AsyncSession,
    *,
    repair_id: uuid.UUID,
    user: User,
) -> MaskRepairBatch:
    batch = await db.get(MaskRepairBatch, repair_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Mask repair batch not found")
    task_ids = {
        uuid.UUID(str(item["task_id"]))
        for item in (batch.plan_json or {}).get("items") or []
        if item.get("task_id")
    }
    tasks = list(
        (await db.execute(select(Task).where(Task.id.in_(task_ids)))).scalars()
    )
    if len(tasks) != len(task_ids):
        raise HTTPException(status_code=404, detail="Mask repair task not found")
    for task in tasks:
        await _assert_task_visible(db, task, user)
    return batch


async def _dispatch_repair_or_fail(
    db: AsyncSession,
    *,
    batch: MaskRepairBatch,
    rollback: bool,
) -> None:
    job_id = batch.rollback_async_job_id if rollback else batch.async_job_id
    assert job_id is not None
    try:
        celery_task_id = await dispatch_repair_batch(batch.id, rollback=rollback)
    except MaskRepairError as exc:
        await db.rollback()
        locked = (
            await db.execute(
                select(MaskRepairBatch)
                .where(MaskRepairBatch.id == batch.id)
                .with_for_update()
            )
        ).scalar_one()
        locked.status = "rollback_failed" if rollback else "failed"
        await async_job_svc.mark_failed(db, job_id, error=str(exc))
        await db.commit()
        _raise_mask_repair_error(exc)
    job = await db.get(AsyncJob, job_id)
    if job is not None:
        job.celery_task_id = celery_task_id
    await db.commit()


@router.post(
    "/projects/{project_id}/mask-qc/repairs:dry-run",
    response_model=MaskRepairDryRunResponse,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def dry_run_mask_repairs(
    body: MaskRepairDryRunRequest,
    request: Request,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> MaskRepairDryRunResponse:
    await _assert_repair_issues_visible(
        db,
        project=project,
        user=current_user,
        issue_ids=[action.issue_id for action in body.actions],
    )
    response = await create_repair_plan(
        db,
        project=project,
        actor=current_user,
        request=body,
    )
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.MASK_REPAIR_DRY_RUN,
        target_type="project",
        target_id=project.id,
        request=request,
        status_code=200,
        detail={
            "plan_digest": response.plan_digest,
            "summary": response.summary.model_dump(mode="json"),
        },
    )
    await db.commit()
    return response


@router.post(
    "/projects/{project_id}/mask-qc/repairs",
    response_model=MaskRepairBatchOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def execute_mask_repairs(
    body: MaskRepairExecuteRequest,
    request: Request,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> MaskRepairBatchOut:
    try:
        batch, should_dispatch = await execute_repair_plan(
            db,
            project=project,
            actor=current_user,
            receipt=body.receipt,
            plan_digest=body.plan_digest,
        )
    except MaskRepairError as exc:
        await db.rollback()
        _raise_mask_repair_error(exc)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.MASK_REPAIR_EXECUTE,
        target_type="mask_repair_batch",
        target_id=batch.id,
        request=request,
        status_code=202,
        detail={"plan_digest": batch.plan_digest},
    )
    await db.commit()
    if should_dispatch:
        await _dispatch_repair_or_fail(db, batch=batch, rollback=False)
    await db.refresh(batch)
    return batch_out(batch)


@router.get(
    "/mask-qc/repairs/{repair_id}",
    response_model=MaskRepairBatchOut,
)
async def get_mask_repair_batch(
    repair_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> MaskRepairBatchOut:
    batch = await _load_visible_repair_batch(
        db, repair_id=repair_id, user=current_user
    )
    return batch_out(batch)


@router.post(
    "/mask-qc/repairs/{repair_id}/resume",
    response_model=MaskRepairBatchOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def resume_mask_repairs(
    repair_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> MaskRepairBatchOut:
    await _load_visible_repair_batch(db, repair_id=repair_id, user=current_user)
    try:
        batch = await resume_repair_batch(
            db, batch_id=repair_id, actor=current_user
        )
    except MaskRepairError as exc:
        await db.rollback()
        _raise_mask_repair_error(exc)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.MASK_REPAIR_RESUME,
        target_type="mask_repair_batch",
        target_id=batch.id,
        request=request,
        status_code=202,
    )
    await db.commit()
    await _dispatch_repair_or_fail(db, batch=batch, rollback=False)
    await db.refresh(batch)
    return batch_out(batch)


@router.post(
    "/mask-qc/repairs/{repair_id}/rollback",
    response_model=MaskRepairBatchOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def rollback_mask_repairs(
    repair_id: uuid.UUID,
    body: MaskRepairRollbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
) -> MaskRepairBatchOut:
    await _load_visible_repair_batch(db, repair_id=repair_id, user=current_user)
    try:
        batch = await request_repair_rollback(
            db,
            batch_id=repair_id,
            actor=current_user,
            expected_result_digest=body.expected_result_digest,
        )
    except MaskRepairError as exc:
        await db.rollback()
        _raise_mask_repair_error(exc)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.MASK_REPAIR_ROLLBACK,
        target_type="mask_repair_batch",
        target_id=batch.id,
        request=request,
        status_code=202,
    )
    await db.commit()
    await _dispatch_repair_or_fail(db, batch=batch, rollback=True)
    await db.refresh(batch)
    return batch_out(batch)
