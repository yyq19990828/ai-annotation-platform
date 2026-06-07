from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, and_, exists, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.db.models.annotation import Annotation
from app.db.models.annotation_feedback import AnnotationFeedback
from app.db.models.dataset import DatasetItem, Scene
from app.db.models.prediction import Prediction
from app.db.models.project import Project
from app.db.models.project_task_view import ProjectTaskView
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.task_dataset_item_link import TaskDatasetItemLink
from app.db.models.user import User
from app.services.scheduler import (
    batch_visibility_clause,
    is_privileged_for_project,
)


DEFAULT_COLUMNS = [
    "display_id",
    "file_name",
    "status",
    "annotation_count",
    "prediction_count",
    "avg_prediction_confidence",
    "unresolved_feedback_count",
    "model_versions",
    "scene_name",
    "frame_index",
    "last_activity_at",
]

DEFAULT_VIEWS: list[dict[str, Any]] = [
    {
        "key": "all",
        "name": "全部任务",
        "filter_json": {},
        "sort_json": [{"field": "task.created_at", "direction": "asc"}],
        "columns_json": DEFAULT_COLUMNS,
    },
    {
        "key": "pending",
        "name": "待标注",
        "filter_json": {
            "op": "and",
            "rules": [{"field": "task.status", "op": "in", "value": ["pending"]}],
        },
        "sort_json": [{"field": "task.created_at", "direction": "asc"}],
        "columns_json": DEFAULT_COLUMNS,
    },
    {
        "key": "review",
        "name": "待审核",
        "filter_json": {
            "op": "and",
            "rules": [{"field": "task.status", "op": "in", "value": ["review"]}],
        },
        "sort_json": [{"field": "task.updated_at", "direction": "desc"}],
        "columns_json": DEFAULT_COLUMNS,
    },
    {
        "key": "feedback-open",
        "name": "有未解决反馈",
        "filter_json": {
            "op": "and",
            "rules": [{"field": "feedback.unresolved_count", "op": "gt", "value": 0}],
        },
        "sort_json": [{"field": "last_activity_at", "direction": "desc"}],
        "columns_json": DEFAULT_COLUMNS,
    },
    {
        "key": "prediction-candidates",
        "name": "有预测候选",
        "filter_json": {
            "op": "and",
            "rules": [{"field": "prediction.prediction_count", "op": "gt", "value": 0}],
        },
        "sort_json": [{"field": "avg_prediction_confidence", "direction": "asc"}],
        "columns_json": DEFAULT_COLUMNS,
    },
]

_TASK_FIELD_MAP = {
    "task.status": Task.status,
    "task.assignee": Task.assignee_id,
    "task.reviewer": Task.reviewer_id,
    "task.batch_id": Task.batch_id,
    "task.created_at": Task.created_at,
    "task.updated_at": Task.updated_at,
}

_SORT_FIELD_MAP = {
    **_TASK_FIELD_MAP,
    "task.display_id": Task.display_id,
    "display_id": Task.display_id,
    "file_name": Task.file_name,
    "status": Task.status,
    "annotation_count": Task.total_annotations,
    "prediction_count": Task.total_predictions,
    "task.created_at": Task.created_at,
    "task.updated_at": Task.updated_at,
}

_STRING_OPS = {"eq", "ne", "in"}
_NUMERIC_OPS = {"eq", "ne", "gt", "gte", "lt", "lte", "in"}
_DATE_OPS = {"eq", "ne", "gt", "gte", "lt", "lte"}
_EXISTS_OPS = {"exists", "eq", "in"}


def builtin_views(project_id: uuid.UUID) -> list[dict[str, Any]]:
    return [
        {
            **item,
            "id": None,
            "project_id": project_id,
            "owner_id": None,
            "visibility": "project",
            "builtin": True,
            "created_at": None,
            "updated_at": None,
        }
        for item in DEFAULT_VIEWS
    ]


def validate_filter(filter_json: dict[str, Any] | None) -> None:
    compile_filter(filter_json or {})


