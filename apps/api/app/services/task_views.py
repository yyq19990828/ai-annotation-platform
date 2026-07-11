from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import (
    Float,
    Select,
    and_,
    case,
    cast,
    exists,
    func,
    literal,
    not_,
    or_,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
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
    "pending_prediction_shape_count",
    "low_confidence_prediction_shape_count",
    "pending_tracker_job_count",
    "unresolved_feedback_count",
    "annotation_source_counts",
    "track_count",
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
        "key": "ai-review",
        "name": "AI 待审",
        "filter_json": {
            "op": "or",
            "rules": [
                {"field": "ai.pending_prediction_shape_count", "op": "gt", "value": 0},
                {"field": "ai.pending_tracker_job_count", "op": "gt", "value": 0},
            ],
        },
        "sort_json": [{"field": "last_activity_at", "direction": "desc"}],
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

# in 列表元素数上限，防止单请求拖慢 DB。
_MAX_IN_VALUES = 200


def builtin_views(
    project_id: uuid.UUID, project: Project | None = None
) -> list[dict[str, Any]]:
    columns = list(DEFAULT_COLUMNS)
    if project is not None and project.scene_mode:
        columns.extend(["scene_name", "frame_index", "scene_total_frames"])
    if project is not None and project.data_type == "video":
        columns.extend(["duration", "frame_count", "keyframe_count"])
    if project is not None and project.data_type == "image":
        columns.append("resolution")
    if project is not None and project.data_type in {
        "lidar",
        "point_cloud",
        "pointcloud",
    }:
        columns.extend(["camera_count", "calibration_issue_count"])
    views = [*DEFAULT_VIEWS]
    if project is not None:
        required_rules: list[dict[str, Any]] = []
        for unit, binding in (project.tool_bindings or {}).items():
            if not isinstance(binding, dict) or not binding.get("enabled", True):
                continue
            fields = (binding.get("attribute_schema") or {}).get("fields") or []
            for field in fields:
                if (
                    not isinstance(field, dict)
                    or not field.get("required")
                    or not field.get("key")
                ):
                    continue
                object_rules: list[dict[str, Any]] = [
                    {
                        "field": f"annotation.attribute.{unit}.{field['key']}",
                        "op": "missing",
                    }
                ]
                applies_to = field.get("applies_to")
                if isinstance(applies_to, list) and applies_to:
                    object_rules.insert(
                        0,
                        {
                            "field": "annotation.class_name",
                            "op": "in",
                            "value": applies_to,
                        },
                    )
                visible_if = field.get("visible_if")
                if isinstance(visible_if, dict) and visible_if.get("key"):
                    object_rules.insert(
                        0,
                        {
                            "field": f"annotation.attribute.{unit}.{visible_if['key']}",
                            "op": "eq",
                            "value": visible_if.get("equals"),
                        },
                    )
                required_rules.append({"op": "and", "rules": object_rules})
        if required_rules:
            views.append(
                {
                    "key": "missing-required-attributes",
                    "name": "缺少必填属性",
                    "filter_json": {"op": "or", "rules": required_rules},
                    "sort_json": [{"field": "last_activity_at", "direction": "desc"}],
                    "columns_json": DEFAULT_COLUMNS,
                }
            )
        if project.data_type == "video":
            views.extend(
                [
                    {
                        "key": "tracker-review",
                        "name": "追踪候选待审",
                        "filter_json": {
                            "op": "and",
                            "rules": [
                                {
                                    "field": "ai.pending_tracker_job_count",
                                    "op": "gt",
                                    "value": 0,
                                }
                            ],
                        },
                        "sort_json": [
                            {"field": "last_activity_at", "direction": "desc"}
                        ],
                        "columns_json": DEFAULT_COLUMNS,
                    },
                    {
                        "key": "with-tracks",
                        "name": "含轨迹",
                        "filter_json": {
                            "op": "and",
                            "rules": [
                                {
                                    "field": "annotation.has_track",
                                    "op": "eq",
                                    "value": True,
                                }
                            ],
                        },
                        "sort_json": [
                            {"field": "last_activity_at", "direction": "desc"}
                        ],
                        "columns_json": DEFAULT_COLUMNS,
                    },
                ]
            )
        if project.scene_mode:
            views.append(
                {
                    "key": "interpolated",
                    "name": "含插值标注",
                    "filter_json": {
                        "op": "and",
                        "rules": [
                            {
                                "field": "annotation.source",
                                "op": "eq",
                                "value": "interpolated",
                            }
                        ],
                    },
                    "sort_json": [{"field": "scene.frame_index", "direction": "asc"}],
                    "columns_json": DEFAULT_COLUMNS,
                }
            )
    return [
        {
            **item,
            "columns_json": columns,
            "id": None,
            "project_id": project_id,
            "owner_id": None,
            "visibility": "project",
            "builtin": True,
            "created_at": None,
            "updated_at": None,
        }
        for item in views
    ]


def builtin_view_keys(project: Project) -> list[str]:
    return [str(view["key"]) for view in builtin_views(project.id, project)]


def validate_filter(
    filter_json: dict[str, Any] | None,
    project: Project | None = None,
    user: User | None = None,
) -> None:
    compile_filter(filter_json or {}, project=project, user=user)


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
            "low_confidence_prediction_shape_count",
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
        "prediction_count",
        "avg_prediction_confidence",
        "model_versions",
        "scene_name",
        "frame_index",
        "duration",
        "fps",
        "frame_count",
        "resolution",
        "keyframe_count",
        "outside_range_count",
        "camera_count",
        "calibration_issue_count",
        "scene_total_frames",
    }
    unknown = [item for item in columns_json or [] if item not in allowed]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unsupported columns: {unknown}")


