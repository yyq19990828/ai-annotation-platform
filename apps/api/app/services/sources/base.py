from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from fnmatch import fnmatch
import os
from typing import BinaryIO, Iterable, Iterator


class SourcePathError(ValueError):
    """Raised when an import source path escapes its configured connector root."""


@dataclass(frozen=True)
class SourceObject:
    relpath: str
    size: int
    mtime: datetime | None = None
    etag: str | None = None


class SourceAdapter(ABC):
    @abstractmethod
    def list(
        self,
        path: str,
        recursive: bool,
        include_globs: Iterable[str] | None = None,
    ) -> Iterator[SourceObject]:
        raise NotImplementedError

    @abstractmethod
    def open(self, relpath: str) -> BinaryIO:
        raise NotImplementedError

    def close(self) -> None:
        return None


def normalize_relpath(path: str | None) -> str:
    raw = (path or "").replace("\\", "/").strip()
    if raw in {"", ".", "/"}:
        return ""
    parts = [part for part in raw.split("/") if part not in {"", "."}]
    if any(part == ".." for part in parts):
        raise SourcePathError("source_path 不能包含 '..'")
    return "/".join(parts)


def matches_include_globs(
    relpath: str, include_globs: Iterable[str] | None
) -> bool:
    patterns = [p.strip() for p in (include_globs or []) if p and p.strip()]
    if not patterns:
        return True
    normalized = relpath.replace("\\", "/")
    basename = os.path.basename(normalized)
    return any(
        fnmatch(normalized, pattern) or fnmatch(basename, pattern)
        for pattern in patterns
    )
