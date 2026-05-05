"""P0 restructuring: enums, organizations, ml_backends, predictions, task_locks, enriched fields

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Role/status enum migration (Chinese → English) ────────────────────

    op.execute("""
        UPDATE users SET role = CASE role
            WHEN '超级��理员' THEN 'super_admin'
            WHEN '项目管理员' THEN 'project_admin'
            WHEN '质检员'     THEN 'reviewer'
            WHEN '标注员'     THEN 'annotator'
            ELSE 'annotator'
        END
    """)
    op.alter_column("users", "role", server_default="annotator")

    op.execute("""
        UPDATE projects SET status = CASE status
            WHEN '进行中' THEN 'in_progress'
            WHEN '已完成' THEN 'completed'
            WHEN '待审核' THEN 'pending_review'
            ELSE 'in_progress'
        END
    """)
    op.alter_column("projects", "status", server_default="in_progress")

    # ── 2. Organizations ────��────────────────────────────────────────────────

    op.create_table(
        "organizations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("contact_info", JSONB(), nullable=False, server_default="{}"),
        sa.Column(
            "created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_organizations_slug", "organizations", ["slug"], unique=True)

    op.create_table(
        "organization_members",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "organization_id",
            UUID(as_uuid=True),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("role", sa.String(30), nullable=False, server_default="member"),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_org_member"),
    )
    op.create_index(
        "ix_org_members_org_id", "organization_members", ["organization_id"]
    )
    op.create_index("ix_org_members_user_id", "organization_members", ["user_id"])

    # ── 3. ML Backends ───────────────────────────────────────────────────────

    op.create_table(
        "ml_backends",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("url", sa.String(1000), nullable=False),
        sa.Column(
            "state", sa.String(30), nullable=False, server_default="disconnected"
        ),
        sa.Column(
            "is_interactive", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column("auth_method", sa.String(20), nullable=False, server_default="none"),
        sa.Column("auth_token", sa.String(500)),
        sa.Column("extra_params", JSONB(), nullable=False, server_default="{}"),
        sa.Column("error_message", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_ml_backends_project_id", "ml_backends", ["project_id"])

    # ── 4. Failed Predictions (must exist before predictions for FK) ─────────

    op.create_table(
        "failed_predictions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id")),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("ml_backend_id", UUID(as_uuid=True), sa.ForeignKey("ml_backends.id")),
        sa.Column("model_version", sa.String(100)),
        sa.Column("error_type", sa.String(100), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_failed_predictions_project_id", "failed_predictions", ["project_id"]
    )

    # ── 5. Predictions ─────────��───────────────────────────────��─────────────

    op.create_table(
        "predictions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id"), nullable=False
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("ml_backend_id", UUID(as_uuid=True), sa.ForeignKey("ml_backends.id")),
        sa.Column("model_version", sa.String(100)),
        sa.Column("score", sa.Float()),
        sa.Column("result", JSONB(), nullable=False),
        sa.Column("cluster", sa.Integer()),
        sa.Column("mislabeling", sa.Float()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_predictions_task_id", "predictions", ["task_id"])
    op.create_index("ix_predictions_project_id", "predictions", ["project_id"])

    # ��─ 6. Prediction Metas ─────���────────────────────────────────────────────

    op.create_table(
        "prediction_metas",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "prediction_id",
            UUID(as_uuid=True),
            sa.ForeignKey("predictions.id"),
            unique=True,
        ),
        sa.Column(
            "failed_prediction_id",
            UUID(as_uuid=True),
            sa.ForeignKey("failed_predictions.id"),
        ),
        sa.Column("inference_time_ms", sa.Integer()),
        sa.Column("prompt_tokens", sa.Integer()),
        sa.Column("completion_tokens", sa.Integer()),
        sa.Column("total_tokens", sa.Integer()),
        sa.Column("prompt_cost", sa.Float()),
        sa.Column("completion_cost", sa.Float()),
        sa.Column("total_cost", sa.Float()),
        sa.Column("extra", JSONB(), nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ── 7. Task Locks ────────��───────────────────────────────────────────────

    op.create_table(
        "task_locks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id"), nullable=False
        ),
        sa.Column(
            "user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("expire_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("unique_id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("task_id", "user_id", name="uq_task_lock"),
    )
    op.create_index("ix_task_locks_task_id", "task_locks", ["task_id"])
    op.create_index("ix_task_locks_user_id", "task_locks", ["user_id"])

    # ── 8. Annotation Drafts ────────────────────────��────────────────────────

    op.create_table(
        "annotation_drafts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id"), nullable=False
        ),
        sa.Column("annotation_id", UUID(as_uuid=True), sa.ForeignKey("annotations.id")),
        sa.Column(
            "user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("result", JSONB(), nullable=False),
        sa.Column(
            "was_postponed", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_annotation_drafts_task_id", "annotation_drafts", ["task_id"])
    op.create_index("ix_annotation_drafts_user_id", "annotation_drafts", ["user_id"])

    # ── 9. Enrich projects ────────��───────────────────────────────���──────────

    op.add_column(
        "projects",
        sa.Column(
            "organization_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id")
        ),
    )
    op.add_column(
        "projects",
        sa.Column("label_config", JSONB(), nullable=False, server_default="{}"),
    )
    op.add_column(
        "projects",
        sa.Column("sampling", sa.String(30), nullable=False, server_default="sequence"),
    )
    op.add_column(
        "projects",
        sa.Column(
            "maximum_annotations", sa.Integer(), nullable=False, server_default="1"
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "show_overlap_first", sa.Boolean(), nullable=False, server_default="false"
        ),
    )
    op.add_column("projects", sa.Column("model_version", sa.String(100)))
    op.add_column(
        "projects",
        sa.Column(
            "task_lock_ttl_seconds", sa.Integer(), nullable=False, server_default="300"
        ),
    )

    # ── 10. Enrich tasks ───────────────────────────────────────────────���─────

    op.add_column(
        "tasks",
        sa.Column("is_labeled", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "tasks", sa.Column("overlap", sa.Integer(), nullable=False, server_default="1")
    )
    op.add_column(
        "tasks",
        sa.Column(
            "total_annotations", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "tasks",
        sa.Column(
            "total_predictions", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column("tasks", sa.Column("precomputed_agreement", sa.Float()))
    op.add_column(
        "tasks",
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
    )
    op.create_index("ix_tasks_is_labeled", "tasks", ["is_labeled"])

    # ── 11. Enrich annotations ───��───────────────────────────────────────────

    op.add_column(
        "annotations",
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id")),
    )
    op.add_column(
        "annotations",
        sa.Column(
            "parent_prediction_id", UUID(as_uuid=True), sa.ForeignKey("predictions.id")
        ),
    )
    op.add_column(
        "annotations",
        sa.Column(
            "parent_annotation_id", UUID(as_uuid=True), sa.ForeignKey("annotations.id")
        ),
    )
    op.add_column("annotations", sa.Column("lead_time", sa.Float()))
    op.add_column(
        "annotations",
        sa.Column(
            "was_cancelled", sa.Boolean(), nullable=False, server_default="false"
        ),
    )
    op.add_column(
        "annotations",
        sa.Column("ground_truth", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "annotations",
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
    )

    # Backfill project_id on existing annotations
    op.execute("""
        UPDATE annotations SET project_id = (
            SELECT project_id FROM tasks WHERE tasks.id = annotations.task_id
        )
    """)

    # Update source field default
    op.alter_column("annotations", "source", server_default="manual")


def downgrade() -> None:
    # Drop new columns from annotations
    op.drop_column("annotations", "updated_at")
    op.drop_column("annotations", "ground_truth")
    op.drop_column("annotations", "was_cancelled")
    op.drop_column("annotations", "lead_time")
    op.drop_column("annotations", "parent_annotation_id")
    op.drop_column("annotations", "parent_prediction_id")
    op.drop_column("annotations", "project_id")
    op.alter_column("annotations", "source", server_default=None)

    # Drop new columns from tasks
    op.drop_index("ix_tasks_is_labeled", table_name="tasks")
    op.drop_column("tasks", "updated_at")
    op.drop_column("tasks", "precomputed_agreement")
    op.drop_column("tasks", "total_predictions")
    op.drop_column("tasks", "total_annotations")
    op.drop_column("tasks", "overlap")
    op.drop_column("tasks", "is_labeled")

    # Drop new columns from projects
    op.drop_column("projects", "task_lock_ttl_seconds")
    op.drop_column("projects", "model_version")
    op.drop_column("projects", "show_overlap_first")
    op.drop_column("projects", "maximum_annotations")
    op.drop_column("projects", "sampling")
    op.drop_column("projects", "label_config")
    op.drop_column("projects", "organization_id")

    # Drop new tables (reverse order of creation)
    op.drop_table("annotation_drafts")
    op.drop_table("task_locks")
    op.drop_table("prediction_metas")
    op.drop_table("predictions")
    op.drop_table("failed_predictions")
    op.drop_table("ml_backends")
    op.drop_table("organization_members")
    op.drop_table("organizations")

    # Revert enum values
    op.execute("""
        UPDATE projects SET status = CASE status
            WHEN 'in_progress'     THEN '进行中'
            WHEN 'completed'       THEN '已完成'
            WHEN 'pending_review'  THEN '待审核'
            ELSE '进行��'
        END
    """)
    op.alter_column("projects", "status", server_default="进行中")

    op.execute("""
        UPDATE users SET role = CASE role
            WHEN 'super_admin'   THEN '超级管理员'
            WHEN 'project_admin' THEN '项目���理员'
            WHEN 'reviewer'      THEN '质检员'
            WHEN 'annotator'     THEN '标注员'
            ELSE '标注员'
        END
    """)
    op.alter_column("users", "role", server_default="标注员")
