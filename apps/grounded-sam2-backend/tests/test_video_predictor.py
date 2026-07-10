"""v0.10.35 §B · SAM2VideoTracker 单测 (无 GPU / 无真实 SAM2 video predictor).

覆盖:
  - 坐标归一化: 归一化 seed bbox → 像素 xyxy; mask 外接框 → 归一化 {x,y,w,h}。
  - outside 判定: 空 mask → outside=True 零框; 非空 → outside=False。
  - 窗内传播: 用 fake predictor (mock init_state/add_new_points_or_box/
    propagate_in_video/reset_state) + monkeypatch 掉 JPEG 解码, 验证源帧号映射 /
    direction / seed 帧锚定 / 结果结构。

不构建真实模型: 用 SAM2VideoTracker.__new__ 绕过 __init__ 的 _load_video_predictor。
"""

from __future__ import annotations

import numpy as np
import pytest
import torch

from video_predictor import SAM2VideoTracker


# ---------- 坐标归一化 (静态方法, 不需实例) ----------


def test_seed_to_pixel_xyxy_basic():
    # 归一化 {x,y,w,h} → 像素 xyxy; 200x100 图。
    box = SAM2VideoTracker._seed_to_pixel_xyxy(
        {"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.4}, w=200, h=100
    )
    assert box == pytest.approx([20.0, 20.0, 120.0, 60.0])


def test_seed_to_pixel_xyxy_accepts_width_height_aliases():
    box = SAM2VideoTracker._seed_to_pixel_xyxy(
        {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}, w=640, h=480
    )
    assert box == pytest.approx([0.0, 0.0, 640.0, 480.0])


def test_mask_to_bbox_norm_nonempty():
    # 100x100, 前景方块 [x 10..19, y 20..29] (含端点)。
    mask = np.zeros((100, 100), dtype=bool)
    mask[20:30, 10:20] = True
    bbox, outside = SAM2VideoTracker._mask_to_bbox_norm(mask, w=100, h=100)
    assert outside is False
    # x1=10, y1=20; 宽高各 10 像素 (含端点 +1)。
    assert bbox["x"] == pytest.approx(0.10)
    assert bbox["y"] == pytest.approx(0.20)
    assert bbox["w"] == pytest.approx(0.10)
    assert bbox["h"] == pytest.approx(0.10)


def test_mask_to_bbox_norm_empty_is_outside():
    mask = np.zeros((50, 50), dtype=bool)
    bbox, outside = SAM2VideoTracker._mask_to_bbox_norm(mask, w=50, h=50)
    assert outside is True
    assert bbox == {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}


def test_mask_to_bbox_norm_clamps_to_unit():
    mask = np.ones((10, 10), dtype=bool)
    bbox, outside = SAM2VideoTracker._mask_to_bbox_norm(mask, w=10, h=10)
    assert outside is False
    # 满帧 mask: x=0, y=0, w=1, h=1 (10/10 clamp 到 1)。
    assert bbox == {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}


def test_first_obj_mask_thresholds_logits_and_takes_first_obj():
    # logits [num_obj=2, 1, H=2, W=2]; 取第 0 个 obj, >0 为前景。
    logits = torch.tensor(
        [
            [[[1.0, -1.0], [-2.0, 3.0]]],
            [[[5.0, 5.0], [5.0, 5.0]]],
        ]
    )
    mask = SAM2VideoTracker._first_obj_mask(logits)
    assert mask.shape == (2, 2)
    assert mask.tolist() == [[True, False], [False, True]]


# ---------- 窗内传播 (fake predictor) ----------


class _FakePropagatePredictor:
    """记录调用 + 按预设 mask 序列 yield (local_frame, obj_ids, masks)。

    frame_score_logits: 可选 {local_idx: object_score_logit}, 模拟 vendor 在 yield 前
    往 inference_state["output_dict_per_obj"] 写的每帧 object score (A1 真实置信度)。
    不给则不写 → _object_score 取不到 → 回退 1.0。
    """

    def __init__(
        self,
        frame_masks: dict[int, np.ndarray],
        frame_score_logits: dict[int, float] | None = None,
    ):
        self._frame_masks = frame_masks
        self._frame_score_logits = frame_score_logits or {}
        self.add_calls: list[dict] = []
        self.reset_called = False

    def init_state(self, video_path=None, **kw):
        return {
            "video_path": video_path,
            "obj_id_to_idx": {1: 0},
            "output_dict_per_obj": {
                0: {"cond_frame_outputs": {}, "non_cond_frame_outputs": {}}
            },
        }

    def add_new_points_or_box(self, *, inference_state, frame_idx, obj_id, box, normalize_coords):
        self.add_calls.append(
            {"frame_idx": frame_idx, "obj_id": obj_id, "box": box, "normalize": normalize_coords}
        )

    def propagate_in_video(self, inference_state, start_frame_idx=None, reverse=False):
        order = sorted(self._frame_masks, reverse=reverse)
        for local_idx in order:
            m = self._frame_masks[local_idx]
            # 模拟 vendor 输出 logits [num_obj=1, 1, H, W]: 前景=+10, 背景=-10。
            logits = torch.from_numpy(np.where(m, 10.0, -10.0)).float()[None, None]
            if local_idx in self._frame_score_logits:
                inference_state["output_dict_per_obj"][0]["non_cond_frame_outputs"][
                    local_idx
                ] = {
                    "object_score_logits": torch.tensor(
                        [[self._frame_score_logits[local_idx]]]
                    )
                }
            yield local_idx, [1], logits

    def reset_state(self, inference_state):
        self.reset_called = True


def _make_tracker(fake_predictor) -> SAM2VideoTracker:
    inst = SAM2VideoTracker.__new__(SAM2VideoTracker)
    inst.sam_variant = "tiny"
    inst.max_window_frames = 300
    inst.device = "cpu"
    inst._predictor = fake_predictor
    inst.active_sessions = 0
    return inst


def test_propagate_forward_maps_local_to_source_frames(monkeypatch):
    # 窗 [10, 12], 3 帧, 100x100。frame 10 有目标, 11 也有, 12 空 (→ outside)。
    fg = np.zeros((100, 100), dtype=bool)
    fg[10:20, 10:20] = True
    frame_masks = {0: fg, 1: fg, 2: np.zeros((100, 100), dtype=bool)}
    fake = _FakePropagatePredictor(frame_masks)
    tracker = _make_tracker(fake)

    # 跳过真实视频解码: 直接报 100x100, 3 帧。
    monkeypatch.setattr(
        SAM2VideoTracker, "_extract_window_jpegs", staticmethod(lambda *a, **k: (100, 100, 3))
    )

    results = tracker.propagate(
        video_path="/tmp/x.mp4",
        from_frame=10,
        to_frame=12,
        direction="forward",
        seed_bbox={"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1},
    )

    # 源帧号 = local + lo(10)。
    assert [r["frame_index"] for r in results] == [10, 11, 12]
    assert results[0]["outside"] is False
    assert results[2]["outside"] is True  # 空 mask 帧
    assert results[2]["geometry"] == {"type": "bbox", "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
    # forward seed 锚在窗首帧 (local 0)。
    assert fake.add_calls[0]["frame_idx"] == 0
    # 会话被清理。
    assert fake.reset_called is True
    assert tracker.active_sessions == 0


def test_propagate_backward_anchors_seed_at_window_end(monkeypatch):
    # 窗 [10, 12] backward: seed 锚在窗末帧 (源帧 12 = local 2)。
    fg = np.ones((10, 10), dtype=bool)
    frame_masks = {0: fg, 1: fg, 2: fg}
    fake = _FakePropagatePredictor(frame_masks)
    tracker = _make_tracker(fake)
    monkeypatch.setattr(
        SAM2VideoTracker, "_extract_window_jpegs", staticmethod(lambda *a, **k: (10, 10, 3))
    )

    results = tracker.propagate(
        video_path="/tmp/x.mp4",
        from_frame=10,
        to_frame=12,
        direction="backward",
        seed_bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
    )

    # backward 结果按帧号降序 (12, 11, 10)。
    assert [r["frame_index"] for r in results] == [12, 11, 10]
    # backward seed 锚在 local 2 (= 源帧 12)。
    assert fake.add_calls[0]["frame_idx"] == 2


def test_propagate_rejects_oversized_window(monkeypatch):
    fake = _FakePropagatePredictor({})
    tracker = _make_tracker(fake)
    tracker.max_window_frames = 5
    with pytest.raises(ValueError, match="exceeds"):
        tracker.propagate(
            video_path="/tmp/x.mp4",
            from_frame=0,
            to_frame=100,
            direction="forward",
            seed_bbox={"x": 0.0, "y": 0.0, "w": 0.1, "h": 0.1},
        )


# ---------- A1 · 真实 object score 作 confidence ----------


def test_object_score_reads_logit_and_sigmoids():
    state = {
        "obj_id_to_idx": {1: 0},
        "output_dict_per_obj": {
            0: {
                "cond_frame_outputs": {},
                # sigmoid(0)=0.5; helper 两个 storage 都查, 传播帧落 non_cond。
                "non_cond_frame_outputs": {
                    5: {"object_score_logits": torch.tensor([[0.0]])}
                },
            }
        },
    }
    assert SAM2VideoTracker._object_score(state, 1, 5) == pytest.approx(0.5)


def test_object_score_missing_structure_returns_none():
    # 内部键缺失 (老 state / 未来 vendor sync 漂移) → None, 不崩。
    assert SAM2VideoTracker._object_score({}, 1, 0) is None
    assert SAM2VideoTracker._object_score({"obj_id_to_idx": {1: 0}}, 1, 0) is None


def test_propagate_uses_object_score_as_confidence(monkeypatch):
    # 两帧非空 mask; frame 0 高分 logit=4.0 (sigmoid≈0.982), frame 1 低分 -3.0 (≈0.047)。
    fg = np.ones((10, 10), dtype=bool)
    fake = _FakePropagatePredictor(
        {0: fg, 1: fg}, frame_score_logits={0: 4.0, 1: -3.0}
    )
    tracker = _make_tracker(fake)
    monkeypatch.setattr(
        SAM2VideoTracker,
        "_extract_window_jpegs",
        staticmethod(lambda *a, **k: (10, 10, 2)),
    )
    results = tracker.propagate(
        video_path="/tmp/x.mp4",
        from_frame=0,
        to_frame=1,
        direction="forward",
        seed_bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
    )
    by_frame = {r["frame_index"]: r for r in results}
    assert by_frame[0]["confidence"] == pytest.approx(0.982, abs=1e-2)
    assert by_frame[1]["confidence"] == pytest.approx(0.047, abs=1e-2)
    # backend 只报真实置信度、不改 outside; 是否 outside 交平台低置信阈值判。
    assert by_frame[0]["outside"] is False
    assert by_frame[1]["outside"] is False


def test_propagate_falls_back_to_one_when_no_object_score(monkeypatch):
    # 未提供分数 → 取不到 object_score → confidence 回退 1.0 (非空 mask)。
    fg = np.ones((10, 10), dtype=bool)
    fake = _FakePropagatePredictor({0: fg})
    tracker = _make_tracker(fake)
    monkeypatch.setattr(
        SAM2VideoTracker,
        "_extract_window_jpegs",
        staticmethod(lambda *a, **k: (10, 10, 1)),
    )
    results = tracker.propagate(
        video_path="/tmp/x.mp4",
        from_frame=0,
        to_frame=0,
        direction="forward",
        seed_bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
    )
    assert results[0]["confidence"] == 1.0
    assert results[0]["outside"] is False
