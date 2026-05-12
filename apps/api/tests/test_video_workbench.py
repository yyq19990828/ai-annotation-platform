import subprocess
import uuid

import pytest
from pydantic import TypeAdapter
from sqlalchemy import select

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem, VideoFrameIndex
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.schemas._jsonb_types import Geometry
from app.workers.media import (
    FFMPEG_POSTER_TIMEOUT_SECONDS,
    FFMPEG_TRANSCODE_TIMEOUT_SECONDS,
    FFPROBE_TIMEOUT_SECONDS,
    extract_video_poster,
    parse_ffprobe_video_metadata,
    parse_ffprobe_frame_timetable,
    probe_video_file,
    probe_video_frame_timetable,
    transcode_video_for_browser,
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


def test_parse_ffprobe_frame_timetable_extracts_frame_pts():
    frames = parse_ffprobe_frame_timetable(
        {
            "frames": [
                {
                    "media_type": "video",
                    "key_frame": 1,
                    "best_effort_timestamp_time": "0.000000",
                    "pict_type": "I",
                    "pkt_pos": "48",
                },
                {
                    "media_type": "video",
                    "key_frame": 0,
                    "pkt_pts_time": "0.033367",
                    "pict_type": "P",
                    "pkt_pos": "4096",
                },
                {
                    "media_type": "audio",
                    "best_effort_timestamp_time": "0.040000",
                },
            ]
        }
    )

    assert frames == [
        {
            "frame_index": 0,
            "pts_ms": 0,
            "is_keyframe": True,
            "pict_type": "I",
            "byte_offset": 48,
        },
        {
            "frame_index": 1,
            "pts_ms": 33,
            "is_keyframe": False,
            "pict_type": "P",
            "byte_offset": 4096,
        },
    ]


def test_probe_video_file_uses_timeout(tmp_path, monkeypatch):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"fake")
    seen: dict[str, object] = {}

    def fake_run(*args, **kwargs):
        seen["args"] = args[0]
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
    assert any("stream=codec_type,codec_name" in arg for arg in seen["args"])


def test_probe_video_frame_timetable_uses_timeout(tmp_path, monkeypatch):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"fake")
    seen: dict[str, object] = {}

    def fake_run(*args, **kwargs):
        seen["args"] = args[0]
        seen["timeout"] = kwargs.get("timeout")
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout='{"frames":[{"media_type":"video","best_effort_timestamp_time":"0","key_frame":1}]}',
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    frames = probe_video_frame_timetable(video)

    assert frames[0]["pts_ms"] == 0
    assert seen["timeout"] == FFPROBE_TIMEOUT_SECONDS
    assert "-show_frames" in seen["args"]


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