def invalid_filter_fields(filter_json: dict[str, Any], project: Project) -> list[str]:
    invalid: list[str] = []

    def visit(node: dict[str, Any]) -> None:
        if not node:
            return
        if "rules" in node:
            for child in node.get("rules") or []:
                if isinstance(child, dict):
                    visit(child)
            return
        field = node.get("field")
        if not isinstance(field, str):
            invalid.append("__filter__")
            return
        try:
            compile_filter(node, project=project)
        except HTTPException:
            invalid.append(field)

    visit(filter_json or {})
    return list(dict.fromkeys(invalid))


def compile_filter(
    filter_json: dict[str, Any],
    project: Project | None = None,
    user: User | None = None,
) -> ColumnElement[bool]:
    if not filter_json:
        return literal(True)
    return _compile_node(filter_json, project=project, user=user)


def _compile_node(
    node: dict[str, Any],
    project: Project | None = None,
    user: User | None = None,
) -> ColumnElement[bool]:
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
        annotation_rules = (
            [
                rule
                for rule in rules
                if isinstance(rule, dict) and _is_annotation_object_rule(rule)
            ]
            if op == "and"
            else []
        )
        other_rules = [rule for rule in rules if rule not in annotation_rules]
        clauses = [
            _compile_node(rule, project=project, user=user) for rule in other_rules
        ]
        if annotation_rules:
            annotation = aliased(Annotation)
            clauses.append(
                exists().where(
                    annotation.task_id == Task.id,
                    annotation.is_active.is_(True),
                    annotation.was_cancelled.is_(False),
                    *[
                        _compile_annotation_object_condition(
                            annotation,
                            str(rule["field"]),
                            str(rule["op"]),
                            rule.get("value"),
                            project,
                        )
                        for rule in annotation_rules
                    ],
                )
            )
        if not clauses:
            return literal(True)
        return and_(*clauses) if op == "and" else or_(*clauses)

    field = node.get("field")
    op = node.get("op")
    value = node.get("value")
    if not isinstance(field, str) or not isinstance(op, str):
        raise HTTPException(status_code=422, detail="Filter rule needs field and op")
    # 防止单请求用超长 in 列表拖慢 DB（所有走 .in_() 的字段在此统一收口）。
    if op == "in" and isinstance(value, list) and len(value) > _MAX_IN_VALUES:
        raise HTTPException(
            status_code=422,
            detail=f"in value too long (max {_MAX_IN_VALUES})",
        )
    return _compile_rule(field, op, value, project=project, user=user)


