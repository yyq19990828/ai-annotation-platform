from pydantic import BaseModel, Field


class ProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PasswordChange(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


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
