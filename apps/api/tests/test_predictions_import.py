"""v0.10.15 · POST /projects/{id}/predictions/import 端点测试.

覆盖:
- AAP JSON happy path (bbox / polygon / multi_polygon)
- COCO Detection happy path
- schema_version > 1.x → 422
- task_match display_id 命中 / file_path 命中 / 都 miss → errors[]
- 跨项目 display_id (display_id 全局唯一但 project_id 不符) → fallback / miss
- dry_run 不入库
- overwrite_existing flag 行为
- 未知 geometry kind → errors[] 不让整批挂
- 权限 annotator → 403
- 老 prediction 默认 source='ml_backend'; 新导入行 source='external_import'
"""

from __future__ import annotations

import io
import json
import uuid

import httpx
import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.prediction import Prediction
from app.db.models.project import Project
from app.db.models.task import Task

pytestmark = pytest.mark.asyncio


# ── helpers ──────────────────────────────────────────────────────────


async def _seed_project_with_tasks(
    db: AsyncSession,
    owner_id: uuid.UUID,
    *,
    n_tasks: int = 2,
    type_key: str = "image-det",
) -> tuple[Project, list[Task]]:
    short = uuid.uuid4().hex[:6]
    project = Project(
        id=uuid.uuid4(),
        display_id=f"P-PI{short}",
        name=f"PredImp {short}",
        type_key=type_key,
        type_label="测试",
        owner_id=owner_id,
        status="in_progress",
        classes=["car", "truck"],
    )
    db.add(project)
    await db.flush()

    tasks: list[Task] = []
    for i in range(n_tasks):
        t = Task(
            id=uuid.uuid4(),
            project_id=project.id,
            display_id=f"T-PI{short}-{i}",
            file_name=f"img_{i}.jpg",
            file_path=f"datasets/{short}/img_{i}.jpg",
            file_type="image",
            status="pending",
        )
        db.add(t)
        tasks.append(t)
    await db.flush()
    return project, tasks


def _aap_envelope(tasks_payload: list[dict], schema_version: str = "1.0") -> bytes:
    return json.dumps(
        {
            "schema_version": schema_version,
            "exported_at": "2026-05-19T10:00:00Z",
            "exported_from": {"platform": "aap"},
            "project": {"name": "test", "type_key": "image-det"},
            "tasks": tasks_payload,
        }
    ).encode("utf-8")


def _upload_files(content: bytes, filename: str = "test.json") -> dict:
    return {"file": (filename, io.BytesIO(content), "application/json")}


# ── AAP JSON happy paths ─────────────────────────────────────────────


