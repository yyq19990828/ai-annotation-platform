"""外部预测导入服务 (v0.10.15).

支持两种 input format:
- AAP JSON v1.0: 平台原生无损中间格式 (双数组 annotations[]/predictions[]);
  本期仅消费 predictions[], annotations[] 警告日志保留供后续 epic.
- COCO: 标准 COCO Detection 格式 (images + annotations + categories), 用 image
  的 file_name 匹配 task.file_path.

写入路径: 把内部 geometry 反向适配回 LabelStudio shape -> 复用
PredictionService.create_from_ml_result, 标记 source='external_import'.

ROADMAP §6 决策底线 lenient 精神:
- schema_version > 当前 major 直接 422; 同 major 内未知字段忽略.
- task 不匹配 / geometry kind 不支持 / class_name 缺失 -> errors[] 累计, 不让整批失败.
- dry_run=true 走全部校验路径但不入库.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.prediction import Prediction, PredictionMeta
from app.schemas.aap_json import (
    AAPImportErrorEntry,
    AAPImportResult,
    AAPJsonV1Envelope,
    AAPPredictionEntry,
    check_schema_major,
)
from app.services.prediction import PredictionService
from app.services.task_matcher import resolve_task

logger = logging.getLogger(__name__)


# ── geometry kind → LabelStudio shape 适配 ─────────────────────────


def internal_geometry_to_ls_shape(
    geometry: dict[str, Any],
    class_name: str,
    confidence: float | None,
) -> dict[str, Any] | None:
    """把内部 Geometry (bbox / polygon / multi_polygon) 反向适配为 LabelStudio shape.

    平台 prediction.result JSONB 列存的是 LS 标准格式 (apps/api/app/services/
    prediction.py:to_internal_shape 是读路径的反向). 这里走"导入端 -> LS shape"
    适配, 之后复用 PredictionService.create_from_ml_result 写入.

    返回 None 表示不支持的 kind, 调用方应把 errors[] 累计.

    几何归一化坐标 [0, 1]; LabelStudio 历史用 [0, 100] 表示百分比, 所以 *100.
    """
    kind = geometry.get("type")
    score = confidence if confidence is not None else None

    if kind == "bbox":
        try:
            return {
                "type": "rectanglelabels",
                "value": {
                    "x": float(geometry["x"]) * 100,
                    "y": float(geometry["y"]) * 100,
                    "width": float(geometry["w"]) * 100,
                    "height": float(geometry["h"]) * 100,
                    "rectanglelabels": [class_name],
                },
                "score": score,
            }
        except (KeyError, TypeError, ValueError):
            return None

    if kind == "polygon":
        points = geometry.get("points") or []
        if len(points) < 3:
            return None
        # LabelStudio polygonlabels: points 是 [[x*100, y*100], ...]
        ls_points = [
            [float(pt[0]) * 100, float(pt[1]) * 100] for pt in points if len(pt) == 2
        ]
        if len(ls_points) < 3:
            return None
        value: dict[str, Any] = {
            "points": ls_points,
            "polygonlabels": [class_name],
        }
        holes = geometry.get("holes") or []
        if holes:
            value["holes"] = [
                [[float(pt[0]) * 100, float(pt[1]) * 100] for pt in hole if len(pt) == 2]
                for hole in holes
            ]
        return {"type": "polygonlabels", "value": value, "score": score}

    if kind == "multi_polygon":
        polygons = geometry.get("polygons") or []
        if not polygons:
            return None
        # v0.9.14 multi_polygon LS shape: value.polygons = [{points, holes?}, ...]
        ls_polys: list[dict[str, Any]] = []
        for poly in polygons:
            pts = poly.get("points") or []
            if len(pts) < 3:
                continue
            entry: dict[str, Any] = {
                "points": [
                    [float(pt[0]) * 100, float(pt[1]) * 100]
                    for pt in pts
                    if len(pt) == 2
                ]
            }
            holes = poly.get("holes") or []
            if holes:
                entry["holes"] = [
                    [
                        [float(pt[0]) * 100, float(pt[1]) * 100]
                        for pt in hole
                        if len(pt) == 2
                    ]
                    for hole in holes
                ]
            ls_polys.append(entry)
        if not ls_polys:
            return None
        return {
            "type": "polygonlabels",
            "value": {"polygons": ls_polys, "polygonlabels": [class_name]},
            "score": score,
        }

    # 本期不支持 video_bbox / video_track / 其他 kind.
    return None


# ── overwrite 语义: 同 task 已有 external_import prediction 是否替换 ──────


async def _purge_existing_external_imports(
    db: AsyncSession, task_id: uuid.UUID
) -> None:
    """overwrite_existing=true 时: 删该 task 下 source='external_import' 的 predictions.

    PredictionMeta 通过 FK 引用 predictions.id (无 CASCADE), 必须先删 meta 再删 prediction.
    """
    target_ids_q = await db.execute(
        select(Prediction.id).where(
            Prediction.task_id == task_id,
            Prediction.source == "external_import",
        )
    )
    target_ids = [row[0] for row in target_ids_q.all()]
    if not target_ids:
        return

    await db.execute(
        delete(PredictionMeta).where(PredictionMeta.prediction_id.in_(target_ids))
    )
    await db.execute(delete(Prediction).where(Prediction.id.in_(target_ids)))
    await db.flush()


# ── AAP JSON importer ──────────────────────────────────────────────


async def import_aap_json(
    db: AsyncSession,
    project_id: uuid.UUID,
    file_bytes: bytes,
    *,
    model_version_fallback: str | None = None,
    overwrite_existing: bool = False,
    dry_run: bool = False,
) -> AAPImportResult:
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
    svc = PredictionService(db)

    purged_tasks: set[uuid.UUID] = set()

    for block in envelope.tasks:
        match_dict = block.task_match.model_dump(exclude_none=True)
        # 兜底用 task block 顶层 file_path (兼容客户手工组装 task_match 漏写 file_path).
        if "file_path" not in match_dict and block.file_path:
            match_dict["file_path"] = block.file_path

        if block.annotations:
            # v0.10.15 不消费 annotations[]; 仅警告.
            logger.warning(
                "AAP JSON import: annotations[] 字段在 v0.10.15 暂不消费, "
                "已跳过 %d 条 (task_match=%s)",
                len(block.annotations),
                match_dict,
            )

        if not block.predictions:
            continue

        task = await resolve_task(db, project_id, match_dict)
        if task is None:
            for _ in block.predictions:
                result.errors.append(
                    AAPImportErrorEntry(
                        task_match=match_dict,
                        reason="task not found in project",
                    )
                )
                result.skipped += 1
            continue

        if (
            overwrite_existing
            and not dry_run
            and task.id not in purged_tasks
        ):
            await _purge_existing_external_imports(db, task.id)
            purged_tasks.add(task.id)

        # AAP JSON 每个 prediction entry 对应一条平台 Prediction 行 (单 shape).
        for entry in block.predictions:
            ls_shape = _entry_to_ls_shape(entry)
            if ls_shape is None:
                kind = entry.geometry.get("type") if isinstance(entry.geometry, dict) else None
                result.errors.append(
                    AAPImportErrorEntry(
                        task_match=match_dict,
                        reason=f"unsupported geometry kind: {kind!r}",
                    )
                )
                result.skipped += 1
                continue

            if dry_run:
                result.imported += 1
                continue

            await svc.create_from_ml_result(
                task_id=task.id,
                project_id=project_id,
                ml_backend_id=None,
                result=[ls_shape],
                score=entry.score if entry.score is not None else entry.confidence,
                model_version=entry.model_version or model_version_fallback,
                source="external_import",
            )
            result.imported += 1

    return result


def _entry_to_ls_shape(entry: AAPPredictionEntry) -> dict[str, Any] | None:
    if not entry.class_name:
        return None
    return internal_geometry_to_ls_shape(
        entry.geometry or {},
        entry.class_name,
        entry.confidence,
    )


# ── COCO importer (Detection 子集) ─────────────────────────────────


async def import_coco(
    db: AsyncSession,
    project_id: uuid.UUID,
    file_bytes: bytes,
    *,
    model_version_fallback: str | None = None,
    overwrite_existing: bool = False,
    dry_run: bool = False,
    image_size_hint: tuple[int, int] | None = None,
) -> AAPImportResult:
    """COCO Detection 格式 importer.

    最小子集: 只读 `images[]` + `annotations[]` + `categories[]`. bbox 是 COCO 标准
    `[x, y, w, h]` 像素坐标; 用 image.width/height 归一化到 [0,1] 后走 bbox kind.

    匹配: 用 image.file_name 当 task.file_path (调用方应保证 dataset 命名一致).
    """

    try:
        raw = json.loads(file_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"COCO JSON 文件无法解析: {exc}") from exc

    if not isinstance(raw, dict):
        raise ValueError("COCO JSON 顶层必须是 object")

    images_raw = raw.get("images") or []
    annotations_raw = raw.get("annotations") or []
    categories_raw = raw.get("categories") or []

    cat_map: dict[int, str] = {}
    for cat in categories_raw:
        if not isinstance(cat, dict):
            continue
        cat_id = cat.get("id")
        cat_name = cat.get("name")
        if isinstance(cat_id, int) and isinstance(cat_name, str):
            cat_map[cat_id] = cat_name

    image_map: dict[int, dict[str, Any]] = {}
    for img in images_raw:
        if not isinstance(img, dict):
            continue
        img_id = img.get("id")
        if isinstance(img_id, int):
            image_map[img_id] = img

    result = AAPImportResult(dry_run=dry_run)
    svc = PredictionService(db)
    purged_tasks: set[uuid.UUID] = set()

    for ann in annotations_raw:
        if not isinstance(ann, dict):
            continue
        img_id = ann.get("image_id")
        bbox = ann.get("bbox")
        cat_id = ann.get("category_id")

        img = image_map.get(img_id) if isinstance(img_id, int) else None
        if img is None or not isinstance(bbox, list) or len(bbox) != 4:
            result.errors.append(
                AAPImportErrorEntry(
                    task_match={"coco_image_id": img_id},
                    reason="invalid coco annotation entry",
                )
            )
            result.skipped += 1
            continue

        file_name = img.get("file_name") or ""
        img_w = float(img.get("width") or (image_size_hint[0] if image_size_hint else 0))
        img_h = float(img.get("height") or (image_size_hint[1] if image_size_hint else 0))
        if img_w <= 0 or img_h <= 0:
            result.errors.append(
                AAPImportErrorEntry(
                    task_match={"file_path": file_name},
                    reason="coco image missing width/height; image_size_hint not provided",
                )
            )
            result.skipped += 1
            continue

        class_name = cat_map.get(cat_id) if isinstance(cat_id, int) else None
        if not class_name:
            result.errors.append(
                AAPImportErrorEntry(
                    task_match={"file_path": file_name},
                    reason=f"unknown category_id: {cat_id!r}",
                )
            )
            result.skipped += 1
            continue

        # 匹配: 优先用 file_name 当 file_path; 兼容 file_name 顶层带斜杠子目录.
        match_dict = {"file_path": file_name}
        task = await resolve_task(db, project_id, match_dict)
        if task is None:
            result.errors.append(
                AAPImportErrorEntry(
                    task_match=match_dict,
                    reason="task not found in project",
                )
            )
            result.skipped += 1
            continue

        if (
            overwrite_existing
            and not dry_run
            and task.id not in purged_tasks
        ):
            await _purge_existing_external_imports(db, task.id)
            purged_tasks.add(task.id)

        x, y, w, h = (float(v) for v in bbox)
        geometry = {
            "type": "bbox",
            "x": x / img_w,
            "y": y / img_h,
            "w": w / img_w,
            "h": h / img_h,
        }
        score = ann.get("score")
        confidence = float(score) if isinstance(score, (int, float)) else None

        ls_shape = internal_geometry_to_ls_shape(geometry, class_name, confidence)
        if ls_shape is None:
            result.errors.append(
                AAPImportErrorEntry(
                    task_match=match_dict,
                    reason="failed to build ls shape from coco bbox",
                )
            )
            result.skipped += 1
            continue

        if dry_run:
            result.imported += 1
            continue

        await svc.create_from_ml_result(
            task_id=task.id,
            project_id=project_id,
            ml_backend_id=None,
            result=[ls_shape],
            score=confidence,
            model_version=model_version_fallback,
            source="external_import",
        )
        result.imported += 1

    return result
