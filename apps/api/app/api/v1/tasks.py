from fastapi import APIRouter, Depends
from app.deps import get_current_user, require_roles
from app.db.models.user import User

router = APIRouter()

_ANNOTATORS = ("超级管理员", "项目管理员", "质检员", "标注员")
_REVIEWERS = ("超级管理员", "项目管理员", "质检员")


@router.get("/{task_id}")
async def get_task(task_id: str, _: User = Depends(get_current_user)):
    return {"id": task_id, "status": "pending"}


@router.get("/{task_id}/annotations")
async def get_annotations(task_id: str, _: User = Depends(get_current_user)):
    return []


@router.post("/{task_id}/annotations")
async def create_annotation(
    task_id: str,
    data: dict,
    _: User = Depends(require_roles(*_ANNOTATORS)),
):
    return {"id": "new-annotation", "task_id": task_id}


@router.post("/{task_id}/submit")
async def submit_task(
    task_id: str,
    _: User = Depends(require_roles(*_ANNOTATORS)),
):
    return {"status": "submitted", "task_id": task_id}
