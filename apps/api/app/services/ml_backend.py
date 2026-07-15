from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from aap_protocol_v2.lifecycle import managed_lifecycle_capability_sha256
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.async_job import AsyncJob, AsyncJobStatus
from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.gpu_backend_membership import GPUBackendMembership
from app.db.models.ml_backend_registry import MLBackendRegistry, ProjectMLBackend
from app.db.models.project import Project
from app.services.gpu_arbiter import GPUShadowSessionFactory, validate_gpu_claim
from app.services.ml_client import (
    GPU_HEALTH_CHALLENGE_ECHO_MARKER,
    MLBackendClient,
)


class MLBackendDeleteBlocked(Exception):
    """B-28 · ml_backend 上仍有 running prediction job，拒绝删除。"""

    def __init__(self, running_jobs: int) -> None:
        super().__init__(f"ml backend has {running_jobs} running prediction job(s)")
        self.running_jobs = running_jobs


class MLBackendURLConflict(Exception):
    """A different global registry row already owns the normalized URL."""

    def __init__(self, backend_name: str) -> None:
        super().__init__(f"ML backend URL already registered by {backend_name}")
        self.backend_name = backend_name


class GPUBackendManagedMutationBlocked(Exception):
    """A backend that entered a managed runtime must use managed retirement."""


def _gpu_membership_constraint_name(exc: IntegrityError) -> str | None:
    for source in (exc.orig, getattr(exc.orig, "__cause__", None)):
        if source is None:
            continue
        name = getattr(source, "constraint_name", None)
        if isinstance(name, str):
            return name
        diag = getattr(source, "diag", None)
        name = getattr(diag, "constraint_name", None)
        if isinstance(name, str):
            return name
    return None


def _raise_managed_mutation_for_integrity(exc: IntegrityError) -> None:
    constraint_name = _gpu_membership_constraint_name(exc)
    if constraint_name is not None and constraint_name.startswith(
        "ck_gpu_backend_membership_"
    ):
        raise GPUBackendManagedMutationBlocked(
            "managed GPU backend requires retirement before mutation"
        ) from exc
    raise exc


_REGISTRY_MUTABLE_FIELDS = {
    "name",
    "url",
    "is_interactive",
    "auth_method",
    "auth_token",
    "extra_params",
    "gpu_resource_id",
    "vram_budget_mb",
    "eviction_priority",
}


def _proof_timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("proof timestamps must be timezone-aware")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


