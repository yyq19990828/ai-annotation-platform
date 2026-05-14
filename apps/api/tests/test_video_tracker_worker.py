import uuid
from datetime import datetime, timezone

from app.config import settings
from app.db.models.annotation import Annotation
from app.db.models.ml_backend import MLBackend
from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus
from app.services.ml_client import PredictionResult
from app.services.video_tracker_runner import run_tracker_job


async def _make_video_task(db_session, owner_id):
    project = Project(
        display_id=f"P-VTW-{uuid.uuid4().hex[:6]}",
        name="Video Tracker Worker Project",
        type_key="video-track",
        type_label="视频 · 时序追踪",
        owner_id=owner_id,
        classes=["car"],
    )
    dataset = Dataset(
        display_id=f"D-VTW-{uuid.uuid4().hex[:6]}",
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
        metadata_={"video": {"duration_ms": 3000, "fps": 30, "frame_count": 90}},
    )
    db_session.add(item)
    await db_session.flush()
    task = Task(
        project_id=project.id,
        dataset_item_id=item.id,
        display_id=f"T-VTW-{uuid.uuid4().hex[:6]}",
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()
    return task, item


async def test_tracker_worker_completes_mock_bbox_job_and_writes_video_track(
    db_session, super_admin
):
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 1, "y": 2, "w": 10, "h": 12},
    )
    db_session.add(annotation)
    await db_session.flush()
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=annotation.id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="mock_bbox",
        direction="forward",
        from_frame=0,
        to_frame=2,
        prompt={"type": "bbox", "geometry": annotation.geometry},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()
    events: list[dict] = []

    async def collect(_channel: str, payload: dict) -> None:
        events.append(payload)

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    await db_session.refresh(annotation)

    assert job.status == "completed"
    assert annotation.annotation_type == "video_track"
    assert annotation.geometry["type"] == "video_track"
    assert [kf["frame_index"] for kf in annotation.geometry["keyframes"]] == [0, 1, 2]
    assert annotation.geometry["keyframes"][0]["source"] == "manual"
    assert annotation.geometry["keyframes"][1]["source"] == "prediction"
    assert [event["type"] for event in events] == [
        "job_started",
        "frame_result",
        "job_progress",
        "frame_result",
        "job_progress",
        "frame_result",
        "job_progress",
        "job_completed",
    ]


async def test_tracker_worker_marks_unknown_model_failed(db_session, super_admin):
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 1, "y": 2, "w": 10, "h": 12},
    )
    db_session.add(annotation)
    await db_session.flush()
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=annotation.id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="missing_model",
        direction="forward",
        from_frame=0,
        to_frame=2,
        prompt={},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()

    async def collect(_channel: str, _payload: dict) -> None:
        return None

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    await db_session.refresh(annotation)

    assert job.status == "failed"
    assert "Unsupported tracker model" in (job.error_message or "")
    assert annotation.geometry["type"] == "bbox"


async def test_tracker_worker_preserves_partial_results_on_cancel(
    db_session, super_admin
):
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="video_bbox",
        class_name="car",
        geometry={
            "type": "video_bbox",
            "frame_index": 0,
            "x": 1,
            "y": 2,
            "w": 10,
            "h": 12,
        },
    )
    db_session.add(annotation)
    await db_session.flush()
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=annotation.id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="mock_bbox",
        direction="forward",
        from_frame=1,
        to_frame=3,
        prompt={"type": "bbox", "geometry": annotation.geometry},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()

    async def cancel_after_first_result(_channel: str, payload: dict) -> None:
        if payload["type"] == "frame_result":
            job.cancel_requested_at = datetime.now(timezone.utc)
            await db_session.flush()

    await run_tracker_job(db_session, job.id, publisher=cancel_after_first_result)
    await db_session.refresh(job)
    await db_session.refresh(annotation)

    assert job.status == "cancelled"
    assert [kf["frame_index"] for kf in annotation.geometry["keyframes"]] == [0, 1]
    assert annotation.geometry["keyframes"][1]["source"] == "prediction"


