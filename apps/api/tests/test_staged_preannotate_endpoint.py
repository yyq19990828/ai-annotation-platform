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


async def _post_stages(client, token, proj, detect, batch, stages):
    return await client.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(detect.id),
            "batch_id": str(batch.id),
            "pipeline_stages": stages,
        },
    )


@pytest.mark.asyncio
async def test_accept_depth_three_geometry_chain(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.14 · 受限树形: depth-3 链路 (root 产几何 → 中间 intermediate → 叶子 attributes)
    # 现在结构上被接受 (深度=3, 父均产几何)。中间阶段的能力可达性由 worker 路由期再校验。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect",
         "write": {"target": "geometry"}},
        {"stage": 1, "ml_backend_id": str(classify.id), "model_id": "box-seg",
         "parent_stage": 0, "roi": {"mode": "geometry"},
         "write": {"target": "intermediate"}},
        {"stage": 2, "ml_backend_id": str(classify.id), "model_id": "color-clf",
         "parent_stage": 1, "label": "hat",
         "roi": {"mode": "crop", "pad": 0.1},
         "write": {"target": "attributes", "target_stage": "root", "keys": ["color"]}},
    ]
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 200, resp.text
    assert len(_mock_celery["kwargs"]["pipeline_stages"]) == 3


@pytest.mark.asyncio
async def test_reject_forward_parent_stage(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # 前向 parent_stage (指向更晚的阶段) → 受限树形要求父序号严格更小。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect",
         "write": {"target": "geometry"}},
        {"stage": 1, "ml_backend_id": str(classify.id), "parent_stage": 2,
         "write": {"target": "attributes", "keys": ["a"]}},
        {"stage": 2, "ml_backend_id": str(classify.id), "parent_stage": 0,
         "roi": {"mode": "geometry"}, "write": {"target": "intermediate"}},
    ]
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 422, resp.text
    assert "未在前面定义" in resp.text


@pytest.mark.asyncio
async def test_reject_depth_four(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # 0→1→2→3 链路深度 4 → 超过最大深度 3。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect",
         "write": {"target": "geometry"}},
        {"stage": 1, "ml_backend_id": str(classify.id), "parent_stage": 0,
         "roi": {"mode": "geometry"}, "write": {"target": "intermediate"}},
        {"stage": 2, "ml_backend_id": str(classify.id), "parent_stage": 1,
         "roi": {"mode": "geometry"}, "write": {"target": "intermediate"}},
        {"stage": 3, "ml_backend_id": str(classify.id), "parent_stage": 2,
         "write": {"target": "attributes", "keys": ["color"]}},
    ]
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 422, resp.text
    assert "超过最大深度 3" in resp.text


@pytest.mark.asyncio
async def test_reject_parent_not_geometry(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # 父阶段 write.target=attributes (不产几何) 被当作父引用 → 拒绝。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect",
         "write": {"target": "geometry"}},
        {"stage": 1, "ml_backend_id": str(classify.id), "parent_stage": 0,
         "write": {"target": "attributes", "keys": ["color"]}},
        {"stage": 2, "ml_backend_id": str(classify.id), "parent_stage": 1,
         "write": {"target": "attributes", "keys": ["shade"]}},
    ]
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 422, resp.text
    assert "不产几何" in resp.text


@pytest.mark.asyncio
async def test_reject_unsupported_target_stage(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # write.target_stage 非 'root' (本版仅接受 root) → 拒绝。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["write"] = {"target": "attributes", "target_stage": "parent", "keys": ["color"]}
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 422, resp.text
    assert "暂不支持" in resp.text


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
async def test_accept_geometry_downstream(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.12 · gsam2 box-seg 下游 (roi.mode=geometry + write.target=geometry) 应被放行。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "vehicle-detect"},
        {
            "stage": 1,
            "ml_backend_id": str(classify.id),
            "model_id": "grounded-sam2-box-seg",
            "task_type": "segmentation",
            "parent_stage": 0,
            "roi": {"mode": "geometry", "pad": 0.05},
            "write": {"target": "geometry"},
        },
    ]
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
    fwd = _mock_celery["kwargs"]["pipeline_stages"]
    assert fwd[1]["roi"] == {"mode": "geometry", "pad": 0.05}
    assert fwd[1]["write"] == {"target": "geometry"}


