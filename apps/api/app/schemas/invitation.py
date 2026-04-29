from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.user import UserOut


def _normalize_email(v: str) -> str:
    v = (v or "").strip().lower()
    if "@" not in v or len(v) < 3 or len(v) > 255:
        raise ValueError("邮箱格式不正确")
    return v


class InvitationCreate(BaseModel):
    email: str
    role: str
    group_name: str | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _normalize_email(v)


class InvitationCreated(BaseModel):
    invite_url: str
    token: str
    expires_at: datetime


class InvitationResolve(BaseModel):
    email: str
    role: str
    group_name: str | None
    expires_at: datetime
    invited_by_name: str | None = None


class RegisterRequest(BaseModel):
    token: str
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=6, max_length=128)


class RegisterResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
