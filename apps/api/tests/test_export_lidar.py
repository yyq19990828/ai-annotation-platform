from __future__ import annotations

import json
import os
import struct
import uuid
import zipfile

import pytest

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.task import Task
from app.services.export_lidar import (
    LidarFrameExportCtx,
    build_kitti_lidar_label_lines,
    build_nuscenes_frame_records,
    build_pointmask_label_bytes,
)
from app.services.export_packaging import build_export_zip, clean_export_targets
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
) -> Annotation:
    geometry = geometry or {
        "type": "box_3d",
        "center": [1.0, 2.0, 3.0],
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
    )


def _calib() -> dict:
    return {
        "extrinsic": [1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1],
        "intrinsic": [100, 0, 50, 0, 100, 60, 0, 0, 1],
        "rect": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    }


def test_kitti_lidar_label_maps_attributes_and_camera_frame():
    lines = build_kitti_lidar_label_lines(
        [
            _ann(
                attributes={"occluded": 2, "truncated": 0.25},
            )
        ],
        calib_by_cam={},
    )

    fields = lines[0].split()
    assert len(fields) == 15
    assert fields[:3] == ["car", "0.25", "2"]
    # ISO center [1,2,3] maps through inverse kitti_camera to [-2,-3,1].
    assert [float(v) for v in fields[11:14]] == pytest.approx([-2.0, -3.0, 1.0])


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


def test_nuscenes_records_mark_identity_ego_pose():
    ann = _ann(attributes={"visible": "v60-80"})
    tables = build_nuscenes_frame_records(
        [
            LidarFrameExportCtx(
                task_id=ann.task_id,
                frame_key="000001",
                annotations=[ann],
                cameras={},
            )
        ]
    )

    assert tables["sample_annotation"][0]["translation"] == [1.0, 2.0, 3.0]
    assert tables["sample_annotation"][0]["size"] == [2.0, 4.0, 1.5]
    assert tables["sample_annotation"][0]["visibility_token"] == "visibility-2"
    assert tables["ego_pose"][0]["rotation"] == [1.0, 0.0, 0.0, 0.0]
    assert "placeholder" in tables["ego_pose"][0]["_aap_note"]


@pytest.mark.asyncio
async def test_lidar_export_zip_writes_standard_targets(
    db_session,
    super_admin,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.services.export_packaging.storage_service.generate_download_url",
        lambda key, **_kwargs: f"signed://{key}",
    )
    user, _ = super_admin
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
        metadata_={"calibration": _calib()},
    )
    db_session.add_all([lidar_item, cam_item])
    await db_session.flush()
    task = Task(
        project_id=project.id,
        dataset_item_id=lidar_item.id,
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
        targets=["kitti", "nuscenes", "pointmask"],
        include_attributes=True,
        video_frame_mode="keyframes",
    )
    try:
        assert file_count >= 3
        with zipfile.ZipFile(zip_path) as zf:
            names = set(zf.namelist())
            assert "kitti/label_2/lidar/000001.txt" in names
            assert "kitti/calib/lidar/000001.txt" in names
            assert "kitti/calib_raw/front/lidar/000001.json" in names
            assert "nuscenes/sample_annotation.json" in names
            assert "nuscenes/ego_pose.json" in names
            assert "pointmask/segmentation/lidar/000001.label" in names
            assert "pointmask/category_map.json" in names
            assert "pointmask/fetch_pointclouds.py" in names
            manifest = json.loads(zf.read("kitti/images_manifest.json"))
            assert manifest["images"][0]["camera"] == "front"
            label = zf.read("kitti/label_2/lidar/000001.txt").decode()
            assert label.split()[1:3] == ["0.50", "1"]
            pointmask = zf.read("pointmask/segmentation/lidar/000001.label")
            assert struct.unpack("<4I", pointmask) == (1, 0, 1, 0)
            readme = zf.read("nuscenes/README.txt").decode()
            assert "ego_pose rows are identity placeholders" in readme
    finally:
        os.unlink(zip_path)


def test_clean_export_targets_filters_lidar_targets():
    assert clean_export_targets(["kitti", "pointmask", "kitti"], data_type="lidar") == [
        "kitti",
        "pointmask",
    ]
    with pytest.raises(ValueError, match="lidar project"):
        clean_export_targets(["coco"], data_type="lidar")