def validate_sort(sort_json: list[dict[str, Any]] | None) -> None:
    for item in sort_json or []:
        field = item.get("field")
        if field not in _SORT_FIELD_MAP and field not in {
            "avg_prediction_confidence",
            "unresolved_feedback_count",
            "model_versions",
            "scene_name",
            "scene.frame_index",
            "last_activity_at",
        }:
            raise HTTPException(
                status_code=422, detail=f"Unsupported sort field: {field}"
            )
        if item.get("direction", "asc") not in {"asc", "desc"}:
            raise HTTPException(
                status_code=422, detail="Sort direction must be asc or desc"
            )


def validate_columns(columns_json: list[str] | None) -> None:
    allowed = set(DEFAULT_COLUMNS) | {
        "assignee",
        "reviewer",
        "batch_id",
        "created_at",
        "updated_at",
    }
    unknown = [item for item in columns_json or [] if item not in allowed]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unsupported columns: {unknown}")


def compile_filter(filter_json: dict[str, Any]) -> ColumnElement[bool]:
    if not filter_json:
        return literal(True)
    return _compile_node(filter_json)


def _compile_node(node: dict[str, Any]) -> ColumnElement[bool]:
    if "rules" in node:
        op = node.get("op", "and")
        if op not in {"and", "or"}:
            raise HTTPException(
                status_code=422, detail="Filter group op must be and/or"
            )
        rules = node.get("rules")
        if not isinstance(rules, list):
            raise HTTPException(
                status_code=422, detail="Filter group rules must be a list"
            )
        clauses = [_compile_node(rule) for rule in rules]
        if not clauses:
            return literal(True)
        return and_(*clauses) if op == "and" else or_(*clauses)

    field = node.get("field")
    op = node.get("op")
    value = node.get("value")
    if not isinstance(field, str) or not isinstance(op, str):
        raise HTTPException(status_code=422, detail="Filter rule needs field and op")
    return _compile_rule(field, op, value)


def _compile_rule(field: str, op: str, value: Any) -> ColumnElement[bool]:
    if field in _TASK_FIELD_MAP:
        allowed_ops = _DATE_OPS if field.endswith("_at") else _STRING_OPS
        return _compare_column(_TASK_FIELD_MAP[field], op, value, allowed_ops)
    if field in {"task.frame_index", "scene.frame_index"}:
        return _compare_scene_frame(op, value)
    if field in {"task.scene_id", "scene.scene_id"}:
        return _compare_scene_id(op, value)
    if field == "dataset.dataset_id":
        return _compare_dataset_id(op, value)
    if field == "dataset.file_type":
        return _compare_dataset_file_type(op, value)
    if field == "annotation.annotation_count":
        return _compare_column(Task.total_annotations, op, value, _NUMERIC_OPS)
    if field == "annotation.class_name":
        return _compare_annotation_class(op, value)
    if field == "prediction.prediction_count":
        return _compare_column(Task.total_predictions, op, value, _NUMERIC_OPS)
    if field == "prediction.model_version":
        return _compare_prediction_field(Prediction.model_version, op, value)
    if field == "prediction.source":
        return _compare_prediction_field(Prediction.source, op, value)
    if field == "prediction.avg_confidence":
        return _compare_scalar(_avg_prediction_confidence_sq(), op, value, _NUMERIC_OPS)
    if field == "feedback.unresolved_count":
        return _compare_scalar(_unresolved_feedback_count_sq(), op, value, _NUMERIC_OPS)
    if field == "feedback.kind":
        return _compare_feedback_field(AnnotationFeedback.kind, op, value)
    if field == "feedback.severity":
        return _compare_feedback_field(AnnotationFeedback.severity, op, value)
    if field == "scene.scene_name":
        return _compare_scene_name(op, value)
    raise HTTPException(status_code=422, detail=f"Unsupported filter field: {field}")


def _compare_column(
    column: ColumnElement[Any],
    op: str,
    value: Any,
    allowed_ops: set[str],
) -> ColumnElement[bool]:
    if op not in allowed_ops:
        raise HTTPException(status_code=422, detail=f"Unsupported op for field: {op}")
    if op == "eq":
        return column == value
    if op == "ne":
        return column != value
    if op == "in":
        if not isinstance(value, list):
            raise HTTPException(status_code=422, detail="in value must be a list")
        return column.in_(value)
    if op == "gt":
        return column > value
    if op == "gte":
        return column >= value
    if op == "lt":
        return column < value
    if op == "lte":
        return column <= value
    raise HTTPException(status_code=422, detail=f"Unsupported op: {op}")


