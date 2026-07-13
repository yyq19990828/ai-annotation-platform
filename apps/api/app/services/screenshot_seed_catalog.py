"""Resolve the screenshot seed profile to runtime IDs and validate readiness."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import Dataset, ProjectDataset
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.user import User
from app.services.ml_backend import MLBackendService


SCHEMA_VERSION = 1
SEED_REVISION = "screenshots-2026-07-a"
USER_SPECS = {
    "admin": ("admin", "super_admin"),
    "project_admin": ("pm", "project_admin"),
    "annotator": ("anno", "annotator"),
    "reviewer": ("qa", "reviewer"),
}


@dataclass(frozen=True)
class ProjectSpec:
    display_id: str
    data_type: str
    task_keys: tuple[str, ...]
    required_backend: str | None = None
    required_batch_statuses: tuple[str, ...] = ()
    require_members: bool = False


PROJECT_SPECS = {
    "image_demo": ProjectSpec(
        display_id="P-COCO8",
        data_type="image",
        task_keys=(
            "clean",
            "predicted",
            "annotating",
            "submitted",
            "review",
            "completed",
            "spare_1",
            "spare_2",
        ),
        required_backend="image",
        required_batch_statuses=("draft", "annotating", "reviewing", "approved"),
        require_members=True,
    ),
    "video_demo": ProjectSpec(
        display_id="P-VIDEO-DEV",
        data_type="video",
        task_keys=("tracking",),
        required_backend="tracker",
    ),
    "pointcloud_demo": ProjectSpec(
        display_id="P-PC-DEV",
        data_type="lidar",
        task_keys=("frame_000",),
    ),
    "ocr_demo": ProjectSpec(
        display_id="P-OCR",
        data_type="image",
        task_keys=("ocr",),
    ),
}


class ScreenshotSeedCatalogError(RuntimeError):
    def __init__(self, issues: list[str]):
        super().__init__("screenshot seed profile is not ready")
        self.issues = issues


def _task_payload(task: Task) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "display_id": task.display_id,
        "file_name": task.file_name,
        "file_path": task.file_path,
        "status": task.status,
    }


async def _resolve_backend(
    db: AsyncSession,
    project: Project,
    spec: ProjectSpec,
    issues: list[str],
) -> dict[str, Any] | None:
    if spec.required_backend is None:
        return None

    prefix = project.display_id
    if not project.ai_enabled:
        issues.append(f"{prefix}: ai_enabled must be true")
    if spec.required_backend == "image" and not project.ai_interactive_enabled:
        issues.append(f"{prefix}: ai_interactive_enabled must be true")
    if project.ml_backend_id is None:
        issues.append(f"{prefix}: primary ML backend is not bound")

    service = MLBackendService(db)
    backend = await service.get_project_backend(project.id)
    if backend is None:
        issues.append(f"{prefix}: no enabled project ML backend resolves")
        return None
    if project.ml_backend_id != backend.id:
        issues.append(
            f"{prefix}: resolved ML backend is not the declared primary backend"
        )
    if backend.state != "connected":
        issues.append(f"{prefix}: ML backend {backend.name} is not connected")
    capabilities = (backend.health_meta or {}).get("capabilities")
    if not isinstance(capabilities, dict) or not capabilities:
        issues.append(f"{prefix}: ML backend capabilities snapshot is missing")
        capabilities = {}
    if spec.required_backend == "image" and not backend.is_interactive:
        issues.append(f"{prefix}: primary ML backend is not interactive")
    if spec.required_backend == "tracker":
        trackers = capabilities.get("supported_trackers") or []
        if not trackers:
            issues.append(f"{prefix}: ML backend has no supported_trackers capability")
        elif await service.get_tracker_backend(project.id, trackers[0]) is None:
            issues.append(
                f"{prefix}: tracker capability does not resolve through project binding"
            )

    return {
        "id": str(backend.id),
        "name": backend.name,
        "state": backend.state,
        "is_interactive": backend.is_interactive,
        "capabilities": capabilities,
    }


async def _resolve_project(
    db: AsyncSession,
    logical_key: str,
    spec: ProjectSpec,
    users: dict[str, User],
    issues: list[str],
) -> dict[str, Any] | None:
    project = await db.scalar(
        select(Project).where(Project.display_id == spec.display_id)
    )
    if project is None:
        issues.append(f"{spec.display_id}: project is missing")
        return None
    if project.data_type != spec.data_type:
        issues.append(
            f"{spec.display_id}: data_type must be {spec.data_type}, got {project.data_type}"
        )

    task_rows = list(
        (await db.execute(select(Task).where(Task.project_id == project.id))).scalars()
    )
    task_rows.sort(key=lambda task: (task.file_name, task.file_path, str(task.id)))
    if len(task_rows) < len(spec.task_keys):
        issues.append(
            f"{spec.display_id}: expected at least {len(spec.task_keys)} tasks, "
            f"found {len(task_rows)}"
        )
    tasks = {
        key: _task_payload(task)
        for key, task in zip(spec.task_keys, task_rows, strict=False)
    }

    if logical_key == "image_demo" and len(task_rows) >= 6:
        expected_status = {
            "clean": "pending",
            "predicted": "pending",
            "annotating": "in_progress",
            "submitted": "review",
            "review": "review",
            "completed": "completed",
        }
        for key, status in expected_status.items():
            if tasks[key]["status"] != status:
                issues.append(
                    f"{spec.display_id}: task {key} must have status {status}"
                )
        if task_rows[0].total_predictions:
            issues.append(f"{spec.display_id}: task clean must not contain predictions")
        if not task_rows[1].total_predictions:
            issues.append(
                f"{spec.display_id}: task predicted must contain a prediction"
            )
        annotator = users.get("annotator")
        reviewer = users.get("reviewer")
        if annotator is not None and task_rows[2].assignee_id != annotator.id:
            issues.append(
                f"{spec.display_id}: task annotating must be assigned to anno"
            )
        if reviewer is not None and task_rows[4].reviewer_id != reviewer.id:
            issues.append(f"{spec.display_id}: task review must be assigned to qa")

    datasets = list(
        (
            await db.execute(
                select(Dataset)
                .join(ProjectDataset, ProjectDataset.dataset_id == Dataset.id)
                .where(ProjectDataset.project_id == project.id)
                .order_by(Dataset.display_id)
            )
        ).scalars()
    )
    if not datasets:
        issues.append(f"{spec.display_id}: no dataset is linked")

    batches = list(
        (
            await db.execute(
                select(TaskBatch)
                .where(TaskBatch.project_id == project.id)
                .order_by(TaskBatch.display_id)
            )
        ).scalars()
    )
    batch_payload: dict[str, dict[str, Any]] = {}
    for status in spec.required_batch_statuses:
        matching = next((batch for batch in batches if batch.status == status), None)
        if matching is None:
            issues.append(f"{spec.display_id}: batch status {status} is missing")
            continue
        key = status
        if status == "reviewing":
            key = "review"
        elif status == "approved":
            key = "completed"
        batch_payload[key] = {
            "id": str(matching.id),
            "display_id": matching.display_id,
            "status": matching.status,
        }

    if spec.require_members:
        members = list(
            (
                await db.execute(
                    select(ProjectMember).where(ProjectMember.project_id == project.id)
                )
            ).scalars()
        )
        required_members = {
            "annotator": (users.get("annotator"), "annotator"),
            "reviewer": (users.get("reviewer"), "reviewer"),
        }
        for role_key, (user, member_role) in required_members.items():
            if user is not None and not any(
                member.user_id == user.id and member.role == member_role
                for member in members
            ):
                issues.append(
                    f"{spec.display_id}: {role_key} project membership is missing"
                )

    backend = await _resolve_backend(db, project, spec, issues)
    return {
        "id": str(project.id),
        "display_id": project.display_id,
        "name": project.name,
        "data_type": project.data_type,
        "datasets": {
            dataset.display_id: {
                "id": str(dataset.id),
                "name": dataset.name,
                "file_count": dataset.file_count,
            }
            for dataset in datasets
        },
        "tasks": tasks,
        "batches": batch_payload,
        "ml_backend": backend,
    }


async def build_screenshot_seed_catalog(db: AsyncSession) -> dict[str, Any]:
    issues: list[str] = []
    users: dict[str, User] = {}
    user_payload: dict[str, dict[str, str]] = {}
    for logical_key, (email, role) in USER_SPECS.items():
        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            issues.append(f"user {logical_key} ({email}) is missing")
            continue
        if user.role != role:
            issues.append(f"user {email} must have role {role}, got {user.role}")
        if not user.is_active:
            issues.append(f"user {email} must be active")
        users[logical_key] = user
        user_payload[logical_key] = {
            "id": str(user.id),
            "email": user.email,
            "role": user.role,
        }

    project_payload: dict[str, Any] = {}
    for logical_key, spec in PROJECT_SPECS.items():
        project = await _resolve_project(db, logical_key, spec, users, issues)
        if project is not None:
            project_payload[logical_key] = project

    if issues:
        raise ScreenshotSeedCatalogError(issues)
    return {
        "schema_version": SCHEMA_VERSION,
        "seed_revision": SEED_REVISION,
        "users": user_payload,
        "projects": project_payload,
    }
