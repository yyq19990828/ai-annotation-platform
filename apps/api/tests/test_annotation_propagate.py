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
async def test_propagate_box3d_copies_and_assigns_shared_group(db_session, super_admin):
    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(
        db_session, owner_id=user.id, axis_convention="kitti_camera"
    )
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=_box3d()
    )
    assert src.group_id is None

    svc = AnnotationService(db_session)
    new, _ = await svc.propagate(
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
    new, _ = await svc.propagate(
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
    new, _ = await svc.propagate(
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
    new, _ = await svc.propagate(
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
        db_session,
        task=tasks_a[0],
        project=project_a,
        user_id=user.id,
        geometry=_box3d(),
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


@pytest.mark.asyncio
async def test_propagate_rejects_cross_scene(db_session, super_admin):
    """同 project / 同 dataset 但目标 task 属于另一个 scene → 422。"""
    from fastapi import HTTPException

    user, _ = super_admin
    project, ds, _, tasks = await _seed_scene(db_session, owner_id=user.id)

    scene_b = Scene(
        display_id=f"SCN-{uuid.uuid4().hex[:6]}",
        dataset_id=ds.id,
        name=f"s2-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(scene_b)
    await db_session.flush()
    stem = "100000"
    item_b = DatasetItem(
        dataset_id=ds.id,
        file_name=f"{stem}.pcd",
        file_path=f"{ds.name}/lidar/{stem}.pcd",
        file_type="point_cloud",
        scene_id=scene_b.id,
        frame_index=0,
    )
    db_session.add(item_b)
    await db_session.flush()
    task_b = Task(
        project_id=project.id,
        dataset_item_id=item_b.id,
        display_id=f"T-PR-{uuid.uuid4().hex[:8]}",
        file_name=f"{stem}.pcd",
        file_path=f"{ds.name}/lidar/{stem}.pcd",
        file_type="point_cloud",
        status="pending",
    )
    db_session.add(task_b)
    await db_session.flush()

    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=_box3d()
    )
    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc:
        await svc.propagate(
            source_annotation_id=src.id,
            target_task_id=task_b.id,
            user_id=user.id,
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


@pytest.mark.asyncio
async def test_propagate_endpoint_annotation_task_mismatch_404(
    db_session, httpx_client, super_admin
):
    """越权防护: annotation 不属于 URL 里的源 task → 404。

    攻击路径: 用一个可见 task_id 作 URL 源, 配上别处 annotation_id 复制他人草稿。
    """
    user, token = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    # annotation 实际属于 tasks[1], 但 URL 源 task 用 tasks[0]。
    src = await _add_annotation(
        db_session, task=tasks[1], project=project, user_id=user.id, geometry=_box3d()
    )
    resp = await httpx_client.post(
        f"/api/v1/tasks/{tasks[0].id}/annotations/{src.id}/propagate-to-task",
        json={"target_task_id": str(tasks[2].id)},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


# ── v0.15.1 · 运动补偿 / 批量 / 区间插值 ─────────────────────────────────


async def _seed_poses(db, scene_id, frames: int, step: float = 2.0):
    """直线轨迹: 帧 i 的 ego 在世界系 x = i*step,无旋转。"""
    from app.schemas.scene_pose import FramePose
    from app.services import scene_pose as scene_pose_svc

    await scene_pose_svc.upsert_frame_poses(
        db,
        scene_id=scene_id,
        poses=[
            FramePose(
                frame_index=i,
                timestamp_us=i * 500000,
                ego_translation=[i * step, 0.0, 0.0],
                ego_rotation=[1.0, 0.0, 0.0, 0.0],
            )
            for i in range(frames)
        ],
    )


@pytest.mark.asyncio
async def test_propagate_motion_compensation(db_session, super_admin):
    """有 ego pose: 静止物世界位置不变 → 目标帧 ego 系 x 减去车的前进量。"""
    user, _ = super_admin
    project, _, scene, tasks = await _seed_scene(db_session, owner_id=user.id)
    await _seed_poses(db_session, scene.id, frames=3, step=2.0)

    src = await _add_annotation(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        geometry=_box3d(center=(10.0, 2.0, 1.0)),
    )
    svc = AnnotationService(db_session)
    new, compensated = await svc.propagate(
        source_annotation_id=src.id, target_task_id=tasks[1].id, user_id=user.id
    )
    assert compensated is True
    # 车从 x=0 前进到 x=2 → 框在新 ego 系 x = 10 - 2 = 8
    assert new.geometry["center"] == pytest.approx([8.0, 2.0, 1.0])
    assert new.geometry["size"] == [4.0, 5.0, 6.0]
    assert new.geometry["rotation"] == pytest.approx([0.0, 0.0, 0.5])


@pytest.mark.asyncio
async def test_propagate_without_pose_keeps_v0141_bytes(db_session, super_admin):
    """无 pose scene: 原样复制 + motion_compensated=False(v0.14.1 零回归)。"""
    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=_box3d()
    )
    svc = AnnotationService(db_session)
    new, compensated = await svc.propagate(
        source_annotation_id=src.id, target_task_id=tasks[1].id, user_id=user.id
    )
    assert compensated is False
    assert new.geometry["center"] == [1.0, 2.0, 3.0]
    assert new.geometry["rotation"] == [0.0, 0.0, 0.5]


@pytest.mark.asyncio
async def test_propagate_override_psr_skips_compensation(db_session, super_admin):
    user, _ = super_admin
    project, _, scene, tasks = await _seed_scene(db_session, owner_id=user.id)
    await _seed_poses(db_session, scene.id, frames=3)
    src = await _add_annotation(
        db_session, task=tasks[0], project=project, user_id=user.id, geometry=_box3d()
    )
    svc = AnnotationService(db_session)
    new, compensated = await svc.propagate(
        source_annotation_id=src.id,
        target_task_id=tasks[1].id,
        user_id=user.id,
        override_psr={"center": [99.0, 0.0, 0.0]},
    )
    assert compensated is False
    assert new.geometry["center"] == [99.0, 0.0, 0.0]


@pytest.mark.asyncio
async def test_propagate_batch_all_box3d(db_session, super_admin):
    user, _ = super_admin
    project, _, scene, tasks = await _seed_scene(db_session, owner_id=user.id)
    await _seed_poses(db_session, scene.id, frames=3, step=2.0)
    a1 = await _add_annotation(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        geometry=_box3d(center=(10.0, 0.0, 0.0)),
    )
    a2 = await _add_annotation(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        geometry=_box3d(center=(20.0, 5.0, 0.0)),
    )
    svc = AnnotationService(db_session)
    results, compensated = await svc.propagate_batch(
        source_task_id=tasks[0].id,
        target_task_id=tasks[1].id,
        annotation_ids=None,
        user_id=user.id,
    )
    assert compensated is True
    assert len(results) == 2
    by_src = {src_id: ann for src_id, ann in results}
    assert by_src[a1.id].geometry["center"] == pytest.approx([8.0, 0.0, 0.0])
    assert by_src[a2.id].geometry["center"] == pytest.approx([18.0, 5.0, 0.0])
    # 各自延续独立 group 链
    assert by_src[a1.id].group_id != by_src[a2.id].group_id
    assert all(ann.task_id == tasks[1].id for _, ann in results)


@pytest.mark.asyncio
async def test_propagate_batch_empty_source_422(db_session, super_admin):
    from fastapi import HTTPException

    user, _ = super_admin
    _, _, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc:
        await svc.propagate_batch(
            source_task_id=tasks[0].id,
            target_task_id=tasks[1].id,
            annotation_ids=None,
            user_id=user.id,
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_propagate_batch_foreign_annotation_404(db_session, super_admin):
    from fastapi import HTTPException

    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    foreign = await _add_annotation(
        db_session, task=tasks[2], project=project, user_id=user.id, geometry=_box3d()
    )
    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc:
        await svc.propagate_batch(
            source_task_id=tasks[0].id,
            target_task_id=tasks[1].id,
            annotation_ids=[foreign.id],
            user_id=user.id,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_interpolate_range_world_lerp(db_session, super_admin):
    """帧 0 与帧 4 各一框(共享 group),插值生成帧 1/2/3;世界系线性内插。"""
    user, _ = super_admin
    project, _, scene, tasks = await _seed_scene(db_session, owner_id=user.id, n=5)
    await _seed_poses(db_session, scene.id, frames=5, step=2.0)

    # 世界系: 框从 (10,0,0) 匀速移到 (18,4,0); 帧 i 的 ego 在 x=2i
    # → 帧 0 ego 系 center=(10,0,0); 帧 4 ego 系 center=(18-8, 4, 0)=(10,4,0)
    a0 = await _add_annotation(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        geometry=_box3d(center=(10.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0)),
        group_id=7_000_000_001,
    )
    await _add_annotation(
        db_session,
        task=tasks[4],
        project=project,
        user_id=user.id,
        geometry=_box3d(center=(10.0, 4.0, 0.0), rotation=(0.0, 0.0, 0.0)),
        group_id=7_000_000_001,
    )
    svc = AnnotationService(db_session)
    created, compensated, skipped = await svc.interpolate_range(
        group_id=7_000_000_001,
        from_task_id=tasks[0].id,
        to_task_id=tasks[4].id,
        user_id=user.id,
    )
    assert compensated is True
    assert skipped == []
    assert [a.task_id for a in created] == [t.id for t in tasks[1:4]]
    # 帧 2 (t=0.5): 世界中心 (14,2,0),ego x=4 → ego 系 (10,2,0)
    mid = created[1]
    assert mid.geometry["center"] == pytest.approx([10.0, 2.0, 0.0])
    assert mid.source == "interpolated"
    assert mid.group_id == 7_000_000_001
    assert mid.class_name == a0.class_name

    # 幂等: 重跑全部跳过,不重复生成
    created2, _, skipped2 = await svc.interpolate_range(
        group_id=7_000_000_001,
        from_task_id=tasks[0].id,
        to_task_id=tasks[4].id,
        user_id=user.id,
    )
    assert created2 == []
    assert skipped2 == [1, 2, 3]


@pytest.mark.asyncio
async def test_interpolate_range_no_pose_degrades(db_session, super_admin):
    """无 pose scene: 纯 ego 系线性插值,motion_compensated=False。"""
    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id, n=3)
    await _add_annotation(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        geometry=_box3d(center=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0)),
        group_id=7_000_000_002,
    )
    await _add_annotation(
        db_session,
        task=tasks[2],
        project=project,
        user_id=user.id,
        geometry=_box3d(center=(4.0, 2.0, 0.0), rotation=(0.0, 0.0, 0.0)),
        group_id=7_000_000_002,
    )
    svc = AnnotationService(db_session)
    created, compensated, _ = await svc.interpolate_range(
        group_id=7_000_000_002,
        from_task_id=tasks[0].id,
        to_task_id=tasks[2].id,
        user_id=user.id,
    )
    assert compensated is False
    assert len(created) == 1
    assert created[0].geometry["center"] == pytest.approx([2.0, 1.0, 0.0])


@pytest.mark.asyncio
async def test_interpolate_range_validations(db_session, super_admin):
    from fastapi import HTTPException

    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id, n=3)
    svc = AnnotationService(db_session)

    # 两端缺框 → 422
    with pytest.raises(HTTPException) as exc:
        await svc.interpolate_range(
            group_id=123,
            from_task_id=tasks[0].id,
            to_task_id=tasks[2].id,
            user_id=user.id,
        )
    assert exc.value.status_code == 422

    # 相邻帧无中间帧 → 422
    await _add_annotation(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        geometry=_box3d(),
        group_id=456,
    )
    await _add_annotation(
        db_session,
        task=tasks[1],
        project=project,
        user_id=user.id,
        geometry=_box3d(),
        group_id=456,
    )
    with pytest.raises(HTTPException) as exc:
        await svc.interpolate_range(
            group_id=456,
            from_task_id=tasks[0].id,
            to_task_id=tasks[1].id,
            user_id=user.id,
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_interpolate_range_locked_mid_task_rejected(db_session, super_admin):
    """中间帧 task 处于锁态 → 整批拒,无部分写入。"""
    from fastapi import HTTPException
    from sqlalchemy import select as sa_select

    user, _ = super_admin
    project, _, _, tasks = await _seed_scene(db_session, owner_id=user.id, n=3)
    await _add_annotation(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        geometry=_box3d(),
        group_id=789,
    )
    await _add_annotation(
        db_session,
        task=tasks[2],
        project=project,
        user_id=user.id,
        geometry=_box3d(),
        group_id=789,
    )
    tasks[1].status = "completed"
    await db_session.flush()

    def _deny_locked(t):
        if t.status in {"review", "completed"}:
            raise HTTPException(status_code=409, detail="task_locked")

    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc:
        await svc.interpolate_range(
            group_id=789,
            from_task_id=tasks[0].id,
            to_task_id=tasks[2].id,
            user_id=user.id,
            assert_task_editable=_deny_locked,
        )
    assert exc.value.status_code == 409
    rows = (
        (
            await db_session.execute(
                sa_select(Annotation).where(Annotation.task_id == tasks[1].id)
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


@pytest.mark.asyncio
async def test_batch_and_interpolate_endpoints(db_session, httpx_client, super_admin):
    user, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    project, _, scene, tasks = await _seed_scene(db_session, owner_id=user.id, n=4)
    await _seed_poses(db_session, scene.id, frames=4, step=2.0)
    await _add_annotation(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        geometry=_box3d(center=(10.0, 0.0, 0.0)),
        group_id=9_000_000_001,
    )

    # propagate-batch: 帧 0 全部 box_3d → 帧 1
    resp = await httpx_client.post(
        f"/api/v1/tasks/{tasks[0].id}/annotations/propagate-batch",
        json={"target_task_id": str(tasks[1].id)},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["motion_compensated"] is True
    assert len(body["items"]) == 1
    assert body["items"][0]["annotation"]["geometry"]["center"] == [8.0, 0.0, 0.0]

    # interpolate-range: 帧 0 ↔ 帧 3(帧 3 手动补一框),生成帧 1 跳过(已有)、帧 2 新建
    await _add_annotation(
        db_session,
        task=tasks[3],
        project=project,
        user_id=user.id,
        geometry=_box3d(center=(10.0, 3.0, 0.0)),
        group_id=9_000_000_001,
    )
    resp = await httpx_client.post(
        f"/api/v1/tasks/{tasks[0].id}/annotations/interpolate-range",
        json={"group_id": 9_000_000_001, "to_task_id": str(tasks[3].id)},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["skipped_frames"] == [1]
    assert len(body["annotations"]) == 1
    assert body["annotations"][0]["source"] == "interpolated"
