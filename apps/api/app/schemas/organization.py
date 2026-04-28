from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class OrgCreate(BaseModel):
    name: str
    slug: str
    contact_info: dict = {}


class OrgOut(BaseModel):
    id: UUID
    name: str
    slug: str
    contact_info: dict
    created_by: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class OrgMemberOut(BaseModel):
    id: UUID
    organization_id: UUID
    user_id: UUID
    role: str
    joined_at: datetime

    class Config:
        from_attributes = True
