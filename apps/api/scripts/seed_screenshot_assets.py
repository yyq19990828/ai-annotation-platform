"""Prepare deterministic screenshot media from verified real-world source assets."""

from __future__ import annotations

import hashlib
import json
import math
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


GENERATED_REVISION = "screenshots-real-v5"
ROAD_SOURCE_IDS = ("auckland-traffic-1", "auckland-traffic-2")
VIDEO_SOURCE_ID = "street-traffic-video"
POINTCLOUD_SOURCE_IDS = tuple(f"pcl-pairwise-capture-{index}" for index in range(1, 5))
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
        *POINTCLOUD_SOURCE_IDS,
        NUSCENES_LIDAR_SOURCE_ID,
        *NUSCENES_CAMERA_SOURCE_IDS.values(),
    )
)
PREPARED_PROVENANCE = {
    "media_status": "deterministic derivatives of verified network sources",
    "image": "CC0-1.0 Auckland traffic photographs by Kiwiev",
    "video": "Street traffic by Editor / Wikimedia Commons, CC BY 3.0",
    "pointcloud": (
        "Point Cloud Library data repository, BSD-3-Clause; camera frames are "
        "deterministic depth renders from the organized XYZ pixels"
    ),
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
    pointcloud_root: Path
    multicamera_pointcloud_root: Path
    source: str


@dataclass(frozen=True)
class OrganizedPointCloud:
    width: int
    height: int
    points: tuple[tuple[float, float, float], ...]


def _required_files(root: Path) -> tuple[Path, ...]:
    return (
        root / "image/images/train/screenshot_01.jpg",
        root / "image/images/val/screenshot_08.jpg",
        root / "image/labels/train/screenshot_01.txt",
        root / "image/labels/val/screenshot_08.txt",
        root / "video/tracking_scene.mp4",
        *(root / f"pointcloud/lidar/{index:06d}.pcd" for index in range(4)),
        *(root / f"pointcloud/camera/front/{index:06d}.jpg" for index in range(4)),
        root / "pointcloud/calib/camera/front.json",
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
        pointcloud_root=root / "pointcloud",
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


def _lzf_decompress(payload: bytes, expected_size: int) -> bytes:
    output = bytearray()
    cursor = 0
    while cursor < len(payload):
        control = payload[cursor]
        cursor += 1
        if control < 32:
            length = control + 1
            output.extend(payload[cursor : cursor + length])
            cursor += length
            continue
        length = control >> 5
        reference = len(output) - ((control & 0x1F) << 8) - 1
        if length == 7:
            length += payload[cursor]
            cursor += 1
        reference -= payload[cursor]
        cursor += 1
        length += 2
        if reference < 0:
            raise SeedAssetError("invalid LZF back-reference in screenshot PCD")
        for _ in range(length):
            output.append(output[reference])
            reference += 1
    if len(output) != expected_size:
        raise SeedAssetError(
            "screenshot PCD decompressed size mismatch: "
            f"expected {expected_size}, got {len(output)}"
        )
    return bytes(output)


def _read_organized_xyz_pcd(source: Path) -> OrganizedPointCloud:
    payload = source.read_bytes()
    data_offset = payload.find(b"DATA ")
    if data_offset < 0:
        raise SeedAssetError(f"screenshot PCD has no DATA header: {source}")
    header_end = payload.find(b"\n", data_offset)
    if header_end < 0:
        raise SeedAssetError(f"screenshot PCD header is incomplete: {source}")
    try:
        header_lines = payload[:header_end].decode("ascii").splitlines()
    except UnicodeDecodeError as exc:
        raise SeedAssetError(f"screenshot PCD header is not ASCII: {source}") from exc
    header = {
        parts[0]: parts[1:]
        for line in header_lines
        if (parts := line.strip().split()) and not parts[0].startswith("#")
    }
    if (
        header.get("FIELDS") != ["x", "y", "z"]
        or header.get("SIZE") != ["4", "4", "4"]
        or header.get("TYPE") != ["F", "F", "F"]
        or header.get("COUNT", ["1", "1", "1"]) != ["1", "1", "1"]
    ):
        raise SeedAssetError(f"unsupported screenshot PCD schema: {source}")
    try:
        point_count = int(header["POINTS"][0])
        width = int(header["WIDTH"][0])
        height = int(header["HEIGHT"][0])
    except (KeyError, IndexError, ValueError) as exc:
        raise SeedAssetError(
            f"screenshot PCD dimensions are invalid: {source}"
        ) from exc
    if width <= 0 or height <= 0 or width * height != point_count:
        raise SeedAssetError(
            f"screenshot PCD is not an organized point cloud: {source}"
        )

    data_kind = header["DATA"][0]
    body = payload[header_end + 1 :]
    points: list[tuple[float, float, float]] = []
    if data_kind == "ascii":
        try:
            rows = body.decode("ascii").splitlines()
            points = [
                tuple(float(value) for value in row.split()) for row in rows if row
            ]
        except (UnicodeDecodeError, ValueError) as exc:
            raise SeedAssetError(f"screenshot ASCII PCD is invalid: {source}") from exc
    elif data_kind == "binary":
        if len(body) != point_count * 12:
            raise SeedAssetError(f"screenshot binary PCD size is invalid: {source}")
        points = [
            struct.unpack_from("<fff", body, index * 12) for index in range(point_count)
        ]
    elif data_kind == "binary_compressed":
        if len(body) < 8:
            raise SeedAssetError(f"screenshot compressed PCD is truncated: {source}")
        compressed_size, uncompressed_size = struct.unpack_from("<II", body)
        compressed = body[8 : 8 + compressed_size]
        if len(compressed) != compressed_size or uncompressed_size != point_count * 12:
            raise SeedAssetError(f"screenshot compressed PCD size is invalid: {source}")
        unpacked = _lzf_decompress(compressed, uncompressed_size)
        points = [
            (
                struct.unpack_from("<f", unpacked, index * 4)[0],
                struct.unpack_from("<f", unpacked, point_count * 4 + index * 4)[0],
                struct.unpack_from("<f", unpacked, point_count * 8 + index * 4)[0],
            )
            for index in range(point_count)
        ]
    else:
        raise SeedAssetError(f"unsupported screenshot PCD DATA type: {data_kind}")

    return OrganizedPointCloud(width=width, height=height, points=tuple(points))


def _normalized_xyz_pcd(cloud: OrganizedPointCloud, *, source: Path) -> bytes:
    finite = [
        point for point in cloud.points if all(math.isfinite(value) for value in point)
    ]
    if not finite:
        raise SeedAssetError(f"screenshot PCD contains no finite points: {source}")
    normalized_header = (
        "# .PCD v0.7 - Point Cloud Data file format\n"
        "VERSION 0.7\n"
        "FIELDS x y z\n"
        "SIZE 4 4 4\n"
        "TYPE F F F\n"
        "COUNT 1 1 1\n"
        f"WIDTH {len(finite)}\n"
        "HEIGHT 1\n"
        "VIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {len(finite)}\n"
        "DATA binary\n"
    ).encode("ascii")
    normalized_body = bytearray(len(finite) * 12)
    for index, point in enumerate(finite):
        struct.pack_into("<fff", normalized_body, index * 12, *point)
    return normalized_header + normalized_body


def _linear_camera_axis(
    samples: list[tuple[float, float]],
    *,
    fallback_focal: float,
    fallback_center: float,
) -> tuple[float, float]:
    """Fit pixel = focal * (axis / depth) + center for one camera axis."""

    count = len(samples)
    if count < 2:
        return fallback_focal, fallback_center
    sum_x = sum(sample[0] for sample in samples)
    sum_y = sum(sample[1] for sample in samples)
    sum_xx = sum(sample[0] * sample[0] for sample in samples)
    sum_xy = sum(sample[0] * sample[1] for sample in samples)
    denominator = count * sum_xx - sum_x * sum_x
    if abs(denominator) < 1e-9:
        return fallback_focal, fallback_center
    focal = (count * sum_xy - sum_x * sum_y) / denominator
    center = (sum_y - focal * sum_x) / count
    if not math.isfinite(focal) or not math.isfinite(center) or focal <= 0:
        return fallback_focal, fallback_center
    return focal, center


def _infer_camera_intrinsic(cloud: OrganizedPointCloud) -> tuple[float, ...]:
    horizontal: list[tuple[float, float]] = []
    vertical: list[tuple[float, float]] = []
    for index, (x, y, z) in enumerate(cloud.points):
        if not all(math.isfinite(value) for value in (x, y, z)) or z <= 0:
            continue
        pixel_x = float(index % cloud.width)
        pixel_y = float(index // cloud.width)
        horizontal.append((x / z, pixel_x))
        vertical.append((y / z, pixel_y))
    fallback_focal = max(cloud.width, cloud.height) * 0.82
    focal_x, center_x = _linear_camera_axis(
        horizontal,
        fallback_focal=fallback_focal,
        fallback_center=(cloud.width - 1) / 2,
    )
    focal_y, center_y = _linear_camera_axis(
        vertical,
        fallback_focal=fallback_focal,
        fallback_center=(cloud.height - 1) / 2,
    )
    return (
        round(focal_x, 6),
        0.0,
        round(center_x, 6),
        0.0,
        round(focal_y, 6),
        round(center_y, 6),
        0.0,
        0.0,
        1.0,
    )


def _depth_color(value: float) -> tuple[int, int, int]:
    """Compact blue→cyan→amber ramp for a deterministic depth-camera frame."""

    stops = (
        (18, 31, 67),
        (20, 111, 150),
        (61, 181, 154),
        (244, 196, 92),
    )
    scaled = max(0.0, min(1.0, value)) * (len(stops) - 1)
    left = min(int(scaled), len(stops) - 2)
    fraction = scaled - left
    return tuple(
        round(
            stops[left][channel] * (1 - fraction) + stops[left + 1][channel] * fraction
        )
        for channel in range(3)
    )


def _write_depth_camera(cloud: OrganizedPointCloud, destination: Path) -> None:
    depths = sorted(
        z
        for x, y, z in cloud.points
        if all(math.isfinite(value) for value in (x, y, z)) and z > 0
    )
    if not depths:
        raise SeedAssetError("screenshot organized PCD contains no positive depth")
    near = depths[int((len(depths) - 1) * 0.02)]
    far = depths[int((len(depths) - 1) * 0.98)]
    span = max(far - near, 1e-6)
    pixels = []
    for x, y, z in cloud.points:
        if not all(math.isfinite(value) for value in (x, y, z)) or z <= 0:
            pixels.append((7, 11, 18))
            continue
        pixels.append(_depth_color(1 - (z - near) / span))
    image = Image.new("RGB", (cloud.width, cloud.height))
    image.putdata(pixels)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(
        destination,
        format="JPEG",
        quality=92,
        subsampling=0,
        optimize=False,
        progressive=False,
    )


def _prepare_pointclouds(root: Path, source_files: Mapping[str, Path]) -> None:
    lidar = root / "lidar"
    lidar.mkdir(parents=True, exist_ok=True)
    intrinsic: tuple[float, ...] | None = None
    for index, source_id in enumerate(POINTCLOUD_SOURCE_IDS):
        source = source_files[source_id]
        cloud = _read_organized_xyz_pcd(source)
        (lidar / f"{index:06d}.pcd").write_bytes(
            _normalized_xyz_pcd(cloud, source=source)
        )
        _write_depth_camera(
            cloud,
            root / f"camera/front/{index:06d}.jpg",
        )
        intrinsic = intrinsic or _infer_camera_intrinsic(cloud)

    calibration = {
        "extrinsic": [
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
        "intrinsic": list(intrinsic or ()),
    }
    calibration_path = root / "calib/camera/front.json"
    calibration_path.parent.mkdir(parents=True, exist_ok=True)
    calibration_path.write_text(
        json.dumps(calibration, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


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
        _prepare_pointclouds(staging / "pointcloud", source_files)
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
            pointcloud_root=resolved.pointcloud_root,
            multicamera_pointcloud_root=resolved.multicamera_pointcloud_root,
            source="prepared",
        )
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
