from unittest.mock import AsyncMock
import uuid

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from app import deps
from app.api.v1.tasks import annotations
from app.db.models.user import User
from app.services.project_access import (
    ACCESS_KIND_MEMBER,
    MANAGER_CAPABILITIES,
    ProjectAccess,
    project_role_capabilities,
)


def _access(platform_role: str, project_role: str | None, *, manager: bool):
    """Build the resolved project-access context for one account/project pair."""

    capabilities = (
        MANAGER_CAPABILITIES
        if manager
        else project_role_capabilities(project_role or "")
    )
    return ProjectAccess(
        user_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        platform_role=platform_role,
        project_role=None if manager else project_role,
        membership_id=None if manager else uuid.uuid4(),
        membership_version=None if manager else 1,
        access_kind="manager" if manager else ACCESS_KIND_MEMBER,
        capabilities=frozenset(capabilities),
        is_manager=manager,
    )


@pytest.mark.parametrize(
    ("platform_role", "project_role", "manager", "allowed"),
    [
        # A super administrator manages every project.
        ("super_admin", None, True, True),
        # A platform project administrator who is only an annotated member gets
        # that membership's capabilities, which include annotation write.
        ("project_admin", "annotator", False, True),
        # A literal employee with an annotator membership may run inference.
        ("employee", "annotator", False, True),
        # Reviewers and viewers have no annotation.write capability.
        ("employee", "reviewer", False, False),
        ("viewer", "viewer", False, False),
    ],
)
@pytest.mark.asyncio
async def test_secondary_inference_capability_gate_precedes_task_access(
    monkeypatch, platform_role, project_role, manager, allowed
):
    app = FastAPI()
    app.include_router(annotations.router, prefix="/tasks")
    app.dependency_overrides[deps.get_current_user] = lambda: User(role=platform_role)
    app.dependency_overrides[deps.get_db] = lambda: object()
    app.dependency_overrides[deps.get_gpu_shadow_session_factory] = lambda: object()
    app.dependency_overrides[deps.get_gpu_dispatch_context_factory] = lambda: object()
    access = _access(platform_role, project_role, manager=manager)
    assert ("annotation.write" in access.capabilities) is allowed

    async def _gate():
        if not allowed:
            raise HTTPException(403, "缺少项目权限: annotation.write")
        return access

    app.dependency_overrides[annotations.require_task_annotation_write_strict] = _gate

    load_task = AsyncMock(side_effect=HTTPException(404, "task not found"))
    infer = AsyncMock()
    monkeypatch.setattr(annotations, "_load_task_or_404", load_task)
    monkeypatch.setattr(annotations, "run_secondary_inference", infer)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/tasks/{uuid.uuid4()}/annotations/{uuid.uuid4()}/secondary-inference",
            json={"ml_backend_id": str(uuid.uuid4()), "write_target": "geometry"},
        )

    assert response.status_code == (404 if allowed else 403)
    assert load_task.await_count == int(allowed)
    infer.assert_not_awaited()
