import time
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_roles
from app.db.enums import UserRole
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.db.models.user import User
from app.db.models.task import Task
from app.schemas.ml_backend import (
    MLBackendCreate,
    MLBackendUpdate,
    MLBackendOut,
    MLBackendHealthResponse,
    MLBackendReloadRequest,
    InteractiveRequest,
    BackendCapabilities,
    ProjectMLBackendItem,
    ProjectMLBackendList,
    ProjectMLBackendEnablement,
)
from app.services.ml_backend import MLBackendService
from app.services import ml_client as ml_client_module
from app.services.ml_capabilities import extract_capabilities
from app.services.storage import StorageService
from app.services.audit import AuditService

# v0.10.1 · /setup 代理结果的进程内 TTL 缓存. 工作台进入即拉, 避免 N 次 backend 探活.
# key = backend_id (绑定改动 → 重绑后新 backend_id 自然 invalidate); 30s TTL 兜底.
_SETUP_CACHE_TTL_SECONDS = 30.0
_setup_cache: dict[uuid.UUID, tuple[float, dict]] = {}

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)


def _out(backend: MLBackendRegistry, project_id: uuid.UUID) -> MLBackendOut:
    """把全局注册行序列化为 MLBackendOut, 注入「本项目」id (表该项目启用了此 backend)。"""
    return MLBackendOut.model_validate(backend, from_attributes=True).model_copy(
        update={"project_id": project_id}
    )


def _resolve_task_url(task: Task) -> str:
    """v0.9.4 · 把 task.file_path (MinIO 对象 key) 转成 ML backend 可访问的 presigned URL。

    SAM backend 协议要求 file_path 是 http(s):// URL 或本地路径; tasks 表里存的是 key,
    必须先签发 presigned URL。当平台 api 跑在 host 进程而 ML backend 在 docker 网内时,
    再把 host 替换为 ``settings.ml_backend_storage_host`` (容器可达地址)。
    """
    storage = StorageService()
    bucket = storage.datasets_bucket if task.dataset_item_id else storage.bucket
    url = storage.generate_download_url(task.file_path, bucket=bucket)
    return storage.rewrite_host_for_ml_backend(url)


@router.post("", response_model=MLBackendOut, status_code=201)
async def create_ml_backend(
    project_id: uuid.UUID,
    data: MLBackendCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    # v0.19.0 ADR-0044 · 「为项目添加 backend」= 按 url 复用/新建全局注册项 + 为本项目启用。
    # 不再有 max_ml_backends_per_project 上限 (显存保护交全局行 extra_params.max_concurrency)。
    svc = MLBackendService(db)
    backend = await svc.get_by_url(data.url)
    if backend is None:
        backend = await svc.create_registry(
            name=data.name,
            url=data.url,
            source="manual",
            is_interactive=data.is_interactive,
            auth_method=data.auth_method,
            auth_token=data.auth_token,
            extra_params=data.extra_params,
        )
    await svc.set_enabled(project_id, backend.id, enabled=True)
    # B-5 · AI 审计 — ML backend 注册 + 项目启用
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
    return _out(backend, project_id)


@router.get("", response_model=list[MLBackendOut])
async def list_ml_backends(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(*_MANAGERS, UserRole.REVIEWER, UserRole.ANNOTATOR)
    ),
):
    svc = MLBackendService(db)
    backends = await svc.list_enabled_for_project(project_id)
    return [_out(b, project_id) for b in backends]


