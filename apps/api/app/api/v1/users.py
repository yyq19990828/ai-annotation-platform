from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_users(role: str | None = None):
    return []


@router.post("/invite")
async def invite_user(data: dict):
    return {"status": "invited"}
