import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user, require_roles
from app.db.enums import UserRole
from app.db.models.user import User
from app.schemas.dataset import (
    DatasetCreate,
    DatasetUpdate,
    DatasetOut,
    DatasetItemOut,
    DatasetListResponse,
    DatasetItemListResponse,
    DatasetLinkRequest,
    DatasetUploadInitRequest,
    DatasetUploadInitResponse,
)
from app.schemas.project import ProjectOut
from app.services.dataset import DatasetService
from app.services.storage import storage_service

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)


@router.get("", response_model=DatasetListResponse)
async def list_datasets(
    search: str | None = None,
    data_type: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    svc = DatasetService(db)
    items, total = await svc.list(search=search, data_type=data_type, limit=limit, offset=offset)
    return DatasetListResponse(items=items, total=total, limit=limit, offset=offset)


@router.post("", response_model=DatasetOut, status_code=201)
async def create_dataset(
    data: DatasetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = DatasetService(db)
    ds = await svc.create(
        name=data.name,
        description=data.description,
        data_type=data.data_type,
        user_id=current_user.id,
    )
    await db.commit()
    await db.refresh(ds)
    result = await svc.get_with_project_count(ds.id)
    return result


@router.get("/{dataset_id}", response_model=DatasetOut)
async def get_dataset(
    dataset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    svc = DatasetService(db)
    result = await svc.get_with_project_count(dataset_id)
    if not result:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return result


@router.put("/{dataset_id}", response_model=DatasetOut)
async def update_dataset(
    dataset_id: uuid.UUID,
    data: DatasetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = DatasetService(db)
    ds = await svc.update(dataset_id, name=data.name, description=data.description)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    await db.commit()
    result = await svc.get_with_project_count(dataset_id)
    return result


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset(
    dataset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = DatasetService(db)
    ok = await svc.delete(dataset_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Dataset not found")
    await db.commit()


# ── Items ───────────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/items", response_model=DatasetItemListResponse)
async def list_dataset_items(
    dataset_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    svc = DatasetService(db)
    ds = await svc.get(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    items, total = await svc.list_items(dataset_id, limit=limit, offset=offset)
    return DatasetItemListResponse(items=items, total=total, limit=limit, offset=offset)


@router.post("/{dataset_id}/items/upload-init", response_model=DatasetUploadInitResponse)
async def upload_init(
    dataset_id: uuid.UUID,
    data: DatasetUploadInitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = DatasetService(db)
    ds = await svc.get(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    item_id = uuid.uuid4()
    storage_key = f"{ds.name}/{data.file_name}"
    file_type = _infer_file_type(data.content_type)

    item = await svc.add_item(
        dataset_id=dataset_id,
        file_name=data.file_name,
        file_path=storage_key,
        file_type=file_type,
    )
    await db.commit()

    upload_url = storage_service.generate_upload_url(
        storage_key, data.content_type, bucket=storage_service.datasets_bucket,
    )
    return DatasetUploadInitResponse(item_id=item.id, upload_url=upload_url, expires_in=900)


@router.post("/{dataset_id}/items/upload-complete/{item_id}")
async def upload_complete(
    dataset_id: uuid.UUID,
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.db.models.dataset import DatasetItem
    item = await db.get(DatasetItem, item_id)
    if not item or item.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="Item not found")

    meta = storage_service.verify_upload(item.file_path, bucket=storage_service.datasets_bucket)
    if not meta:
        raise HTTPException(status_code=400, detail="File not found in storage")

    content_length = meta.get("ContentLength")
    if content_length:
        item.file_size = content_length

    await db.commit()
    return {"status": "ok", "item_id": str(item_id)}


@router.post("/{dataset_id}/items/scan")
async def scan_items(
    dataset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = DatasetService(db)
    ds = await svc.get(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    created = await svc.scan_and_import(dataset_id)
    await db.commit()
    return {"status": "ok", "new_items": created}


@router.delete("/{dataset_id}/items/{item_id}", status_code=204)
async def delete_item(
    dataset_id: uuid.UUID,
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = DatasetService(db)
    ok = await svc.delete_item(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.commit()


# ── Project linking ─────────────────────────────────────────────────────────

@router.post("/{dataset_id}/link")
async def link_project(
    dataset_id: uuid.UUID,
    data: DatasetLinkRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = DatasetService(db)
    ds = await svc.get(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    link = await svc.link_project(dataset_id, data.project_id)
    await db.commit()
    return {"status": "linked", "dataset_id": str(dataset_id), "project_id": str(data.project_id)}


@router.delete("/{dataset_id}/link/{project_id}", status_code=204)
async def unlink_project(
    dataset_id: uuid.UUID,
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = DatasetService(db)
    ok = await svc.unlink_project(dataset_id, project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Link not found")
    await db.commit()


@router.get("/{dataset_id}/projects", response_model=list[ProjectOut])
async def get_linked_projects(
    dataset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    svc = DatasetService(db)
    return await svc.get_linked_projects(dataset_id)


def _infer_file_type(content_type: str) -> str:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    return "other"
