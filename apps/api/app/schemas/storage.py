from pydantic import BaseModel


class BucketSummary(BaseModel):
    name: str
    status: str  # ok | error
    object_count: int = 0
    total_size_bytes: int = 0
    error: str | None = None
    # v0.10.17 · annotations | datasets | bug-reports | media-cache | audit-archive
    role: str


class BucketsResponse(BaseModel):
    items: list[BucketSummary]
    total_object_count: int
    total_size_bytes: int