@router.get("/available", response_model=ProjectMLBackendList)
async def list_available_ml_backends(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    """v0.19.0 ADR-0044 · 项目设置「启用勾选清单」: 列出全部全局 backend + 本项目启用态/覆盖。

    与 GET "" (只返回已启用) 区分: 本端点含未启用项, 供项目管理员勾选启用。
    路由声明在 `/{backend_id}` 之前, 避免被当作 backend_id 捕获。
    """
    svc = MLBackendService(db)
    rows = await svc.list_available_for_project(project_id)
    items = [
        ProjectMLBackendItem(
            backend=MLBackendOut.model_validate(reg, from_attributes=True),
            enabled=bool(assoc and assoc.enabled),
            default_variants=assoc.default_variants if assoc else None,
        )
        for reg, assoc in rows
    ]
    return ProjectMLBackendList(items=items)


@router.put("/{backend_id}/enablement", response_model=ProjectMLBackendItem)
async def set_ml_backend_enablement(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    data: ProjectMLBackendEnablement,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    """v0.19.0 ADR-0044 · 切换本项目对某全局 backend 的启用 + 写项目级覆盖 (阈值/变体)。

    全局 backend 必须存在 (不在此创建全局项; 注册全局项走 admin 端点)。
    """
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if backend is None:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    overrides = {
        k: v for k, v in (("default_variants", data.default_variants),) if v is not None
    }
    assoc = await svc.set_enabled(
        project_id, backend_id, enabled=data.enabled, **overrides
    )
    _setup_cache.pop(backend_id, None)
    await AuditService.log(
        db,
        actor=current_user,
        action="ml_backend.enablement",
        target_type="ml_backend",
        target_id=str(backend_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(project_id),
            "enabled": data.enabled,
            "overrides": list(overrides.keys()),
        },
    )
    await db.commit()
    await db.refresh(backend)
    await db.refresh(assoc)
    return ProjectMLBackendItem(
        backend=MLBackendOut.model_validate(backend, from_attributes=True),
        enabled=assoc.enabled,
        default_variants=assoc.default_variants,
    )


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
    if not backend or not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")
    return _out(backend, project_id)


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
    if not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")
    _setup_cache.pop(backend_id, None)
    updates = data.model_dump(exclude_unset=True)
    # 更新作用于全局注册行 (auth/url/extra_params 等端点固有属性)。
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
    return _out(backend, project_id)


@router.delete("/{backend_id}", status_code=204)
async def delete_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    # v0.19.0 ADR-0044 · 项目作用域的「删除」= 为本项目停用全局 backend (不删全局注册项;
    # 删全局项是 superadmin 的 admin 端点, 见 PR3)。
    svc = MLBackendService(db)
    if not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")
    _setup_cache.pop(backend_id, None)
    await svc.set_enabled(project_id, backend_id, enabled=False)
    await AuditService.log(
        db,
        actor=current_user,
        action="ml_backend.deleted",
        target_type="ml_backend",
        target_id=str(backend_id),
        request=request,
        status_code=204,
        detail={"project_id": str(project_id), "op": "disable"},
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
    body: MLBackendReloadRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    """B-28+ · 触发 backend 重新加载模型. 已加载则 noop.

    v0.10.26 · 可选 body {sam_variant, dino_variant} 预热指定变体 (模型市场单变体预热);
    缺省回退 backend 默认变体.
    """
    svc = MLBackendService(db)
    sam_variant = body.sam_variant if body else None
    dino_variant = body.dino_variant if body else None
    task_type = body.task_type if body else None
    try:
        result = await svc.reload(
            backend_id,
            sam_variant=sam_variant,
            dino_variant=dino_variant,
            task_type=task_type,
        )
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
        detail={
            "project_id": str(project_id),
            "sam_variant": sam_variant,
            "dino_variant": dino_variant,
            "result": result,
        },
    )
    await db.commit()
    return result


@router.post("/{backend_id}/warmup")
async def warmup_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    request: Request,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    """v0.14.14 协议 §4.4 · 转发 POST /warmup 到 backend.

    body 原样转发 (各 backend schema 不同). backend 未声明 warmup_endpoint=True 时仍
    转发, 收到 404/405 由上游 502 反馈; 前端 ⚡ 按钮应已通过 health_meta.capabilities.
    warmup_endpoint 提前置灰.
    """
    svc = MLBackendService(db)
    try:
        result = await svc.warmup(backend_id, body or {})
    except httpx.HTTPStatusError as exc:
        # 透传 backend 上游的业务错误 (4xx 变体非法 / 5xx OOM / weight missing).
        status = exc.response.status_code
        detail = exc.response.text or f"backend warmup HTTP {status}"
        headers = {}
        retry_after = exc.response.headers.get("Retry-After")
        if retry_after:
            headers["Retry-After"] = retry_after
        raise HTTPException(
            status_code=status,
            detail=detail,
            headers=headers or None,
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"backend warmup failed: {exc}"
        ) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="ML Backend not found")
    # v0.14.17 · 预热会改变 backend 已加载的模型, 从而改变 /setup.models[].classes (yolo 加载后
    # 才暴露 model.names). 失效 /setup 缓存, 让随后的 /capabilities 立即拿到新类别表 (否则最坏等 30s TTL)。
    _setup_cache.pop(backend_id, None)
    await AuditService.log(
        db,
        actor=current_user,
        action="ml_backend.warmup",
        target_type="ml_backend",
        target_id=str(backend_id),
        request=request,
        status_code=200,
        detail={"project_id": str(project_id), "body": body, "result": result},
    )
    await db.commit()
    return result


async def _fetch_setup_cached(backend, backend_id: uuid.UUID) -> dict:
    """v0.10.1 · 探 backend /setup, 命中 30s TTL 进程内缓存则直接返回.

    v0.14.9 · 抽出供 /setup 与 /capabilities 端点共用同一缓存链路; backend /setup
    不可达时抛 502 (与原 /setup 端点行为一致).
    """
    now = time.monotonic()
    cached = _setup_cache.get(backend_id)
    if cached is not None and (now - cached[0]) < _SETUP_CACHE_TTL_SECONDS:
        return cached[1]

    client = ml_client_module.MLBackendClient(backend)
    try:
        data = await client.setup()
    except Exception as exc:  # httpx.HTTPError 或 timeout
        raise HTTPException(
            status_code=502, detail=f"backend /setup unreachable: {exc}"
        )
    _setup_cache[backend_id] = (now, data)
    return data


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
    if not backend or not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")

    return await _fetch_setup_cached(backend, backend_id)


@router.get("/{backend_id}/capabilities", response_model=BackendCapabilities)
async def get_ml_backend_capabilities(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(*_MANAGERS, UserRole.REVIEWER, UserRole.ANNOTATOR)
    ),
):
    """v0.14.9 · 能力声明协议 v2: 探 /setup (复用 setup 缓存链路) → 派生能力快照.

    返回含 models[] / infra / modalities + 扁平并集字段, 供前端多模型目录消费.
    权限同 /setup 端点 (managers + reviewer + annotator)。/setup 不可达时 502.
    """
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend or not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")

    setup = await _fetch_setup_cached(backend, backend_id)
    return extract_capabilities(setup) or {}