@pytest.mark.asyncio
async def test_reject_invalid_roi_mode(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["roi"] = {"mode": "polygon", "pad": 0.05}  # 非 crop / geometry
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
async def test_reject_invalid_write_target(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["write"] = {
        "target": "new_shape",
        "keys": ["color"],
    }  # 非 attributes / geometry
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
async def test_geometry_target_skips_key_conflict(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.12 · geometry target 不写 attributes, 不应卷进键冲突检测。
    # 一个 attributes 阶段 + 一个 geometry 阶段, 即使前者写了 keys=["color"], geometry 阶段
    # 没 keys 也不该 422。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect"},
        {
            "stage": 1,
            "ml_backend_id": str(classify.id),
            "model_id": "va-classify",
            "parent_stage": 0,
            "write": {"target": "attributes", "keys": ["color"]},
        },
        {
            "stage": 2,
            "ml_backend_id": str(classify.id),
            "model_id": "box-seg",
            "parent_stage": 0,
            "roi": {"mode": "geometry"},
            "write": {"target": "geometry"},
        },
    ]
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


async def _set_model_caps(db, backend, model_id, supported_inputs):
    """v0.18.15 · 给 backend 灌一份能力快照 (含某 model 的 supported_inputs), 供门控/烘焙测试。"""
    backend.health_meta = {
        "capabilities": {"models": [{"id": model_id, "supported_inputs": supported_inputs}]}
    }
    db.add(backend)
    await db.commit()


@pytest.mark.asyncio
async def test_reject_geometry_child_without_compatible_input(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.15 · 产几何的子, supported_inputs 只有 full_image (无 bbox_prompt/crop) → 422。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    await _set_model_caps(db_session, classify, "fullimg-only", ["full_image"])
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect",
         "write": {"target": "geometry"}},
        {"stage": 1, "ml_backend_id": str(classify.id), "model_id": "fullimg-only",
         "parent_stage": 0, "write": {"target": "geometry"}},
    ]
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 422, resp.text
    assert "无法作几何下游" in resp.text


@pytest.mark.asyncio
async def test_bakes_crop_delivery_for_plain_detector_geometry_child(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.15 · 产几何的子是普通检测器 (supported_inputs 含 crop) → 烘焙 input.mode=crop。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    await _set_model_caps(db_session, classify, "hat-det", ["full_image", "crop"])
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect",
         "write": {"target": "geometry"}},
        {"stage": 1, "ml_backend_id": str(classify.id), "model_id": "hat-det",
         "parent_stage": 0, "write": {"target": "geometry"}},
    ]
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 200, resp.text
    fwd = _mock_celery["kwargs"]["pipeline_stages"]
    assert fwd[1]["input"] == {"mode": "crop"}


@pytest.mark.asyncio
async def test_bakes_geometry_delivery_for_box_seg_child(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.15 · 产几何的子是 box-prompt seg (supported_inputs 含 bbox_prompt) → input.mode=geometry。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    await _set_model_caps(db_session, classify, "box-seg", ["bbox_prompt", "full_image"])
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect",
         "write": {"target": "geometry"}},
        {"stage": 1, "ml_backend_id": str(classify.id), "model_id": "box-seg",
         "parent_stage": 0, "write": {"target": "geometry"}},
    ]
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 200, resp.text
    fwd = _mock_celery["kwargs"]["pipeline_stages"]
    assert fwd[1]["input"] == {"mode": "geometry"}


@pytest.mark.asyncio
async def test_explicit_input_mode_not_overridden(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.15 · 用户显式 input.mode 不被烘焙覆盖。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    await _set_model_caps(db_session, classify, "box-seg", ["bbox_prompt", "full_image"])
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect",
         "write": {"target": "geometry"}},
        {"stage": 1, "ml_backend_id": str(classify.id), "model_id": "box-seg",
         "parent_stage": 0, "input": {"mode": "geometry"},
         "write": {"target": "geometry"}},
    ]
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 200, resp.text
    assert _mock_celery["kwargs"]["pipeline_stages"][1]["input"] == {"mode": "geometry"}


@pytest.mark.asyncio
async def test_label_forwarded_to_worker(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # v0.18.15 · 修复: label 字段须透传给 worker (子物体属性前缀链路依赖它)。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["label"] = "hat"
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 200, resp.text
    assert _mock_celery["kwargs"]["pipeline_stages"][1]["label"] == "hat"


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


@pytest.mark.asyncio
async def test_reject_source_backend_other_project(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # 顶层 ml_backend_id 指向别项目的 backend → 应 404 (与下游 backend 校验对称, 不可枚举)。
    # 此前源 backend 只校验存在性, 不校验归属, 与下游分支不对称。
    owner, token = super_admin
    proj_a, _, _, batch_a = await _seed(db_session, owner.id)
    _proj_b, detect_b, _, _ = await _seed(db_session, owner.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj_a.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(detect_b.id),  # 别项目的 backend
            "batch_id": str(batch_a.id),
        },
    )
    assert resp.status_code == 404, resp.text
    assert "ML Backend not found" in resp.text


@pytest.mark.asyncio
async def test_reject_drop_box_on_non_root_parent(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # issue 0001 · 深层 (非-root-父) 阶段设 on_failure=drop_box → 422。worker 侧 dropped 的下标
    # 只与 root_boxes 对齐, 深层父框下标语义不同, 放行会误删无关 root 框。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = [
        {"stage": 0, "ml_backend_id": str(detect.id), "model_id": "detect",
         "write": {"target": "geometry"}},
        {"stage": 1, "ml_backend_id": str(classify.id), "model_id": "box-seg",
         "parent_stage": 0, "roi": {"mode": "geometry"},
         "write": {"target": "intermediate"}},
        {"stage": 2, "ml_backend_id": str(classify.id), "model_id": "color-clf",
         "parent_stage": 1, "on_failure": "drop_box",
         "roi": {"mode": "crop", "pad": 0.1},
         "write": {"target": "attributes", "keys": ["color"]}},
    ]
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 422, resp.text
    assert "仅支持父阶段为源阶段" in resp.text


@pytest.mark.asyncio
async def test_accept_drop_box_on_root_parent(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # issue 0001 回归 · 父=源阶段 (root) 的 drop_box 仍合法 (下标对齐, 旧双阶段行为不变)。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["on_failure"] = "drop_box"  # parent_stage=0=root
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_reject_full_image_input_mode(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    # issue 0006 · input.mode=full_image 非真实投递模式 (worker 只认 crop/geometry, 会静默忽略),
    # 校验期直接拒绝以保契约一致。
    owner, token = super_admin
    proj, detect, classify, batch = await _seed(db_session, owner.id)
    stages = _stages(detect.id, classify.id)
    stages[1]["input"] = {"mode": "full_image"}
    resp = await _post_stages(httpx_client_bound, token, proj, detect, batch, stages)
    assert resp.status_code == 422, resp.text
    assert "input.mode 须为" in resp.text
