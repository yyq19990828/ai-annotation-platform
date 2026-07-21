"""Restore registry IDs in public JSON configuration surfaces.

Revision ID: 0133
Revises: 0132

Service-pool IDs are internal routing identities. Existing public configuration
contracts continue to use registry IDs because their consumers resolve models from
the registry capability catalogue. This idempotent migration repairs databases that
already applied 0132 while leaving relational pool bindings and dual-ID lineage intact.
"""

from alembic import op


revision = "0133"
down_revision = "0132"
branch_labels = None
depends_on = None


def _rekey_user_preference(subkey: str, *, to_pool: bool = False) -> None:
    source = "registry_id" if to_pool else "pool_id"
    target = "pool_id" if to_pool else "registry_id"
    op.execute(
        f"""
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{{ai,{subkey}}}',
          (SELECT COALESCE(jsonb_object_agg(new_key, value), '{{}}'::jsonb)
           FROM (
             SELECT DISTINCT ON (COALESCE(m.{target}::text, kv.key))
                    COALESCE(m.{target}::text, kv.key) AS new_key,
                    kv.value AS value
             FROM jsonb_each(u.preferences->'ai'->'{subkey}') kv
             LEFT JOIN _public_id_map m ON m.{source}::text = kv.key
             ORDER BY COALESCE(m.{target}::text, kv.key),
                      (m.{source} IS NULL) DESC
           ) repaired)
        )
        WHERE u.preferences->'ai' ? '{subkey}'
          AND jsonb_typeof(u.preferences->'ai'->'{subkey}') = 'object';
        """
    )


def upgrade() -> None:
    op.execute(
        """
        CREATE TEMP TABLE _public_id_map ON COMMIT DROP AS
        SELECT id AS pool_id, legacy_instance_id AS registry_id
        FROM ml_backend_service_pools
        WHERE legacy_instance_id IS NOT NULL;
        """
    )

    # PipelineStage keeps the existing ml_backend_id registry contract. Handle
    # both the 0132 shape and a partially repaired shape whose value is a pool ID.
    op.execute(
        """
        UPDATE projects p SET preannotate_pipeline = (
          SELECT COALESCE(jsonb_agg(
            CASE
              WHEN elem ? 'ml_backend_pool_id' THEN
                (elem - 'ml_backend_pool_id')
                  || jsonb_build_object(
                       'ml_backend_id',
                       COALESCE(
                         (SELECT m.registry_id::text FROM _public_id_map m
                          WHERE m.pool_id::text = elem->>'ml_backend_pool_id'),
                         elem->>'ml_backend_pool_id'
                       )
                     )
              WHEN elem ? 'ml_backend_id' THEN
                jsonb_set(
                  elem,
                  '{ml_backend_id}',
                  to_jsonb(COALESCE(
                    (SELECT m.registry_id::text FROM _public_id_map m
                     WHERE m.pool_id::text = elem->>'ml_backend_id'),
                    elem->>'ml_backend_id'
                  ))
                )
              ELSE elem
            END
          ), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(p.preannotate_pipeline, '[]'::jsonb)) t(elem)
        )
        WHERE p.preannotate_pipeline IS NOT NULL
          AND jsonb_typeof(p.preannotate_pipeline) = 'array';
        """
    )

    op.execute(
        """
        UPDATE projects p SET default_variants = (
          SELECT COALESCE(jsonb_object_agg(new_key, value), '{}'::jsonb)
          FROM (
            SELECT DISTINCT ON (COALESCE(m.registry_id::text, kv.key))
                   COALESCE(m.registry_id::text, kv.key) AS new_key,
                   kv.value AS value
            FROM jsonb_each(p.default_variants) kv
            LEFT JOIN _public_id_map m ON m.pool_id::text = kv.key
            ORDER BY COALESCE(m.registry_id::text, kv.key),
                     (m.pool_id IS NULL) DESC
          ) repaired
        )
        WHERE p.default_variants IS NOT NULL
          AND jsonb_typeof(p.default_variants) = 'object'
          AND p.default_variants <> '{}'::jsonb;
        """
    )

    _rekey_user_preference("params_by_backend")
    _rekey_user_preference("model_by_backend")

    op.execute(
        """
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{ai,interactive_backend_by_project}',
          (SELECT COALESCE(jsonb_object_agg(
                    kv.key,
                    to_jsonb(COALESCE(m.registry_id::text, kv.value #>> '{}'))
                  ), '{}'::jsonb)
           FROM jsonb_each(u.preferences->'ai'->'interactive_backend_by_project') kv
           LEFT JOIN _public_id_map m ON m.pool_id::text = (kv.value #>> '{}'))
        )
        WHERE u.preferences->'ai' ? 'interactive_backend_by_project'
          AND jsonb_typeof(u.preferences->'ai'->'interactive_backend_by_project') = 'object';
        """
    )

    # Model identifiers may contain colons, so preserve the complete suffix after
    # the first colon instead of using split_part(..., 2).
    op.execute(
        """
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{ai,secondary_by_model}',
          (SELECT COALESCE(jsonb_object_agg(new_key, value), '{}'::jsonb)
           FROM (
             SELECT DISTINCT ON (
               CASE
                 WHEN strpos(kv.key, ':') > 0 THEN
                   COALESCE(m.registry_id::text, split_part(kv.key, ':', 1))
                     || substring(kv.key FROM strpos(kv.key, ':'))
                 ELSE kv.key
               END
             )
               CASE
                 WHEN strpos(kv.key, ':') > 0 THEN
                   COALESCE(m.registry_id::text, split_part(kv.key, ':', 1))
                     || substring(kv.key FROM strpos(kv.key, ':'))
                 ELSE kv.key
               END AS new_key,
               kv.value AS value
             FROM jsonb_each(u.preferences->'ai'->'secondary_by_model') kv
             LEFT JOIN _public_id_map m
               ON m.pool_id::text = split_part(kv.key, ':', 1)
             ORDER BY 1, (m.pool_id IS NULL) DESC
           ) repaired)
        )
        WHERE u.preferences->'ai' ? 'secondary_by_model'
          AND jsonb_typeof(u.preferences->'ai'->'secondary_by_model') = 'object';
        """
    )


