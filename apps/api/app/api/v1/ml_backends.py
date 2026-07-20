import json
import time
import uuid

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import (
    get_db,
    get_gpu_dispatch_context_factory,
    get_gpu_shadow_session_factory,
    require_roles,
    require_project_visible,
    require_project_owner,
)
from app.db.enums import UserRole
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.db.models.user import User
from app.db.models.task import Task
from app.db.models.project import Project
from app.schemas.ml_backend import (
    MLBackendCreate,
    MLBackendUpdate,
    MLBackendOut,
    MLBackendHealthResponse,
    MLBackendUnloadResponse,
    MLBackendReloadRequest,
    InteractiveRequest,
    BackendCapabilities,
    ProjectMLBackendItem,
    ProjectMLBackendList,
    ProjectMLBackendEnablement,
)
from app.services.gpu_arbitration.contracts import (
    GPUArbiterDispatchError,
    GPUDispatchContextFactory,
    GPUShadowSessionFactory,
)
from app.services.gpu_arbitration.policy import GPUClaimConfigurationError
from app.services.ml_backend import (
    GPUBackendManagedMutationBlocked,
    MLBackendService,
    MLBackendURLConflict,
)
from app.services import ml_client as ml_client_module
from app.services.ml_capabilities import extract_capabilities
from app.services.prediction import PredictionService, to_video_bbox_result
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

    v0.23.0 · 实现已下沉到 :func:`app.services.storage.resolve_task_url`, 供 router、
    worker 与 video tracker runner 共用; 这里仅保留薄别名。
    """
    from app.services.storage import resolve_task_url

    return resolve_task_url(task)


@router.post(
    "",
    response_model=MLBackendOut,
    status_code=201,
    dependencies=[Depends(require_project_owner)],
)
async def create_ml_backend(
    project_id: uuid.UUID,
    data: MLBackendCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
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


@router.get(
    "",
    response_model=list[MLBackendOut],
    dependencies=[Depends(require_project_visible)],
)
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


@router.get(
    "/available",
    response_model=ProjectMLBackendList,
    dependencies=[Depends(require_project_visible)],
)
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


@router.put(
    "/{backend_id}/enablement",
    response_model=ProjectMLBackendItem,
    dependencies=[Depends(require_project_owner)],
)
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


@router.get(
    "/{backend_id}",
    response_model=MLBackendOut,
    dependencies=[Depends(require_project_visible)],
)
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


@router.put(
    "/{backend_id}",
    response_model=MLBackendOut,
    dependencies=[Depends(require_project_owner)],
)
async def update_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    data: MLBackendUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    svc = MLBackendService(db)
    if not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")
    _setup_cache.pop(backend_id, None)
    updates = data.model_dump(exclude_unset=True)
    # 更新作用于全局注册行 (auth/url/extra_params 等端点固有属性)。
    try:
        backend = await svc.update(backend_id, **updates)
    except GPUClaimConfigurationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": "gpu_config_invalid",
                "message": str(exc),
                "diagnostics": [
                    diagnostic.model_dump(mode="json") for diagnostic in exc.diagnostics
                ],
            },
        ) from exc
    except MLBackendURLConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "ml_backend_url_conflict",
                "message": f"该 URL 已注册为全局 backend ({exc.backend_name})",
            },
        ) from exc
    except GPUBackendManagedMutationBlocked as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "gpu_backend_retirement_required",
                "message": str(exc),
            },
        ) from exc
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


@router.delete(
    "/{backend_id}",
    status_code=204,
    dependencies=[Depends(require_project_owner)],
)
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


@router.post("/{backend_id}/unload", response_model=MLBackendUnloadResponse)
async def unload_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    shadow_session_factory: GPUShadowSessionFactory = Depends(
        get_gpu_shadow_session_factory
    ),
    dispatch_context_factory: GPUDispatchContextFactory = Depends(
        get_gpu_dispatch_context_factory
    ),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> MLBackendUnloadResponse:
    """B-28+ · 触发 backend 卸载模型释放显存. backend 未实现 /unload 时返回 502.

    鉴权 super_admin only · /unload 作用于「全局 backend 显存驻留」(一物理 backend 被多个
    项目共用), 项目 owner 也能借此驱逐其他项目正在用的权重。故这类破坏性的驻留操作收口到
    平台管理员, 与前端「运行时观测」面板 (super_admin only) 及 admin observe/smoke-test 的
    运维基线一致; 不叠加 require_project_owner —— 全局操作按 backend_id 定位, 与 path 里的
    project 无归属关系。构造性的 /warmup 仍保留在 project_owner (见该端点注释)。"""
    svc = MLBackendService(
        db,
        shadow_session_factory=shadow_session_factory,
        dispatch_context_factory=dispatch_context_factory,
    )
    try:
        result = await svc.unload(backend_id)
    except GPUArbiterDispatchError:
        raise
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
    return MLBackendUnloadResponse.model_validate(result)


@router.post("/{backend_id}/reload")
async def reload_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    request: Request,
    body: MLBackendReloadRequest | None = None,
    db: AsyncSession = Depends(get_db),
    shadow_session_factory: GPUShadowSessionFactory = Depends(
        get_gpu_shadow_session_factory
    ),
    dispatch_context_factory: GPUDispatchContextFactory = Depends(
        get_gpu_dispatch_context_factory
    ),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    """B-28+ · 触发 backend 重新加载模型. 已加载则 noop.

    v0.10.26 · 可选 body {sam_variant, dino_variant} 预热指定变体 (模型市场单变体预热);
    缺省回退 backend 默认变体.

    鉴权 super_admin only · /reload 会改写「全局 backend 常驻变体」(同 backend 被多项目共用),
    切变体等于换掉其他项目正在用的权重, 属破坏性驻留操作, 与 /unload 同基线收口到平台管理员
    (对齐 super_admin only 的「运行时观测」面板)。"""
    svc = MLBackendService(
        db,
        shadow_session_factory=shadow_session_factory,
        dispatch_context_factory=dispatch_context_factory,
    )
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
    except GPUArbiterDispatchError:
        raise
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


@router.post(
    "/{backend_id}/warmup",
    dependencies=[Depends(require_project_owner)],
)
async def warmup_ml_backend(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    request: Request,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    shadow_session_factory: GPUShadowSessionFactory = Depends(
        get_gpu_shadow_session_factory
    ),
    dispatch_context_factory: GPUDispatchContextFactory = Depends(
        get_gpu_dispatch_context_factory
    ),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    """v0.14.14 协议 §4.4 · 转发 POST /warmup 到 backend.

    body 原样转发 (各 backend schema 不同). backend 未声明 warmup_endpoint=True 时仍
    转发, 收到 404/405 由上游 502 反馈; 前端 ⚡ 按钮应已通过 health_meta.capabilities.
    warmup_endpoint 提前置灰.

    鉴权 project_owner (刻意不随 /unload·/reload 收口到 super_admin) · warmup 是「构造性」
    预热, 是项目自身预标/交互推理的前置: AIPreAnnotate 预热加载类别表 (model.names)、能力目录
    对项目管理员可见的预热按钮, 都是项目负责人的日常流程。共享态权衡: 预热可能驱逐同 backend
    上其他项目常驻的模型, 属可接受代价 —— 它是本项目用模型的必要前提, 且 backend 侧有
    max_concurrency / idle 淘汰兜底。只有会直接驱逐/换掉他人在用权重的 unload/reload 才收口
    到平台管理员。"""
    svc = MLBackendService(
        db,
        shadow_session_factory=shadow_session_factory,
        dispatch_context_factory=dispatch_context_factory,
    )
    try:
        result = await svc.warmup(backend_id, body or {})
    except GPUArbiterDispatchError:
        raise
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


@router.get(
    "/{backend_id}/setup",
    dependencies=[Depends(require_project_visible)],
)
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


@router.get(
    "/{backend_id}/capabilities",
    response_model=BackendCapabilities,
    dependencies=[Depends(require_project_visible)],
)
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


@router.post(
    "/{backend_id}/capabilities/refresh",
    response_model=BackendCapabilities,
    dependencies=[Depends(require_project_owner)],
)
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


@router.post(
    "/{backend_id}/health",
    response_model=MLBackendHealthResponse,
    dependencies=[Depends(require_project_owner)],
)
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


async def _get_task_in_project(
    db: AsyncSession, task_id: uuid.UUID, project_id: uuid.UUID
) -> Task:
    """取 task 并校验归属本项目 — 防跨项目越权 (只用主键取任务会让 A 项目成员用 A 的
    backend + B 项目的 task_id 完成推理)。不存在 / 不属于本项目都回 404, 不暴露存在性。"""
    task = await db.get(Task, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


async def _require_ai_interactive_enabled(
    db: AsyncSession, project_id: uuid.UUID
) -> None:
    """项目级「交互式 AI 工具」总开关的后端守卫。语义与前端 (`?? true`) 一致 = 默认开:
    仅当显式关闭 (ai_interactive_enabled is False) 才 403, None/True 放行。"""
    project = await db.get(Project, project_id)
    if project is not None and project.ai_interactive_enabled is False:
        raise HTTPException(
            status_code=403, detail="AI interactive is disabled for this project"
        )


@router.post(
    "/{backend_id}/predict-test",
    dependencies=[Depends(require_project_owner)],
)
async def predict_test(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    shadow_session_factory: GPUShadowSessionFactory = Depends(
        get_gpu_shadow_session_factory
    ),
    dispatch_context_factory: GPUDispatchContextFactory = Depends(
        get_gpu_dispatch_context_factory
    ),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend or not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")

    task = await _get_task_in_project(db, task_id, project_id)
    await db.commit()

    client = ml_client_module.MLBackendClient(
        backend,
        shadow_session_factory=shadow_session_factory,
        dispatch_context_factory=dispatch_context_factory,
    )
    results = await client.predict(
        [{"id": str(task.id), "file_path": _resolve_task_url(task)}]
    )
    return {
        "results": [
            {"task_id": r.task_id, "result": r.result, "score": r.score}
            for r in results
        ]
    }


@router.post(
    "/{backend_id}/interactive-annotating",
    dependencies=[Depends(require_project_visible)],
)
async def interactive_annotating(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    body: InteractiveRequest,
    db: AsyncSession = Depends(get_db),
    shadow_session_factory: GPUShadowSessionFactory = Depends(
        get_gpu_shadow_session_factory
    ),
    dispatch_context_factory: GPUDispatchContextFactory = Depends(
        get_gpu_dispatch_context_factory
    ),
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

    await _require_ai_interactive_enabled(db, project_id)
    task = await _get_task_in_project(db, body.task_id, project_id)

    # AI 推理参数 (阈值 / 变体等) 已统一改走工作台 AI 面板: 前端按所绑定 backend 的
    # /setup.params 动态渲染、每用户独立调整, 并随 context 透传。平台不再注入项目级 DINO
    # 阈值 (那会把 gsam2 专属参数塞给 sam3 等不支持的后端); 各 backend 缺省值由自身 /setup 决定。
    context = dict(body.context or {})
    await db.commit()

    client = ml_client_module.MLBackendClient(
        backend,
        shadow_session_factory=shadow_session_factory,
        dispatch_context_factory=dispatch_context_factory,
    )
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


@router.post(
    "/{backend_id}/predict-frame",
    dependencies=[Depends(require_project_visible)],
)
async def predict_frame(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    frame: UploadFile = File(...),
    task_id: uuid.UUID = Form(...),
    frame_index: int = Form(...),
    config: str = Form("{}"),
    db: AsyncSession = Depends(get_db),
    shadow_session_factory: GPUShadowSessionFactory = Depends(
        get_gpu_shadow_session_factory
    ),
    dispatch_context_factory: GPUDispatchContextFactory = Depends(
        get_gpu_dispatch_context_factory
    ),
    current_user: User = Depends(
        require_roles(*_MANAGERS, UserRole.REVIEWER, UserRole.ANNOTATOR)
    ),
):
    """v0.21.4 · 对客户端传入的「视频当前帧」JPEG 跑图像 backend, 落单帧 ``video_bbox`` 候选。

    视频 task 的 ``file_path`` 是整段 mp4, 图像 backend 从 task URL 取不到帧 (见
    ``_resolve_task_url``)。故前端把当前帧解成 JPEG 随 multipart 传入; 服务端上传 import 桶换
    presigned URL 投递 (``upload_crop_bytes``, **通用**——gsam2/sam3 全支持 http URL, 不走
    ``data:`` 捷径); 结果逐框改写成 ``video_bbox(frame_index)`` 落一条 Prediction, 采纳复用既有
    ``/predictions/{id}/accept`` 机制 → ``VideoBboxGeometry``。

    与批量预标 (整段视频投 signed URL 走 worker) 是两条路: 本路同步、单帧、client 供图。
    """
    from app.workers.tasks import _build_predict_context

    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend or not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")

    await _require_ai_interactive_enabled(db, project_id)
    task = await _get_task_in_project(db, task_id, project_id)

    try:
        cfg = json.loads(config) if config else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid config JSON")
    if not isinstance(cfg, dict):
        raise HTTPException(status_code=400, detail="config must be a JSON object")

    # DINO 阈值取项目级 override (与 worker 单阶段路径一致, 见 workers/tasks.py `_run_batch`)。
    project = await db.get(Project, project_id)
    context = _build_predict_context(
        prompt=cfg.get("prompt"),
        # 单帧只要框: 文本 backend (gsam2) 输出 box; mask/polygon 非 video_bbox 会被丢弃。
        output_mode=cfg.get("output_mode") or "box",
        params=cfg.get("params"),
        model_id=cfg.get("model_id"),
        task_type=cfg.get("task_type"),
        model_variants=cfg.get("model_variants"),
        class_filter=cfg.get("class_filter"),
        box_threshold=(
            float(project.box_threshold)
            if project is not None and project.box_threshold is not None
            else None
        ),
        text_threshold=(
            float(project.text_threshold)
            if project is not None and project.text_threshold is not None
            else None
        ),
    )

    jpeg_bytes = await frame.read()
    if not jpeg_bytes:
        raise HTTPException(status_code=400, detail="Empty frame image")

    storage = StorageService()
    frame_url = storage.upload_crop_bytes(
        jpeg_bytes, f"frame-predict/{task_id}/{frame_index}.jpg"
    )
    await db.commit()

    client = ml_client_module.MLBackendClient(
        backend,
        shadow_session_factory=shadow_session_factory,
        dispatch_context_factory=dispatch_context_factory,
    )
    results = await client.predict(
        [{"id": str(task.id), "file_path": frame_url}], context=context
    )

    raw_shapes: list[dict] = []
    for r in results:
        if isinstance(r.result, list):
            raw_shapes.extend(r.result)
    video_shapes = to_video_bbox_result(raw_shapes, frame_index)

    score = next((r.score for r in results if r.score is not None), None)
    pred_svc = PredictionService(db)
    # v0.23.3 ADR-0050 §5.4 · 记录 requested pool (off/observe: 经 registry 解析 singleton pool)。
    pool_id = await svc.pool_id_for_registry(backend_id)
    prediction = await pred_svc.create_from_ml_result(
        task_id=task.id,
        project_id=project_id,
        ml_backend_id=backend_id,
        result=video_shapes,
        score=score,
        ml_backend_pool_id=pool_id,
    )
    await db.commit()
    return {
        "prediction_id": str(prediction.id),
        "candidate_count": len(video_shapes),
        "frame_index": frame_index,
    }


@router.post(
    "/{backend_id}/interactive-annotating-frame",
    dependencies=[Depends(require_project_visible)],
)
async def interactive_annotating_frame(
    project_id: uuid.UUID,
    backend_id: uuid.UUID,
    frame: UploadFile = File(...),
    task_id: uuid.UUID = Form(...),
    frame_index: int = Form(...),
    context: str = Form("{}"),
    db: AsyncSession = Depends(get_db),
    shadow_session_factory: GPUShadowSessionFactory = Depends(
        get_gpu_shadow_session_factory
    ),
    dispatch_context_factory: GPUDispatchContextFactory = Depends(
        get_gpu_dispatch_context_factory
    ),
    current_user: User = Depends(
        require_roles(*_MANAGERS, UserRole.REVIEWER, UserRole.ANNOTATOR)
    ),
):
    """视频当前帧的**交互式** SAM 提示 (point / interactive_box / exemplar)。

    与 ``interactive-annotating`` 同一个 backend 契约 (``context`` 原样透传, 见
    ``InteractiveRequest.context``), 唯一差别是**图从哪来**: 图片 task 由服务端
    ``_resolve_task_url(task)`` 取, 而视频 task 的 ``file_path`` 是整段 mp4, SAM 吃不到帧。
    故前端把当前帧解成 JPEG 随 multipart 传入 (复用 ``predict-frame`` 的 client 供图机制:
    上传 import 桶换 presigned URL, 通用 http URL, 不走 ``data:`` 捷径)。

    与 ``predict-frame`` 的区别: 那条走**批量 ``/predict`` 协议**(text prompt → box, 结果落
    Prediction 待采纳); 本条走 ``predict_interactive``, 候选**瞬态返回不落库**, 由前端
    state 持有, 采纳时直接建 Annotation (对齐图片侧交互链路)。

    ``mask_input_next`` 原样回传, 支撑同一帧多次点击的 low-res logits 回灌精修。
    """
    svc = MLBackendService(db)
    backend = await svc.get(backend_id)
    if not backend or not await svc.is_enabled(project_id, backend_id):
        raise HTTPException(status_code=404, detail="ML Backend not found")
    if not backend.is_interactive:
        raise HTTPException(
            status_code=400,
            detail="This backend does not support interactive annotation",
        )

    await _require_ai_interactive_enabled(db, project_id)
    task = await _get_task_in_project(db, task_id, project_id)

    try:
        ctx = json.loads(context) if context else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid context JSON")
    if not isinstance(ctx, dict):
        raise HTTPException(status_code=400, detail="context must be a JSON object")

    jpeg_bytes = await frame.read()
    if not jpeg_bytes:
        raise HTTPException(status_code=400, detail="Empty frame image")

    storage = StorageService()
    frame_url = storage.upload_crop_bytes(
        jpeg_bytes, f"frame-interactive/{task_id}/{frame_index}.jpg"
    )
    await db.commit()

    # 与 interactive_annotating 一致: 不注入项目级 DINO 阈值 (那是 gsam2 专属, 塞给 sam3
    # 等后端会出错); 推理参数由前端按 /setup.params 渲染后随 context 透传。
    client = ml_client_module.MLBackendClient(
        backend,
        shadow_session_factory=shadow_session_factory,
        dispatch_context_factory=dispatch_context_factory,
    )
    result = await client.predict_interactive(
        task_data={"id": str(task.id), "file_path": frame_url},
        context=ctx,
    )
    return {
        "result": result.result,
        "score": result.score,
        "inference_time_ms": result.inference_time_ms,
        "cache_hit": result.cache_hit,
        "model_load_ms": result.model_load_ms,
        "mask_input_next": result.mask_input_next,
    }
