"""v0.23.3 ADR-0050 · ML Backend 服务池 + singleton backfill

在 ml_backend_registry (物理实例, ADR-0044) 之上加一层逻辑服务池:
  - ml_backend_service_pools  (逻辑请求身份)
  - ml_backend_pool_members   (一实例最多属于一个 pool)

每个现有 registry 自动得到一个 singleton pool (pool 名 = registry 名,
legacy_instance_id 指向该 registry, 该 registry 成为 active weight=1 成员)。
项目绑定迁移:
  - project_ml_backend            → project_ml_backend_pool (表改名)
    registry_id                   → pool_id                 (列改名 + 重指向)
  - projects.ml_backend_id        → projects.ml_backend_pool_id (改名, FK 重指 pool)

溯源双 ID:
  - predictions.ml_backend_pool_id        (新增; 父表 + 各分区同步)
  - failed_predictions.ml_backend_pool_id (新增)

JSONB 重映射 (按 registry→singleton pool 映射表驱动, 不按名称/URL 重算):
  - projects.preannotate_pipeline[].ml_backend_id          → ml_backend_pool_id
  - projects.default_variants                              (backend-key → pool-key)
  - users.preferences.ai.params_by_backend                 (key 重映射)
  - users.preferences.ai.model_by_backend                  (key 重映射)
  - users.preferences.ai.interactive_backend_by_project    (value 重映射)
  - users.preferences.ai.secondary_by_model                (复合 key backendId:modelId 重映射)
  - async_jobs.payload.ml_backend_id                       → 新增 ml_backend_pool_id (原字段保留)

迁移后 off mode 下每个原请求仍落到唯一原实例, 行为与 v0.23.2 完全一致。
只有管理员显式把新实例加入既有 pool 并切 rollout mode 后才产生多实例分配。

downgrade: forward-only 安全。全 singleton + 无多成员 + 无 pool-only 配置时可逆;
一旦创建多成员 pool / 变更 legacy / 写 pool-only pipeline/preference, downgrade
fail-closed 并提示 forward-only (不静默丢多成员配置)。

Revision ID: 0132
Revises: 0131
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0132"
down_revision = "0131"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. 两张新表 ──────────────────────────────────────────────────────────
    op.create_table(
        "ml_backend_service_pools",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column(
            "routing_policy",
            sa.String(40),
            nullable=False,
            server_default="smooth_weighted_round_robin",
        ),
        sa.Column("legacy_instance_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "routing_generation", sa.BigInteger, nullable=False, server_default="1"
        ),
        sa.Column("capability_fingerprint", sa.String(64), nullable=True),
        sa.Column(
            "capability_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["legacy_instance_id"],
            ["ml_backend_registry.id"],
            ondelete="RESTRICT",
            name="fk_ml_backend_service_pools_legacy_instance",
        ),
        sa.CheckConstraint(
            "(enabled = false) OR (legacy_instance_id IS NOT NULL)",
            name="ck_ml_backend_service_pools_enabled_has_legacy",
        ),
        sa.CheckConstraint(
            "routing_policy = 'smooth_weighted_round_robin'",
            name="ck_ml_backend_service_pools_routing_policy",
        ),
    )
    op.create_table(
        "ml_backend_pool_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("pool_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registry_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "traffic_state", sa.String(16), nullable=False, server_default="active"
        ),
        sa.Column("weight", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["pool_id"], ["ml_backend_service_pools.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["registry_id"], ["ml_backend_registry.id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint(
            "pool_id", "registry_id", name="uq_ml_backend_pool_members"
        ),
        # registry_id 单列 unique — 一实例最多属于一个 pool (ADR-0050 D2)
        sa.UniqueConstraint(
            "registry_id", name="uq_ml_backend_pool_members_registry"
        ),
        sa.CheckConstraint(
            "traffic_state IN ('active', 'draining', 'disabled')",
            name="ck_ml_backend_pool_members_traffic_state",
        ),
        sa.CheckConstraint(
            "weight >= 1 AND weight <= 100",
            name="ck_ml_backend_pool_members_weight",
        ),
    )
    op.create_index(
        "ix_ml_backend_pool_members_pool_id", "ml_backend_pool_members", ["pool_id"]
    )

    # ── 2. singleton backfill: 每 registry 一个 pool + 一个 active 成员 ──────
    # pool 名取 registry 名; legacy_instance_id 指向该 registry; enabled 跟随
    # registry 是否被任一项目启用 (off mode 行为保持)。
    op.execute(
        """
        INSERT INTO ml_backend_service_pools
          (id, name, enabled, routing_policy, legacy_instance_id,
           routing_generation, created_at, updated_at)
        SELECT
          gen_random_uuid(), r.name,
          -- enabled = 该 registry 被任一项目启用 (与原 is_enabled 语义一致)
          COALESCE(
            (SELECT true FROM project_ml_backend pmb
             WHERE pmb.registry_id = r.id AND pmb.enabled = true LIMIT 1),
            false
          ),
          'smooth_weighted_round_robin',
          r.id,
          1,
          r.created_at, now()
        FROM ml_backend_registry r;
        """
    )
    op.execute(
        """
        INSERT INTO ml_backend_pool_members
          (id, pool_id, registry_id, traffic_state, weight, created_at, updated_at)
        SELECT gen_random_uuid(), p.id, p.legacy_instance_id, 'active', 1,
               p.created_at, now()
        FROM ml_backend_service_pools p;
        """
    )

    # ── 3. registry → singleton pool 映射表 (machine-readable, 不按名称重算) ─
    op.execute(
        """
        CREATE TEMP TABLE _pool_map ON COMMIT DROP AS
        SELECT p.id AS pool_id, p.legacy_instance_id AS registry_id
        FROM ml_backend_service_pools p
        WHERE p.legacy_instance_id IS NOT NULL;
        """
    )

    # ── 4. project_ml_backend → project_ml_backend_pool (表改名 + 列改名) ─────
    # 先把列 registry_id 改名 pool_id (类型不变), 再重指向 pool 表, 再改表名,
    # 最后重建 unique 约束名。registry_id 的 FK 指向 ml_backend_registry,
    # 必须先 drop 旧 FK 再改列再建新 FK 指向 pool。约束名条件 drop (历史可能漂移)。
    op.execute(
        "ALTER TABLE project_ml_backend DROP CONSTRAINT IF EXISTS project_ml_backend_registry_id_fkey"
    )
    op.execute(
        "ALTER TABLE project_ml_backend DROP CONSTRAINT IF EXISTS uq_project_ml_backend"
    )
    op.alter_column(
        "project_ml_backend",
        "registry_id",
        new_column_name="pool_id",
        existing_type=postgresql.UUID(as_uuid=True),
        existing_nullable=False,
    )
    # 回填 pool_id: 原 registry_id → singleton pool id
    op.execute(
        """
        UPDATE project_ml_backend pmb SET pool_id = m.pool_id
        FROM _pool_map m WHERE pmb.pool_id = m.registry_id;
        """
    )
    op.create_foreign_key(
        "project_ml_backend_pool_pool_id_fkey",
        "project_ml_backend",
        "ml_backend_service_pools",
        ["pool_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_project_ml_backend_pool", "project_ml_backend", ["project_id", "pool_id"]
    )
    op.rename_table("project_ml_backend", "project_ml_backend_pool")

    # ── 5. projects.ml_backend_id → ml_backend_pool_id (改名 + 新 FK) ─────────
    # 注: projects.ml_backend_id 在历史上是 plain UUID 列, 无 DB FK (ORM 也未声明);
    # 仅改列名, 不 drop 旧 FK。条件 drop 防御性保留。
    op.execute(
        "ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_ml_backend_id_fkey"
    )
    op.alter_column(
        "projects",
        "ml_backend_id",
        new_column_name="ml_backend_pool_id",
        existing_type=postgresql.UUID(as_uuid=True),
        existing_nullable=True,
    )
    # 回填: 原 registry id → singleton pool id
    op.execute(
        """
        UPDATE projects p SET ml_backend_pool_id = m.pool_id
        FROM _pool_map m WHERE p.ml_backend_pool_id = m.registry_id;
        """
    )
    op.create_foreign_key(
        "projects_ml_backend_pool_id_fkey",
        "projects",
        "ml_backend_service_pools",
        ["ml_backend_pool_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ── 6. predictions / failed_predictions 双 ID (分区表父表 + 各分区同步) ──
    # PG 11+: 父表 ADD COLUMN 自动传播到分区; 父表 ADD FK 也传播。
    op.add_column(
        "predictions",
        sa.Column("ml_backend_pool_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "predictions_ml_backend_pool_id_fkey",
        "predictions",
        "ml_backend_service_pools",
        ["ml_backend_pool_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # 回填 requested pool (单阶段预测: ml_backend_id → singleton pool id)
    op.execute(
        """
        UPDATE predictions pr SET ml_backend_pool_id = m.pool_id
        FROM _pool_map m
        WHERE pr.ml_backend_id = m.registry_id AND pr.ml_backend_pool_id IS NULL;
        """
    )
    op.add_column(
        "failed_predictions",
        sa.Column("ml_backend_pool_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "failed_predictions_ml_backend_pool_id_fkey",
        "failed_predictions",
        "ml_backend_service_pools",
        ["ml_backend_pool_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE failed_predictions fp SET ml_backend_pool_id = m.pool_id
        FROM _pool_map m
        WHERE fp.ml_backend_id = m.registry_id AND fp.ml_backend_pool_id IS NULL;
        """
    )

    # ── 7. JSONB 重映射 (7 类) ───────────────────────────────────────────────
    # 7a. projects.preannotate_pipeline[].ml_backend_id → ml_backend_pool_id
    #     每个 stage dict 内若有 ml_backend_id, 改名并按映射重 key。
    op.execute(
        """
        UPDATE projects p SET preannotate_pipeline = (
          SELECT COALESCE(jsonb_agg(
            CASE
              WHEN elem ? 'ml_backend_id' THEN
                (elem - 'ml_backend_id')
                  || jsonb_build_object(
                       'ml_backend_pool_id',
                       COALESCE(
                         (SELECT m.pool_id::text FROM _pool_map m
                          WHERE m.registry_id::text = elem->>'ml_backend_id'),
                         elem->>'ml_backend_id'
                       )
                     )
              ELSE elem
            END
          ), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(p.preannotate_pipeline, '[]'::jsonb)) AS t(elem)
        )
        WHERE p.preannotate_pipeline IS NOT NULL
          AND jsonb_typeof(p.preannotate_pipeline) = 'array';
        """
    )
    # 7b. projects.default_variants (backend-key → pool-key)
    op.execute(
        """
        UPDATE projects p SET default_variants = (
          SELECT COALESCE(jsonb_object_agg(new_key, val), '{}'::jsonb)
          FROM (
            SELECT DISTINCT ON (COALESCE(m.pool_id::text, kv.key))
                   COALESCE(m.pool_id::text, kv.key) AS new_key, kv.value AS val
            FROM jsonb_each(p.default_variants) kv
            LEFT JOIN _pool_map m ON m.registry_id::text = kv.key
            ORDER BY COALESCE(m.pool_id::text, kv.key)
          ) d
        )
        WHERE p.default_variants IS NOT NULL
          AND jsonb_typeof(p.default_variants) = 'object'
          AND p.default_variants <> '{}'::jsonb;
        """
    )
    # 7c. project_ml_backend_pool.default_variants (backend-key → pool-key)
    op.execute(
        """
        UPDATE project_ml_backend_pool pmb SET default_variants = (
          SELECT COALESCE(jsonb_object_agg(new_key, val), '{}'::jsonb)
          FROM (
            SELECT DISTINCT ON (COALESCE(m.pool_id::text, kv.key))
                   COALESCE(m.pool_id::text, kv.key) AS new_key, kv.value AS val
            FROM jsonb_each(COALESCE(pmb.default_variants, '{}'::jsonb)) kv
            LEFT JOIN _pool_map m ON m.registry_id::text = kv.key
            ORDER BY COALESCE(m.pool_id::text, kv.key)
          ) d
        )
        WHERE pmb.default_variants IS NOT NULL
          AND jsonb_typeof(pmb.default_variants) = 'object'
          AND pmb.default_variants <> '{}'::jsonb;
        """
    )
    # 7d. users.preferences.ai.params_by_backend (key 重映射)
    _rekey_user_pref_object("params_by_backend")
    # 7e. users.preferences.ai.model_by_backend (key 重映射)
    _rekey_user_pref_object("model_by_backend")
    # 7f. users.preferences.ai.interactive_backend_by_project (value 重映射)
    op.execute(
        """
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{ai,interactive_backend_by_project}',
          (SELECT COALESCE(jsonb_object_agg(kv.key,
                    COALESCE(to_jsonb(m.pool_id::text), kv.value)), '{}'::jsonb)
           FROM jsonb_each(u.preferences->'ai'->'interactive_backend_by_project') kv
           LEFT JOIN _pool_map m ON m.registry_id::text = (kv.value #>> '{}'))
        )
        WHERE u.preferences->'ai' ? 'interactive_backend_by_project'
          AND jsonb_typeof(u.preferences->'ai'->'interactive_backend_by_project') = 'object';
        """
    )
    # 7g. users.preferences.ai.secondary_by_model (复合 key backendId:modelId 重映射)
    op.execute(
        """
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{ai,secondary_by_model}',
          (SELECT COALESCE(jsonb_object_agg(new_key, val), '{}'::jsonb)
           FROM (
             SELECT
               CASE
                 WHEN kv.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:.*$'
                   THEN COALESCE(
                     (SELECT m.pool_id::text || ':' || split_part(kv.key, ':', 2)
                      FROM _pool_map m
                      WHERE m.registry_id::text = split_part(kv.key, ':', 1)),
                     kv.key)
                 ELSE kv.key
               END AS new_key,
               kv.value AS val
             FROM jsonb_each(u.preferences->'ai'->'secondary_by_model') kv
           ) d)
        )
        WHERE u.preferences->'ai' ? 'secondary_by_model'
          AND jsonb_typeof(u.preferences->'ai'->'secondary_by_model') = 'object';
        """
    )
    # 7h. async_jobs.payload: 新增 ml_backend_pool_id (原 ml_backend_id 保留为历史实例证据)
    op.execute(
        """
        UPDATE async_jobs aj SET payload = jsonb_set(
          aj.payload, '{ml_backend_pool_id}',
          COALESCE(
             (SELECT to_jsonb(m.pool_id::text) FROM _pool_map m
              WHERE m.registry_id::text = aj.payload->>'ml_backend_id'),
             'null'::jsonb
          )
        )
        WHERE aj.payload ? 'ml_backend_id';
        """
    )

    # ── 8. orphan / cardinality 守卫 ─────────────────────────────────────────
    # singleton backfill 后每个 registry 必须恰有一个 singleton pool 且恰有一个成员;
    # 任何 project_ml_backend_pool.pool_id / projects.ml_backend_pool_id 必须命中 pool。
    op.execute(
        """
        DO $$
        DECLARE
          unmapped_bindings int;
          unmapped_projects int;
          multi_member_pools int;
        BEGIN
          SELECT count(*) INTO multi_member_pools
          FROM (SELECT pool_id FROM ml_backend_pool_members GROUP BY pool_id HAVING count(*) > 1) x;
          IF multi_member_pools > 0 THEN
            RAISE EXCEPTION 'ADR-0050 backfill invariant violated: % singleton pools unexpectedly have >1 member', multi_member_pools;
          END IF;

          SELECT count(*) INTO unmapped_bindings
          FROM project_ml_backend_pool pmb
          LEFT JOIN ml_backend_service_pools p ON p.id = pmb.pool_id
          WHERE p.id IS NULL;
          IF unmapped_bindings > 0 THEN
            RAISE EXCEPTION 'ADR-0050 backfill orphan: % project_ml_backend_pool rows reference unknown pool', unmapped_bindings;
          END IF;

          SELECT count(*) INTO unmapped_projects
          FROM projects p
          LEFT JOIN ml_backend_service_pools sp ON sp.id = p.ml_backend_pool_id
          WHERE p.ml_backend_pool_id IS NOT NULL AND sp.id IS NULL;
          IF unmapped_projects > 0 THEN
            RAISE EXCEPTION 'ADR-0050 backfill orphan: % projects reference unknown pool', unmapped_projects;
          END IF;
        END $$;
        """
    )