def downgrade() -> None:
    """Reverse only this corrective migration for singleton-compatible data."""
    op.execute(
        """
        CREATE TEMP TABLE _public_id_map ON COMMIT DROP AS
        SELECT id AS pool_id, legacy_instance_id AS registry_id
        FROM ml_backend_service_pools
        WHERE legacy_instance_id IS NOT NULL;
        """
    )
    op.execute(
        """
        UPDATE projects p SET preannotate_pipeline = (
          SELECT COALESCE(jsonb_agg(
            CASE WHEN elem ? 'ml_backend_id' THEN
              (elem - 'ml_backend_id') || jsonb_build_object(
                'ml_backend_pool_id',
                COALESCE(
                  (SELECT m.pool_id::text FROM _public_id_map m
                   WHERE m.registry_id::text = elem->>'ml_backend_id'),
                  elem->>'ml_backend_id'
                )
              )
            ELSE elem END
          ), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(p.preannotate_pipeline, '[]'::jsonb)) t(elem)
        )
        WHERE p.preannotate_pipeline IS NOT NULL
          AND jsonb_typeof(p.preannotate_pipeline) = 'array';
        """
    )
    op.execute(
        """
        UPDATE projects p SET default_variants = (
          SELECT COALESCE(jsonb_object_agg(
            COALESCE(m.pool_id::text, kv.key), kv.value
          ), '{}'::jsonb)
          FROM jsonb_each(p.default_variants) kv
          LEFT JOIN _public_id_map m ON m.registry_id::text = kv.key
        )
        WHERE p.default_variants IS NOT NULL
          AND jsonb_typeof(p.default_variants) = 'object'
          AND p.default_variants <> '{}'::jsonb;
        """
    )
    _rekey_user_preference("params_by_backend", to_pool=True)
    _rekey_user_preference("model_by_backend", to_pool=True)
    op.execute(
        """
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{ai,interactive_backend_by_project}',
          (SELECT COALESCE(jsonb_object_agg(
                    kv.key,
                    to_jsonb(COALESCE(m.pool_id::text, kv.value #>> '{}'))
                  ), '{}'::jsonb)
           FROM jsonb_each(u.preferences->'ai'->'interactive_backend_by_project') kv
           LEFT JOIN _public_id_map m ON m.registry_id::text = (kv.value #>> '{}'))
        )
        WHERE u.preferences->'ai' ? 'interactive_backend_by_project'
          AND jsonb_typeof(u.preferences->'ai'->'interactive_backend_by_project') = 'object';
        """
    )
    op.execute(
        """
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{ai,secondary_by_model}',
          (SELECT COALESCE(jsonb_object_agg(
            CASE WHEN strpos(kv.key, ':') > 0 THEN
              COALESCE(m.pool_id::text, split_part(kv.key, ':', 1))
                || substring(kv.key FROM strpos(kv.key, ':'))
            ELSE kv.key END,
            kv.value
          ), '{}'::jsonb)
          FROM jsonb_each(u.preferences->'ai'->'secondary_by_model') kv
          LEFT JOIN _public_id_map m
            ON m.registry_id::text = split_part(kv.key, ':', 1))
        )
        WHERE u.preferences->'ai' ? 'secondary_by_model'
          AND jsonb_typeof(u.preferences->'ai'->'secondary_by_model') = 'object';
        """
    )
