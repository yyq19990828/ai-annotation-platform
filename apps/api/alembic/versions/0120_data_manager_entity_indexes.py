"""Add active annotation indexes for Data Manager entity queries.

Revision ID: 0120
Revises: 0119

The migration runner wraps revisions in a transaction, so production databases with
large annotation tables should pre-create these indexes concurrently during a low-write
window. The migration then becomes a no-op through ``IF NOT EXISTS``::

    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_annotations_project_updated_active
      ON annotations (project_id, updated_at, id)
      WHERE is_active = true AND was_cancelled = false;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_annotations_project_class_active
      ON annotations (project_id, class_name, id)
      WHERE is_active = true AND was_cancelled = false;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_annotations_project_source_active
      ON annotations (project_id, source, id)
      WHERE is_active = true AND was_cancelled = false;
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_annotations_project_tool_type_active
      ON annotations (project_id, tool_unit_id, annotation_type, id)
      WHERE is_active = true AND was_cancelled = false;
"""

from alembic import op
import sqlalchemy as sa


revision = "0120"
down_revision = "0119"
branch_labels = None
depends_on = None


_WHERE = "is_active = true AND was_cancelled = false"
_INDEXES: list[tuple[str, list[str]]] = [
    (
        "ix_annotations_project_updated_active",
        ["project_id", "updated_at", "id"],
    ),
    (
        "ix_annotations_project_class_active",
        ["project_id", "class_name", "id"],
    ),
    (
        "ix_annotations_project_source_active",
        ["project_id", "source", "id"],
    ),
    (
        "ix_annotations_project_tool_type_active",
        ["project_id", "tool_unit_id", "annotation_type", "id"],
    ),
]


def upgrade() -> None:
    for name, columns in _INDEXES:
        op.create_index(
            name,
            "annotations",
            columns,
            unique=False,
            if_not_exists=True,
            postgresql_where=sa.text(_WHERE),
        )


def downgrade() -> None:
    for name, _columns in reversed(_INDEXES):
        op.drop_index(name, table_name="annotations", if_exists=True)
