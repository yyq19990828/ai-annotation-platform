from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    scopes: list[str] = Field(default_factory=list)


class ApiKeyOut(BaseModel):
    """列表 / 详情用。永远不含 plaintext / hash。"""

    id: UUID
    name: str
    key_prefix: str
    scopes: list[str]
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class ApiKeyCreated(ApiKeyOut):
    """创建响应：附带一次性 plaintext token。关闭弹窗后无法再次查看。"""

    plaintext: str
