"""v0.10.54 · annotations[] 导入服务 (ADR-0028).

支持 AAP JSON v1.0 envelope 里的 annotations[] 数组导入。与 predictions_import.py
不同的写入路径: 直接落 Annotation 表（不走 PredictionService），geometry 透传（内部
格式直存，无需 LS shape 转换），user_id 归操作者，溯源写 attributes._imported。

详见 docs/adr/0028-annotations-import-semantics.md。
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.project import Project
from app.schemas.aap_json import (
    AAPImportErrorEntry,
    AAPImportResult,
    AAPJsonV1Envelope,
    check_schema_major,
)
from app.schemas._jsonb_types import Geometry
from app.services.annotation_track_identity import prepare_compact_track_identity
from app.services.raster_mask_storage import validate_mask_geometry_for_task
from app.services.raster_mask_storage import build_rle_reference, store_coco_rle
from app.services.task_matcher import resolve_task

logger = logging.getLogger(__name__)

# source 允许集合（D2）
_ALLOWED_SOURCES = {"manual", "prediction_based", "interpolated"}

# geometry.type → tool_unit_id 派生映射（参照 predictions_import / prediction.py）
_GEOMETRY_TO_TOOL_UNIT: dict[str, str] = {
    "polyline": "polyline",
    "rotated_bbox": "rotated_bbox",
    "keypoint": "keypoint",
    "polygon": "region",
    "multi_polygon": "region",
    "video_track_mask": "region",
}

_GEOMETRY_ADAPTER = TypeAdapter(Geometry)


def _validate_aap_mask_objects(
    geometry: dict[str, Any],
    mask_objects: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    if geometry.get("type") != "video_track_mask":
        return []
    objects: list[dict[str, Any]] = []
    for keyframe in geometry.get("keyframes") or []:
        reference = keyframe.get("mask") or {}
        digest = reference.get("sha256")
        rle = mask_objects.get(str(digest))
        if rle is None:
            raise ValueError(f"AAP mask_objects missing sha256 {digest}")
        if build_rle_reference(rle) != reference:
            raise ValueError(f"AAP mask object metadata mismatch for sha256 {digest}")
        objects.append(rle)
    return objects


def _derive_tool_unit(geometry_type: str | None) -> str:
    """按 geometry.type 派生 tool_unit_id; 其余 kind（含 bbox）→ bbox."""
    if geometry_type is None:
        return "bbox"
    return _GEOMETRY_TO_TOOL_UNIT.get(geometry_type, "bbox")


# ── overwrite 语义: 清理该 task 下 _imported==true 的 annotations ──────


async def _purge_imported_annotations(db: AsyncSession, task_id: uuid.UUID) -> None:
    """overwrite=true 时: 删除该 task 下 attributes._imported == 'true' 的标注行。

    只删导入子集，绝不碰人工标注。
    """
    await db.execute(
        delete(Annotation).where(
            Annotation.task_id == task_id,
            Annotation.attributes["_imported"].astext == "true",
        )
    )
    await db.flush()


# ── AAP JSON annotations 导入主函数 ──────────────────────────────────


async def import_aap_json_annotations(
    db: AsyncSession,
    project_id: uuid.UUID,
    file_bytes: bytes,
    *,
    operator_user_id: uuid.UUID,
    overwrite: bool = False,
    dry_run: bool = False,
) -> AAPImportResult:
    """导入 AAP JSON envelope 里的 annotations[] 数组。

    语义决策见 ADR-0028:
    - D1 · user_id 归操作者, 原 user_id 转存 attributes._imported_user_id
    - D2 · 保留原始 source（允许集合内）, attributes._imported=true 标记
    - D3 · 默认 append; overwrite 时仅清理 _imported==true 子集
    - D5 · created_at 保留原值（若有）, was_cancelled=False, lead_time 不设
    - D6 · 循环结束后批量更新 task 统计, 抑制 batch 自动流转
    """
    try:
        raw = json.loads(file_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"AAP JSON 文件无法解析: {exc}") from exc

    schema_version = raw.get("schema_version") if isinstance(raw, dict) else None
    if not isinstance(schema_version, str):
        raise ValueError("AAP JSON 缺少 schema_version 字段 (1.0)")
    check_schema_major(schema_version)

    try:
        envelope = AAPJsonV1Envelope.model_validate(raw)
    except ValidationError as exc:
        raise ValueError(f"AAP JSON envelope 校验失败: {exc.errors()[:3]}") from exc

    result = AAPImportResult(dry_run=dry_run)
    purged_tasks: set[uuid.UUID] = set()
    affected_tasks: set[uuid.UUID] = set()

    # 预先查好 project，以便 class_name 软校验（避免逐条 db.get）
    project = await db.get(Project, project_id)
    project_tool_bindings: dict[str, Any] = (
        project.tool_bindings or {} if project else {}
    )

    from app.services.project import lookup_classes_for_tool_unit

    for block in envelope.tasks:
        match_dict = block.task_match.model_dump(exclude_none=True)
        # 兜底兼容: task block 顶层 file_path
        if "file_path" not in match_dict and block.file_path:
            match_dict["file_path"] = block.file_path

        if not block.annotations:
            continue

        task = await resolve_task(db, project_id, match_dict)
        if task is None:
            for _ in block.annotations:
                result.errors.append(
                    AAPImportErrorEntry(
                        task_match=match_dict,
                        reason="task not found in project",
                    )
                )
                result.skipped += 1
            continue

        # overwrite: 导入该 task 前清理 _imported 标注（每 task 只清一次）
        if overwrite and not dry_run and task.id not in purged_tasks:
            await _purge_imported_annotations(db, task.id)
            purged_tasks.add(task.id)

        for entry in block.annotations:
            # 1. class_name 缺失检查
            if not entry.class_name:
                result.errors.append(
                    AAPImportErrorEntry(
                        task_match=match_dict,
                        reason="missing class_name",
                    )
                )
                result.skipped += 1
                continue

            # 2. geometry 有效性检查
            if not isinstance(entry.geometry, dict) or not entry.geometry.get("type"):
                result.errors.append(
                    AAPImportErrorEntry(
                        task_match=match_dict,
                        reason="invalid geometry: must be dict with 'type' field",
                    )
                )
                result.skipped += 1
                continue

            try:
                validated_geometry = _GEOMETRY_ADAPTER.validate_python(entry.geometry)
                entry.geometry = validated_geometry.model_dump(
                    by_alias=True, exclude_unset=True
                )
                mask_objects = _validate_aap_mask_objects(
                    entry.geometry, envelope.mask_objects
                )
                await validate_mask_geometry_for_task(db, task, entry.geometry)
            except ValidationError as exc:
                result.errors.append(
                    AAPImportErrorEntry(
                        task_match=match_dict,
                        reason=f"invalid geometry: {exc.errors()[:2]}",
                    )
                )
                result.skipped += 1
                continue
            except ValueError as exc:
                result.errors.append(
                    AAPImportErrorEntry(
                        task_match=match_dict, reason=f"invalid geometry: {exc}"
                    )
                )
                result.skipped += 1
                continue

            # 3. tool_unit_id 派生
            tool_unit_id = entry.tool_unit_id or _derive_tool_unit(
                entry.geometry.get("type")
            )

            # 4. class_name 软校验（失败不让整批失败，累计 errors[] + skip）
            allowed = lookup_classes_for_tool_unit(project_tool_bindings, tool_unit_id)
            if (
                allowed
                and entry.class_name != "__unknown"
                and entry.class_name not in allowed
            ):
                result.errors.append(
                    AAPImportErrorEntry(
                        task_match=match_dict,
                        reason=(
                            f"class_name '{entry.class_name}' 不在工具单位 "
                            f"'{tool_unit_id}' 的类别集合内"
                        ),
                    )
                )
                result.skipped += 1
                continue

            # 5. source 语义（D2）: 保留原值，不在允许集合则默认 manual
            source = entry.source if entry.source in _ALLOWED_SOURCES else "manual"

            # 6. attributes（D1+D2）: 在 entry.attributes 基础上合并溯源标记
            attributes: dict[str, Any] = dict(entry.attributes or {})
            attributes["_imported"] = True
            if entry.user_id is not None:
                attributes["_imported_user_id"] = str(entry.user_id)

            if not dry_run:
                for mask_object in mask_objects:
                    store_coco_rle(mask_object)

            # 7. dry_run: 只计数不入库
            if dry_run:
                result.imported += 1
                continue

            # 8. 构造 Annotation 行直接 db.add（不走 AnnotationService.create，
            #    因为它会逐条触发 _update_task_stats 并可能推进 batch 状态）
            geometry, track_id = prepare_compact_track_identity(entry.geometry)
            ann_kwargs: dict[str, Any] = dict(
                id=uuid.uuid4(),
                task_id=task.id,
                project_id=project_id,
                user_id=operator_user_id,  # D1
                source=source,  # D2
                annotation_type=entry.geometry["type"],
                tool_unit_id=tool_unit_id,
                class_name=entry.class_name,
                geometry=geometry,  # geometry 透传内部格式，无需 LS 转换
                track_id=track_id,
                confidence=entry.confidence,
                was_cancelled=False,  # D5
                ground_truth=False,  # D5
                attributes=attributes,  # D1+D2
            )
            # D5: created_at 若 entry 提供则显式设置，否则走 server_default now()
            if entry.created_at is not None:
                ann_kwargs["created_at"] = entry.created_at

            annotation = Annotation(**ann_kwargs)
            db.add(annotation)
            affected_tasks.add(task.id)
            result.imported += 1

    # D6: 循环结束后批量更新受影响 task 统计，抑制 batch 自动流转
    if affected_tasks and not dry_run:
        await db.flush()
        from app.services.annotation import AnnotationService

        svc = AnnotationService(db)
        for task_id in affected_tasks:
            await svc._update_task_stats(task_id, trigger_batch_transitions=False)

    return result
