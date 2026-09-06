"""Prepare deterministic screenshot media from verified real-world source assets."""

from __future__ import annotations

import hashlib
import json
import shutil
import struct
import subprocess
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

try:
    from seed_assets import SeedAssetError, default_cache_dir
except ModuleNotFoundError:  # package import from tests
    from scripts.seed_assets import SeedAssetError, default_cache_dir


GENERATED_REVISION = "screenshots-real-v6"
ROAD_SOURCE_IDS = ("auckland-traffic-1", "auckland-traffic-2")
VIDEO_SOURCE_ID = "street-traffic-video"
NUSCENES_LIDAR_SOURCE_ID = "nuscenes-demo-lidar"
NUSCENES_CAMERA_SOURCE_IDS = {
    role: f"nuscenes-demo-cam-{role.replace('_', '-')}"
    for role in (
        "front",
        "front_left",
        "front_right",
        "back",
        "back_left",
        "back_right",
    )
}
REQUIRED_SOURCE_IDS = frozenset(
    (
        *ROAD_SOURCE_IDS,
        VIDEO_SOURCE_ID,
        NUSCENES_LIDAR_SOURCE_ID,
        *NUSCENES_CAMERA_SOURCE_IDS.values(),
    )
)
PREPARED_PROVENANCE = {
    "media_status": "deterministic derivatives of verified network sources",
    "image": "CC0-1.0 Auckland traffic photographs by Kiwiev",
    "video": "Street traffic by Editor / Wikimedia Commons, CC BY 3.0",
    "multicamera_pointcloud": (
        "nuScenes / Motional, CC BY-NC-SA 4.0; version-pinned MMDetection3D "
        "six-camera demo sample"
    ),
}

