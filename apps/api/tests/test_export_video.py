"""v0.10.31 · Phase 4 视频导出纯函数单测（无 DB）。

覆盖采样网格映射（D2 重编号）+ MOT/KITTI 文本生成 + outside 省略。
"""

from __future__ import annotations

from app.services.export_video import (
    build_kitti_labels,
    build_mot_gt,
    build_mot_seqinfo,
    effective_fps,
    source_to_grid,
    track_grid_rows,
)


def _track(track_id: str, keyframes: list[tuple[int, float, float, float, float]], outside=None) -> dict:
    return {
        "type": "video_track",
        "track_id": track_id,
        "keyframes": [
            {"frame_index": f, "bbox": {"x": x, "y": y, "w": w, "h": h}, "source": "manual"}
            for (f, x, y, w, h) in keyframes
        ],
        "outside": outside or [],
    }


def test_effective_fps_divides_by_step():
    assert effective_fps(60, 6) == 10.0
    assert effective_fps(30, 1) == 30.0
    assert effective_fps(None, 6) is None


def test_source_to_grid_renumbers_on_grid():
    # frame_count=13, step=6 → 网格源帧 [0,6,12] → 序号 {0:0,6:1,12:2}
    assert source_to_grid(13, 6) == {0: 0, 6: 1, 12: 2}


def test_track_grid_rows_only_keeps_grid_frames():
    # step=6: 源帧 0/6/12 在网格上, 中间插值帧被丢弃。
    geom = _track("a", [(0, 0.0, 0.0, 0.5, 0.5), (12, 0.0, 0.0, 0.5, 0.5)])
    rows = track_grid_rows(geom, frame_count=13, step=6, img_w=1000, img_h=1000)
    assert [r["grid_index"] for r in rows] == [0, 1, 2]
    # 0..1 区间整段 bbox 不变 → 像素 left/top=0, w/h=500。
    assert rows[0]["left"] == 0 and rows[0]["w"] == 500.0


def test_outside_frames_dropped():
    geom = _track(
        "a",
        [(0, 0.0, 0.0, 0.5, 0.5), (12, 0.0, 0.0, 0.5, 0.5)],
        outside=[{"from": 6, "to": 6, "source": "manual"}],
    )
    rows = track_grid_rows(geom, frame_count=13, step=6, img_w=1000, img_h=1000)
    # 网格帧 6 落在 outside → 省略, 只剩 0 和 12 (grid 0,2)。
    assert [r["grid_index"] for r in rows] == [0, 2]


def test_mot_gt_format_and_1based_frame():
    geom = _track("a", [(0, 0.1, 0.2, 0.3, 0.4)])
    out = build_mot_gt(
        [(1, "car", geom)], frame_count=1, step=1, img_w=1000, img_h=1000
    )
    # frame 1-based, id=1, bbox px = 100,200,300,400, conf=1, x/y/z=-1
    assert out == "1,1,100.0,200.0,300.0,400.0,1,-1,-1,-1"


def test_mot_seqinfo_framerate_uses_sampled_fps():
    info = build_mot_seqinfo(
        "seq01", source_fps=60, step=6, frame_count=13, img_w=1920, img_h=1080
    )
    assert "frameRate=10" in info
    assert "seqLength=3" in info  # 网格帧 [0,6,12]
    assert "imWidth=1920" in info


def test_kitti_labels_0based_frame_and_occluded():
    geom = _track("a", [(0, 0.0, 0.0, 0.5, 0.5)])
    geom["keyframes"][0]["occluded"] = True
    out = build_kitti_labels(
        [(2, "Pedestrian", geom)], frame_count=1, step=1, img_w=1000, img_h=1000
    )
    parts = out.split(" ")
    assert parts[0] == "0"  # frame 0-based
    assert parts[1] == "2"  # track id
    assert parts[2] == "Pedestrian"
    assert parts[4] == "1"  # occluded
