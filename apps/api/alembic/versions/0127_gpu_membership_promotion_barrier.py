"""Share the promotion barrier with GPU claim and membership creation.

Revision ID: 0127
Revises: 0126

Promotion scans every current GPU membership for endpoint and boot aliases. Claim
mutations and membership inserts must therefore enter the same global linearization
barrier after their resource-local lock. Both locks are fail-fast because a multi-row
transaction retains transaction advisory locks until commit and may otherwise wait
for a later resource while blocking every other card.
"""

from alembic import op


revision = "0127"
down_revision = "0126"
branch_labels = None
depends_on = None


_REGISTRY_RESOURCE_LOCK_FUNCTION = """
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
            IF NOT pg_try_advisory_xact_lock(
                hashtextextended('aap:gpu-resource:' || old_resource, 0)
            ) THEN
                RAISE EXCEPTION 'GPU resource promotion barrier is busy: %', old_resource
                    USING ERRCODE = '40001';
            END IF;
            IF NOT pg_try_advisory_xact_lock(
                hashtextextended('aap:gpu-resource:' || new_resource, 0)
            ) THEN
                RAISE EXCEPTION 'GPU resource promotion barrier is busy: %', new_resource
                    USING ERRCODE = '40001';
            END IF;
        ELSE
            IF NOT pg_try_advisory_xact_lock(
                hashtextextended('aap:gpu-resource:' || new_resource, 0)
            ) THEN
                RAISE EXCEPTION 'GPU resource promotion barrier is busy: %', new_resource
                    USING ERRCODE = '40001';
            END IF;
            IF NOT pg_try_advisory_xact_lock(
                hashtextextended('aap:gpu-resource:' || old_resource, 0)
            ) THEN
                RAISE EXCEPTION 'GPU resource promotion barrier is busy: %', old_resource
                    USING ERRCODE = '40001';
            END IF;
        END IF;
    ELSIF old_resource IS NOT NULL THEN
        IF NOT pg_try_advisory_xact_lock(
            hashtextextended('aap:gpu-resource:' || old_resource, 0)
        ) THEN
            RAISE EXCEPTION 'GPU resource promotion barrier is busy: %', old_resource
                USING ERRCODE = '40001';
        END IF;
    ELSIF new_resource IS NOT NULL THEN
        IF NOT pg_try_advisory_xact_lock(
            hashtextextended('aap:gpu-resource:' || new_resource, 0)
        ) THEN
            RAISE EXCEPTION 'GPU resource promotion barrier is busy: %', new_resource
                USING ERRCODE = '40001';
        END IF;
    END IF;

    IF old_resource IS NOT NULL OR new_resource IS NOT NULL THEN
        IF NOT pg_try_advisory_xact_lock(
            hashtextextended('aap:gpu-membership-promotion', 0)
        ) THEN
            RAISE EXCEPTION 'GPU membership promotion barrier is busy'
                USING ERRCODE = '40001';
        END IF;
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
    IF NOT pg_try_advisory_xact_lock(
        hashtextextended('aap:gpu-resource:' || NEW.gpu_resource_id, 0)
    ) THEN
        RAISE EXCEPTION 'GPU resource promotion barrier is busy: %', NEW.gpu_resource_id
            USING ERRCODE = '40001';
    END IF;
    IF NOT pg_try_advisory_xact_lock(
        hashtextextended('aap:gpu-membership-promotion', 0)
    ) THEN
        RAISE EXCEPTION 'GPU membership promotion barrier is busy'
            USING ERRCODE = '40001';
    END IF;
    RETURN NEW;
END;
$$;
"""


_REGISTRY_TRIGGER = """
CREATE TRIGGER trg_lock_gpu_registry_resource_membership
BEFORE INSERT OR UPDATE OF
    gpu_resource_id,
    vram_budget_mb,
    eviction_priority,
    extra_params,
    url,
    auth_method,
    auth_token,
    state,
    health_meta,
    last_checked_at
OR DELETE ON ml_backend_registry
FOR EACH ROW
EXECUTE FUNCTION lock_gpu_registry_resource_membership()
"""


_PREVIOUS_REGISTRY_TRIGGER = """
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


_PREVIOUS_REGISTRY_RESOURCE_LOCK_FUNCTION = """
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


_PREVIOUS_MEMBERSHIP_INSERT_LOCK_FUNCTION = """
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
    op.execute(_REGISTRY_RESOURCE_LOCK_FUNCTION)
    op.execute(_MEMBERSHIP_INSERT_LOCK_FUNCTION)
    op.execute(
        "DROP TRIGGER trg_lock_gpu_registry_resource_membership ON ml_backend_registry"
    )
    op.execute(_REGISTRY_TRIGGER)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER trg_lock_gpu_registry_resource_membership ON ml_backend_registry"
    )
    op.execute(_PREVIOUS_REGISTRY_TRIGGER)
    op.execute(_PREVIOUS_REGISTRY_RESOURCE_LOCK_FUNCTION)
    op.execute(_PREVIOUS_MEMBERSHIP_INSERT_LOCK_FUNCTION)
