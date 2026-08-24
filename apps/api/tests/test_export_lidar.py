from __future__ import annotations

import json
import math
import os
import struct
import uuid
import zipfile

import pytest
from sqlalchemy import func, select

from app.db.models.annotation import Annotation
from app.db.models.async_job import AsyncJob
from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.schemas._jsonb_types import SensorCalibration
from app.schemas.export import LidarExportOptions
from app.services.exporting.lidar import (
    LidarCameraExportCtx,
    build_kitti_lidar_frame,
    build_kitti_lidar_label_lines,
    build_nuscenes_frame_records,
    build_pointmask_label_bytes,
)
from app.services.exporting.lidar_preflight import (
    calibration_is_valid,
    preflight_lidar_export,
)
from app.services.exporting.packaging import build_export_zip, clean_export_targets
from app.services.task_dataset_link import link_items
from tests.factory import create_project


def _ann(
    *,
    task_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    class_name: str = "car",
    geometry: dict | None = None,
    attributes: dict | None = None,
    track_id: str | None = None,
) -> Annotation:
    geometry = geometry or {
        "type": "box_3d",
        "center": [10.0, 0.0, 0.0],
        "size": [4.0, 2.0, 1.5],
        "rotation": [0.0, 0.0, 0.0],
    }
    return Annotation(
        id=uuid.uuid4(),
        task_id=task_id or uuid.uuid4(),
        project_id=project_id or uuid.uuid4(),
        user_id=user_id or uuid.uuid4(),
        annotation_type=geometry.get("type", "box_3d"),
        tool_unit_id=(
            "point_mask_3d"
            if geometry.get("type") == "point_mask_3d"
            else "lidar_box_3d"
        ),
        class_name=class_name,
        geometry=geometry,
        attributes=attributes or {},
        track_id=track_id,
    )


def _calib() -> dict:
    return {
        "extrinsic": [0, -1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 0, 0, 0, 1],
        "intrinsic": [100, 0, 100, 0, 100, 60, 0, 0, 1],
        "rect": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    }


def _camera() -> LidarCameraExportCtx:
    return LidarCameraExportCtx(
        role="camera_front",
        name="front",
        calibration=SensorCalibration.model_validate(_calib()),
        width=200,
        height=120,
    )


def test_kitti_lidar_label_projects_bbox_and_camera_bottom_center():
    lines = build_kitti_lidar_label_lines(
        [
            _ann(
                attributes={"occluded": 2, "truncated": 0.25},
            )
        ],
        camera=_camera(),
        axis_convention="iso_8855",
    )

    fields = lines[0].split()
    assert len(fields) == 15
    assert fields[0] == "car"
    assert fields[2] == "2"
    assert [float(value) for value in fields[4:8]] == pytest.approx(
        [87.5, 50.62, 112.5, 69.38]
    )
    assert [float(value) for value in fields[8:11]] == pytest.approx([1.5, 2.0, 4.0])
    assert [float(value) for value in fields[11:14]] == pytest.approx([0.0, 0.75, 10.0])
    assert float(fields[14]) == pytest.approx(-math.pi / 2, abs=1e-6)
    assert float(fields[3]) == pytest.approx(-math.pi / 2, abs=1e-6)


@pytest.mark.parametrize(
    ("center", "expected_reason"),
    [
        ([-5.0, 0.0, 0.0], "behind_camera"),
        ([10.0, 50.0, 0.0], "outside_image_or_degenerate"),
    ],
)
def test_kitti_lidar_skips_fully_invisible_boxes(center, expected_reason):
    result = build_kitti_lidar_frame(
        [
            _ann(
                geometry={
                    "type": "box_3d",
                    "center": center,
                    "size": [2, 2, 2],
                    "rotation": [0, 0, 0],
                }
            )
        ],
        camera=_camera(),
        axis_convention="iso_8855",
    )

    assert result.lines == []
    assert result.skipped[0].reason == expected_reason


