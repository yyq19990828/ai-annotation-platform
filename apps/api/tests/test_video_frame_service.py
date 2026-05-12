import uuid

from app.db.models.dataset import (
    Dataset,
    DatasetItem,
    VideoChunk,
    VideoFrameCache,
    VideoFrameIndex,
    VideoSegment,
)
from app.db.models.annotation import Annotation
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.video_tracker_job import VideoTrackerJob
from app.cli.video.rebuild_timetable import rebuild_item_timetable


async def _make_video_task(db_session, owner_id):
    project = Project(
        display_id=f"P-VFS-{uuid.uuid4().hex[:6]}",
        name="Video Frame Service Project",
        type_key="video-track",
        type_label="视频 · 时序追踪",
        owner_id=owner_id,
        classes=["car"],
    )
    dataset = Dataset(
        display_id=f"D-VFS-{uuid.uuid4().hex[:6]}",
        name="videos",
        data_type="video",
        created_by=owner_id,
    )
    db_session.add_all([project, dataset])
    await db_session.flush()
    item = DatasetItem(
        dataset_id=dataset.id,
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        thumbnail_path="posters/clip.webp",
        metadata_={
            "video": {
                "duration_ms": 3000,
                "fps": 30,
                "frame_count": 90,
                "playback_path": "playback/clip.mp4",
                "playback_codec": "h264",
                "poster_frame_path": "posters/clip.webp",
            }
        },
    )
    db_session.add(item)
    await db_session.flush()
    task = Task(
        project_id=project.id,
        dataset_item_id=item.id,
        display_id=f"T-VFS-{uuid.uuid4().hex[:6]}",
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()
    return task, item


async def test_video_manifest_v2_exposes_service_urls(
    db_session, httpx_client_bound, super_admin, monkeypatch
):
    user, token = super_admin
    task, item = await _make_video_task(db_session, user.id)
    monkeypatch.setattr(
        "app.services.video_segment_service.settings.video_segment_size_frames",
        30,
    )

    monkeypatch.setattr(
        "app.services.video_frame_service.storage_service.generate_download_url",
        lambda key, expires_in=3600, bucket=None: f"http://storage.local/{key}",
    )

    task_resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/manifest-v2",
        headers={"Authorization": f"Bearer {token}"},
    )
    video_resp = await httpx_client_bound.get(
        f"/api/v1/videos/{item.id}/manifest",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert task_resp.status_code == 200
    assert video_resp.status_code == 200
    body = task_resp.json()
    assert body["task_id"] == str(task.id)
    assert body["dataset_item_id"] == str(item.id)
    assert body["video_url"] == "http://storage.local/playback/clip.mp4"
    assert body["poster_url"] == "http://storage.local/posters/clip.webp"
    assert body["chunks_manifest_url"].endswith(f"/api/v1/tasks/{task.id}/video/chunks")
    assert body["frame_service_base"].endswith(f"/api/v1/tasks/{task.id}/video/frames")
    assert [(s["segment_index"], s["start_frame"], s["end_frame"]) for s in body["segments"]] == [
        (0, 0, 29),
        (1, 30, 59),
        (2, 60, 89),
    ]
    assert video_resp.json()["dataset_item_id"] == str(item.id)


async def test_video_segments_facade_lists_lazy_segments(
    db_session, httpx_client_bound, super_admin, monkeypatch
):
    user, token = super_admin
    task, item = await _make_video_task(db_session, user.id)
    monkeypatch.setattr(
        "app.services.video_segment_service.settings.video_segment_size_frames",
        45,
    )

    resp = await httpx_client_bound.get(
        f"/api/v1/videos/{item.id}/segments",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["task_id"] == str(task.id)
    assert body["dataset_item_id"] == str(item.id)
    assert body["segment_size_frames"] == 45
    assert [(s["start_frame"], s["end_frame"]) for s in body["segments"]] == [
        (0, 44),
        (45, 89),
    ]


async def test_video_segment_claim_heartbeat_release(
    db_session, httpx_client_bound, super_admin, monkeypatch
):
    user, token = super_admin
    task, _ = await _make_video_task(db_session, user.id)
    monkeypatch.setattr(
        "app.services.video_segment_service.settings.video_segment_lock_ttl_seconds",
        300,
    )

    segments_resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/segments",
        headers={"Authorization": f"Bearer {token}"},
    )
    segment_id = segments_resp.json()["segments"][0]["id"]

    claim_resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/video/segments/{segment_id}:claim",
        headers={"Authorization": f"Bearer {token}"},
    )
    heartbeat_resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/video/segments/{segment_id}:heartbeat",
        headers={"Authorization": f"Bearer {token}"},
    )
    release_resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/video/segments/{segment_id}:release",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert claim_resp.status_code == 200
    assert claim_resp.json()["status"] == "locked"
    assert claim_resp.json()["assignee_id"] == str(user.id)
    assert claim_resp.json()["locked_by"] == str(user.id)
    assert heartbeat_resp.status_code == 200
    assert heartbeat_resp.json()["status"] == "locked"
    assert release_resp.status_code == 200
    assert release_resp.json()["status"] == "assigned"
    assert release_resp.json()["locked_by"] is None


