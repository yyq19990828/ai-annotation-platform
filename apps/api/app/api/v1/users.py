from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.deps import get_db, require_roles
from app.db.models.user import User
from app.db.enums import UserRole
from app.schemas.user import UserOut

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)


@router.get("", response_model=list[UserOut])
async def list_users(
    role: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_MANAGERS)),
):
    q = select(User).where(User.is_active.is_(True))
    if role:
        q = q.where(User.role == role)
    result = await db.execute(q.order_by(User.created_at.desc()))
    return result.scalars().all()


@router.post("/invite")
async def invite_user(
    data: dict,
    _: User = Depends(require_roles(*_MANAGERS)),
):
    return {"status": "invited"}
