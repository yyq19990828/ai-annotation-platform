import subprocess
import uuid

import pytest
from pydantic import TypeAdapter

from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.project import Project
from app.db.models.task import Task
from app.schemas._jsonb_types import Geometry
from app.workers.media import (
    FFMPEG_POSTER_TIMEOUT_SECONDS,
    FFPROBE_TIMEOUT_SECONDS,
    extract_video_poster,
    parse_ffprobe_video_metadata,
    probe_video_file,
)


def test_parse_ffprobe_video_metadata_computes_fps_and_frame_count():
    meta = parse_ffprobe_video_metadata(
        {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1280,
                    "height": 720,
                    "avg_frame_rate": "30000/1001",
                    "nb_frames": "N/A",
                    "duration": "2.002",
                }
            ],
            "format": {"duration": "2.002"},
        }
    )

    assert meta == {
        "duration_ms": 2002,
        "fps": 29.97,
        "frame_count": 60,
        "width": 1280,
        "height": 720,
        "codec": "h264",
    }


def test_probe_video_file_uses_timeout(tmp_path, monkeypatch):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"fake")
    seen: dict[str, object] = {}

    def fake_run(*args, **kwargs):
        seen["timeout"] = kwargs.get("timeout")
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout='{"streams":[{"codec_type":"video","width":1,"height":1}]}',
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    probe_video_file(video)

    assert seen["timeout"] == FFPROBE_TIMEOUT_SECONDS


