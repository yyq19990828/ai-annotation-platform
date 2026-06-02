"""v0.13.1 · 点云 scene 建任务 + 标定写入 service 测试。

不真连 MinIO：attach_calibration 通过 monkeypatch storage_service.client.get_object
返回伪 body。其余直接构造 ORM 行 + db_session fixture。
"""

from __future__ import annotations

import io
import json
import uuid

import pytest

from app.db.models.dataset import Dataset, DatasetItem
from app.services import pointcloud_import
from app.services.storage import storage_service
from app.services.task_dataset_link import get_linked_items
from tests.factory import create_project


pytestmark = pytest.mark.asyncio


async def _seed_dataset(db_session, owner_id: uuid.UUID) -> Dataset:
    ds = Dataset(
        id=uuid.uuid4(),
        display_id=f"D-PC-{uuid.uuid4().hex[:6]}",
        name=f"pc-{uuid.uuid4().hex[:6]}",
        data_type="point_cloud",
        created_by=owner_id,
    )
    db_session.add(ds)
    await db_session.flush()
    return ds


def _add_item(db_session, dataset_id, file_path, file_type):
    item = DatasetItem(
        id=uuid.uuid4(),
        dataset_id=dataset_id,
        file_name=file_path.rsplit("/", 1)[-1],
        file_path=file_path,
        file_type=file_type,
    )
    db_session.add(item)
    return item


async def _seed_scene(db_session, ds, frames, cameras):
    """构造 frames × cameras 的 scene：每帧 1 lidar + 每相机 1 image。

    返回 {frame_id: {"lidar": item, "cameras": {cam: item}}}（用于断言）。
    """
    name = ds.name
    out: dict = {}
    for frame in frames:
        lidar = _add_item(
            db_session, ds.id, f"{name}/lidar/{frame}.pcd", "point_cloud"
        )
        cams = {}
        for cam in cameras:
            cams[cam] = _add_item(
                db_session, ds.id, f"{name}/camera/{cam}/{frame}.jpg", "image"
            )
        out[frame] = {"lidar": lidar, "cameras": cams}
    await db_session.flush()
    return out


async def test_build_tasks_groups_frames_and_links(db_session, super_admin):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id)
    project = await create_project(db_session, owner_id=user.id)
    seeded = await _seed_scene(db_session, ds, ["000970", "000971"], ["front", "left"])

    result = await pointcloud_import.build_pointcloud_tasks_for_link(
        db_session, dataset_id=ds.id, project_id=project.id
    )
    assert result == {"created": 2, "total": 2}

    from sqlalchemy import select
    from app.db.models import Task

    tasks = (
        await db_session.execute(
            select(Task).where(Task.project_id == project.id)
        )
    ).scalars().all()
    assert len(tasks) == 2

    by_lidar = {t.dataset_item_id: t for t in tasks}
    for frame_id, frame in seeded.items():
        lidar_id = frame["lidar"].id
        assert lidar_id in by_lidar
        task = by_lidar[lidar_id]
        assert task.file_type == "point_cloud"
        assert task.file_name == frame["lidar"].file_name
        assert task.file_path == frame["lidar"].file_path

        links = await get_linked_items(db_session, task.id)
        assert len(links) == 3
        by_role = {ln.role: ln for ln in links}
        assert by_role["primary_lidar"].dataset_item_id == lidar_id
        assert by_role["primary_lidar"].sensor_name is None
        assert by_role["camera_front"].dataset_item_id == frame["cameras"]["front"].id
        assert by_role["camera_front"].sensor_name == "front"
        assert by_role["camera_left"].dataset_item_id == frame["cameras"]["left"].id
        assert by_role["camera_left"].sensor_name == "left"


async def test_build_tasks_idempotent(db_session, super_admin):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id)
    project = await create_project(db_session, owner_id=user.id)
    await _seed_scene(db_session, ds, ["000970", "000971"], ["front"])

    first = await pointcloud_import.build_pointcloud_tasks_for_link(
        db_session, dataset_id=ds.id, project_id=project.id
    )
    assert first["created"] == 2

    second = await pointcloud_import.build_pointcloud_tasks_for_link(
        db_session, dataset_id=ds.id, project_id=project.id
    )
    assert second == {"created": 0, "total": 0}


async def test_build_tasks_missing_camera_tolerated(db_session, super_admin):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id)
    project = await create_project(db_session, owner_id=user.id)

    # 帧 000970 完整 (front+left)，帧 000971 只有 lidar+front。
    name = ds.name
    _add_item(db_session, ds.id, f"{name}/lidar/000970.pcd", "point_cloud")
    _add_item(db_session, ds.id, f"{name}/camera/front/000970.jpg", "image")
    _add_item(db_session, ds.id, f"{name}/camera/left/000970.jpg", "image")
    lidar1 = _add_item(db_session, ds.id, f"{name}/lidar/000971.pcd", "point_cloud")
    _add_item(db_session, ds.id, f"{name}/camera/front/000971.jpg", "image")
    await db_session.flush()

    result = await pointcloud_import.build_pointcloud_tasks_for_link(
        db_session, dataset_id=ds.id, project_id=project.id
    )
    assert result == {"created": 2, "total": 2}

    from sqlalchemy import select
    from app.db.models import Task

    task1 = (
        await db_session.execute(
            select(Task).where(Task.dataset_item_id == lidar1.id)
        )
    ).scalar_one()
    links = await get_linked_items(db_session, task1.id)
    # 缺 left：只 link lidar + front 两条，不报错。
    roles = {ln.role for ln in links}
    assert roles == {"primary_lidar", "camera_front"}


def _patch_get_object(monkeypatch, payload: dict):
    def fake_get_object(*, Bucket, Key):  # noqa: N803 (boto3 kwarg names)
        return {"Body": io.BytesIO(json.dumps(payload).encode())}

    monkeypatch.setattr(storage_service.client, "get_object", fake_get_object)


async def test_attach_calibration_writes_metadata(db_session, super_admin, monkeypatch):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id)
    seeded = await _seed_scene(db_session, ds, ["000970", "000971"], ["front"])
    _add_item(db_session, ds.id, f"{ds.name}/calib/camera/front.json", "other")
    await db_session.flush()

    calib = {
        "extrinsic": list(range(16)),
        "intrinsic": list(range(9)),
        "rect": [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }
    _patch_get_object(monkeypatch, calib)

    written = await pointcloud_import.attach_calibration(db_session, dataset_id=ds.id)
    # front 相机 2 帧 → 写 2 个 DatasetItem。
    assert written == 2
    for frame in seeded.values():
        cam_item = frame["cameras"]["front"]
        assert cam_item.metadata_["calibration"] == calib


async def test_attach_calibration_invalid_skipped(db_session, super_admin, monkeypatch):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id)
    seeded = await _seed_scene(db_session, ds, ["000970"], ["front"])
    _add_item(db_session, ds.id, f"{ds.name}/calib/camera/front.json", "other")
    await db_session.flush()

    # extrinsic 长度非 16 → 跳过，不写不抛。
    _patch_get_object(monkeypatch, {"extrinsic": [1, 2, 3], "intrinsic": list(range(9))})

    written = await pointcloud_import.attach_calibration(db_session, dataset_id=ds.id)
    assert written == 0
    cam_item = seeded["000970"]["cameras"]["front"]
    assert "calibration" not in (cam_item.metadata_ or {})
