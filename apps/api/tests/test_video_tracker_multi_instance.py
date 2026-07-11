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
    accept_tracker_job,
    discard_tracker_job,
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
                geometry={
                    "type": "bbox",
                    "x": float(frame_index),
                    "y": 0.0,
                    "w": 10.0,
                    "h": 10.0,
                },
                confidence=1.0,
                outside=False,
                instance_id="obj0",
                primary=True,
            )
            for oid in self.extra_ids:
                yield TrackerFrameResult(
                    frame_index=frame_index,
                    geometry={
                        "type": "bbox",
                        "x": float(frame_index) + 100.0,
                        "y": 0.0,
                        "w": 8.0,
                        "h": 8.0,
                    },
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

    from sqlalchemy import select

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    await db_session.refresh(source)

    # v0.21.28 · 候选流: 完成 = 暂存待审, committed annotations 未改。
    assert job.status == "pending_review"
    assert job.staged_result and job.staged_result["results"]
    assert source.annotation_type == "bbox"  # 源未回填 (仍原始单帧 bbox)
    pre_extra = (
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
    assert pre_extra == []  # 接受前无新轨迹

    # 接受 → 落库。
    await accept_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    await db_session.refresh(source)
    assert job.status == "accepted"

    # 源 annotation: 主实例 obj0 回填, seed 帧 0 保留 manual, 1..3 prediction。
    assert source.annotation_type == "video_track_bbox"
    src_frames = [kf["frame_index"] for kf in source.geometry["keyframes"]]
    assert src_frames == [0, 1, 2, 3]
    assert source.geometry["keyframes"][0]["source"] == "manual"
    # 主实例几何 x==frame (非 +100 的新目标几何) —— 证明未串到 extras。
    assert source.geometry["keyframes"][3]["bbox"]["x"] == pytest.approx(3.0)

    # 新发现的 obj1/obj2 各落一条 ai_tracker annotation。
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

    from sqlalchemy import select

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    assert job.status == "pending_review"
    await accept_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    assert job.status == "accepted"

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


async def test_runner_discard_leaves_annotation_untouched(
    db_session, super_admin, monkeypatch
):
    """v0.21.28 · 丢弃候选: 源 annotation 零改动, 无新轨迹, staged_result 清空。"""
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

    monkeypatch.setattr(settings, "video_tracker_sam3_window_size_frames", 2)
    adapter = _MultiInstanceAdapter(extra_ids=["obj1"])
    monkeypatch.setattr(
        "app.services.video_tracker_runner.get_tracker_adapter",
        lambda _model_key: adapter,
    )

    async def collect(_channel: str, _payload: dict) -> None:
        return None

    from sqlalchemy import select

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    assert job.status == "pending_review"

    await discard_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    await db_session.refresh(source)

    assert job.status == "discarded"
    assert job.staged_result is None  # 清空
    assert source.annotation_type == "bbox"  # 源零改动
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


# ── v0.21.28 · B-mx · text-multiplex 跨窗 IoU 关联 ─────────────────────


def _mr(
    frame: int, instance_id: str, x: float, *, primary: bool = False
) -> TrackerFrameResult:
    return TrackerFrameResult(
        frame_index=frame,
        geometry={"type": "bbox", "x": x, "y": 0.0, "w": 0.1, "h": 0.1},
        confidence=1.0,
        outside=False,
        instance_id=instance_id,
        primary=primary,
    )


def test_associate_multiplex_window_matches_by_iou_and_births_new():
    from app.services.video_tracker_runner import _associate_multiplex_window

    prev = {
        "1": {"type": "bbox", "x": 0.10, "y": 0.0, "w": 0.1, "h": 0.1},
        "2": {"type": "bbox", "x": 0.50, "y": 0.0, "w": 0.1, "h": 0.1},
    }
    nxt = [3]  # 下一个新全局 id
    win = [
        _mr(2, "a", 0.11),  # 与 global 1 边界高 IoU → 复用 "1"
        _mr(2, "b", 0.51),  # 与 global 2 → "2"
        _mr(2, "c", 0.90),  # 无匹配 → 新 global "3"
    ]
    out = _associate_multiplex_window(win, prev, nxt)
    remap = {r.geometry["x"]: r.instance_id for r in out}
    assert remap[0.11] == "1"
    assert remap[0.51] == "2"
    assert remap[0.90] == "3"
    assert nxt == [4]  # 消耗了一个新全局 id
    assert set(prev) == {"1", "2", "3"}  # prev 更新为本窗末帧几何


class _WindowLocalMultiplexAdapter:
    """模拟 text-multiplex: 窗内 obj_id **局部且跨窗重排**。两个物理目标 left(x≈0.1)/
    right(x≈0.5); window 0: left=id"1"(primary)/right=id"2", window 1: left=id"2"/right=id"1"
    (id 互换)。平台须按边界帧 IoU 关联成 2 条跨窗一致的轨迹 (left→源, right→新 track)。"""

    model_key = "sam3_video"

    async def propagate(self, ctx: TrackerContext):
        first_window = min(ctx.from_frame, ctx.to_frame) == 0
        for f in range(ctx.from_frame, ctx.to_frame + 1):
            left_id = "1" if first_window else "2"
            right_id = "2" if first_window else "1"
            yield TrackerFrameResult(
                frame_index=f,
                geometry={
                    "type": "bbox",
                    "x": 0.10 + 0.005 * f,
                    "y": 0.0,
                    "w": 0.1,
                    "h": 0.1,
                },
                confidence=1.0,
                outside=False,
                instance_id=left_id,
                primary=True,
            )
            yield TrackerFrameResult(
                frame_index=f,
                geometry={
                    "type": "bbox",
                    "x": 0.50 + 0.005 * f,
                    "y": 0.0,
                    "w": 0.1,
                    "h": 0.1,
                },
                confidence=1.0,
                outside=False,
                instance_id=right_id,
                primary=False,
            )


async def test_runner_associates_window_local_ids_across_windows(
    db_session, super_admin, monkeypatch
):
    """窗内 id 跨窗重排时, 平台 IoU 关联把同一物理目标的帧归到一条全局轨迹 (不因 id 互换分裂)。"""
    from app.services.video_tracker_runner import accept_tracker_job

    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    source = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="car",
        tool_unit_id="bbox",
        geometry={"type": "bbox", "x": 0.1, "y": 0.0, "w": 0.1, "h": 0.1},
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

    monkeypatch.setattr(
        settings, "video_tracker_sam3_window_size_frames", 2
    )  # 两窗 (0,1)(2,3)
    adapter = _WindowLocalMultiplexAdapter()
    monkeypatch.setattr(
        "app.services.video_tracker_runner.get_tracker_adapter", lambda _k: adapter
    )

    async def collect(_c: str, _p: dict) -> None:
        return None

    await run_tracker_job(db_session, job.id, publisher=collect)
    await accept_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(source)

    # 源轨迹 (primary=left): 4 帧全为 left 几何 (x≈0.1), 不混入 right (x≈0.5)。
    src_kfs = sorted(source.geometry["keyframes"], key=lambda k: k["frame_index"])
    assert [k["frame_index"] for k in src_kfs] == [0, 1, 2, 3]
    assert all(k["bbox"]["x"] < 0.3 for k in src_kfs if k.get("bbox")), (
        "源轨迹应全是 left 目标, 关联把跨窗 id 互换的 left 帧归回一条"
    )

    # right → 恰 1 条新 ai_tracker 轨迹 (非 2 条: 证明未因 id 互换分裂), 4 帧全 right (x≈0.5)。
    from sqlalchemy import select

    rows = (
        (
            await db_session.execute(
                select(Annotation).where(
                    Annotation.task_id == task.id, Annotation.source == "ai_tracker"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1, f"应恰 1 条 right 轨迹, 实得 {len(rows)}"
    right_kfs = sorted(rows[0].geometry["keyframes"], key=lambda k: k["frame_index"])
    assert [k["frame_index"] for k in right_kfs] == [0, 1, 2, 3]
    assert all(k["bbox"]["x"] > 0.3 for k in right_kfs if k.get("bbox"))
