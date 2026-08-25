"""3D Scene 轨迹拆分 / 合并 API 合同。"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.api.v1.tasks.track_operations import _tasks_are_editable
from app.db.models.annotation import Annotation
from app.db.models.audit_log import AuditLog
from app.db.models.dataset import Dataset, DatasetItem, Scene
from app.db.models.task import Task
from app.services.scene_track_domain import bind_annotation_to_scene_track
from tests.factory import create_project


def _box3d(x: float = 0.0):
    return {
        "type": "box_3d",
        "center": [x, 2.0, 3.0],
        "size": [4.0, 5.0, 6.0],
        "rotation": [0.0, 0.0, 0.0],
        "convention_at_create": "iso_8855",
    }


async def _seed_scene(db, *, owner_id, frame_count=5):
    project = await create_project(db, owner_id=owner_id, type_key="lidar")
    project.data_type = "lidar"
    dataset = Dataset(
        display_id=f"DS-TRACK-{uuid.uuid4().hex[:6]}",
        name=f"track-ops-{uuid.uuid4().hex[:6]}",
        data_type="point_cloud",
        created_by=owner_id,
    )
    db.add(dataset)
    await db.flush()
    scene = Scene(
        display_id=f"SCN-TRACK-{uuid.uuid4().hex[:6]}",
        dataset_id=dataset.id,
        name=f"scene-{uuid.uuid4().hex[:6]}",
    )
    db.add(scene)
    await db.flush()
    tasks: dict[int, Task] = {}
    for frame_index in range(frame_count):
        item = DatasetItem(
            dataset_id=dataset.id,
            file_name=f"{frame_index:06d}.pcd",
            file_path=f"track-ops/{frame_index:06d}.pcd",
            file_type="point_cloud",
            scene_id=scene.id,
            frame_index=frame_index,
        )
        db.add(item)
        await db.flush()
        task = Task(
            project_id=project.id,
            dataset_item_id=item.id,
            display_id=f"T-TRACK-{uuid.uuid4().hex[:8]}",
            file_name=item.file_name,
            file_path=item.file_path,
            file_type="point_cloud",
            status="in_progress",
        )
        db.add(task)
        await db.flush()
        tasks[frame_index] = task
    return project, scene, tasks


async def _add_box(
    db,
    *,
    task,
    project,
    user_id,
    track_id,
    class_name="car",
    locked=False,
    x=0.0,
    bind=True,
):
    row = Annotation(
        task_id=task.id,
        project_id=project.id,
        user_id=user_id,
        source="manual",
        annotation_type="box_3d",
        tool_unit_id="lidar_box_3d",
        class_name=class_name,
        geometry=_box3d(x),
        track_id=track_id,
        is_locked=locked,
    )
    db.add(row)
    await db.flush()
    if bind:
        await bind_annotation_to_scene_track(
            db,
            annotation=row,
            task=task,
            temporal_role="keyframe",
            interval_source="manual",
            actor_id=user_id,
        )
        await db.flush()
    return row


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_task_editability_rejects_missing_required_task_with_unrelated_rows():
    present_id = uuid.uuid4()
    missing_id = uuid.uuid4()
    unrelated_id = uuid.uuid4()

    assert not _tasks_are_editable(
        {present_id: object(), unrelated_id: object()},
        task_ids={present_id, missing_id},
        current_user=object(),
    )


async def _preview(httpx_client, *, task_id, token, body):
    return await httpx_client.post(
        f"/api/v1/tasks/{task_id}/track-operations/preview",
        json=body,
        headers=_headers(token),
    )


async def test_split_preview_and_execute_rewrites_tail_atomically(
    db_session, httpx_client, super_admin
):
    user, token = super_admin
    project, scene, tasks = await _seed_scene(db_session, owner_id=user.id)
    rows = [
        await _add_box(
            db_session,
            task=tasks[frame],
            project=project,
            user_id=user.id,
            track_id="trk-primary",
            x=float(frame),
        )
        for frame in (0, 1, 2, 3)
    ]
    original_geometry = [dict(row.geometry) for row in rows]
    body = {
        "operation": "split",
        "primary_track_id": "trk-primary",
        "split_after_frame": 1,
    }

    preview = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body=body,
    )
    assert preview.status_code == 200, preview.text
    preview_json = preview.json()
    assert preview_json["scene_id"] == str(scene.id)
    assert preview_json["primary"]["member_count"] == 4
    assert preview_json["affected_member_count"] == 4
    assert preview_json["rewritten_member_count"] == 2
    assert len(preview_json["snapshot_token"]) == 64

    execute = await httpx_client.post(
        f"/api/v1/tasks/{tasks[1].id}/track-operations",
        json={**body, "snapshot_token": preview_json["snapshot_token"]},
        headers=_headers(token),
    )
    assert execute.status_code == 200, execute.text
    result = execute.json()
    assert result["updated_member_count"] == 4
    assert result["created_track_id"].startswith("trk_")
    assert result["created_track_id"] != "trk-primary"

    for index, row in enumerate(rows):
        await db_session.refresh(row)
        assert row.track_id == (
            "trk-primary" if index <= 1 else result["created_track_id"]
        )
        assert row.version == 2
        assert row.geometry == original_geometry[index]

    audit = (
        (
            await db_session.execute(
                select(AuditLog)
                .where(AuditLog.action == "annotation.update")
                .where(AuditLog.target_id == str(scene.id))
                .order_by(AuditLog.id.desc())
            )
        )
        .scalars()
        .first()
    )
    assert audit is not None
    assert audit.detail_json["operation"] == "point_cloud_track.split"
    assert audit.detail_json["updated_member_count"] == 4


async def test_merge_keeps_explicit_survivor_and_never_changes_geometry(
    db_session, httpx_client, super_admin
):
    user, token = super_admin
    project, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    primary = [
        await _add_box(
            db_session,
            task=tasks[frame],
            project=project,
            user_id=user.id,
            track_id="trk-survivor",
            x=float(frame),
        )
        for frame in (0, 1)
    ]
    secondary = [
        await _add_box(
            db_session,
            task=tasks[frame],
            project=project,
            user_id=user.id,
            track_id="trk-removed",
            x=float(frame),
        )
        for frame in (2, 3)
    ]
    geometry_before = {row.id: dict(row.geometry) for row in [*primary, *secondary]}
    body = {
        "operation": "merge",
        "primary_track_id": "trk-survivor",
        "secondary_track_id": "trk-removed",
    }
    preview = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body=body,
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["survivor_track_id"] == "trk-survivor"
    assert preview.json()["rewritten_member_count"] == 2

    execute = await httpx_client.post(
        f"/api/v1/tasks/{tasks[1].id}/track-operations",
        json={**body, "snapshot_token": preview.json()["snapshot_token"]},
        headers=_headers(token),
    )
    assert execute.status_code == 200, execute.text
    assert execute.json()["created_track_id"] is None
    for row in [*primary, *secondary]:
        await db_session.refresh(row)
        assert row.track_id == "trk-survivor"
        assert row.version == 2
        assert row.geometry == geometry_before[row.id]


async def test_merge_candidates_filter_conflicts_classes_and_locked_members(
    db_session, httpx_client, super_admin
):
    user, token = super_admin
    project, _, tasks = await _seed_scene(db_session, owner_id=user.id, frame_count=6)
    await _add_box(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        track_id="trk-primary",
    )
    for frame in (2, 3):
        await _add_box(
            db_session,
            task=tasks[frame],
            project=project,
            user_id=user.id,
            track_id="trk-valid",
        )
    await _add_box(
        db_session,
        task=tasks[0],
        project=project,
        user_id=user.id,
        track_id="trk-overlap",
    )
    await _add_box(
        db_session,
        task=tasks[4],
        project=project,
        user_id=user.id,
        track_id="trk-other-class",
        class_name="pedestrian",
    )
    await _add_box(
        db_session,
        task=tasks[5],
        project=project,
        user_id=user.id,
        track_id="trk-locked",
        locked=True,
    )

    response = await httpx_client.get(
        f"/api/v1/tasks/{tasks[0].id}/track-operations/candidates",
        params={"track_id": "trk-primary"},
        headers=_headers(token),
    )
    assert response.status_code == 200, response.text
    assert [item["track_id"] for item in response.json()["candidates"]] == ["trk-valid"]


async def test_merge_rejects_overlap_and_split_requires_a_tail(
    db_session, httpx_client, super_admin
):
    user, token = super_admin
    project, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    await _add_box(
        db_session,
        task=tasks[1],
        project=project,
        user_id=user.id,
        track_id="trk-primary",
    )
    await _add_box(
        db_session,
        task=tasks[1],
        project=project,
        user_id=user.id,
        track_id="trk-overlap",
    )

    merge = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body={
            "operation": "merge",
            "primary_track_id": "trk-primary",
            "secondary_track_id": "trk-overlap",
        },
    )
    assert merge.status_code == 409
    assert merge.json()["detail"]["reason"] == "track_frame_conflict"

    split = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body={
            "operation": "split",
            "primary_track_id": "trk-primary",
            "split_after_frame": 1,
        },
    )
    assert split.status_code == 409
    assert split.json()["detail"]["reason"] == "split_tail_missing"


async def test_execute_rejects_stale_preview_without_track_writes(
    db_session, httpx_client, super_admin
):
    user, token = super_admin
    project, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    rows = [
        await _add_box(
            db_session,
            task=tasks[frame],
            project=project,
            user_id=user.id,
            track_id="trk-stale",
        )
        for frame in (0, 1, 2)
    ]
    body = {
        "operation": "split",
        "primary_track_id": "trk-stale",
        "split_after_frame": 1,
    }
    preview = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body=body,
    )
    assert preview.status_code == 200
    rows[2].version += 1
    await db_session.commit()

    execute = await httpx_client.post(
        f"/api/v1/tasks/{tasks[1].id}/track-operations",
        json={**body, "snapshot_token": preview.json()["snapshot_token"]},
        headers=_headers(token),
    )
    assert execute.status_code == 409
    assert execute.json()["detail"]["reason"] == "track_snapshot_stale"
    for row in rows:
        await db_session.refresh(row)
        assert row.track_id == "trk-stale"


async def test_locked_member_and_bounded_transaction_are_rejected(
    db_session, httpx_client, super_admin, monkeypatch
):
    user, token = super_admin
    project, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    for frame in (0, 1, 2):
        await _add_box(
            db_session,
            task=tasks[frame],
            project=project,
            user_id=user.id,
            track_id="trk-bounded",
            locked=frame == 2,
        )
    body = {
        "operation": "split",
        "primary_track_id": "trk-bounded",
        "split_after_frame": 1,
    }
    locked = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body=body,
    )
    assert locked.status_code == 409
    assert locked.json()["detail"]["reason"] == "annotation_locked"

    rows = list(
        (
            await db_session.execute(
                select(Annotation).where(Annotation.track_id == "trk-bounded")
            )
        ).scalars()
    )
    for row in rows:
        row.is_locked = False
    await db_session.commit()
    monkeypatch.setattr("app.services.track_operation.MAX_TRACK_MEMBERS", 2)
    bounded = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body=body,
    )
    assert bounded.status_code == 422
    assert bounded.json()["detail"]["reason"] == "track_member_limit_exceeded"


async def test_member_task_must_remain_editable(db_session, httpx_client, super_admin):
    user, token = super_admin
    project, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    for frame in (0, 1, 2):
        await _add_box(
            db_session,
            task=tasks[frame],
            project=project,
            user_id=user.id,
            track_id="trk-permissions",
        )
    tasks[2].status = "completed"
    await db_session.commit()

    response = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body={
            "operation": "split",
            "primary_track_id": "trk-permissions",
            "split_after_frame": 1,
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["reason"] == "track_member_unavailable"


async def test_track_integrity_rejects_duplicate_frames_and_class_drift(
    db_session, httpx_client, super_admin
):
    user, token = super_admin
    project, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    await _add_box(
        db_session,
        task=tasks[1],
        project=project,
        user_id=user.id,
        track_id="trk-duplicate",
    )
    await _add_box(
        db_session,
        task=tasks[1],
        project=project,
        user_id=user.id,
        track_id="trk-duplicate",
    )
    await _add_box(
        db_session,
        task=tasks[2],
        project=project,
        user_id=user.id,
        track_id="trk-duplicate",
    )
    duplicate = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body={
            "operation": "split",
            "primary_track_id": "trk-duplicate",
            "split_after_frame": 1,
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["reason"] == "track_duplicate_frame"

    await _add_box(
        db_session,
        task=tasks[1],
        project=project,
        user_id=user.id,
        track_id="trk-drift",
        class_name="car",
        bind=False,
    )
    await _add_box(
        db_session,
        task=tasks[2],
        project=project,
        user_id=user.id,
        track_id="trk-drift",
        class_name="pedestrian",
        bind=False,
    )
    drift = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body={
            "operation": "split",
            "primary_track_id": "trk-drift",
            "split_after_frame": 1,
        },
    )
    assert drift.status_code == 409
    assert drift.json()["detail"]["reason"] == "track_class_drift"


async def test_new_member_after_preview_invalidates_the_snapshot(
    db_session, httpx_client, super_admin
):
    user, token = super_admin
    project, _, tasks = await _seed_scene(db_session, owner_id=user.id)
    for frame in (0, 1, 2):
        await _add_box(
            db_session,
            task=tasks[frame],
            project=project,
            user_id=user.id,
            track_id="trk-membership",
        )
    body = {
        "operation": "split",
        "primary_track_id": "trk-membership",
        "split_after_frame": 1,
    }
    preview = await _preview(
        httpx_client,
        task_id=tasks[1].id,
        token=token,
        body=body,
    )
    assert preview.status_code == 200
    added = await _add_box(
        db_session,
        task=tasks[3],
        project=project,
        user_id=user.id,
        track_id="trk-membership",
    )
    await db_session.commit()

    execute = await httpx_client.post(
        f"/api/v1/tasks/{tasks[1].id}/track-operations",
        json={**body, "snapshot_token": preview.json()["snapshot_token"]},
        headers=_headers(token),
    )
    assert execute.status_code == 409
    assert execute.json()["detail"]["reason"] == "track_snapshot_stale"
    await db_session.refresh(added)
    assert added.track_id == "trk-membership"
