"""v0.10.54 · POST /projects/{id}/annotations/import 端点测试 (ADR-0028).

覆盖:
- append 默认: 导入 N 条 annotation, 校验 user_id=操作者、source 保留、
  attributes._imported=true、geometry 透传、task.total_annotations 更新、
  task.status pending→in_progress。
- overwrite: 已有 _imported 标注被清、人工标注（无 _imported）保留;
  再次导入不堆叠。
- class_name 不在项目类别集合 → errors[] + skip, 不整批失败。
- task 匹配不到 → errors[]。
- dry_run: 计数正确且不入库。
- batch 自动流转被抑制（task.status 翻了但断言 check_auto_transitions 未触发）。
- 几何多 kind（bbox/polygon/rotated_bbox/keypoint/polyline）透传不报错。
"""

from __future__ import annotations

import io
import json
import uuid
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
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
    tool_bindings: dict | None = None,
) -> tuple[Project, list[Task]]:
    short = uuid.uuid4().hex[:6]
    project = Project(
        id=uuid.uuid4(),
        display_id=f"P-AI{short}",
        name=f"AnnImp {short}",
        type_key=type_key,
        type_label="测试",
        owner_id=owner_id,
        status="in_progress",
        classes=["car", "truck"],
        tool_bindings=tool_bindings or {},
    )
    db.add(project)
    await db.flush()

    tasks: list[Task] = []
    for i in range(n_tasks):
        t = Task(
            id=uuid.uuid4(),
            project_id=project.id,
            display_id=f"T-AI{short}-{i}",
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
            "exported_at": "2026-05-24T10:00:00Z",
            "exported_from": {"platform": "aap"},
            "project": {"name": "test", "type_key": "image-det"},
            "tasks": tasks_payload,
        }
    ).encode("utf-8")


def _upload_files(content: bytes, filename: str = "test.json") -> dict:
    return {"file": (filename, io.BytesIO(content), "application/json")}


def _ann_entry(
    *,
    geometry: dict,
    class_name: str = "car",
    source: str = "manual",
    tool_unit_id: str | None = None,
    user_id: str | None = None,
    created_at: str | None = None,
    confidence: float | None = None,
) -> dict:
    entry: dict = {
        "geometry": geometry,
        "class_name": class_name,
        "source": source,
    }
    if tool_unit_id is not None:
        entry["tool_unit_id"] = tool_unit_id
    if user_id is not None:
        entry["user_id"] = user_id
    if created_at is not None:
        entry["created_at"] = created_at
    if confidence is not None:
        entry["confidence"] = confidence
    return entry


# ── append 默认语义 ──────────────────────────────────────────────────


