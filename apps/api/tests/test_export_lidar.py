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
from app.db.models.dataset import Dataset, DatasetItem, Scene
from app.db.models.scene_pose import SceneFramePose
from app.db.models.task import Task
from app.schemas._jsonb_types import SensorCalibration
from app.services.exporting.lidar import (
    LidarCameraExportCtx,
    LidarFrameExportCtx,
    build_kitti_lidar_label_lines,
    build_lidar_coco,
    build_nuscenes_frame_records,
    build_pointmask_label_bytes,
)
from app.services.exporting.packaging import build_export_zip, clean_export_targets
from app.services.exporting.service import UnsupportedExportError
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
        track_id=track_id,
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
        calibration=SensorCalibration.model_validate(_calib()),
        image_width=200,
        image_height=200,
    )

    fields = lines[0].split()
    assert len(fields) == 15
    assert fields[:3] == ["car", "0.25", "2"]
    assert [float(v) for v in fields[11:14]] == pytest.approx([2.0, 4.0, 5.25])
    assert float(fields[14]) == pytest.approx(0.0)


def test_kitti_lidar_label_matches_hand_calculated_oracle():
    calibration = SensorCalibration(
        extrinsic=[0, -1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 0, 0, 0, 1],
        intrinsic=[800, 0, 640, 0, 800, 360, 0, 0, 1],
    )
    line = build_kitti_lidar_label_lines(
        [
            _ann(
                geometry={
                    "type": "box_3d",
                    "center": [10.0, 0.0, 0.0],
                    "size": [4.0, 2.0, 2.0],
                    "rotation": [0.0, 0.0, 0.0],
                }
            )
        ],
        calibration=calibration,
        image_width=1280,
        image_height=720,
    ).pop()
    fields = line.split()

    assert [float(value) for value in fields[4:8]] == pytest.approx(
        [540.0, 260.0, 740.0, 460.0]
    )
    assert [float(value) for value in fields[8:14]] == pytest.approx(
        [2.0, 2.0, 4.0, 0.0, 1.0, 10.0]
    )
    assert float(fields[3]) == pytest.approx(-math.pi / 2, abs=1e-6)
    assert float(fields[14]) == pytest.approx(-math.pi / 2, abs=1e-6)


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


def test_lidar_coco_counts_invisible_boxes_and_uncalibrated_cameras():
    calibration = SensorCalibration.model_validate(_calib())
    frame = LidarFrameExportCtx(
        task_id=uuid.uuid4(),
        frame_key="000001",
        annotations=[
            _ann(
                geometry={
                    "type": "box_3d",
                    "center": [0.0, 0.0, -10.0],
                    "size": [2.0, 2.0, 2.0],
                    "rotation": [0.0, 0.0, 0.0],
                }
            )
        ],
        cameras={
            "camera_front": LidarCameraExportCtx(
                role="camera_front",
                sensor_name="front",
                source_name="000001.jpg",
                width=200,
                height=200,
                calibration=calibration,
                source_calibration=calibration,
            ),
            "camera_left": LidarCameraExportCtx(
                role="camera_left",
                sensor_name="left",
                source_name="000001.jpg",
                width=200,
                height=200,
                calibration=None,
                source_calibration=None,
            ),
        },
    )

    coco = build_lidar_coco([frame], ["car"])

    assert len(coco["images"]) == 1
    assert coco["annotations"] == []
    assert coco["info"]["skipped_annotations"] == 1
    assert coco["info"]["skipped_cameras"] == 1


def test_nuscenes_records_use_scene_pose():
    ann = _ann(attributes={"visible": "v60-80"})
    scene_id = uuid.uuid4()
    tables = build_nuscenes_frame_records(
        [
            LidarFrameExportCtx(
                task_id=ann.task_id,
                frame_key="000001",
                annotations=[ann],
                cameras={},
                scene_id=scene_id,
                scene_name="scene-a",
                frame_index=0,
                timestamp_us=123,
                ego_translation=[10.0, 0.0, 0.0],
                ego_rotation=[1.0, 0.0, 0.0, 0.0],
            )
        ]
    )

    assert tables["sample_annotation"][0]["translation"] == [11.0, 2.0, 3.0]
    assert tables["sample_annotation"][0]["size"] == [2.0, 4.0, 1.5]
    assert tables["sample_annotation"][0]["visibility_token"] == "visibility-2"
    assert tables["ego_pose"][0]["rotation"] == [1.0, 0.0, 0.0, 0.0]
    assert tables["sample"][0]["timestamp"] == 123
    assert tables["scene"][0]["name"] == "scene-a"


def test_nuscenes_records_require_persisted_scene_metadata():
    ann = _ann()
    with pytest.raises(ValueError, match="metadata is incomplete"):
        build_nuscenes_frame_records(
            [
                LidarFrameExportCtx(
                    task_id=ann.task_id,
                    frame_key="000001",
                    annotations=[ann],
                )
            ]
        )