def test_transcode_video_for_browser_uses_timeout(tmp_path, monkeypatch):
    video = tmp_path / "clip.mp4"
    playback = tmp_path / "playback.mp4"
    video.write_bytes(b"fake")
    seen: dict[str, object] = {}

    def fake_run(*args, **kwargs):
        seen["args"] = args[0]
        seen["timeout"] = kwargs.get("timeout")
        return subprocess.CompletedProcess(
            args=args[0], returncode=0, stdout="", stderr=""
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    transcode_video_for_browser(video, playback)

    assert seen["timeout"] == FFMPEG_TRANSCODE_TIMEOUT_SECONDS
    assert "libx264" in seen["args"]


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
    assert body["video_url"] == "http://storage.local/playback/clip.mp4"
    assert body["poster_url"] == "http://storage.local/posters/clip.webp"
    assert body["metadata"]["fps"] == 30
    assert body["metadata"]["playback_path"] == "playback/clip.mp4"
    assert body["expires_in"] == 3600
    assert signed == [("playback/clip.mp4", 3600), ("posters/clip.webp", 3600)]


async def test_video_frame_timetable_returns_ffprobe_rows(
    db_session,
    httpx_client_bound,
    super_admin,
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
        metadata_={"video": {"fps": 30, "frame_count": 4}},
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
    db_session.add_all(
        [
            VideoFrameIndex(
                dataset_item_id=item.id,
                frame_index=0,
                pts_ms=0,
                is_keyframe=True,
                pict_type="I",
                byte_offset=10,
            ),
            VideoFrameIndex(
                dataset_item_id=item.id,
                frame_index=1,
                pts_ms=33,
                is_keyframe=False,
                pict_type="P",
                byte_offset=20,
            ),
            VideoFrameIndex(
                dataset_item_id=item.id,
                frame_index=2,
                pts_ms=67,
                is_keyframe=False,
                pict_type="P",
                byte_offset=30,
            ),
        ]
    )
    await db_session.flush()

    resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/frame-timetable?from=1&to=2",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "ffprobe"
    assert body["fps"] == 30
    assert body["frame_count"] == 4
    assert body["frames"] == [
        {
            "frame_index": 1,
            "pts_ms": 33,
            "is_keyframe": False,
            "pict_type": "P",
            "byte_offset": 20,
        },
        {
            "frame_index": 2,
            "pts_ms": 67,
            "is_keyframe": False,
            "pict_type": "P",
            "byte_offset": 30,
        },
    ]


async def test_video_frame_timetable_falls_back_to_estimated(
    db_session,
    httpx_client_bound,
    super_admin,
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
        metadata_={"video": {"fps": 24, "frame_count": 12}},
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

    resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/video/frame-timetable",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "estimated"
    assert body["fps"] == 24
    assert body["frame_count"] == 12
    assert body["frames"] == []


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


async def _create_video_export_fixture(db_session, user):
    suffix = uuid.uuid4().hex[:6]
    project = Project(
        display_id=f"P-VID-{suffix}",
        name="Video Project",
        type_key="video-track",
        type_label="视频 · 时序追踪",
        owner_id=user.id,
        classes=["car", "person"],
        attribute_schema={
            "fields": [
                {"key": "speed", "label": "Speed", "type": "number"},
            ]
        },
    )
    dataset = Dataset(
        display_id=f"D-VID-{suffix}",
        name="videos",
        data_type="video",
        created_by=user.id,
    )
    db_session.add_all([project, dataset])
    await db_session.flush()

    batch_a = TaskBatch(
        project_id=project.id,
        dataset_id=dataset.id,
        display_id=f"B-A-{suffix}",
        name="Batch A",
        created_by=user.id,
    )
    batch_b = TaskBatch(
        project_id=project.id,
        dataset_id=dataset.id,
        display_id=f"B-B-{suffix}",
        name="Batch B",
        created_by=user.id,
    )
    db_session.add_all([batch_a, batch_b])
    await db_session.flush()

    item_a = DatasetItem(
        dataset_id=dataset.id,
        file_name="clip-a.mp4",
        file_path="videos/clip-a.mp4",
        file_type="video",
        metadata_={
            "video": {
                "fps": 10,
                "frame_count": 6,
                "width": 640,
                "height": 360,
                "codec": "h264",
            }
        },
    )
    item_b = DatasetItem(
        dataset_id=dataset.id,
        file_name="clip-b.mp4",
        file_path="videos/clip-b.mp4",
        file_type="video",
        metadata_={"video": {"fps": 10, "frame_count": 3}},
    )
    db_session.add_all([item_a, item_b])
    await db_session.flush()

    task_a = Task(
        project_id=project.id,
        dataset_item_id=item_a.id,
        batch_id=batch_a.id,
        display_id=f"T-A-{suffix}",
        file_name="clip-a.mp4",
        file_path="videos/clip-a.mp4",
        file_type="video",
        status="pending",
        sequence_order=1,
    )
    task_b = Task(
        project_id=project.id,
        dataset_item_id=item_b.id,
        batch_id=batch_b.id,
        display_id=f"T-B-{suffix}",
        file_name="clip-b.mp4",
        file_path="videos/clip-b.mp4",
        file_type="video",
        status="pending",
        sequence_order=2,
    )
    db_session.add_all([task_a, task_b])
    await db_session.flush()

    track_ann = Annotation(
        task_id=task_a.id,
        project_id=project.id,
        user_id=user.id,
        annotation_type="video_track",
        class_name="car",
        geometry={
            "type": "video_track",
            "track_id": "trk_car",
            "keyframes": [
                {
                    "frame_index": 0,
                    "bbox": {"x": 0.1, "y": 0.2, "w": 0.2, "h": 0.2},
                    "source": "manual",
                },
                {
                    "frame_index": 2,
                    "bbox": {"x": 0.3, "y": 0.4, "w": 0.2, "h": 0.2},
                    "source": "manual",
                },
                {
                    "frame_index": 4,
                    "bbox": {"x": 0.5, "y": 0.6, "w": 0.2, "h": 0.2},
                    "source": "manual",
                    "absent": True,
                },
            ],
        },
        attributes={"speed": 42},
    )
    bbox_ann = Annotation(
        task_id=task_a.id,
        project_id=project.id,
        user_id=user.id,
        annotation_type="video_bbox",
        class_name="person",
        geometry={
            "type": "video_bbox",
            "frame_index": 1,
            "x": 0.2,
            "y": 0.2,
            "w": 0.1,
            "h": 0.1,
        },
        attributes={"speed": 3},
    )
    other_batch_ann = Annotation(
        task_id=task_b.id,
        project_id=project.id,
        user_id=user.id,
        annotation_type="video_track",
        class_name="person",
        geometry={
            "type": "video_track",
            "track_id": "trk_person",
            "keyframes": [
                {
                    "frame_index": 0,
                    "bbox": {"x": 0.4, "y": 0.1, "w": 0.1, "h": 0.2},
                    "source": "manual",
                }
            ],
        },
    )
    db_session.add_all([track_ann, bbox_ann, other_batch_ann])
    await db_session.flush()
    return project, batch_a, batch_b


async def _video_fixture_task_and_track(db_session, project):
    task = (
        await db_session.execute(
            select(Task).where(
                Task.project_id == project.id, Task.file_name == "clip-a.mp4"
            )
        )
    ).scalar_one()
    track = (
        await db_session.execute(
            select(Annotation).where(
                Annotation.task_id == task.id,
                Annotation.annotation_type == "video_track",
                Annotation.class_name == "car",
                Annotation.is_active.is_(True),
            )
        )
    ).scalar_one()
    return task, track


async def test_video_project_export_returns_video_tracks_json(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)

    resp = await httpx_client_bound.get(
        f"/api/v1/projects/{project.id}/export?format=coco",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    assert "P-VID" in resp.headers["content-disposition"]
    assert "_video_tracks.json" in resp.headers["content-disposition"]
    body = resp.json()
    assert body["export_type"] == "video_tracks"
    assert body["frame_mode"] == "keyframes"
    assert body["project"]["attribute_schema"]["fields"][0]["key"] == "speed"
    assert [c["name"] for c in body["categories"]] == ["car", "person"]
    assert len(body["tasks"]) == 2
    assert body["tasks"][0]["video_metadata"]["frame_count"] == 6
    assert len(body["tracks"]) == 2
    assert "frames" not in body["tracks"][0]
    assert len(body["keyframes"]) == 4
    assert len(body["video_bbox"]) == 1


async def test_video_batch_export_filters_tasks_and_annotations(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, batch_a, _ = await _create_video_export_fixture(db_session, user)

    resp = await httpx_client_bound.get(
        f"/api/v1/projects/{project.id}/batches/{batch_a.id}/export?format=coco",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    assert "_video_tracks.json" in resp.headers["content-disposition"]
    body = resp.json()
    assert [task["display_id"] for task in body["tasks"]] == [
        batch_a.display_id.replace("B-A", "T-A")
    ]
    assert [track["track_id"] for track in body["tracks"]] == ["trk_car"]
    assert len(body["video_bbox"]) == 1


async def test_video_export_all_frames_interpolates_and_absent_blocks(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)

    resp = await httpx_client_bound.get(
        f"/api/v1/projects/{project.id}/export?format=coco&video_frame_mode=all_frames",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    car = next(track for track in body["tracks"] if track["track_id"] == "trk_car")
    assert body["frame_mode"] == "all_frames"
    assert [frame["frame_index"] for frame in car["frames"]] == [0, 1, 2]
    assert car["frames"][1]["source"] == "interpolated"
    assert car["frames"][1]["bbox"] == {"x": 0.2, "y": 0.3, "w": 0.2, "h": 0.2}


async def test_video_export_preserves_and_applies_outside_ranges(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)
    _, track = await _video_fixture_task_and_track(db_session, project)
    track.geometry = {
        **track.geometry,
        "outside": [
            {"from": 1, "to": 1},
            {"from": 5, "to": 6, "source": "prediction"},
        ],
    }
    await db_session.flush()

    resp = await httpx_client_bound.get(
        f"/api/v1/projects/{project.id}/export?format=coco&video_frame_mode=all_frames",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    car = next(track for track in resp.json()["tracks"] if track["track_id"] == "trk_car")
    assert car["outside"] == [
        {"from": 1, "to": 1, "source": "manual"},
        {"from": 5, "to": 6, "source": "prediction"},
    ]
    assert [frame["frame_index"] for frame in car["frames"]] == [0, 2]


async def test_video_track_convert_frame_copy_preserves_source(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)
    task, track = await _video_fixture_task_and_track(db_session, project)

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/annotations/{track.id}/video/convert-to-bboxes",
        json={"operation": "copy", "scope": "frame", "frame_index": 1},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted_source"] is False
    assert body["source_annotation"]["id"] == str(track.id)
    assert len(body["created_annotations"]) == 1
    created = body["created_annotations"][0]
    assert created["annotation_type"] == "video_bbox"
    assert created["geometry"] == {
        "type": "video_bbox",
        "frame_index": 1,
        "x": 0.2,
        "y": 0.3,
        "w": 0.2,
        "h": 0.2,
    }


async def test_video_track_convert_frame_copy_rejects_outside_frame(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)
    task, track = await _video_fixture_task_and_track(db_session, project)
    track.geometry = {**track.geometry, "outside": [{"from": 1, "to": 1}]}
    await db_session.flush()

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/annotations/{track.id}/video/convert-to-bboxes",
        json={"operation": "copy", "scope": "frame", "frame_index": 1},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "track has no bbox at the requested frame"


async def test_video_track_convert_frame_split_removes_exact_keyframe(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)
    task, track = await _video_fixture_task_and_track(db_session, project)

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/annotations/{track.id}/video/convert-to-bboxes",
        json={"operation": "split", "scope": "frame", "frame_index": 2},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted_source"] is False
    assert body["removed_frame_indexes"] == [2]
    assert [
        kf["frame_index"] for kf in body["source_annotation"]["geometry"]["keyframes"]
    ] == [0, 4]
    assert body["created_annotations"][0]["geometry"]["frame_index"] == 2


async def test_video_track_convert_track_split_all_frames_deletes_source(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)
    task, track = await _video_fixture_task_and_track(db_session, project)

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/annotations/{track.id}/video/convert-to-bboxes",
        json={
            "operation": "split",
            "scope": "track",
            "frame_mode": "all_frames",
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted_source"] is True
    assert body["removed_frame_indexes"] == [0, 1, 2]
    assert body["source_annotation"] is None
    assert [ann["geometry"]["frame_index"] for ann in body["created_annotations"]] == [
        0,
        1,
        2,
    ]
    assert body["created_annotations"][1]["geometry"]["x"] == 0.2


async def test_video_track_convert_track_copy_keeps_removed_frames_empty(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)
    task, track = await _video_fixture_task_and_track(db_session, project)

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/annotations/{track.id}/video/convert-to-bboxes",
        json={
            "operation": "copy",
            "scope": "track",
            "frame_mode": "all_frames",
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted_source"] is False
    assert body["removed_frame_indexes"] == []
    assert body["source_annotation"]["id"] == str(track.id)
    assert [ann["geometry"]["frame_index"] for ann in body["created_annotations"]] == [
        0,
        1,
        2,
    ]


async def test_video_track_convert_rejects_non_track_annotation(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)
    task = (
        await db_session.execute(
            select(Task).where(
                Task.project_id == project.id, Task.file_name == "clip-a.mp4"
            )
        )
    ).scalar_one()
    bbox = (
        await db_session.execute(
            select(Annotation).where(
                Annotation.task_id == task.id,
                Annotation.annotation_type == "video_bbox",
            )
        )
    ).scalar_one()

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/annotations/{bbox.id}/video/convert-to-bboxes",
        json={"operation": "copy", "scope": "frame", "frame_index": 1},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Annotation is not a video_track"


async def test_video_track_convert_requires_task_visibility(
    db_session,
    httpx_client_bound,
    super_admin,
    annotator,
):
    user, _ = super_admin
    _, annotator_token = annotator
    project, _, _ = await _create_video_export_fixture(db_session, user)
    task, track = await _video_fixture_task_and_track(db_session, project)

    resp = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/annotations/{track.id}/video/convert-to-bboxes",
        json={"operation": "copy", "scope": "frame", "frame_index": 1},
        headers={"Authorization": f"Bearer {annotator_token}"},
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Task not found"


async def test_video_export_include_attributes_false_removes_schema_and_attrs(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)

    resp = await httpx_client_bound.get(
        f"/api/v1/projects/{project.id}/export?format=coco&include_attributes=false",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert "attribute_schema" not in body["project"]
    assert "attributes" not in body["tracks"][0]
    assert "attributes" not in body["video_bbox"][0]


@pytest.mark.parametrize("format", ["yolo", "voc"])
async def test_video_project_yolo_voc_export_returns_clear_400(
    db_session,
    httpx_client_bound,
    super_admin,
    format,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)

    resp = await httpx_client_bound.get(
        f"/api/v1/projects/{project.id}/export?format={format}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == (
        f"video-track projects do not support {format.upper()} export yet"
    )


async def test_video_mm_coco_export_returns_clear_400(
    db_session,
    httpx_client_bound,
    super_admin,
):
    user, token = super_admin
    project, _, _ = await _create_video_export_fixture(db_session, user)
    project.type_key = "video-mm"
    project.type_label = "视频 · 多模态"
    await db_session.flush()

    resp = await httpx_client_bound.get(
        f"/api/v1/projects/{project.id}/export?format=coco",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == (
        "Video annotation export is not supported for video-mm projects"
    )
