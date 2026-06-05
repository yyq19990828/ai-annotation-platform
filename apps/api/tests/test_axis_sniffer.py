from __future__ import annotations

import uuid

import pytest

from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.task import Task
from app.services.axis_convention import R_NORM
from app.services.task_dataset_link import link_items
from tests.factory import create_project


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _calib_for(convention: str) -> dict:
    m = R_NORM[convention]
    return {
        "extrinsic": [
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            m[0],
            m[1],
            m[2],
            0,
            0,
            0,
            0,
            1,
        ],
        "intrinsic": [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }


async def _seed_dataset(db, owner_id, *, with_front: bool = True):
    ds = Dataset(
        display_id=f"DS-SNIFF-{uuid.uuid4().hex[:6]}",
        name="sniff-scene",
        data_type="point_cloud",
        created_by=owner_id,
    )
    db.add(ds)
    await db.flush()

    front_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.jpg",
        file_path="scene/camera/front/000001.jpg",
        file_type="image",
        metadata_={"calibration": _calib_for("sustechpoints_demo")}
        if with_front
        else {},
    )
    side_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.jpg",
        file_path="scene/camera/left/000001.jpg",
        file_type="image",
        metadata_={"calibration": _calib_for("apollo")},
    )
    db.add_all([front_item, side_item])
    await db.flush()
    return ds, front_item, side_item


async def test_sniff_axis_convention_prefers_front_task_link(
    db_session,
    httpx_client,
    super_admin,
):
    user, token = super_admin
    ds, front_item, side_item = await _seed_dataset(db_session, user.id)
    project = await create_project(
        db_session,
        owner_id=user.id,
        type_key="lidar",
        type_label="点云检测",
    )
    project.data_type = "lidar"
    task = Task(
        project_id=project.id,
        dataset_item_id=None,
        display_id=f"T-SNIFF-{uuid.uuid4().hex[:6]}",
        file_name="000001.pcd",
        file_path="scene/lidar/000001.pcd",
        file_type="point_cloud",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()
    await link_items(
        db_session,
        task.id,
        [
            (side_item.id, "camera_left", "left"),
            (front_item.id, "camera_front", "front"),
        ],
    )
    await db_session.commit()

    resp = await httpx_client.post(
        f"/api/v1/datasets/{ds.id}/sniff-axis-convention",
        headers=_bearer(token),
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["best"] == "sustechpoints_demo"
    assert body["score"] == pytest.approx(1.0)
    assert body["source"] == "task_link"
    assert body["camera_role"] == "camera_front"
    assert body["camera_item_id"] == str(front_item.id)


async def test_sniff_axis_convention_falls_back_to_dataset_item_with_discount(
    db_session,
    httpx_client,
    super_admin,
):
    user, token = super_admin
    ds, _, side_item = await _seed_dataset(db_session, user.id, with_front=False)
    await db_session.commit()

    resp = await httpx_client.post(
        f"/api/v1/datasets/{ds.id}/sniff-axis-convention",
        headers=_bearer(token),
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["best"] == "apollo"
    assert body["score"] == pytest.approx(0.75)
    assert body["source"] == "dataset_item"
    assert body["camera_item_id"] == str(side_item.id)


async def test_sniff_axis_convention_skips_non_image_items(
    db_session,
    httpx_client,
    super_admin,
):
    # 回归: 点云 item(file_type=point_cloud)即便 metadata 带 lidar→ego 外参,也不应被
    # 当相机喂给 sniff 污染推断(fallback 只看 file_type=="image")。这里点云项路径含 front
    # (若不过滤会被排到最前), 外参指向 sustechpoints_demo; image 项指向 apollo。
    user, token = super_admin
    ds = Dataset(
        display_id=f"DS-SKIP-{uuid.uuid4().hex[:6]}",
        name="skip-non-image",
        data_type="point_cloud",
        created_by=user.id,
    )
    db_session.add(ds)
    await db_session.flush()
    db_session.add(
        DatasetItem(
            dataset_id=ds.id,
            file_name="000001.pcd",
            file_path="scene/lidar/front/000001.pcd",
            file_type="point_cloud",
            metadata_={"calibration": _calib_for("sustechpoints_demo")},
        )
    )
    image_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.jpg",
        file_path="scene/camera/left/000001.jpg",
        file_type="image",
        metadata_={"calibration": _calib_for("apollo")},
    )
    db_session.add(image_item)
    await db_session.commit()

    resp = await httpx_client.post(
        f"/api/v1/datasets/{ds.id}/sniff-axis-convention",
        headers=_bearer(token),
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 只看到 image item → apollo; 若回归(未过滤 file_type)则会变成 sustechpoints_demo。
    assert body["best"] == "apollo"
    assert body["source"] == "dataset_item"
    assert body["camera_item_id"] == str(image_item.id)


async def test_sniff_axis_convention_returns_null_without_calibration(
    db_session,
    httpx_client,
    super_admin,
):
    user, token = super_admin
    ds = Dataset(
        display_id=f"DS-NULL-{uuid.uuid4().hex[:6]}",
        name="no-calib",
        data_type="point_cloud",
        created_by=user.id,
    )
    db_session.add(ds)
    await db_session.flush()
    db_session.add(
        DatasetItem(
            dataset_id=ds.id,
            file_name="000001.jpg",
            file_path="scene/camera/front/000001.jpg",
            file_type="image",
            metadata_={},
        )
    )
    await db_session.commit()

    resp = await httpx_client.post(
        f"/api/v1/datasets/{ds.id}/sniff-axis-convention",
        headers=_bearer(token),
    )

    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "best": None,
        "score": None,
        "candidates": [],
        "source": None,
        "camera_role": None,
        "camera_item_id": None,
    }