@router.post("/{backend_id}/capabilities/refresh", response_model=BackendCapabilities)
async def refresh_ml_backend_capabilities(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    """v0.14.9 · 强制刷新能力快照: 先 invalidate setup 缓存再重探 + 派生.

    权限同 /health (managers); 用于 backend 升级/换模型后主动拉新能力。
    """
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend or not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")

    _setup_cache.pop(backend_id, None)
    setup = await _fetch_setup_cached(backend, backend_id)
    return extract_capabilities(setup) or {}


@router.post("/{backend_id}/health", response_model=MLBackendHealthResponse)
async def check_health(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend or not await svc.is_enabled(project_id, backend_id):
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
    if not backend or not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")

    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    client = ml_client_module.MLBackendClient(backend)
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
    if not backend or not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")
    if not backend.is_interactive:
        raise HTTPException(
            status_code=400,
            detail="This backend does not support interactive annotation",
        )

    task = await db.get(Task, body.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # AI 推理参数 (阈值 / 变体等) 已统一改走工作台 AI 面板: 前端按所绑定 backend 的
    # /setup.params 动态渲染、每用户独立调整, 并随 context 透传。平台不再注入项目级 DINO
    # 阈值 (那会把 gsam2 专属参数塞给 sam3 等不支持的后端); 各 backend 缺省值由自身 /setup 决定。
    context = dict(body.context or {})

    client = ml_client_module.MLBackendClient(backend)
    result = await client.predict_interactive(
        task_data={"id": str(task.id), "file_path": _resolve_task_url(task)},
        context=context,
    )
    return {
        "result": result.result,
        "score": result.score,
        "inference_time_ms": result.inference_time_ms,
        "cache_hit": result.cache_hit,
        "model_load_ms": result.model_load_ms,
        # v0.18.18 · 交互精修 low-res logits 回灌 (前端原样存储、下次点击经 context.mask_input 回传)
        "mask_input_next": result.mask_input_next,
    }
