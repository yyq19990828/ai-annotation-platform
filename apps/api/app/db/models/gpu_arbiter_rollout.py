import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GPUArbiterRollout(Base):
    """Durable effective-mode state for one physical GPU resource."""

    __tablename__ = "gpu_arbiter_rollouts"
    __table_args__ = (
        CheckConstraint(
            "gpu_resource_id = btrim(gpu_resource_id) AND "
            "gpu_resource_id !~ '[[:space:],]' AND "
            "position('/' in gpu_resource_id) > 1 AND "
            "position('/' in gpu_resource_id) < char_length(gpu_resource_id)",
            name="ck_gpu_arbiter_rollouts_resource_id",
        ),
        CheckConstraint(
            "state IN ('off', 'promoting', 'enforcing', 'demoting', 'blocked')",
            name="ck_gpu_arbiter_rollouts_state",
        ),
        CheckConstraint(
            "effective_mode IN ('off', 'enforce')",
            name="ck_gpu_arbiter_rollouts_effective_mode",
        ),
        CheckConstraint(
            "target_mode IN ('off', 'observe', 'enforce')",
            name="ck_gpu_arbiter_rollouts_target_mode",
        ),
        CheckConstraint(
            "revision > 0",
            name="ck_gpu_arbiter_rollouts_revision_positive",
        ),
        CheckConstraint(
            "(state = 'off' AND effective_mode = 'off' "
            "AND target_mode IN ('off', 'observe') "
            "AND transition_id IS NULL AND transition_started_at IS NULL "
            "AND blocker_reason IS NULL) OR "
            "(state = 'promoting' AND effective_mode = 'off' "
            "AND target_mode = 'enforce' "
            "AND transition_id IS NOT NULL AND transition_started_at IS NOT NULL "
            "AND blocker_reason IS NULL) OR "
            "(state = 'enforcing' AND effective_mode = 'enforce' "
            "AND target_mode = 'enforce' "
            "AND transition_id IS NULL AND transition_started_at IS NULL "
            "AND blocker_reason IS NULL) OR "
            "(state = 'demoting' AND effective_mode = 'enforce' "
            "AND target_mode IN ('off', 'observe') "
            "AND transition_id IS NOT NULL AND transition_started_at IS NOT NULL "
            "AND blocker_reason IS NULL) OR "
            "(state = 'blocked' AND transition_id IS NOT NULL "
            "AND transition_started_at IS NOT NULL "
            "AND blocker_reason IS NOT NULL AND blocker_reason <> '')",
            name="ck_gpu_arbiter_rollouts_state_shape",
        ),
    )

    gpu_resource_id: Mapped[str] = mapped_column(String(512), primary_key=True)
    state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="off", server_default="off"
    )
    effective_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="off", server_default="off"
    )
    target_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="off", server_default="off"
    )
    transition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    last_transition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    transition_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    blocker_reason: Mapped[str | None] = mapped_column(String(256), nullable=True)
    revision: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=1, server_default="1"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
