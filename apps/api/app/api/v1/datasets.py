import hashlib
import io
import mimetypes
import os
import uuid
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
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
        # 上传未完成 — 清理占位 DatasetItem
        svc = DatasetService(db)
        await svc.delete_item(item_id)
        await db.commit()
        raise HTTPException(status_code=400, detail="File not found in storage")

    content_length = meta.get("ContentLength")
    if content_length:
        item.file_size = content_length

    # ETag（MinIO 单 PUT = md5）用于去重
    etag = (meta.get("ETag") or "").strip('"')
    if len(etag) == 32:
        svc = DatasetService(db)
        existing = await svc.find_by_hash(dataset_id, etag)
        if existing and existing.id != item_id:
            # 删除刚上传的对象与占位记录，返回 409 告知前端
            try:
                storage_service.delete_object(item.file_path, bucket=storage_service.datasets_bucket)
            except Exception:
                pass
            await svc.delete_item(item_id)
            await db.commit()
            raise HTTPException(
                status_code=409,
                detail={"msg": "文件已存在（内容重复）", "duplicate_of": str(existing.id)},
            )
        item.content_hash = etag

    await db.commit()
    return {"status": "ok", "item_id": str(item_id)}


_ZIP_MAX_BYTES = 200 * 1024 * 1024  # 200 MB
_ZIP_MAX_ENTRIES = 5000              # 防 zip bomb：限制条目数
_PER_FILE_MAX_BYTES = 100 * 1024 * 1024  # 单文件 100MB 上限


@router.post("/{dataset_id}/items/upload-zip")
async def upload_zip(
    dataset_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """前端 multipart 上传单个 ZIP 包，由后端解压并把每个文件入库 + 上传到 MinIO。

    限制：≤ 200MB 整包、≤ 5000 文件、单文件 ≤ 100MB；自动跳过 macOS 元数据（__MACOSX/）
    与隐藏文件（.DS_Store 等）；同名文件以路径 hash 后缀去重。
    """
    svc = DatasetService(db)
    ds = await svc.get(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    raw = await file.read()
    if len(raw) > _ZIP_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"ZIP 包超过 {_ZIP_MAX_BYTES // 1024 // 1024}MB 限制")

    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="不是有效的 ZIP 文件")

    infos = [i for i in zf.infolist() if not i.is_dir()]
    if len(infos) > _ZIP_MAX_ENTRIES:
        raise HTTPException(
            status_code=413, detail=f"ZIP 包文件数超过 {_ZIP_MAX_ENTRIES} 限制"
        )

    added = 0
    deduped = 0
    skipped: list[str] = []
    errors: list[dict] = []

    from sqlalchemy import select as sa_select
    from app.db.models.dataset import DatasetItem

    existing_names: set[str] = set()
    rows = await db.execute(
        sa_select(DatasetItem.file_name).where(DatasetItem.dataset_id == dataset_id)
    )
    for (n,) in rows.all():
        if n:
            existing_names.add(n)

    # 收集已有 hash，用于内容去重
    hash_rows = await db.execute(
        sa_select(DatasetItem.content_hash)
        .where(DatasetItem.dataset_id == dataset_id, DatasetItem.content_hash.isnot(None))
    )
    existing_hashes: set[str] = {r[0] for r in hash_rows.all()}

    for info in infos:
        name = info.filename
        base = os.path.basename(name)
        # macOS 元 + 隐藏文件
        if name.startswith("__MACOSX/") or base.startswith(".") or not base:
            skipped.append(name)
            continue
        if info.file_size > _PER_FILE_MAX_BYTES:
            errors.append({"name": name, "error": f"超过单文件 {_PER_FILE_MAX_BYTES // 1024 // 1024}MB 上限"})
            continue

        try:
            data = zf.read(info)
        except Exception as e:  # noqa: BLE001
            errors.append({"name": name, "error": f"解压失败: {e}"})
            continue

        content_hash = hashlib.md5(data).hexdigest()
        if content_hash in existing_hashes:
            deduped += 1
            continue
        existing_hashes.add(content_hash)

        # 名称冲突：同名追加 -1 / -2 后缀（保留扩展名）
        final_name = base
        if final_name in existing_names:
            stem, ext = os.path.splitext(base)
            i = 1
            while f"{stem}-{i}{ext}" in existing_names:
                i += 1
            final_name = f"{stem}-{i}{ext}"
        existing_names.add(final_name)

        content_type = mimetypes.guess_type(final_name)[0] or "application/octet-stream"
        file_type = _infer_file_type(content_type)
        storage_key = f"{ds.name}/{final_name}"

        try:
            storage_service.client.put_object(
                Bucket=storage_service.datasets_bucket,
                Key=storage_key,
                Body=data,
                ContentType=content_type,
            )
        except Exception as e:  # noqa: BLE001
            errors.append({"name": name, "error": f"对象存储写入失败: {e}"})
            continue

        item = await svc.add_item(
            dataset_id=dataset_id,
            file_name=final_name,
            file_path=storage_key,
            file_type=file_type,
            file_size=len(data),
            content_hash=content_hash,
        )
        added += 1
        _ = item  # 显式忽略

    await db.commit()
    return {
        "added": added,
        "deduped": deduped,
        "skipped": len(skipped),
        "errors": errors,
        "total_in_zip": len(infos),
    }


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
