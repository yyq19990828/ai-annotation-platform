from __future__ import annotations

import copy
import uuid
from datetime import datetime
from sqlalchemy import select, func, text
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

# v0.14.1 · 可跨帧 propagate 的几何类型。视频内 track 几何由 video_tracker_runner
# 处理(case A 内部), point_mask_3d 跨帧 point_indices 无意义(§5.4 留 v0.15+)。
PROPAGATABLE_GEOMETRY_TYPES = frozenset(
    {
        "box_3d",
        "bbox",
        "polygon",
        "multi_polygon",
        "rotated_bbox",
        "polyline",
        "keypoint",
    }
)


def _new_track_id() -> str:
    return f"trk_{uuid.uuid4()}"


def _clean_bbox_geometry(geometry: dict) -> dict:
    return {
        "x": float(geometry.get("x", 0)),
        "y": float(geometry.get("y", 0)),
        "w": float(geometry.get("w", 0)),
        "h": float(geometry.get("h", 0)),
    }


def _composition_keyframe(
    frame_index: int, bbox: dict, *, source: str = "manual"
) -> dict:
    return {
        "frame_index": int(frame_index),
        "bbox": _clean_bbox_geometry(bbox),
        "source": "prediction" if source == "prediction" else "manual",
        "occluded": False,
    }


def _track_visible_keyframes(geometry: dict) -> list[dict]:
    return [
        kf
        for kf in sorted_keyframes(geometry)
        if not frame_is_outside(geometry, int(kf.get("frame_index", 0)))
    ]


def _clip_outside_ranges(
    geometry: dict, *, start: int | None, end: int | None
) -> list[dict]:
    out: list[dict] = []
    for range_ in geometry.get("outside") or []:
        from_frame = int(range_.get("from", 0))
        to_frame = int(range_.get("to", 0))
        if start is not None:
            from_frame = max(from_frame, start)
        if end is not None:
            to_frame = min(to_frame, end)
        if from_frame <= to_frame:
            out.append(
                {
                    "from": from_frame,
                    "to": to_frame,
                    "source": "prediction"
                    if range_.get("source") == "prediction"
                    else "manual",
                }
            )
    return normalize_outside_ranges(out)


class AnnotationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _validate_class_name(
        self, project_id: uuid.UUID | None, tool_unit_id: str, class_name: str
    ) -> None:
        """v0.10.17 · 软校验: 若 project.tool_bindings 中该 unit 给出了 classes 集合,
        class_name 必须在内. 集合为空 (未配置 / 历史项目) 时放行兼容旧数据.
        create / accept_prediction / accept_all 共用同一段以避免分支漏校验.

        例外: "__unknown" 是前端 (apps/web/.../stage/colors.ts UNKNOWN_CLASS) 的兜底
        sentinel — 用户画完框按 Esc / 点画布外时落该类, 表示"未分类待补", 不属于
        任何 unit 的类别集合, 任意 unit 都放行.
        """
        if project_id is None:
            return
        if class_name == "__unknown":
            return
        from app.db.models.project import Project
        from app.services.project import lookup_classes_for_tool_unit
        from fastapi import HTTPException

        project = await self.db.get(Project, project_id)
        if project is None:
            return
        allowed = lookup_classes_for_tool_unit(
            project.tool_bindings or {}, tool_unit_id
        )
        if allowed and class_name not in allowed:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"class_name '{class_name}' 不在工具单位 "
                    f"'{tool_unit_id}' 的类别集合内"
                ),
            )

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
        tool_unit_id: str = "bbox",
    ) -> Annotation:
        task = await self.db.get(Task, task_id)
        source = "prediction_based" if parent_prediction_id else "manual"

        if task and task.project_id:
            await self._validate_class_name(task.project_id, tool_unit_id, class_name)

        annotation = Annotation(
            id=uuid.uuid4(),
            task_id=task_id,
            project_id=task.project_id if task else None,
            user_id=user_id,
            source=source,
            annotation_type=annotation_type,
            tool_unit_id=tool_unit_id,
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
        override_class_name: str | None = None,
    ) -> Annotation | None:
        """采纳预测 → 转 annotation.

        - shape_index=None: 采纳整条 prediction 的所有 shape (旧默认, 用于"全部采纳"按钮).
        - shape_index=i:    仅采纳第 i 个 shape (用于画布单点"采纳"按钮, 避免一键采纳波及同 prediction 下其它框).
          每条 annotation 在 attributes 里写入 _shape_index, 让前端能按 (predictionId, shapeIndex) 双键判定.
        """
        # v0.10.25 · predictions 复合 PK (id, created_at) 后不能用 db.get(单值)，改按 id 查。
        prediction = (
            await self.db.execute(
                select(Prediction).where(Prediction.id == prediction_id)
            )
        ).scalar_one_or_none()
        if not prediction:
            return None

        # v0.9.7 fix · prediction.result 是 LabelStudio 标准, 转内部 schema 后入 annotation
        from app.services.prediction import to_internal_shape
        from app.db.models.project import Project

        # B-11 · DINO 写入的 class_name 是项目类别的英文 alias; 采纳时反查
        # 对应 tool_unit 的 classes 把 alias 映射回原类别名 (中文 / 业务名).
        # v0.10.17 · 强隔离: 只查 prediction.tool_unit_id 对应 unit 的 classes,
        # 不再跨 unit 走派生 classes_config (不同 unit 同名类可有不同 alias).
        project = await self.db.get(Project, prediction.project_id)
        prediction_unit = getattr(prediction, "tool_unit_id", None) or "bbox"
        alias_to_name: dict[str, str] = {}
        if project is not None:
            binding = (project.tool_bindings or {}).get(prediction_unit) or {}
            for cls in binding.get("classes") or []:
                if not isinstance(cls, dict):
                    continue
                alias = cls.get("alias")
                cname = cls.get("name")
                if isinstance(alias, str) and alias.strip() and isinstance(cname, str):
                    alias_to_name[alias.strip().lower()] = cname

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
            # v0.14.17 · 采纳时选类: override_class_name 非空时直接用它 (人工指定项目标签),
            # 跳过 alias 反查 — 用于"预测类名既不在标签集、又无 alias 命中"时让人当场选类落库,
            # 不再 422 拒死。仍走下面同一段软校验。平台不做自动映射 (NG6)。
            mapped_class = (
                override_class_name
                if override_class_name
                else alias_to_name.get(raw_class.strip().lower(), raw_class)
            )
            # v0.10.17 · 走与 create 同一段 class_name 软校验, 避免 accept_prediction 写入
            # 不在 unit allowed 集合内的"幽灵类别"导致 UI 看不见 DB 仍有的记录.
            await self._validate_class_name(
                prediction.project_id, prediction_unit, mapped_class
            )
            # v0.14.9 · 协议 v2 OCR / doc_layout: 把 prediction shape 的富属性 (text /
            # language / orientation) 透传到 annotation.attributes。tool_binding 的
            # attribute_schema 未定义对应 key 时仍原样保留 (不静默丢、不硬校验), 让 OCR
            # 文本随采纳进人工标注。_shape_index 始终保留供前端双键判定。
            attributes: dict = {}
            shape_attributes = shape.get("attributes")
            if isinstance(shape_attributes, dict):
                attributes.update(shape_attributes)
            # 权威 _shape_index 放在最后, 防止 backend 在 shape attributes 里同名覆盖
            # 导致前端按 (predictionId, shapeIndex) 双键命中错位。
            attributes["_shape_index"] = idx
            annotation = Annotation(
                id=uuid.uuid4(),
                task_id=prediction.task_id,
                project_id=prediction.project_id,
                user_id=user_id,
                source="prediction_based",
                annotation_type=shape.get("type", "bbox"),
                # v0.10.17 · 沿用 prediction 的 tool_unit_id; to_internal_shape 输出的
                # shape.type 也可派生 unit (polygon → region), 但优先 prediction 行已落实.
                tool_unit_id=prediction_unit,
                class_name=mapped_class,
                geometry=shape.get("geometry", {}),
                confidence=shape.get("confidence"),
                parent_prediction_id=prediction_id,
                attributes=attributes,
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

    async def bulk_update(
        self,
        ids: list[uuid.UUID],
        *,
        class_name: str | None = None,
        attributes: dict | None = None,
        z_order: int | None = None,
        is_locked: bool | None = None,
        is_hidden: bool | None = None,
        group_id: int | None = None,
        group_id_explicit_clear: bool = False,
    ) -> list[Annotation]:
        """I12 · 批量 patch N 个标注. 任一标注被锁/已软删则整体 422.

        调用方负责在外层加 _assert_task_editable + assert_project_visible.
        """
        from fastapi import HTTPException

        if not ids:
            return []
        rows = (
            (await self.db.execute(select(Annotation).where(Annotation.id.in_(ids))))
            .scalars()
            .all()
        )
        if len(rows) != len(ids):
            missing = set(ids) - {r.id for r in rows}
            raise HTTPException(
                status_code=404,
                detail=f"annotations not found: {sorted(str(m) for m in missing)}",
            )
        # 整体校验: 任一被锁 / 已软删 → 422 + 整体回滚 (调用方上游事务承担).
        for r in rows:
            if not r.is_active:
                raise HTTPException(
                    status_code=422,
                    detail=f"annotation {r.id} is not active",
                )
            if r.is_locked and (
                class_name is not None
                or attributes is not None
                or z_order is not None
                or group_id is not None
                or group_id_explicit_clear
            ):
                raise HTTPException(
                    status_code=422,
                    detail=f"annotation {r.id} is locked; unlock it first",
                )
        # class_name 走软校验 (复用 _validate_class_name); bulk 时按 tool_unit_id 分桶,
        # 每桶各校验一次, 避免 N 次同 unit 重复查 project.tool_bindings.
        if class_name is not None:
            by_unit: dict[tuple[uuid.UUID | None, str], None] = {}
            for r in rows:
                by_unit[(r.project_id, r.tool_unit_id)] = None
            for (pid, unit), _ in by_unit.items():
                await self._validate_class_name(pid, unit, class_name)
        for r in rows:
            if class_name is not None:
                r.class_name = class_name
            if attributes is not None:
                r.attributes = attributes
            if z_order is not None:
                r.z_order = z_order
            if is_locked is not None:
                r.is_locked = is_locked
            if is_hidden is not None:
                r.is_hidden = is_hidden
            if group_id is not None:
                r.group_id = group_id
            elif group_id_explicit_clear:
                r.group_id = None
            r.version += 1
        await self.db.flush()
        return rows

    async def group(
        self,
        ids: list[uuid.UUID],
        task_id: uuid.UUID,
    ) -> tuple[int, list[Annotation]]:
        """I12 · 把 ids 合到一个新 group; 序号从 tasks.next_group_seq 自增取.

        ids 中可能已含部分有 group_id 的成员; 此实现"覆盖式": 全部改写到新序号,
        旧 group 残留的成员保留旧 group_id (不级联清理, 避免误伤其它框).
        """
        from fastapi import HTTPException

        if len(ids) < 2:
            raise HTTPException(
                status_code=422,
                detail="grouping requires at least 2 annotations",
            )
        # 校验 ids 都属于该 task.
        rows = (
            (await self.db.execute(select(Annotation).where(Annotation.id.in_(ids))))
            .scalars()
            .all()
        )
        if len(rows) != len(ids):
            raise HTTPException(status_code=404, detail="some annotations not found")
        for r in rows:
            if r.task_id != task_id:
                raise HTTPException(
                    status_code=422,
                    detail=f"annotation {r.id} does not belong to task {task_id}",
                )
            if not r.is_active or r.is_locked:
                raise HTTPException(
                    status_code=422,
                    detail=f"annotation {r.id} not editable (inactive/locked)",
                )
        # 自增 task.next_group_seq, 拿到新 group_id (单 UPDATE ... RETURNING 原子).
        task = await self.db.get(Task, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail=f"task {task_id} not found")
        task.next_group_seq += 1
        new_group_id = task.next_group_seq
        for r in rows:
            r.group_id = new_group_id
            r.version += 1
        await self.db.flush()
        return new_group_id, rows

    async def _resolve_axis_convention(self, task: Task) -> str | None:
        """v0.14.1 · 取 task 主 dataset_item 所在 dataset 的 axis_convention。
        无主 item / 无 metadata key → None(前端按 iso_8855 identity 处理)。"""
        from app.db.models.dataset import Dataset
        from app.services.scene import resolve_primary_item_id

        primary_item_id = await resolve_primary_item_id(self.db, task)
        if primary_item_id is None:
            return None
        from app.db.models.dataset import DatasetItem

        item = await self.db.get(DatasetItem, primary_item_id)
        if item is None:
            return None
        dataset = await self.db.get(Dataset, item.dataset_id)
        if dataset is None:
            return None
        return (dataset.metadata_ or {}).get("axis_convention")

    async def propagate(
        self,
        *,
        source_annotation_id: uuid.UUID,
        target_task_id: uuid.UUID,
        user_id: uuid.UUID,
        override_psr: dict | None = None,
    ) -> Annotation:
        """v0.14.1 · 跨帧目标延续: 把源 annotation 复制到目标 task。

        语义:
        - 仅复制静态几何(PROPAGATABLE_GEOMETRY_TYPES); video_* / point_mask_3d 拒。
        - 跨帧链共享 group_id: 源无 group_id 时从全局序列 cross_frame_group_seq
          分配一个(高位起始, 与 per-task next_group_seq 永不冲突)并写回源, 再复用。
        - box_3d 的 convention_at_create 取**目标** dataset 的 axis_convention:
          DB 内 PSR 永远是 ISO 系字节, 原值复制即对齐世界坐标; convention_at_create
          写目标值仅为让前端 banner 不误报(v0.13.11 安全网)。
        - override_psr 留扩展位, 给定时覆盖 box_3d 的 center/size/rotation。
        """
        from fastapi import HTTPException

        src = await self.db.get(Annotation, source_annotation_id)
        if src is None or not src.is_active:
            raise HTTPException(status_code=404, detail="source annotation not found")

        geom_type = (src.geometry or {}).get("type")
        if geom_type not in PROPAGATABLE_GEOMETRY_TYPES:
            raise HTTPException(
                status_code=422,
                detail=f"geometry type '{geom_type}' 不支持跨帧 propagate",
            )

        target_task = await self.db.get(Task, target_task_id)
        if target_task is None:
            raise HTTPException(status_code=404, detail="target task not found")

        src_task = await self.db.get(Task, src.task_id)
        if src_task is None:
            raise HTTPException(status_code=404, detail="source task not found")
        if target_task_id == src.task_id:
            raise HTTPException(
                status_code=422, detail="propagate 目标不能是源 task 自身"
            )
        # §5.6 · 严格同 project(跨 project/dataset/scene propagate 语义不成立)。
        if src_task.project_id != target_task.project_id:
            raise HTTPException(status_code=422, detail="跨 project propagate 不被允许")

        # 同 scene 校验: 两侧主 item 必须解析到相同且非空的 scene_id。
        from app.db.models.dataset import DatasetItem
        from app.services.scene import resolve_primary_item_id

        src_item_id = await resolve_primary_item_id(self.db, src_task)
        target_item_id = await resolve_primary_item_id(self.db, target_task)
        src_scene_id = None
        target_scene_id = None
        if src_item_id is not None:
            src_item = await self.db.get(DatasetItem, src_item_id)
            src_scene_id = src_item.scene_id if src_item is not None else None
        if target_item_id is not None:
            target_item = await self.db.get(DatasetItem, target_item_id)
            target_scene_id = target_item.scene_id if target_item is not None else None
        if (
            src_scene_id is None
            or target_scene_id is None
            or src_scene_id != target_scene_id
        ):
            raise HTTPException(status_code=422, detail="跨 scene propagate 不被允许")

        # 共享 group_id: 源无则分配并写回。
        group_id = src.group_id
        if group_id is None:
            seq_row = await self.db.execute(
                text("SELECT nextval('cross_frame_group_seq')")
            )
            group_id = int(seq_row.scalar_one())
            src.group_id = group_id
            src.version += 1

        geometry = copy.deepcopy(src.geometry or {})
        if geom_type == "box_3d":
            geometry["convention_at_create"] = await self._resolve_axis_convention(
                target_task
            )
            if override_psr:
                for key in ("center", "size", "rotation"):
                    if key in override_psr:
                        geometry[key] = override_psr[key]

        new_annotation = Annotation(
            id=uuid.uuid4(),
            task_id=target_task_id,
            project_id=target_task.project_id,
            user_id=user_id,
            source="manual",
            annotation_type=src.annotation_type,
            tool_unit_id=src.tool_unit_id,
            class_name=src.class_name,
            geometry=geometry,
            group_id=group_id,
            attributes=copy.deepcopy(src.attributes or {}),
        )
        self.db.add(new_annotation)
        await self.db.flush()
        await self._update_task_stats(target_task_id)
        return new_annotation

    async def ungroup(
        self,
        ids: list[uuid.UUID],
    ) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
        """I12 · 把 ids 的 group_id 置 null;
        若某 group 在此操作后仅剩 1 个成员, 该成员也自动 ungroup.

        返回 (主清理 ids, 自动清理的 orphan ids).
        """
        from fastapi import HTTPException

        if not ids:
            return [], []
        rows = (
            (await self.db.execute(select(Annotation).where(Annotation.id.in_(ids))))
            .scalars()
            .all()
        )
        if len(rows) != len(ids):
            raise HTTPException(status_code=404, detail="some annotations not found")
        affected_groups: dict[tuple[uuid.UUID, int], None] = {}
        for r in rows:
            if r.group_id is not None:
                affected_groups[(r.task_id, r.group_id)] = None
            r.group_id = None
            r.version += 1
        # 检查每个被影响 group 的剩余成员; 仅剩 1 个时自动 ungroup.
        orphans: list[uuid.UUID] = []
        for tid, gid in affected_groups.keys():
            remaining = (
                (
                    await self.db.execute(
                        select(Annotation).where(
                            Annotation.task_id == tid,
                            Annotation.group_id == gid,
                            Annotation.is_active == True,  # noqa: E712
                        )
                    )
                )
                .scalars()
                .all()
            )
            if len(remaining) == 1:
                orphan = remaining[0]
                orphan.group_id = None
                orphan.version += 1
                orphans.append(orphan.id)
        await self.db.flush()
        return [r.id for r in rows], orphans

    async def update(
        self,
        annotation_id: uuid.UUID,
        geometry: dict | None = None,
        class_name: str | None = None,
        confidence: float | None = None,
        attributes: dict | None = None,
        z_order: int | None = None,
        is_locked: bool | None = None,
        is_hidden: bool | None = None,
    ) -> Annotation | None:
        """Surgical update of mutable fields. Increments version for optimistic concurrency."""
        annotation = await self.db.get(Annotation, annotation_id)
        if not annotation or not annotation.is_active:
            return None
        if class_name is not None:
            # v0.14.17 · 与 create / accept_prediction 对齐: PATCH 改类也走软校验,
            # 堵住"采纳后 PATCH 改成项目标签集外的任意非法值"的数据质量缺口.
            await self._validate_class_name(
                annotation.project_id, annotation.tool_unit_id, class_name
            )
        if geometry is not None:
            annotation.geometry = geometry
        if class_name is not None:
            annotation.class_name = class_name
        if confidence is not None:
            annotation.confidence = confidence
        if attributes is not None:
            annotation.attributes = attributes
        # v0.10.5 M4-β · shape 状态位字段级 PATCH（I15）
        if z_order is not None:
            annotation.z_order = z_order
        if is_locked is not None:
            annotation.is_locked = is_locked
        if is_hidden is not None:
            annotation.is_hidden = is_hidden
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
        if geometry.get("type") != "video_track_bbox":
            raise ValueError("annotation must be a video_track_bbox")

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
                if not exact or frame_is_outside(geometry, frame_index):
                    raise ValueError("frame split requires an exact visible keyframe")
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
        gap_mode: str = "interpolate",
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
        elif operation == "join_tracks":
            updated, created, deleted = await self._join_video_tracks(
                task=task,
                annotations=annotations,
                gap_mode=gap_mode,
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
            annotation_type="video_track_bbox",
            class_name=ordered[0].class_name,
            geometry={
                "type": "video_track_bbox",
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
        if geometry.get("type") != "video_track_bbox":
            raise ValueError("split_track only accepts a video_track_bbox annotation")
        if not resolve_track_at_frame(geometry, frame_index):
            raise ValueError("split_track requires a visible frame")

        keyframes = sorted_keyframes(geometry)
        before_keyframes = [
            dict(kf) for kf in keyframes if int(kf.get("frame_index", 0)) <= frame_index
        ]
        if not any(
            int(kf.get("frame_index", 0)) == frame_index for kf in before_keyframes
        ):
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
        if not _track_visible_keyframes(
            {"type": "video_track_bbox", "keyframes": after_keyframes}
        ):
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
            annotation_type="video_track_bbox",
            class_name=source.class_name,
            geometry={
                "type": "video_track_bbox",
                "track_id": _new_track_id(),
                "semantic_label": geometry.get("semantic_label"),
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
        # merge_tracks 默认把 gap 区间标 outside 后合并.
        return self._combine_two_video_tracks(
            annotations=annotations,
            operation="merge_tracks",
            fill_gap_outside=True,
        )

    async def _join_video_tracks(
        self,
        *,
        task: Task,
        annotations: list[Annotation],
        gap_mode: str,
    ) -> tuple[list[Annotation], list[Annotation], list[uuid.UUID]]:
        # v0.10.30 · D-2.5 · 两条帧号不重叠的 track 之间补 gap 后合并.
        # gap_mode="outside" 与 merge_tracks 行为一致 (gap 标 outside);
        # gap_mode="interpolate" 不写 gap outside, gap 端点间靠现有线性插值连接.
        return self._combine_two_video_tracks(
            annotations=annotations,
            operation="join_tracks",
            fill_gap_outside=(gap_mode == "outside"),
        )

    def _combine_two_video_tracks(
        self,
        *,
        annotations: list[Annotation],
        operation: str,
        fill_gap_outside: bool,
    ) -> tuple[list[Annotation], list[Annotation], list[uuid.UUID]]:
        """merge / join 共用的两条 track 合并落库路径.

        校验恰好两条同 class 的 video_track 且帧号区间不重叠, 合并 keyframes
        (frame_index 唯一), 透传 survivor 既有 geometry (含 semantic_label) 与两条
        track 的 outside; ``fill_gap_outside`` 决定是否把 gap 区间额外标 outside.
        落库约定: survivor 保留并 version+1, removed 置 is_active=False.
        """
        if len(annotations) != 2:
            raise ValueError(f"{operation} requires exactly two annotations")
        if any(
            (ann.geometry or {}).get("type") != "video_track_bbox"
            for ann in annotations
        ):
            raise ValueError(f"{operation} only accepts video_track_bbox annotations")
        if annotations[0].class_name != annotations[1].class_name:
            raise ValueError(f"{operation} requires tracks with the same class")

        ranges: list[tuple[int, int, Annotation]] = []
        for ann in annotations:
            visible = _track_visible_keyframes(ann.geometry or {})
            if not visible:
                raise ValueError(f"{operation} requires visible keyframes")
            frames = [int(kf.get("frame_index", 0)) for kf in visible]
            ranges.append((min(frames), max(frames), ann))
        ranges.sort(key=lambda item: item[0])
        first_start, first_end, first = ranges[0]
        second_start, second_end, second = ranges[1]
        if first_end >= second_start:
            raise ValueError(f"{operation} requires non-overlapping tracks")

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
            raise ValueError(f"{operation} requires unique keyframe frame_index values")
        keyframes.sort(key=lambda kf: int(kf.get("frame_index", 0)))

        outside = [
            range_
            for ann in annotations
            for range_ in ((ann.geometry or {}).get("outside") or [])
        ]
        if fill_gap_outside and first_end + 1 <= second_start - 1:
            outside.append(
                {
                    "from": first_end + 1,
                    "to": second_start - 1,
                    "source": "manual",
                }
            )

        survivor.geometry = {
            **(survivor.geometry or {}),
            "type": "video_track_bbox",
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

    async def _update_task_stats(
        self,
        task_id: uuid.UUID,
        trigger_batch_transitions: bool = True,
    ) -> None:
        """更新 task 标注计数、is_labeled 与 pending↔in_progress 状态翻转。

        trigger_batch_transitions=True（默认）: 状态翻转时联动 batch 自动流转 +
        计数重算（现有行为保持不变）。
        trigger_batch_transitions=False: 只更新 task 本身，跳过 batch 流转
        （用于批量导入，避免导入过程意外推进整个 batch 状态）。
        """
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

        if trigger_batch_transitions and status_changed and task and task.batch_id:
            # 在函数内 import 避免 services 层循环依赖。
            from app.services.batch import BatchService

            batch_svc = BatchService(self.db)
            await batch_svc.check_auto_transitions(task.batch_id)
            await batch_svc.recalculate_counters(task.batch_id)
