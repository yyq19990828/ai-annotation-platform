from fastapi import APIRouter, Depends
from app.deps import require_roles
from app.db.models.user import User

router = APIRouter()

_MANAGERS = ("超级管理员", "项目管理员")


@router.get("")
async def list_users(
    role: str | None = None,
    _: User = Depends(require_roles(*_MANAGERS)),
):
    return []


@router.post("/invite")
async def invite_user(
    data: dict,
    _: User = Depends(require_roles(*_MANAGERS)),
):
    return {"status": "invited"}