def _compare_scalar(
    scalar: ColumnElement[Any],
    op: str,
    value: Any,
    allowed_ops: set[str],
) -> ColumnElement[bool]:
    return _compare_column(scalar, op, value, allowed_ops)


def _compare_annotation_class(op: str, value: Any) -> ColumnElement[bool]:
    if op not in _EXISTS_OPS:
        raise HTTPException(
            status_code=422, detail="Unsupported annotation.class_name op"
        )
    clause = and_(
        Annotation.task_id == Task.id,
        Annotation.is_active.is_(True),
    )
    if op == "exists":
        return exists().where(clause)
    if op == "eq":
        return exists().where(clause, Annotation.class_name == value)
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="in value must be a list")
    return exists().where(clause, Annotation.class_name.in_(value))


def _compare_prediction_field(
    column: ColumnElement[Any], op: str, value: Any
) -> ColumnElement[bool]:
    if op not in {"exists", "eq", "ne", "in"}:
        raise HTTPException(status_code=422, detail="Unsupported prediction field op")
    clause = Prediction.task_id == Task.id
    if op == "exists":
        return exists().where(clause, column.is_not(None))
    if op == "eq":
        return exists().where(clause, column == value)
    if op == "ne":
        return exists().where(clause, column != value)
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="in value must be a list")
    return exists().where(clause, column.in_(value))


def _compare_feedback_field(
    column: ColumnElement[Any], op: str, value: Any
) -> ColumnElement[bool]:
    if op not in {"exists", "eq", "in"}:
        raise HTTPException(status_code=422, detail="Unsupported feedback field op")
    clause = and_(
        AnnotationFeedback.task_id == Task.id,
        AnnotationFeedback.is_active.is_(True),
        AnnotationFeedback.status == "open",
    )
    if op == "exists":
        return exists().where(clause, column.is_not(None))
    if op == "eq":
        return exists().where(clause, column == value)
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="in value must be a list")
    return exists().where(clause, column.in_(value))


def _primary_item_id_sq() -> ColumnElement[uuid.UUID | None]:
    return (
        select(TaskDatasetItemLink.dataset_item_id)
        .where(
            TaskDatasetItemLink.task_id == Task.id,
            TaskDatasetItemLink.role == "primary_lidar",
        )
        .limit(1)
        .scalar_subquery()
    )


def _scene_id_sq() -> ColumnElement[uuid.UUID | None]:
    return (
        select(DatasetItem.scene_id)
        .where(
            DatasetItem.id == func.coalesce(Task.dataset_item_id, _primary_item_id_sq())
        )
        .limit(1)
        .scalar_subquery()
    )


def _scene_frame_sq() -> ColumnElement[int | None]:
    return (
        select(DatasetItem.frame_index)
        .where(
            DatasetItem.id == func.coalesce(Task.dataset_item_id, _primary_item_id_sq())
        )
        .limit(1)
        .scalar_subquery()
    )


def _scene_name_sq() -> ColumnElement[str | None]:
    scene_id = _scene_id_sq()
    return select(Scene.name).where(Scene.id == scene_id).limit(1).scalar_subquery()


def _dataset_id_sq() -> ColumnElement[uuid.UUID | None]:
    return (
        select(DatasetItem.dataset_id)
        .where(
            DatasetItem.id == func.coalesce(Task.dataset_item_id, _primary_item_id_sq())
        )
        .limit(1)
        .scalar_subquery()
    )


def _dataset_file_type_sq() -> ColumnElement[str | None]:
    return (
        select(DatasetItem.file_type)
        .where(
            DatasetItem.id == func.coalesce(Task.dataset_item_id, _primary_item_id_sq())
        )
        .limit(1)
        .scalar_subquery()
    )


def _compare_scene_id(op: str, value: Any) -> ColumnElement[bool]:
    return _compare_scalar(_scene_id_sq(), op, value, {"eq", "ne", "in"})


def _compare_scene_frame(op: str, value: Any) -> ColumnElement[bool]:
    return _compare_scalar(_scene_frame_sq(), op, value, _NUMERIC_OPS)


