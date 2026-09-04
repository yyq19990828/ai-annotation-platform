from __future__ import annotations

import json
import shutil
import struct
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from scripts.seed_screenshot_assets import (
    GENERATED_REVISION,
    NUSCENES_CAMERA_SOURCE_IDS,
    NUSCENES_LIDAR_SOURCE_ID,
    ROAD_BOXES,
    ROAD_SOURCE_IDS,
    VIDEO_SOURCE_ID,
    _crop_box,
    ensure_screenshot_assets,
)
from scripts.seed_coco8 import EXTRA_TOOL_BINDINGS
from scripts.seed_video import VIDEO_TOOL_BINDINGS


def test_screenshot_tool_classes_cover_reviewed_recording_anchors():
    assert [item["name"] for item in EXTRA_TOOL_BINDINGS["rotated_bbox"]["classes"]][
        0
    ] == "car"
    assert "car" in {item["name"] for item in EXTRA_TOOL_BINDINGS["region"]["classes"]}
    assert "lane marking" in {
        item["name"] for item in EXTRA_TOOL_BINDINGS["polyline"]["classes"]
    }
    for unit in ("bbox", "region"):
        video_classes = {item["name"] for item in VIDEO_TOOL_BINDINGS[unit]["classes"]}
        assert {"bus", "truck"} <= video_classes


def _source_files(root: Path) -> dict[str, Path]:
    sources = root / "sources"
    sources.mkdir()
    result: dict[str, Path] = {}
    for index, asset_id in enumerate(ROAD_SOURCE_IDS):
        path = sources / f"road-{index}.jpg"
        Image.new("RGB", (640, 480), (50 + index * 40, 120, 180)).save(path)
        result[asset_id] = path

    video = sources / "traffic.webm"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=12:duration=6",
            "-c:v",
            "libvpx",
            "-an",
            str(video),
        ],
        check=True,
        timeout=30,
    )
    result[VIDEO_SOURCE_ID] = video

    lidar = sources / "nuscenes-lidar.pcd.bin"
    lidar.write_bytes(struct.pack("<fffff", 1.0, 2.0, 3.0, 0.5, 0.0))
    result[NUSCENES_LIDAR_SOURCE_ID] = lidar
    for index, (role, asset_id) in enumerate(NUSCENES_CAMERA_SOURCE_IDS.items()):
        path = sources / f"nuscenes-{role}.jpg"
        Image.new("RGB", (16, 9), (20 + index * 30, 60, 100)).save(path)
        result[asset_id] = path
    return result


def test_auckland_primary_crop_boxes_match_reviewed_vehicle_boundaries():
    crop = (576, 0, 5184, 2592)
    actual = [
        (class_id, cropped)
        for class_id, box in ROAD_BOXES["auckland-traffic-1"]
        if (cropped := _crop_box(box, crop=crop, source_size=(5184, 3456))) is not None
    ]

    expected = [
        (2, (0.0, 0.812, 0.110125, 1.0)),
        (2, (0.27775, 0.82, 0.4375, 1.0)),
        (2, (0.537625, 0.654667, 0.67375, 0.841333)),
        (7, (0.726625, 0.304, 0.877375, 0.569333)),
        (7, (0.294625, 0.609333, 0.4285, 0.842667)),
        (7, (0.049375, 0.502667, 0.155125, 0.666667)),
    ]
    assert [class_id for class_id, _ in actual] == [
        class_id for class_id, _ in expected
    ]
    for (_, actual_box), (_, expected_box) in zip(actual, expected, strict=True):
        assert actual_box == pytest.approx(expected_box, abs=1e-6)


def test_prepared_screenshot_assets_are_complete_deterministic_and_self_healing(
    tmp_path: Path,
):
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        pytest.skip("ffmpeg and ffprobe are required")

    source_files = _source_files(tmp_path)
    first = ensure_screenshot_assets(
        source_files=source_files,
        cache_dir=tmp_path,
    )
    destination = tmp_path / "prepared" / GENERATED_REVISION

    assert first.source == "prepared"
    assert len(first.content_sha256) == 64
    assert len(list(first.image_root.glob("images/*/*.jpg"))) == 8
    assert len(list(first.image_root.glob("labels/*/*.txt"))) == 8
    assert len(list(first.multicamera_pointcloud_root.glob("lidar/*.pcd"))) == 1
    assert len(list(first.multicamera_pointcloud_root.glob("camera/*/*.jpg"))) == 6
    calibrations = sorted(first.multicamera_pointcloud_root.glob("calib/camera/*.json"))
    assert len(calibrations) == 6
    assert all(
        len(json.loads(path.read_text())["extrinsic"]) == 16 for path in calibrations
    )

    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height,avg_frame_rate,nb_frames,duration",
            "-of",
            "json",
            str(first.video_path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    assert stream == {
        "codec_name": "h264",
        "width": 960,
        "height": 540,
        "avg_frame_rate": "12/1",
        "duration": "6.000000",
        "nb_frames": "72",
    }

    first.image_root.joinpath("images/train/screenshot_01.jpg").write_bytes(b"corrupt")
    repaired = ensure_screenshot_assets(
        source_files=source_files,
        cache_dir=tmp_path,
    )

    assert repaired.source == "prepared"
    assert repaired.content_sha256 == first.content_sha256
    assert destination.joinpath(".complete.json").is_file()
    assert not any(
        path.name.startswith(f".{GENERATED_REVISION}-") for path in tmp_path.rglob("*")
    )
