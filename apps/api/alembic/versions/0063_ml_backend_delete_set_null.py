"""B-28 · 允许删除已有预测/job 历史的 ml_backend

把 predictions / failed_predictions / prediction_jobs 三张表对 ml_backends 的 FK
从默认 NO ACTION / RESTRICT 改成 ON DELETE SET NULL，并把
prediction_jobs.ml_backend_id 改为 nullable。这样删除一个 ml_backend 时,
历史预测和 job 记录的关联会被置空但保留下来,而非整体 RESTRICT 阻断删除。

Revision ID: 0063
Revises: 0062
Create Date: 2026-05-13
"""

from alembic import op


revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "predictions_ml_backend_id_fkey", "predictions", type_="foreignkey"
    )
    op.create_foreign_key(
        "predictions_ml_backend_id_fkey",
        "predictions",
        "ml_backends",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint(
        "failed_predictions_ml_backend_id_fkey",
        "failed_predictions",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "failed_predictions_ml_backend_id_fkey",
        "failed_predictions",
        "ml_backends",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.alter_column("prediction_jobs", "ml_backend_id", nullable=True)
    op.drop_constraint(
        "prediction_jobs_ml_backend_id_fkey",
        "prediction_jobs",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "prediction_jobs_ml_backend_id_fkey",
        "prediction_jobs",
        "ml_backends",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "prediction_jobs_ml_backend_id_fkey",
        "prediction_jobs",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "prediction_jobs_ml_backend_id_fkey",
        "prediction_jobs",
        "ml_backends",
        ["ml_backend_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.alter_column("prediction_jobs", "ml_backend_id", nullable=False)

    op.drop_constraint(
        "failed_predictions_ml_backend_id_fkey",
        "failed_predictions",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "failed_predictions_ml_backend_id_fkey",
        "failed_predictions",
        "ml_backends",
        ["ml_backend_id"],
        ["id"],
    )

    op.drop_constraint(
        "predictions_ml_backend_id_fkey", "predictions", type_="foreignkey"
    )
    op.create_foreign_key(
        "predictions_ml_backend_id_fkey",
        "predictions",
        "ml_backends",
        ["ml_backend_id"],
        ["id"],
    )
