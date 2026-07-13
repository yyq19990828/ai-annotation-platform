from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from scripts.seed_screenshot_assets import (
    GENERATED_REVISION,
    POINTCLOUD_SOURCE_IDS,
    ROAD_SOURCE_IDS,
    VIDEO_SOURCE_ID,
    ensure_screenshot_assets,
)


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

    for index, asset_id in enumerate(POINTCLOUD_SOURCE_IDS):
        path = sources / f"capture-{index}.pcd"
        path.write_text(
            "# .PCD v0.7\nVERSION 0.7\nFIELDS x y z\nSIZE 4 4 4\n"
            "TYPE F F F\nCOUNT 1 1 1\nWIDTH 1\nHEIGHT 1\n"
            f"POINTS 1\nDATA ascii\n{index}.0 0.0 1.0\n",
            encoding="ascii",
        )
        result[asset_id] = path
    return result


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
    assert len(list(first.pointcloud_root.glob("lidar/*.pcd"))) == 4
    assert not first.pointcloud_root.joinpath("camera").exists()
    assert not first.pointcloud_root.joinpath("calib").exists()

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
