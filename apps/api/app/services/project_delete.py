"""Shared project deletion transaction used by the API and dev seed repair."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.project import Project


async def delete_project_records(db: AsyncSession, project: Project) -> None:
    """Delete one project and its non-cascading children without committing."""
    params = {"pid": str(project.id)}
    await db.execute(
        text("DELETE FROM annotation_comments WHERE project_id = :pid"), params
    )
    await db.execute(
        text("DELETE FROM annotation_feedbacks WHERE project_id = :pid"), params
    )
    await db.execute(
        text(
            "DELETE FROM annotation_drafts WHERE task_id IN "
            "(SELECT id FROM tasks WHERE project_id = :pid)"
        ),
        params,
    )
    await db.execute(
        text(
            "DELETE FROM prediction_metas WHERE prediction_id IN "
            "(SELECT id FROM predictions WHERE project_id = :pid) "
            "OR failed_prediction_id IN "
            "(SELECT id FROM failed_predictions WHERE project_id = :pid)"
        ),
        params,
    )
    await db.execute(
        text(
            "UPDATE annotations SET parent_prediction_id = NULL, "
            "parent_annotation_id = NULL WHERE project_id = :pid"
        ),
        params,
    )
    await db.execute(text("DELETE FROM annotations WHERE project_id = :pid"), params)
    await db.execute(text("DELETE FROM predictions WHERE project_id = :pid"), params)
    await db.execute(
        text("DELETE FROM failed_predictions WHERE project_id = :pid"), params
    )
    await db.execute(
        text(
            "DELETE FROM task_locks WHERE task_id IN "
            "(SELECT id FROM tasks WHERE project_id = :pid)"
        ),
        params,
    )
    # Global backend registry rows are reusable and never belong to one project.
    # Project-backend association rows are removed by the project cascade.
    await db.execute(
        text("UPDATE bug_reports SET project_id = NULL WHERE project_id = :pid"),
        params,
    )
    # Historical reports can retain a task reference after their project reference
    # was cleared, so detach task references by actual project task ownership.
    await db.execute(
        text(
            "UPDATE bug_reports SET task_id = NULL WHERE task_id IN "
            "(SELECT id FROM tasks WHERE project_id = :pid)"
        ),
        params,
    )
    await db.execute(text("DELETE FROM tasks WHERE project_id = :pid"), params)
    await db.delete(project)
    await db.flush()
