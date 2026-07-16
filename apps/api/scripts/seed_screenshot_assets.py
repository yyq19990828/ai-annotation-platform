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


GENERATED_REVISION = "screenshots-real-v2"
ROAD_SOURCE_IDS = ("auckland-traffic-1", "auckland-traffic-2")
VIDEO_SOURCE_ID = "street-traffic-video"
POINTCLOUD_SOURCE_IDS = tuple(f"pcl-pairwise-capture-{index}" for index in range(1, 5))
REQUIRED_SOURCE_IDS = frozenset(
    (*ROAD_SOURCE_IDS, VIDEO_SOURCE_ID, *POINTCLOUD_SOURCE_IDS)
)
PREPARED_PROVENANCE = {
    "media_status": "deterministic derivatives of verified network sources",
    "image": "CC0-1.0 Auckland traffic photographs by Kiwiev",
    "video": "Street traffic by Editor / Wikimedia Commons, CC BY 3.0",
    "pointcloud": "Point Cloud Library data repository, BSD-3-Clause",
}

# Boxes use normalized coordinates in each original photograph. Only boxes whose
# centres fall inside a crop are exported, so every derived image has truthful labels.
ROAD_BOXES = {
    "auckland-traffic-1": (
        (2, (0.070, 0.610, 0.240, 0.790)),
        (2, (0.350, 0.600, 0.490, 0.805)),
        (2, (0.570, 0.610, 0.690, 0.800)),
        (2, (0.710, 0.780, 0.910, 0.990)),
        (7, (0.730, 0.280, 0.860, 0.530)),
        (7, (0.350, 0.560, 0.480, 0.800)),
        (7, (0.145, 0.460, 0.250, 0.645)),
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
    source: str


def _required_files(root: Path) -> tuple[Path, ...]:
    return (
        root / "image/images/train/screenshot_01.jpg",
        root / "image/images/val/screenshot_08.jpg",
        root / "image/labels/train/screenshot_01.txt",
        root / "image/labels/val/screenshot_08.txt",
        root / "video/tracking_scene.mp4",
        *(root / f"pointcloud/lidar/{index:06d}.pcd" for index in range(4)),
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
        source="cache",
    )


def _yolo_line(
    class_id: int, box: tuple[float, float, float, float]
) -> str:
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
    if not (crop_left <= center_x <= crop_right and crop_top <= center_y <= crop_bottom):
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


def _normalized_xyz_pcd(source: Path) -> bytes:
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
    except (KeyError, IndexError, ValueError) as exc:
        raise SeedAssetError(f"screenshot PCD POINTS is invalid: {source}") from exc

    data_kind = header["DATA"][0]
    body = payload[header_end + 1 :]
    points: list[tuple[float, float, float]] = []
    if data_kind == "ascii":
        try:
            rows = body.decode("ascii").splitlines()
            points = [tuple(float(value) for value in row.split()) for row in rows if row]
        except (UnicodeDecodeError, ValueError) as exc:
            raise SeedAssetError(f"screenshot ASCII PCD is invalid: {source}") from exc
    elif data_kind == "binary":
        if len(body) != point_count * 12:
            raise SeedAssetError(f"screenshot binary PCD size is invalid: {source}")
        points = [struct.unpack_from("<fff", body, index * 12) for index in range(point_count)]
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

    finite = [point for point in points if all(math.isfinite(value) for value in point)]
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


def _prepare_pointclouds(root: Path, source_files: Mapping[str, Path]) -> None:
    lidar = root / "lidar"
    lidar.mkdir(parents=True, exist_ok=True)
    for index, source_id in enumerate(POINTCLOUD_SOURCE_IDS):
        (lidar / f"{index:06d}.pcd").write_bytes(
            _normalized_xyz_pcd(source_files[source_id])
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
            source="prepared",
        )
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
