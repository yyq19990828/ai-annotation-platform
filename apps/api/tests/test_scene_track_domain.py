from __future__ import annotations

import random
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem, Scene
from app.db.models.scene_track import SceneTrack, SceneTrackInterval
from app.db.models.task import Task
from app.services.scene_track_domain import (
    SceneTrackIntegrityError,
    bind_annotation_to_scene_track,
    diagnose_scene_tracks,
    ensure_scene_track,
    temporal_role_for_write,
)
from app.services.scene_track_command import IntervalSpec, _normalize, _subtract
from tests.factory import create_project


def _box3d(x: float = 0.0) -> dict:
    return {
        "type": "box_3d",
        "center": [x, 2.0, 3.0],
        "size": [4.0, 5.0, 6.0],
        "rotation": [0.0, 0.0, 0.0],
        "convention_at_create": "iso_8855",
    }


async def _seed_scene(db, *, owner_id: uuid.UUID, frame_count: int = 4):
    project = await create_project(db, owner_id=owner_id, type_key="lidar")
    project.data_type = "lidar"
    dataset = Dataset(
        display_id=f"DS-DOMAIN-{uuid.uuid4().hex[:8]}",
        name=f"scene-track-domain-{uuid.uuid4().hex[:8]}",
        data_type="point_cloud",
        created_by=owner_id,
    )
    db.add(dataset)
    await db.flush()
    scene = Scene(
        display_id=f"SCN-DOMAIN-{uuid.uuid4().hex[:8]}",
        dataset_id=dataset.id,
        name=f"scene-{uuid.uuid4().hex[:8]}",
    )
    db.add(scene)
    await db.flush()
    tasks: dict[int, Task] = {}
    for frame_index in range(frame_count):
        item = DatasetItem(
            dataset_id=dataset.id,
            file_name=f"{frame_index:06d}.pcd",
            file_path=f"domain/{frame_index:06d}.pcd",
            file_type="point_cloud",
            scene_id=scene.id,
            frame_index=frame_index,
        )
        db.add(item)
        await db.flush()
        task = Task(
            project_id=project.id,
            dataset_item_id=item.id,
            display_id=f"T-DOMAIN-{uuid.uuid4().hex[:8]}",
            file_name=item.file_name,
            file_path=item.file_path,
            file_type="point_cloud",
            status="in_progress",
        )
        db.add(task)
        await db.flush()
        tasks[frame_index] = task
    return project, scene, tasks


def _annotation(*, task: Task, project_id: uuid.UUID, user_id: uuid.UUID, x=0.0):
    return Annotation(
        task_id=task.id,
        project_id=project_id,
        user_id=user_id,
        source="manual",
        annotation_type="box_3d",
        tool_unit_id="lidar_box_3d",
        class_name="car",
        geometry=_box3d(x),
        track_id="trk-domain",
    )


def test_temporal_role_is_independent_from_origin():
    assert temporal_role_for_write(source="manual", user_confirmed=True) == "keyframe"
    assert (
        temporal_role_for_write(source="prediction_based", user_confirmed=True)
        == "keyframe"
    )
    assert (
        temporal_role_for_write(source="interpolated", user_confirmed=False)
        == "derived"
    )
    assert temporal_role_for_write(source="imported", user_confirmed=False) == "sample"


def test_random_lifecycle_interval_sequences_keep_canonical_form():
    rng = random.Random(24011)
    state = (IntervalSpec(0, 39),)
    history: list[tuple[IntervalSpec, ...]] = []

    def assert_canonical(specs: tuple[IntervalSpec, ...]) -> None:
        for index, spec in enumerate(specs):
            assert spec.start_frame >= 0
            assert spec.end_frame is None or spec.end_frame >= spec.start_frame
            if index:
                previous = specs[index - 1]
                assert previous.end_frame is not None
                assert previous.end_frame + 1 < spec.start_frame

    for _ in range(300):
        action = rng.choice(
            ["mark_absent", "resume", "terminate", "split", "merge", "revert"]
        )
        if action == "revert":
            if history:
                state = history.pop()
        else:
            history.append(state)
        if action == "mark_absent":
            start = rng.randrange(0, 40)
            end = rng.randrange(start, 40)
            state = _subtract(state, start, end)
        elif action == "resume":
            start = rng.randrange(0, 40)
            end = rng.randrange(start, 40)
            state = _normalize([*state, IntervalSpec(start, end)])
        elif action == "terminate":
            state = _subtract(state, rng.randrange(0, 40) + 1, None)
        elif action == "split":
            split_after = rng.randrange(0, 39)
            head = _subtract(state, split_after + 1, None)
            tail = tuple(
                IntervalSpec(
                    max(spec.start_frame, split_after + 1),
                    spec.end_frame,
                    spec.source,
                )
                for spec in state
                if spec.end_frame is None or spec.end_frame > split_after
            )
            assert_canonical(head)
            assert_canonical(_normalize(list(tail)))
            state = head
        elif action == "merge":
            start = rng.randrange(0, 40)
            state = _normalize([*state, IntervalSpec(start, rng.randrange(start, 40))])
        assert_canonical(state)


