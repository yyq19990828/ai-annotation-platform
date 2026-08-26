from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem, Scene
from app.db.models.scene_track import SceneTrack
from app.db.models.task import Task
from app.schemas._jsonb_types import SensorCalibration
from app.schemas.multicamera_annotation import NormalizedCameraBbox
from app.services.multicamera_annotation import (
    MulticameraAnnotationError,
    camera_member_out,
    create_camera_member,
    delete_camera_member,
    list_camera_members,
    restore_camera_member,
    update_camera_member,
)
from app.services.scene_track_domain import bind_annotation_to_scene_track
from app.services.sensor_calibration import (
    calibration_digest,
    update_calibration,
)
from app.services.task_dataset_link import link_items
from tests.factory import create_project


def _calibration(*, cx: float = 100) -> SensorCalibration:
    return SensorCalibration.model_validate(
        {
            "extrinsic": [
                0,
                -1,
                0,
                0,
                0,
                0,
                -1,
                0,
                1,
                0,
                0,
                0,
                0,
                0,
                0,
                1,
            ],
            "intrinsic": [100, 0, cx, 0, 100, 60, 0, 0, 1],
        }
    )


async def _seed(db, owner_id: uuid.UUID):
    project = await create_project(db, owner_id=owner_id, type_key="lidar")
    project.data_type = "lidar"
    dataset = Dataset(
        display_id=f"DS-MM-{uuid.uuid4().hex[:8]}",
        name=f"multicamera-{uuid.uuid4().hex[:8]}",
        data_type="point_cloud",
        created_by=owner_id,
        metadata_={"axis_convention": "iso_8855"},
    )
    db.add(dataset)
    await db.flush()
    scene = Scene(
        display_id=f"SCN-MM-{uuid.uuid4().hex[:8]}",
        dataset_id=dataset.id,
        name=f"scene-{uuid.uuid4().hex[:8]}",
    )
    db.add(scene)
    await db.flush()
    lidar = DatasetItem(
        dataset_id=dataset.id,
        file_name="frame.pcd",
        file_path="mm/frame.pcd",
        file_type="point_cloud",
        scene_id=scene.id,
        frame_index=0,
    )
    camera = DatasetItem(
        dataset_id=dataset.id,
        file_name="front.jpg",
        file_path="mm/front.jpg",
        file_type="image",
        width=200,
        height=120,
        scene_id=scene.id,
        frame_index=0,
        metadata_={"calibration": _calibration().model_dump(mode="json")},
    )
    db.add_all([lidar, camera])
    await db.flush()
    task = Task(
        project_id=project.id,
        dataset_item_id=lidar.id,
        display_id=f"T-MM-{uuid.uuid4().hex[:8]}",
        file_name=lidar.file_name,
        file_path=lidar.file_path,
        file_type="point_cloud",
        status="in_progress",
    )
    db.add(task)
    await db.flush()
    await link_items(
        db,
        task.id,
        [
            (lidar.id, "primary_lidar", "LIDAR_TOP"),
            (camera.id, "camera_front", "CAM_FRONT"),
        ],
    )
    source = Annotation(
        task_id=task.id,
        project_id=project.id,
        user_id=owner_id,
        source="manual",
        annotation_type="box_3d",
        tool_unit_id="lidar_box_3d",
        class_name="car",
        geometry={
            "type": "box_3d",
            "center": [10, 0, 0],
            "size": [4, 2, 1.5],
            "rotation": [0, 0, 0],
            "convention_at_create": "iso_8855",
        },
        track_id=f"trk_{uuid.uuid4().hex}",
    )
    db.add(source)
    binding = await bind_annotation_to_scene_track(
        db,
        annotation=source,
        task=task,
        temporal_role="keyframe",
        interval_source="manual",
        actor_id=owner_id,
    )
    assert binding is not None
    await db.flush()
    return task, camera, source, binding.track


