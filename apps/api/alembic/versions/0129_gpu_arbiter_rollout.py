"""Add durable per-resource GPU arbiter rollout state.

Revision ID: 0129
Revises: 0128
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0129"
down_revision = "0128"
branch_labels = None
depends_on = None


_ROLLOUT_TRIGGER = """
CREATE OR REPLACE FUNCTION validate_gpu_arbiter_rollout()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'GPU rollout rows are durable and cannot be deleted'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_arbiter_rollout_delete_forbidden';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.state <> 'off'
           OR NEW.effective_mode <> 'off'
           OR NEW.target_mode NOT IN ('off', 'observe')
           OR NEW.last_transition_id IS NOT NULL
           OR NEW.revision <> 1 THEN
            RAISE EXCEPTION 'new GPU rollout must start settled off at revision one'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_arbiter_rollout_initial_state';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.gpu_resource_id IS DISTINCT FROM OLD.gpu_resource_id THEN
        RAISE EXCEPTION 'GPU rollout resource identity is immutable'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_arbiter_rollout_identity_immutable';
    END IF;
    IF NEW.revision <> OLD.revision + 1 THEN
        RAISE EXCEPTION 'GPU rollout revision must advance exactly once'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_arbiter_rollout_revision_transition';
    END IF;
    IF NEW.last_transition_id IS DISTINCT FROM OLD.last_transition_id
       AND NOT (
           OLD.state IN ('promoting', 'demoting')
           AND NEW.state IN ('enforcing', 'off')
           AND NEW.last_transition_id = OLD.transition_id
       ) THEN
        RAISE EXCEPTION 'GPU rollout completion identity is invalid'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_arbiter_rollout_completion_identity';
    END IF;
    IF NOT (
        (OLD.state = 'off' AND NEW.state IN ('off', 'promoting')) OR
        (OLD.state = 'promoting' AND NEW.state IN (
            'enforcing', 'demoting', 'blocked'
        )) OR
        (OLD.state = 'enforcing' AND NEW.state IN ('demoting', 'blocked')) OR
        (OLD.state = 'demoting' AND NEW.state IN (
            'off', 'enforcing', 'blocked'
        )) OR
        (OLD.state = 'blocked' AND NEW.state IN (
            'blocked', 'promoting', 'demoting'
        ))
    ) THEN
        RAISE EXCEPTION 'illegal GPU rollout state transition % -> %',
            OLD.state, NEW.state
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_arbiter_rollout_state_transition';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;
"""


def upgrade() -> None:
    op.create_table(
        "gpu_arbiter_rollouts",
        sa.Column("gpu_resource_id", sa.String(length=512), nullable=False),
        sa.Column(
            "state", sa.String(length=16), server_default="off", nullable=False
        ),
        sa.Column(
            "effective_mode",
            sa.String(length=16),
            server_default="off",
            nullable=False,
        ),
        sa.Column(
            "target_mode",
            sa.String(length=16),
            server_default="off",
            nullable=False,
        ),
        sa.Column(
            "transition_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column(
            "last_transition_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column("transition_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("blocker_reason", sa.String(length=256), nullable=True),
        sa.Column("revision", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "gpu_resource_id = btrim(gpu_resource_id) AND "
            "gpu_resource_id !~ '[[:space:],]' AND "
            "position('/' in gpu_resource_id) > 1 AND "
            "position('/' in gpu_resource_id) < char_length(gpu_resource_id)",
            name="ck_gpu_arbiter_rollouts_resource_id",
        ),
        sa.CheckConstraint(
            "state IN ('off', 'promoting', 'enforcing', 'demoting', 'blocked')",
            name="ck_gpu_arbiter_rollouts_state",
        ),
        sa.CheckConstraint(
            "effective_mode IN ('off', 'enforce')",
            name="ck_gpu_arbiter_rollouts_effective_mode",
        ),
        sa.CheckConstraint(
            "target_mode IN ('off', 'observe', 'enforce')",
            name="ck_gpu_arbiter_rollouts_target_mode",
        ),
        sa.CheckConstraint(
            "revision > 0",
            name="ck_gpu_arbiter_rollouts_revision_positive",
        ),
        sa.CheckConstraint(
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
        sa.PrimaryKeyConstraint("gpu_resource_id"),
    )
    op.execute(_ROLLOUT_TRIGGER)
    op.execute(
        """
        CREATE TRIGGER trg_validate_gpu_arbiter_rollout
        BEFORE INSERT OR UPDATE OR DELETE ON gpu_arbiter_rollouts
        FOR EACH ROW
        EXECUTE FUNCTION validate_gpu_arbiter_rollout()
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_validate_gpu_arbiter_rollout "
        "ON gpu_arbiter_rollouts"
    )
    op.execute("DROP FUNCTION IF EXISTS validate_gpu_arbiter_rollout()")
    op.drop_table("gpu_arbiter_rollouts")