NUSCENES_CAMERA_CALIBRATIONS = {
    "front": {
        "intrinsic": [
            1266.417203,
            0.0,
            816.26702,
            0.0,
            1266.417203,
            491.507066,
            0.0,
            0.0,
            1.0,
        ],
        "extrinsic": [
            0.999970257,
            0.003407371,
            0.006920742,
            0.01687305,
            0.006852706,
            0.019589633,
            -0.999784648,
            -0.329023898,
            -0.003542212,
            0.999802291,
            0.019565701,
            -0.429222167,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
    },
    "front_right": {
        "intrinsic": [
            1260.847445,
            0.0,
            807.968245,
            0.0,
            1260.847445,
            495.334427,
            0.0,
            0.0,
            1.0,
        ],
        "extrinsic": [
            0.551579893,
            -0.833698571,
            -0.026575837,
            0.017367525,
            -0.010314991,
            0.025040882,
            -0.999633193,
            -0.338128597,
            0.834058285,
            0.551651716,
            0.005212454,
            -0.607800305,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
    },
    "front_left": {
        "intrinsic": [
            1272.597947,
            0.0,
            826.615493,
            0.0,
            1272.597947,
            479.751654,
            0.0,
            0.0,
            1.0,
        ],
        "extrinsic": [
            0.572994888,
            0.819259405,
            0.022154681,
            0.13672702,
            0.002771718,
            0.02509515,
            -0.999681234,
            -0.33502394,
            -0.819554269,
            0.572873652,
            0.012108637,
            -0.510656774,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
    },
    "back": {
        "intrinsic": [
            809.220991,
            0.0,
            829.2196,
            0.0,
            809.220991,
            481.778424,
            0.0,
            0.0,
            1.0,
        ],
        "extrinsic": [
            -0.99993968,
            0.004745349,
            -0.009902727,
            -0.002994915,
            0.009939326,
            0.007752243,
            -0.999920547,
            -0.278743476,
            -0.004668204,
            -0.999958694,
            -0.007798941,
            -1.007525444,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
    },
    "back_left": {
        "intrinsic": [
            1256.741481,
            0.0,
            792.112574,
            0.0,
            1256.741481,
            492.775747,
            0.0,
            0.0,
            1.0,
        ],
        "extrinsic": [
            -0.317058236,
            0.948079765,
            0.024875984,
            -0.23617664,
            0.019898654,
            0.032873437,
            -0.999261439,
            -0.243239075,
            -0.948197305,
            -0.316329062,
            -0.029288304,
            -0.435816288,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
    },
    "back_right": {
        "intrinsic": [
            1259.513741,
            0.0,
            807.252905,
            0.0,
            1259.513741,
            501.195799,
            0.0,
            0.0,
            1.0,
        ],
        "extrinsic": [
            -0.35698536,
            -0.933410883,
            -0.036132425,
            0.059676871,
            -0.005249687,
            0.040685266,
            -0.999158204,
            -0.271826267,
            0.934095204,
            -0.356495172,
            -0.019424159,
            -0.492889315,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
    },
}

# Boxes use normalized coordinates in each original photograph. Only boxes whose
# centres fall inside a crop are exported, so every derived image has truthful labels.
ROAD_BOXES = {
    "auckland-traffic-1": (
        (2, (0.085, 0.609, 0.209, 0.757)),
        (2, (0.358, 0.615, 0.500, 0.805)),
        (2, (0.589, 0.491, 0.710, 0.631)),
        (2, (0.750, 0.770, 0.947, 0.988)),
        (7, (0.757, 0.228, 0.891, 0.427)),
        (7, (0.373, 0.457, 0.492, 0.632)),
        (7, (0.155, 0.377, 0.249, 0.500)),
    ),
    "auckland-traffic-2": (
        (5, (0.520, 0.270, 0.675, 0.520)),
        (2, (0.770, 0.490, 0.925, 0.720)),
        (2, (0.635, 0.545, 0.765, 0.775)),
        (2, (0.465, 0.650, 0.585, 0.865)),
        (2, (0.220, 0.630, 0.345, 0.835)),
        (2, (0.535, 0.800, 0.705, 0.995)),
    ),
}
CROP_CORNERS = ((0, 0), (1, 0), (0, 1), (1, 1))


@dataclass(frozen=True)
class GeneratedScreenshotAssets:
    revision: str
    content_sha256: str
    image_root: Path
    video_path: Path
    multicamera_pointcloud_root: Path
    source: str


def _required_files(root: Path) -> tuple[Path, ...]:
    return (
        root / "image/images/train/screenshot_01.jpg",
        root / "image/images/val/screenshot_08.jpg",
        root / "image/labels/train/screenshot_01.txt",
        root / "image/labels/val/screenshot_08.txt",
        root / "video/tracking_scene.mp4",
        root / "multicamera-pointcloud/lidar/000000.pcd",
        *(
            root / f"multicamera-pointcloud/camera/{role}/000000.jpg"
            for role in NUSCENES_CAMERA_SOURCE_IDS
        ),
        *(
            root / f"multicamera-pointcloud/calib/camera/{role}.json"
            for role in NUSCENES_CAMERA_SOURCE_IDS
        ),
    )


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_digest(source_files: Mapping[str, Path]) -> str:
    missing_ids = sorted(REQUIRED_SOURCE_IDS - source_files.keys())
    if missing_ids:
        raise SeedAssetError(
            "screenshot source assets are missing: " + ", ".join(missing_ids)
        )
    digest = hashlib.sha256()
    for asset_id in sorted(REQUIRED_SOURCE_IDS):
        path = source_files[asset_id]
        if not path.is_file():
            raise SeedAssetError(f"screenshot source file is missing: {path}")
        digest.update(asset_id.encode("utf-8"))
        digest.update(b"\0")
        digest.update(_file_digest(path).encode("ascii"))
    return digest.hexdigest()


def _content_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.name != ".complete.json"
    ):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def _validate(root: Path, *, source_sha256: str) -> GeneratedScreenshotAssets:
    marker = root / ".complete.json"
    if not marker.is_file():
        raise SeedAssetError("prepared screenshot asset marker is missing")
    try:
        metadata = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SeedAssetError("prepared screenshot asset marker is invalid") from exc
    if metadata.get("revision") != GENERATED_REVISION:
        raise SeedAssetError("prepared screenshot asset revision is stale")
    if metadata.get("source_sha256") != source_sha256:
        raise SeedAssetError("prepared screenshot source digest is stale")
    content_sha256 = metadata.get("content_sha256")
    if not isinstance(content_sha256, str) or len(content_sha256) != 64:
        raise SeedAssetError("prepared screenshot content digest is missing")
    missing = [
        path.relative_to(root) for path in _required_files(root) if not path.is_file()
    ]
    if missing:
        raise SeedAssetError(f"prepared screenshot assets are incomplete: {missing}")
    if _content_digest(root) != content_sha256:
        raise SeedAssetError("prepared screenshot content digest does not match")
    return GeneratedScreenshotAssets(
        revision=GENERATED_REVISION,
        content_sha256=content_sha256,
        image_root=root / "image",
        video_path=root / "video/tracking_scene.mp4",
        multicamera_pointcloud_root=root / "multicamera-pointcloud",
        source="cache",
    )


def _yolo_line(class_id: int, box: tuple[float, float, float, float]) -> str:
    left, top, right, bottom = box
    return (
        f"{class_id} {(left + right) / 2:.6f} {(top + bottom) / 2:.6f} "
        f"{right - left:.6f} {bottom - top:.6f}"
    )


def _crop_box(
    box: tuple[float, float, float, float],
    *,
    crop: tuple[int, int, int, int],
    source_size: tuple[int, int],
) -> tuple[float, float, float, float] | None:
    width, height = source_size
    crop_left, crop_top, crop_right, crop_bottom = crop
    left, top, right, bottom = (
        box[0] * width,
        box[1] * height,
        box[2] * width,
        box[3] * height,
    )
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    if not (
        crop_left <= center_x <= crop_right and crop_top <= center_y <= crop_bottom
    ):
        return None
    crop_width = crop_right - crop_left
    crop_height = crop_bottom - crop_top
    result = (
        max(left, crop_left) - crop_left,
        max(top, crop_top) - crop_top,
        min(right, crop_right) - crop_left,
        min(bottom, crop_bottom) - crop_top,
    )
    normalized = (
        result[0] / crop_width,
        result[1] / crop_height,
        result[2] / crop_width,
        result[3] / crop_height,
    )
    if normalized[2] - normalized[0] < 0.01 or normalized[3] - normalized[1] < 0.01:
        return None
    return normalized


def _prepare_images(root: Path, source_files: Mapping[str, Path]) -> None:
    output_size = (1280, 720)
    output_index = 0
    for source_id in ROAD_SOURCE_IDS:
        with Image.open(source_files[source_id]) as opened:
            source = opened.convert("RGB")
        width, height = source.size
        crop_width = width * 8 // 9
        crop_height = crop_width * 9 // 16
        for horizontal, vertical in CROP_CORNERS:
            crop_left = horizontal * (width - crop_width)
            crop_top = vertical * (height - crop_height)
            crop = (
                crop_left,
                crop_top,
                crop_left + crop_width,
                crop_top + crop_height,
            )
            prepared = source.crop(crop).resize(output_size, Image.Resampling.LANCZOS)
            split = "train" if output_index < 4 else "val"
            stem = f"screenshot_{output_index + 1:02d}"
            image_path = root / "images" / split / f"{stem}.jpg"
            label_path = root / "labels" / split / f"{stem}.txt"
            image_path.parent.mkdir(parents=True, exist_ok=True)
            label_path.parent.mkdir(parents=True, exist_ok=True)
            prepared.save(
                image_path,
                format="JPEG",
                quality=92,
                subsampling=0,
                optimize=False,
                progressive=False,
            )
            labels = []
            for class_id, source_box in ROAD_BOXES[source_id]:
                box = _crop_box(source_box, crop=crop, source_size=source.size)
                if box is not None:
                    labels.append(_yolo_line(class_id, box))
            label_path.write_text("\n".join(labels) + "\n", encoding="utf-8")
            output_index += 1


def _prepare_video(root: Path, source: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise SeedAssetError("ffmpeg is required to prepare screenshot video media")
    root.mkdir(parents=True, exist_ok=True)
    output = root / "tracking_scene.mp4"
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-map_metadata",
        "-1",
        "-an",
        "-vf",
        "fps=12,scale=960:540:flags=lanczos",
        "-frames:v",
        "72",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "1",
        "-fflags",
        "+bitexact",
        "-flags:v",
        "+bitexact",
        "-movflags",
        "+faststart",
        str(output),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        detail = getattr(exc, "stderr", None) or str(exc)
        raise SeedAssetError(f"cannot prepare screenshot video: {detail}") from exc


def _nuscenes_lidar_pcd(source: Path) -> bytes:
    payload = source.read_bytes()
    stride = 5 * 4
    if not payload or len(payload) % stride:
        raise SeedAssetError(f"nuScenes lidar sample has an invalid size: {source}")
    point_count = len(payload) // stride
    header = (
        "# .PCD v0.7 - Point Cloud Data file format\n"
        "VERSION 0.7\n"
        "FIELDS x y z\n"
        "SIZE 4 4 4\n"
        "TYPE F F F\n"
        "COUNT 1 1 1\n"
        f"WIDTH {point_count}\n"
        "HEIGHT 1\n"
        "VIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {point_count}\n"
        "DATA binary\n"
    ).encode("ascii")
    body = bytearray(point_count * 12)
    for index in range(point_count):
        x, y, z = struct.unpack_from("<fff", payload, index * stride)
        struct.pack_into("<fff", body, index * 12, x, y, z)
    return header + body


def _prepare_nuscenes_multicamera(
    root: Path,
    source_files: Mapping[str, Path],
) -> None:
    lidar_path = root / "lidar/000000.pcd"
    lidar_path.parent.mkdir(parents=True, exist_ok=True)
    lidar_path.write_bytes(_nuscenes_lidar_pcd(source_files[NUSCENES_LIDAR_SOURCE_ID]))
    for role, source_id in NUSCENES_CAMERA_SOURCE_IDS.items():
        image_path = root / f"camera/{role}/000000.jpg"
        image_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_files[source_id], image_path)
        calibration_path = root / f"calib/camera/{role}.json"
        calibration_path.parent.mkdir(parents=True, exist_ok=True)
        calibration_path.write_text(
            json.dumps(NUSCENES_CAMERA_CALIBRATIONS[role], indent=2, sort_keys=True)
            + "\n",
            encoding="utf-8",
        )


def ensure_screenshot_assets(
    *,
    source_files: Mapping[str, Path],
    cache_dir: Path | None = None,
    force: bool = False,
) -> GeneratedScreenshotAssets:
    source_sha256 = _source_digest(source_files)
    cache = cache_dir or default_cache_dir()
    destination = cache / "prepared" / GENERATED_REVISION
    if not force:
        try:
            return _validate(destination, source_sha256=source_sha256)
        except SeedAssetError:
            pass

    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=f".{GENERATED_REVISION}-", dir=destination.parent)
    )
    try:
        _prepare_images(staging / "image", source_files)
        _prepare_video(staging / "video", source_files[VIDEO_SOURCE_ID])
        _prepare_nuscenes_multicamera(staging / "multicamera-pointcloud", source_files)
        content_sha256 = _content_digest(staging)
        (staging / ".complete.json").write_text(
            json.dumps(
                {
                    "revision": GENERATED_REVISION,
                    "source_sha256": source_sha256,
                    "content_sha256": content_sha256,
                    "provenance": PREPARED_PROVENANCE,
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        _validate(staging, source_sha256=source_sha256)
        if destination.exists():
            shutil.rmtree(destination)
        staging.replace(destination)
        resolved = _validate(destination, source_sha256=source_sha256)
        return GeneratedScreenshotAssets(
            revision=resolved.revision,
            content_sha256=resolved.content_sha256,
            image_root=resolved.image_root,
            video_path=resolved.video_path,
            multicamera_pointcloud_root=resolved.multicamera_pointcloud_root,
            source="prepared",
        )
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
