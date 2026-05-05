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
from app.db.models.task import Task
from app.db.models.project import Project

IMG_W, IMG_H = 1920, 1280


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

    async def export_coco(
        self,
        project_id: uuid.UUID,
        *,
        batch_id: uuid.UUID | None = None,
        include_attributes: bool = True,
    ) -> str:
        project, tasks, annotations = await self._load_data(project_id, batch_id)
        if not project:
            return json.dumps({})

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
            g = ann.geometry
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
                    g = ann.geometry
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
                    g = ann.geometry
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