def _compile_rule(
    field: str,
    op: str,
    value: Any,
    *,
    project: Project | None = None,
    user: User | None = None,
) -> ColumnElement[bool]:
    if field == "task.keyword":
        return _compare_task_keyword(op, value, project)
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
    if field == "annotation.source":
        return _compare_annotation_column(Annotation.source, op, value)
    if field == "annotation.annotation_type":
        return _compare_annotation_column(Annotation.annotation_type, op, value)
    if field == "annotation.tool_unit_id":
        return _compare_annotation_column(Annotation.tool_unit_id, op, value)
    if field == "annotation.imported":
        return _compare_annotation_imported(op, value)
    if field == "annotation.has_track":
        return _compare_annotation_has_track(op, value)
    if field == "annotation.track_id":
        return _compare_annotation_track_id(op, value)
    if field.startswith("annotation.attribute_origin."):
        return _compare_annotation_attribute_origin(field, op, value, project)
    if field.startswith("annotation.attribute."):
        return _compare_annotation_attribute(field, op, value, project)
    if field == "keyframe.source":
        return _compare_keyframe_source(op, value)
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
    if field == "feedback.status":
        return _compare_feedback_status(op, value)
    if field == "scene.scene_name":
        return _compare_scene_name(op, value)
    if field == "ai.pending_prediction_shape_count":
        from app.services.data_manager import pending_prediction_shapes_expr

        return _compare_scalar(
            pending_prediction_shapes_expr(), op, value, _NUMERIC_OPS
        )
    if field == "ai.low_confidence_prediction_shape_count":
        from app.services.data_manager import (
            low_confidence_pending_prediction_shapes_expr,
        )

        return _compare_scalar(
            low_confidence_pending_prediction_shapes_expr(),
            op,
            value,
            _NUMERIC_OPS,
        )
    if field == "ai.pending_tracker_job_count":
        if project is None:
            raise HTTPException(
                status_code=422,
                detail="Project context is required for tracker candidate filters",
            )
        from app.services.data_manager import pending_tracker_jobs_expr

        return _compare_scalar(
            pending_tracker_jobs_expr(user, project), op, value, _NUMERIC_OPS
        )
    raise HTTPException(status_code=422, detail=f"Unsupported filter field: {field}")


def _active_annotation_clause() -> ColumnElement[bool]:
    return and_(
        Annotation.task_id == Task.id,
        Annotation.is_active.is_(True),
        Annotation.was_cancelled.is_(False),
    )


def _is_annotation_object_rule(node: dict[str, Any]) -> bool:
    field = node.get("field")
    return isinstance(field, str) and (
        (field.startswith("annotation.") and field != "annotation.annotation_count")
        or field == "keyframe.source"
    )


def _compile_annotation_object_condition(
    annotation,
    field: str,
    op: str,
    value: Any,
    project: Project | None,
) -> ColumnElement[bool]:
    scalar_fields = {
        "annotation.class_name": annotation.class_name,
        "annotation.source": annotation.source,
        "annotation.annotation_type": annotation.annotation_type,
        "annotation.tool_unit_id": annotation.tool_unit_id,
    }
    if field in scalar_fields:
        if op == "exists":
            return scalar_fields[field].is_not(None)
        return _compare_column(scalar_fields[field], op, value, {"eq", "ne", "in"})
    track_id = func.coalesce(
        annotation.track_id, annotation.geometry["track_id"].astext
    )
    if field == "annotation.track_id":
        return _compare_column(track_id, op, value, {"eq", "in"})
    if field == "annotation.has_track":
        if op != "eq" or not isinstance(value, bool):
            raise HTTPException(
                status_code=422,
                detail="annotation.has_track only supports boolean eq",
            )
        return track_id.is_not(None) if value else track_id.is_(None)
    if field == "annotation.imported":
        if op != "eq" or not isinstance(value, bool):
            raise HTTPException(
                status_code=422,
                detail="annotation.imported only supports boolean eq",
            )
        imported = (
            func.coalesce(annotation.attributes["_imported"].astext, "false") == "true"
        )
        return imported if value else not_(imported)
    if field.startswith("annotation.attribute_origin."):
        unit, key, _ = _resolve_attribute_field(
            field, "annotation.attribute_origin.", project
        )
        if op not in {"eq", "in"}:
            raise HTTPException(
                status_code=422, detail="Unsupported attribute origin op"
            )
        origin = func.coalesce(
            annotation.attributes_meta[key]["origin"].astext, "human"
        )
        comparison = (
            origin == value
            if op == "eq"
            else _compare_column(origin, op, value, {"in"})
        )
        return and_(
            annotation.tool_unit_id == unit,
            annotation.attributes.has_key(key),  # noqa: W601
            comparison,
        )
    if field.startswith("annotation.attribute."):
        unit, key, schema_field = _resolve_attribute_field(
            field, "annotation.attribute.", project
        )
        present = annotation.attributes.has_key(key)  # noqa: W601
        if op == "exists":
            condition = present
        elif op == "missing":
            condition = not_(present)
        else:
            text_value = annotation.attributes[key].astext
            attr_type = schema_field.get("type", "text")
            if attr_type in {"number", "range"}:
                number = cast(text_value, Float)
                if op == "between":
                    if not isinstance(value, list) or len(value) != 2:
                        raise HTTPException(
                            status_code=422,
                            detail="between value must have two items",
                        )
                    condition = and_(number >= value[0], number <= value[1])
                else:
                    condition = _compare_column(number, op, value, _NUMERIC_OPS)
            elif attr_type == "boolean":
                if op != "eq" or not isinstance(value, bool):
                    raise HTTPException(
                        status_code=422,
                        detail="boolean attribute only supports eq",
                    )
                condition = text_value == ("true" if value else "false")
            elif attr_type == "multiselect":
                if op not in {"contains_any", "contains_all"} or not isinstance(
                    value, list
                ):
                    raise HTTPException(
                        status_code=422,
                        detail="Invalid multiselect attribute op",
                    )
                contains = [
                    annotation.attributes[key].op("@>")(
                        literal([item], type_=annotation.attributes.type)
                    )
                    for item in value
                ]
                condition = or_(*contains) if op == "contains_any" else and_(*contains)
            elif op == "contains" and attr_type == "text":
                if not isinstance(value, str):
                    raise HTTPException(
                        status_code=422, detail="contains value must be text"
                    )
                condition = text_value.ilike(f"%{value}%")
            else:
                allowed = {"eq", "in"} if attr_type == "select" else {"eq"}
                condition = _compare_column(text_value, op, value, allowed)
            condition = and_(present, condition)
        return and_(annotation.tool_unit_id == unit, condition)
    if field == "keyframe.source":
        if op not in {"eq", "in"}:
            raise HTTPException(
                status_code=422, detail="Unsupported keyframe.source op"
            )
        values = [value] if op == "eq" else value
        if not isinstance(values, list):
            raise HTTPException(status_code=422, detail="in value must be a list")
        return or_(
            *[
                annotation.geometry.op("@>")(
                    literal(
                        {"keyframes": [{"source": source}]},
                        type_=annotation.geometry.type,
                    )
                )
                for source in values
            ]
        )
    raise HTTPException(
        status_code=422, detail=f"Unsupported annotation field: {field}"
    )


