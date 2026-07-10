"""v0.21.26 · 阶段 0 · 多目标落库底座。

backend 一次追踪返回多实例 (模式 a「自动发现」) 时:
- 主实例 (与用户种子对应, primary 标记 / 无 instance_id 兜底) 回填源 annotation;
- 其余每个 instance_id 各落一条新 annotation (继承 label、source="ai_tracker"、新 track_id)。
无 instance_id 的单实例老 backend 走原路径, 零回归。
"""

import uuid

import pytest

from app.config import settings
from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus
from app.services.video_tracker_adapters import TrackerContext, TrackerFrameResult
from app.services.video_tracker_runner import (
    _partition_results_by_instance,
    run_tracker_job,
)


# ── 纯函数: 按实例分组 ────────────────────────────────────────────────


def _r(frame: int, instance_id=None, primary=False) -> TrackerFrameResult:
    return TrackerFrameResult(
        frame_index=frame,
        geometry={"type": "bbox", "x": float(frame), "y": 0.0, "w": 5.0, "h": 5.0},
        confidence=1.0,
        outside=False,
        instance_id=instance_id,
        primary=primary,
    )


def test_partition_legacy_no_instance_id_all_primary():
    results = [_r(0), _r(1), _r(2)]
    primary, extras = _partition_results_by_instance(results)
    assert [x.frame_index for x in primary] == [0, 1, 2]
    assert extras == {}


def test_partition_primary_flag_routes_flagged_instance_to_source():
    results = [
        _r(0, "a", primary=True),
        _r(0, "b"),
        _r(1, "a", primary=True),
        _r(1, "b"),
        _r(1, "c"),
    ]
    primary, extras = _partition_results_by_instance(results)
    assert {x.frame_index for x in primary} == {0, 1}
    assert all(x.instance_id == "a" for x in primary)
    assert set(extras) == {"b", "c"}
    assert [x.frame_index for x in extras["b"]] == [0, 1]
    assert [x.frame_index for x in extras["c"]] == [1]


def test_partition_primary_flag_covers_all_frames_of_that_instance():
    # backend 只在种子帧标了 primary, 但该 instance 的其余帧也应整体归主。
    results = [_r(0, "obj7", primary=True), _r(1, "obj7"), _r(2, "obj7"), _r(1, "obj9")]
    primary, extras = _partition_results_by_instance(results)
    assert [x.frame_index for x in primary] == [0, 1, 2]
    assert set(extras) == {"obj9"}


def test_partition_no_primary_flag_uses_smallest_instance_id():
    results = [_r(0, "2"), _r(0, "1"), _r(1, "2"), _r(1, "1")]
    primary, extras = _partition_results_by_instance(results)
    assert all(x.instance_id == "1" for x in primary)
    assert set(extras) == {"2"}


# ── runner 端到端: 单 seed → 多实例 → 多 annotation ──────────────────