async def test_camera_member_lifecycle_and_calibration_staleness(
    db_session, super_admin
):
    user, _ = super_admin
    task, camera, source, track = await _seed(db_session, user.id)
    baseline = _calibration()
    baseline_digest = calibration_digest(baseline)

    member = await create_camera_member(
        db_session,
        task=task,
        actor_id=user.id,
        source_annotation_id=source.id,
        camera_role="camera_front",
        bbox=NormalizedCameraBbox(x=0.4, y=0.35, w=0.2, h=0.3),
        visibility="visible",
        expected_track_revision=track.revision,
        expected_calibration_revision=1,
        expected_calibration_digest=baseline_digest,
    )
    assert member.scene_track_id == source.scene_track_id
    assert member.track_id == source.track_id
    assert member.tool_unit_id == "lidar_box_3d"
    assert track.revision == 2
    current = await camera_member_out(db_session, task=task, member=member)
    assert current.relation_status == "current"
    assert current.residual is not None
    assert current.track_revision == 2
    listed, listed_revision, projected_bbox = await list_camera_members(
        db_session,
        task=task,
        scene_track_id=source.scene_track_id,
        include_inactive=False,
        projection_camera_role="camera_front",
    )
    assert [item.id for item in listed] == [member.id]
    assert listed_revision == 2
    assert projected_bbox is not None

    with pytest.raises(MulticameraAnnotationError) as duplicate:
        await create_camera_member(
            db_session,
            task=task,
            actor_id=user.id,
            source_annotation_id=source.id,
            camera_role="camera_front",
            bbox=NormalizedCameraBbox(x=0.3, y=0.3, w=0.2, h=0.2),
            visibility="visible",
            expected_track_revision=track.revision,
            expected_calibration_revision=1,
            expected_calibration_digest=baseline_digest,
        )
    assert duplicate.value.code == "camera_member_exists"

    changed = _calibration(cx=110)
    changed_state = await update_calibration(
        db_session,
        dataset_item_id=camera.id,
        calibration=changed,
        expected_revision=1,
        expected_digest=baseline_digest,
        actor_id=user.id,
    )
    assert changed_state.revision == 2
    stale = await camera_member_out(db_session, task=task, member=member)
    assert stale.relation_status == "stale"
    assert stale.bbox == current.bbox

    member = await update_camera_member(
        db_session,
        task=task,
        member_id=member.id,
        bbox=NormalizedCameraBbox(x=0.42, y=0.35, w=0.2, h=0.3),
        visibility="occluded",
        expected_version=member.version,
        expected_track_revision=track.revision,
        expected_calibration_revision=changed_state.revision,
        expected_calibration_digest=changed_state.digest,
    )
    assert member.version == 2
    assert member.sensor_visibility == "occluded"
    assert track.revision == 3
    assert (
        await camera_member_out(db_session, task=task, member=member)
    ).relation_status == "current"

    member = await delete_camera_member(
        db_session,
        task=task,
        member_id=member.id,
        expected_version=member.version,
        expected_track_revision=track.revision,
    )
    assert member.is_active is False
    assert track.revision == 4
    member = await restore_camera_member(
        db_session,
        task=task,
        member_id=member.id,
        expected_version=member.version,
        expected_track_revision=track.revision,
        expected_calibration_revision=changed_state.revision,
        expected_calibration_digest=changed_state.digest,
    )
    assert member.is_active is True
    assert track.revision == 5


async def test_camera_member_update_rejects_track_and_calibration_conflicts(
    db_session, super_admin
):
    user, _ = super_admin
    task, _camera, source, track = await _seed(db_session, user.id)
    digest = calibration_digest(_calibration())
    member = await create_camera_member(
        db_session,
        task=task,
        actor_id=user.id,
        source_annotation_id=source.id,
        camera_role="camera_front",
        bbox=NormalizedCameraBbox(x=0.4, y=0.35, w=0.2, h=0.3),
        visibility="visible",
        expected_track_revision=track.revision,
        expected_calibration_revision=1,
        expected_calibration_digest=digest,
    )

    with pytest.raises(MulticameraAnnotationError) as conflict:
        await update_camera_member(
            db_session,
            task=task,
            member_id=member.id,
            bbox=NormalizedCameraBbox(x=0.41, y=0.35, w=0.2, h=0.3),
            visibility=None,
            expected_version=member.version,
            expected_track_revision=track.revision - 1,
            expected_calibration_revision=1,
            expected_calibration_digest=digest,
        )
    assert conflict.value.code == "track_revision_conflict"

    current_track = await db_session.get(SceneTrack, track.id)
    assert current_track is not None
    with pytest.raises(MulticameraAnnotationError) as calibration_conflict:
        await update_camera_member(
            db_session,
            task=task,
            member_id=member.id,
            bbox=NormalizedCameraBbox(x=0.41, y=0.35, w=0.2, h=0.3),
            visibility=None,
            expected_version=member.version,
            expected_track_revision=current_track.revision,
            expected_calibration_revision=2,
            expected_calibration_digest=digest,
        )
    assert calibration_conflict.value.code == "calibration_revision_conflict"

    stored = await db_session.scalar(
        select(Annotation).where(Annotation.id == member.id)
    )
    assert stored is not None
    assert stored.version == 1


async def test_camera_member_http_create_and_list(
    db_session, httpx_client, super_admin
):
    user, token = super_admin
    task, _camera, source, track = await _seed(db_session, user.id)
    digest = calibration_digest(_calibration())
    headers = {"Authorization": f"Bearer {token}"}

    created = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/point-cloud/camera-members",
        headers=headers,
        json={
            "source_annotation_id": str(source.id),
            "camera_role": "camera_front",
            "bbox": {"x": 0.4, "y": 0.35, "w": 0.2, "h": 0.3},
            "visibility": "visible",
            "expected_track_revision": track.revision,
            "expected_calibration_revision": 1,
            "expected_calibration_digest": digest,
        },
    )
    assert created.status_code == 201, created.text
    member = created.json()
    assert member["camera_role"] == "camera_front"
    assert member["track_revision"] == 2

    listed = await httpx_client.get(
        f"/api/v1/tasks/{task.id}/point-cloud/camera-members",
        headers=headers,
        params={
            "scene_track_id": str(source.scene_track_id),
            "projection_camera_role": "camera_front",
        },
    )
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert [item["id"] for item in body["items"]] == [member["id"]]
    assert body["track_revision"] == 2
    assert body["projected_bbox"] is not None
