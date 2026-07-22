from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.project import Project
from app.schemas.mask_format import (
    MaskFormatCapability,
    MaskFormatDescriptorOut,
    MaskFormatPlan,
)


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class MaskFormatDescriptor:
    format_id: str
    label: str
    adapter_version: str
    manifest_version: str
    media_types: frozenset[str]
    import_capability: MaskFormatCapability
    export_capability: MaskFormatCapability
    option_schema: dict[str, Any] = field(default_factory=dict)

    def to_out(self) -> MaskFormatDescriptorOut:
        return MaskFormatDescriptorOut(
            format_id=self.format_id,
            label=self.label,
            adapter_version=self.adapter_version,
            manifest_version=self.manifest_version,
            media_types=sorted(self.media_types),
            import_capability=self.import_capability,
            export_capability=self.export_capability,
            option_schema=self.option_schema,
        )


@dataclass(frozen=True)
class StagedObject:
    object_key: str
    sha256: str
    local_path: str
    size_bytes: int


class MaskFormatAdapter(Protocol):
    descriptor: MaskFormatDescriptor

    async def preflight_import(
        self,
        db: AsyncSession,
        *,
        project: Project,
        staged: StagedObject,
        mapping: dict[str, Any],
        options: dict[str, Any],
    ) -> MaskFormatPlan: ...

    async def execute_import_item(
        self,
        db: AsyncSession,
        *,
        project: Project,
        staged: StagedObject,
        plan: MaskFormatPlan,
        item_index: int,
        operator_user_id,
        mapping: dict[str, Any],
        options: dict[str, Any],
    ) -> dict[str, Any]: ...

    async def preflight_export(
        self,
        db: AsyncSession,
        *,
        project: Project,
        scope: dict[str, Any],
        options: dict[str, Any],
    ) -> MaskFormatPlan: ...
