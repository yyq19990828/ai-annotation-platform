from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models.ml_backend_registry import MLBackendRegistry, ProjectMLBackendPool
from app.db.models.project import Project
from app.db.models.user import User
from app.services.ml_backend import MLBackendService
from app.services.screenshot_seed_backends import (
    backend_requirement_issues,
    reconcile_screenshot_backends,
    select_backend_for_requirement,
)
from app.services.screenshot_seed_spec import BACKEND_REQUIREMENTS, PROJECT_SPECS
from tests.conftest import create_registry_with_pool


pytestmark = pytest.mark.asyncio


def _backend(
    *,
    url: str,
    prompts: list[str] | None = None,
    trackers: list[str] | None = None,
    models: list[dict] | None = None,
    inputs: list[str] | None = None,
    geometries: list[str] | None = None,
    interactive: bool = False,
) -> MLBackendRegistry:
    return MLBackendRegistry(
        id=uuid.uuid4(),
        name=url.rsplit("/", 1)[-1],
        url=url,
        source="env",
        state="connected",
        is_interactive=interactive,
        health_meta={
            "capabilities": {
                "supported_prompts": prompts or [],
                "supported_trackers": trackers or [],
                "supported_inputs": inputs or [],
                "supported_geometric_outputs": geometries or [],
                "models": models or [],
            }
        },
    )


async def test_image_requirement_rejects_backend_without_exemplar() -> None:
    requirement = BACKEND_REQUIREMENTS["image_interactive"]
    sam2 = _backend(
        url="http://backend.test:8001",
        prompts=["point", "interactive_box"],
        models=[{"task": "interactive_seg"}],
        geometries=["polygon"],
        interactive=True,
    )
    sam3 = _backend(
        url="http://backend.test:8002",
        prompts=["point", "interactive_box", "exemplar"],
        models=[{"task": "interactive_seg"}],
        geometries=["polygon"],
        interactive=True,
    )

    assert "missing prompts ['exemplar']" in backend_requirement_issues(
        sam2, requirement
    )
    assert select_backend_for_requirement([sam2, sam3], requirement) is sam3


async def test_tracker_requirement_uses_declared_priority() -> None:
    requirement = BACKEND_REQUIREMENTS["video_tracker"]
    sam2 = _backend(
        url="http://backend.test:8001",
        trackers=["sam2_video"],
        models=[{"task": "tracker"}],
    )
    sam3 = _backend(
        url="http://backend.test:8002",
        trackers=["sam3_video_interactive"],
        models=[{"task": "tracker"}],
    )

    assert select_backend_for_requirement([sam2, sam3], requirement) is sam3


async def test_reconcile_creates_exact_primary_and_enabled_bindings(
    db_session, monkeypatch
) -> None:
    owner = User(
        id=uuid.uuid4(),
        email="backend-seed-owner",
        name="owner",
        password_hash="test",
        role="super_admin",
        is_active=True,
    )
    db_session.add(owner)
    await db_session.flush()

    projects: dict[str, Project] = {}
    for logical_key, spec in PROJECT_SPECS.items():
        project = Project(
            id=uuid.uuid4(),
            display_id=spec.display_id,
            name=logical_key,
            type_label=logical_key,
            type_key=logical_key,
            data_type=spec.data_type,
            owner_id=owner.id,
            ai_enabled=spec.required_backend is not None,
            ai_interactive_enabled=spec.required_backend == "image_interactive",
        )
        db_session.add(project)
        projects[logical_key] = project

    image = _backend(
        url="http://backend.test:8002",
        prompts=["point", "interactive_box", "exemplar"],
        trackers=["sam3_video_interactive"],
        models=[{"task": "interactive_seg"}, {"task": "tracker"}],
        geometries=["polygon"],
        interactive=True,
    )
    ocr = _backend(
        url="http://backend.test:8005",
        models=[{"task": "ocr", "output_attribute_types": ["text"]}],
        inputs=["full_image"],
        geometries=["polygon"],
    )
    stale = _backend(url="http://backend.test:8999")
    db_session.add_all([image, ocr, stale])
    await db_session.flush()
    # v0.23.3 ADR-0050 · 每 registry 须有 singleton pool 才能被项目启用 / 主绑定。
    svc = MLBackendService(db_session)
    image_pool = await svc._create_singleton_pool(image)
    ocr_pool = await svc._create_singleton_pool(ocr)
    stale_pool = await svc._create_singleton_pool(stale)
    db_session.add(
        ProjectMLBackendPool(
            project_id=projects["pointcloud_demo"].id,
            pool_id=stale_pool.id,
            enabled=True,
        )
    )
    projects["pointcloud_demo"].ml_backend_pool_id = stale_pool.id
    await db_session.flush()

    async def fake_live_candidates(_db):
        return [image, ocr, stale]

    monkeypatch.setattr(
        "app.services.screenshot_seed_backends._live_candidates",
        fake_live_candidates,
    )

    report = await reconcile_screenshot_backends(db_session, mode="live")

    assert report["bindings"]["image_demo"]["backend_id"] == str(image.id)
    assert report["bindings"]["video_demo"]["tracker"] == ("sam3_video_interactive")
    assert report["bindings"]["ocr_demo"]["backend_id"] == str(ocr.id)
    assert projects["pointcloud_demo"].ml_backend_pool_id is None
    associations = list(
        (await db_session.execute(select(ProjectMLBackendPool))).scalars()
    )
    assert {
        (association.project_id, association.pool_id)
        for association in associations
    } == {
        (projects["image_demo"].id, image_pool.id),
        (projects["video_demo"].id, image_pool.id),
        (projects["ocr_demo"].id, ocr_pool.id),
    }
