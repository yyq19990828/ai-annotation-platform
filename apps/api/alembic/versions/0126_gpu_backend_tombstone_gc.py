"""Authorize exact proof-backed GPU membership tombstone collection.

Revision ID: 0126
Revises: 0125

Redis is the runtime linearization point for child/domain collection. PostgreSQL
adds a non-reusable retirement identity and keeps rejecting ordinary membership
deletion; the collector may delete exactly one retiring identity only after setting
a transaction-local receipt while it still owns the resource advisory lock.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0126"
down_revision = "0125"
branch_labels = None
depends_on = None


_BASE_VALIDATION_FUNCTION = """
CREATE OR REPLACE FUNCTION validate_gpu_backend_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    registry_matches boolean := false;
    runtime_epoch bigint := NULL;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'GPU membership deletion requires proof-backed collection'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_backend_membership_delete_requires_gc';
    END IF;

    IF TG_OP = 'INSERT'
       AND (NEW.state <> 'pending' OR NEW.membership_epoch <> 1) THEN
        RAISE EXCEPTION 'new GPU membership must start pending at epoch one'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_backend_membership_epoch_transition';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.state = 'retiring' THEN
        RAISE EXCEPTION 'retired GPU membership evidence is immutable'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_backend_membership_tombstone_immutable';
    END IF;

    IF TG_OP = 'UPDATE'
       AND (
           NEW.backend_registry_id IS DISTINCT FROM OLD.backend_registry_id OR
           NEW.gpu_resource_id IS DISTINCT FROM OLD.gpu_resource_id
       ) THEN
        RAISE EXCEPTION 'GPU membership identity is immutable'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_backend_membership_identity_immutable';
    END IF;

    IF TG_OP = 'UPDATE' AND (
        NEW.membership_epoch < OLD.membership_epoch OR
        NEW.membership_epoch > OLD.membership_epoch + 1 OR
        (
            NEW.membership_epoch = OLD.membership_epoch + 1
            AND NOT (
                (OLD.state = 'pending' AND NEW.state = 'pending') OR
                (OLD.state <> 'retiring' AND NEW.state = 'retiring')
            )
        ) OR
        (
            NEW.membership_epoch = OLD.membership_epoch
            AND OLD.state <> 'retiring'
            AND NEW.state = 'retiring'
        )
    ) THEN
        RAISE EXCEPTION 'invalid GPU membership epoch transition'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_backend_membership_epoch_transition';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.state <> 'retiring'
       AND NEW.state = 'retiring' THEN
        SELECT EXISTS (
            SELECT 1
            FROM ml_backend_registry AS backend
            WHERE backend.id = OLD.backend_registry_id
              AND backend.gpu_resource_id = OLD.gpu_resource_id
        ) INTO registry_matches;
        IF registry_matches THEN
            RAISE EXCEPTION 'current GPU membership requires registry retirement'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_backend_membership_retirement_source';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.state = 'active'
       AND NEW.state NOT IN ('active', 'retiring') THEN
        RAISE EXCEPTION 'active GPU membership requires managed retirement'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_backend_membership_active_transition';
    END IF;

    IF NEW.state IN ('pending', 'active') THEN
        SELECT EXISTS (
            SELECT 1
            FROM ml_backend_registry AS backend
            WHERE backend.id = NEW.backend_registry_id
              AND backend.gpu_resource_id = NEW.gpu_resource_id
              AND backend.vram_budget_mb = NEW.vram_budget_mb
              AND backend.eviction_priority = NEW.eviction_priority
              AND NEW.max_concurrency = CASE
                  WHEN NOT (
                      COALESCE(backend.extra_params, '{}'::jsonb)
                      ? 'max_concurrency'
                  ) THEN 4
                  WHEN COALESCE(
                      backend.extra_params ->> 'max_concurrency', ''
                  ) ~ '^[1-9][0-9]{0,4}$' THEN CASE
                      WHEN (backend.extra_params ->> 'max_concurrency')::bigint
                               <= 10000
                      THEN (backend.extra_params ->> 'max_concurrency')::integer
                      ELSE NULL
                  END
                  ELSE NULL
              END
        ) INTO registry_matches;
        IF NOT registry_matches THEN
            RAISE EXCEPTION 'current GPU membership does not match registry claim'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_backend_membership_current_registry';
        END IF;

        SELECT runtime_epoch_high_water
        INTO runtime_epoch
        FROM gpu_backend_fences
        WHERE backend_registry_id = NEW.backend_registry_id;
        IF runtime_epoch IS NULL THEN
            RAISE EXCEPTION 'current GPU membership requires a durable fence'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_backend_membership_current_fence';
        END IF;

        IF NEW.state = 'pending'
           AND NEW.runtime_epoch_baseline <> runtime_epoch THEN
            RAISE EXCEPTION 'pending GPU membership baseline must match its fence'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_backend_membership_pending_runtime';
        END IF;

        IF NEW.state = 'active' THEN
            IF TG_OP = 'INSERT' THEN
                RAISE EXCEPTION 'active GPU membership requires runtime activation'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_gpu_backend_membership_active_runtime';
            END IF;
            IF NEW.runtime_epoch_baseline <> OLD.runtime_epoch_baseline
               OR runtime_epoch <= OLD.runtime_epoch_baseline
               OR (
                   OLD.state = 'pending'
                   AND runtime_epoch - OLD.runtime_epoch_baseline <> 1
               ) THEN
                RAISE EXCEPTION 'active GPU membership requires a durable runtime epoch'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_gpu_backend_membership_active_runtime';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
