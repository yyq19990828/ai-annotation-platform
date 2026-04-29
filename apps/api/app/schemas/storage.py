from pydantic import BaseModel


class BucketSummary(BaseModel):
    name: str
    status: str  # ok | error
    object_count: int = 0
    total_size_bytes: int = 0
    error: str | None = None
    role: str  # annotations | datasets — 业务上的角色, 便于前端区分


class BucketsResponse(BaseModel):
    items: list[BucketSummary]
    total_object_count: int
    total_size_bytes: int
