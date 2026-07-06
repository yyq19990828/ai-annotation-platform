"""v0.21.7 · 逐帧批量预标注 fan-out 的段规划纯函数覆盖 (不碰 IO/Celery)。"""

from app.workers.frame_preannotate import (
    chunk_frames,
    plan_frame_indices,
    plan_segments,
)


class TestPlanFrameIndices:
    def test_full_span(self):
        assert plan_frame_indices(5, max_frames=100) == [0, 1, 2, 3, 4]

    def test_max_frames_truncates(self):
        assert plan_frame_indices(1000, max_frames=3) == [0, 1, 2]

    def test_step_sampling(self):
        # 采样降级: step=2 → [0,2,4,6,8]。
        assert plan_frame_indices(10, max_frames=100, step=2) == [0, 2, 4, 6, 8]

    def test_step_then_cap_counts_selected_frames(self):
        # 上限截的是**已选帧数**, 不是原始帧号。
        assert plan_frame_indices(100, max_frames=3, step=5) == [0, 5, 10]

    def test_empty_video(self):
        assert plan_frame_indices(0, max_frames=100) == []

    def test_step_floor_one(self):
        assert plan_frame_indices(3, max_frames=100, step=0) == [0, 1, 2]


class TestChunkFrames:
    def test_even_chunks(self):
        assert chunk_frames([0, 1, 2, 3], 2) == [[0, 1], [2, 3]]

    def test_ragged_tail(self):
        assert chunk_frames([0, 1, 2, 3, 4], 2) == [[0, 1], [2, 3], [4]]

    def test_empty(self):
        assert chunk_frames([], 2) == []

    def test_chunk_size_floor_one(self):
        assert chunk_frames([0, 1], 0) == [[0], [1]]


class TestPlanSegments:
    def test_multi_task_segments_and_total(self):
        # t1: 4 帧但 cap=3 → [0,1,2] → chunk 2 → [[0,1],[2]]; t2: 2 帧 → [[0,1]]。总 5。
        segments, total = plan_segments(
            [("t1", 4), ("t2", 2)], max_frames=3, chunk_size=2
        )
        assert total == 5
        assert segments == [
            {"task_id": "t1", "frame_indices": [0, 1]},
            {"task_id": "t1", "frame_indices": [2]},
            {"task_id": "t2", "frame_indices": [0, 1]},
        ]

    def test_segments_never_cross_task(self):
        # 每段属单一 task (一次视频下载); 不跨 task 合并。
        segments, _ = plan_segments([("a", 3), ("b", 3)], max_frames=100, chunk_size=10)
        assert all(len({s["task_id"]}) == 1 for s in segments)
        assert {s["task_id"] for s in segments} == {"a", "b"}

    def test_zero_frame_tasks_skipped(self):
        segments, total = plan_segments(
            [("a", 0), ("b", 2)], max_frames=100, chunk_size=10
        )
        assert total == 2
        assert [s["task_id"] for s in segments] == ["b"]

    def test_all_empty(self):
        segments, total = plan_segments([("a", 0)], max_frames=100, chunk_size=10)
        assert segments == []
        assert total == 0
