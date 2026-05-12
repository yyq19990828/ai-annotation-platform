import uuid

from app.db.models.dataset import Dataset, DatasetItem, VideoChunk, VideoFrameCache
from app.db.models.project import Project
from app.db.models.task import Task


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
    assert video_resp.json()["dataset_item_id"] == str(item.id)


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


async def test_video_asset_failures_list_metadata_chunk_and_frame_errors(
    db_session, httpx_client_bound, super_admin
):
    user, token = super_admin
    task, item = await _make_video_task(db_session, user.id)
    item.metadata_ = {
        **(item.metadata_ or {}),
        "video": {
            **((item.metadata_ or {}).get("video") or {}),
            "probe_error": "ffprobe failed",
        },
    }
    db_session.add_all(
        [
            VideoChunk(
                dataset_item_id=item.id,
                chunk_id=2,
                start_frame=60,
                end_frame=89,
                status="failed",
                error="chunk failed",
            ),
            VideoFrameCache(
                dataset_item_id=item.id,
                frame_index=12,
                width=320,
                format="webp",
                status="failed",
                error="frame failed",
            ),
        ]
    )
    await db_session.flush()

    resp = await httpx_client_bound.get(
        "/api/v1/storage/video-assets/failures",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    by_type = {item["asset_type"]: item for item in body["items"]}
    assert by_type["probe"]["error"] == "ffprobe failed"
    assert by_type["probe"]["task_display_id"] == task.display_id
    assert by_type["chunk"]["chunk_id"] == 2
    assert by_type["frame"]["frame_index"] == 12
    assert by_type["frame"]["width"] == 320


async def test_video_asset_retry_queues_existing_media_tasks(
    db_session, httpx_client_bound, super_admin, monkeypatch
):
    user, token = super_admin
    _, item = await _make_video_task(db_session, user.id)
    chunk = VideoChunk(
        dataset_item_id=item.id,
        chunk_id=1,
        start_frame=30,
        end_frame=59,
        status="failed",
        error="chunk failed",
    )
    frame = VideoFrameCache(
        dataset_item_id=item.id,
        frame_index=8,
        width=320,
        format="jpeg",
        status="failed",
        error="frame failed",
    )
    db_session.add_all([chunk, frame])
    await db_session.flush()
    queued_metadata: list[str] = []
    queued_chunks: list[tuple[str, list[int]]] = []
    queued_frames: list[tuple[str, list[dict]]] = []

    monkeypatch.setattr(
        "app.workers.media.generate_video_metadata.delay",
        lambda item_id: queued_metadata.append(item_id),
    )
    monkeypatch.setattr(
        "app.workers.media.ensure_video_chunks.delay",
        lambda item_id, chunk_ids: queued_chunks.append((item_id, chunk_ids)),
    )
    monkeypatch.setattr(
        "app.workers.media.extract_video_frames.delay",
        lambda item_id, requests: queued_frames.append((item_id, requests)),
    )

    metadata_resp = await httpx_client_bound.post(
        "/api/v1/storage/video-assets/retry",
        headers={"Authorization": f"Bearer {token}"},
        json={"asset_type": "poster", "dataset_item_id": str(item.id)},
    )
    chunk_resp = await httpx_client_bound.post(
        "/api/v1/storage/video-assets/retry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "asset_type": "chunk",
            "dataset_item_id": str(item.id),
            "chunk_id": 1,
        },
    )
    frame_resp = await httpx_client_bound.post(
        "/api/v1/storage/video-assets/retry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "asset_type": "frame",
            "dataset_item_id": str(item.id),
            "frame_index": 8,
            "width": 320,
            "format": "jpeg",
        },
    )

    assert metadata_resp.status_code == 202
    assert chunk_resp.status_code == 202
    assert frame_resp.status_code == 202
    assert queued_metadata == [str(item.id)]
    assert queued_chunks == [(str(item.id), [1])]
    assert queued_frames == [
        (
            str(item.id),
            [{"frame_index": 8, "width": 320, "format": "jpeg"}],
        )
    ]
    await db_session.refresh(chunk)
    await db_session.refresh(frame)
    assert chunk.status == "pending"
    assert chunk.error is None
    assert frame.status == "pending"
    assert frame.error is None