def compile_annotation_match_filter(
    filter_json: dict[str, Any],
    annotation,
    project: Project,
) -> ColumnElement[bool]:
    """Compile only object-level rules for the task match explanation drawer."""
    if not filter_json:
        return literal(True)
    if "rules" in filter_json:
        op = filter_json.get("op", "and")
        children = [
            compile_annotation_match_filter(child, annotation, project)
            for child in filter_json.get("rules") or []
            if isinstance(child, dict)
            and ("rules" in child or _is_annotation_object_rule(child))
        ]
        if not children:
            return literal(True)
        return and_(*children) if op == "and" else or_(*children)
    if not _is_annotation_object_rule(filter_json):
        return literal(True)
    return _compile_annotation_object_condition(
        annotation,
        str(filter_json["field"]),
        str(filter_json["op"]),
        filter_json.get("value"),
        project,
    )


def _compare_task_keyword(
    op: str, value: Any, project: Project | None
) -> ColumnElement[bool]:
    if op != "contains" or not isinstance(value, str):
        raise HTTPException(
            status_code=422, detail="task.keyword only supports contains"
        )
    value = value.strip()
    if not value or len(value) > 200:
        raise HTTPException(
            status_code=422, detail="task.keyword length must be between 1 and 200"
        )
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    clauses = [
        Task.display_id.ilike(pattern, escape="\\"),
        Task.file_name.ilike(pattern, escape="\\"),
    ]
    if project is not None and project.scene_mode:
        clauses.append(_scene_name_sq().ilike(pattern, escape="\\"))
    return or_(*clauses)


def _compare_annotation_column(
    column: ColumnElement[Any], op: str, value: Any
) -> ColumnElement[bool]:
    if op not in {"exists", "eq", "ne", "in"}:
        raise HTTPException(status_code=422, detail="Unsupported annotation field op")
    clause = _active_annotation_clause()
    if op == "exists":
        return exists().where(clause, column.is_not(None))
    if op == "eq":
        return exists().where(clause, column == value)
    if op == "ne":
        return exists().where(clause, column != value)
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="in value must be a list")
    return exists().where(clause, column.in_(value))