def _rekey_user_pref_object(subkey: str) -> None:
    """Rekey a users.preferences.ai.<subkey> JSONB object by registry→pool map.

    Keys are backend-id strings; values are arbitrary JSON. Missing-mapped keys
    (no pool for that registry) keep their original key.
    """
    op.execute(
        f"""
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{{ai,{subkey}}}',
          (SELECT COALESCE(jsonb_object_agg(new_key, val), '{{}}'::jsonb)
           FROM (
             SELECT DISTINCT ON (COALESCE(m.pool_id::text, kv.key))
                    COALESCE(m.pool_id::text, kv.key) AS new_key, kv.value AS val
             FROM jsonb_each(u.preferences->'ai'->'{subkey}') kv
             LEFT JOIN _pool_map m ON m.registry_id::text = kv.key
             ORDER BY COALESCE(m.pool_id::text, kv.key)
           ) d)
        )
        WHERE u.preferences->'ai' ? '{subkey}'
          AND jsonb_typeof(u.preferences->'ai'->'{subkey}') = 'object';
        """
    )


def downgrade() -> None:
    """Forward-only 安全: 仅全 singleton + 无多成员 + 无 pool-only 配置时可逆。

    一旦出现多成员 pool / legacy instance 变更 / pool-only pipeline 或 preference,
    downgrade fail-closed 并提示 forward-only — 不静默把多成员配置压回任意实例。
    """
    # 守卫: 任一 pool 有 >1 成员 → 无法无损折叠
    op.execute(
        """
        DO $$
        DECLARE multi_member int;
        BEGIN
          SELECT count(*) INTO multi_member
          FROM (SELECT pool_id FROM ml_backend_pool_members
                GROUP BY pool_id HAVING count(*) > 1) x;
          IF multi_member > 0 THEN
            RAISE EXCEPTION 'ADR-0050 forward-only: % pool(s) have multiple members; cannot downgrade without losing multi-member config. Use a forward migration instead.', multi_member;
          END IF;
        END $$;
        """
    )

    # 7h. async_jobs.payload: 移除新增的 ml_backend_pool_id (保留原 ml_backend_id)
    op.execute(
        """
        UPDATE async_jobs aj SET payload = aj.payload - 'ml_backend_pool_id'
        WHERE aj.payload ? 'ml_backend_pool_id';
        """
    )
    # 7g-7d. 用户偏好 / project default_variants / pipeline: pool-key 无法无损还原为
    # registry-key (singleton 下 pool id ≠ registry id), 但语义上 singleton pool 的
    # legacy_instance_id 即原 registry, 故回填时把 pool-key 解析回 legacy registry。
    op.execute(
        """
        CREATE TEMP TABLE _pool_map_down ON COMMIT DROP AS
        SELECT id AS pool_id, legacy_instance_id AS registry_id
        FROM ml_backend_service_pools WHERE legacy_instance_id IS NOT NULL;
        """
    )
    _rekey_user_pref_object_down("params_by_backend")
    _rekey_user_pref_object_down("model_by_backend")
    op.execute(
        """
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{ai,interactive_backend_by_project}',
          (SELECT COALESCE(jsonb_object_agg(kv.key,
                    COALESCE(to_jsonb(m.registry_id::text), kv.value)), '{}'::jsonb)
           FROM jsonb_each(u.preferences->'ai'->'interactive_backend_by_project') kv
           LEFT JOIN _pool_map_down m ON m.pool_id::text = (kv.value #>> '{}'))
        )
        WHERE u.preferences->'ai' ? 'interactive_backend_by_project'
          AND jsonb_typeof(u.preferences->'ai'->'interactive_backend_by_project') = 'object';
        """
    )
    op.execute(
        """
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{ai,secondary_by_model}',
          (SELECT COALESCE(jsonb_object_agg(new_key, val), '{}'::jsonb)
           FROM (
             SELECT
               CASE
                 WHEN kv.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:.*$'
                   THEN COALESCE(
                     (SELECT m.registry_id::text || ':' || split_part(kv.key, ':', 2)
                      FROM _pool_map_down m
                      WHERE m.pool_id::text = split_part(kv.key, ':', 1)),
                     kv.key)
                 ELSE kv.key
               END AS new_key,
               kv.value AS val
             FROM jsonb_each(u.preferences->'ai'->'secondary_by_model') kv
           ) d)
        )
        WHERE u.preferences->'ai' ? 'secondary_by_model'
          AND jsonb_typeof(u.preferences->'ai'->'secondary_by_model') = 'object';
        """
    )
    op.execute(
        """
        UPDATE projects p SET default_variants = (
          SELECT COALESCE(jsonb_object_agg(new_key, val), '{}'::jsonb)
          FROM (
            SELECT DISTINCT ON (COALESCE(m.registry_id::text, kv.key))
                   COALESCE(m.registry_id::text, kv.key) AS new_key, kv.value AS val
            FROM jsonb_each(p.default_variants) kv
            LEFT JOIN _pool_map_down m ON m.pool_id::text = kv.key
            ORDER BY COALESCE(m.registry_id::text, kv.key)
          ) d
        )
        WHERE p.default_variants IS NOT NULL
          AND jsonb_typeof(p.default_variants) = 'object'
          AND p.default_variants <> '{}'::jsonb;
        """
    )
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
                         (SELECT m.registry_id::text FROM _pool_map_down m
                          WHERE m.pool_id::text = elem->>'ml_backend_pool_id'),
                         elem->>'ml_backend_pool_id'
                       )
                     )
              ELSE elem
            END
          ), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(p.preannotate_pipeline, '[]'::jsonb)) AS t(elem)
        )
        WHERE p.preannotate_pipeline IS NOT NULL
          AND jsonb_typeof(p.preannotate_pipeline) = 'array';
        """
    )
    op.execute(
        """
        UPDATE project_ml_backend_pool pmb SET default_variants = (
          SELECT COALESCE(jsonb_object_agg(new_key, val), '{}'::jsonb)
          FROM (
            SELECT DISTINCT ON (COALESCE(m.registry_id::text, kv.key))
                   COALESCE(m.registry_id::text, kv.key) AS new_key, kv.value AS val
            FROM jsonb_each(COALESCE(pmb.default_variants, '{}'::jsonb)) kv
            LEFT JOIN _pool_map_down m ON m.pool_id::text = kv.key
            ORDER BY COALESCE(m.registry_id::text, kv.key)
          ) d
        )
        WHERE pmb.default_variants IS NOT NULL
          AND jsonb_typeof(pmb.default_variants) = 'object'
          AND pmb.default_variants <> '{}'::jsonb;
        """
    )

    # 6. 撤 predictions / failed_predictions 双 ID (父表 + 分区同步 drop)
    op.drop_constraint(
        "failed_predictions_ml_backend_pool_id_fkey",
        "failed_predictions",
        type_="foreignkey",
    )
    op.drop_column("failed_predictions", "ml_backend_pool_id")
    op.drop_constraint(
        "predictions_ml_backend_pool_id_fkey", "predictions", type_="foreignkey"
    )
    op.drop_column("predictions", "ml_backend_pool_id")

    # 5. projects.ml_backend_pool_id → ml_backend_id (回填 legacy registry; 不重建旧 FK)
    # 注: 升级前 projects.ml_backend_id 是 plain UUID 列, 无 DB FK; 降级只还原列名,
    # 不重建从未存在的 projects_ml_backend_id_fkey。
    op.drop_constraint(
        "projects_ml_backend_pool_id_fkey", "projects", type_="foreignkey"
    )
    op.execute(
        """
        UPDATE projects p SET ml_backend_pool_id = m.registry_id
        FROM _pool_map_down m WHERE p.ml_backend_pool_id = m.pool_id;
        """
    )
    op.alter_column(
        "projects",
        "ml_backend_pool_id",
        new_column_name="ml_backend_id",
        existing_type=postgresql.UUID(as_uuid=True),
        existing_nullable=True,
    )

    # 4. project_ml_backend_pool → project_ml_backend (先 drop FK + unique, 再回填 + 改列 + 改名 + 重建)
    op.execute(
        "ALTER TABLE project_ml_backend_pool DROP CONSTRAINT IF EXISTS project_ml_backend_pool_pool_id_fkey"
    )
    op.execute(
        "ALTER TABLE project_ml_backend_pool DROP CONSTRAINT IF EXISTS uq_project_ml_backend_pool"
    )
    op.execute(
        """
        UPDATE project_ml_backend_pool pmb SET pool_id = m.registry_id
        FROM _pool_map_down m WHERE pmb.pool_id = m.pool_id;
        """
    )
    op.alter_column(
        "project_ml_backend_pool",
        "pool_id",
        new_column_name="registry_id",
        existing_type=postgresql.UUID(as_uuid=True),
        existing_nullable=False,
    )
    op.rename_table("project_ml_backend_pool", "project_ml_backend")
    op.create_foreign_key(
        "project_ml_backend_registry_id_fkey",
        "project_ml_backend",
        "ml_backend_registry",
        ["registry_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_project_ml_backend", "project_ml_backend", ["project_id", "registry_id"]
    )

    # 1-3. 撤 pool/member 表
    op.drop_index("ix_ml_backend_pool_members_pool_id", table_name="ml_backend_pool_members")
    op.drop_table("ml_backend_pool_members")
    op.drop_table("ml_backend_service_pools")


def _rekey_user_pref_object_down(subkey: str) -> None:
    """Reverse of _rekey_user_pref_object: pool-key → registry-key via legacy map."""
    op.execute(
        f"""
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{{ai,{subkey}}}',
          (SELECT COALESCE(jsonb_object_agg(new_key, val), '{{}}'::jsonb)
           FROM (
             SELECT DISTINCT ON (COALESCE(m.registry_id::text, kv.key))
                    COALESCE(m.registry_id::text, kv.key) AS new_key, kv.value AS val
             FROM jsonb_each(u.preferences->'ai'->'{subkey}') kv
             LEFT JOIN _pool_map_down m ON m.pool_id::text = kv.key
             ORDER BY COALESCE(m.registry_id::text, kv.key)
           ) d)
        )
        WHERE u.preferences->'ai' ? '{subkey}'
          AND jsonb_typeof(u.preferences->'ai'->'{subkey}') = 'object';
        """
    )
