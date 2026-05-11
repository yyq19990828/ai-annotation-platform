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
from app.db.models.task import Task
from app.db.models.project import Project
from app.services.video_tracks import (
    VIDEO_FRAME_MODES,
    clean_keyframe,
    resolved_track_frames,
    sorted_keyframes,
)

IMG_W, IMG_H = 1920, 1280
VIDEO_PROJECT_TYPES = {"video-track", "video-mm"}


class UnsupportedExportError(ValueError):
    pass


def _assert_image_export_supported(project: Project) -> None:
    if project.type_key in VIDEO_PROJECT_TYPES:
        raise UnsupportedExportError(
            "Only video-track projects support Video JSON export; this project type and export format combination is not supported"
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
        categories = [{"id": i, "name": name} for i, name in enumerate(project.classes)]

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
            project_row["attribute_schema"] = project.attribute_schema or {"fields": []}

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
        _assert_image_export_supported(project)

        categories = [{"id": i, "name": name} for i, name in enumerate(project.classes)]
        cat_map = {c["name"]: c["id"] for c in categories}

        images = []
        for i, t in enumerate(tasks):
            images.append(
                {
                    "id": i,
                    "file_name": t.file_name,
                    "width": IMG_W,
                    "height": IMG_H,
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
            x_px = g["x"] * IMG_W
            y_px = g["y"] * IMG_H
            w_px = g["w"] * IMG_W
            h_px = g["h"] * IMG_H
            row = {
                "id": len(coco_annotations),
                "image_id": img_id,
                "category_id": cat_map.get(ann.class_name, 0),
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
            info["attribute_schema"] = project.attribute_schema or {"fields": []}

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
        _assert_image_export_supported(project)

        cat_map = {name: i for i, name in enumerate(project.classes)}
        ann_by_task: dict[uuid.UUID, list[Annotation]] = {}
        for ann in annotations:
            ann_by_task.setdefault(ann.task_id, []).append(ann)

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            classes_txt = "\n".join(project.classes)
            zf.writestr("classes.txt", classes_txt)

            if include_attributes:
                # 包内根目录写一份属性 schema，下游训练 ingest 可解析
                zf.writestr(
                    "attribute_schema.json",
                    json.dumps(
                        project.attribute_schema or {"fields": []},
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
        _assert_image_export_supported(project)

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
