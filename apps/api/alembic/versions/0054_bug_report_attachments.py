"""BUG report multi-image attachments

Revision ID: 0054
Revises: 0053
Create Date: 2026-05-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bug_reports",
        sa.Column(
            "attachments",
            JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.execute(
        """
        UPDATE bug_reports
        SET attachments = jsonb_build_array(
          jsonb_build_object(
            'storageKey', screenshot_url,
            'fileName', COALESCE(NULLIF(regexp_replace(screenshot_url, '^.*/', ''), ''), 'screenshot.png'),
            'mimeType', 'image/png',
            'size', 0
          )
        )
        WHERE screenshot_url IS NOT NULL
          AND screenshot_url <> ''
          AND attachments = '[]'::jsonb
        """
    )


def downgrade() -> None:
    op.drop_column("bug_reports", "attachments")
