from __future__ import annotations

import hashlib
import json
import tarfile
from pathlib import Path

import pytest

from scripts import nuscenes_fixture as fixture


def _write_minimal_nuscenes(root: Path) -> None:
    metadata = root / "v1.0-mini"
    metadata.mkdir(parents=True)
    rows = {
        "scene": [
            {
                "token": "scene-token",
                "name": "scene-0061",
                "first_sample_token": "sample-token",
            }
        ],
        "sample": [{"token": "sample-token", "next": ""}],
        "sample_data": [
            {
                "sample_token": "sample-token",
                "calibrated_sensor_token": "calibrated-lidar",
                "filename": "samples/LIDAR_TOP/frame.pcd.bin",
                "is_key_frame": True,
            },
            {
                "sample_token": "sample-token",
                "calibrated_sensor_token": "calibrated-camera",
                "filename": "samples/CAM_FRONT/frame.jpg",
                "is_key_frame": True,
            },
        ],
        "calibrated_sensor": [
            {"token": "calibrated-lidar", "sensor_token": "sensor-lidar"},
            {"token": "calibrated-camera", "sensor_token": "sensor-camera"},
        ],
        "sensor": [
            {"token": "sensor-lidar", "modality": "lidar"},
            {"token": "sensor-camera", "modality": "camera"},
        ],
    }
    for name, table in rows.items():
        (metadata / f"{name}.json").write_text(json.dumps(table), encoding="utf-8")
    lidar = root / "samples/LIDAR_TOP/frame.pcd.bin"
    camera = root / "samples/CAM_FRONT/frame.jpg"
    lidar.parent.mkdir(parents=True)
    camera.parent.mkdir(parents=True)
    lidar.write_bytes(b"lidar")
    camera.write_bytes(b"camera")


def test_download_uses_resumable_parallel_parts(tmp_path, monkeypatch):
    payload = bytes(range(251)) * 17
    digest = hashlib.sha256(payload).hexdigest()
    cache = tmp_path / "cache"
    cache.mkdir()
    legacy = cache / "v1.0-mini.tgz.part"
    first_end = fixture._range_bounds(len(payload), 3)[0][1]
    legacy.write_bytes(payload[: first_end // 2])

    def fake_download_range(*, target, start, end, **_kwargs):
        received = target.stat().st_size if target.exists() else 0
        with target.open("ab") as output:
            output.write(payload[start + received : end + 1])

    monkeypatch.setattr(fixture, "_download_range", fake_download_range)

    archive = fixture.download_nuscenes_mini(
        cache,
        url="https://example.invalid/v1.0-mini.tgz",
        expected_size=len(payload),
        expected_sha256=digest,
        expected_etag=None,
        parts=3,
    )

    assert archive.read_bytes() == payload
    assert not list(cache.glob("*.part*"))


def test_extract_keeps_keyframes_and_skips_sweeps(tmp_path):
    source = tmp_path / "source"
    _write_minimal_nuscenes(source)
    sweep = source / "sweeps/LIDAR_TOP/unused.pcd.bin"
    sweep.parent.mkdir(parents=True)
    sweep.write_bytes(b"unused")
    archive = tmp_path / "mini.tgz"
    with tarfile.open(archive, mode="w:gz") as output:
        for child in source.iterdir():
            output.add(child, arcname=child.name)

    prepared = tmp_path / "cache/content"
    fixture.extract_nuscenes_mini(archive, prepared)

    fixture.validate_nuscenes_mini(prepared)
    assert (prepared / "samples/LIDAR_TOP/frame.pcd.bin").is_file()
    assert not (prepared / "sweeps").exists()


def test_offline_requires_cached_archive_or_content(tmp_path):
    with pytest.raises(fixture.NuScenesFixtureError, match="not cached"):
        fixture.ensure_nuscenes_mini(cache_dir=tmp_path, offline=True)
