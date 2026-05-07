import re
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_db, require_roles
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.task import Task
from app.db.models.project import Project
from app.schemas.ml_backend import (
    MLBackendCreate,
    MLBackendUpdate,
    MLBackendOut,
    MLBackendHealthResponse,
    InteractiveRequest,
)
from app.services.ml_backend import MLBackendService
from app.services.ml_client import MLBackendClient
from app.services.storage import StorageService

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)


def _resolve_task_url(task: Task) -> str:
    """v0.9.4 · 把 task.file_path (MinIO 对象 key) 转成 ML backend 可访问的 presigned URL。

    SAM backend 协议要求 file_path 是 http(s):// URL 或本地路径; tasks 表里存的是 key,
    必须先签发 presigned URL。当平台 api 跑在 host 进程而 ML backend 在 docker 网内时,
    再把 host 替换为 ``settings.ml_backend_storage_host`` (容器可达地址)。
    """
    storage = StorageService()
    bucket = (
        storage.datasets_bucket if task.dataset_item_id else storage.bucket
    )
    url = storage.generate_download_url(task.file_path, bucket=bucket)
    if settings.ml_backend_storage_host:
        url = re.sub(r"://[^/]+", f"://{settings.ml_backend_storage_host}", url, count=1)
    return url


@router.post("", response_model=MLBackendOut, status_code=201)
async def create_ml_backend(
    project_id: uuid.UUID,
    data: MLBackendCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = MLBackendService(db)
    backend = await svc.create(
        project_id=project_id,
        name=data.name,
        url=data.url,
        is_interactive=data.is_interactive,
        auth_method=data.auth_method,
        auth_token=data.auth_token,
        extra_params=data.extra_params,
    )
    await db.commit()
    await db.refresh(backend)
    return backend


@router.get("", response_model=list[MLBackendOut])
async def list_ml_backends(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(*_MANAGERS, UserRole.REVIEWER, UserRole.ANNOTATOR)
    ),
):
    svc = MLBackendService(db)
    return await svc.list_by_project(project_id)


@router.get("/{backend_id}", response_model=MLBackendOut)
async def get_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(*_MANAGERS, UserRole.REVIEWER, UserRole.ANNOTATOR)
    ),
):
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend or backend.project_id != project_id:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    return backend


@router.put("/{backend_id}", response_model=MLBackendOut)
async def update_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    data: MLBackendUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = MLBackendService(db)
    updates = data.model_dump(exclude_unset=True)
    backend = await svc.update(backend_id, **updates)
    if not backend:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    await db.commit()
    await db.refresh(backend)
    return backend


@router.delete("/{backend_id}", status_code=204)
async def delete_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = MLBackendService(db)
    deleted = await svc.delete(backend_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    await db.commit()


@router.post("/{backend_id}/health", response_model=MLBackendHealthResponse)
async def check_health(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    healthy = await svc.check_health(backend_id)
    await db.commit()
    return MLBackendHealthResponse(
        status="ok" if healthy else "error",
        backend_id=backend.id,
        backend_name=backend.name,
    )


@router.post("/{backend_id}/predict-test")
async def predict_test(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend:
        raise HTTPException(status_code=404, detail="ML Backend not found")

    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    client = MLBackendClient(backend)
    results = await client.predict([{"id": str(task.id), "file_path": _resolve_task_url(task)}])
    return {
        "results": [
            {"task_id": r.task_id, "result": r.result, "score": r.score}
            for r in results
        ]
    }


@router.post("/{backend_id}/interactive-annotating")
async def interactive_annotating(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    body: InteractiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(*_MANAGERS, UserRole.REVIEWER, UserRole.ANNOTATOR)
    ),
):
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    if not backend.is_interactive:
        raise HTTPException(
            status_code=400,
            detail="This backend does not support interactive annotation",
        )

    task = await db.get(Task, body.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # v0.9.2 · text prompt 时把项目级 DINO 阈值注入 context；客户端如已显式传值则尊重客户端。
    context = dict(body.context or {})
    if context.get("type") == "text":
        project = await db.get(Project, project_id)
        if project is not None:
            context.setdefault("box_threshold", float(project.box_threshold))
            context.setdefault("text_threshold", float(project.text_threshold))

    client = MLBackendClient(backend)
    result = await client.predict_interactive(
        task_data={"id": str(task.id), "file_path": _resolve_task_url(task)},
        context=context,
    )
    return {
        "result": result.result,
        "score": result.score,
        "inference_time_ms": result.inference_time_ms,
    }
