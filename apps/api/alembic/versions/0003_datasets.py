"""Datasets: decouple data from projects (Dataset, DatasetItem, ProjectDataset)

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Create datasets table ────────────────────────────────────────────
    op.create_table(
        "datasets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("display_id", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("data_type", sa.String(30), nullable=False, server_default="image"),
        sa.Column("file_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # ── 2. Create dataset_items table ───────────────────────────────────────
    op.create_table(
        "dataset_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("dataset_id", UUID(as_uuid=True), sa.ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_name", sa.String(500), nullable=False),
        sa.Column("file_path", sa.String(1000), nullable=False),
        sa.Column("file_type", sa.String(20), nullable=False, server_default="image"),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("metadata", JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_dataset_items_dataset_id", "dataset_items", ["dataset_id"])

    # ── 3. Create project_datasets junction table ───────────────────────────
    op.create_table(
        "project_datasets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dataset_id", UUID(as_uuid=True), sa.ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_project_datasets_project_id", "project_datasets", ["project_id"])
    op.create_index("ix_project_datasets_dataset_id", "project_datasets", ["dataset_id"])
    op.create_unique_constraint("uq_project_dataset", "project_datasets", ["project_id", "dataset_id"])

    # ── 4. Add dataset_item_id to tasks ─────────────────────────────────────
    op.add_column("tasks", sa.Column("dataset_item_id", UUID(as_uuid=True), sa.ForeignKey("dataset_items.id"), nullable=True))
    op.create_index("ix_tasks_dataset_item_id", "tasks", ["dataset_item_id"])

    # ── 5. Data migration: create datasets from existing projects ───────────
    conn = op.get_bind()

    projects = conn.execute(sa.text(
        "SELECT id, name, type_key, owner_id FROM projects"
    )).fetchall()

    for proj in projects:
        proj_id, proj_name, type_key, owner_id = proj

        data_type = "image"
        if type_key and "video" in type_key:
            data_type = "video"
        elif type_key and "lidar" in type_key:
            data_type = "point_cloud"
        elif type_key and "mm" in type_key:
            data_type = "multimodal"

        ds_display_id = f"DS-{str(proj_id)[:6].upper()}"

        conn.execute(sa.text("""
            INSERT INTO datasets (id, display_id, name, description, data_type, file_count, created_by)
            VALUES (gen_random_uuid(), :display_id, :name, :description, :data_type,
                    (SELECT COUNT(*) FROM tasks WHERE project_id = :proj_id),
                    :owner_id)
        """), {
            "display_id": ds_display_id,
            "name": proj_name,
            "description": f"从项目 {proj_name} 自动迁移",
            "data_type": data_type,
            "proj_id": proj_id,
            "owner_id": owner_id,
        })

        ds_id = conn.execute(sa.text(
            "SELECT id FROM datasets WHERE display_id = :did"
        ), {"did": ds_display_id}).scalar()

        conn.execute(sa.text("""
            INSERT INTO project_datasets (id, project_id, dataset_id)
            VALUES (gen_random_uuid(), :proj_id, :ds_id)
        """), {"proj_id": proj_id, "ds_id": ds_id})

        tasks = conn.execute(sa.text(
            "SELECT id, file_name, file_path, file_type FROM tasks WHERE project_id = :proj_id"
        ), {"proj_id": proj_id}).fetchall()

        for task in tasks:
            task_id, file_name, file_path, file_type = task
            conn.execute(sa.text("""
                INSERT INTO dataset_items (id, dataset_id, file_name, file_path, file_type)
                VALUES (gen_random_uuid(), :ds_id, :file_name, :file_path, :file_type)
                RETURNING id
            """), {
                "ds_id": ds_id,
                "file_name": file_name,
                "file_path": file_path,
                "file_type": file_type or "image",
            })
            item_id = conn.execute(sa.text(
                "SELECT id FROM dataset_items WHERE dataset_id = :ds_id AND file_path = :fp"
            ), {"ds_id": ds_id, "fp": file_path}).scalar()

            conn.execute(sa.text(
                "UPDATE tasks SET dataset_item_id = :item_id WHERE id = :task_id"
            ), {"item_id": item_id, "task_id": task_id})


def downgrade() -> None:
    op.drop_index("ix_tasks_dataset_item_id", table_name="tasks")
    op.drop_column("tasks", "dataset_item_id")
    op.drop_table("project_datasets")
    op.drop_table("dataset_items")
    op.drop_table("datasets")