async def test_import_annotations_append_happy(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    """append 默认: 导入 2 条，校验归属、溯源、geometry 透传、task 统计更新。"""
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    orig_user_id = str(uuid.uuid4())
    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "annotations": [
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.2,
                            "w": 0.3,
                            "h": 0.4,
                        },
                        class_name="car",
                        source="manual",
                        user_id=orig_user_id,
                        created_at="2026-01-01T00:00:00Z",
                    ),
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.5,
                            "y": 0.5,
                            "w": 0.1,
                            "h": 0.1,
                        },
                        class_name="truck",
                        source="prediction_based",
                    ),
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 2
    assert body["skipped"] == 0
    assert body["errors"] == []
    assert body["dry_run"] is False

    # 验证写入
    rows = (
        (
            await db_session.execute(
                select(Annotation).where(Annotation.task_id == tasks[0].id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2

    car_ann = next(a for a in rows if a.class_name == "car")
    truck_ann = next(a for a in rows if a.class_name == "truck")

    # D1: user_id = 操作者（不是原始 user_id）
    assert car_ann.user_id == user.id
    assert truck_ann.user_id == user.id

    # D2: source 保留
    assert car_ann.source == "manual"
    assert truck_ann.source == "prediction_based"

    # D1+D2: attributes._imported=true, _imported_user_id 溯源
    assert car_ann.attributes["_imported"] is True
    assert car_ann.attributes["_imported_user_id"] == orig_user_id
    assert truck_ann.attributes["_imported"] is True
    assert "_imported_user_id" not in truck_ann.attributes  # 无原始 user_id 不写

    # geometry 透传（不做 LS 转换）
    assert car_ann.geometry == {"type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}

    # D5: created_at 保留原值
    assert car_ann.created_at is not None
    assert car_ann.created_at.year == 2026

    # D6: task 统计更新
    await db_session.refresh(tasks[0])
    assert tasks[0].total_annotations == 2
    assert tasks[0].is_labeled is True
    assert tasks[0].status == "in_progress"  # pending → in_progress


# ── overwrite 语义 ────────────────────────────────────────────────────


async def test_import_annotations_overwrite_clears_imported_keeps_manual(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    """overwrite: 已有 _imported 标注被清，人工标注保留; 再次导入不堆叠。"""
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    # 先插入一条"人工标注"（无 _imported 标记）
    manual_ann = Annotation(
        id=uuid.uuid4(),
        task_id=tasks[0].id,
        project_id=project.id,
        user_id=user.id,
        source="manual",
        annotation_type="bbox",
        tool_unit_id="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 0.0, "y": 0.0, "w": 0.1, "h": 0.1},
        attributes={},  # 无 _imported
    )
    db_session.add(manual_ann)
    await db_session.flush()

    # 第一次 import（append）
    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "annotations": [
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        class_name="truck",
                    ),
                ],
            }
        ]
    )
    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1

    # 此时有 2 条: 人工 + 导入
    count = (
        await db_session.execute(
            select(func.count(Annotation.id)).where(Annotation.task_id == tasks[0].id)
        )
    ).scalar()
    assert count == 2

    # 第二次 import（overwrite）: 应清 _imported，保留人工，不堆叠
    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
        files=_upload_files(payload),
        data={"overwrite": "true"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1

    rows = (
        (
            await db_session.execute(
                select(Annotation).where(Annotation.task_id == tasks[0].id)
            )
        )
        .scalars()
        .all()
    )
    # 应剩 2 条: 人工标注 + 新导入的
    assert len(rows) == 2

    imported_rows = [a for a in rows if a.attributes.get("_imported")]
    manual_rows = [a for a in rows if not a.attributes.get("_imported")]
    assert len(imported_rows) == 1
    assert len(manual_rows) == 1
    # 人工标注的 id 应未变
    assert manual_rows[0].id == manual_ann.id


# ── class_name 校验（软校验，失败不整批失败）────────────────────────


async def test_import_annotations_class_name_not_in_bindings(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    """class_name 不在项目工具单位类别集合 → errors[] + skip，不整批失败。"""
    user, token = super_admin
    # 创建有严格 tool_bindings 的项目
    tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": [{"name": "car"}, {"name": "truck"}],
        }
    }
    project, tasks = await _seed_project_with_tasks(
        db_session, user.id, tool_bindings=tool_bindings
    )
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "annotations": [
                    # 合法类别
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        class_name="car",
                    ),
                    # 不合法类别
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.3,
                            "y": 0.3,
                            "w": 0.1,
                            "h": 0.1,
                        },
                        class_name="pedestrian",
                    ),
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 1
    assert body["skipped"] == 1
    assert len(body["errors"]) == 1
    assert "pedestrian" in body["errors"][0]["reason"]


# ── task 匹配不到 ────────────────────────────────────────────────────


async def test_import_annotations_task_miss(
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
                "annotations": [
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        class_name="car",
                    )
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 0
    assert body["skipped"] == 1
    assert "task not found" in body["errors"][0]["reason"].lower()


# ── dry_run ──────────────────────────────────────────────────────────


async def test_import_annotations_dry_run_not_persisted(
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
                "annotations": [
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        class_name="car",
                    ),
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import"
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
            select(func.count(Annotation.id)).where(Annotation.task_id == tasks[0].id)
        )
    ).scalar()
    assert count == 0


# ── batch 自动流转被抑制 ──────────────────────────────────────────────


async def test_import_annotations_batch_transitions_suppressed(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    """D6: 导入结束后 task.status 正确翻转，但 batch.check_auto_transitions 未被调用。"""
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "annotations": [
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        class_name="car",
                    ),
                ],
            }
        ]
    )

    with patch(
        "app.services.batch.BatchService.check_auto_transitions",
        new_callable=AsyncMock,
    ) as mock_check:
        r = await httpx_client.post(
            f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
            files=_upload_files(payload),
            headers=headers,
        )
        assert r.status_code == 200, r.text
        # check_auto_transitions 不应被调用（D6 抑制 batch 流转）
        mock_check.assert_not_called()

    # task 的统计/状态翻转应正确执行
    await db_session.refresh(tasks[0])
    assert tasks[0].status == "in_progress"