def _compare_scene_name(op: str, value: Any) -> ColumnElement[bool]:
    return _compare_scalar(_scene_name_sq(), op, value, _STRING_OPS)


def _compare_dataset_id(op: str, value: Any) -> ColumnElement[bool]:
    return _compare_scalar(_dataset_id_sq(), op, value, {"eq", "ne", "in"})


def _compare_dataset_file_type(op: str, value: Any) -> ColumnElement[bool]:
    return _compare_scalar(_dataset_file_type_sq(), op, value, _STRING_OPS)


def _avg_prediction_confidence_sq() -> ColumnElement[float | None]:
    return (
        select(func.avg(Prediction.score))
        .where(Prediction.task_id == Task.id)
        .scalar_subquery()
    )


def _unresolved_feedback_count_sq() -> ColumnElement[int]:
    return (
        select(func.count(AnnotationFeedback.id))
        .where(
            AnnotationFeedback.task_id == Task.id,
            AnnotationFeedback.is_active.is_(True),
            AnnotationFeedback.status == "open",
        )
        .scalar_subquery()
    )


def _model_versions_sq() -> ColumnElement[list[str]]:
    return (
        select(
            func.coalesce(func.array_agg(func.distinct(Prediction.model_version)), [])
        )
        .where(Prediction.task_id == Task.id, Prediction.model_version.is_not(None))
        .scalar_subquery()
    )


def _last_activity_at_expr() -> ColumnElement[datetime]:
    return func.greatest(
        Task.updated_at,
        func.coalesce(
            (
                select(func.max(Annotation.updated_at))
                .where(Annotation.task_id == Task.id, Annotation.is_active.is_(True))
                .scalar_subquery()
            ),
            Task.updated_at,
        ),
        func.coalesce(
            (
                select(func.max(AnnotationFeedback.updated_at))
                .where(AnnotationFeedback.task_id == Task.id)
                .scalar_subquery()
            ),
            Task.updated_at,
        ),
        func.coalesce(
            (
                select(func.max(Prediction.created_at))
                .where(Prediction.task_id == Task.id)
                .scalar_subquery()
            ),
            Task.updated_at,
        ),
    )


def apply_sort(q: Select, sort_json: list[dict[str, Any]] | None) -> Select:
    validate_sort(sort_json)
    sorts = sort_json or [{"field": "task.created_at", "direction": "asc"}]
    order_by = []
    for item in sorts:
        field = item.get("field")
        expr = _sort_expr(field)
        order_by.append(expr.desc() if item.get("direction") == "desc" else expr.asc())
    order_by.append(Task.id.asc())
    return q.order_by(*order_by)


def _sort_expr(field: str) -> ColumnElement[Any]:
    if field in _SORT_FIELD_MAP:
        return _SORT_FIELD_MAP[field]
    if field == "avg_prediction_confidence":
        return _avg_prediction_confidence_sq()
    if field == "unresolved_feedback_count":
        return _unresolved_feedback_count_sq()
    if field in {"scene_name", "scene.scene_name"}:
        return _scene_name_sq()
    if field in {"frame_index", "scene.frame_index"}:
        return _scene_frame_sq()
    if field == "last_activity_at":
        return _last_activity_at_expr()
    if field == "model_versions":
        return _model_versions_sq()
    raise HTTPException(status_code=422, detail=f"Unsupported sort field: {field}")


