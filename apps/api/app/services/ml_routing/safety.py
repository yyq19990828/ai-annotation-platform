"""Authoritative fail-closed safety checks for destructive backend operations."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.ml_backend_pool import MLBackendPoolMember, MLBackendServicePool
from app.services.ml_routing.router import make_ledger_from_settings


class MLBackendQuiescenceError(Exception):
    def __init__(self, error_code: str, message: str, *, unavailable: bool = False) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.unavailable = unavailable

    def as_detail(self) -> dict[str, str]:
        return {"error_code": self.error_code, "message": str(self)}


async def require_registry_quiescent(
    db: AsyncSession, registry_id: uuid.UUID
) -> None:
    """Require enforce + draining + a fresh exact inflight=0 proof.

    Unpooled registries cannot receive service-pool leases and retain the legacy
    direct-unload behavior. Any uncertainty for a managed member blocks the action.
    """
    member = await db.scalar(
        select(MLBackendPoolMember).where(
            MLBackendPoolMember.registry_id == registry_id
        )
    )
    if member is None:
        return
    pool = await db.get(MLBackendServicePool, member.pool_id)
    if pool is None:
        raise MLBackendQuiescenceError(
            "ml_backend_pool_unavailable",
            "service-pool membership has no owning pool",
        )
    if settings.ml_backend_router_mode != "enforce":
        raise MLBackendQuiescenceError(
            "ml_backend_member_draining",
            "router must be in enforce mode before a managed backend can be unloaded",
        )
    if member.traffic_state != "draining":
        raise MLBackendQuiescenceError(
            "ml_backend_member_draining",
            "service-pool member must be draining before unload",
        )

    ledger = None
    try:
        ledger = make_ledger_from_settings()
        await ledger.healthcheck()
        inflight = await ledger.member_inflight(str(pool.id), str(registry_id))
    except Exception as exc:
        raise MLBackendQuiescenceError(
            "ml_backend_router_unavailable",
            "router ledger is unavailable; quiescence cannot be proven",
            unavailable=True,
        ) from exc
    finally:
        if ledger is not None:
            try:
                await ledger.aclose()
            except Exception:
                # Closing a client cannot invalidate an inflight proof that was
                # already read successfully, and must not mask the primary error.
                pass
    if inflight > 0:
        raise MLBackendQuiescenceError(
            "ml_backend_member_not_quiescent",
            f"service-pool member still has {inflight} active route lease(s)",
        )
