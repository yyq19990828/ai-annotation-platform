from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, field_validator

from app.schemas._jsonb_types import AuditDetail


class AuditLogOut(BaseModel):
    id: int
    actor_id: UUID | None
    actor_email: str | None
    actor_role: str | None
    action: str
    target_type: str | None
    target_id: str | None
    method: str | None
    path: str | None
    status_code: int | None
    ip: str | None
    detail_json: AuditDetail | None
    created_at: datetime

    @field_validator("ip", mode="before")
    @classmethod
    def _ip_to_str(cls, v):  # PostgreSQL INET → ipaddress.IPv4Address/IPv6Address
        return str(v) if v is not None else None

    class Config:
        from_attributes = True


class AuditLogList(BaseModel):
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int
    next_cursor: str | None = None
