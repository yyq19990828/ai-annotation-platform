from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    scopes: list[str] = Field(default_factory=list)
    # v0.15.11 · 有效期天数；None=永不过期。后端换算为绝对 expires_at（避免客户端时钟漂移）
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)


class ApiKeyUpdate(BaseModel):
    """PATCH 部分更新。仅提交的字段生效（靠 model_fields_set 判定）。

    expires_in_days 显式传 null = 改回永不过期；不传 = 不动有效期。
    """

    name: str | None = Field(default=None, min_length=1, max_length=60)
    scopes: list[str] | None = None
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)


class ApiKeyOut(BaseModel):
    """列表 / 详情用。永远不含 plaintext / hash。"""

    id: UUID
    name: str
    key_prefix: str
    scopes: list[str]
    expires_at: datetime | None
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class ApiKeyCreated(ApiKeyOut):
    """创建响应：附带一次性 plaintext token。关闭弹窗后无法再次查看。"""

    plaintext: str
