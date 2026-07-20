"""v0.23.3 ADR-0050 §15 · topology + runtime-snapshot diagnostics for v0.23.4.

These read models are the contract v0.23.4's model-market UI consumes. They join
pool/member/registry/GPU/health by stable IDs (never by URL). topology is role-scoped
(Project Admin sees a trimmed view); runtime-snapshot is Super-Admin-only.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.ml_backend_pool import MLBackendPoolMember, MLBackendServicePool
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.services.ml_routing.ledger import RoutingLedger


async def build_topology(
    db: AsyncSession, *, super_admin: bool
) -> dict[str, Any]:
    """Pool/member/registry topology, role-scoped.

    Project Admin gets a trimmed view (pool summary + member count, no health/GPU
    internals); Super Admin gets the full member list with health + GPU state.
    """
    pools_q = await db.execute(
        select(MLBackendServicePool).order_by(MLBackendServicePool.created_at.desc())
    )
    pools = list(pools_q.scalars().all())
    result: dict[str, Any] = {
        "pools": [],
        "generated_at": datetime.now(UTC).isoformat(),
    }
    for pool in pools:
        members_q = await db.execute(
            select(MLBackendPoolMember, MLBackendRegistry)
            .join(
                MLBackendRegistry,
                MLBackendRegistry.id == MLBackendPoolMember.registry_id,
            )
            .where(MLBackendPoolMember.pool_id == pool.id)
            .order_by(MLBackendRegistry.name)
        )
        members = []
        for member, registry in members_q.all():
            entry: dict[str, Any] = {
                "registry_id": str(registry.id),
                "name": registry.name,
                "traffic_state": member.traffic_state,
                "weight": member.weight,
            }
            if super_admin:
                entry["state"] = registry.state
                entry["last_checked_at"] = (
                    registry.last_checked_at.isoformat()
                    if registry.last_checked_at
                    else None
                )
                entry["gpu_resource_id"] = registry.gpu_resource_id
            members.append(entry)
        pool_entry: dict[str, Any] = {
            "id": str(pool.id),
            "name": pool.name,
            "enabled": pool.enabled,
            "routing_policy": pool.routing_policy,
            "legacy_instance_id": str(pool.legacy_instance_id) if pool.legacy_instance_id else None,
            "routing_generation": pool.routing_generation,
            "capability_fingerprint": pool.capability_fingerprint,
            "member_count": len(members),
            "members": members,
        }
        result["pools"].append(pool_entry)
    return result


async def build_runtime_snapshot(
    db: AsyncSession, ledger: RoutingLedger | None
) -> dict[str, Any]:
    """Full runtime snapshot (Super Admin only): router mode + per-pool/member
    inflight / circuit / health / GPU summary + sources freshness + diagnostics."""
    mode = settings.ml_backend_router_mode
    pools_q = await db.execute(select(MLBackendServicePool))
    pools = list(pools_q.scalars().all())
    snapshot: dict[str, Any] = {
        "router_mode": mode,
        "generated_at": datetime.now(UTC).isoformat(),
        "pools": [],
    }
    now = datetime.now(UTC)
    max_age = timedelta(seconds=settings.ml_backend_router_health_max_age_seconds)
    for pool in pools:
        members_q = await db.execute(
            select(MLBackendPoolMember, MLBackendRegistry)
            .join(
                MLBackendRegistry,
                MLBackendRegistry.id == MLBackendPoolMember.registry_id,
            )
            .where(MLBackendPoolMember.pool_id == pool.id)
        )
        member_snapshots = []
        for member, registry in members_q.all():
            health_fresh = (
                registry.last_checked_at is not None
                and registry.last_checked_at >= now - max_age
            )
            # route inflight from Redis ledger (best-effort; observe mode may have no ledger)
            inflight = 0
            circuit_open = False
            if ledger is not None:
                try:
                    leases_key = (
                        f"{ledger.namespace}:pool:{pool.id}:member:{registry.id}:leases"
                    )

                    inflight = await ledger._redis.zcard(leases_key)
                    circuit = await ledger._redis.hgetall(
                        f"{ledger.namespace}:pool:{pool.id}:member:{registry.id}:circuit"
                    )
                    circuit_open = (
                        circuit.get("state") == "open"
                        and int(circuit.get("open_until", 0)) > int(datetime.now(UTC).timestamp() * 1000)
                    )
                except Exception:  # noqa: BLE001 — snapshot is best-effort
                    pass
            member_snapshots.append({
                "registry_id": str(registry.id),
                "name": registry.name,
                "traffic_state": member.traffic_state,
                "weight": member.weight,
                "registry_state": registry.state,
                "health_fresh": health_fresh,
                "last_checked_at": registry.last_checked_at.isoformat() if registry.last_checked_at else None,
                "route_inflight": inflight,
                "circuit_open": circuit_open,
                "gpu_resource_id": registry.gpu_resource_id,
            })
        snapshot["pools"].append({
            "id": str(pool.id),
            "name": pool.name,
            "enabled": pool.enabled,
            "routing_generation": pool.routing_generation,
            "members": member_snapshots,
        })
    return snapshot
