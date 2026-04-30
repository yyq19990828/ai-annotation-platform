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
    configured: bool


class SystemSettingsOut(BaseModel):
    environment: str
    invitation_ttl_days: int
    frontend_base_url: str
    smtp: SmtpStatus