def _track_id_expr() -> ColumnElement[str | None]:
    return func.coalesce(Annotation.track_id, Annotation.geometry["track_id"].astext)


def _compare_annotation_imported(op: str, value: Any) -> ColumnElement[bool]:
    if op != "eq" or not isinstance(value, bool):
        raise HTTPException(
            status_code=422, detail="annotation.imported only supports boolean eq"
        )
    imported = (
        func.coalesce(Annotation.attributes["_imported"].astext, "false") == "true"
    )
    return exists().where(
        _active_annotation_clause(), imported if value else not_(imported)
    )


def _compare_annotation_has_track(op: str, value: Any) -> ColumnElement[bool]:
    if op != "eq" or not isinstance(value, bool):
        raise HTTPException(
            status_code=422, detail="annotation.has_track only supports boolean eq"
        )
    has_track = _track_id_expr().is_not(None)
    return exists().where(
        _active_annotation_clause(), has_track if value else not_(has_track)
    )


def _compare_annotation_track_id(op: str, value: Any) -> ColumnElement[bool]:
    if op not in {"eq", "in"}:
        raise HTTPException(
            status_code=422, detail="Unsupported annotation.track_id op"
        )
    track_id = _track_id_expr()
    if op == "eq":
        return exists().where(_active_annotation_clause(), track_id == value)
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="in value must be a list")
    return exists().where(_active_annotation_clause(), track_id.in_(value))


def _resolve_attribute_field(
    field: str,
    prefix: str,
    project: Project | None,
) -> tuple[str, str, dict[str, Any]]:
    if project is None:
        raise HTTPException(
            status_code=422, detail="Project context is required for attribute filters"
        )
    path = field.removeprefix(prefix)
    if "." not in path:
        raise HTTPException(status_code=422, detail="Invalid attribute field")
    unit, key = path.split(".", 1)
    binding = (project.tool_bindings or {}).get(unit)
    fields = ((binding or {}).get("attribute_schema") or {}).get("fields") or []
    schema_field = next(
        (
            item
            for item in fields
            if isinstance(item, dict) and str(item.get("key")) == key
        ),
        None,
    )
    if (
        not isinstance(binding, dict)
        or not binding.get("enabled", True)
        or not schema_field
    ):
        raise HTTPException(
            status_code=422, detail=f"Unsupported attribute field: {field}"
        )
    return unit, key, schema_field


def _compare_annotation_attribute(
    field: str,
    op: str,
    value: Any,
    project: Project | None,
) -> ColumnElement[bool]:
    unit, key, schema_field = _resolve_attribute_field(
        field, "annotation.attribute.", project
    )
    attr_type = schema_field.get("type", "text")
    present = Annotation.attributes.has_key(key)  # noqa: W601
    base = and_(_active_annotation_clause(), Annotation.tool_unit_id == unit)
    if op == "exists":
        return exists().where(base, present)
    if op == "missing":
        return exists().where(base, not_(present))
    text_value = Annotation.attributes[key].astext
    if attr_type in {"number", "range"}:
        number = cast(text_value, Float)
        if op == "between":
            if not isinstance(value, list) or len(value) != 2:
                raise HTTPException(
                    status_code=422, detail="between value must have two items"
                )
            condition = and_(number >= value[0], number <= value[1])
        else:
            condition = _compare_column(number, op, value, _NUMERIC_OPS)
    elif attr_type == "boolean":
        if op != "eq" or not isinstance(value, bool):
            raise HTTPException(
                status_code=422, detail="boolean attribute only supports eq"
            )
        condition = text_value == ("true" if value else "false")
    elif attr_type == "multiselect":
        if op not in {"contains_any", "contains_all"} or not isinstance(value, list):
            raise HTTPException(
                status_code=422, detail="Invalid multiselect attribute op"
            )
        contains = [
            Annotation.attributes[key].op("@>")(
                literal([item], type_=Annotation.attributes.type)
            )
            for item in value
        ]
        condition = or_(*contains) if op == "contains_any" else and_(*contains)
    elif op == "contains" and attr_type == "text":
        if not isinstance(value, str):
            raise HTTPException(status_code=422, detail="contains value must be text")
        condition = text_value.ilike(f"%{value}%")
    else:
        allowed = {"eq", "in"} if attr_type == "select" else {"eq"}
        condition = _compare_column(text_value, op, value, allowed)
    return exists().where(base, present, condition)


