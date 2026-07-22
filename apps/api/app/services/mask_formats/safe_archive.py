from __future__ import annotations

import os
import re
import stat
import struct
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterable


class ArchiveSafetyError(ValueError):
    def __init__(self, code: str, message: str, *, detail: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.detail = detail or {}


@dataclass(frozen=True)
class ArchiveLimits:
    max_files: int = 200_000
    max_entry_bytes: int = 512 * 1024 * 1024
    max_total_bytes: int = 8 * 1024 * 1024 * 1024
    max_compression_ratio: float = 100.0


@dataclass(frozen=True)
class SafeArchiveEntry:
    source_name: str
    normalized_path: str
    size_bytes: int
    compressed_bytes: int


_DRIVE_RE = re.compile(r"^[A-Za-z]:")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def normalize_archive_path(raw_name: str) -> str:
    if not raw_name or "\x00" in raw_name:
        raise ArchiveSafetyError(
            "archive_path_invalid", "archive entry path is empty or contains NUL"
        )
    if "\\" in raw_name:
        raise ArchiveSafetyError(
            "archive_path_invalid", "archive entry path must use '/' separators"
        )
    if raw_name.startswith("/") or _DRIVE_RE.match(raw_name):
        raise ArchiveSafetyError(
            "archive_path_absolute", "absolute archive paths are forbidden"
        )
    path = PurePosixPath(raw_name)
    parts = [part for part in path.parts if part not in {"", "."}]
    if not parts or any(part == ".." for part in parts):
        raise ArchiveSafetyError(
            "archive_path_traversal", "archive path traversal is forbidden"
        )
    normalized = "/".join(parts)
    if len(normalized) > 1024:
        raise ArchiveSafetyError(
            "archive_path_too_long", "archive entry path is too long"
        )
    return normalized


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return stat.S_ISLNK(mode)


class SafeZipArchive:
    def __init__(
        self,
        source: str | os.PathLike[str] | BinaryIO,
        limits: ArchiveLimits,
        *,
        skip_unsafe_paths: bool = False,
    ) -> None:
        self.limits = limits
        self.skip_unsafe_paths = skip_unsafe_paths
        self.skipped_paths: list[str] = []
        try:
            self._zip = zipfile.ZipFile(source)
        except (zipfile.BadZipFile, OSError) as exc:
            raise ArchiveSafetyError(
                "archive_invalid", "archive is not a valid ZIP"
            ) from exc
        try:
            self.entries = self._inspect()
        except Exception:
            self._zip.close()
            raise
        self._by_path = {entry.normalized_path: entry for entry in self.entries}

    def _inspect(self) -> list[SafeArchiveEntry]:
        entries: list[SafeArchiveEntry] = []
        exact: set[str] = set()
        folded: dict[str, str] = {}
        total = 0
        for info in self._zip.infolist():
            try:
                normalized = normalize_archive_path(info.filename)
            except ArchiveSafetyError:
                if not self.skip_unsafe_paths:
                    raise
                self.skipped_paths.append(info.filename)
                continue
            if info.is_dir():
                continue
            if _is_symlink(info):
                raise ArchiveSafetyError(
                    "archive_symlink",
                    "archive symlinks are forbidden",
                    detail={"path": normalized},
                )
            if normalized in exact:
                raise ArchiveSafetyError(
                    "archive_duplicate_path",
                    "archive contains duplicate normalized paths",
                    detail={"path": normalized},
                )
            folded_name = normalized.casefold()
            previous = folded.get(folded_name)
            if previous is not None and previous != normalized:
                raise ArchiveSafetyError(
                    "archive_casefold_collision",
                    "archive contains case-folding path collisions",
                    detail={"path": normalized, "conflicts_with": previous},
                )
            if info.file_size > self.limits.max_entry_bytes:
                raise ArchiveSafetyError(
                    "resource_budget_exceeded",
                    "archive entry exceeds the uncompressed byte limit",
                    detail={
                        "budget": "max_entry_bytes",
                        "limit": self.limits.max_entry_bytes,
                        "observed": info.file_size,
                        "path": normalized,
                    },
                )
            ratio = info.file_size / max(1, info.compress_size)
            if ratio > self.limits.max_compression_ratio:
                raise ArchiveSafetyError(
                    "archive_compression_ratio_exceeded",
                    "archive entry compression ratio exceeds the limit",
                    detail={
                        "path": normalized,
                        "limit": self.limits.max_compression_ratio,
                        "observed": ratio,
                    },
                )
            total += info.file_size
            if total > self.limits.max_total_bytes:
                raise ArchiveSafetyError(
                    "resource_budget_exceeded",
                    "archive expanded bytes exceed the limit",
                    detail={
                        "budget": "max_total_bytes",
                        "limit": self.limits.max_total_bytes,
                        "observed": total,
                    },
                )
            exact.add(normalized)
            folded[folded_name] = normalized
            entries.append(
                SafeArchiveEntry(
                    source_name=info.filename,
                    normalized_path=normalized,
                    size_bytes=info.file_size,
                    compressed_bytes=info.compress_size,
                )
            )
            if len(entries) > self.limits.max_files:
                raise ArchiveSafetyError(
                    "resource_budget_exceeded",
                    "archive file count exceeds the limit",
                    detail={
                        "budget": "max_files",
                        "limit": self.limits.max_files,
                        "observed": len(entries),
                    },
                )
        return entries

    def close(self) -> None:
        self._zip.close()

    def __enter__(self) -> SafeZipArchive:
        return self

    def __exit__(self, *_args) -> None:
        self.close()

    def require_paths(self, paths: Iterable[str]) -> None:
        missing = sorted(
            normalized
            for normalized in (normalize_archive_path(path) for path in paths)
            if normalized not in self._by_path
        )
        if missing:
            raise ArchiveSafetyError(
                "manifest_reference_missing",
                "manifest references files that are not present in the archive",
                detail={"paths": missing[:100], "missing_count": len(missing)},
            )

    def open(self, normalized_path: str) -> BinaryIO:
        normalized = normalize_archive_path(normalized_path)
        entry = self._by_path.get(normalized)
        if entry is None:
            raise ArchiveSafetyError(
                "archive_entry_missing",
                "archive entry does not exist",
                detail={"path": normalized},
            )
        return self._zip.open(entry.source_name)

    def copy_to(self, normalized_path: str, destination: str | os.PathLike[str]) -> int:
        target = Path(destination)
        target.parent.mkdir(parents=True, exist_ok=True)
        copied = 0
        try:
            with self.open(normalized_path) as source, target.open("wb") as sink:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    copied += len(chunk)
                    if copied > self.limits.max_entry_bytes:
                        raise ArchiveSafetyError(
                            "resource_budget_exceeded",
                            "archive entry exceeded the streaming byte limit",
                        )
                    sink.write(chunk)
        except Exception:
            try:
                target.unlink()
            except OSError:
                pass
            raise
        return copied


def inspect_png_header(source: BinaryIO) -> tuple[int, int, int, int]:
    header = source.read(33)
    if len(header) < 33 or header[:8] != _PNG_SIGNATURE or header[12:16] != b"IHDR":
        raise ArchiveSafetyError(
            "png_magic_invalid", "PNG signature or IHDR is invalid"
        )
    width, height, bit_depth, color_type = struct.unpack(">IIBB", header[16:26])
    if width <= 0 or height <= 0:
        raise ArchiveSafetyError(
            "png_dimensions_invalid", "PNG dimensions must be positive"
        )
    return width, height, bit_depth, color_type


def validate_png_contract(
    source: BinaryIO,
    *,
    expected_width: int,
    expected_height: int,
    allowed_bit_depths: frozenset[int] = frozenset({8}),
    allowed_color_types: frozenset[int] = frozenset({0, 3}),
) -> None:
    width, height, bit_depth, color_type = inspect_png_header(source)
    if (width, height) != (expected_width, expected_height):
        raise ArchiveSafetyError(
            "image_size_mismatch",
            "PNG dimensions do not match the manifest",
            detail={
                "expected": [expected_width, expected_height],
                "observed": [width, height],
            },
        )
    if bit_depth not in allowed_bit_depths or color_type not in allowed_color_types:
        raise ArchiveSafetyError(
            "png_contract_unsupported",
            "PNG bit depth or color type is unsupported",
            detail={"bit_depth": bit_depth, "color_type": color_type},
        )