async def test_tracker_worker_calls_project_ml_backend_in_windows(
    db_session, super_admin, monkeypatch
):
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    project = await db_session.get(Project, task.project_id)
    backend = MLBackend(
        project_id=task.project_id,
        name="SAM2 Video",
        url="http://sam2-video.test",
        state="connected",
        is_interactive=True,
        extra_params={},
    )
    db_session.add(backend)
    await db_session.flush()
    project.ml_backend_id = backend.id
    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="video_bbox",
        class_name="car",
        geometry={
            "type": "video_bbox",
            "frame_index": 0,
            "x": 1,
            "y": 2,
            "w": 10,
            "h": 12,
        },
    )
    db_session.add(annotation)
    await db_session.flush()
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=annotation.id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="sam2_video",
        direction="forward",
        from_frame=0,
        to_frame=4,
        prompt={"type": "bbox", "geometry": annotation.geometry},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()
    monkeypatch.setattr(settings, "video_tracker_window_size_frames", 2)
    calls: list[dict] = []

    async def fake_predict_interactive(self, task_data, context):
        calls.append(context)
        return PredictionResult(
            task_id=task_data["id"],
            result=[
                {
                    "frame_index": frame_index,
                    "geometry": {"type": "bbox", "x": 1, "y": 2, "w": 10, "h": 12},
                    "confidence": 0.9,
                }
                for frame_index in range(context["from_frame"], context["to_frame"] + 1)
            ],
        )

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.predict_interactive",
        fake_predict_interactive,
    )

    async def collect(_channel: str, _payload: dict) -> None:
        return None

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    await db_session.refresh(annotation)

    assert job.status == "completed"
    assert [(c["from_frame"], c["to_frame"]) for c in calls] == [(0, 1), (2, 3), (4, 4)]
    assert {c["type"] for c in calls} == {"video_tracker"}
    assert {c["model_key"] for c in calls} == {"sam2_video"}
    assert [kf["frame_index"] for kf in annotation.geometry["keyframes"]] == [
        0,
        1,
        2,
        3,
        4,
    ]


async def test_tracker_worker_marks_low_confidence_backend_results_outside(
    db_session, super_admin, monkeypatch
):
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    project = await db_session.get(Project, task.project_id)
    backend = MLBackend(
        project_id=task.project_id,
        name="SAM3 Video",
        url="http://sam3-video.test",
        state="connected",
        is_interactive=True,
        extra_params={},
    )
    db_session.add(backend)
    await db_session.flush()
    project.ml_backend_id = backend.id
    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="video_track",
        class_name="car",
        geometry={
            "type": "video_track",
            "track_id": "car-1",
            "keyframes": [
                {
                    "frame_index": 0,
                    "bbox": {"x": 1, "y": 2, "w": 10, "h": 12},
                    "source": "manual",
                },
                {
                    "frame_index": 1,
                    "bbox": {"x": 1, "y": 2, "w": 10, "h": 12},
                    "source": "prediction",
                },
            ],
            "outside": [],
        },
    )
    db_session.add(annotation)
    await db_session.flush()
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=annotation.id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="sam3_video",
        direction="forward",
        from_frame=1,
        to_frame=2,
        prompt={"type": "bbox", "geometry": annotation.geometry},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()
    monkeypatch.setattr(settings, "video_tracker_low_confidence_outside_threshold", 0.5)

    async def fake_predict_interactive(self, task_data, context):
        return PredictionResult(
            task_id=task_data["id"],
            result=[
                {
                    "frame_index": 1,
                    "geometry": {"type": "bbox", "x": 1, "y": 2, "w": 10, "h": 12},
                    "confidence": 0.2,
                },
                {
                    "frame_index": 2,
                    "geometry": {"type": "bbox", "x": 3, "y": 4, "w": 10, "h": 12},
                    "confidence": 0.8,
                },
            ],
        )

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.predict_interactive",
        fake_predict_interactive,
    )

    async def collect(_channel: str, _payload: dict) -> None:
        return None

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    await db_session.refresh(annotation)

    assert job.status == "completed"
    assert annotation.geometry["outside"] == [
        {"from": 1, "to": 1, "source": "prediction"}
    ]
    assert [kf["frame_index"] for kf in annotation.geometry["keyframes"]] == [0, 2]
