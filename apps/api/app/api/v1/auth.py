from fastapi import APIRouter, Depends, HTTPException
from app.schemas.user import Token, LoginRequest, UserOut

router = APIRouter()


@router.post("/login", response_model=Token)
async def login(data: LoginRequest):
    # TODO: implement real auth
    return Token(access_token="dev-token-placeholder")


@router.get("/me", response_model=dict)
async def get_me():
    # TODO: implement JWT decode
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "name": "张明轩",
        "email": "zhang.mx@company.cn",
        "role": "项目管理员",
    }