def test_nuscenes_instance_grouped_by_track_id():
    # v0.21.2 · ADR-0045 · 跨帧同一 track_id 的框归并为同一 nuScenes instance;
    # 无 track_id 的框各自成 instance (退化为按 annotation id)。
    task_a, task_b = uuid.uuid4(), uuid.uuid4()
    scene_id = uuid.uuid4()
    ann_f1 = _ann(task_id=task_a, track_id="trk_abc")
    ann_f2 = _ann(task_id=task_b, track_id="trk_abc")
    ann_solo = _ann(task_id=task_b)  # 无 track_id
    tables = build_nuscenes_frame_records(
        [
            LidarFrameExportCtx(
                task_id=task_a,
                frame_key="000001",
                annotations=[ann_f1],
                cameras={},
                scene_id=scene_id,
                scene_name="scene-a",
                frame_index=0,
                timestamp_us=1,
                ego_translation=[0.0, 0.0, 0.0],
                ego_rotation=[1.0, 0.0, 0.0, 0.0],
            ),
            LidarFrameExportCtx(
                task_id=task_b,
                frame_key="000002",
                annotations=[ann_f2, ann_solo],
                cameras={},
                scene_id=scene_id,
                scene_name="scene-a",
                frame_index=1,
                timestamp_us=2,
                ego_translation=[0.0, 0.0, 0.0],
                ego_rotation=[1.0, 0.0, 0.0, 0.0],
            ),
        ]
    )
    tokens = [r["instance_token"] for r in tables["sample_annotation"]]
    # 两帧同 track_id → 同一 instance_token; solo 框独立
    assert tokens[0] == tokens[1]
    assert tokens[2] != tokens[0]
    # instance 表去重: track 链 1 个 + solo 1 个 = 2 个 instance
    assert len(tables["instance"]) == 2


@pytest.mark.asyncio
async def test_lidar_export_zip_writes_standard_targets(
    db_session,
    httpx_client,
    super_admin,
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
    )
    db_session.add(ds)
    await db_session.flush()
    scene = Scene(
        display_id=f"SC-LX-{uuid.uuid4().hex[:6]}",
        dataset_id=ds.id,
        name="scene-a",
        source_format="test",
        created_by=user.id,
    )
    db_session.add(scene)
    await db_session.flush()
    lidar_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.pcd",
        file_path="scene-a/lidar/000001.pcd",
        file_type="point_cloud",
        metadata_={"point_count": 4},
        scene_id=scene.id,
        frame_index=0,
    )
    cam_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.jpg",
        file_path="scene-a/camera/front/000001.jpg",
        file_type="image",
        width=200,
        height=200,
        metadata_={"calibration": _calib()},
        scene_id=scene.id,
        frame_index=0,
    )
    cam_left_item = DatasetItem(
        dataset_id=ds.id,
        file_name="000001.jpg",
        file_path="scene-a/camera/left/000001.jpg",
        file_type="image",
        width=200,
        height=200,
        metadata_={"calibration": _calib()},
        scene_id=scene.id,
        frame_index=0,
    )
    db_session.add_all([lidar_item, cam_item, cam_left_item])
    db_session.add(
        SceneFramePose(
            scene_id=scene.id,
            frame_index=0,
            timestamp_us=123,
            ego_translation=[0.0, 0.0, 0.0],
            ego_rotation=[1.0, 0.0, 0.0, 0.0],
        )
    )
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
            (cam_left_item.id, "camera_left", "left"),
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
    annotation_count = await db_session.scalar(
        select(func.count(Annotation.id)).where(Annotation.project_id == project.id)
    )
    roles_response = await httpx_client.get(
        f"/api/v1/projects/{project.id}/lidar-camera-roles",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert roles_response.status_code == 200
    assert roles_response.json() == {
        "roles": [
            {
                "role": "camera_front",
                "frame_count": 1,
                "calibrated_frame_count": 1,
                "sized_frame_count": 1,
                "complete": True,
            },
            {
                "role": "camera_left",
                "frame_count": 1,
                "calibrated_frame_count": 1,
                "sized_frame_count": 1,
                "complete": True,
            },
        ],
        "default_role": None,
    }
    preflight_response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/mask-formats/exports:preflight",
        headers={"Authorization": f"Bearer {token}"},
        json={"targets": ["coco"]},
    )
    assert preflight_response.status_code == 200, preflight_response.text
    assert preflight_response.json()["loss_class"] == "lossless"
    with pytest.raises(
        UnsupportedExportError,
        match="requires one explicit complete camera role",
    ):
        await build_export_zip(
            db_session,
            project.id,
            batch_id=None,
            targets=["kitti"],
            include_attributes=True,
            video_frame_mode="keyframes",
        )

    zip_path, file_count, _size = await build_export_zip(
        db_session,
        project.id,
        batch_id=None,
        targets=["kitti", "coco", "nuscenes", "pointmask"],
        include_attributes=True,
        video_frame_mode="keyframes",
        format_options={"lidar_camera_role": "camera_front"},
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
            coco = json.loads(zf.read("coco/annotations.json"))
            assert len(coco["images"]) == 2
            assert coco["images"][0]["file_name"].startswith("camera_front/")
            assert len(coco["annotations"]) == 2
            assert coco["annotations"][0]["attributes"]["__camera_role"] == (
                "camera_front"
            )
            assert coco["info"]["skipped_annotations"] == 0
            manifest = json.loads(zf.read("kitti/images_manifest.json"))
            assert manifest["images"][0]["camera"] == "front"
            label = zf.read("kitti/label_2/lidar/000001.txt").decode()
            assert label.split()[1:3] == ["0.50", "1"]
            pointmask = zf.read("pointmask/segmentation/lidar/000001.label")
            assert struct.unpack("<4I", pointmask) == (1, 0, 1, 0)
            readme = zf.read("nuscenes/README.txt").decode()
            assert "real scene, sample, ego pose" in readme
        assert (
            await db_session.scalar(
                select(func.count(Annotation.id)).where(
                    Annotation.project_id == project.id
                )
            )
            == annotation_count
        )
    finally:
        os.unlink(zip_path)


def test_clean_export_targets_filters_lidar_targets():
    assert clean_export_targets(
        ["kitti", "coco", "pointmask", "kitti"], data_type="lidar"
    ) == ["kitti", "coco", "pointmask"]
