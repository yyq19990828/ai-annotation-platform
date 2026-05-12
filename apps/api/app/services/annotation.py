from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.prediction import Prediction
from app.db.models.task import Task
from app.db.models.task_lock import AnnotationDraft
from app.services.video_tracks import (
    frame_is_outside,
    normalize_outside_ranges,
    resolved_track_frames,
    resolve_track_at_frame,
    sorted_keyframes,
)

VIDEO_BBOX_CONVERSION_LIMIT = 5000


def _new_track_id() -> str:
    return f"trk_{uuid.uuid4()}"


def _clean_bbox_geometry(geometry: dict) -> dict:
    return {
        "x": float(geometry.get("x", 0)),
        "y": float(geometry.get("y", 0)),
        "w": float(geometry.get("w", 0)),
        "h": float(geometry.get("h", 0)),
    }


def _composition_keyframe(frame_index: int, bbox: dict, *, source: str = "manual") -> dict:
    return {
        "frame_index": int(frame_index),
        "bbox": _clean_bbox_geometry(bbox),
        "source": "prediction" if source == "prediction" else "manual",
        "absent": False,
        "occluded": False,
    }


def _track_visible_keyframes(geometry: dict) -> list[dict]:
    return [
        kf
        for kf in sorted_keyframes(geometry)
        if not kf.get("absent")
        and not frame_is_outside(geometry, int(kf.get("frame_index", 0)))
    ]


def _clip_outside_ranges(geometry: dict, *, start: int | None, end: int | None) -> list[dict]:
    out: list[dict] = []
    for range_ in geometry.get("outside") or []:
        from_frame = int(range_.get("from", 0))
        to_frame = int(range_.get("to", 0))
        if start is not None:
            from_frame = max(from_frame, start)
        if end is not None:
            to_frame = min(to_frame, end)
        if from_frame <= to_frame:
            out.append({
                "from": from_frame,
                "to": to_frame,
                "source": "prediction" if range_.get("source") == "prediction" else "manual",
            })
    return normalize_outside_ranges(out)


class AnnotationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        annotation_type: str,
        class_name: str,
        geometry: dict,
        confidence: float | None = None,
        parent_prediction_id: uuid.UUID | None = None,
        lead_time: float | None = None,
        attributes: dict | None = None,
    ) -> Annotation:
        task = await self.db.get(Task, task_id)
        source = "prediction_based" if parent_prediction_id else "manual"

        annotation = Annotation(
            id=uuid.uuid4(),
            task_id=task_id,
            project_id=task.project_id if task else None,
            user_id=user_id,
            source=source,
            annotation_type=annotation_type,
            class_name=class_name,
            geometry=geometry,
            confidence=confidence,
            parent_prediction_id=parent_prediction_id,
            lead_time=lead_time,
            attributes=attributes or {},
        )
        self.db.add(annotation)
        await self.db.flush()

        await self._update_task_stats(task_id)
        return annotation

    async def accept_prediction(
        self,
        prediction_id: uuid.UUID,
        user_id: uuid.UUID,
        shape_index: int | None = None,
    ) -> Annotation | None:
        """采纳预测 → 转 annotation.

        - shape_index=None: 采纳整条 prediction 的所有 shape (旧默认, 用于"全部采纳"按钮).
        - shape_index=i:    仅采纳第 i 个 shape (用于画布单点"采纳"按钮, 避免一键采纳波及同 prediction 下其它框).
          每条 annotation 在 attributes 里写入 _shape_index, 让前端能按 (predictionId, shapeIndex) 双键判定.
        """
        prediction = await self.db.get(Prediction, prediction_id)
        if not prediction:
            return None

        # v0.9.7 fix · prediction.result 是 LabelStudio 标准, 转内部 schema 后入 annotation
        from app.services.prediction import to_internal_shape
        from app.db.models.project import Project

        # B-11 · DINO 写入的 class_name 是项目类别的英文 alias; 采纳时反查
        # classes_config 把 alias 映射回原类别名 (中文 / 业务名).
        project = await self.db.get(Project, prediction.project_id)
        alias_to_name: dict[str, str] = {}
        if project and isinstance(project.classes_config, dict):
            for cls_name, entry in project.classes_config.items():
                if not isinstance(entry, dict):
                    continue
                alias = entry.get("alias")
                if isinstance(alias, str) and alias.strip():
                    alias_to_name[alias.strip().lower()] = cls_name

        raw_shapes = list(prediction.result or [])
        if shape_index is not None:
            if not (0 <= shape_index < len(raw_shapes)):
                return None
            indexed = [(shape_index, raw_shapes[shape_index])]
        else:
            indexed = list(enumerate(raw_shapes))

        annotation: Annotation | None = None
        for idx, raw_shape in indexed:
            shape = to_internal_shape(raw_shape)
            raw_class = shape.get("class_name", "") or ""
            mapped_class = alias_to_name.get(raw_class.strip().lower(), raw_class)
            annotation = Annotation(
                id=uuid.uuid4(),
                task_id=prediction.task_id,
                project_id=prediction.project_id,
                user_id=user_id,
                source="prediction_based",
                annotation_type=shape.get("type", "bbox"),
                class_name=mapped_class,
                geometry=shape.get("geometry", {}),
                confidence=shape.get("confidence"),
                parent_prediction_id=prediction_id,
                attributes={"_shape_index": idx},
            )
            self.db.add(annotation)

        await self.db.flush()
        await self._update_task_stats(prediction.task_id)
        return annotation

    async def list_by_task(
        self, task_id: uuid.UUID, include_cancelled: bool = False
    ) -> list[Annotation]:
        q = select(Annotation).where(
            Annotation.task_id == task_id, Annotation.is_active.is_(True)
        )
        if not include_cancelled:
            q = q.where(Annotation.was_cancelled.is_(False))
        q = q.order_by(Annotation.created_at)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def list_by_task_keyset(
        self,
        task_id: uuid.UUID,
        *,
        limit: int = 200,
        cursor: tuple[datetime, uuid.UUID] | None = None,
        include_cancelled: bool = False,
    ) -> tuple[list[Annotation], tuple[datetime, uuid.UUID] | None]:
        """v0.7.6 · keyset 分页：created_at DESC, id DESC。next_cursor=None 时已末页。

        cursor 元组语义：取「严格小于」该 (ts, id) 的下一页。
        排序键参考 alembic 0031 的 ix_annotations_task_created_id 复合索引。
        """
        q = select(Annotation).where(
            Annotation.task_id == task_id, Annotation.is_active.is_(True)
        )
        if not include_cancelled:
            q = q.where(Annotation.was_cancelled.is_(False))
        if cursor is not None:
            cur_ts, cur_id = cursor
            q = q.where(
                (Annotation.created_at < cur_ts)
                | ((Annotation.created_at == cur_ts) & (Annotation.id < cur_id))
            )
        q = q.order_by(Annotation.created_at.desc(), Annotation.id.desc()).limit(limit)
        rows = list((await self.db.execute(q)).scalars().all())
        next_cursor: tuple[datetime, uuid.UUID] | None = None
        if len(rows) == limit and rows:
            tail = rows[-1]
            next_cursor = (tail.created_at, tail.id)
        return rows, next_cursor

    async def delete(self, annotation_id: uuid.UUID) -> bool:
        annotation = await self.db.get(Annotation, annotation_id)
        if not annotation:
            return False
        annotation.is_active = False
        await self.db.flush()
        await self._update_task_stats(annotation.task_id)
        return True

    async def update(
        self,
        annotation_id: uuid.UUID,
        geometry: dict | None = None,
        class_name: str | None = None,
        confidence: float | None = None,
        attributes: dict | None = None,
    ) -> Annotation | None:
        """Surgical update of mutable fields. Increments version for optimistic concurrency."""
        annotation = await self.db.get(Annotation, annotation_id)
        if not annotation or not annotation.is_active:
            return None
        if geometry is not None:
            annotation.geometry = geometry
        if class_name is not None:
            annotation.class_name = class_name
        if confidence is not None:
            annotation.confidence = confidence
        if attributes is not None:
            annotation.attributes = attributes
        annotation.version += 1
        await self.db.flush()
        return annotation

    async def convert_video_track_to_bboxes(
        self,
        *,
        task: Task,
        annotation: Annotation,
        user_id: uuid.UUID,
        operation: str,
        scope: str,
        frame_index: int | None = None,
        frame_mode: str = "keyframes",
        frame_count: int | None = None,
        max_created: int = VIDEO_BBOX_CONVERSION_LIMIT,
    ) -> tuple[Annotation | None, list[Annotation], bool, list[int]]:
        geometry = annotation.geometry or {}
        if geometry.get("type") != "video_track":
            raise ValueError("annotation must be a video_track")

        frames: list[dict]
        removed_frame_indexes: list[int] = []
        deleted_source = False

        if scope == "frame":
            if frame_index is None:
                raise ValueError("frame_index is required for frame scope")
            keyframes = sorted_keyframes(geometry)
            if operation == "split":
                exact = next(
                    (
                        kf
                        for kf in keyframes
                        if int(kf.get("frame_index", 0)) == frame_index
                    ),
                    None,
                )
                if not exact or exact.get("absent") or frame_is_outside(geometry, frame_index):
                    raise ValueError(
                        "frame split requires an exact non-absent keyframe"
                    )
                frames = [
                    {
                        "frame_index": frame_index,
                        "bbox": exact.get("bbox") or {},
                        "source": exact.get("source", "manual"),
                    }
                ]
                removed_frame_indexes = [frame_index]
            else:
                resolved = resolve_track_at_frame(geometry, frame_index)
                if not resolved:
                    raise ValueError("track has no bbox at the requested frame")
                frames = [resolved]
        elif scope == "track":
            frames = resolved_track_frames(
                geometry,
                frame_mode=frame_mode,
                frame_count=frame_count,
            )
            if operation == "split":
                removed_frame_indexes = [int(frame["frame_index"]) for frame in frames]
        else:
            raise ValueError("scope must be one of: frame, track")

        if not frames:
            raise ValueError("track conversion produced no frames")
        if len(frames) > max_created:
            raise ValueError(
                f"track conversion would create more than {max_created} bboxes"
            )

        created: list[Annotation] = []
        for frame in frames:
            bbox = frame.get("bbox") or {}
            created_ann = Annotation(
                id=uuid.uuid4(),
                task_id=task.id,
                project_id=task.project_id,
                user_id=user_id,
                source=annotation.source,
                annotation_type="video_bbox",
                class_name=annotation.class_name,
                geometry={
                    "type": "video_bbox",
                    "frame_index": int(frame.get("frame_index", 0)),
                    "x": bbox.get("x", 0),
                    "y": bbox.get("y", 0),
                    "w": bbox.get("w", 0),
                    "h": bbox.get("h", 0),
                },
                confidence=annotation.confidence,
                parent_annotation_id=annotation.id,
                attributes=dict(annotation.attributes or {}),
            )
            self.db.add(created_ann)
            created.append(created_ann)

        if operation == "split":
            if scope == "frame":
                remaining = [
                    kf
                    for kf in sorted_keyframes(geometry)
                    if int(kf.get("frame_index", 0)) != frame_index
                ]
                if remaining:
                    annotation.geometry = {**geometry, "keyframes": remaining}
                    annotation.version += 1
                else:
                    annotation.is_active = False
                    deleted_source = True
            else:
                annotation.is_active = False
                deleted_source = True

        await self.db.flush()
        await self._update_task_stats(task.id)
        source = None if deleted_source else annotation
        return source, created, deleted_source, removed_frame_indexes

    async def compose_video_tracks(
        self,
        *,
        task: Task,
        annotations: list[Annotation],
        user_id: uuid.UUID,
        operation: str,
        frame_index: int | None = None,
        delete_sources: bool = True,
    ) -> tuple[list[Annotation], list[Annotation], list[uuid.UUID]]:
        if operation == "aggregate_bboxes":
            updated, created, deleted = await self._aggregate_video_bboxes(
                task=task,
                annotations=annotations,
                user_id=user_id,
                delete_sources=delete_sources,
            )
        elif operation == "split_track":
            updated, created, deleted = await self._split_video_track(
                task=task,
                annotations=annotations,
                user_id=user_id,
                frame_index=frame_index,
            )
        elif operation == "merge_tracks":
            updated, created, deleted = await self._merge_video_tracks(
                task=task,
                annotations=annotations,
            )
        else:
            raise ValueError("unsupported composition operation")

        await self.db.flush()
        await self._update_task_stats(task.id)
        return updated, created, deleted

    async def _aggregate_video_bboxes(
        self,
        *,
        task: Task,
        annotations: list[Annotation],
        user_id: uuid.UUID,
        delete_sources: bool,
    ) -> tuple[list[Annotation], list[Annotation], list[uuid.UUID]]:
        if not annotations:
            raise ValueError("annotation_ids is required")
        if any((ann.geometry or {}).get("type") != "video_bbox" for ann in annotations):
            raise ValueError("aggregate_bboxes only accepts video_bbox annotations")
        class_names = {ann.class_name for ann in annotations}
        if len(class_names) != 1:
            raise ValueError("video_bbox annotations must share one class")

        frames: dict[int, Annotation] = {}
        for ann in annotations:
            frame = int((ann.geometry or {}).get("frame_index", 0))
            if frame in frames:
                raise ValueError("video_bbox annotations must not share a frame_index")
            frames[frame] = ann

        ordered = [frames[frame] for frame in sorted(frames)]
        keyframes = [
            _composition_keyframe(
                int(ann.geometry.get("frame_index", 0)),
                ann.geometry,
                source="manual",
            )
            for ann in ordered
        ]
        created = Annotation(
            id=uuid.uuid4(),
            task_id=task.id,
            project_id=task.project_id,
            user_id=user_id,
            source=ordered[0].source,
            annotation_type="video_track",
            class_name=ordered[0].class_name,
            geometry={
                "type": "video_track",
                "track_id": _new_track_id(),
                "keyframes": keyframes,
                "outside": [],
            },
            confidence=ordered[0].confidence,
            attributes=dict(ordered[0].attributes or {}),
        )
        self.db.add(created)

        deleted_ids: list[uuid.UUID] = []
        if delete_sources:
            for ann in ordered:
                ann.is_active = False
                deleted_ids.append(ann.id)
        return [], [created], deleted_ids

    async def _split_video_track(
        self,
        *,
        task: Task,
        annotations: list[Annotation],
        user_id: uuid.UUID,
        frame_index: int | None,
    ) -> tuple[list[Annotation], list[Annotation], list[uuid.UUID]]:
        if frame_index is None:
            raise ValueError("frame_index is required for split_track")
        if len(annotations) != 1:
            raise ValueError("split_track requires exactly one annotation")
        source = annotations[0]
        geometry = source.geometry or {}
        if geometry.get("type") != "video_track":
            raise ValueError("split_track only accepts a video_track annotation")
        if not resolve_track_at_frame(geometry, frame_index):
            raise ValueError("split_track requires a visible frame")

        keyframes = sorted_keyframes(geometry)
        before_keyframes = [
            dict(kf) for kf in keyframes if int(kf.get("frame_index", 0)) <= frame_index
        ]
        if not any(int(kf.get("frame_index", 0)) == frame_index for kf in before_keyframes):
            resolved = resolve_track_at_frame(geometry, frame_index)
            if not resolved:
                raise ValueError("split_track requires a visible frame")
            before_keyframes.append(
                _composition_keyframe(frame_index, resolved.get("bbox") or {})
            )
        before_keyframes.sort(key=lambda kf: int(kf.get("frame_index", 0)))

        next_frame = frame_index + 1
        next_resolved = resolve_track_at_frame(geometry, next_frame)
        after_keyframes = [
            dict(kf) for kf in keyframes if int(kf.get("frame_index", 0)) > frame_index
        ]
        if next_resolved and not any(
            int(kf.get("frame_index", 0)) == next_frame for kf in after_keyframes
        ):
            after_keyframes.insert(
                0, _composition_keyframe(next_frame, next_resolved.get("bbox") or {})
            )
        after_keyframes.sort(key=lambda kf: int(kf.get("frame_index", 0)))
        if not _track_visible_keyframes({"type": "video_track", "keyframes": after_keyframes}):
            raise ValueError("split_track requires a visible tail segment")

        source.geometry = {
            **geometry,
            "keyframes": before_keyframes,
            "outside": _clip_outside_ranges(geometry, start=None, end=frame_index),
        }
        source.version += 1

        tail = Annotation(
            id=uuid.uuid4(),
            task_id=task.id,
            project_id=task.project_id,
            user_id=user_id,
            source=source.source,
            annotation_type="video_track",
            class_name=source.class_name,
            geometry={
                "type": "video_track",
                "track_id": _new_track_id(),
                "keyframes": after_keyframes,
                "outside": _clip_outside_ranges(geometry, start=next_frame, end=None),
            },
            confidence=source.confidence,
            parent_annotation_id=source.id,
            attributes=dict(source.attributes or {}),
        )
        self.db.add(tail)
        return [source], [tail], []

    async def _merge_video_tracks(
        self,
        *,
        task: Task,
        annotations: list[Annotation],
    ) -> tuple[list[Annotation], list[Annotation], list[uuid.UUID]]:
        if len(annotations) != 2:
            raise ValueError("merge_tracks requires exactly two annotations")
        if any((ann.geometry or {}).get("type") != "video_track" for ann in annotations):
            raise ValueError("merge_tracks only accepts video_track annotations")
        if annotations[0].class_name != annotations[1].class_name:
            raise ValueError("merge_tracks requires tracks with the same class")

        ranges: list[tuple[int, int, Annotation]] = []
        for ann in annotations:
            visible = _track_visible_keyframes(ann.geometry or {})
            if not visible:
                raise ValueError("merge_tracks requires visible keyframes")
            frames = [int(kf.get("frame_index", 0)) for kf in visible]
            ranges.append((min(frames), max(frames), ann))
        ranges.sort(key=lambda item: item[0])
        first_start, first_end, first = ranges[0]
        second_start, second_end, second = ranges[1]
        if first_end >= second_start:
            raise ValueError("merge_tracks requires non-overlapping tracks")

        survivor = annotations[0]
        removed = annotations[1]
        keyframes = [
            dict(kf)
            for ann in annotations
            for kf in sorted_keyframes(ann.geometry or {})
        ]
        frame_counts: dict[int, int] = {}
        for kf in keyframes:
            frame = int(kf.get("frame_index", 0))
            frame_counts[frame] = frame_counts.get(frame, 0) + 1
        if any(count > 1 for count in frame_counts.values()):
            raise ValueError("merge_tracks requires unique keyframe frame_index values")
        keyframes.sort(key=lambda kf: int(kf.get("frame_index", 0)))

        outside = [
            range_
            for ann in annotations
            for range_ in ((ann.geometry or {}).get("outside") or [])
        ]
        if first_end + 1 <= second_start - 1:
            outside.append({
                "from": first_end + 1,
                "to": second_start - 1,
                "source": "manual",
            })

        survivor.geometry = {
            **(survivor.geometry or {}),
            "type": "video_track",
            "track_id": (survivor.geometry or {}).get("track_id") or _new_track_id(),
            "keyframes": keyframes,
            "outside": normalize_outside_ranges(outside),
        }
        survivor.version += 1
        removed.is_active = False
        return [survivor], [], [removed.id]

    async def save_draft(
        self, task_id: uuid.UUID, user_id: uuid.UUID, result: dict
    ) -> AnnotationDraft:
        existing = await self.db.execute(
            select(AnnotationDraft).where(
                AnnotationDraft.task_id == task_id,
                AnnotationDraft.user_id == user_id,
            )
        )
        draft = existing.scalar_one_or_none()
        if draft:
            draft.result = result
        else:
            draft = AnnotationDraft(
                id=uuid.uuid4(),
                task_id=task_id,
                user_id=user_id,
                result=result,
            )
            self.db.add(draft)
        await self.db.flush()
        return draft

    async def get_draft(
        self, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> AnnotationDraft | None:
        result = await self.db.execute(
            select(AnnotationDraft).where(
                AnnotationDraft.task_id == task_id,
                AnnotationDraft.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def _update_task_stats(self, task_id: uuid.UUID) -> None:
        count_result = await self.db.execute(
            select(func.count()).where(
                Annotation.task_id == task_id,
                Annotation.is_active.is_(True),
                Annotation.was_cancelled.is_(False),
            )
        )
        count = count_result.scalar() or 0

        task = await self.db.get(Task, task_id)
        status_changed = False
        if task:
            task.total_annotations = count
            task.is_labeled = count > 0
            # B-20：首次产生标注 → 把 task 从 pending 转 in_progress；标注全删 → 回 pending。
            # 让 batch.in_progress_tasks / dashboard 进度条与"已动工"状态对齐。
            if count > 0 and task.status == "pending":
                task.status = "in_progress"
                status_changed = True
            elif count == 0 and task.status == "in_progress":
                task.status = "pending"
                status_changed = True
        await self.db.flush()

        if status_changed and task and task.batch_id:
            # 在函数内 import 避免 services 层循环依赖。
            from app.services.batch import BatchService

            batch_svc = BatchService(self.db)
            await batch_svc.check_auto_transitions(task.batch_id)
            await batch_svc.recalculate_counters(task.batch_id)
