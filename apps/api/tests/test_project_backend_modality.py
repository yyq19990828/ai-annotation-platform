"""v0.10.37 · ML Backend 能力协商落库 + 绑定按 data_type 校验 (epic 阶段 1).

覆盖:
- check_health 探 /setup 把能力快照落进 health_meta["capabilities"] + is_interactive 派生对账.
- PATCH /projects/{id} 绑定 backend 时按 project.data_type 校验模态:
  - 视频项目绑只支持图片的 backend → 422.
  - 视频项目绑 video-capable backend → 200.
  - /setup 探测失败 → fail-open 放行.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest

from app.db.models.ml_backend import MLBackend
from tests.factory import create_project

_IMAGE_SETUP = {
    "name": "grounded-sam2",
    "is_interactive": True,
    "supported_prompts": ["point", "bbox", "text"],
    "supported_text_outputs": ["box", "mask", "both"],
}
_VIDEO_SETUP = {
    "name": "grounded-sam2-video",
    "is_interactive": True,
    "supported_prompts": ["point", "bbox", "text"],
    "supported_trackers": ["sam2_video"],
}


async def _seed_backend(db, project_id, *, name="bk") -> MLBackend:
    b = MLBackend(
        id=uuid.uuid4(),
        project_id=project_id,
        name=name,
        url="http://example/",
        is_interactive=False,
        state="connected",
    )
    db.add(b)
    await db.flush()
    return b


@pytest.mark.asyncio
async def test_check_health_persists_capabilities_and_derives_is_interactive(
    db_session, super_admin
):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id)
    backend = await _seed_backend(db_session, proj.id)
    await db_session.commit()

    from app.services.ml_backend import MLBackendService

    async def fake_health_meta(self):
        return True, {"model_version": "v-test"}

    async def fake_setup(self):
        return _VIDEO_SETUP

    with (
        patch("app.services.ml_client.MLBackendClient.health_meta", new=fake_health_meta),
        patch("app.services.ml_client.MLBackendClient.setup", new=fake_setup),
    ):
        svc = MLBackendService(db_session)
        ok = await svc.check_health(backend.id)
        await db_session.commit()

    assert ok is True
    await db_session.refresh(backend)
    caps = backend.health_meta["capabilities"]
    assert caps["supported_trackers"] == ["sam2_video"]
    assert "video" in caps["modalities"]
    assert "image" in caps["modalities"]
    assert backend.is_interactive is True  # 派生对账


@pytest.mark.asyncio
async def test_bind_image_only_backend_to_video_project_rejected(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="video-track")
    proj.data_type = "video"
    backend = await _seed_backend(db_session, proj.id)
    await db_session.commit()

    async def fake_setup(self):
        return _IMAGE_SETUP

    with patch("app.services.ml_client.MLBackendClient.setup", new=fake_setup):
        res = await httpx_client.patch(
            f"/api/v1/projects/{proj.id}",
            json={"ml_backend_id": str(backend.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert res.status_code == 422, res.text
    assert "video" in res.json()["detail"]


@pytest.mark.asyncio
async def test_bind_video_backend_to_video_project_ok(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="video-track")
    proj.data_type = "video"
    backend = await _seed_backend(db_session, proj.id)
    await db_session.commit()

    async def fake_setup(self):
        return _VIDEO_SETUP

    with patch("app.services.ml_client.MLBackendClient.setup", new=fake_setup):
        res = await httpx_client.patch(
            f"/api/v1/projects/{proj.id}",
            json={"ml_backend_id": str(backend.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert res.status_code == 200, res.text


@pytest.mark.asyncio
async def test_bind_failopen_when_setup_unreachable(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="video-track")
    proj.data_type = "video"
    backend = await _seed_backend(db_session, proj.id)
    await db_session.commit()

    async def fake_setup(self):
        raise RuntimeError("connection refused")

    with patch("app.services.ml_client.MLBackendClient.setup", new=fake_setup):
        res = await httpx_client.patch(
            f"/api/v1/projects/{proj.id}",
            json={"ml_backend_id": str(backend.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert res.status_code == 200, res.text  # fail-open