# ── 几何多 kind 透传 ──────────────────────────────────────────────────


async def test_aap_mask_objects_must_match_content_addressed_reference():
    from app.services.annotations_import import _validate_aap_mask_objects
    from app.services.raster_mask_storage import build_rle_reference

    rle = {"encoding": "coco_rle", "size": [2, 3], "counts": [1, 2, 2, 1]}
    reference = build_rle_reference(rle)
    geometry = {
        "type": "video_track_mask",
        "track_id": "mask-1",
        "keyframes": [{"frame_index": 0, "mask": reference}],
    }
    assert _validate_aap_mask_objects(geometry, {reference["sha256"]: rle}) == [rle]
    with pytest.raises(ValueError, match="missing"):
        _validate_aap_mask_objects(geometry, {})


async def test_import_annotations_multi_geometry_kinds(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    """bbox/polygon/rotated_bbox/keypoint/polyline 几何全部透传，不报错。"""
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    geometries = [
        {"type": "bbox", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
        {"type": "polygon", "points": [[0.1, 0.1], [0.5, 0.1], [0.3, 0.4]]},
        {
            "type": "rotated_bbox",
            "cx": 0.5,
            "cy": 0.45,
            "w": 0.2,
            "h": 0.12,
            "angle": 30,
        },
        {
            "type": "keypoint",
            "points": [{"x": 0.1, "y": 0.2, "v": 2}],
        },
        {
            "type": "polyline",
            "points": [[0.1, 0.2], [0.4, 0.5], [0.8, 0.7]],
        },
    ]

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "annotations": [
                    _ann_entry(geometry=g, class_name="car") for g in geometries
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 5
    assert body["skipped"] == 0

    rows = (
        (
            await db_session.execute(
                select(Annotation).where(Annotation.task_id == tasks[0].id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 5

    # 每条 annotation 的 geometry 应与输入完全一致（透传）
    stored_geoms = {a.geometry["type"]: a.geometry for a in rows}
    assert stored_geoms["bbox"] == geometries[0]
    assert stored_geoms["polygon"] == geometries[1]
    assert stored_geoms["rotated_bbox"] == geometries[2]
    assert stored_geoms["keypoint"] == geometries[3]
    assert stored_geoms["polyline"] == geometries[4]

    # tool_unit_id 派生验证
    by_type = {a.annotation_type: a for a in rows}
    assert by_type["polygon"].tool_unit_id == "region"
    assert by_type["rotated_bbox"].tool_unit_id == "rotated_bbox"
    assert by_type["keypoint"].tool_unit_id == "keypoint"
    assert by_type["polyline"].tool_unit_id == "polyline"
    assert by_type["bbox"].tool_unit_id == "bbox"


# ── 缺少 class_name 校验 ─────────────────────────────────────────────


async def test_import_annotations_missing_class_name(
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
                "annotations": [
                    # 无 class_name → skip
                    {
                        "geometry": {
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        }
                    },
                    # 有 class_name → ok
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.3,
                            "y": 0.3,
                            "w": 0.1,
                            "h": 0.1,
                        },
                        class_name="truck",
                    ),
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 1
    assert body["skipped"] == 1
    assert "class_name" in body["errors"][0]["reason"]


# ── 权限 ────────────────────────────────────────────────────────────


async def test_import_annotations_forbidden_for_annotator(
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
        [{"task_match": {"display_id": tasks[0].display_id}, "annotations": []}]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 403


# ── source 默认值 ──────────────────────────────────────────────────


async def test_import_annotations_source_default_manual(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    """entry.source 不在允许集合时默认 manual。"""
    user, token = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    payload = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "annotations": [
                    {
                        "geometry": {
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        },
                        "class_name": "car",
                        "source": "unknown_source",  # 不在允许集合
                    },
                ],
            }
        ]
    )

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/annotations/import?format=aap_json",
        files=_upload_files(payload),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1

    rows = (
        (
            await db_session.execute(
                select(Annotation).where(Annotation.task_id == tasks[0].id)
            )
        )
        .scalars()
        .all()
    )
    assert rows[0].source == "manual"