async def _make_video_task(db_session, owner_id):
    project = Project(
        display_id=f"P-MI-{uuid.uuid4().hex[:6]}",
        name="Multi-instance Tracker Project",
        type_key="video-track",
        type_label="视频 · 时序追踪",
        owner_id=owner_id,
        classes=["car"],
    )
    dataset = Dataset(
        display_id=f"D-MI-{uuid.uuid4().hex[:6]}",
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
        display_id=f"T-MI-{uuid.uuid4().hex[:6]}",
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()
    return task, item


class _MultiInstanceAdapter:
    """每窗每帧对每个 instance 各产一条结果。obj0 标 primary (跟随源种子),
    obj1/obj2 为新发现目标。instance_id 跨窗稳定 (模拟阶段 B 的 backend 契约)。"""

    model_key = "sam3_video"

    def __init__(self, extra_ids: list[str]) -> None:
        self.extra_ids = extra_ids

    async def propagate(self, ctx: TrackerContext):
        frames = range(ctx.from_frame, ctx.to_frame + 1)
        for frame_index in frames:
            yield TrackerFrameResult(
                frame_index=frame_index,
                geometry={"type": "bbox", "x": float(frame_index),
                          "y": 0.0, "w": 10.0, "h": 10.0},
                confidence=1.0,
                outside=False,
                instance_id="obj0",
                primary=True,
            )
            for oid in self.extra_ids:
                yield TrackerFrameResult(
                    frame_index=frame_index,
                    geometry={"type": "bbox", "x": float(frame_index) + 100.0,
                              "y": 0.0, "w": 8.0, "h": 8.0},
                    confidence=0.95,
                    outside=False,
                    instance_id=oid,
                    primary=False,
                )


async def test_runner_lands_extra_instances_as_new_tracks(
    db_session, super_admin, monkeypatch
):
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    source = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="car",
        tool_unit_id="bbox",
        geometry={"type": "bbox", "x": 1, "y": 2, "w": 10, "h": 12},
    )
    db_session.add(source)
    await db_session.flush()
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=source.id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="sam3_video",
        direction="forward",
        from_frame=0,
        to_frame=3,
        prompt={"text": "car"},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()

    # 两窗 (0,1) (2,3), 每窗返回 obj0(primary)+obj1+obj2。
    monkeypatch.setattr(settings, "video_tracker_sam3_window_size_frames", 2)
    adapter = _MultiInstanceAdapter(extra_ids=["obj1", "obj2"])
    monkeypatch.setattr(
        "app.services.video_tracker_runner.get_tracker_adapter",
        lambda _model_key: adapter,
    )
    # 无声明 sam3_video 的已启用 backend → get_tracker_backend 返回 None; stub adapter
    # 忽略 ctx.ml_backend, 无需真实 registry。

    async def collect(_channel: str, _payload: dict) -> None:
        return None

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    await db_session.refresh(source)

    assert job.status == "completed"

    # 源 annotation: 主实例 obj0 回填, seed 帧 0 保留 manual, 1..3 prediction。
    assert source.annotation_type == "video_track_bbox"
    src_frames = [kf["frame_index"] for kf in source.geometry["keyframes"]]
    assert src_frames == [0, 1, 2, 3]
    assert source.geometry["keyframes"][0]["source"] == "manual"
    # 主实例几何 x==frame (非 +100 的新目标几何) —— 证明未串到 extras。
    assert source.geometry["keyframes"][3]["bbox"]["x"] == pytest.approx(3.0)

    # 新发现的 obj1/obj2 各落一条 ai_tracker annotation。
    from sqlalchemy import select

    rows = (
        (
            await db_session.execute(
                select(Annotation).where(
                    Annotation.task_id == task.id,
                    Annotation.source == "ai_tracker",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2
    track_ids = {r.track_id for r in rows}
    assert len(track_ids) == 2  # 各自独立 track_id
    for r in rows:
        assert r.class_name == "car"  # 继承 source label
        assert r.tool_unit_id == "bbox"
        assert r.annotation_type == "video_track_bbox"
        assert r.user_id == user.id
        frames = [kf["frame_index"] for kf in r.geometry["keyframes"]]
        assert frames == [0, 1, 2, 3]  # 跨两窗连续
        # 全为预测帧 (新目标无人工 seed)。
        assert all(kf["source"] == "prediction" for kf in r.geometry["keyframes"])
        assert r.geometry["keyframes"][3]["bbox"]["x"] == pytest.approx(103.0)


async def test_runner_single_instance_no_extra_tracks(
    db_session, super_admin, monkeypatch
):
    """单实例 (instance_id 全 None) 不建新 annotation —— 零回归。"""
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    source = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 1, "y": 2, "w": 10, "h": 12},
    )
    db_session.add(source)
    await db_session.flush()
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=source.id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="mock_bbox",
        direction="forward",
        from_frame=0,
        to_frame=2,
        prompt={"type": "bbox", "geometry": source.geometry},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()

    async def collect(_channel: str, _payload: dict) -> None:
        return None

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    assert job.status == "completed"

    from sqlalchemy import select

    extra = (
        (
            await db_session.execute(
                select(Annotation).where(
                    Annotation.task_id == task.id,
                    Annotation.source == "ai_tracker",
                )
            )
        )
        .scalars()
        .all()
    )
    assert extra == []