"""


_ORIGINAL_DELETE_GUARD = """    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'GPU membership deletion requires proof-backed collection'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_backend_membership_delete_requires_gc';
    END IF;
"""


_RETIREMENT_ID_FUNCTION = """
CREATE OR REPLACE FUNCTION assign_gpu_backend_retirement_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.state = 'retiring'
       AND OLD.state <> 'retiring' THEN
        IF NEW.retirement_id IS NOT NULL THEN
            RAISE EXCEPTION 'GPU retirement identity is collector-managed'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_backend_membership_retirement_id';
        END IF;
        NEW.retirement_id := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$;
"""


_GC_DELETE_GUARD = """    IF TG_OP = 'DELETE' THEN
        DECLARE
            receipt_raw text := current_setting(
                'app.gpu_tombstone_gc_receipt', true
            );
            receipt jsonb := NULL;
            resource_lock_key bigint := hashtextextended(
                'aap:gpu-resource:' || OLD.gpu_resource_id, 0
            );
            resource_lock_held boolean := false;
        BEGIN
            BEGIN
                receipt := NULLIF(receipt_raw, '')::jsonb;
            EXCEPTION WHEN OTHERS THEN
                receipt := NULL;
            END;
            SELECT EXISTS (
                SELECT 1
                FROM pg_locks
                WHERE locktype = 'advisory'
                  AND pid = pg_backend_pid()
                  AND granted
                  AND classid = (
                      (resource_lock_key >> 32) & 4294967295
                  )::oid
                  AND objid = (resource_lock_key & 4294967295)::oid
                  AND objsubid = 1
            ) INTO resource_lock_held;
            IF OLD.state <> 'retiring'
               OR OLD.retirement_id IS NULL
               OR NOT resource_lock_held
               OR receipt IS NULL
               OR jsonb_typeof(receipt) <> 'object'
               OR NOT receipt ?& ARRAY[
                   'backend_id', 'resource_id',
                   'membership_epoch', 'retirement_id', 'fingerprint'
               ]
               OR receipt - 'backend_id' - 'resource_id'
                    - 'membership_epoch' - 'retirement_id'
                    - 'fingerprint' <> '{}'::jsonb
               OR receipt ->> 'backend_id' <> OLD.backend_registry_id::text
               OR receipt ->> 'resource_id' <> OLD.gpu_resource_id
               OR receipt ->> 'membership_epoch' <> OLD.membership_epoch::text
               OR receipt ->> 'retirement_id' <> OLD.retirement_id::text
               OR COALESCE(receipt ->> 'fingerprint', '')
                    !~ '^[0-9a-f]{64}$'
               OR (
                   OLD.retired_token_expiry_high_water IS NOT NULL
                   AND clock_timestamp()
                       <= OLD.retired_token_expiry_high_water
               ) THEN
                RAISE EXCEPTION 'GPU membership deletion requires proof-backed collection'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_gpu_backend_membership_delete_requires_gc';
            END IF;
            RETURN OLD;
        END;
    END IF;
"""


_GC_VALIDATION_FUNCTION = _BASE_VALIDATION_FUNCTION.replace(
    _ORIGINAL_DELETE_GUARD,
    _GC_DELETE_GUARD,
)


def upgrade() -> None:
    op.add_column(
        "gpu_backend_memberships",
        sa.Column("retirement_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        "ALTER TABLE gpu_backend_memberships DISABLE TRIGGER "
        "trg_validate_gpu_backend_membership"
    )
    op.execute(
        """
        UPDATE gpu_backend_memberships
        SET retirement_id = gen_random_uuid()
        WHERE state = 'retiring'
          AND retirement_id IS NULL
        """
    )
    op.execute(
        "ALTER TABLE gpu_backend_memberships ENABLE TRIGGER "
        "trg_validate_gpu_backend_membership"
    )
    op.create_check_constraint(
        "ck_gpu_backend_memberships_retirement_id",
        "gpu_backend_memberships",
        "(state = 'retiring') = (retirement_id IS NOT NULL)",
    )
    op.execute(_RETIREMENT_ID_FUNCTION)
    op.execute(
        """
        CREATE TRIGGER trg_assign_gpu_backend_retirement_id
        BEFORE UPDATE ON gpu_backend_memberships
        FOR EACH ROW
        EXECUTE FUNCTION assign_gpu_backend_retirement_id()
        """
    )
    op.execute(_GC_VALIDATION_FUNCTION)


def downgrade() -> None:
    op.execute(_BASE_VALIDATION_FUNCTION)
    op.execute(
        "DROP TRIGGER IF EXISTS trg_assign_gpu_backend_retirement_id "
        "ON gpu_backend_memberships"
    )
    op.execute("DROP FUNCTION IF EXISTS assign_gpu_backend_retirement_id()")
    op.drop_constraint(
        "ck_gpu_backend_memberships_retirement_id",
        "gpu_backend_memberships",
        type_="check",
    )
    op.drop_column("gpu_backend_memberships", "retirement_id")