async def test_video_segment_non_assignee_cannot_claim_assigned_segment(
    db_session, httpx_client_bound, annotator, reviewer
):
    assigned_user, _ = annotator
    review_user, review_token = reviewer
    task, item = await _make_video_task(db_session, assigned_user.id)
    batch = TaskBatch(
        project_id=task.project_id,
        dataset_id=item.dataset_id,
        display_id=f"B-VFS-{uuid.uuid4().hex[:6]}",
        name="Video batch",
        status="active",
        annotator_id=assigned_user.id,
        assigned_user_ids=[str(assigned_user.id), str(review_user.id)],
    )
    db_session.add_all(
        [
            ProjectMember(
                project_id=task.project_id,
                user_id=assigned_user.id,
                role="annotator",
                assigned_by=assigned_user.id,
            ),
            ProjectMember(
                project_id=task.project_id,
                user_id=review_user.id,
                role="reviewer",
                assigned_by=assigned_user.id,
            ),
            batch,
        ]
    )
    await db_session.flush()
    task.batch_id = batch.id
    segment = VideoSegment(
        dataset_item_id=item.id,
        segment_index=0,
        start_frame=0,
        end_frame=89,
        assignee_id=assigned_user.id,
        status="assigned",
    )
    db_session.add(segment)
    await db_session.flush()

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/video/segments/{segment.id}:claim",
        headers={"Authorization": f"Bearer {review_token}"},
    )

    assert resp.status_code == 403


async def test_video_chunks_create_pending_rows_and_enqueue(
    db_session, httpx_client_bound, super_admin, monkeypatch
):
    user, token = super_admin
    task, item = await _make_video_task(db_session, user.id)
    queued: list[tuple[str, list[int]]] = []

    monkeypatch.setattr(
        "app.services.video_frame_service.storage_service.generate_download_url",
        lambda key, expires_in=3600, bucket=None: f"http://storage.local/{key}",
    )
    monkeypatch.setattr(
        "app.workers.media.ensure_video_chunks.delay",
        lambda item_id, chunk_ids: queued.append((item_id, chunk_ids)),
    )

    resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/chunks?from_frame=0&to_frame=65",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["fallback_video_url"] == "http://storage.local/playback/clip.mp4"
    assert [chunk["chunk_id"] for chunk in body["chunks"]] == [0, 1]
    assert {chunk["status"] for chunk in body["chunks"]} == {"pending"}
    assert queued == [(str(item.id), [0, 1])]

    rows = (
        await db_session.execute(
            VideoChunk.__table__.select().where(VideoChunk.dataset_item_id == item.id)
        )
    ).all()
    assert len(rows) == 2


async def test_video_frame_ready_returns_cached_url_without_enqueue(
    db_session, httpx_client_bound, super_admin, monkeypatch
):
    user, token = super_admin
    task, item = await _make_video_task(db_session, user.id)
    queued: list[object] = []
    db_session.add(
        VideoFrameCache(
            dataset_item_id=item.id,
            frame_index=12,
            width=512,
            format="webp",
            storage_key=f"videos/{item.id}/frames/12_512.webp",
            byte_size=1234,
            status="ready",
        )
    )
    await db_session.flush()

    monkeypatch.setattr(
        "app.services.video_frame_service.storage_service.generate_download_url",
        lambda key, expires_in=3600, bucket=None: f"http://storage.local/{key}",
    )
    monkeypatch.setattr(
        "app.workers.media.extract_video_frames.delay",
        lambda *args: queued.append(args),
    )

    resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/frames/12?format=webp&w=512",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["url"].endswith(f"/videos/{item.id}/frames/12_512.webp")
    assert queued == []


