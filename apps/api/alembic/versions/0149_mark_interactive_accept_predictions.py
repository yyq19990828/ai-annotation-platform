"""Mark accepted interactive Mask predictions as provenance-only.

Revision ID: 0149
Revises: 0148

Native Mask acceptance keeps a Prediction row for audit and model lineage. Those
rows are already decided and must never be treated as pending review candidates.
"""

import sqlalchemy as sa
from alembic import op


revision = "0149"
down_revision = "0148"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE predictions AS p "
            "SET source = 'interactive_accept' "
            "FROM prediction_metas AS pm "
            "WHERE pm.prediction_id = p.id "
            "AND pm.prediction_created_at = p.created_at "
            "AND pm.extra ? 'mask_ai_accept' "
            "AND p.source = 'ml_backend'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE predictions "
            "SET source = 'ml_backend' "
            "WHERE source = 'interactive_accept'"
        )
    )
