import re
import time
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_db, require_roles
from app.db.enums import UserRole
from app.db.models.ml_backend import MLBackend
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
from app.services.ml_backend import MLBackendDeleteBlocked, MLBackendService
from app.services.ml_client import MLBackendClient
from app.services.storage import StorageService
from app.services.audit import AuditService

# v0.10.1 · /setup 代理结果的进程内 TTL 缓存. 工作台进入即拉, 避免 N 次 backend 探活.
# key = backend_id (绑定改动 → 重绑后新 backend_id 自然 invalidate); 30s TTL 兜底.
_SETUP_CACHE_TTL_SECONDS = 30.0
_setup_cache: dict[uuid.UUID, tuple[float, dict]] = {}

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)


def _resolve_task_url(task: Task) -> str:
    """v0.9.4 · 把 task.file_path (MinIO 对象 key) 转成 ML backend 可访问的 presigned URL。

    SAM backend 协议要求 file_path 是 http(s):// URL 或本地路径; tasks 表里存的是 key,
    必须先签发 presigned URL。当平台 api 跑在 host 进程而 ML backend 在 docker 网内时,
    再把 host 替换为 ``settings.ml_backend_storage_host`` (容器可达地址)。
    """
    storage = StorageService()
    bucket = storage.datasets_bucket if task.dataset_item_id else storage.bucket
    url = storage.generate_download_url(task.file_path, bucket=bucket)
    if settings.ml_backend_storage_host:
        url = re.sub(
            r"://[^/]+", f"://{settings.ml_backend_storage_host}", url, count=1
        )
    return url


@router.post("", response_model=MLBackendOut, status_code=201)
async def create_ml_backend(
    project_id: uuid.UUID,
    data: MLBackendCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    # v0.10.1 · MAX_ML_BACKENDS_PER_PROJECT 上限校验. DB 已按 1:N 设计 (project_id 非 unique),
    # 应用层挡入口防显存爆炸. 超限时返 409 + 结构化 detail{code,message}, 前端 M3 据此渲染弹窗.
    limit = settings.max_ml_backends_per_project
    if limit > 0:
        existing = await db.execute(
            select(func.count())
            .select_from(MLBackend)
            .where(MLBackend.project_id == project_id)
        )
        existing_count = int(existing.scalar() or 0)
        if existing_count >= limit:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "ML_BACKEND_LIMIT_REACHED",
                    "message": (
                        f"当前项目已绑定 {existing_count} 个 ML 后端,"
                        f"达到上限 {limit}。请先解绑现有后端再添加。"
                    ),
                    "limit": limit,
                    "current": existing_count,
                },
            )

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
    # B-5 · AI 审计 — ML backend 注册
    await AuditService.log(
        db,
        actor=current_user,
        action="ml_backend.created",
        target_type="ml_backend",
        target_id=str(backend.id),
        request=request,
        status_code=201,
        detail={
            "project_id": str(project_id),
            "name": data.name,
            "url": data.url,
            "is_interactive": data.is_interactive,
        },
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
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = MLBackendService(db)
    _setup_cache.pop(backend_id, None)
    updates = data.model_dump(exclude_unset=True)
    backend = await svc.update(backend_id, **updates)
    if not backend:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    await AuditService.log(
        db,
        actor=current_user,
        action="ml_backend.updated",
        target_type="ml_backend",
        target_id=str(backend_id),
        request=request,
        status_code=200,
        detail={"project_id": str(project_id), "fields": list(updates.keys())},
    )
    await db.commit()
    await db.refresh(backend)
    return backend


@router.delete("/{backend_id}", status_code=204)
async def delete_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = MLBackendService(db)
    _setup_cache.pop(backend_id, None)
    try:
        deleted = await svc.delete(backend_id)
    except MLBackendDeleteBlocked as exc:
        raise HTTPException(
            status_code=409,
            detail=f"ML Backend has {exc.running_jobs} running prediction job(s); wait or cancel before deleting",
        )
    if not deleted:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    await AuditService.log(
        db,
        actor=current_user,
        action="ml_backend.deleted",
        target_type="ml_backend",
        target_id=str(backend_id),
        request=request,
        status_code=204,
        detail={"project_id": str(project_id)},
    )
    await db.commit()


@router.post("/{backend_id}/unload")
async def unload_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    """B-28+ · 触发 backend 卸载模型释放显存. backend 未实现 /unload 时返回 502."""
    svc = MLBackendService(db)
    try:
        result = await svc.unload(backend_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"backend unload failed: {exc}")
    if result is None:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    await AuditService.log(
        db,
        actor=current_user,
        action="ml_backend.unloaded",
        target_type="ml_backend",
        target_id=str(backend_id),
        request=request,
        status_code=200,
        detail={"project_id": str(project_id), "result": result},
    )
    await db.commit()
    return result


@router.post("/{backend_id}/reload")
async def reload_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    """B-28+ · 触发 backend 重新加载模型. 已加载则 noop."""
    svc = MLBackendService(db)
    try:
        result = await svc.reload(backend_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"backend reload failed: {exc}")
    if result is None:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    await AuditService.log(
        db,
        actor=current_user,
        action="ml_backend.reloaded",
        target_type="ml_backend",
        target_id=str(backend_id),
        request=request,
        status_code=200,
        detail={"project_id": str(project_id), "result": result},
    )
    await db.commit()
    return result


@router.get("/{backend_id}/setup")
async def get_ml_backend_setup(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(*_MANAGERS, UserRole.REVIEWER, UserRole.ANNOTATOR)
    ),
):
    """v0.10.1 · 代理 backend /setup, 返回 JSON Schema 自描述能力 (供前端 useMLCapabilities).

    30s TTL 进程内缓存; backend 升级/重启后最坏延迟 30s. 删除/更新 backend 时 invalidate.
    """
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend or backend.project_id != project_id:
        raise HTTPException(status_code=404, detail="ML Backend not found")

    now = time.monotonic()
    cached = _setup_cache.get(backend_id)
    if cached is not None and (now - cached[0]) < _SETUP_CACHE_TTL_SECONDS:
        return cached[1]

    client = MLBackendClient(backend)
    try:
        data = await client.setup()
    except Exception as exc:  # httpx.HTTPError 或 timeout
        raise HTTPException(
            status_code=502, detail=f"backend /setup unreachable: {exc}"
        )
    _setup_cache[backend_id] = (now, data)
    return data


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
    results = await client.predict(
        [{"id": str(task.id), "file_path": _resolve_task_url(task)}]
    )
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
