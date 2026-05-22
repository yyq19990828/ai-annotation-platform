from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import datetime
from xml.etree.ElementTree import Element, SubElement, tostring

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.dataset import DatasetItem
from app.db.models.prediction import Prediction
from app.db.models.task import Task
from app.db.models.project import Project
from app.services.project import (
    derive_attribute_schema,
    derive_classes_config,
    derive_classes_list,
)
from app.schemas.aap_json import (
    AAP_SCHEMA_VERSION,
    AAPAnnotationEntry,
    AAPExportedFrom,
    AAPJsonV1Envelope,
    AAPPredictionEntry,
    AAPProjectMeta,
    AAPTaskBlock,
    AAPTaskMatch,
)
from app.services.video_tracks import (
    VIDEO_FRAME_MODES,
    clean_keyframe,
    normalize_outside_ranges,
    resolved_track_frames,
    sorted_keyframes,
)

IMG_W, IMG_H = 1920, 1280


class UnsupportedExportError(ValueError):
    pass


def _assert_image_export_supported(project: Project, export_format: str) -> None:
    # v0.10.28 · 媒体维度判断改用 data_type; video 子类型路由 (video-track vs
    # video-mm) 仍用 type_key.
    if project.data_type == "video":
        if project.type_key == "video-track":
            raise UnsupportedExportError(
                f"video-track projects do not support {export_format.upper()} export yet"
            )
        raise UnsupportedExportError(
            f"Video annotation export is not supported for {project.type_key} projects"
        )


def _bbox_geometry(annotation: Annotation) -> dict | None:
    geometry = annotation.geometry or {}
    if geometry.get("type") not in {"bbox", None}:
        return None
    if not all(k in geometry for k in ("x", "y", "w", "h")):
        return None
    return geometry


def _video_metadata(item: DatasetItem | None) -> dict:
    if not item:
        return {}
    metadata = item.metadata_ or {}
    video = metadata.get("video")
    return video if isinstance(video, dict) else {}


def _clean_video_bbox_geometry(geometry: dict) -> dict:
    return {
        "frame_index": int(geometry.get("frame_index", 0)),
        "bbox": {
            "x": geometry.get("x", 0),
            "y": geometry.get("y", 0),
            "w": geometry.get("w", 0),
            "h": geometry.get("h", 0),
        },
    }


class ExportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _load_data(
        self, project_id: uuid.UUID, batch_id: uuid.UUID | None = None
    ):
        project = await self.db.get(Project, project_id)
        if not project:
            return None, [], []

        task_q = select(Task).where(Task.project_id == project_id)
        if batch_id:
            task_q = task_q.where(Task.batch_id == batch_id)
        task_q = task_q.order_by(Task.sequence_order, Task.created_at)
        tasks_result = await self.db.execute(task_q)
        tasks = list(tasks_result.scalars().all())

        task_ids = [t.id for t in tasks]
        if not task_ids:
            return project, [], []

        ann_q = select(Annotation).where(
            Annotation.project_id == project_id,
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
        )
        if batch_id:
            ann_q = ann_q.where(Annotation.task_id.in_(task_ids))
        ann_q = ann_q.order_by(Annotation.created_at)
        annotations_result = await self.db.execute(ann_q)
        annotations = list(annotations_result.scalars().all())

        return project, tasks, annotations

    async def _load_predictions(
        self, project_id: uuid.UUID, task_ids: list[uuid.UUID]
    ) -> list[Prediction]:
        """v0.10.15 · AAP JSON 导出需要 predictions[] 双数组."""
        if not task_ids:
            return []
        pred_q = (
            select(Prediction)
            .where(
                Prediction.project_id == project_id,
                Prediction.task_id.in_(task_ids),
            )
            .order_by(Prediction.created_at)
        )
        result = await self.db.execute(pred_q)
        return list(result.scalars().all())

    async def _load_dataset_items(
        self, tasks: list[Task]
    ) -> dict[uuid.UUID, DatasetItem]:
        item_ids = [t.dataset_item_id for t in tasks if t.dataset_item_id]
        if not item_ids:
            return {}
        result = await self.db.execute(
            select(DatasetItem).where(DatasetItem.id.in_(item_ids))
        )
        return {item.id: item for item in result.scalars().all()}

    async def export_video_tracks(
        self,
        project_id: uuid.UUID,
        *,
        batch_id: uuid.UUID | None = None,
        include_attributes: bool = True,
        video_frame_mode: str = "keyframes",
    ) -> str:
        if video_frame_mode not in VIDEO_FRAME_MODES:
            raise UnsupportedExportError(
                "video_frame_mode must be one of: keyframes, all_frames"
            )

        project, tasks, annotations = await self._load_data(project_id, batch_id)
        if not project:
            return json.dumps({})
        if project.type_key != "video-track":
            raise UnsupportedExportError(
                "Video JSON export is only supported for video-track projects"
            )

        dataset_items = await self._load_dataset_items(tasks)
        task_by_id = {task.id: task for task in tasks}
        categories = [
            {"id": i, "name": name}
            for i, name in enumerate(derive_classes_list(project.tool_bindings))
        ]

        exported_tasks = []
        video_metadata_by_task: dict[uuid.UUID, dict] = {}
        for index, task in enumerate(tasks):
            item = (
                dataset_items.get(task.dataset_item_id)
                if task.dataset_item_id
                else None
            )
            video = _video_metadata(item)
            video_metadata_by_task[task.id] = video
            exported_tasks.append(
                {
                    "id": str(task.id),
                    "display_id": task.display_id,
                    "file_name": task.file_name,
                    "file_path": task.file_path,
                    "file_type": task.file_type,
                    "sequence_order": task.sequence_order,
                    "batch_id": str(task.batch_id) if task.batch_id else None,
                    "video_metadata": video,
                    "order": index,
                }
            )

        tracks = []
        flattened_keyframes = []
        legacy_video_bbox = []
        for ann in annotations:
            task = task_by_id.get(ann.task_id)
            if not task:
                continue
            geometry = ann.geometry or {}
            if geometry.get("type") == "video_track":
                keyframes = [
                    clean_keyframe(kf, include_attributes=include_attributes)
                    for kf in sorted_keyframes(geometry)
                ]
                track = {
                    "annotation_id": str(ann.id),
                    "task_id": str(ann.task_id),
                    "task_display_id": task.display_id,
                    "track_id": geometry.get("track_id"),
                    "class_name": ann.class_name,
                    "source": ann.source,
                    "confidence": ann.confidence,
                    "keyframes": keyframes,
                    "outside": normalize_outside_ranges(geometry.get("outside") or []),
                }
                if include_attributes:
                    track["attributes"] = ann.attributes or {}
                if video_frame_mode == "all_frames":
                    max_keyframe = max(
                        (kf["frame_index"] for kf in keyframes),
                        default=0,
                    )
                    frame_count = int(
                        video_metadata_by_task.get(ann.task_id, {}).get(
                            "frame_count", max_keyframe + 1
                        )
                        or max_keyframe + 1
                    )
                    frame_count = max(frame_count, max_keyframe + 1)
                    track["frames"] = resolved_track_frames(
                        geometry,
                        frame_mode="all_frames",
                        frame_count=frame_count,
                    )
                tracks.append(track)
                for kf in keyframes:
                    flattened_keyframes.append(
                        {
                            "annotation_id": str(ann.id),
                            "task_id": str(ann.task_id),
                            "track_id": geometry.get("track_id"),
                            "class_name": ann.class_name,
                            **kf,
                        }
                    )
            elif geometry.get("type") == "video_bbox":
                row = {
                    "annotation_id": str(ann.id),
                    "task_id": str(ann.task_id),
                    "task_display_id": task.display_id,
                    "class_name": ann.class_name,
                    "source": ann.source,
                    **_clean_video_bbox_geometry(geometry),
                }
                if include_attributes:
                    row["attributes"] = ann.attributes or {}
                legacy_video_bbox.append(row)

        project_row = {
            "id": str(project.id),
            "display_id": project.display_id,
            "name": project.name,
            "type_key": project.type_key,
        }
        if include_attributes:
            project_row["attribute_schema"] = derive_attribute_schema(
                project.tool_bindings
            )

        payload = {
            "export_type": "video_tracks",
            "exported_at": datetime.utcnow().isoformat(),
            "frame_mode": video_frame_mode,
            "project": project_row,
            "categories": categories,
            "tasks": exported_tasks,
            "tracks": tracks,
            "keyframes": flattened_keyframes,
            "video_bbox": legacy_video_bbox,
            "video_metadata": {
                str(task_id): metadata
                for task_id, metadata in video_metadata_by_task.items()
            },
        }
        return json.dumps(payload, ensure_ascii=False, indent=2)

    async def export_coco(
        self,
        project_id: uuid.UUID,
        *,
        batch_id: uuid.UUID | None = None,
        include_attributes: bool = True,
        video_frame_mode: str = "keyframes",
        dataset_items: dict[uuid.UUID, DatasetItem] | None = None,
    ) -> str:
        project, tasks, annotations = await self._load_data(project_id, batch_id)
        if not project:
            return json.dumps({})
        if project.type_key == "video-track":
            return await self.export_video_tracks(
                project_id,
                batch_id=batch_id,
                include_attributes=include_attributes,
                video_frame_mode=video_frame_mode,
            )
        _assert_image_export_supported(project, "coco")

        # v0.10.17 · COCO categories 按 tool_unit 分组. tool_bindings 提供 N 个工具
        # 单位, 每单位贡献一段 categories; supercategory = tool_unit_id; category.id
        # 全局唯一. 同名类不去重 (强隔离). cat_map 由 (tool_unit_id, class_name) → id 查.
        # 兼容: tool_bindings 为空 (理论上不应出现, 全部已 backfill) 时派生空类集.
        categories: list[dict] = []
        cat_map: dict[tuple[str, str], int] = {}
        tb = project.tool_bindings or {}
        next_cat_id = 0
        if tb:
            for unit_id, binding in tb.items():
                if not isinstance(binding, dict) or not binding.get("enabled"):
                    continue
                for cls in binding.get("classes") or []:
                    if not isinstance(cls, dict):
                        continue
                    name = cls.get("name")
                    if not name:
                        continue
                    categories.append(
                        {
                            "id": next_cat_id,
                            "name": name,
                            "supercategory": unit_id,
                        }
                    )
                    cat_map[(unit_id, name)] = next_cat_id
                    next_cat_id += 1
        else:
            for name in derive_classes_list(project.tool_bindings):
                categories.append(
                    {"id": next_cat_id, "name": name, "supercategory": "bbox"}
                )
                cat_map[("bbox", name)] = next_cat_id
                next_cat_id += 1

        def _find_category_id(ann_obj) -> int:
            unit = getattr(ann_obj, "tool_unit_id", None) or "bbox"
            cid = cat_map.get((unit, ann_obj.class_name))
            if cid is not None:
                return cid
            # 兜底: 强隔离同名不存在时, 跨 unit 同名取第一个; 都没有就 0.
            for (_, n), v in cat_map.items():
                if n == ann_obj.class_name:
                    return v
            return 0

        # v0.10.27 · 像素坐标改用 DatasetItem.width/height 真值, 缺失再回退常量。
        items = dataset_items or {}

        def _dims_for(task: Task) -> tuple[int, int]:
            item = items.get(task.dataset_item_id) if task.dataset_item_id else None
            w = item.width if item and item.width else IMG_W
            h = item.height if item and item.height else IMG_H
            return w, h

        images = []
        dims_by_task: dict[uuid.UUID, tuple[int, int]] = {}
        for i, t in enumerate(tasks):
            w, h = _dims_for(t)
            dims_by_task[t.id] = (w, h)
            images.append(
                {
                    "id": i,
                    "file_name": t.file_name,
                    "width": w,
                    "height": h,
                }
            )
        task_id_to_img_id = {t.id: i for i, t in enumerate(tasks)}

        coco_annotations = []
        for ann in annotations:
            img_id = task_id_to_img_id.get(ann.task_id)
            if img_id is None:
                continue
            g = _bbox_geometry(ann)
            if g is None:
                continue
            img_w, img_h = dims_by_task.get(ann.task_id, (IMG_W, IMG_H))
            x_px = g["x"] * img_w
            y_px = g["y"] * img_h
            w_px = g["w"] * img_w
            h_px = g["h"] * img_h
            row = {
                "id": len(coco_annotations),
                "image_id": img_id,
                "category_id": _find_category_id(ann),
                "bbox": [
                    round(x_px, 2),
                    round(y_px, 2),
                    round(w_px, 2),
                    round(h_px, 2),
                ],
                "area": round(w_px * h_px, 2),
                "iscrowd": 0,
            }
            if include_attributes:
                row["attributes"] = ann.attributes or {}
            coco_annotations.append(row)

        info = {
            "description": project.name,
            "version": "1.0",
            "date_created": datetime.utcnow().isoformat(),
        }
        if include_attributes:
            info["attribute_schema"] = derive_attribute_schema(project.tool_bindings)

        coco = {
            "info": info,
            "images": images,
            "annotations": coco_annotations,
            "categories": categories,
        }
        return json.dumps(coco, ensure_ascii=False, indent=2)

    async def export_yolo(
        self,
        project_id: uuid.UUID,
        *,
        batch_id: uuid.UUID | None = None,
        include_attributes: bool = True,
    ) -> bytes:
        project, tasks, annotations = await self._load_data(project_id, batch_id)
        if not project:
            return b""
        _assert_image_export_supported(project, "yolo")

        yolo_classes = derive_classes_list(project.tool_bindings)
        cat_map = {name: i for i, name in enumerate(yolo_classes)}
        ann_by_task: dict[uuid.UUID, list[Annotation]] = {}
        for ann in annotations:
            ann_by_task.setdefault(ann.task_id, []).append(ann)

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            classes_txt = "\n".join(yolo_classes)
            zf.writestr("classes.txt", classes_txt)

            if include_attributes:
                # 包内根目录写一份属性 schema，下游训练 ingest 可解析
                zf.writestr(
                    "attribute_schema.json",
                    json.dumps(
                        derive_attribute_schema(project.tool_bindings),
                        ensure_ascii=False,
                        indent=2,
                    ),
                )

            for t in tasks:
                lines = []
                attrs_per_line: list[dict] = []
                for ann in ann_by_task.get(t.id, []):
                    g = _bbox_geometry(ann)
                    if g is None:
                        continue
                    cx = g["x"] + g["w"] / 2
                    cy = g["y"] + g["h"] / 2
                    cid = cat_map.get(ann.class_name, 0)
                    lines.append(f"{cid} {cx:.6f} {cy:.6f} {g['w']:.6f} {g['h']:.6f}")
                    if include_attributes:
                        attrs_per_line.append(ann.attributes or {})

                base = t.file_name.rsplit(".", 1)[0]
                zf.writestr(f"labels/{base}.txt", "\n".join(lines))
                if include_attributes and attrs_per_line:
                    # 伴生属性文件：行索引与 .txt 行号对齐
                    zf.writestr(
                        f"labels/{base}.attrs.json",
                        json.dumps({"attributes": attrs_per_line}, ensure_ascii=False),
                    )

        return buf.getvalue()

    async def export_voc(
        self,
        project_id: uuid.UUID,
        *,
        batch_id: uuid.UUID | None = None,
        include_attributes: bool = True,
    ) -> bytes:
        project, tasks, annotations = await self._load_data(project_id, batch_id)
        if not project:
            return b""
        _assert_image_export_supported(project, "voc")

        ann_by_task: dict[uuid.UUID, list[Annotation]] = {}
        for ann in annotations:
            ann_by_task.setdefault(ann.task_id, []).append(ann)

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for t in tasks:
                root = Element("annotation")
                SubElement(root, "filename").text = t.file_name
                size = SubElement(root, "size")
                SubElement(size, "width").text = str(IMG_W)
                SubElement(size, "height").text = str(IMG_H)
                SubElement(size, "depth").text = "3"

                for ann in ann_by_task.get(t.id, []):
                    g = _bbox_geometry(ann)
                    if g is None:
                        continue
                    obj = SubElement(root, "object")
                    SubElement(obj, "name").text = ann.class_name
                    SubElement(obj, "difficult").text = "0"
                    bndbox = SubElement(obj, "bndbox")
                    SubElement(bndbox, "xmin").text = str(round(g["x"] * IMG_W))
                    SubElement(bndbox, "ymin").text = str(round(g["y"] * IMG_H))
                    SubElement(bndbox, "xmax").text = str(
                        round((g["x"] + g["w"]) * IMG_W)
                    )
                    SubElement(bndbox, "ymax").text = str(
                        round((g["y"] + g["h"]) * IMG_H)
                    )
                    if include_attributes and ann.attributes:
                        extra = SubElement(obj, "extra")
                        for k, v in ann.attributes.items():
                            SubElement(extra, str(k)).text = (
                                str(v) if v is not None else ""
                            )

                xml_name = t.file_name.rsplit(".", 1)[0] + ".xml"
                zf.writestr(
                    f"Annotations/{xml_name}", tostring(root, encoding="unicode")
                )

        return buf.getvalue()

    async def export_aap_json(
        self,
        project_id: uuid.UUID,
        *,
        batch_id: uuid.UUID | None = None,
    ) -> str:
        """v0.10.15 · AAP JSON v1.0 无损中间格式.

        与 COCO/YOLO/VOC 并列, 但**包含**它们丢失的字段: attribute_schema 值、
        prediction.confidence、annotation.source、annotation_guide、classes_config.
        双数组 annotations[] / predictions[] 分开 (不混 type 字段).
        """
        from app.services.prediction import to_internal_shape

        project, tasks, annotations = await self._load_data(project_id, batch_id)
        if not project:
            return json.dumps({})

        task_ids = [t.id for t in tasks]
        predictions = await self._load_predictions(project_id, task_ids)

        ann_by_task: dict[uuid.UUID, list[Annotation]] = {}
        for ann in annotations:
            ann_by_task.setdefault(ann.task_id, []).append(ann)
        pred_by_task: dict[uuid.UUID, list[Prediction]] = {}
        for pred in predictions:
            pred_by_task.setdefault(pred.task_id, []).append(pred)

        # v0.10.31 · 视频项目: 给每个 task block 填 media_type + video 子块.
        is_video = project.data_type == "video"
        dataset_items = await self._load_dataset_items(tasks) if is_video else {}

        # batch display_id (项目级导出时为 None)
        batch_display_id: str | None = None
        if batch_id:
            from app.db.models.task_batch import TaskBatch  # 懒导入避免循环

            batch = await self.db.get(TaskBatch, batch_id)
            batch_display_id = batch.display_id if batch else None

        task_blocks: list[AAPTaskBlock] = []
        for t in tasks:
            ann_entries: list[AAPAnnotationEntry] = []
            for ann in ann_by_task.get(t.id, []):
                ann_entries.append(
                    AAPAnnotationEntry(
                        geometry=ann.geometry or {},
                        class_name=ann.class_name,
                        # v0.10.17 · 工具维度绑定 (1.1+).
                        tool_unit_id=getattr(ann, "tool_unit_id", None) or "bbox",
                        attributes=ann.attributes or {},
                        confidence=ann.confidence,
                        source=ann.source,
                        user_id=ann.user_id,
                        created_at=ann.created_at,
                        external_id=None,
                    )
                )

            pred_entries: list[AAPPredictionEntry] = []
            for pred in pred_by_task.get(t.id, []):
                # prediction.result 存 LS shape 数组; 每个 shape 对应一个目标物.
                # 走 to_internal_shape() 反推内部 geometry + class_name.
                pred_unit = getattr(pred, "tool_unit_id", None) or "bbox"
                for raw_shape in pred.result or []:
                    internal = to_internal_shape(raw_shape)
                    geometry = internal.get("geometry") or {}
                    if not geometry:
                        continue
                    pred_entries.append(
                        AAPPredictionEntry(
                            geometry=geometry,
                            class_name=internal.get("class_name") or None,
                            tool_unit_id=pred_unit,
                            confidence=internal.get("confidence"),
                            model_version=pred.model_version,
                            score=pred.score,
                            source=pred.source,
                            created_at=pred.created_at,
                            external_id=None,
                        )
                    )

            media_type = "image"
            video_block: dict | None = None
            if is_video:
                media_type = "video"
                item = (
                    dataset_items.get(t.dataset_item_id) if t.dataset_item_id else None
                )
                vmeta = _video_metadata(item)
                video_block = {
                    "sampling": project.video_sampling or {},
                    "fps": vmeta.get("fps"),
                    "frame_count": vmeta.get("frame_count"),
                    "duration_ms": vmeta.get("duration_ms"),
                    "width": vmeta.get("width"),
                    "height": vmeta.get("height"),
                }

            task_blocks.append(
                AAPTaskBlock(
                    task_match=AAPTaskMatch(
                        display_id=t.display_id, file_path=t.file_path
                    ),
                    file_path=t.file_path,
                    media_type=media_type,
                    video=video_block,
                    external_id=None,
                    annotations=ann_entries,
                    predictions=pred_entries,
                )
            )

        envelope = AAPJsonV1Envelope(
            schema_version=AAP_SCHEMA_VERSION,
            exported_at=datetime.utcnow(),
            exported_from=AAPExportedFrom(
                platform="aap",
                platform_version=None,
                project_display_id=project.display_id,
                batch_display_id=batch_display_id,
            ),
            project=AAPProjectMeta(
                name=project.name,
                type_key=project.type_key,
                classes_config=derive_classes_config(project.tool_bindings),
                attribute_schema=derive_attribute_schema(project.tool_bindings),
                # v0.10.17 · 工具维度绑定 (1.1+).
                tool_bindings=project.tool_bindings or {},
                rendering_config=project.rendering_config or {},
                annotation_guide=getattr(project, "annotation_guide", None),
            ),
            tasks=task_blocks,
        )

        # 严格写满 null: 走 mode="json" + exclude_none=False (默认).
        return envelope.model_dump_json(indent=2, exclude_none=False)