def _compare_annotation_attribute_origin(
    field: str,
    op: str,
    value: Any,
    project: Project | None,
) -> ColumnElement[bool]:
    unit, key, _ = _resolve_attribute_field(
        field, "annotation.attribute_origin.", project
    )
    if op not in {"eq", "in"}:
        raise HTTPException(status_code=422, detail="Unsupported attribute origin op")
    origin = func.coalesce(Annotation.attributes_meta[key]["origin"].astext, "human")
    base = and_(
        _active_annotation_clause(),
        Annotation.tool_unit_id == unit,
        Annotation.attributes.has_key(key),  # noqa: W601
    )
    if op == "eq":
        return exists().where(base, origin == value)
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="in value must be a list")
    return exists().where(base, origin.in_(value))


def _compare_keyframe_source(op: str, value: Any) -> ColumnElement[bool]:
    if op not in {"eq", "in"}:
        raise HTTPException(status_code=422, detail="Unsupported keyframe.source op")
    values = [value] if op == "eq" else value
    if not isinstance(values, list):
        raise HTTPException(status_code=422, detail="in value must be a list")
    conditions = [
        Annotation.geometry.op("@>")(
            literal({"keyframes": [{"source": source}]}, type_=Annotation.geometry.type)
        )
        for source in values
    ]
    return exists().where(_active_annotation_clause(), or_(*conditions))


def _compare_feedback_status(op: str, value: Any) -> ColumnElement[bool]:
    if op not in {"eq", "in"}:
        raise HTTPException(status_code=422, detail="Unsupported feedback.status op")
    clause = and_(
        AnnotationFeedback.task_id == Task.id,
        AnnotationFeedback.is_active.is_(True),
    )
    if op == "eq":
        return exists().where(clause, AnnotationFeedback.status == value)
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="in value must be a list")
    return exists().where(clause, AnnotationFeedback.status.in_(value))


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
    clause = _active_annotation_clause()
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
        .correlate(Task)
        .scalar_subquery()
    )


def _scene_id_sq() -> ColumnElement[uuid.UUID | None]:
    return (
        select(DatasetItem.scene_id)
        .where(
            DatasetItem.id == func.coalesce(Task.dataset_item_id, _primary_item_id_sq())
        )
        .limit(1)
        .correlate(Task)
        .scalar_subquery()
    )


def _scene_frame_sq() -> ColumnElement[int | None]:
    return (
        select(DatasetItem.frame_index)
        .where(
            DatasetItem.id == func.coalesce(Task.dataset_item_id, _primary_item_id_sq())
        )
        .limit(1)
        .correlate(Task)
        .scalar_subquery()
    )


def _scene_name_sq() -> ColumnElement[str | None]:
    scene_id = _scene_id_sq()
    return (
        select(Scene.name)
        .where(Scene.id == scene_id)
        .limit(1)
        .correlate(Task)
        .scalar_subquery()
    )


def _dataset_id_sq() -> ColumnElement[uuid.UUID | None]:
    return (
        select(DatasetItem.dataset_id)
        .where(
            DatasetItem.id == func.coalesce(Task.dataset_item_id, _primary_item_id_sq())
        )
        .limit(1)
        .correlate(Task)
        .scalar_subquery()
    )


