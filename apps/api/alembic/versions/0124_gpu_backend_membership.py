"""Add durable GPU resource membership and token-expiry fencing.

Revision ID: 0124
Revises: 0123

Membership rows deliberately outlive registry rows.  A database trigger records a
pending membership in the same transaction as a GPU claim, retires the old resource
before a claim disappears, and preserves the corresponding fence high-water marks.
Direct endpoint/claim mutation is rejected once a backend has entered a durable
runtime epoch; later stages must use the managed retirement workflow instead.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0124"
down_revision = "0123"
branch_labels = None
depends_on = None


_TRIGGER_FUNCTION = """
CREATE OR REPLACE FUNCTION sync_gpu_backend_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    new_max_concurrency integer := 4;
    runtime_epoch bigint := 0;
    fence_generation bigint := 0;
    fence_control_epoch bigint := 0;
    fence_token_expiry timestamptz := NULL;
    retirement_reason text := NULL;
    protected_changed boolean := true;
    affected_rows integer := 0;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        protected_changed := (
            OLD.gpu_resource_id IS DISTINCT FROM NEW.gpu_resource_id OR
            OLD.vram_budget_mb IS DISTINCT FROM NEW.vram_budget_mb OR
            OLD.eviction_priority IS DISTINCT FROM NEW.eviction_priority OR
            OLD.extra_params IS DISTINCT FROM NEW.extra_params OR
            OLD.url IS DISTINCT FROM NEW.url OR
            OLD.auth_method IS DISTINCT FROM NEW.auth_method OR
            OLD.auth_token IS DISTINCT FROM NEW.auth_token
        );
        IF NOT protected_changed THEN
            RETURN NEW;
        END IF;
    END IF;

    IF TG_OP <> 'INSERT' THEN
        IF OLD.gpu_resource_id IS NOT NULL THEN
            PERFORM 1
            FROM gpu_backend_memberships
            WHERE backend_registry_id = OLD.id
              AND gpu_resource_id = OLD.gpu_resource_id
              AND state IN ('pending', 'active')
            FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'current GPU membership is missing'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_gpu_backend_membership_current_missing';
            END IF;
        END IF;

        SELECT
            runtime_epoch_high_water,
            generation_high_water,
            control_epoch_high_water,
            token_expiry_high_water
        INTO
            runtime_epoch,
            fence_generation,
            fence_control_epoch,
            fence_token_expiry
        FROM gpu_backend_fences
        WHERE backend_registry_id = OLD.id
        FOR UPDATE;
        IF NOT FOUND THEN
            IF OLD.gpu_resource_id IS NOT NULL THEN
                RAISE EXCEPTION 'durable GPU fence is missing'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_gpu_backend_membership_fence_missing';
            END IF;
            runtime_epoch := 0;
            fence_generation := 0;
            fence_control_epoch := 0;
            fence_token_expiry := NULL;
        END IF;
    END IF;

    IF TG_OP <> 'DELETE' AND NEW.gpu_resource_id IS NOT NULL THEN
        IF NOT (COALESCE(NEW.extra_params, '{}'::jsonb) ? 'max_concurrency') THEN
            new_max_concurrency := 4;
        ELSIF COALESCE(NEW.extra_params ->> 'max_concurrency', '')
                  ~ '^[1-9][0-9]{0,4}$' THEN
            new_max_concurrency := (NEW.extra_params ->> 'max_concurrency')::integer;
            IF new_max_concurrency > 10000 THEN
                RAISE EXCEPTION 'max_concurrency must be an integer from 1 to 10000'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_gpu_backend_membership_max_concurrency';
            END IF;
        ELSE
            RAISE EXCEPTION 'max_concurrency must be an integer from 1 to 10000'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_backend_membership_max_concurrency';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF runtime_epoch > 0 THEN
            RAISE EXCEPTION 'managed GPU backend requires retirement before delete'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_backend_membership_managed_mutation';
        END IF;
        retirement_reason := 'registry_deleted';
    ELSIF TG_OP = 'UPDATE' THEN
        IF runtime_epoch > 0 THEN
            RAISE EXCEPTION 'managed GPU backend requires retirement before mutation'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_backend_membership_managed_mutation';
        END IF;
        IF OLD.gpu_resource_id IS DISTINCT FROM NEW.gpu_resource_id THEN
            retirement_reason := CASE
                WHEN NEW.gpu_resource_id IS NULL THEN 'claim_removed'
                ELSE 'resource_moved'
            END;
        END IF;
    END IF;

    IF TG_OP <> 'INSERT'
       AND OLD.gpu_resource_id IS NOT NULL
       AND (TG_OP = 'DELETE' OR OLD.gpu_resource_id IS DISTINCT FROM NEW.gpu_resource_id) THEN
        UPDATE gpu_backend_memberships
        SET state = 'retiring',
            membership_epoch = membership_epoch + 1,
            retired_at = clock_timestamp(),
            retire_reason = retirement_reason,
            retired_health_state = OLD.state,
            retired_health_meta = OLD.health_meta,
            retired_health_checked_at = OLD.last_checked_at,
            retired_generation_high_water = fence_generation,
            retired_control_epoch_high_water = fence_control_epoch,
            retired_runtime_epoch_high_water = runtime_epoch,
            retired_token_expiry_high_water = fence_token_expiry,
            updated_at = clock_timestamp()
        WHERE backend_registry_id = OLD.id
          AND gpu_resource_id = OLD.gpu_resource_id
          AND state IN ('pending', 'active');
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows <> 1 THEN
            RAISE EXCEPTION 'current GPU membership changed during retirement'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_gpu_backend_membership_retirement_race';
        END IF;
    END IF;

    IF TG_OP <> 'DELETE' AND NEW.gpu_resource_id IS NOT NULL THEN
        IF TG_OP = 'INSERT' OR OLD.gpu_resource_id IS NULL THEN
            INSERT INTO gpu_backend_fences (
                backend_registry_id,
                generation_high_water,
                control_epoch_high_water,
                runtime_epoch_high_water
            ) VALUES (NEW.id, 0, 0, 0)
            ON CONFLICT (backend_registry_id) DO NOTHING;
            IF TG_OP = 'INSERT' THEN
                SELECT
                    runtime_epoch_high_water,
                    generation_high_water,
                    control_epoch_high_water,
                    token_expiry_high_water
                INTO
                    runtime_epoch,
                    fence_generation,
                    fence_control_epoch,
                    fence_token_expiry
                FROM gpu_backend_fences
                WHERE backend_registry_id = NEW.id
                FOR UPDATE;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'durable GPU fence is missing'
                        USING ERRCODE = '23514',
                              CONSTRAINT = 'ck_gpu_backend_membership_fence_missing';
                END IF;
            END IF;
        END IF;

        IF TG_OP = 'INSERT'
           OR OLD.gpu_resource_id IS NULL
           OR OLD.gpu_resource_id IS DISTINCT FROM NEW.gpu_resource_id THEN
            INSERT INTO gpu_backend_memberships (
                backend_registry_id,
                gpu_resource_id,
                membership_epoch,
                runtime_epoch_baseline,
                state,
                vram_budget_mb,
                eviction_priority,
                max_concurrency
            ) VALUES (
                NEW.id,
                NEW.gpu_resource_id,
                1,
                runtime_epoch,
                'pending',
                NEW.vram_budget_mb,
                NEW.eviction_priority,
                new_max_concurrency
            )
            ON CONFLICT (backend_registry_id, gpu_resource_id) DO NOTHING;
            GET DIAGNOSTICS affected_rows = ROW_COUNT;
            IF affected_rows <> 1 THEN
                RAISE EXCEPTION 'retired GPU membership must be collected before resource re-entry'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_gpu_backend_membership_resource_reentry';
            END IF;
        ELSE
            UPDATE gpu_backend_memberships
            SET membership_epoch = membership_epoch + 1,
                runtime_epoch_baseline = runtime_epoch,
                state = 'pending',
                vram_budget_mb = NEW.vram_budget_mb,
                eviction_priority = NEW.eviction_priority,
                max_concurrency = new_max_concurrency,
                updated_at = clock_timestamp()
            WHERE backend_registry_id = NEW.id
              AND gpu_resource_id = NEW.gpu_resource_id
              AND state IN ('pending', 'active');
            GET DIAGNOSTICS affected_rows = ROW_COUNT;
            IF affected_rows <> 1 THEN
                RAISE EXCEPTION 'current GPU membership changed during configuration update'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_gpu_backend_membership_update_race';
            END IF;
        END IF;
    ELSIF TG_OP = 'DELETE' AND OLD.gpu_resource_id IS NULL THEN
        DELETE FROM gpu_backend_fences AS fence
        WHERE fence.backend_registry_id = OLD.id
          AND NOT EXISTS (
              SELECT 1
              FROM gpu_backend_memberships AS membership
              WHERE membership.backend_registry_id = OLD.id
          );
    END IF;

    IF TG_OP = 'UPDATE' THEN
        UPDATE ml_backend_registry
        SET state = 'disconnected',
            health_meta = NULL,
            last_checked_at = NULL,
            error_message = NULL
        WHERE id = NEW.id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