async def test_bind_member_creates_track_and_normalizes_adjacent_intervals(
    db_session, super_admin
):
    user, _ = super_admin
    project, scene, tasks = await _seed_scene(db_session, owner_id=user.id)
    first = _annotation(task=tasks[0], project_id=project.id, user_id=user.id, x=0.0)
    third = _annotation(task=tasks[2], project_id=project.id, user_id=user.id, x=2.0)
    second = _annotation(task=tasks[1], project_id=project.id, user_id=user.id, x=1.0)
    db_session.add_all([first, third, second])

    for annotation, frame in ((first, 0), (third, 2), (second, 1)):
        binding = await bind_annotation_to_scene_track(
            db_session,
            annotation=annotation,
            task=tasks[frame],
            temporal_role="keyframe" if frame != 1 else "derived",
            interval_source="manual" if frame != 1 else "derived",
            actor_id=user.id,
        )
        assert binding is not None
        assert binding.scene_id == scene.id
        assert binding.frame_index == frame

    await db_session.flush()
    track = (
        await db_session.execute(
            select(SceneTrack).where(SceneTrack.track_id == "trk-domain")
        )
    ).scalar_one()
    intervals = list(
        (
            await db_session.execute(
                select(SceneTrackInterval).where(
                    SceneTrackInterval.scene_track_id == track.id
                )
            )
        ).scalars()
    )
    assert [(row.start_frame, row.end_frame) for row in intervals] == [(0, 2)]
    assert track.revision == 3
    assert {row.scene_track_id for row in (first, second, third)} == {track.id}
    assert first.temporal_role == "keyframe"
    assert second.temporal_role == "derived"


async def test_interval_exclusion_constraint_rejects_overlap(db_session, super_admin):
    user, _ = super_admin
    project, scene, _ = await _seed_scene(db_session, owner_id=user.id)
    track = await ensure_scene_track(
        db_session,
        project_id=project.id,
        scene_id=scene.id,
        track_id="trk-overlap-db",
        class_name="car",
        frames={0},
        actor_id=user.id,
        interval_source="manual",
    )
    async with db_session.begin_nested():
        db_session.add(
            SceneTrackInterval(
                scene_track_id=track.id,
                start_frame=0,
                end_frame=1,
                source="manual",
            )
        )
        with pytest.raises(IntegrityError):
            await db_session.flush()


async def test_explicit_presence_rejects_silent_extension(db_session, super_admin):
    user, _ = super_admin
    project, scene, _ = await _seed_scene(db_session, owner_id=user.id)
    track = await ensure_scene_track(
        db_session,
        project_id=project.id,
        scene_id=scene.id,
        track_id="trk-explicit-boundary",
        class_name="car",
        frames={0},
        actor_id=user.id,
        interval_source="manual",
    )
    track.presence_mode = "explicit"
    await db_session.flush()

    with pytest.raises(SceneTrackIntegrityError) as captured:
        await ensure_scene_track(
            db_session,
            project_id=project.id,
            scene_id=scene.id,
            track_id=track.track_id,
            class_name="car",
            frames={2},
            actor_id=user.id,
            interval_source="derived",
        )

    assert captured.value.code == "track_frame_absent"


async def test_diagnostics_reports_unlinked_legacy_member(db_session, super_admin):
    user, _ = super_admin
    project, scene, tasks = await _seed_scene(db_session, owner_id=user.id)
    annotation = _annotation(
        task=tasks[1], project_id=project.id, user_id=user.id, x=1.0
    )
    db_session.add(annotation)
    await db_session.flush()

    report = await diagnose_scene_tracks(
        db_session,
        project_id=project.id,
        scene_id=scene.id,
    )

    assert report.track_count == 0
    assert report.linked_member_count == 0
    assert report.issue_counts == {"member_unlinked": 1}
    assert report.issues[0].annotation_id == annotation.id
    assert report.issues[0].frame_index == 1
