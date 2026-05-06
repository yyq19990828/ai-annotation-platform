from pydantic import BaseModel, Field, field_validator
from app.core.password import validate_password_strength


class ProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PasswordChange(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        errors = validate_password_strength(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v


class SmtpStatus(BaseModel):
    host: str | None
    port: int | None
    user: str | None
    from_address: str | None
    password_set: bool = False
    configured: bool


class SystemSettingsOut(BaseModel):
    environment: str
    invitation_ttl_days: int
    frontend_base_url: str
    smtp: SmtpStatus
    allow_open_registration: bool


class SystemSettingsUpdate(BaseModel):
    """v0.8.1 · admin UI PATCH 入参，全部 Optional：未提供字段不变更。
    smtp_password 传空串视为清除；未提供则不动现有值。
    """

    allow_open_registration: bool | None = None
    invitation_ttl_days: int | None = Field(default=None, ge=1, le=90)
    frontend_base_url: str | None = Field(default=None, max_length=255)
    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int | None = Field(default=None, ge=1, le=65535)
    smtp_user: str | None = Field(default=None, max_length=255)
    smtp_password: str | None = Field(default=None, max_length=255)
    smtp_from: str | None = Field(default=None, max_length=255)
