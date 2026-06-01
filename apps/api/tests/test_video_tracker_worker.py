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
from app.services.video_tracker_adapters import TrackerContext, TrackerFrameResult
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
    assert annotation.annotation_type == "video_track_bbox"
    assert annotation.geometry["type"] == "video_track_bbox"
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


def test_apply_tracker_results_only_backfills_grid_frames():
    """采样开启 (grid_step>1) 时只回填网格帧，off-grid 预测帧丢弃。"""
    from app.services.video_tracker_runner import apply_tracker_results

    annotation = Annotation(
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 1, "y": 2, "w": 10, "h": 12},
    )
    job = VideoTrackerJob(
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="sam2_video",
        direction="forward",
        from_frame=0,
        to_frame=30,
        prompt={},
        event_channel="video-tracker-job:test",
    )
    results = [
        TrackerFrameResult(
            frame_index=i,
            geometry={"type": "bbox", "x": float(i), "y": 0.0, "w": 5.0, "h": 5.0},
            confidence=0.9,
            outside=False,
        )
        for i in range(0, 31)
    ]

    apply_tracker_results(annotation, job, results, grid_step=10)

    frames = [kf["frame_index"] for kf in annotation.geometry["keyframes"]]
    # 手动 seed 帧 0 + 网格预测帧 10/20/30；1..9/11..29 等 off-grid 帧不持久化。
    assert frames == [0, 10, 20, 30]
    assert annotation.geometry["keyframes"][0]["source"] == "manual"
    assert all(
        kf["source"] == "prediction"
        for kf in annotation.geometry["keyframes"]
        if kf["frame_index"] != 0
    )


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
        annotation_type="video_track_bbox",
        class_name="car",
        geometry={
            "type": "video_track_bbox",
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


class _SeedRecordingAdapter:
    """Stub adapter that records the source_geometry it receives per window
    and emits a per-frame geometry whose x equals the frame index, so the
    seed handed to the next window is identifiable.

    Frames in ``outside_frames`` are emitted as outside (no geometry update).
    """

    model_key = "seed_recording"

    def __init__(self, outside_frames: set[int] | None = None) -> None:
        self.seeds: list[dict] = []
        self.outside_frames = outside_frames or set()

    async def propagate(self, ctx: TrackerContext):
        self.seeds.append(dict(ctx.source_geometry))
        frames = range(ctx.from_frame, ctx.to_frame + 1)
        if ctx.direction == "backward":
            frames = range(ctx.to_frame, ctx.from_frame - 1, -1)
        for frame_index in frames:
            if frame_index in self.outside_frames:
                yield TrackerFrameResult(
                    frame_index=frame_index,
                    geometry={},
                    confidence=0.0,
                    outside=True,
                )
                continue
            yield TrackerFrameResult(
                frame_index=frame_index,
                geometry={
                    "type": "bbox",
                    "x": float(frame_index),
                    "y": 0.0,
                    "w": 10.0,
                    "h": 10.0,
                },
                confidence=1.0,
                outside=False,
            )


async def _run_seed_test(db_session, super_admin, monkeypatch, *, direction, outside):
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 100, "y": 0, "w": 10, "h": 10},
    )
    db_session.add(annotation)
    await db_session.flush()
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=annotation.id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="seed_recording",
        direction=direction,
        from_frame=0,
        to_frame=5,
        prompt={},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()
    monkeypatch.setattr(settings, "video_tracker_window_size_frames", 2)
    adapter = _SeedRecordingAdapter(outside_frames=outside)
    monkeypatch.setattr(
        "app.services.video_tracker_runner.get_tracker_adapter",
        lambda _model_key: adapter,
    )

    async def collect(_channel: str, _payload: dict) -> None:
        return None

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    assert job.status == "completed"
    return adapter, annotation.geometry


async def test_tracker_seeds_next_window_from_prev_window_end_forward(
    db_session, super_admin, monkeypatch
):
    # Windows: (0,1) (2,3) (4,5). Window 1 seeds from original (x=100);
    # each later window seeds from the previous window's last frame geometry
    # (forward => to_frame, i.e. x == 1 then x == 3).
    adapter, _ = await _run_seed_test(
        db_session, super_admin, monkeypatch, direction="forward", outside=set()
    )
    assert adapter.seeds[0] == {"type": "bbox", "x": 100, "y": 0, "w": 10, "h": 10}
    assert adapter.seeds[1] == {
        "type": "bbox",
        "x": 1.0,
        "y": 0.0,
        "w": 10.0,
        "h": 10.0,
    }
    assert adapter.seeds[2] == {
        "type": "bbox",
        "x": 3.0,
        "y": 0.0,
        "w": 10.0,
        "h": 10.0,
    }


