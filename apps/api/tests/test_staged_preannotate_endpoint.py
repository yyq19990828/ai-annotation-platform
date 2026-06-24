"""v0.18.1 · 多阶段预标注 endpoint 层 (路径 B M1).

- pipeline_stages 透传给 batch_predict.delay (含下游阶段 backend 校验)。
- 缺省 (无 pipeline_stages) 仍走单阶段, 透传 None (向后兼容)。
- 校验: >2 阶段 / 重复 stage / 源阶段 backend 不一致 / 下游 backend 不存在 → 拒绝。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import BatchStatus
from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed(db: AsyncSession, owner_id: uuid.UUID):
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-{suffix}",
        name=f"staged-{suffix}",
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

    batch = TaskBatch(
        id=uuid.uuid4(),
        project_id=proj.id,
        display_id=f"B-{suffix}",
        name="b1",
        status=BatchStatus.ACTIVE,
    )
    db.add(batch)
    await db.flush()
    t = Task(
        id=uuid.uuid4(),
        project_id=proj.id,
        batch_id=batch.id,
        display_id=f"T-{suffix}-0",
        file_name="img.jpg",
        file_path=f"items/{suffix}.jpg",
        file_type="image",
        status="pending",
    )
    db.add(t)
    await db.commit()
    return proj, detect, classify, batch


@pytest.fixture
def _mock_celery(monkeypatch):
    captured: dict = {}

    class _FakeJob:
        id = "fake-job-uuid"

    def _fake_delay(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return _FakeJob()

    from app.workers import tasks as worker_tasks

    monkeypatch.setattr(worker_tasks.batch_predict, "delay", _fake_delay)
    return captured


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
async def test_no_pipeline_stages_forwards_none(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, detect, _, batch = await _seed(db_session, owner.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={"ml_backend_id": str(detect.id), "batch_id": str(batch.id)},
    )
    assert resp.status_code == 200, resp.text
    assert _mock_celery["kwargs"]["pipeline_stages"] is None


@pytest.mark.asyncio
async def test_pipeline_stages_forwarded(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(detect.id),
            "batch_id": str(batch.id),
            "pipeline_stages": _stages(detect.id, classify.id),
        },
    )
    assert resp.status_code == 200, resp.text
    fwd = _mock_celery["kwargs"]["pipeline_stages"]
    assert fwd is not None and len(fwd) == 2
    assert fwd[1]["parent_stage"] == 0
    assert fwd[1]["write"]["keys"] == ["color"]


@pytest.mark.asyncio
async def test_accept_parallel_fanout_three_stages(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.2 · 三阶段单层扇出 (两个下游共享 parent_stage=0) 现在合法。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["write"] = {"target": "attributes", "keys": ["color"]}
    stages.append(
        {
            "stage": 2,
            "ml_backend_id": str(classify.id),
            "parent_stage": 0,
            "write": {"target": "attributes", "keys": ["vehicle_type"]},
        }
    )
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(detect.id),
            "batch_id": str(batch.id),
            "pipeline_stages": stages,
        },
    )
    assert resp.status_code == 200, resp.text
    assert len(_mock_celery["kwargs"]["pipeline_stages"]) == 3


@pytest.mark.asyncio
async def test_reject_depth_three(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.2 · 子阶段再扇出 (parent_stage 指向下游而非源) → 拒绝 (本期仅单层)。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages.append({"stage": 2, "ml_backend_id": str(classify.id), "parent_stage": 1})
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(detect.id),
            "batch_id": str(batch.id),
            "pipeline_stages": stages,
        },
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_reject_key_conflict_default(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.2 · 两个并行兄弟写同一键 → 默认 reject (422); last_wins 时放行。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["write"] = {"target": "attributes", "keys": ["color"]}
    stages.append(
        {
            "stage": 2,
            "ml_backend_id": str(classify.id),
            "parent_stage": 0,
            "write": {"target": "attributes", "keys": ["color"]},
        }
    )
    body = {
        "ml_backend_id": str(detect.id),
        "batch_id": str(batch.id),
        "pipeline_stages": stages,
    }
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate", headers=_bearer(token), json=body
    )
    assert resp.status_code == 422, resp.text
    # last_wins 放行
    resp2 = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={**body, "on_key_conflict": "last_wins"},
    )
    assert resp2.status_code == 200, resp2.text


@pytest.mark.asyncio
async def test_reject_bad_roi_pad(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["roi"] = {"mode": "crop", "pad": 0.9}  # 超出 [0,0.5]
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(detect.id),
            "batch_id": str(batch.id),
            "pipeline_stages": stages,
        },
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_reject_source_backend_mismatch(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    # 顶层 ml_backend_id 用 detect, 但源阶段写成 classify → 拒绝
    stages = _stages(classify.id, classify.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(detect.id),
            "batch_id": str(batch.id),
            "pipeline_stages": stages,
        },
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_reject_unknown_downstream_backend(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, detect, _, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, uuid.uuid4())  # 下游 backend 不存在
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(detect.id),
            "batch_id": str(batch.id),
            "pipeline_stages": stages,
        },
    )
    assert resp.status_code == 404, resp.text
