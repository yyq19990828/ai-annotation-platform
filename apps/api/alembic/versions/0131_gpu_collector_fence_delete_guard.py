"""Require a GC receipt before deleting an orphan GPU fence.

Revision ID: 0131
Revises: 0130
"""

from alembic import op


revision = "0131"
down_revision = "0130"
branch_labels = None
depends_on = None


_FENCE_DELETE_GUARD = """
CREATE OR REPLACE FUNCTION validate_gpu_backend_fence_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    receipt_raw text := current_setting('app.gpu_tombstone_gc_receipt', true);
    receipt jsonb := NULL;
    receipt_resource_id text := NULL;
    resource_lock_key bigint := NULL;
    resource_lock_held boolean := false;
    registry_exists boolean := false;
    membership_exists boolean := false;
BEGIN
    BEGIN
        receipt := NULLIF(receipt_raw, '')::jsonb;
    EXCEPTION WHEN OTHERS THEN
        receipt := NULL;
    END;
    IF receipt IS NOT NULL AND jsonb_typeof(receipt) = 'object' THEN
        receipt_resource_id := receipt ->> 'resource_id';
    END IF;
    resource_lock_key := hashtextextended(
        'aap:gpu-resource:' || COALESCE(receipt_resource_id, ''), 0
    );
    SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND pid = pg_backend_pid()
          AND granted
          AND classid = ((resource_lock_key >> 32) & 4294967295)::oid
          AND objid = (resource_lock_key & 4294967295)::oid
          AND objsubid = 1
    ) INTO resource_lock_held;
    SELECT EXISTS (
        SELECT 1
        FROM ml_backend_registry
        WHERE id = OLD.backend_registry_id
    ) INTO registry_exists;
    SELECT EXISTS (
        SELECT 1
        FROM gpu_backend_memberships
        WHERE backend_registry_id = OLD.backend_registry_id
    ) INTO membership_exists;
    IF receipt IS NULL
       OR jsonb_typeof(receipt) <> 'object'
       OR NOT receipt ?& ARRAY[
           'backend_id', 'resource_id',
           'membership_epoch', 'retirement_id', 'fingerprint'
       ]
       OR receipt - 'backend_id' - 'resource_id'
            - 'membership_epoch' - 'retirement_id'
            - 'fingerprint' <> '{}'::jsonb
       OR receipt ->> 'backend_id' <> OLD.backend_registry_id::text
       OR receipt_resource_id IS NULL
       OR receipt_resource_id = ''
       OR receipt_resource_id <> btrim(receipt_resource_id)
       OR COALESCE(receipt ->> 'membership_epoch', '')
            !~ '^[1-9][0-9]{0,18}$'
       OR COALESCE(receipt ->> 'retirement_id', '')
            !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(receipt ->> 'fingerprint', '') !~ '^[0-9a-f]{64}$'
       OR NOT resource_lock_held
       OR registry_exists
       OR membership_exists THEN
        RAISE EXCEPTION 'GPU fence deletion requires proof-backed orphan collection'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_gpu_backend_fence_delete_requires_gc';
    END IF;
    RETURN OLD;
END;
$$;
"""


def upgrade() -> None:
    op.execute(_FENCE_DELETE_GUARD)
    op.execute(
        """
        CREATE TRIGGER trg_validate_gpu_backend_fence_delete
        BEFORE DELETE ON gpu_backend_fences
        FOR EACH ROW
        EXECUTE FUNCTION validate_gpu_backend_fence_delete()
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_validate_gpu_backend_fence_delete "
        "ON gpu_backend_fences"
    )
    op.execute("DROP FUNCTION IF EXISTS validate_gpu_backend_fence_delete()")