async def test_import_aap_json_bbox_happy(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "annotations": [],
                "predictions": [
                    {
                        "geometry": {
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.2,
                            "w": 0.3,
                            "h": 0.4,
                        },
                        "class_name": "car",
                        "confidence": 0.92,
                        "model_version": "ext-yolo-v1",
                    }
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["imported"] == 1
    assert result["skipped"] == 0
    assert result["errors"] == []
    assert result["dry_run"] is False

    # 验证写入: source='external_import', ml_backend_id=None
    rows = (
        await db_session.execute(
            select(Prediction).where(Prediction.task_id == tasks[0].id)
        )
    ).scalars().all()
    assert len(rows) == 1
    pred = rows[0]
    assert pred.source == "external_import"
    assert pred.ml_backend_id is None
    assert pred.model_version == "ext-yolo-v1"
    # result 列存 LS shape 数组
    assert isinstance(pred.result, list)
    assert pred.result[0]["type"] == "rectanglelabels"
    assert pred.result[0]["value"]["rectanglelabels"] == ["car"]


async def test_import_aap_json_polygon(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    poly_points = [[0.1, 0.1], [0.5, 0.1], [0.3, 0.4]]
    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "predictions": [
                    {
                        "geometry": {"type": "polygon", "points": poly_points},
                        "class_name": "car",
                        "confidence": 0.8,
                    }
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1

    rows = (
        await db_session.execute(
            select(Prediction).where(Prediction.task_id == tasks[0].id)
        )
    ).scalars().all()
    assert rows[0].result[0]["type"] == "polygonlabels"
    assert len(rows[0].result[0]["value"]["points"]) == 3


async def test_import_aap_json_multi_polygon(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "predictions": [
                    {
                        "geometry": {
                            "type": "multi_polygon",
                            "polygons": [
                                {
                                    "type": "polygon",
                                    "points": [[0.1, 0.1], [0.5, 0.1], [0.3, 0.4]],
                                },
                                {
                                    "type": "polygon",
                                    "points": [[0.6, 0.6], [0.9, 0.6], [0.7, 0.9]],
                                },
                            ],
                        },
                        "class_name": "car",
                        "confidence": 0.7,
                    }
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1


# ── schema_version 守门 ─────────────────────────────────────────────


async def test_import_aap_json_future_version_rejected(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, _ = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope([], schema_version="2.0")

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 422
    assert "schema_version" in r.json()["detail"]


# ── task_match 行为 ──────────────────────────────────────────────────


async def test_import_aap_json_file_path_match(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    # 仅给 file_path, 不给 display_id
    payload = _aap_envelope(
        [
            {
                "task_match": {"file_path": tasks[1].file_path},
                "predictions": [
                    {
                        "geometry": {
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        "class_name": "car",
                        "confidence": 0.5,
                    }
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1


async def test_import_aap_json_task_miss(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, _ = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": "T-NOTEXIST-XYZ"},
                "predictions": [
                    {
                        "geometry": {
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        "class_name": "car",
                        "confidence": 0.5,
                    }
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 0
    assert body["skipped"] == 1
    assert len(body["errors"]) == 1
    assert "task not found" in body["errors"][0]["reason"].lower()


async def test_import_aap_json_cross_project_display_id_not_matched(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    """display_id 全局唯一但属于其他项目时, 不允许偷换项目."""
    user, token = super_admin
    project_a, tasks_a = await _seed_project_with_tasks(db_session, user.id)
    project_b, _ = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    # 用 project_b 的 display_id 但导入到 project_a; 应 fallback 到 file_path,
    # 但 file_path 也只在 project_b 下, 故对 project_a miss.
    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks_a[0].display_id},
                "predictions": [
                    {
                        "geometry": {
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        "class_name": "car",
                        "confidence": 0.5,
                    }
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project_b.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 0
    assert body["skipped"] == 1


# ── dry_run ──────────────────────────────────────────────────────────


async def test_import_aap_json_dry_run_not_persisted(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "predictions": [
                    {
                        "geometry": {
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        "class_name": "car",
                        "confidence": 0.5,
                    }
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import"
        "?format=aap_json&dry_run=true",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 1
    assert body["dry_run"] is True

    count = (
        await db_session.execute(
            select(func.count(Prediction.id)).where(Prediction.task_id == tasks[0].id)
        )
    ).scalar()
    assert count == 0


# ── overwrite_existing ───────────────────────────────────────────────


async def test_import_aap_json_overwrite_replaces_external_only(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "predictions": [
                    {
                        "geometry": {
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        "class_name": "car",
                        "confidence": 0.5,
                    }
                ],
            }
        ]
    )

    # 第一次: append
    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text

    # 第二次 overwrite_existing=true: 应替换, 总数仍为 1
    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        data={"overwrite_existing": "true"},
        headers=headers,
    )
    assert r.status_code == 200, r.text

    count = (
        await db_session.execute(
            select(func.count(Prediction.id)).where(
                Prediction.task_id == tasks[0].id,
                Prediction.source == "external_import",
            )
        )
    ).scalar()
    assert count == 1


# ── 未知几何 kind 不让整批挂 ────────────────────────────────────────


async def test_import_aap_json_unknown_kind_in_errors(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "predictions": [
                    # 1 个不支持
                    {
                        "geometry": {"type": "polyline", "points": [[0, 0], [1, 1]]},
                        "class_name": "car",
                        "confidence": 0.5,
                    },
                    # 1 个 ok
                    {
                        "geometry": {
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        "class_name": "car",
                        "confidence": 0.5,
                    },
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 1
    assert body["skipped"] == 1
    assert any("polyline" in err["reason"] for err in body["errors"])


# ── 权限 ────────────────────────────────────────────────────────────


async def test_import_aap_json_forbidden_for_annotator(
    httpx_client: httpx.AsyncClient,
    super_admin,
    annotator,
    db_session: AsyncSession,
):
    user, _ = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    _annotator_user, annotator_token = annotator
    headers = {"Authorization": f"Bearer {annotator_token}"}

    payload = _aap_envelope(
        [{"task_match": {"display_id": tasks[0].display_id}, "predictions": []}]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 403


# ── COCO importer ──────────────────────────────────────────────────


async def test_import_coco_happy(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    coco_payload = json.dumps(
        {
            "info": {"description": "external"},
            "images": [
                {
                    "id": 1,
                    "file_name": tasks[0].file_path,
                    "width": 1920,
                    "height": 1080,
                }
            ],
            "categories": [{"id": 0, "name": "car"}],
            "annotations": [
                {
                    "id": 1,
                    "image_id": 1,
                    "category_id": 0,
                    "bbox": [192, 108, 576, 432],
                    "area": 0,
                    "iscrowd": 0,
                    "score": 0.88,
                }
            ],
        }
    ).encode("utf-8")

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=coco",
        files=_upload_files(coco_payload, "coco.json"),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 1

    rows = (
        await db_session.execute(
            select(Prediction).where(Prediction.task_id == tasks[0].id)
        )
    ).scalars().all()
    assert len(rows) == 1
    bbox = rows[0].result[0]["value"]
    # 192/1920=0.1, 108/1080=0.1, 576/1920=0.3, 432/1080=0.4 -> *100
    assert bbox["x"] == pytest.approx(10.0, rel=0.01)
    assert bbox["width"] == pytest.approx(30.0, rel=0.01)


# ── 老 prediction 默认 source ────────────────────────────────────────


async def test_existing_predictions_have_default_source(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    """alembic 0069 默认值: 老数据 source='ml_backend' (无需显式查 SQL,
    直接插入不指定 source 走 default)."""
    user, _ = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    pred = Prediction(
        id=uuid.uuid4(),
        task_id=tasks[0].id,
        project_id=project.id,
        ml_backend_id=None,
        result=[],
    )
    db_session.add(pred)
    await db_session.flush()
    assert pred.source == "ml_backend"