class MLBackendService:
    """v0.19.0 ADR-0044 · backend 上提为全局注册表(MLBackendRegistry) + 项目启用关联
    (ProjectMLBackend)。本服务既管全局注册项(superadmin)，也管项目级启用/覆盖。

    `get` 按 registry id 返回全局注册项; 项目内「可用 backend」走
    `list_enabled_for_project` / `get_enabled` (读 ProjectMLBackend.enabled=true)。
    """

    def __init__(
        self,
        db: AsyncSession,
        *,
        shadow_session_factory: GPUShadowSessionFactory | None = None,
    ) -> None:
        self.db = db
        self.shadow_session_factory = shadow_session_factory

    # ── 全局注册表 ───────────────────────────────────────────────────────────
    async def create_registry(
        self, name: str, url: str, source: str = "manual", **kwargs
    ) -> MLBackendRegistry:
        unknown = set(kwargs) - (_REGISTRY_MUTABLE_FIELDS - {"name", "url"})
        if unknown:
            raise TypeError(f"unsupported ML backend fields: {sorted(unknown)}")
        validate_gpu_claim(
            kwargs.get("gpu_resource_id"),
            kwargs.get("vram_budget_mb"),
            extra_params=kwargs.get("extra_params"),
        )
        row = MLBackendRegistry(
            id=uuid.uuid4(), name=name, url=url.rstrip("/"), source=source, **kwargs
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def get(self, registry_id: uuid.UUID) -> MLBackendRegistry | None:
        result = await self.db.execute(
            select(MLBackendRegistry).where(MLBackendRegistry.id == registry_id)
        )
        return result.scalar_one_or_none()

    async def get_by_url(self, url: str) -> MLBackendRegistry | None:
        result = await self.db.execute(
            select(MLBackendRegistry).where(MLBackendRegistry.url == url.rstrip("/"))
        )
        return result.scalar_one_or_none()

    async def list_registry(self) -> list[MLBackendRegistry]:
        result = await self.db.execute(
            select(MLBackendRegistry).order_by(MLBackendRegistry.created_at.desc())
        )
        return list(result.scalars().all())

    async def update(
        self, registry_id: uuid.UUID, **kwargs
    ) -> MLBackendRegistry | None:
        row = await self.get(registry_id)
        if not row:
            return None
        unknown = set(kwargs) - _REGISTRY_MUTABLE_FIELDS
        if unknown:
            raise TypeError(f"unsupported ML backend fields: {sorted(unknown)}")

        if "url" in kwargs:
            url = kwargs["url"]
            if not isinstance(url, str) or not url:
                raise ValueError("url must not be null or empty")
            normalized_url = url.rstrip("/")
            conflict = await self.get_by_url(normalized_url)
            if conflict is not None and conflict.id != row.id:
                raise MLBackendURLConflict(conflict.name)
            kwargs["url"] = normalized_url

        protected_values = {
            "url": row.url,
            "auth_method": row.auth_method,
            "auth_token": row.auth_token,
            "extra_params": row.extra_params,
            "gpu_resource_id": row.gpu_resource_id,
            "vram_budget_mb": row.vram_budget_mb,
            "eviction_priority": row.eviction_priority,
        }
        protected_change = any(
            field in kwargs and kwargs[field] != previous
            for field, previous in protected_values.items()
        )
        if protected_change:
            fence = await self.db.get(GPUBackendFence, registry_id)
            if fence is not None and fence.runtime_epoch_high_water > 0:
                raise GPUBackendManagedMutationBlocked(
                    "managed GPU backend requires retirement before mutation"
                )

        next_resource_id = kwargs.get("gpu_resource_id", row.gpu_resource_id)
        next_budget_mb = kwargs.get("vram_budget_mb", row.vram_budget_mb)
        next_extra_params = kwargs.get("extra_params", row.extra_params)
        validate_gpu_claim(
            next_resource_id,
            next_budget_mb,
            extra_params=next_extra_params,
        )
        if "eviction_priority" in kwargs and kwargs["eviction_priority"] is None:
            raise ValueError("eviction_priority must not be null")

        for key, value in kwargs.items():
            setattr(row, key, value)
        if protected_change:
            # Any membership/config epoch change invalidates the cached residency
            # evidence, even when the endpoint and physical resource stay the same.
            row.state = "disconnected"
            row.health_meta = None
            row.last_checked_at = None
            row.error_message = None
        try:
            await self.db.flush()
        except IntegrityError as exc:
            _raise_managed_mutation_for_integrity(exc)
        return row

    async def _count_running_predictions(self, registry_id: uuid.UUID) -> int:
        """Legacy deletion guard only; never an allocation or active-lease truth."""

        running = await self.db.execute(
            select(AsyncJob.id).where(
                AsyncJob.kind == "batch_predict",
                AsyncJob.payload["ml_backend_id"].astext == str(registry_id),
                AsyncJob.status == AsyncJobStatus.RUNNING.value,
            )
        )
        return len(list(running.scalars().all()))

    async def delete(self, registry_id: uuid.UUID) -> bool:
        row = await self.get(registry_id)
        if not row:
            return False
        # prediction job 仍在跑则拒删 (payload.ml_backend_id 现存 registry id)
        running_jobs = await self._count_running_predictions(registry_id)
        if running_jobs:
            raise MLBackendDeleteBlocked(running_jobs)
        fence = await self.db.get(GPUBackendFence, registry_id)
        if fence is not None and fence.runtime_epoch_high_water > 0:
            raise GPUBackendManagedMutationBlocked(
                "managed GPU backend requires retirement before delete"
            )
        # 级联: 解绑 projects.ml_backend_id (SET NULL 语义); project_ml_backend 关联
        # 由 FK ondelete=CASCADE 自动清。历史 prediction.ml_backend_id 同样 SET NULL。
        bound_projects = await self.db.execute(
            select(Project).where(Project.ml_backend_id == registry_id)
        )
        for project in bound_projects.scalars():
            project.ml_backend_id = None
        await self.db.delete(row)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            _raise_managed_mutation_for_integrity(exc)
        return True

    # ── 项目启用关联 ─────────────────────────────────────────────────────────
    async def list_enabled_for_project(
        self, project_id: uuid.UUID
    ) -> list[MLBackendRegistry]:
        """该项目已启用的全局 backend (registry 行)。预标 / DAG 下游 / 门控读此集合。"""
        result = await self.db.execute(
            select(MLBackendRegistry)
            .join(
                ProjectMLBackend,
                ProjectMLBackend.registry_id == MLBackendRegistry.id,
            )
            .where(
                ProjectMLBackend.project_id == project_id,
                ProjectMLBackend.enabled.is_(True),
            )
            .order_by(MLBackendRegistry.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_available_for_project(
        self, project_id: uuid.UUID
    ) -> list[tuple[MLBackendRegistry, ProjectMLBackend | None]]:
        """全部全局 backend + 本项目关联 (None=未建关联即未启用)。项目设置勾选清单读此。

        LEFT JOIN 保证未启用 / 从未关联过的全局项也出现在清单里 (供勾选启用)。"""
        result = await self.db.execute(
            select(MLBackendRegistry, ProjectMLBackend)
            .outerjoin(
                ProjectMLBackend,
                (ProjectMLBackend.registry_id == MLBackendRegistry.id)
                & (ProjectMLBackend.project_id == project_id),
            )
            .order_by(MLBackendRegistry.created_at.desc())
        )
        return [(reg, assoc) for reg, assoc in result.all()]

    async def get_assoc(
        self, project_id: uuid.UUID, registry_id: uuid.UUID
    ) -> ProjectMLBackend | None:
        result = await self.db.execute(
            select(ProjectMLBackend).where(
                ProjectMLBackend.project_id == project_id,
                ProjectMLBackend.registry_id == registry_id,
            )
        )
        return result.scalar_one_or_none()

    async def is_enabled(self, project_id: uuid.UUID, registry_id: uuid.UUID) -> bool:
        assoc = await self.get_assoc(project_id, registry_id)
        return bool(assoc and assoc.enabled)

    async def set_enabled(
        self,
        project_id: uuid.UUID,
        registry_id: uuid.UUID,
        enabled: bool,
        **overrides,
    ) -> ProjectMLBackend:
        """切换项目启用 + 写项目级变体覆盖 (default_variants)。"""
        assoc = await self.get_assoc(project_id, registry_id)
        if assoc is None:
            assoc = ProjectMLBackend(
                id=uuid.uuid4(),
                project_id=project_id,
                registry_id=registry_id,
                enabled=enabled,
            )
            self.db.add(assoc)
        else:
            assoc.enabled = enabled
        for key in ("default_variants",):
            if key in overrides:
                setattr(assoc, key, overrides[key])
        await self.db.flush()
        return assoc

    # ── client 操作 (按 registry id) ─────────────────────────────────────────
    async def unload(self, registry_id: uuid.UUID) -> dict | None:
        backend = await self.get(registry_id)
        if not backend:
            return None
        # 远程调用前释放只读事务连接，避免 shadow 短会话与请求会话互相挤占池。
        await self.db.commit()
        return await MLBackendClient(
            backend, shadow_session_factory=self.shadow_session_factory
        ).unload()

    async def reload(
        self,
        registry_id: uuid.UUID,
        sam_variant: str | None = None,
        dino_variant: str | None = None,
        task_type: str | None = None,
    ) -> dict | None:
        backend = await self.get(registry_id)
        if not backend:
            return None
        await self.db.commit()
        return await MLBackendClient(
            backend, shadow_session_factory=self.shadow_session_factory
        ).reload(
            sam_variant=sam_variant, dino_variant=dino_variant, task_type=task_type
        )

    async def warmup(self, registry_id: uuid.UUID, body: dict) -> dict | None:
        """协议 §4.4 · 转发 /warmup. body 原样上抛 backend, 各 backend schema 不同."""
        backend = await self.get(registry_id)
        if not backend:
            return None
        await self.db.commit()
        return await MLBackendClient(
            backend, shadow_session_factory=self.shadow_session_factory
        ).warmup(body)

    async def check_health(self, registry_id: uuid.UUID) -> bool:
        backend = await self.get(registry_id)
        if not backend:
            return False
        requested_url = backend.url
        requested_auth_method = backend.auth_method
        requested_auth_token = backend.auth_token
        requested_gpu_resource_id = backend.gpu_resource_id
        requested_membership_epoch: int | None = None
        requested_membership_state: str | None = None
        gpu_health_challenge: str | None = None
        probe_started_at: datetime | None = None
        if requested_gpu_resource_id is not None:
            requested_membership = (
                await self.db.execute(
                    select(
                        GPUBackendMembership.membership_epoch,
                        GPUBackendMembership.state,
                    ).where(
                        GPUBackendMembership.backend_registry_id == registry_id,
                        GPUBackendMembership.gpu_resource_id
                        == requested_gpu_resource_id,
                        GPUBackendMembership.state.in_(("pending", "active")),
                    )
                )
            ).one_or_none()
            if requested_membership is None:
                return False
            requested_membership_epoch = requested_membership.membership_epoch
            requested_membership_state = requested_membership.state
            gpu_health_challenge = secrets.token_hex(32)
            probe_started_at = await self.db.scalar(select(func.clock_timestamp()))
            if probe_started_at is None:
                return False
        client = MLBackendClient(backend)
        # v0.9.6 · 用 health_meta 一次性拉 ok + meta, 把深度指标缓存到全局注册行
        if gpu_health_challenge is None:
            healthy, meta = await client.health_meta()
        else:
            healthy, meta = await client.health_meta(
                gpu_health_challenge=gpu_health_challenge
            )
        echoed_challenge: str | None = None
        if meta is not None:
            meta = dict(meta)
            echoed = meta.pop(GPU_HEALTH_CHALLENGE_ECHO_MARKER, None)
            if isinstance(echoed, str):
                echoed_challenge = echoed
        # A failed or metadata-free probe invalidates the previous device/identity
        # snapshot.  Keeping it would let stale CPU/UUID evidence pass GPU diagnostics.
        next_health_meta = None
        next_is_interactive: bool | None = None
        caps: dict | None = None
        if healthy and meta is not None:
            # v0.10.37 · 顺带探 /setup, 把能力快照落进 health_meta["capabilities"]。
            from app.services.ml_capabilities import extract_capabilities

            try:
                caps = extract_capabilities(await client.setup())
            except Exception:
                caps = None

        # GPU proof binds the complete /health + /setup observation window.  A
        # timestamp captured before setup could authorize a capability that was
        # never observed within the challenge's evidence interval.
        observed_at = await self.db.scalar(select(func.clock_timestamp()))
        if observed_at is None:
            return False
        if observed_at.tzinfo is None or observed_at.utcoffset() is None:
            return False
        if probe_started_at is not None and (
            probe_started_at.tzinfo is None
            or probe_started_at.utcoffset() is None
            or observed_at <= probe_started_at
        ):
            return False

        if healthy and meta is not None:
            managed_lifecycle_sha256: str | None = None
            if caps is not None:
                meta = {**meta, "capabilities": caps}
                # is_interactive 改派生对账: 以 /setup 自报为真值
                next_is_interactive = caps["is_interactive"]
                managed_lifecycle = caps.get("managed_lifecycle")
                if managed_lifecycle is not None:
                    managed_lifecycle_sha256 = managed_lifecycle_capability_sha256(
                        managed_lifecycle
                    )
            if (
                gpu_health_challenge is not None
                and echoed_challenge == gpu_health_challenge
                and probe_started_at is not None
                and requested_membership_epoch is not None
                and requested_membership_state is not None
            ):
                meta["gpu_arbiter_probe"] = {
                    "protocol_version": "1",
                    "challenge": gpu_health_challenge,
                    "backend_registry_id": str(registry_id),
                    "gpu_resource_id": requested_gpu_resource_id,
                    "membership_epoch": str(requested_membership_epoch),
                    "membership_state": requested_membership_state,
                    "managed_lifecycle_sha256": managed_lifecycle_sha256,
                    "probe_started_at": _proof_timestamp(probe_started_at),
                    "observed_at": _proof_timestamp(observed_at),
                }
            next_health_meta = meta

        values: dict = {
            "state": "connected" if healthy else "error",
            "last_checked_at": observed_at,
            "health_meta": next_health_meta,
        }
        if next_is_interactive is not None:
            values["is_interactive"] = next_is_interactive
        current_backend = await self.db.scalar(
            select(MLBackendRegistry)
            .where(MLBackendRegistry.id == registry_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if current_backend is None or (
            current_backend.url != requested_url
            or current_backend.auth_method != requested_auth_method
            or current_backend.auth_token != requested_auth_token
            or current_backend.gpu_resource_id != requested_gpu_resource_id
        ):
            return False
        if requested_membership_epoch is not None:
            # Keep registry -> resource -> try-global -> membership ordering.
            # Promotion uses the same resource -> try-global prefix; neither side
            # waits on the global barrier while holding a card lock.
            await self.db.execute(
                text(
                    "SELECT pg_advisory_xact_lock("
                    "hashtextextended('aap:gpu-resource:' || :resource_id, 0))"
                ),
                {"resource_id": requested_gpu_resource_id},
            )
            promotion_barrier_acquired = await self.db.scalar(
                text(
                    "SELECT pg_try_advisory_xact_lock("
                    "hashtextextended('aap:gpu-membership-promotion', 0))"
                )
            )
            if promotion_barrier_acquired is not True:
                return False
        # A slow /setup must not let an older /health response borrow a later
        # completion timestamp and overwrite a concurrently committed snapshot.
        # For GPU probes, first-committer-wins across overlapping observation
        # windows; a later periodic probe will refresh any conservatively dropped
        # evidence.  Non-GPU checks retain monotonic completion ordering.
        commit_order_floor = probe_started_at or observed_at
        if current_backend.last_checked_at is not None and (
            current_backend.last_checked_at.tzinfo is None
            or current_backend.last_checked_at.utcoffset() is None
            or current_backend.last_checked_at >= commit_order_floor
        ):
            return False
        if requested_membership_epoch is not None:
            current_membership = (
                await self.db.execute(
                    select(
                        GPUBackendMembership.membership_epoch,
                        GPUBackendMembership.state,
                    )
                    .where(
                        GPUBackendMembership.backend_registry_id == registry_id,
                        GPUBackendMembership.gpu_resource_id
                        == requested_gpu_resource_id,
                        GPUBackendMembership.state.in_(("pending", "active")),
                    )
                    .with_for_update()
                )
            ).one_or_none()
            if (
                current_membership is None
                or current_membership.membership_epoch != requested_membership_epoch
                or current_membership.state != requested_membership_state
            ):
                return False
        result = await self.db.execute(
            update(MLBackendRegistry)
            .where(MLBackendRegistry.id == registry_id)
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        # The post-probe row lock and membership recheck form the commit-time fence
        # without holding a DB lock across the backend network call.
        if result.rowcount != 1:
            await self.db.refresh(backend)
            return False
        await self.db.refresh(backend)
        return healthy

    async def get_interactive_backend(
        self, project_id: uuid.UUID
    ) -> MLBackendRegistry | None:
        """该项目已启用且 is_interactive 的 connected backend。"""
        result = await self.db.execute(
            select(MLBackendRegistry)
            .join(
                ProjectMLBackend,
                ProjectMLBackend.registry_id == MLBackendRegistry.id,
            )
            .where(
                ProjectMLBackend.project_id == project_id,
                ProjectMLBackend.enabled.is_(True),
                MLBackendRegistry.is_interactive.is_(True),
                MLBackendRegistry.state == "connected",
            )
        )
        return result.scalars().first()

    async def get_project_backend(
        self, project_id: uuid.UUID
    ) -> MLBackendRegistry | None:
        """优先返回 project.ml_backend_id 显式绑定(且项目已启用)，否则 fallback 交互式。"""
        proj = await self.db.get(Project, project_id)
        if proj is not None and proj.ml_backend_id is not None:
            if await self.is_enabled(project_id, proj.ml_backend_id):
                backend = await self.get(proj.ml_backend_id)
                if backend is not None:
                    return backend
        return await self.get_interactive_backend(project_id)

    async def get_tracker_backend(
        self, project_id: uuid.UUID, model_key: str
    ) -> MLBackendRegistry | None:
        return await self.get_tracker_backend_for_capabilities(project_id, [model_key])

    async def get_tracker_backend_for_capabilities(
        self, project_id: uuid.UUID, model_keys: list[str]
    ) -> MLBackendRegistry | None:
        """选择同时支持全部 tracker 能力的已连接项目后端。

        绑定优先（项目显式绑定的 backend 若支持全部 tracker 则用它），否则取首个 connected 的。
        与 `get_project_backend` 的区别：后者只按「单一绑定 / 交互 fallback」选、不看 tracker——
        一项目同时启用多个 tracker-capable backend 时（如 grounded-sam2[sam2_video] +
        sam3-backend[sam3_video]），会把所有 tracker（含 sam3_video）都发给绑定那个，导致
        sam3_video 静默落到 sam2。本方法按 `health_meta.capabilities.supported_trackers`
        路由，消除该错配。

        返回 None：没有已启用且 connected 的 backend 同时声明全部能力。组合追踪因此不会把
        发现与传播错误拼到两个不同后端，也不会把任务排队后才因断连失败。
        """

        required = set(model_keys)
        if not required:
            return None

        def _supports(backend: MLBackendRegistry) -> bool:
            caps = (backend.health_meta or {}).get("capabilities") or {}
            return required.issubset(set(caps.get("supported_trackers") or []))

        supporting = [
            b
            for b in await self.list_enabled_for_project(project_id)
            if b.state == "connected" and _supports(b)
        ]
        if not supporting:
            return None
        proj = await self.db.get(Project, project_id)
        bound_id = proj.ml_backend_id if proj is not None else None
        if bound_id is not None:
            for b in supporting:
                if b.id == bound_id:
                    return b
        return supporting[0]
