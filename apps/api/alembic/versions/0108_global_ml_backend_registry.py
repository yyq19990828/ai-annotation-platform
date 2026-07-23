"""v0.19.0 ADR-0044 · ML backend 全局注册表 + 项目级启用

把 ml_backends(项目作用域) 上提为 ml_backend_registry(全局, 按 url 去重) +
project_ml_backend(项目 × 注册项, enabled + 项目级覆盖)。

迁移要点(PR1 spike 验证项):
- 去重: DISTINCT ON (url) 取 last_checked_at 最新行进 registry; registry 复用 winner 的 id。
- 全量映射 _mlb_map(old_id -> registry_id) 重写所有引用:
  - FK: projects.ml_backend_id / predictions.ml_backend_id(分区表!) / failed_predictions.ml_backend_id
  - JSONB: users.preferences.ai 三子键 params_by_backend / model_by_backend(rekey) +
    interactive_backend_by_project(remap value)
- auth 冲突: 同 url 不同 auth_token/auth_method -> RAISE WARNING(不静默吞)。
- 溯源: N 项目用同一物理 backend 的历史 prediction 全部指向同一 registry 行(正确)。
- 落地后 DROP ml_backends(不留兼容视图)。
- downgrade: 仅「空窗口」(迁移后未产生新数据)可干净折叠回 per-project。

Revision ID: 0108
Revises: 0107
Create Date: 2026-06-29
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0108"
down_revision = "0107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. 两张新表 ──────────────────────────────────────────────────────────
    op.create_table(
        "ml_backend_registry",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("url", sa.String(1000), nullable=False),
        sa.Column("state", sa.String(30), server_default="disconnected"),
        sa.Column("is_interactive", sa.Boolean, server_default=sa.false()),
        sa.Column("auth_method", sa.String(20), server_default="none"),
        sa.Column("auth_token", sa.String(500), nullable=True),
        sa.Column(
            "extra_params",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
        ),
        sa.Column(
            "health_meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("source", sa.String(20), server_default="manual"),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.UniqueConstraint("url", name="uq_ml_backend_registry_url"),
    )
    op.create_table(
        "project_ml_backend",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registry_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("enabled", sa.Boolean, server_default=sa.true()),
        sa.Column("box_threshold", sa.Float, nullable=True),
        sa.Column("text_threshold", sa.Float, nullable=True),
        sa.Column(
            "default_variants", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["registry_id"], ["ml_backend_registry.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("project_id", "registry_id", name="uq_project_ml_backend"),
    )
    op.create_index(
        "ix_project_ml_backend_project_id", "project_ml_backend", ["project_id"]
    )
    op.create_index(
        "ix_project_ml_backend_registry_id", "project_ml_backend", ["registry_id"]
    )

    # ── 2. auth 冲突检测(同 url 不同凭证) -> WARNING, 不静默吞 ──────────────────
    op.execute(
        """
        DO $$
        DECLARE r record;
        BEGIN
          FOR r IN
            SELECT url, count(DISTINCT (auth_method, coalesce(auth_token,''))) AS n
            FROM ml_backends GROUP BY url HAVING count(DISTINCT (auth_method, coalesce(auth_token,''))) > 1
          LOOP
            RAISE WARNING 'ADR-0044 迁移: url=% 存在 % 种不同 auth 凭证, 去重将只保留最新 last_checked 行的凭证, 请运维核对', r.url, r.n;
          END LOOP;
        END $$;
        """
    )

    # ── 3. 回填 registry(DISTINCT ON url, 复用 winner id) ────────────────────
    op.execute(
        """
        INSERT INTO ml_backend_registry
          (id, name, url, state, is_interactive, auth_method, auth_token,
           extra_params, health_meta, source, error_message, last_checked_at,
           created_at, updated_at)
        SELECT DISTINCT ON (url)
           id, name, url, state, is_interactive, auth_method, auth_token,
           coalesce(extra_params, '{}'::jsonb), health_meta, 'manual', error_message,
           last_checked_at, created_at, now()
        FROM ml_backends
        ORDER BY url, last_checked_at DESC NULLS LAST, created_at DESC;
        """
    )

    # ── 4. 全量映射 old_id -> registry_id(winner) ───────────────────────────
    op.execute(
        """
        CREATE TEMP TABLE _mlb_map ON COMMIT DROP AS
        SELECT m.id AS old_id, r.id AS registry_id
        FROM ml_backends m JOIN ml_backend_registry r ON r.url = m.url;
        """
    )

    # ── 5. project_ml_backend: 每条原 ml_backends 行一条启用关联 ─────────────
    op.execute(
        """
        INSERT INTO project_ml_backend (id, project_id, registry_id, enabled)
        SELECT DISTINCT gen_random_uuid(), m.project_id, map.registry_id, true
        FROM ml_backends m JOIN _mlb_map map ON map.old_id = m.id
        ON CONFLICT (project_id, registry_id) DO NOTHING;
        """
    )

    # ── 6. FK 重指: projects / predictions(分区) / failed_predictions ────────
    op.execute(
        "UPDATE projects p SET ml_backend_id = map.registry_id "
        "FROM _mlb_map map WHERE p.ml_backend_id = map.old_id;"
    )
    op.execute(
        "UPDATE predictions pr SET ml_backend_id = map.registry_id "
        "FROM _mlb_map map WHERE pr.ml_backend_id = map.old_id;"
    )
    op.execute(
        "UPDATE failed_predictions fp SET ml_backend_id = map.registry_id "
        "FROM _mlb_map map WHERE fp.ml_backend_id = map.old_id;"
    )

    # ── 7. 偏好 JSONB 三子键重写 ────────────────────────────────────────────
    # params_by_backend / model_by_backend: key 是 backend id -> rekey
    # interactive_backend_by_project: value 是 backend id -> remap value
    # 多 old_id 映射同一 registry_id 时 DISTINCT ON 去重(任取一份, 见 spike 边界说明)
    for subkey in ("params_by_backend", "model_by_backend"):
        op.execute(
            f"""
            UPDATE users u SET preferences = jsonb_set(
              u.preferences, '{{ai,{subkey}}}',
              (SELECT coalesce(jsonb_object_agg(new_key, val), '{{}}'::jsonb)
               FROM (
                 SELECT DISTINCT ON (coalesce(map.registry_id::text, kv.key))
                        coalesce(map.registry_id::text, kv.key) AS new_key, kv.value AS val
                 FROM jsonb_each(u.preferences->'ai'->'{subkey}') kv
                 LEFT JOIN _mlb_map map ON map.old_id::text = kv.key
                 ORDER BY coalesce(map.registry_id::text, kv.key)
               ) d)
            )
            WHERE u.preferences->'ai' ? '{subkey}'
              AND jsonb_typeof(u.preferences->'ai'->'{subkey}') = 'object';
            """
        )
    op.execute(
        """
        UPDATE users u SET preferences = jsonb_set(
          u.preferences, '{ai,interactive_backend_by_project}',
          (SELECT coalesce(jsonb_object_agg(kv.key,
                    coalesce(to_jsonb(map.registry_id::text), kv.value)), '{}'::jsonb)
           FROM jsonb_each(u.preferences->'ai'->'interactive_backend_by_project') kv
           LEFT JOIN _mlb_map map ON map.old_id::text = (kv.value #>> '{}'))
        )
        WHERE u.preferences->'ai' ? 'interactive_backend_by_project'
          AND jsonb_typeof(u.preferences->'ai'->'interactive_backend_by_project') = 'object';
        """
    )

    # ── 8. 拆旧 FK -> 新 FK(指向 registry), 再 DROP ml_backends ──────────────
    op.drop_constraint("projects_ml_backend_id_fkey", "projects", type_="foreignkey")
    op.drop_constraint(
        "predictions_ml_backend_id_fkey1", "predictions", type_="foreignkey"
    )
    op.drop_constraint(
        "failed_predictions_ml_backend_id_fkey",
        "failed_predictions",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "projects_ml_backend_id_fkey",
        "projects",
        "ml_backend_registry",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "predictions_ml_backend_id_fkey",
        "predictions",
        "ml_backend_registry",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "failed_predictions_ml_backend_id_fkey",
        "failed_predictions",
        "ml_backend_registry",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.drop_table("ml_backends")


def downgrade() -> None:
    # 仅「空窗口」(迁移后未产生新注册/新预标)可干净折叠。新模型运行后产生的数据
    # (启用在 0 项目的全局 backend、多项目共享的 registry 行)无法无歧义还原 -> forward-only。
    op.create_table(
        "ml_backends",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("url", sa.String(1000), nullable=False),
        sa.Column("state", sa.String(30), server_default="disconnected"),
        sa.Column("is_interactive", sa.Boolean, server_default=sa.false()),
        sa.Column("auth_method", sa.String(20), server_default="none"),
        sa.Column("auth_token", sa.String(500), nullable=True),
        sa.Column(
            "extra_params", postgresql.JSONB(astext_type=sa.Text()), server_default="{}"
        ),
        sa.Column(
            "health_meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
    )
    op.create_index("ix_ml_backends_project_id", "ml_backends", ["project_id"])

    # 按 project_ml_backend 展开回 per-project 行。每个 registry_id 的「第一」条复用
    # registry id(保 projects/predictions FK 仍命中), 同 registry 被多项目启用时其余
    # 行发新 id(否则 id 冲突会丢绑定)。注: 哪个项目保「真」id 是任取 -> 折叠仍非完全可逆。
    op.execute(
        """
        INSERT INTO ml_backends
          (id, project_id, name, url, state, is_interactive, auth_method,
           auth_token, extra_params, health_meta, error_message, last_checked_at,
           created_at, updated_at)
        SELECT
          CASE WHEN row_number() OVER (PARTITION BY pmb.registry_id ORDER BY pmb.created_at, pmb.project_id) = 1
               THEN pmb.registry_id ELSE gen_random_uuid() END,
          pmb.project_id, r.name, r.url, r.state, r.is_interactive, r.auth_method,
          r.auth_token, r.extra_params, r.health_meta, r.error_message,
          r.last_checked_at, r.created_at, now()
        FROM project_ml_backend pmb JOIN ml_backend_registry r ON r.id = pmb.registry_id;
        """
    )

    # FK 指回 ml_backends
    op.drop_constraint("projects_ml_backend_id_fkey", "projects", type_="foreignkey")
    op.drop_constraint(
        "predictions_ml_backend_id_fkey", "predictions", type_="foreignkey"
    )
    op.drop_constraint(
        "failed_predictions_ml_backend_id_fkey",
        "failed_predictions",
        type_="foreignkey",
    )
    # 折叠后被多项目共享的 registry 行只还原成 1 个 backend 行(复用 registry id);
    # 指向它的 prediction/projects FK 仍有效(id 未变)。空窗口下两者一致。
    op.create_foreign_key(
        "projects_ml_backend_id_fkey",
        "projects",
        "ml_backends",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "predictions_ml_backend_id_fkey1",
        "predictions",
        "ml_backends",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "failed_predictions_ml_backend_id_fkey",
        "failed_predictions",
        "ml_backends",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_index("ix_project_ml_backend_registry_id", "project_ml_backend")
    op.drop_index("ix_project_ml_backend_project_id", "project_ml_backend")
    op.drop_table("project_ml_backend")
    op.drop_table("ml_backend_registry")
