from fastapi import APIRouter, Depends, HTTPException
from app.deps import get_current_user
from app.db.models.user import User
from app.services.storage import storage_service
from app.schemas.storage import BucketSummary, BucketsResponse

router = APIRouter()


@router.get("/health")
async def storage_health(_: User = Depends(get_current_user)):
    try:
        storage_service.client.head_bucket(Bucket=storage_service.bucket)
        return {"status": "ok", "bucket": storage_service.bucket}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/buckets", response_model=BucketsResponse)
async def storage_buckets(_: User = Depends(get_current_user)):
    bucket_roles = {
        storage_service.bucket: "annotations",
        storage_service.datasets_bucket: "datasets",
    }
    items: list[BucketSummary] = []
    for b, role in bucket_roles.items():
        summary = storage_service.summarize_bucket(b)
        items.append(BucketSummary(role=role, **summary))

    return BucketsResponse(
        items=items,
        total_object_count=sum(i.object_count for i in items),
        total_size_bytes=sum(i.total_size_bytes for i in items),
    )
