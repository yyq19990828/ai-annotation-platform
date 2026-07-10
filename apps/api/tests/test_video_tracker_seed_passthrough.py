"""v0.21.27 · U-pvs-1 · runner 透传 PVS 点/多目标种子 (画布点 → PVS track)。

PVS backend 已支持 `context.seeds[]` (含 points), 缺口在平台侧: runner 需从 job.prompt
读出 seeds 并经 TrackerContext → adapter context 透传。关键契约:
- seeds 只在**种子窗 (首窗, 含原始种子帧)** 下发 —— points 锚在种子帧, 后续窗靠
  source_geometry (上一窗末帧框) 续追, 不重发点种子;
- 无 seeds 时行为与已发 B-pvs 框种子完全一致 (零回归)。
"""

from app.config import settings
from app.db.models.annotation import Annotation
from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus
from app.services.video_tracker_adapters import TrackerContext, TrackerFrameResult
from app.services.video_tracker_runner import run_tracker_job

# 复用多实例测试里的视频 task/dataset 建置, 避免重复 ~40 行 fixture。
from tests.test_video_tracker_multi_instance import _make_video_task


class _CaptureAdapter:
    """逐窗记录 (from_frame, to_frame, seeds), 每帧回一条主实例结果。"""

    model_key = "sam3_video_interactive"

    def __init__(self) -> None:
        self.windows: list[tuple[int, int, object]] = []

    async def propagate(self, ctx: TrackerContext):
        self.windows.append((ctx.from_frame, ctx.to_frame, ctx.seeds))
        for frame_index in range(ctx.from_frame, ctx.to_frame + 1):
            yield TrackerFrameResult(
                frame_index=frame_index,
                geometry={"type": "bbox", "x": float(frame_index),
                          "y": 0.0, "w": 5.0, "h": 5.0},
                confidence=1.0,
                outside=False,
            )


async def _run_with_capture(db_session, super_admin, monkeypatch, *, direction: str):
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
    seeds = [{"obj_id": 1, "points": [[0.5, 0.5, 1]]}]
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=source.id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key="sam3_video_interactive",
        direction=direction,
        from_frame=0,
        to_frame=3,
        prompt={"seeds": seeds},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()

    # 窗口 2 帧 → (0,1)(2,3) 两窗。
    monkeypatch.setattr(settings, "video_tracker_sam3_window_size_frames", 2)
    adapter = _CaptureAdapter()
    monkeypatch.setattr(
        "app.services.video_tracker_runner.get_tracker_adapter",
        lambda _model_key: adapter,
    )

    async def collect(_channel: str, _payload: dict) -> None:
        return None

    await run_tracker_job(db_session, job.id, publisher=collect)
    await db_session.refresh(job)
    assert job.status == "completed"
    return adapter, seeds


async def test_seeds_only_on_seed_window_forward(db_session, super_admin, monkeypatch):
    adapter, seeds = await _run_with_capture(
        db_session, super_admin, monkeypatch, direction="forward"
    )
    # forward: 迭代顺序 (0,1)(2,3); 种子窗 = 首窗 (0,1)。
    assert [(w[0], w[1]) for w in adapter.windows] == [(0, 1), (2, 3)]
    assert adapter.windows[0][2] == seeds  # 种子窗带 points
    assert adapter.windows[1][2] is None  # 后续窗不重发


async def test_seeds_only_on_seed_window_backward(db_session, super_admin, monkeypatch):
    adapter, seeds = await _run_with_capture(
        db_session, super_admin, monkeypatch, direction="backward"
    )
    # backward: 窗口列表反转, 首个迭代窗 = 含种子帧(to_frame=3)的 (2,3)。
    assert [(w[0], w[1]) for w in adapter.windows] == [(2, 3), (0, 1)]
    assert adapter.windows[0][2] == seeds  # 种子窗(含 to_frame)带 points
    assert adapter.windows[1][2] is None


async def test_no_seeds_prompt_passes_none(db_session, super_admin, monkeypatch):
    """prompt 无 seeds → ctx.seeds 全 None (框种子/文本追踪零回归)。"""
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
        model_key="sam3_video_interactive",
        direction="forward",
        from_frame=0,
        to_frame=3,
        prompt={},
        event_channel="video-tracker-job:test",
    )
    db_session.add(job)
    await db_session.commit()

    monkeypatch.setattr(settings, "video_tracker_sam3_window_size_frames", 2)
    adapter = _CaptureAdapter()
    monkeypatch.setattr(
        "app.services.video_tracker_runner.get_tracker_adapter",
        lambda _model_key: adapter,
    )

    async def collect(_channel: str, _payload: dict) -> None:
        return None

    await run_tracker_job(db_session, job.id, publisher=collect)
    assert all(w[2] is None for w in adapter.windows)
