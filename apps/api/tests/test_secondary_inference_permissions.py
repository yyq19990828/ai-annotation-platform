from unittest.mock import AsyncMock
import uuid

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from app import deps
from app.api.v1.tasks import annotations
from app.db.models.user import User


@pytest.mark.parametrize(
    ("role", "allowed"),
    [
        ("super_admin", True),
        ("project_admin", True),
        ("annotator", True),
        ("reviewer", False),
        ("viewer", False),
    ],
)
@pytest.mark.asyncio
async def test_secondary_inference_role_gate_precedes_task_access(
    monkeypatch, role, allowed
):
    app = FastAPI()
    app.include_router(annotations.router, prefix="/tasks")
    app.dependency_overrides[deps.get_current_user] = lambda: User(role=role)
    app.dependency_overrides[deps.get_db] = lambda: object()
    app.dependency_overrides[deps.get_gpu_shadow_session_factory] = lambda: object()
    app.dependency_overrides[deps.get_gpu_dispatch_context_factory] = lambda: object()
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