class TaskViewService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_views(
        self,
        project_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> list[ProjectTaskView]:
        rows = await self.db.execute(
            select(ProjectTaskView)
            .where(
                ProjectTaskView.project_id == project_id,
                or_(
                    ProjectTaskView.visibility == "project",
                    ProjectTaskView.owner_id == user_id,
                ),
            )
            .order_by(ProjectTaskView.visibility.desc(), ProjectTaskView.name.asc())
        )
        return list(rows.scalars().all())

    async def get_view(
        self,
        project_id: uuid.UUID,
        view_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> ProjectTaskView:
        view = await self.db.get(ProjectTaskView, view_id)
        if (
            view is None
            or view.project_id != project_id
            or (view.visibility == "private" and view.owner_id != user_id)
        ):
            raise HTTPException(status_code=404, detail="Task view not found")
        return view

    async def create_view(
        self,
        *,
        project_id: uuid.UUID,
        owner_id: uuid.UUID,
        name: str,
        visibility: str,
        filter_json: dict[str, Any],
        sort_json: list[dict[str, Any]],
        columns_json: list[str],
    ) -> ProjectTaskView:
        _validate_payload(filter_json, sort_json, columns_json)
        view = ProjectTaskView(
            project_id=project_id,
            owner_id=owner_id,
            name=name,
            visibility=visibility,
            filter_json=filter_json,
            sort_json=sort_json,
            columns_json=columns_json,
        )
        self.db.add(view)
        await self.db.flush()
        await self.db.refresh(view)
        return view

    async def update_view(
        self,
        view: ProjectTaskView,
        *,
        name: str | None = None,
        visibility: str | None = None,
        filter_json: dict[str, Any] | None = None,
        sort_json: list[dict[str, Any]] | None = None,
        columns_json: list[str] | None = None,
    ) -> ProjectTaskView:
        next_filter = view.filter_json if filter_json is None else filter_json
        next_sort = view.sort_json if sort_json is None else sort_json
        next_columns = view.columns_json if columns_json is None else columns_json
        _validate_payload(next_filter, next_sort, next_columns)
        if name is not None:
            view.name = name
        if visibility is not None:
            view.visibility = visibility
        if filter_json is not None:
            view.filter_json = filter_json
        if sort_json is not None:
            view.sort_json = sort_json
        if columns_json is not None:
            view.columns_json = columns_json
        await self.db.flush()
        await self.db.refresh(view)
        return view

    async def delete_view(self, view: ProjectTaskView) -> None:
        await self.db.delete(view)
        await self.db.flush()

    def _apply_visibility(
        self,
        stmt: Select,
        user: User,
        project: Project,
    ) -> Select:
        # 与 tasks.list_tasks 对齐: 非特权用户 (annotator/reviewer) 通过 Data Manager
        # 查询时只能看自己 batch 可见性范围内的任务, 不能看到全项目任务。无 batch 的
        # 孤儿任务对非特权用户不可见 (inner join 自然过滤)。
        if not is_privileged_for_project(user, project):
            stmt = stmt.join(TaskBatch, Task.batch_id == TaskBatch.id).where(
                batch_visibility_clause(user)
            )
        return stmt

    async def count_for_filter(
        self,
        project_id: uuid.UUID,
        filter_json: dict[str, Any],
        *,
        user: User,
        project: Project,
    ) -> int:
        clause = compile_filter(filter_json)
        stmt = (
            select(func.count())
            .select_from(Task)
            .where(Task.project_id == project_id, clause)
        )
        stmt = self._apply_visibility(stmt, user, project)
        total = await self.db.scalar(stmt)
        return int(total or 0)

    async def query_tasks(
        self,
        *,
        project_id: uuid.UUID,
        filter_json: dict[str, Any],
        sort_json: list[dict[str, Any]],
        limit: int,
        offset: int,
        user: User,
        project: Project,
    ) -> tuple[list[Any], int]:
        clause = compile_filter(filter_json)
        base = Task.project_id == project_id
        count_stmt = self._apply_visibility(
            select(func.count()).select_from(Task).where(base, clause), user, project
        )
        total = await self.db.scalar(count_stmt)
        q = select(
            Task,
            _avg_prediction_confidence_sq().label("avg_prediction_confidence"),
            _unresolved_feedback_count_sq().label("unresolved_feedback_count"),
            _model_versions_sq().label("model_versions"),
            _scene_name_sq().label("scene_name"),
            _scene_frame_sq().label("frame_index"),
            _last_activity_at_expr().label("last_activity_at"),
        ).where(base, clause)
        q = self._apply_visibility(q, user, project)
        q = apply_sort(q, sort_json).limit(limit).offset(offset)
        rows = (await self.db.execute(q)).all()
        return rows, int(total or 0)


def _validate_payload(
    filter_json: dict[str, Any],
    sort_json: list[dict[str, Any]],
    columns_json: list[str],
) -> None:
    validate_filter(filter_json)
    validate_sort(sort_json)
    validate_columns(columns_json)