def test_kitti_lidar_clips_near_plane_and_image_boundary():
    near = build_kitti_lidar_frame(
        [
            _ann(
                geometry={
                    "type": "box_3d",
                    "center": [1, 0, 0],
                    "size": [2, 1, 1],
                    "rotation": [0, 0, 0],
                }
            )
        ],
        camera=_camera(),
        axis_convention="iso_8855",
    )
    partial = build_kitti_lidar_frame(
        [
            _ann(
                geometry={
                    "type": "box_3d",
                    "center": [10, 9.5, 0],
                    "size": [4, 4, 2],
                    "rotation": [0, 0, 0],
                }
            )
        ],
        camera=_camera(),
        axis_convention="iso_8855",
    )

    assert len(near.lines) == 1
    assert len(partial.lines) == 1
    partial_fields = partial.lines[0].split()
    assert float(partial_fields[1]) > 0
    assert float(partial_fields[4]) == 0


def test_kitti_lidar_non_iso_source_axis_matches_iso_projection():
    apollo_camera = LidarCameraExportCtx(
        role="camera_front",
        name="front",
        calibration=SensorCalibration.model_validate(
            {
                **_calib(),
                "extrinsic": [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1],
            }
        ),
        width=200,
        height=120,
    )
    annotation = _ann()

    iso = build_kitti_lidar_label_lines(
        [annotation], camera=_camera(), axis_convention="iso_8855"
    )
    apollo = build_kitti_lidar_label_lines(
        [annotation], camera=apollo_camera, axis_convention="apollo"
    )

    assert [float(value) for value in iso[0].split()[1:]] == pytest.approx(
        [float(value) for value in apollo[0].split()[1:]]
    )


def test_pointmask_builds_uint32_labels_with_one_based_category_ids():
    label_bytes = build_pointmask_label_bytes(
        [
            _ann(
                class_name="car",
                geometry={
                    "type": "point_mask_3d",
                    "point_indices": [1, 3],
                    "source_point_count": 5,
                },
            )
        ],
        source_point_count=None,
        category_map={"car": 1},
    )

    assert struct.unpack("<5I", label_bytes) == (0, 1, 0, 1, 0)


def test_nuscenes_serializer_refuses_placeholder_output():
    with pytest.raises(ValueError, match="nuscenes_export_not_trusted"):
        build_nuscenes_frame_records([])


