"""Serialize closed-domain GPU proof work with membership creation.

Revision ID: 0125
Revises: 0124

Row locks can stabilize existing memberships, but they cannot fence a concurrent
insert into the same resource predicate.  A transaction-scoped advisory lock gives
proof recovery and registry-triggered membership creation one resource-local
linearization barrier without serializing unrelated cards.
"""

from alembic import op


revision = "0125"
down_revision = "0124"
branch_labels = None
depends_on = None


_RESOURCE_LOCK_FUNCTION = """
CREATE OR REPLACE FUNCTION lock_gpu_registry_resource_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    old_resource text := CASE WHEN TG_OP = 'INSERT' THEN NULL
                              ELSE OLD.gpu_resource_id END;
    new_resource text := CASE WHEN TG_OP = 'DELETE' THEN NULL
                              ELSE NEW.gpu_resource_id END;
BEGIN
    IF old_resource IS NOT NULL
       AND new_resource IS NOT NULL
       AND old_resource IS DISTINCT FROM new_resource THEN
        IF old_resource < new_resource THEN
            PERFORM pg_advisory_xact_lock(
                hashtextextended('aap:gpu-resource:' || old_resource, 0)
            );
            PERFORM pg_advisory_xact_lock(
                hashtextextended('aap:gpu-resource:' || new_resource, 0)
            );
        ELSE
            PERFORM pg_advisory_xact_lock(
                hashtextextended('aap:gpu-resource:' || new_resource, 0)
            );
            PERFORM pg_advisory_xact_lock(
                hashtextextended('aap:gpu-resource:' || old_resource, 0)
            );
        END IF;
    ELSIF old_resource IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(
            hashtextextended('aap:gpu-resource:' || old_resource, 0)
        );
    ELSIF new_resource IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(
            hashtextextended('aap:gpu-resource:' || new_resource, 0)
        );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
"""


_MEMBERSHIP_INSERT_LOCK_FUNCTION = """
CREATE OR REPLACE FUNCTION lock_gpu_membership_insert_resource()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended('aap:gpu-resource:' || NEW.gpu_resource_id, 0)
    );
    RETURN NEW;
END;
$$;
"""


def upgrade() -> None:
    op.execute(_RESOURCE_LOCK_FUNCTION)
    op.execute(
        """
        CREATE TRIGGER trg_lock_gpu_registry_resource_membership
        BEFORE INSERT OR UPDATE OF
            gpu_resource_id,
            vram_budget_mb,
            eviction_priority,
            extra_params,
            url,
            auth_method,
            auth_token
        OR DELETE ON ml_backend_registry
        FOR EACH ROW
        EXECUTE FUNCTION lock_gpu_registry_resource_membership()
        """
    )
    op.execute(_MEMBERSHIP_INSERT_LOCK_FUNCTION)
    op.execute(
        """
        CREATE TRIGGER trg_lock_gpu_membership_insert_resource
        BEFORE INSERT ON gpu_backend_memberships
        FOR EACH ROW
        EXECUTE FUNCTION lock_gpu_membership_insert_resource()
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_lock_gpu_membership_insert_resource "
        "ON gpu_backend_memberships"
    )
    op.execute("DROP FUNCTION IF EXISTS lock_gpu_membership_insert_resource()")
    op.execute(
        "DROP TRIGGER IF EXISTS trg_lock_gpu_registry_resource_membership "
        "ON ml_backend_registry"
    )
    op.execute("DROP FUNCTION IF EXISTS lock_gpu_registry_resource_membership()")
