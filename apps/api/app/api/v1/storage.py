from fastapi import APIRouter, Depends, HTTPException
from app.deps import get_current_user
from app.db.models.user import User
from app.services.storage import storage_service

router = APIRouter()


@router.get("/health")
async def storage_health(_: User = Depends(get_current_user)):
    try:
        storage_service.client.head_bucket(Bucket=storage_service.bucket)
        return {"status": "ok", "bucket": storage_service.bucket}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
