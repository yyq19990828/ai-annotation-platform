"""v0.14.1 · 跨帧 propagate 复制语义 + axis_convention + 权限/边界

覆盖判据(plan §1.4 判据 1 / §3.4):
- box_3d 复制 geometry/class/attributes + 共享 group_id(源无则从全局序列分配并写回)
- convention_at_create 取**目标** dataset 的 axis_convention(不是源的)
- 源已有 group_id → 复用, 不再分配新序列值
- 2D bbox / polygon 同样可 propagate
- 不支持的几何(video_bbox / point_mask_3d)→ 422
- 跨 project → 422; 同 task 自身 → 422
- API 端点端到端: 201 + 返回新 annotation
"""

from __future__ import annotations

import uuid

import pytest

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem, Scene
from app.db.models.task import Task
from app.services.annotation import AnnotationService
from tests.factory import create_project


async def _seed_scene(
    db, *, owner_id, n: int = 3, axis_convention: str | None = None, data_type="lidar"
):
    """lidar 项目 + dataset(可带 axis_convention)+ scene + n 帧 task。"""
    project = await create_project(
        db, owner_id=owner_id, type_key="lidar", type_label="点云"
    )
    project.data_type = "lidar"

    ds = Dataset(
        display_id=f"DS-PR-{uuid.uuid4().hex[:6]}",
        name=f"sc-{uuid.uuid4().hex[:6]}",
        data_type="point_cloud",
        created_by=owner_id,
        metadata_={"axis_convention": axis_convention} if axis_convention else {},
    )
    db.add(ds)
    await db.flush()

    scene = Scene(
        display_id=f"SCN-{uuid.uuid4().hex[:6]}",
        dataset_id=ds.id,
        name=f"s-{uuid.uuid4().hex[:6]}",
    )
    db.add(scene)
    await db.flush()

    tasks = []
    for i in range(n):
        stem = f"{i:06d}"
        item = DatasetItem(
            dataset_id=ds.id,
            file_name=f"{stem}.pcd",
            file_path=f"{ds.name}/lidar/{stem}.pcd",
            file_type="point_cloud",
            scene_id=scene.id,
            frame_index=i,
        )
        db.add(item)
        await db.flush()
        task = Task(
            project_id=project.id,
            dataset_item_id=item.id,
            display_id=f"T-PR-{uuid.uuid4().hex[:8]}",
            file_name=f"{stem}.pcd",
            file_path=f"{ds.name}/lidar/{stem}.pcd",
            file_type="point_cloud",
            status="pending",
        )
        db.add(task)
        await db.flush()
        tasks.append(task)
    return project, ds, scene, tasks


def _box3d(center=(1.0, 2.0, 3.0), size=(4.0, 5.0, 6.0), rotation=(0.0, 0.0, 0.5)):
    return {
        "type": "box_3d",
        "center": list(center),
        "size": list(size),
        "rotation": list(rotation),
        "convention_at_create": "iso_8855",
    }


async def _add_annotation(db, *, task, project, user_id, geometry, group_id=None):
    ann = Annotation(
        id=uuid.uuid4(),
        task_id=task.id,
        project_id=project.id,
        user_id=user_id,
        source="manual",
        annotation_type=geometry["type"],
        tool_unit_id="lidar_box_3d" if geometry["type"] == "box_3d" else "bbox",
        class_name="car",
        geometry=geometry,
        group_id=group_id,
        attributes={"occluded": True},
    )
    db.add(ann)
    await db.flush()
    return ann


# ── service-level 复制语义 ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_propagate_box3d_copies_and_assigns_shared_group(
    db_session, super_admin
):
    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(
        db_session, owner_id=user.id, axis_convention="kitti_camera"
    )
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=_box3d()
    )
    assert src.group_id is None

    svc = AnnotationService(db_session)
    new = await svc.propagate(
        source_annotation_id=src.id,
        target_task_id=tasks[1].id,
        user_id=user.id,
    )

    # 几何 PSR 原值复制
    assert new.geometry["center"] == [1.0, 2.0, 3.0]
    assert new.geometry["size"] == [4.0, 5.0, 6.0]
    assert new.geometry["rotation"] == [0.0, 0.0, 0.5]
    # convention_at_create 取目标 dataset(不是源的 iso_8855)
    assert new.geometry["convention_at_create"] == "kitti_camera"
    # class / attributes 深拷贝
    assert new.class_name == "car"
    assert new.attributes == {"occluded": True}
    assert new.task_id == tasks[1].id
    # 共享 group_id: 高位序列, 写回源
    assert new.group_id is not None and new.group_id >= 1_000_000_000
    assert src.group_id == new.group_id