async def test_tracker_seeds_next_window_from_prev_window_end_backward(
    db_session, super_admin, monkeypatch
):
    # Windows reversed: (4,5) (2,3) (0,1). Each window propagates high->low,
    # so the last yielded frame is from_frame (the temporally-earlier
    # boundary adjacent to the next window): seed x == 4 then x == 2.
    adapter, _ = await _run_seed_test(
        db_session, super_admin, monkeypatch, direction="backward", outside=set()
    )
    assert adapter.seeds[0] == {"type": "bbox", "x": 100, "y": 0, "w": 10, "h": 10}
    assert adapter.seeds[1] == {
        "type": "bbox",
        "x": 4.0,
        "y": 0.0,
        "w": 10.0,
        "h": 10.0,
    }
    assert adapter.seeds[2] == {
        "type": "bbox",
        "x": 2.0,
        "y": 0.0,
        "w": 10.0,
        "h": 10.0,
    }


async def test_tracker_seed_falls_back_to_last_valid_when_window_all_outside(
    db_session, super_admin, monkeypatch
):
    # Forward windows (0,1) (2,3) (4,5); make window 2 (frames 2,3) all
    # outside. Window 3 must reuse window 1's last valid geometry (x == 1),
    # not an empty seed.
    adapter, _ = await _run_seed_test(
        db_session,
        super_admin,
        monkeypatch,
        direction="forward",
        outside={2, 3},
    )
    assert adapter.seeds[1] == {
        "type": "bbox",
        "x": 1.0,
        "y": 0.0,
        "w": 10.0,
        "h": 10.0,
    }
    # window 2 produced no valid geometry, so window 3 seed stays at x == 1
    assert adapter.seeds[2] == {
        "type": "bbox",
        "x": 1.0,
        "y": 0.0,
        "w": 10.0,
        "h": 10.0,
    }


# ── v0.10.49 · worker 按专表最终状态同步 async_jobs（修双写漂移）─────────────


async def _run_worker_with_final_status(db_session, super_admin, monkeypatch, status):
    """seed 专表 job + stub run_tracker_job 返回指定终态，跑 worker 包装层，
    返回它创建/同步的 async_job。验证 cancelled/failed 不被误标 completed。"""
    from sqlalchemy import select

    from app.db.models.async_job import AsyncJob
    from app.workers import video_tracker as worker_mod

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

    async def _stub_run(db, job_id, **_kw):
        row = await db.get(VideoTrackerJob, job_id)
        row.status = status
        if status == VideoTrackerJobStatus.FAILED.value:
            row.error_message = "boom"
        await db.commit()
        return row

    monkeypatch.setattr(worker_mod, "run_tracker_job", _stub_run)

    # 让 worker 内部 create_async_engine/async_sessionmaker 复用 db_session
    class _Engine:
        async def dispose(self):
            pass

    class _Factory:
        def __init__(self, *_a, **_kw):
            pass

        def __call__(self):
            class _Ctx:
                async def __aenter__(self_i):
                    return db_session

                async def __aexit__(self_i, *a):
                    return False

            return _Ctx()

    # worker 在模块顶层 import，故 patch worker_mod 上的名字（非 sqlalchemy 模块）
    monkeypatch.setattr(worker_mod, "create_async_engine", lambda *a, **k: _Engine())
    monkeypatch.setattr(worker_mod, "async_sessionmaker", _Factory)

    await worker_mod._run_video_tracker_job(str(job.id), "celery-vt")

    aj = (
        (
            await db_session.execute(
                select(AsyncJob).where(
                    AsyncJob.kind == "video_tracker",
                    AsyncJob.payload["video_tracker_job_id"].astext == str(job.id),
                )
            )
        )
        .scalars()
        .one()
    )
    return aj


async def test_worker_syncs_async_job_cancelled(db_session, super_admin, monkeypatch):
    aj = await _run_worker_with_final_status(
        db_session, super_admin, monkeypatch, VideoTrackerJobStatus.CANCELLED.value
    )
    assert aj.status == "cancelled"  # 不再被误标 completed


async def test_worker_syncs_async_job_failed(db_session, super_admin, monkeypatch):
    aj = await _run_worker_with_final_status(
        db_session, super_admin, monkeypatch, VideoTrackerJobStatus.FAILED.value
    )
    assert aj.status == "failed"
    assert aj.error_message == "boom"


async def test_worker_syncs_async_job_completed(db_session, super_admin, monkeypatch):
    aj = await _run_worker_with_final_status(
        db_session, super_admin, monkeypatch, VideoTrackerJobStatus.COMPLETED.value
    )
    assert aj.status == "completed"
