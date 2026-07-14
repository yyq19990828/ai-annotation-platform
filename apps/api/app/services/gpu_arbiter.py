"""ADR-0049 static GPU claim validation and read-only L1 diagnostics.

This module deliberately has no Redis access and performs no admission, eviction, or
backend calls.  P2 uses it as the typed configuration boundary; the runtime ledger is
added in P3 without changing the meaning of these static claims.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from app.config import Settings, settings
from app.schemas.ml_backend import GPUBackendConfigStatus, GPUConfigDiagnostic
from app.utils.gpu_resource import validate_gpu_resource_id


_LEVEL_ORDER = {
    "ok": 0,
    "info": 1,
    "warning": 2,
    "critical": 3,
    "blocker": 4,
}

# P2a only exposes desired state and static diagnostics.  Runtime mode stays off
# until observe dispatch integration (P2b) or the fenced ledger/gate handshake
# (P3/P4) is actually present.
_RUNTIME_MODE = "off"
# The durable health poll runs once per minute.  Three missed polls make cached
# device/identity evidence untrusted for static diagnostics; stale data remains
# visible in health_meta but is never used to prove CPU-only or physical identity.
_HEALTH_EVIDENCE_MAX_AGE = timedelta(minutes=3)
_HEALTH_EVIDENCE_FUTURE_SKEW = timedelta(minutes=1)


class GPUClaimConfigurationError(ValueError):
    """A registry claim cannot be represented safely by current resource config."""

    def __init__(self, diagnostics: list[GPUConfigDiagnostic]) -> None:
        self.diagnostics = diagnostics
        message = diagnostics[0].message if diagnostics else "GPU 资源配置无效"
        super().__init__(message)


def _diag(
    code: str,
    level: str,
    message: str,
    *,
    field: str | None = None,
    resource_id: str | None = None,
    backend_id: Any = None,
) -> GPUConfigDiagnostic:
    return GPUConfigDiagnostic(
        code=code,
        level=level,
        message=message,
        field=field,
        resource_id=resource_id,
        backend_id=backend_id,
    )


def _claim_shape_diagnostics(
    gpu_resource_id: str | None,
    vram_budget_mb: int | None,
    *,
    backend_id: Any = None,
) -> list[GPUConfigDiagnostic]:
    diagnostics: list[GPUConfigDiagnostic] = []
    if (gpu_resource_id is None) != (vram_budget_mb is None):
        diagnostics.append(
            _diag(
                "gpu_claim_incomplete",
                "blocker",
                "gpu_resource_id 与 vram_budget_mb 必须同时设置或同时为 null",
                field="gpu_resource_id",
                resource_id=gpu_resource_id,
                backend_id=backend_id,
            )
        )
    if gpu_resource_id is not None:
        try:
            validate_gpu_resource_id(gpu_resource_id)
        except ValueError as exc:
            diagnostics.append(
                _diag(
                    "gpu_resource_id_invalid",
                    "blocker",
                    str(exc),
                    field="gpu_resource_id",
                    resource_id=gpu_resource_id,
                    backend_id=backend_id,
                )
            )
    if vram_budget_mb is not None and (
        isinstance(vram_budget_mb, bool)
        or not isinstance(vram_budget_mb, int)
        or vram_budget_mb <= 0
    ):
        diagnostics.append(
            _diag(
                "vram_budget_invalid",
                "blocker",
                "vram_budget_mb 必须是正整数 MiB",
                field="vram_budget_mb",
                resource_id=gpu_resource_id,
                backend_id=backend_id,
            )
        )
    return diagnostics


def validate_gpu_claim(
    gpu_resource_id: str | None,
    vram_budget_mb: int | None,
    *,
    config: Settings = settings,
) -> None:
    """Reject only per-backend blockers; aggregate oversubscription stays a warning."""

    diagnostics = _claim_shape_diagnostics(gpu_resource_id, vram_budget_mb)
    if gpu_resource_id is not None and not diagnostics:
        resource = config.gpu_arbiter_resources.get(gpu_resource_id)
        if config.gpu_arbiter_config_errors:
            diagnostics.append(
                _diag(
                    "gpu_resources_config_invalid",
                    "blocker",
                    "GPU_ARBITER_RESOURCES_JSON 无法解析："
                    f"{config.gpu_arbiter_config_errors[0]}",
                    field="gpu_resource_id",
                    resource_id=gpu_resource_id,
                )
            )
        elif resource is None:
            diagnostics.append(
                _diag(
                    "gpu_resource_unknown",
                    "blocker",
                    f"未在 GPU_ARBITER_RESOURCES_JSON 中找到 {gpu_resource_id}",
                    field="gpu_resource_id",
                    resource_id=gpu_resource_id,
                )
            )
        elif vram_budget_mb is not None and vram_budget_mb > resource.allocatable_mb:
            diagnostics.append(
                _diag(
                    "vram_budget_exceeds_allocatable",
                    "blocker",
                    f"预算 {vram_budget_mb} MiB 超过该资源可分配容量 "
                    f"{resource.allocatable_mb} MiB",
                    field="vram_budget_mb",
                    resource_id=gpu_resource_id,
                )
            )
    if diagnostics:
        raise GPUClaimConfigurationError(diagnostics)


def claimed_budget_by_resource(backends: Iterable[Any]) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for backend in backends:
        resource_id = getattr(backend, "gpu_resource_id", None)
        budget = getattr(backend, "vram_budget_mb", None)
        if resource_id is not None and isinstance(budget, int) and not isinstance(budget, bool):
            totals[resource_id] += budget
    return dict(totals)


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _trusted_health_meta(backend: Any) -> Mapping[str, Any]:
    if getattr(backend, "state", None) != "connected":
        return {}
    checked_at = getattr(backend, "last_checked_at", None)
    if not isinstance(checked_at, datetime) or checked_at.tzinfo is None:
        return {}
    age = datetime.now(UTC) - checked_at.astimezone(UTC)
    if age > _HEALTH_EVIDENCE_MAX_AGE or age < -_HEALTH_EVIDENCE_FUTURE_SKEW:
        return {}
    return _as_mapping(getattr(backend, "health_meta", None))


def _requires_gpu_claim(health_meta: Mapping[str, Any]) -> bool:
    compute = _as_mapping(health_meta.get("compute"))
    configured = compute.get("configured_device")
    configured = configured.strip().lower() if isinstance(configured, str) else None
    effective = compute.get("effective_device")
    effective = effective.strip().lower() if isinstance(effective, str) else None
    provider = compute.get("effective_provider")
    provider = provider.strip().lower() if isinstance(provider, str) else None
    capabilities = _as_mapping(health_meta.get("capabilities"))
    infra = capabilities.get("infra")
    infra = infra.strip().lower() if isinstance(infra, str) else None
    residency = _as_mapping(health_meta.get("residency"))
    return bool(
        configured == "gpu"
        or (configured and configured.startswith("cuda"))
        or (effective and effective.startswith("cuda"))
        or (provider and ("cuda" in provider or "tensorrt" in provider))
        or infra == "gpu"
        or residency.get("gpu_loaded") is True
    )


def _is_explicit_cpu_backend(
    health_meta: Mapping[str, Any], *, requires_gpu_claim: bool
) -> bool:
    compute = _as_mapping(health_meta.get("compute"))
    configured = compute.get("configured_device")
    return (
        isinstance(configured, str)
        and configured.strip().lower() == "cpu"
        and not requires_gpu_claim
    )


def _identity_diagnostic(
    backend: Any,
    physical_token: str,
    health_meta: Mapping[str, Any],
) -> GPUConfigDiagnostic | None:
    gpu_info = _as_mapping(health_meta.get("gpu_info"))
    observed: str | int | None = None
    expected: str | int = physical_token
    if physical_token.startswith("MIG-"):
        observed = gpu_info.get("mig_uuid") or gpu_info.get("physical_device_token")
    elif physical_token.startswith("GPU-"):
        observed = gpu_info.get("device_uuid") or gpu_info.get("physical_device_token")
    elif physical_token.startswith("index:"):
        try:
            expected = int(physical_token.removeprefix("index:"))
        except ValueError:
            return None
        observed = gpu_info.get("device_index")
    if observed is None:
        return _diag(
            "gpu_identity_unverified",
            "warning",
            f"backend 尚未上报可与 {physical_token} 对账的物理设备标识",
            field="gpu_resource_id",
            resource_id=getattr(backend, "gpu_resource_id", None),
            backend_id=getattr(backend, "id", None),
        )
    if observed == expected:
        return None
    return _diag(
        "gpu_identity_mismatch",
        "blocker",
        f"观测到的物理设备 {observed} 与声明 {physical_token} 不一致",
        field="gpu_resource_id",
        resource_id=getattr(backend, "gpu_resource_id", None),
        backend_id=getattr(backend, "id", None),
    )


def build_backend_gpu_config_status(
    backend: Any,
    totals: dict[str, int],
    *,
    config: Settings = settings,
) -> GPUBackendConfigStatus:
    resource_id = getattr(backend, "gpu_resource_id", None)
    budget = getattr(backend, "vram_budget_mb", None)
    backend_id = getattr(backend, "id", None)
    diagnostics = _claim_shape_diagnostics(
        resource_id, budget, backend_id=backend_id
    )
    allocatable: int | None = None
    desired_mode = config.gpu_arbiter_desired_mode(resource_id or "").value
    health_meta = _trusted_health_meta(backend)
    requires_gpu_claim = _requires_gpu_claim(health_meta)

    if resource_id is None and budget is None:
        if requires_gpu_claim:
            diagnostics.append(
                _diag(
                    "gpu_claim_missing",
                    "blocker",
                    "backend 配置使用 GPU，但尚未声明物理资源与显存预算",
                    field="gpu_resource_id",
                    backend_id=backend_id,
                )
            )
        elif _is_explicit_cpu_backend(
            health_meta, requires_gpu_claim=requires_gpu_claim
        ):
            diagnostics.append(
                _diag(
                    "explicit_cpu_backend",
                    "info",
                    "backend 显式配置为 CPU，无需声明 GPU 资源",
                    field="gpu_resource_id",
                    backend_id=backend_id,
                )
            )
        else:
            diagnostics.append(
                _diag(
                    "gpu_claim_unknown",
                    "blocker",
                    "backend 未显式证明为 CPU，必须声明 GPU 资源或先完成设备探测",
                    field="gpu_resource_id",
                    backend_id=backend_id,
                )
            )
    elif resource_id is not None and not diagnostics:
        resource = config.gpu_arbiter_resources.get(resource_id)
        if config.gpu_arbiter_config_errors:
            diagnostics.append(
                _diag(
                    "gpu_resources_config_invalid",
                    "blocker",
                    "GPU_ARBITER_RESOURCES_JSON 无法解析："
                    f"{config.gpu_arbiter_config_errors[0]}",
                    field="gpu_resource_id",
                    resource_id=resource_id,
                    backend_id=backend_id,
                )
            )
        elif resource is None:
            diagnostics.append(
                _diag(
                    "gpu_resource_unknown",
                    "blocker",
                    f"未在 GPU_ARBITER_RESOURCES_JSON 中找到 {resource_id}",
                    field="gpu_resource_id",
                    resource_id=resource_id,
                    backend_id=backend_id,
                )
            )
        else:
            allocatable = resource.allocatable_mb
            if budget is not None and budget > allocatable:
                diagnostics.append(
                    _diag(
                        "vram_budget_exceeds_allocatable",
                        "blocker",
                        f"预算 {budget} MiB 超过该资源可分配容量 "
                        f"{allocatable} MiB",
                        field="vram_budget_mb",
                        resource_id=resource_id,
                        backend_id=backend_id,
                    )
                )
            elif totals.get(resource_id, 0) > allocatable:
                diagnostics.append(
                    _diag(
                        "gpu_resource_oversubscribed",
                        "warning",
                        f"同卡静态预算合计 {totals[resource_id]} MiB 超过可分配容量 "
                        f"{allocatable} MiB；这是允许驱逐的弹性超售",
                        resource_id=resource_id,
                        backend_id=backend_id,
                    )
                )
            identity = _identity_diagnostic(
                backend, resource.physical_device_token, health_meta
            )
            if identity is not None:
                diagnostics.append(identity)
            if desired_mode != "off":
                diagnostics.append(
                    _diag(
                        "gpu_arbiter_runtime_not_ready",
                        "blocker" if desired_mode == "enforce" else "warning",
                        f"GPU 仲裁期望模式为 {desired_mode}，但运行时握手尚未就绪；"
                        "实际模式保持 off",
                        resource_id=resource_id,
                        backend_id=backend_id,
                    )
                )

    status = "ok"
    for diagnostic in diagnostics:
        if _LEVEL_ORDER[diagnostic.level] > _LEVEL_ORDER[status]:
            status = diagnostic.level
    return GPUBackendConfigStatus(
        status=status,
        desired_mode=desired_mode,
        effective_mode=_RUNTIME_MODE,
        allocatable_mb=allocatable,
        resource_claimed_budget_mb=totals.get(resource_id) if resource_id else None,
        diagnostics=diagnostics,
    )


def build_resource_summaries(
    backends: Iterable[Any], *, config: Settings = settings
) -> tuple[list[dict[str, Any]], list[GPUConfigDiagnostic]]:
    backend_rows = list(backends)
    totals = claimed_budget_by_resource(backend_rows)
    claim_counts: dict[str, int] = defaultdict(int)
    for backend in backend_rows:
        resource_id = getattr(backend, "gpu_resource_id", None)
        if resource_id:
            claim_counts[resource_id] += 1

    summaries: list[dict[str, Any]] = []
    diagnostics: list[GPUConfigDiagnostic] = [
        _diag(
            "gpu_resources_config_invalid",
            "blocker",
            f"GPU_ARBITER_RESOURCES_JSON 无法解析：{error}",
            field="gpu_arbiter_resources_json",
        )
        for error in config.gpu_arbiter_config_errors
    ]
    for resource_id, resource in sorted(config.gpu_arbiter_resources.items()):
        resource_diagnostics: list[GPUConfigDiagnostic] = []
        total = totals.get(resource_id, 0)
        if total > resource.allocatable_mb:
            resource_diagnostics.append(
                _diag(
                    "gpu_resource_oversubscribed",
                    "warning",
                    f"静态预算合计 {total} MiB 超过可分配容量 "
                    f"{resource.allocatable_mb} MiB",
                    resource_id=resource_id,
                )
            )
        if config.gpu_arbiter_mode.value != "off" and resource.mode is None:
            resource_diagnostics.append(
                _diag(
                    "gpu_resource_mode_missing",
                    "info",
                    "资源未显式声明 mode，有效模式安全保持 off",
                    resource_id=resource_id,
                )
            )
        desired_mode = config.gpu_arbiter_desired_mode(resource_id).value
        if desired_mode != "off":
            resource_diagnostics.append(
                _diag(
                    "gpu_arbiter_runtime_not_ready",
                    "blocker" if desired_mode == "enforce" else "warning",
                    f"GPU 仲裁期望模式为 {desired_mode}，但运行时握手尚未就绪；"
                    "实际模式保持 off",
                    resource_id=resource_id,
                )
            )
        status = "ok"
        for diagnostic in resource_diagnostics:
            if _LEVEL_ORDER[diagnostic.level] > _LEVEL_ORDER[status]:
                status = diagnostic.level
        diagnostics.extend(resource_diagnostics)
        summaries.append(
            {
                "gpu_resource_id": resource_id,
                "node_id": resource.node_id,
                "physical_device_token": resource.physical_device_token,
                "allocatable_mb": resource.allocatable_mb,
                "configured_mode": resource.mode.value if resource.mode else None,
                "desired_mode": desired_mode,
                "effective_mode": _RUNTIME_MODE,
                "claimed_budget_mb": total,
                "claimed_backend_count": claim_counts.get(resource_id, 0),
                "status": status,
                "diagnostics": resource_diagnostics,
            }
        )

    for backend in backend_rows:
        status = build_backend_gpu_config_status(backend, totals, config=config)
        diagnostics.extend(
            diagnostic
            for diagnostic in status.diagnostics
            if diagnostic.code != "gpu_resource_oversubscribed"
        )
    return summaries, diagnostics
