from __future__ import annotations

import uuid

import pytest

from app.db.models.dataset import Dataset, ProjectDataset
from app.db.models.ml_backend_registry import MLBackendRegistry, ProjectMLBackend
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.user import User
from app.services.screenshot_seed_catalog import PROJECT_SPECS


pytestmark = pytest.mark.asyncio


async def _ready_profile(db):
    user_rows: dict[str, User] = {}
    for email, role in (
        ("admin", "super_admin"),
        ("pm", "project_admin"),
        ("anno", "annotator"),
        ("qa", "reviewer"),
    ):
        user = User(
            id=uuid.uuid4(),
            email=email,
            name=email,
            password_hash="test",
            role=role,
            is_active=True,
        )
        db.add(user)
        user_rows[email] = user
    await db.flush()

    projects: dict[str, Project] = {}
    task_statuses = [
        "pending",
        "pending",
        "in_progress",
        "review",
        "review",
        "completed",
        "pending",
        "pending",
    ]
    for logical_key, spec in PROJECT_SPECS.items():
        project = Project(
            id=uuid.uuid4(),
            display_id=spec.display_id,
            name=logical_key,
            type_label=logical_key,
            type_key=logical_key,
            data_type=spec.data_type,
            owner_id=user_rows["pm"].id,
            ai_enabled=spec.required_backend is not None,
            ai_interactive_enabled=True,
        )
        db.add(project)
        projects[logical_key] = project
        dataset = Dataset(
            id=uuid.uuid4(),
            display_id=f"DS-{logical_key[:10].upper()}",
            name=logical_key,
            data_type="point_cloud" if spec.data_type == "lidar" else spec.data_type,
            file_count=len(spec.task_keys),
            created_by=user_rows["pm"].id,
        )
        db.add(dataset)
        await db.flush()
        db.add(ProjectDataset(project_id=project.id, dataset_id=dataset.id))
        await db.flush()

        for index, _task_key in enumerate(spec.task_keys):
            status = task_statuses[index] if logical_key == "image_demo" else "pending"
            db.add(
                Task(
                    id=uuid.uuid4(),
                    project_id=project.id,
                    display_id=f"T-{logical_key[:4].upper()}-{index}",
                    file_name=f"{index:02d}-fixture.bin",
                    file_path=f"seed/{logical_key}/{index:02d}-fixture.bin",
                    file_type="image",
                    status=status,
                    total_predictions=1
                    if logical_key == "image_demo" and index == 1
                    else 0,
                    assignee_id=(
                        user_rows["anno"].id
                        if logical_key == "image_demo" and index == 2
                        else None
                    ),
                    reviewer_id=(
                        user_rows["qa"].id
                        if logical_key == "image_demo" and index == 4
                        else None
                    ),
                )
            )

    image = projects["image_demo"]
    for index, status in enumerate(("draft", "annotating", "reviewing", "approved")):
        db.add(
            TaskBatch(
                project_id=image.id,
                display_id=f"B-SCREEN-{index}",
                name=status,
                status=status,
                created_by=user_rows["pm"].id,
            )
        )
    db.add_all(
        [
            ProjectMember(
                project_id=image.id,
                user_id=user_rows["anno"].id,
                role="annotator",
                assigned_by=user_rows["pm"].id,
            ),
            ProjectMember(
                project_id=image.id,
                user_id=user_rows["qa"].id,
                role="reviewer",
                assigned_by=user_rows["pm"].id,
            ),
        ]
    )

    image_backend = MLBackendRegistry(
        id=uuid.uuid4(),
        name="screenshot-image",
        url=f"http://image-{uuid.uuid4().hex}.test",
        state="connected",
        is_interactive=True,
        health_meta={"capabilities": {"is_interactive": True, "prompts": ["point"]}},
    )
    video_backend = MLBackendRegistry(
        id=uuid.uuid4(),
        name="screenshot-video",
        url=f"http://video-{uuid.uuid4().hex}.test",
        state="connected",
        is_interactive=False,
        health_meta={"capabilities": {"supported_trackers": ["sam2_video"]}},
    )
    db.add_all([image_backend, video_backend])
    await db.flush()
    image.ml_backend_id = image_backend.id
    video = projects["video_demo"]
    video.ml_backend_id = video_backend.id
    db.add_all(
        [
            ProjectMLBackend(
                project_id=image.id, registry_id=image_backend.id, enabled=True
            ),
            ProjectMLBackend(
                project_id=video.id, registry_id=video_backend.id, enabled=True
            ),
        ]
    )
    await db.flush()
    return projects


async def test_catalog_returns_stable_logical_resources(httpx_client, db_session):
    await _ready_profile(db_session)

    response = await httpx_client.get(
        "/api/v1/__test/seed/catalog", params={"profile": "screenshots"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schema_version"] == 1
    assert body["seed_revision"] == "screenshots-2026-07-a"
    assert body["users"]["annotator"]["email"] == "anno"
    assert body["projects"]["image_demo"]["display_id"] == "P-COCO8"
    assert body["projects"]["image_demo"]["tasks"]["review"]["status"] == "review"
    assert body["projects"]["video_demo"]["ml_backend"]["name"] == "screenshot-video"


async def test_catalog_fails_closed_when_primary_backend_is_unbound(
    httpx_client, db_session
):
    projects = await _ready_profile(db_session)
    projects["image_demo"].ml_backend_id = None
    await db_session.flush()

    response = await httpx_client.get("/api/v1/__test/seed/catalog")

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "screenshot_seed_not_ready"
    assert any("primary ML backend is not bound" in issue for issue in detail["issues"])