def test_lidar_preflight_rejects_non_rigid_or_negative_focal_calibration():
    assert calibration_is_valid(_calib()) is True
    sheared = _calib()
    sheared["extrinsic"] = [1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    assert calibration_is_valid(sheared) is False
    negative_focal = _calib()
    negative_focal["intrinsic"] = [-100, 0, 100, 0, 100, 60, 0, 0, 1]
    assert calibration_is_valid(negative_focal) is False


@pytest.mark.asyncio
async def test_lidar_preflight_reports_axis_size_and_calibration_issues(
    db_session,
    super_admin,
):
    user, _ = super_admin
    project = await create_project(
        db_session,
        owner_id=user.id,
        type_key="lidar",
        type_label="点云检测",
        classes=["car"],
    )
    project.data_type = "lidar"
    dataset = Dataset(
        display_id=f"DS-PF-{uuid.uuid4().hex[:6]}",
        name="preflight",
        data_type="point_cloud",
        created_by=user.id,
        metadata_={},
    )
    db_session.add(dataset)
    await db_session.flush()
    lidar_item = DatasetItem(
        dataset_id=dataset.id,
        file_name="000001.pcd",
        file_path="preflight/lidar/000001.pcd",
        file_type="point_cloud",
    )
    camera_item = DatasetItem(
        dataset_id=dataset.id,
        file_name="000001.jpg",
        file_path="preflight/camera/front/000001.jpg",
        file_type="image",
        metadata_={},
    )
    db_session.add_all([lidar_item, camera_item])
    await db_session.flush()
    task = Task(
        project_id=project.id,
        dataset_item_id=lidar_item.id,
        display_id=f"T-PF-{uuid.uuid4().hex[:6]}",
        file_name="000001.pcd",
        file_path=lidar_item.file_path,
        file_type="point_cloud",
    )
    db_session.add(task)
    await db_session.flush()
    await link_items(
        db_session,
        task.id,
        [
            (lidar_item.id, "primary_lidar", None),
            (camera_item.id, "camera_front", "front"),
        ],
    )

    report = await preflight_lidar_export(
        db_session,
        project_id=project.id,
        batch_id=None,
        targets=["kitti"],
        options=LidarExportOptions(kitti_camera_role="camera_front"),
    )

    assert report.ready is False
    assert report.camera_roles == ["camera_front"]
    assert {issue.code for issue in report.issues} == {
        "axis_convention_missing",
        "camera_image_size_missing",
        "camera_calibration_invalid",
    }


@pytest.mark.asyncio
async def test_failed_lidar_preflight_creates_no_async_job(
    db_session,
    super_admin,
    httpx_client_bound,
    monkeypatch,
):
    user, token = super_admin
    project = await create_project(
        db_session,
        owner_id=user.id,
        type_key="lidar",
        type_label="点云检测",
        classes=["car"],
    )
    project.data_type = "lidar"
    dispatched = False

    def _dispatch(**_kwargs):
        nonlocal dispatched
        dispatched = True

    monkeypatch.setattr("app.workers.export.run_export.delay", _dispatch)

    preflight_response = await httpx_client_bound.post(
        f"/api/v1/projects/{project.id}/exports/lidar:preflight",
        json={"targets": ["kitti"], "lidar": {}},
        headers={"Authorization": f"Bearer {token}"},
    )
    response = await httpx_client_bound.post(
        f"/api/v1/projects/{project.id}/export?targets=kitti",
        json={"lidar": {"kitti_camera_role": "camera_front"}},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert preflight_response.status_code == 200
    assert preflight_response.json()["issues"][0]["code"] == "kitti_camera_required"
    assert response.status_code == 409
    assert response.json()["detail"]["ready"] is False
    assert dispatched is False
    job_count = await db_session.scalar(
        select(func.count(AsyncJob.id)).where(AsyncJob.project_id == project.id)
    )
    assert job_count == 0


@pytest.mark.asyncio
async def test_lidar_export_zip_writes_standard_targets(
    db_session,
    super_admin,
    httpx_client_bound,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.services.exporting.packaging.storage_service.generate_download_url",
        lambda key, **_kwargs: f"signed://{key}",
    )
    user, token = super_admin
    project = await create_project(
        db_session,
        owner_id=user.id,
        type_key="lidar",
        type_label="点云检测",
        classes=["car"],
    )
    project.data_type = "lidar"
    project.tool_bindings = {
        "lidar_box_3d": {
            "enabled": True,
            "classes": [{"name": "car", "order": 0}],
            "attribute_schema": {
                "fields": [
                    {"key": "occluded"},
                    {"key": "truncated"},
                    {"key": "visible"},
                ]
            },
        },
        "point_mask_3d": {
            "enabled": True,
            "classes": [{"name": "car", "order": 0}],
            "attribute_schema": {"fields": []},
        },
    }
    ds = Dataset(
        display_id=f"DS-LX-{uuid.uuid4().hex[:6]}",
        name="scene-a",
        data_type="point_cloud",
        created_by=user.id,
        metadata_={"axis_convention": "iso_8855"},
    )
    db_session.add(ds)
    await db_session.flush()
    lidar_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.pcd",
        file_path="scene-a/lidar/000001.pcd",
        file_type="point_cloud",
        metadata_={"point_count": 4},
    )
    cam_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.jpg",
        file_path="scene-a/camera/front/000001.jpg",
        file_type="image",
        width=200,
        height=120,
        metadata_={"calibration": _calib()},
    )
    cam_back_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.jpg",
        file_path="scene-a/camera/back/000001.jpg",
        file_type="image",
        width=200,
        height=120,
        metadata_={"calibration": _calib()},
    )
    db_session.add_all([lidar_item, cam_item, cam_back_item])
    await db_session.flush()
    batch = TaskBatch(
        project_id=project.id,
        dataset_id=ds.id,
        display_id=f"B-LX-{uuid.uuid4().hex[:6]}",
        name="LiDAR export batch",
        created_by=user.id,
    )
    db_session.add(batch)
    await db_session.flush()
    task = Task(
        project_id=project.id,
        dataset_item_id=lidar_item.id,
        batch_id=batch.id,
        display_id=f"T-LX-{uuid.uuid4().hex[:6]}",
        file_name="000001.pcd",
        file_path=lidar_item.file_path,
        file_type="point_cloud",
    )
    db_session.add(task)
    await db_session.flush()
    await link_items(
        db_session,
        task.id,
        [
            (lidar_item.id, "primary_lidar", None),
            (cam_item.id, "camera_front", "front"),
            (cam_back_item.id, "camera_back", "back"),
        ],
    )
    db_session.add(
        _ann(
            task_id=task.id,
            project_id=project.id,
            user_id=user.id,
            attributes={"occluded": 1, "truncated": 0.5, "visible": "v80-100"},
        )
    )
    db_session.add(
        _ann(
            task_id=task.id,
            project_id=project.id,
            user_id=user.id,
            class_name="car",
            geometry={
                "type": "point_mask_3d",
                "point_indices": [0, 2],
                "source_point_count": 4,
            },
        )
    )
    await db_session.flush()

    zip_path, file_count, _size = await build_export_zip(
        db_session,
        project.id,
        batch_id=None,
        targets=["kitti", "pointmask"],
        include_attributes=True,
        video_frame_mode="keyframes",
        format_options={"lidar": {"kitti_camera_role": "camera_front"}},
    )
    try:
        assert file_count >= 2
        with zipfile.ZipFile(zip_path) as zf:
            names = set(zf.namelist())
            assert "kitti/label_2/lidar/000001.txt" in names
            assert "kitti/calib/lidar/000001.txt" in names
            assert "kitti/calib_raw/front/lidar/000001.json" in names
            assert "pointmask/segmentation/lidar/000001.label" in names
            assert "pointmask/category_map.json" in names
            assert "pointmask/fetch_pointclouds.py" in names
            manifest = json.loads(zf.read("kitti/images_manifest.json"))
            assert len(manifest["images"]) == 1
            assert manifest["images"][0]["camera"] == "front"
            pointmask_manifest = json.loads(zf.read("pointmask/images_manifest.json"))
            assert {item["camera"] for item in pointmask_manifest["images"]} == {
                "front",
                "back",
            }
            assert "pointmask/calib_raw/back/lidar/000001.json" in names
            label = zf.read("kitti/label_2/lidar/000001.txt").decode()
            assert label.split()[2] == "1"
            assert "-1.00 -1.00 -1.00 -1.00" not in label
            report = json.loads(zf.read("kitti/export_report.json"))
            assert report["camera_role"] == "camera_front"
            assert report["exported_annotations"] == 1
            pointmask = zf.read("pointmask/segmentation/lidar/000001.label")
            assert struct.unpack("<4I", pointmask) == (1, 0, 1, 0)
    finally:
        os.unlink(zip_path)

    with pytest.raises(ValueError, match="nuscenes_export_not_trusted"):
        await build_export_zip(
            db_session,
            project.id,
            batch_id=None,
            targets=["nuscenes"],
            include_attributes=True,
            video_frame_mode="keyframes",
        )

    dispatched: dict = {}
    monkeypatch.setattr(
        "app.workers.export.run_export.delay",
        lambda **kwargs: dispatched.update(kwargs),
    )
    preflight_response = await httpx_client_bound.post(
        f"/api/v1/projects/{project.id}/exports/lidar:preflight",
        json={
            "targets": ["kitti", "pointmask"],
            "lidar": {"kitti_camera_role": "camera_front"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    batch_preflight_response = await httpx_client_bound.post(
        f"/api/v1/projects/{project.id}/batches/{batch.id}/exports/lidar:preflight",
        json={
            "targets": ["kitti"],
            "lidar": {"kitti_camera_role": "camera_front"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    export_response = await httpx_client_bound.post(
        f"/api/v1/projects/{project.id}/export?targets=kitti&targets=pointmask",
        json={"lidar": {"kitti_camera_role": "camera_front"}},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert preflight_response.status_code == 200
    assert preflight_response.json()["ready"] is True
    assert batch_preflight_response.status_code == 200
    assert batch_preflight_response.json()["checked_tasks"] == 1
    assert batch_preflight_response.json()["ready"] is True
    assert export_response.status_code == 202
    assert dispatched["opts"]["lidar"] == {"kitti_camera_role": "camera_front"}


def test_clean_export_targets_filters_lidar_targets():
    assert clean_export_targets(["kitti", "pointmask", "kitti"], data_type="lidar") == [
        "kitti",
        "pointmask",
    ]
    with pytest.raises(ValueError, match="lidar project"):
        clean_export_targets(["coco"], data_type="lidar")