"""


_MEMBERSHIP_VALIDATION_FUNCTION = """
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


def upgrade() -> None:
    op.drop_constraint(
        "gpu_backend_fences_backend_registry_id_fkey",
        "gpu_backend_fences",
        type_="foreignkey",
    )
    op.add_column(
        "gpu_backend_fences",
        sa.Column(
            "runtime_epoch_high_water",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "gpu_backend_fences",
        sa.Column(
            "token_expiry_high_water",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "ck_gpu_backend_fences_runtime_epoch_nonnegative",
        "gpu_backend_fences",
        "runtime_epoch_high_water >= 0",
    )

    op.create_table(
        "gpu_backend_memberships",
        sa.Column(
            "backend_registry_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("gpu_resource_id", sa.String(length=512), nullable=False),
        sa.Column("membership_epoch", sa.BigInteger(), nullable=False),
        sa.Column(
            "runtime_epoch_baseline",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("vram_budget_mb", sa.Integer(), nullable=False),
        sa.Column(
            "eviction_priority", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("max_concurrency", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retire_reason", sa.String(length=32), nullable=True),
        sa.Column("retired_health_state", sa.String(length=30), nullable=True),
        sa.Column("retired_health_meta", postgresql.JSONB(), nullable=True),
        sa.Column(
            "retired_health_checked_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column("retired_generation_high_water", sa.BigInteger(), nullable=True),
        sa.Column("retired_control_epoch_high_water", sa.BigInteger(), nullable=True),
        sa.Column("retired_runtime_epoch_high_water", sa.BigInteger(), nullable=True),
        sa.Column(
            "retired_token_expiry_high_water",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "state IN ('pending', 'active', 'retiring')",
            name="ck_gpu_backend_memberships_state",
        ),
        sa.CheckConstraint(
            "membership_epoch > 0",
            name="ck_gpu_backend_memberships_epoch_positive",
        ),
        sa.CheckConstraint(
            "runtime_epoch_baseline >= 0",
            name="ck_gpu_backend_memberships_runtime_baseline_nonnegative",
        ),
        sa.CheckConstraint(
            "vram_budget_mb > 0",
            name="ck_gpu_backend_memberships_budget_positive",
        ),
        sa.CheckConstraint(
            "gpu_resource_id = btrim(gpu_resource_id) AND "
            "gpu_resource_id !~ '[[:space:],]' AND "
            "position('/' in gpu_resource_id) > 1 AND "
            "position('/' in gpu_resource_id) < char_length(gpu_resource_id)",
            name="ck_gpu_backend_memberships_resource_id",
        ),
        sa.CheckConstraint(
            "max_concurrency > 0 AND max_concurrency <= 10000",
            name="ck_gpu_backend_memberships_concurrency",
        ),
        sa.CheckConstraint(
            "(state = 'retiring') = (retired_at IS NOT NULL)",
            name="ck_gpu_backend_memberships_retired_at",
        ),
        sa.CheckConstraint(
            "state <> 'retiring' OR ("
            "retired_generation_high_water IS NOT NULL AND "
            "retired_control_epoch_high_water IS NOT NULL AND "
            "retired_runtime_epoch_high_water IS NOT NULL)",
            name="ck_gpu_backend_memberships_retired_fence",
        ),
        sa.CheckConstraint(
            "(state = 'retiring') = (retire_reason IS NOT NULL) AND "
            "(retire_reason IS NULL OR retire_reason IN ("
            "'registry_deleted', 'claim_removed', 'resource_moved', "
            "'managed_retirement'))",
            name="ck_gpu_backend_memberships_retire_reason",
        ),
        sa.CheckConstraint(
            "(retired_generation_high_water IS NULL OR "
            "retired_generation_high_water >= 0) AND "
            "(retired_control_epoch_high_water IS NULL OR "
            "retired_control_epoch_high_water >= 0) AND "
            "(retired_runtime_epoch_high_water IS NULL OR "
            "retired_runtime_epoch_high_water >= 0)",
            name="ck_gpu_backend_memberships_retired_fence_nonnegative",
        ),
        sa.CheckConstraint(
            "state = 'retiring' OR ("
            "retired_health_state IS NULL AND "
            "retired_health_meta IS NULL AND "
            "retired_health_checked_at IS NULL AND "
            "retired_generation_high_water IS NULL AND "
            "retired_control_epoch_high_water IS NULL AND "
            "retired_runtime_epoch_high_water IS NULL AND "
            "retired_token_expiry_high_water IS NULL)",
            name="ck_gpu_backend_memberships_current_has_no_retired_evidence",
        ),
        sa.ForeignKeyConstraint(
            ["backend_registry_id"],
            ["gpu_backend_fences.backend_registry_id"],
            name="fk_gpu_backend_memberships_fence",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("backend_registry_id", "gpu_resource_id"),
    )
    op.create_index(
        "ix_gpu_backend_memberships_resource_state",
        "gpu_backend_memberships",
        ["gpu_resource_id", "state"],
    )
    op.create_index(
        "uq_gpu_backend_memberships_current_backend",
        "gpu_backend_memberships",
        ["backend_registry_id"],
        unique=True,
        postgresql_where=sa.text("state IN ('pending', 'active')"),
    )

    op.execute(
        """
        INSERT INTO gpu_backend_fences (backend_registry_id)
        SELECT id
        FROM ml_backend_registry
        ON CONFLICT (backend_registry_id) DO NOTHING
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM ml_backend_registry
                WHERE gpu_resource_id IS NOT NULL
                  AND COALESCE(extra_params, '{}'::jsonb) ? 'max_concurrency'
                  AND NOT CASE
                      WHEN COALESCE(extra_params ->> 'max_concurrency', '')
                               ~ '^[1-9][0-9]{0,4}$'
                      THEN (extra_params ->> 'max_concurrency')::bigint <= 10000
                      ELSE false
                  END
            ) THEN
                RAISE EXCEPTION 'invalid GPU backend max_concurrency during membership backfill'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'ck_gpu_backend_membership_max_concurrency';
            END IF;
        END;
        $$;
        """
    )
    op.execute(
        """
        INSERT INTO gpu_backend_memberships (
            backend_registry_id,
            gpu_resource_id,
            membership_epoch,
            runtime_epoch_baseline,
            state,
            vram_budget_mb,
            eviction_priority,
            max_concurrency
        )
        SELECT
            id,
            gpu_resource_id,
            1,
            fence.runtime_epoch_high_water,
            'pending',
            vram_budget_mb,
            eviction_priority,
            CASE
                WHEN COALESCE(extra_params, '{}'::jsonb) ? 'max_concurrency'
                THEN (extra_params ->> 'max_concurrency')::integer
                ELSE 4
            END
        FROM ml_backend_registry AS backend
        JOIN gpu_backend_fences AS fence
          ON fence.backend_registry_id = backend.id
        WHERE backend.gpu_resource_id IS NOT NULL
        ON CONFLICT (backend_registry_id, gpu_resource_id) DO NOTHING
        """
    )
    op.execute(_MEMBERSHIP_VALIDATION_FUNCTION)
    op.execute(
        """
        CREATE TRIGGER trg_validate_gpu_backend_membership
        BEFORE INSERT OR UPDATE OR DELETE ON gpu_backend_memberships
        FOR EACH ROW
        EXECUTE FUNCTION validate_gpu_backend_membership()
        """
    )
    op.execute(_TRIGGER_FUNCTION)
    op.execute(
        """
        CREATE TRIGGER trg_sync_gpu_backend_membership
        AFTER INSERT OR UPDATE OF
            gpu_resource_id,
            vram_budget_mb,
            eviction_priority,
            extra_params,
            url,
            auth_method,
            auth_token
        OR DELETE ON ml_backend_registry
        FOR EACH ROW
        EXECUTE FUNCTION sync_gpu_backend_membership()
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_sync_gpu_backend_membership ON ml_backend_registry"
    )
    op.execute("DROP FUNCTION IF EXISTS sync_gpu_backend_membership()")
    op.execute(
        "DROP TRIGGER IF EXISTS trg_validate_gpu_backend_membership "
        "ON gpu_backend_memberships"
    )
    op.execute("DROP FUNCTION IF EXISTS validate_gpu_backend_membership()")
    op.drop_index(
        "uq_gpu_backend_memberships_current_backend",
        table_name="gpu_backend_memberships",
    )
    op.drop_index(
        "ix_gpu_backend_memberships_resource_state",
        table_name="gpu_backend_memberships",
    )
    op.drop_table("gpu_backend_memberships")

    op.execute(
        """
        DELETE FROM gpu_backend_fences AS fence
        WHERE NOT EXISTS (
            SELECT 1
            FROM ml_backend_registry AS backend
            WHERE backend.id = fence.backend_registry_id
        )
        """
    )
    op.drop_constraint(
        "ck_gpu_backend_fences_runtime_epoch_nonnegative",
        "gpu_backend_fences",
        type_="check",
    )
    op.drop_column("gpu_backend_fences", "token_expiry_high_water")
    op.drop_column("gpu_backend_fences", "runtime_epoch_high_water")
    op.create_foreign_key(
        "gpu_backend_fences_backend_registry_id_fkey",
        "gpu_backend_fences",
        "ml_backend_registry",
        ["backend_registry_id"],
        ["id"],
        ondelete="CASCADE",
    )
