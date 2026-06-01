"""v0.10.31 · Phase 4 视频导出纯函数单测（无 DB）。

覆盖采样网格映射（D2 重编号）+ MOT/KITTI 文本生成 + outside 省略。
"""

from __future__ import annotations

from app.services.export_video import (
    build_yolo_frame_det_labels,
    build_kitti_labels,
    build_mot_gt,
    build_mot_seqinfo,
    effective_fps,
    source_to_grid,
    track_grid_rows,
)


def _track(
    track_id: str, keyframes: list[tuple[int, float, float, float, float]], outside=None
) -> dict:
    return {
        "type": "video_track_bbox",
        "track_id": track_id,
        "keyframes": [
            {
                "frame_index": f,
                "bbox": {"x": x, "y": y, "w": w, "h": h},
                "source": "manual",
            }
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


def test_yolo_frame_det_labels_merge_bbox_and_track_on_grid():
    track = _track(
        "a",
        [(0, 0.0, 0.0, 0.2, 0.2), (12, 0.6, 0.6, 0.2, 0.2)],
        outside=[{"from": 6, "to": 6, "source": "manual"}],
    )
    labels = build_yolo_frame_det_labels(
        tracks=[("car", track, {"track_attr": True})],
        bboxes=[
            (
                "person",
                {
                    "type": "video_bbox",
                    "frame_index": 6,
                    "x": 0.2,
                    "y": 0.2,
                    "w": 0.2,
                    "h": 0.4,
                },
                {"bbox_attr": True},
            )
        ],
        cat_map={"car": 0, "person": 1},
        frame_count=13,
        step=6,
        frame_start_number=1,
        include_attributes=True,
    )

    assert sorted(labels.keys()) == [1, 2, 3]
    assert labels[1][0] == ["0 0.100000 0.100000 0.200000 0.200000"]
    # Track frame 6 is outside, while video_bbox on the same grid frame remains.
    assert labels[2][0] == ["1 0.300000 0.400000 0.200000 0.400000"]
    assert labels[2][1] == [{"bbox_attr": True}]
    assert labels[3][0] == ["0 0.700000 0.700000 0.200000 0.200000"]


def test_yolo_frame_det_skips_off_grid_bboxes_and_keeps_empty_labels():
    labels = build_yolo_frame_det_labels(
        tracks=[],
        bboxes=[
            (
                "person",
                {
                    "type": "video_bbox",
                    "frame_index": 3,
                    "x": 0.2,
                    "y": 0.2,
                    "w": 0.2,
                    "h": 0.4,
                },
                {},
            ),
            (
                "person",
                {
                    "type": "video_bbox",
                    "frame_index": 4,
                    "x": 0.8,
                    "y": 0.8,
                    "w": 0.1,
                    "h": 0.1,
                },
                {},
            ),
        ],
        cat_map={"person": 0},
        frame_count=7,
        step=3,
        frame_start_number=1,
        include_attributes=False,
    )

    assert sorted(labels.keys()) == [1, 2, 3]
    assert labels[1][0] == []
    assert labels[2][0] == ["0 0.300000 0.400000 0.200000 0.400000"]
    assert labels[3][0] == []