@pytest.mark.asyncio
async def test_propagate_reuses_existing_group_id(db_session, super_admin):
    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    src = await _add_annotation(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        geometry=_box3d(),
        group_id=42,
    )
    svc = AnnotationService(db_session)
    new = await svc.propagate(
        source_annotation_id=src.id, target_task_id=tasks[1].id, user_id=user.id
    )
    assert new.group_id == 42
    assert src.group_id == 42


@pytest.mark.asyncio
async def test_propagate_box3d_null_axis_convention(db_session, super_admin):
    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(
        db_session, owner_id=user.id, axis_convention=None
    )
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=_box3d()
    )
    svc = AnnotationService(db_session)
    new = await svc.propagate(
        source_annotation_id=src.id, target_task_id=tasks[1].id, user_id=user.id
    )
    assert new.geometry["convention_at_create"] is None


@pytest.mark.asyncio
async def test_propagate_bbox_2d(db_session, super_admin):
    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    bbox = {"type": "bbox", "x": 10.0, "y": 20.0, "w": 30.0, "h": 40.0}
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=bbox
    )
    svc = AnnotationService(db_session)
    new = await svc.propagate(
        source_annotation_id=src.id, target_task_id=tasks[1].id, user_id=user.id
    )
    assert new.geometry == bbox
    # 2D 不写 convention_at_create
    assert "convention_at_create" not in new.geometry
    assert new.group_id == src.group_id


@pytest.mark.asyncio
async def test_propagate_rejects_video_bbox(db_session, super_admin):
    from fastapi import HTTPException

    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    vb = {"type": "video_bbox", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=vb
    )
    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc:
        await svc.propagate(
            source_annotation_id=src.id, target_task_id=tasks[1].id, user_id=user.id
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_propagate_rejects_cross_project(db_session, super_admin):
    from fastapi import HTTPException

    user, _ = super_admin
    project_a, _, _, tasks_a = await _seed_scene(db_session, owner_id=user.id)
    _, _, _, tasks_b = await _seed_scene(db_session, owner_id=user.id)
    src = await _add_annotation(
        db_session, task=tasks_a[0], project=project_a, user_id=user.id, geometry=_box3d()
    )
    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc:
        await svc.propagate(
            source_annotation_id=src.id,
            target_task_id=tasks_b[0].id,
            user_id=user.id,
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_propagate_rejects_same_task(db_session, super_admin):
    from fastapi import HTTPException

    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=_box3d()
    )
    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc:
        await svc.propagate(
            source_annotation_id=src.id, target_task_id=tasks[0].id, user_id=user.id
        )
    assert exc.value.status_code == 422


# ── API 端点端到端 ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_propagate_endpoint_201(db_session, httpx_client, super_admin):
    user, token = super_admin
    project, _, _, tasks = await _seed_scene(
        db_session, owner_id=user.id, axis_convention="ros_rep103"
    )
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=_box3d()
    )

    resp = await httpx_client.post(
        f"/api/v1/tasks/{tasks[0].id}/annotations/{src.id}/propagate-to-task",
        json={"target_task_id": str(tasks[1].id)},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    ann = body["annotation"]
    assert ann["task_id"] == str(tasks[1].id)
    assert ann["geometry"]["convention_at_create"] == "ros_rep103"
    assert ann["group_id"] is not None and ann["group_id"] >= 1_000_000_000


@pytest.mark.asyncio
async def test_propagate_endpoint_target_not_found(
    db_session, httpx_client, super_admin
):
    user, token = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=_box3d()
    )
    resp = await httpx_client.post(
        f"/api/v1/tasks/{tasks[0].id}/annotations/{src.id}/propagate-to-task",
        json={"target_task_id": str(uuid.uuid4())},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404
