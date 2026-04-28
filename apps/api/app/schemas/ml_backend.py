from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class MLBackendCreate(BaseModel):
    name: str
    url: str
    is_interactive: bool = False
    auth_method: str = "none"
    auth_token: str | None = None
    extra_params: dict = {}


class MLBackendUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    is_interactive: bool | None = None
    auth_method: str | None = None
    auth_token: str | None = None
    extra_params: dict | None = None


class MLBackendOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    url: str
    state: str
    is_interactive: bool
    auth_method: str
    extra_params: dict
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MLBackendHealthResponse(BaseModel):
    status: str
    backend_id: UUID
    backend_name: str


class InteractiveRequest(BaseModel):
    task_id: UUID
    context: dict
