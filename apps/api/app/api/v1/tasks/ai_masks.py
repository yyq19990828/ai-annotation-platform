import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks._shared import (
    _ANNOTATORS,
    _assert_task_editable,
    _assert_task_visible,
    _load_task_or_404,
)
from app.db.models.user import User
from app.deps import get_db, require_roles, require_scopes
from app.schemas.ai_mask import AiMaskAcceptRequest, AiMaskAcceptResponse
from app.services.ai_mask_accept import AiMaskAcceptError, accept_ai_mask_candidate
from app.services.raster_mask_storage import RasterMaskContractError

router = APIRouter()


def _parse_if_match(request: Request) -> int | None:
    raw = request.headers.get("If-Match", "").strip()
    if not raw:
        return None
    normalized = raw.removeprefix("W/").strip().removeprefix('"').removesuffix('"')
    try:
        version = int(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"reason": "invalid_if_match", "message": "Invalid If-Match format"},
        ) from exc
    if version < 1:
        raise HTTPException(
            status_code=400,
            detail={"reason": "invalid_if_match", "message": "Invalid If-Match format"},
        )
    return version


@router.post(
    "/{task_id}/ai-mask-candidates/accept",
    response_model=AiMaskAcceptResponse,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def accept_native_ai_mask_candidate(
    task_id: uuid.UUID,
    data: AiMaskAcceptRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """Atomically accept one transient native Mask candidate.

    The immutable content object is written before the final database commit. The
    Prediction, lineage, decision, Annotation mutation, and audit event share that
    single commit; a failed transaction leaves only a grace-period GC orphan.
    """

    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    _assert_task_editable(task, current_user)
    expected_version = _parse_if_match(request)
    try:
        result = await accept_ai_mask_candidate(
            db,
            task_id=task_id,
            data=data,
            current_user=current_user,
            request=request,
            expected_version=expected_version,
        )
    except (AiMaskAcceptError, RasterMaskContractError) as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    await db.commit()
    response.headers["ETag"] = f'W/"{result.result_version}"'
    return result