def _dataset_file_type_sq() -> ColumnElement[str | None]:
    return (
        select(DatasetItem.file_type)
        .where(
            DatasetItem.id == func.coalesce(Task.dataset_item_id, _primary_item_id_sq())
        )
        .limit(1)
        .correlate(Task)
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


def _annotation_source_count_sq(source: str) -> ColumnElement[int]:
    return (
        select(func.count(Annotation.id))
        .where(
            Annotation.task_id == Task.id,
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
            Annotation.source == source,
        )
        .scalar_subquery()
    )


def _track_count_sq() -> ColumnElement[int]:
    return (
        select(func.count(func.distinct(_track_id_expr())))
        .where(
            Annotation.task_id == Task.id,
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
            _track_id_expr().is_not(None),
        )
        .scalar_subquery()
    )


def _annotation_json_array_total_sq(key: str) -> ColumnElement[int]:
    value = Annotation.geometry[key]
    count = case(
        (func.jsonb_typeof(value) == "array", func.jsonb_array_length(value)),
        else_=0,
    )
    return (
        select(func.coalesce(func.sum(count), 0))
        .where(
            Annotation.task_id == Task.id,
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
        )
        .scalar_subquery()
    )


def _camera_count_sq() -> ColumnElement[int]:
    return (
        select(func.count(TaskDatasetItemLink.id))
        .where(
            TaskDatasetItemLink.task_id == Task.id,
            TaskDatasetItemLink.role.like("camera_%"),
        )
        .scalar_subquery()
    )


def _calibration_issue_count_sq() -> ColumnElement[int]:
    return (
        select(func.count(TaskDatasetItemLink.id))
        .join(DatasetItem, DatasetItem.id == TaskDatasetItemLink.dataset_item_id)
        .where(
            TaskDatasetItemLink.task_id == Task.id,
            TaskDatasetItemLink.role.like("camera_%"),
            not_(DatasetItem.metadata_.has_key("calibration")),  # noqa: W601
        )
        .scalar_subquery()
    )


def _scene_total_frames_sq() -> ColumnElement[int | None]:
    scene_id = _scene_id_sq()
    scene_item = aliased(DatasetItem)
    return (
        select(func.count(func.distinct(scene_item.frame_index)))
        .where(
            scene_item.scene_id == scene_id,
            scene_item.frame_index.is_not(None),
        )
        .correlate(Task)
        .scalar_subquery()
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
    if field == "low_confidence_prediction_shape_count":
        from app.services.data_manager import (
            low_confidence_pending_prediction_shapes_expr,
        )

        return low_confidence_pending_prediction_shapes_expr()
    raise HTTPException(status_code=422, detail=f"Unsupported sort field: {field}")


def apply_task_visibility(stmt: Select, user: User, project: Project) -> Select:
    """Apply the canonical project task visibility scope to an arbitrary Task query."""
    if not is_privileged_for_project(user, project):
        stmt = stmt.join(TaskBatch, Task.batch_id == TaskBatch.id).where(
            batch_visibility_clause(user)
        )
    return stmt


def visible_tasks_stmt(
    project_id: uuid.UUID,
    *,
    user: User,
    project: Project,
) -> Select:
    return apply_task_visibility(
        select(Task.id).where(Task.project_id == project_id), user, project
    )


class TaskViewService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_views(
        self,
        project_id: uuid.UUID,
        user_id: uuid.UUID,
        entity_scope: str = "tasks",
    ) -> list[ProjectTaskView]:
        rows = await self.db.execute(
            select(ProjectTaskView)
            .where(
                ProjectTaskView.project_id == project_id,
                ProjectTaskView.entity_scope == entity_scope,
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
        entity_scope: str = "tasks",
        project: Project | None = None,
    ) -> ProjectTaskView:
        _validate_payload(
            filter_json,
            sort_json,
            columns_json,
            entity_scope=entity_scope,
            project=project,
        )
        view = ProjectTaskView(
            project_id=project_id,
            owner_id=owner_id,
            name=name,
            visibility=visibility,
            entity_scope=entity_scope,
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
        project: Project | None = None,
    ) -> ProjectTaskView:
        next_filter = view.filter_json if filter_json is None else filter_json
        next_sort = view.sort_json if sort_json is None else sort_json
        next_columns = view.columns_json if columns_json is None else columns_json
        _validate_payload(
            next_filter,
            next_sort,
            next_columns,
            entity_scope=view.entity_scope,
            project=project,
        )
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
        return apply_task_visibility(stmt, user, project)

    async def count_for_filter(
        self,
        project_id: uuid.UUID,
        filter_json: dict[str, Any],
        *,
        user: User,
        project: Project,
    ) -> int:
        clause = compile_filter(filter_json, project=project, user=user)
        stmt = (
            select(func.count())
            .select_from(Task)
            .where(Task.project_id == project_id, clause)
        )
        stmt = self._apply_visibility(stmt, user, project)
        total = await self.db.scalar(stmt)
        return int(total or 0)

    async def count_for_filters(
        self,
        project_id: uuid.UUID,
        filters: list[dict[str, Any]],
        *,
        user: User,
        project: Project,
    ) -> list[int]:
        """一次扫描算出多个 filter 的计数 (内置 + 已保存视图)，避免 N+1 往返。"""
        if not filters:
            return []
        cols = [
            func.count()
            .filter(compile_filter(f, project=project, user=user))
            .label(f"c{i}")
            for i, f in enumerate(filters)
        ]
        stmt = select(*cols).select_from(Task).where(Task.project_id == project_id)
        stmt = self._apply_visibility(stmt, user, project)
        row = (await self.db.execute(stmt)).one()
        return [int(v or 0) for v in row]

    async def query_tasks(
        self,
        *,
        project_id: uuid.UUID,
        filter_json: dict[str, Any],
        sort_json: list[dict[str, Any]],
        columns_json: list[str],
        limit: int,
        offset: int,
        user: User,
        project: Project,
    ) -> tuple[list[Any], int]:
        clause = compile_filter(filter_json, project=project, user=user)
        base = Task.project_id == project_id
        count_stmt = self._apply_visibility(
            select(func.count()).select_from(Task).where(base, clause), user, project
        )
        total = await self.db.scalar(count_stmt)
        requested = set(columns_json)
        if not requested:
            # Empty columns is the legacy API shape. Keep legacy projections for
            # older clients while explicit columns opt into selective work.
            requested = set(DEFAULT_COLUMNS) | {
                "avg_prediction_confidence",
                "model_versions",
                "scene_name",
                "frame_index",
            }
        requested.update(item.get("field", "") for item in sort_json or [])
        projection: list[Any] = [Task]
        if "avg_prediction_confidence" in requested:
            projection.append(
                _avg_prediction_confidence_sq().label("avg_prediction_confidence")
            )
        if "unresolved_feedback_count" in requested:
            projection.append(
                _unresolved_feedback_count_sq().label("unresolved_feedback_count")
            )
        if "model_versions" in requested:
            projection.append(_model_versions_sq().label("model_versions"))
        if "scene_name" in requested or "scene.scene_name" in requested:
            projection.append(_scene_name_sq().label("scene_name"))
        if "frame_index" in requested or "scene.frame_index" in requested:
            projection.append(_scene_frame_sq().label("frame_index"))
        if "last_activity_at" in requested:
            projection.append(_last_activity_at_expr().label("last_activity_at"))
        if "annotation_source_counts" in requested:
            for source in ("manual", "prediction_based", "ai_tracker", "interpolated"):
                projection.append(
                    _annotation_source_count_sq(source).label(f"source_{source}_count")
                )
        if "track_count" in requested:
            projection.append(_track_count_sq().label("track_count"))
        if "pending_prediction_shape_count" in requested:
            from app.services.data_manager import pending_prediction_shapes_expr

            projection.append(
                pending_prediction_shapes_expr().label("pending_prediction_shape_count")
            )
        if "low_confidence_prediction_shape_count" in requested:
            from app.services.data_manager import (
                low_confidence_pending_prediction_shapes_expr,
            )

            projection.append(
                low_confidence_pending_prediction_shapes_expr().label(
                    "low_confidence_prediction_shape_count"
                )
            )
        if "pending_tracker_job_count" in requested:
            from app.services.data_manager import pending_tracker_jobs_expr

            projection.append(
                pending_tracker_jobs_expr(user, project).label(
                    "pending_tracker_job_count"
                )
            )
        if "keyframe_count" in requested:
            projection.append(
                _annotation_json_array_total_sq("keyframes").label("keyframe_count")
            )
        if "outside_range_count" in requested:
            projection.append(
                _annotation_json_array_total_sq("outside").label("outside_range_count")
            )
        if "camera_count" in requested:
            projection.append(_camera_count_sq().label("camera_count"))
        if "calibration_issue_count" in requested:
            projection.append(
                _calibration_issue_count_sq().label("calibration_issue_count")
            )
        if "scene_total_frames" in requested:
            projection.append(_scene_total_frames_sq().label("scene_total_frames"))
        q = select(*projection).where(base, clause)
        q = self._apply_visibility(q, user, project)
        q = apply_sort(q, sort_json).limit(limit).offset(offset)
        rows = (await self.db.execute(q)).all()
        return rows, int(total or 0)


def _validate_payload(
    filter_json: dict[str, Any],
    sort_json: list[dict[str, Any]],
    columns_json: list[str],
    *,
    entity_scope: str = "tasks",
    project: Project | None = None,
) -> None:
    if entity_scope != "tasks":
        if project is None:
            raise HTTPException(
                status_code=422,
                detail="Project context is required for entity views",
            )
        from app.services.data_manager_entity_filter import validate_entity_view

        validate_entity_view(
            entity_scope=entity_scope,
            filter_json=filter_json,
            sort_json=sort_json,
            columns_json=columns_json,
            project=project,
        )
        return
    validate_filter(filter_json, project=project)
    validate_sort(sort_json)
    validate_columns(columns_json)