async def test_video_frame_prefetch_creates_missing_rows(
    db_session, httpx_client_bound, super_admin, monkeypatch
):
    user, token = super_admin
    task, item = await _make_video_task(db_session, user.id)
    queued: list[tuple[str, list[dict]]] = []

    monkeypatch.setattr(
        "app.workers.media.extract_video_frames.delay",
        lambda item_id, requests: queued.append((item_id, requests)),
    )

    resp = await httpx_client_bound.post(
        f"/api/v1/videos/{item.id}/frames:prefetch",
        headers={"Authorization": f"Bearer {token}"},
        json={"frame_indices": [3, 3, 4], "width": 320, "format": "jpeg"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert [frame["frame_index"] for frame in body["frames"]] == [3, 4]
    assert {frame["status"] for frame in body["frames"]} == {"pending"}
    assert queued == [
        (
            str(item.id),
            [
                {"frame_index": 3, "width": 320, "format": "jpeg"},
                {"frame_index": 4, "width": 320, "format": "jpeg"},
            ],
        )
    ]


async def test_video_frame_retry_resets_failed_rows_only(
    db_session, httpx_client_bound, super_admin, monkeypatch
):
    user, token = super_admin
    task, item = await _make_video_task(db_session, user.id)
    queued: list[tuple[str, list[dict]]] = []
    db_session.add_all(
        [
            VideoFrameCache(
                dataset_item_id=item.id,
                frame_index=7,
                width=512,
                format="webp",
                status="failed",
                error="ffmpeg failed",
            ),
            VideoFrameCache(
                dataset_item_id=item.id,
                frame_index=8,
                width=512,
                format="webp",
                status="ready",
                storage_key=f"videos/{item.id}/frames/8_512.webp",
            ),
        ]
    )
    await db_session.flush()

    monkeypatch.setattr(
        "app.workers.media.extract_video_frames.delay",
        lambda item_id, requests: queued.append((item_id, requests)),
    )

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/video/frames:retry",
        headers={"Authorization": f"Bearer {token}"},
        json={"frame_indices": [7, 8], "width": 512, "format": "webp"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert [frame["frame_index"] for frame in body["frames"]] == [7]
    assert body["frames"][0]["status"] == "pending"
    assert queued == [
        (
            str(item.id),
            [{"frame_index": 7, "width": 512, "format": "webp"}],
        )
    ]


async def test_rebuild_timetable_cli_helper_replaces_rows(
    db_session, super_admin, monkeypatch
):
    user, _ = super_admin
    _, item = await _make_video_task(db_session, user.id)
    db_session.add(
        VideoFrameIndex(
            dataset_item_id=item.id,
            frame_index=0,
            pts_ms=999,
            is_keyframe=False,
        )
    )
    await db_session.flush()

    class FakeClient:
        def download_fileobj(self, Bucket, Key, Fileobj):
            assert Key == "playback/clip.mp4"
            Fileobj.write(b"fake video")

    class FakeStorage:
        datasets_bucket = "datasets"
        client = FakeClient()

    monkeypatch.setattr(
        "app.cli.video.rebuild_timetable.probe_video_frame_timetable",
        lambda path: [
            {
                "frame_index": 0,
                "pts_ms": 0,
                "is_keyframe": True,
                "pict_type": "I",
                "byte_offset": 10,
            },
            {
                "frame_index": 1,
                "pts_ms": 33,
                "is_keyframe": False,
                "pict_type": "P",
                "byte_offset": 20,
            },
        ],
    )

    count = await rebuild_item_timetable(db_session, item, storage=FakeStorage())

    rows = (
        await db_session.execute(
            VideoFrameIndex.__table__
            .select()
            .where(VideoFrameIndex.dataset_item_id == item.id)
            .order_by(VideoFrameIndex.frame_index.asc())
        )
    ).all()
    await db_session.refresh(item)

    assert count == 2
    assert [row.pts_ms for row in rows] == [0, 33]
    assert item.metadata_["video"]["frame_timetable_frame_count"] == 2


async def test_video_tracker_job_create_get_cancel(
    db_session, httpx_client_bound, project_admin, annotator, monkeypatch
):
    owner, _ = project_admin
    user, token = annotator
    task, item = await _make_video_task(db_session, owner.id)
    monkeypatch.setattr(
        "app.services.video_segment_service.settings.video_segment_size_frames",
        45,
    )
    batch = TaskBatch(
        project_id=task.project_id,
        dataset_id=item.dataset_id,
        display_id=f"B-VTJ-{uuid.uuid4().hex[:6]}",
        name="Video tracker batch",
        status="active",
        annotator_id=user.id,
        assigned_user_ids=[str(user.id)],
    )
    db_session.add_all(
        [
            ProjectMember(
                project_id=task.project_id,
                user_id=user.id,
                role="annotator",
                assigned_by=owner.id,
            ),
            batch,
        ]
    )
    await db_session.flush()
    task.batch_id = batch.id
    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 1, "y": 2, "width": 10, "height": 12},
    )
    db_session.add(annotation)
    await db_session.flush()

    segments_resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/segments",
        headers={"Authorization": f"Bearer {token}"},
    )
    segment_id = segments_resp.json()["segments"][0]["id"]
    await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/video/segments/{segment_id}:claim",
        headers={"Authorization": f"Bearer {token}"},
    )

    create_resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/video/tracks/{annotation.id}:propagate",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "from_frame": 0,
            "to_frame": 12,
            "model_key": "mock_bbox",
            "direction": "forward",
            "segment_id": segment_id,
            "prompt": {"type": "bbox", "geometry": annotation.geometry},
        },
    )

    assert create_resp.status_code == 202
    body = create_resp.json()
    assert body["status"] == "queued"
    assert body["task_id"] == str(task.id)
    assert body["annotation_id"] == str(annotation.id)
    assert body["event_channel"] == f"video-tracker-job:{body['id']}"

    get_resp = await httpx_client_bound.get(
        f"/api/v1/video-tracker-jobs/{body['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == body["id"]

    cancel_resp = await httpx_client_bound.delete(
        f"/api/v1/video-tracker-jobs/{body['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    repeat_cancel_resp = await httpx_client_bound.delete(
        f"/api/v1/video-tracker-jobs/{body['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "cancelled"
    assert cancel_resp.json()["cancel_requested_at"] is not None
    assert repeat_cancel_resp.status_code == 200
    assert repeat_cancel_resp.json()["status"] == "cancelled"
    row = await db_session.get(VideoTrackerJob, uuid.UUID(body["id"]))
    assert row is not None
    assert row.status == "cancelled"


async def test_video_tracker_job_requires_current_segment_lock(
    db_session, httpx_client_bound, project_admin, annotator, monkeypatch
):
    owner, _ = project_admin
    user, token = annotator
    task, item = await _make_video_task(db_session, owner.id)
    monkeypatch.setattr(
        "app.services.video_segment_service.settings.video_segment_size_frames",
        45,
    )
    batch = TaskBatch(
        project_id=task.project_id,
        dataset_id=item.dataset_id,
        display_id=f"B-VTJ-{uuid.uuid4().hex[:6]}",
        name="Video tracker batch",
        status="active",
        annotator_id=user.id,
        assigned_user_ids=[str(user.id)],
    )
    db_session.add_all(
        [
            ProjectMember(
                project_id=task.project_id,
                user_id=user.id,
                role="annotator",
                assigned_by=owner.id,
            ),
            batch,
        ]
    )
    await db_session.flush()
    task.batch_id = batch.id
    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 1, "y": 2, "width": 10, "height": 12},
    )
    db_session.add(annotation)
    await db_session.flush()

    segments_resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/segments",
        headers={"Authorization": f"Bearer {token}"},
    )
    segment_id = segments_resp.json()["segments"][0]["id"]

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/video/tracks/{annotation.id}:propagate",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "from_frame": 0,
            "to_frame": 12,
            "model_key": "mock_bbox",
            "direction": "forward",
            "segment_id": segment_id,
            "prompt": {"type": "bbox", "geometry": annotation.geometry},
        },
    )

    assert resp.status_code == 409
