"""v0.18.27 · 项目级「已保存的编排」(Project.preannotate_pipeline, 方案 A)。

PATCH /projects/{id} 读写 preannotate_pipeline:
- 单 / 多阶段 → persist + GET 原样返回。
- 显式 null → 清除。
- 不传 → 不动 (exclude_unset)。
- 非法 stage (重复序号 / 无源阶段 / 坏 uuid) → 422。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed(db: AsyncSession, owner_id: uuid.UUID):
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-{suffix}",
        name=f"pipe-{suffix}",
        type_label="image-det",
        type_key="image-det",
        owner_id=owner_id,
        ai_enabled=True,
    )
    db.add(proj)
    await db.flush()
    detect = MLBackend(
        id=uuid.uuid4(),
        project_id=proj.id,
        name="detect",
        url="http://detect/",
        is_interactive=False,
        state="connected",
    )
    classify = MLBackend(
        id=uuid.uuid4(),
        project_id=proj.id,
        name="classify",
        url="http://classify/",
        is_interactive=False,
        state="connected",
    )
    db.add(detect)
    db.add(classify)
    await db.flush()
    proj.ml_backend_id = detect.id
    await db.commit()
    return proj, detect, classify


def _stages(detect_id, classify_id):
    return [
        {"stage": 0, "ml_backend_id": str(detect_id), "model_id": "detect"},
        {
            "stage": 1,
            "ml_backend_id": str(classify_id),
            "model_id": "va",
            "task_type": "classification",
            "parent_stage": 0,
            "roi": {"mode": "crop", "pad": 0.05},
            "write": {"target": "attributes", "keys": ["color"]},
        },
    ]


@pytest.mark.asyncio
async def test_patch_persists_and_get_returns_pipeline(
    httpx_client_bound, super_admin, db_session
):
    owner, token = super_admin
    proj, detect, classify = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)

    resp = await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        headers=_bearer(token),
        json={"preannotate_pipeline": stages},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["preannotate_pipeline"] == stages

    got = await httpx_client_bound.get(
        f"/api/v1/projects/{proj.id}", headers=_bearer(token)
    )
    assert got.status_code == 200, got.text
    assert got.json()["preannotate_pipeline"] == stages


@pytest.mark.asyncio
async def test_patch_single_stage_pipeline(httpx_client_bound, super_admin, db_session):
    owner, token = super_admin
    proj, detect, _ = await _seed(db_session, owner.id)
    stages = [{"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect"}]
    resp = await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        headers=_bearer(token),
        json={"preannotate_pipeline": stages},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["preannotate_pipeline"] == stages


@pytest.mark.asyncio
async def test_patch_null_clears_pipeline(httpx_client_bound, super_admin, db_session):
    owner, token = super_admin
    proj, detect, classify = await _seed(db_session, owner.id)
    await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        headers=_bearer(token),
        json={"preannotate_pipeline": _stages(detect.id, classify.id)},
    )
    resp = await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        headers=_bearer(token),
        json={"preannotate_pipeline": None},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["preannotate_pipeline"] is None


@pytest.mark.asyncio
async def test_patch_omit_keeps_pipeline(httpx_client_bound, super_admin, db_session):
    owner, token = super_admin
    proj, detect, classify = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        headers=_bearer(token),
        json={"preannotate_pipeline": stages},
    )
    # 不传 preannotate_pipeline, 改别的字段 → 编排保持不变。
    resp = await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        headers=_bearer(token),
        json={"name": "renamed"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["preannotate_pipeline"] == stages


@pytest.mark.asyncio
async def test_patch_rejects_duplicate_stage(
    httpx_client_bound, super_admin, db_session
):
    owner, token = super_admin
    proj, detect, classify = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["stage"] = 0  # 重复 stage 序号
    resp = await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        headers=_bearer(token),
        json={"preannotate_pipeline": stages},
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_patch_rejects_no_root_stage(httpx_client_bound, super_admin, db_session):
    owner, token = super_admin
    proj, detect, classify = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[0]["parent_stage"] = 1  # 无 parent_stage=None 的源阶段
    resp = await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        headers=_bearer(token),
        json={"preannotate_pipeline": stages},
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_patch_rejects_bad_uuid(httpx_client_bound, super_admin, db_session):
    owner, token = super_admin
    proj, _, _ = await _seed(db_session, owner.id)
    stages = [{"stage": 0, "ml_backend_id": "not-a-uuid", "model_id": "detect"}]
    resp = await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        headers=_bearer(token),
        json={"preannotate_pipeline": stages},
    )
    assert resp.status_code == 422, resp.text
