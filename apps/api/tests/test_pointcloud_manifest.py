"""v0.13.2 · 点云 manifest 端点测试 (0.13.2-1)。

GET /api/v1/tasks/{id}/point-cloud/manifest:
  - lidar 项目 + 一 scene (1 帧 lidar + 2 相机 + calib) → 200,
    point_cloud_url 非空、cameras 数量/名字/标定值正确
  - 非 lidar (image) task → 409

不真连 MinIO: monkeypatch storage_service.generate_download_url 返回伪 URL。
"""

from __future__ import annotations

import uuid

import pytest

from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.task import Task
from app.services.task_dataset_link import link_items
from tests.factory import create_project


def _calib(extr_seed: float, intr_seed: float) -> dict:
    return {
        "extrinsic": [extr_seed + i for i in range(16)],
        "intrinsic": [intr_seed + i for i in range(9)],
    }


@pytest.fixture
def _patch_presign(monkeypatch):
    """伪 presign: 直接回 storage.local/<key>,不连 MinIO。"""

    def _fake(key, expires_in=3600, bucket=None):
        return f"http://storage.local/{key}"

    monkeypatch.setattr(
        "app.api.v1.tasks.storage_service.generate_download_url", _fake
    )


async def _seed_lidar_scene(db, owner_id):
    """建 lidar 项目 + dataset(1 lidar + 2 相机帧含 calib) + task + links。"""
    project = await create_project(
        db, owner_id=owner_id, type_key="lidar", type_label="点云检测"
    )
    project.data_type = "lidar"
    await db.flush()

    ds = Dataset(
        display_id=f"DS-PC-{uuid.uuid4().hex[:6]}",
        name="scene-a",
        data_type="point_cloud",
        created_by=owner_id,
    )
    db.add(ds)
    await db.flush()

    lidar_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.pcd",
        file_path="scene-a/lidar/000001.pcd",
        file_type="point_cloud",
    )
    front_calib = _calib(1.0, 100.0)
    rear_calib = _calib(2.0, 200.0)
    front_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.jpg",
        file_path="scene-a/camera/front/000001.jpg",
        file_type="image",
        metadata_={"calibration": front_calib},
    )
    rear_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.jpg",
        file_path="scene-a/camera/rear/000001.jpg",
        file_type="image",
        metadata_={"calibration": rear_calib},
    )
    db.add_all([lidar_item, front_item, rear_item])
    await db.flush()

    task = Task(
        project_id=project.id,
        dataset_item_id=lidar_item.id,
        display_id=f"T-PC-{uuid.uuid4().hex[:6]}",
        file_name="000001.pcd",
        file_path="scene-a/lidar/000001.pcd",
        file_type="point_cloud",
        status="pending",
    )
    db.add(task)
    await db.flush()

    await link_items(
        db,
        task.id,
        [
            (lidar_item.id, "primary_lidar", None),
            (front_item.id, "camera_front", "front"),
            (rear_item.id, "camera_rear", "rear"),
        ],
    )
    return task, front_calib, rear_calib


async def test_point_cloud_manifest_returns_scene(
    db_session, httpx_client, super_admin, _patch_presign
):
    user, token = super_admin
    task, front_calib, rear_calib = await _seed_lidar_scene(db_session, user.id)

    resp = await httpx_client.get(
        f"/api/v1/tasks/{task.id}/point-cloud/manifest",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["task_id"] == str(task.id)
    assert body["point_cloud_format"] == "pcd"
    assert body["expires_in"] == 3600
    assert body["point_cloud_url"] == "http://storage.local/scene-a/lidar/000001.pcd"

    cameras = body["cameras"]
    assert [c["name"] for c in cameras] == ["front", "rear"]  # 按 name 排序
    front, rear = cameras
    assert front["role"] == "camera_front"
    assert front["image_url"] == "http://storage.local/scene-a/camera/front/000001.jpg"
    assert front["calibration"]["extrinsic"] == front_calib["extrinsic"]
    assert front["calibration"]["intrinsic"] == front_calib["intrinsic"]
    assert rear["calibration"]["extrinsic"] == rear_calib["extrinsic"]
    assert rear["calibration"]["intrinsic"] == rear_calib["intrinsic"]


async def test_point_cloud_manifest_rejects_non_lidar_task(
    db_session, httpx_client, super_admin, _patch_presign
):
    user, token = super_admin
    project = await create_project(
        db_session, owner_id=user.id, type_key="image-det"
    )
    # 默认 data_type == "image"
    task = Task(
        project_id=project.id,
        display_id=f"T-IMG-{uuid.uuid4().hex[:6]}",
        file_name="a.jpg",
        file_path="imgs/a.jpg",
        file_type="image",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    resp = await httpx_client.get(
        f"/api/v1/tasks/{task.id}/point-cloud/manifest",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 409, resp.text