def test_extract_video_poster_uses_timeout(tmp_path, monkeypatch):
    video = tmp_path / "clip.mp4"
    poster = tmp_path / "poster.webp"
    video.write_bytes(b"fake")
    seen: dict[str, object] = {}

    def fake_run(*args, **kwargs):
        seen["timeout"] = kwargs.get("timeout")
        return subprocess.CompletedProcess(
            args=args[0], returncode=0, stdout="", stderr=""
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    extract_video_poster(video, poster)

    assert seen["timeout"] == FFMPEG_POSTER_TIMEOUT_SECONDS


def test_video_bbox_geometry_validates_and_bbox_stays_compatible():
    adapter = TypeAdapter(Geometry)

    parsed = adapter.validate_python(
        {
            "type": "video_bbox",
            "frame_index": 12,
            "x": 0.1,
            "y": 0.2,
            "w": 0.3,
            "h": 0.4,
        }
    )
    assert parsed.type == "video_bbox"
    assert parsed.frame_index == 12

    legacy_bbox = adapter.validate_python(
        {"type": "bbox", "x": 0, "y": 0, "w": 1, "h": 1}
    )
    assert legacy_bbox.type == "bbox"


def test_video_track_geometry_validates_and_video_bbox_stays_compatible():
    adapter = TypeAdapter(Geometry)

    parsed = adapter.validate_python(
        {
            "type": "video_track",
            "track_id": "trk_abc123",
            "keyframes": [
                {
                    "frame_index": 0,
                    "bbox": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
                    "source": "manual",
                },
                {
                    "frame_index": 30,
                    "bbox": {"x": 0.2, "y": 0.2, "w": 0.3, "h": 0.4},
                    "source": "prediction",
                    "occluded": True,
                },
            ],
        }
    )
    assert parsed.type == "video_track"
    assert parsed.track_id == "trk_abc123"
    assert parsed.keyframes[1].occluded is True

    legacy_video_bbox = adapter.validate_python(
        {
            "type": "video_bbox",
            "frame_index": 12,
            "x": 0.1,
            "y": 0.2,
            "w": 0.3,
            "h": 0.4,
        }
    )
    assert legacy_video_bbox.type == "video_bbox"


@pytest.mark.parametrize(
    "geometry",
    [
        {"type": "video_track", "track_id": "trk_empty", "keyframes": []},
        {
            "type": "video_track",
            "track_id": "trk_negative",
            "keyframes": [
                {
                    "frame_index": -1,
                    "bbox": {"x": 0, "y": 0, "w": 1, "h": 1},
                    "source": "manual",
                }
            ],
        },
    ],
)
def test_video_track_geometry_rejects_invalid_keyframes(geometry):
    adapter = TypeAdapter(Geometry)

    with pytest.raises(ValueError):
        adapter.validate_python(geometry)


async def test_get_task_exposes_video_metadata(
    db_session,
    httpx_client_bound,
    super_admin,
    monkeypatch,
):
    user, token = super_admin
    project = Project(
        display_id=f"P-VID-{uuid.uuid4().hex[:6]}",
        name="Video Project",
        type_key="video-track",
        type_label="视频 · 时序追踪",
        owner_id=user.id,
        classes=["car"],
    )
    dataset = Dataset(
        display_id=f"D-VID-{uuid.uuid4().hex[:6]}",
        name="videos",
        data_type="video",
        created_by=user.id,
    )
    db_session.add_all([project, dataset])
    await db_session.flush()
    item = DatasetItem(
        dataset_id=dataset.id,
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        width=640,
        height=360,
        thumbnail_path="thumbnails/poster.webp",
        metadata_={
            "video": {
                "duration_ms": 1000,
                "fps": 25,
                "frame_count": 25,
                "width": 640,
                "height": 360,
                "codec": "h264",
                "poster_frame_path": "thumbnails/poster.webp",
            }
        },
    )
    db_session.add(item)
    await db_session.flush()
    task = Task(
        project_id=project.id,
        dataset_item_id=item.id,
        display_id=f"T-VID-{uuid.uuid4().hex[:6]}",
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    monkeypatch.setattr(
        "app.api.v1.tasks.storage_service.generate_download_url",
        lambda key, expires_in=3600, bucket=None: f"http://storage.local/{key}",
    )

    resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["video_metadata"]["frame_count"] == 25
    assert body["thumbnail_url"] == "http://storage.local/thumbnails/poster.webp"


async def test_video_manifest_returns_signed_urls(
    db_session,
    httpx_client_bound,
    super_admin,
    monkeypatch,
):
    user, token = super_admin
    project = Project(
        display_id=f"P-VID-{uuid.uuid4().hex[:6]}",
        name="Video Project",
        type_key="video-track",
        type_label="视频 · 时序追踪",
        owner_id=user.id,
        classes=["car"],
    )
    dataset = Dataset(
        display_id=f"D-VID-{uuid.uuid4().hex[:6]}",
        name="videos",
        data_type="video",
        created_by=user.id,
    )
    db_session.add_all([project, dataset])
    await db_session.flush()
    item = DatasetItem(
        dataset_id=dataset.id,
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        metadata_={
            "video": {
                "fps": 30,
                "frame_count": 90,
                "poster_frame_path": "posters/clip.webp",
            }
        },
    )
    db_session.add(item)
    await db_session.flush()
    task = Task(
        project_id=project.id,
        dataset_item_id=item.id,
        display_id=f"T-VID-{uuid.uuid4().hex[:6]}",
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    signed: list[tuple[str, int]] = []

    def fake_generate_download_url(key, expires_in=3600, bucket=None):
        signed.append((key, expires_in))
        return f"http://storage.local/{key}"

    monkeypatch.setattr(
        "app.api.v1.tasks.storage_service.generate_download_url",
        fake_generate_download_url,
    )

    resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/manifest",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["task_id"] == str(task.id)
    assert body["video_url"] == "http://storage.local/videos/clip.mp4"
    assert body["poster_url"] == "http://storage.local/posters/clip.webp"
    assert body["metadata"]["fps"] == 30
    assert body["expires_in"] == 3600
    assert signed == [("videos/clip.mp4", 3600), ("posters/clip.webp", 3600)]


async def test_video_manifest_returns_503_when_metadata_not_ready(
    db_session,
    httpx_client_bound,
    super_admin,
    monkeypatch,
):
    user, token = super_admin
    project = Project(
        display_id=f"P-VID-{uuid.uuid4().hex[:6]}",
        name="Video Project",
        type_key="video-track",
        type_label="视频 · 时序追踪",
        owner_id=user.id,
        classes=["car"],
    )
    db_session.add(project)
    await db_session.flush()
    task = Task(
        project_id=project.id,
        display_id=f"T-VID-{uuid.uuid4().hex[:6]}",
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    monkeypatch.setattr(
        "app.api.v1.tasks.storage_service.generate_download_url",
        lambda key, expires_in=3600, bucket=None: f"http://storage.local/{key}",
    )

    resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/manifest",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 503
    assert resp.json()["detail"] == "Video metadata not ready"


async def test_video_manifest_rejects_non_video(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project = Project(
        display_id=f"P-IMG-{uuid.uuid4().hex[:6]}",
        name="Image Project",
        type_key="image-det",
        type_label="图像目标检测",
        owner_id=user.id,
        classes=["car"],
    )
    db_session.add(project)
    await db_session.flush()
    task = Task(
        project_id=project.id,
        display_id=f"T-IMG-{uuid.uuid4().hex[:6]}",
        file_name="image.jpg",
        file_path="images/image.jpg",
        file_type="image",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/manifest",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 400
