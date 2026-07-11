from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import (
    Integer,
    String,
    and_,
    case,
    cast,
    func,
    literal,
    not_,
    select,
    union_all,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.db.models.annotation import Annotation
from app.db.models.annotation_feedback import AnnotationFeedback
from app.db.models.dataset import DatasetItem
from app.db.models.prediction import Prediction
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_dataset_item_link import TaskDatasetItemLink
from app.db.models.user import User
from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus
from app.schemas.data_manager import (
    DataManagerAiReviewSummary,
    DataManagerAnnotationSummary,
    DataManagerAttributeSummary,
    DataManagerColumnOut,
    DataManagerEntityScope,
    DataManagerFilterFieldOut,
    DataManagerMetricOut,
    DataManagerMatchItem,
    DataManagerMatchesResponse,
    DataManagerOptionOut,
    DataManagerProjectKindOut,
    DataManagerSchemaResponse,
    DataManagerScopeSummary,
    DataManagerSummaryResponse,
    DataManagerToolUnitOut,
)
from app.services.project_kind import project_kind
from app.services.scheduler import is_privileged_for_project
from app.services.task_views import (
    builtin_view_keys,
    compile_annotation_match_filter,
    compile_filter,
    visible_tasks_stmt,
)


_TEXT_OPS = ["eq", "ne", "in"]
_NUMBER_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in"]
_EXISTS_OPS = ["exists", "eq", "in"]

_BASE_COLUMNS = [
    ("display_id", "任务", "任务", True, False),
    ("file_name", "文件名", "任务", True, False),
    ("status", "状态", "工作流", True, False),
    ("annotation_count", "标注", "标注", True, False),
    ("pending_prediction_shape_count", "AI 检测待审", "AI 待审", True, True),
    ("pending_tracker_job_count", "AI 追踪待审", "AI 待审", True, True),
    ("unresolved_feedback_count", "反馈", "质量", True, True),
    ("annotation_source_counts", "来源", "标注", True, True),
    ("track_count", "轨迹", "标注", True, True),
    ("last_activity_at", "最近活动", "任务", True, True),
    ("assignee", "标注员", "人员", False, False),
    ("reviewer", "审核员", "人员", False, False),
    ("batch_id", "批次", "工作流", False, False),
    ("model_versions", "模型版本", "AI 待审", False, True),
    ("avg_prediction_confidence", "置信度", "AI 待审", False, True),
]


def _option(value: str, label: str | None = None) -> DataManagerOptionOut:
    return DataManagerOptionOut(value=value, label=label or value)


def _enabled_bindings(project: Project) -> list[tuple[str, dict[str, Any]]]:
    bindings = project.tool_bindings or {}
    return [
        (unit, binding)
        for unit, binding in bindings.items()
        if isinstance(binding, dict) and binding.get("enabled", True)
    ]


def _attribute_fields(project: Project) -> list[tuple[str, dict[str, Any]]]:
    fields: list[tuple[str, dict[str, Any]]] = []
    for unit, binding in _enabled_bindings(project):
        schema = binding.get("attribute_schema") or {}
        for field in schema.get("fields") or []:
            if isinstance(field, dict) and field.get("key"):
                fields.append((unit, field))
    return fields


def _class_names(binding: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for item in binding.get("classes") or []:
        if isinstance(item, dict) and item.get("name"):
            names.append(str(item["name"]))
        elif isinstance(item, str):
            names.append(item)
    return names


def _track_capable(project: Project) -> bool:
    kind = project_kind(project)
    if kind.scene_mode:
        return True
    if kind.data_type != "video":
        return False
    return any(
        not isinstance(binding.get("video_modes"), dict)
        or binding["video_modes"].get("track", True)
        for _, binding in _enabled_bindings(project)
    )


def build_data_manager_schema(
    project: Project, entity_scope: DataManagerEntityScope = "tasks"
) -> DataManagerSchemaResponse:
    kind = project_kind(project)
    bindings = _enabled_bindings(project)
    class_values = sorted(
        {class_name for _, binding in bindings for class_name in _class_names(binding)}
    )
    unit_values = [_option(unit) for unit, _ in bindings]

    fields = [
        DataManagerFilterFieldOut(
            key="task.keyword",
            label="任务或文件",
            group="任务",
            value_type="text",
            operators=["contains"],
        ),
        DataManagerFilterFieldOut(
            key="task.status",
            label="任务状态",
            group="工作流",
            value_type="select",
            operators=_TEXT_OPS,
            options=[
                _option("pending", "待标注"),
                _option("in_progress", "标注中"),
                _option("review", "待审核"),
                _option("rejected", "已退回"),
                _option("completed", "已完成"),
            ],
        ),
        DataManagerFilterFieldOut(
            key="task.assignee",
            label="标注员",
            group="人员",
            value_type="text",
            operators=_TEXT_OPS,
        ),
        DataManagerFilterFieldOut(
            key="task.reviewer",
            label="审核员",
            group="人员",
            value_type="text",
            operators=_TEXT_OPS,
        ),
        DataManagerFilterFieldOut(
            key="task.batch_id",
            label="批次",
            group="工作流",
            value_type="text",
            operators=_TEXT_OPS,
        ),
        DataManagerFilterFieldOut(
            key="annotation.annotation_count",
            label="标注数",
            group="标注",
            value_type="number",
            operators=_NUMBER_OPS,
        ),
        DataManagerFilterFieldOut(
            key="annotation.source",
            label="标注来源",
            group="标注",
            value_type="select",
            operators=_EXISTS_OPS,
            options=[
                _option("manual", "人工"),
                _option("prediction_based", "接受 AI"),
                _option("ai_tracker", "AI 追踪"),
                _option("interpolated", "插值"),
            ],
        ),
        DataManagerFilterFieldOut(
            key="annotation.imported",
            label="导入标注",
            group="标注",
            value_type="boolean",
            operators=["eq"],
        ),
        DataManagerFilterFieldOut(
            key="annotation.tool_unit_id",
            label="工具单位",
            group="标注",
            value_type="select",
            operators=_EXISTS_OPS,
            options=unit_values,
        ),
        DataManagerFilterFieldOut(
            key="annotation.annotation_type",
            label="几何类型",
            group="标注",
            value_type="text",
            operators=_EXISTS_OPS,
        ),
        DataManagerFilterFieldOut(
            key="annotation.class_name",
            label="标注类别",
            group="标注",
            value_type="select",
            operators=_EXISTS_OPS,
            options=[_option(value) for value in class_values],
        ),
        DataManagerFilterFieldOut(
            key="ai.pending_prediction_shape_count",
            label="AI 检测候选待审",
            group="AI 待审",
            value_type="number",
            operators=_NUMBER_OPS,
            expensive=True,
        ),
        DataManagerFilterFieldOut(
            key="ai.pending_tracker_job_count",
            label="AI 追踪结果待审",
            group="AI 待审",
            value_type="number",
            operators=_NUMBER_OPS,
            expensive=True,
        ),
        DataManagerFilterFieldOut(
            key="feedback.unresolved_count",
            label="未解决反馈",
            group="质量",
            value_type="number",
            operators=_NUMBER_OPS,
        ),
        DataManagerFilterFieldOut(
            key="feedback.status",
            label="反馈状态",
            group="质量",
            value_type="select",
            operators=["eq", "in"],
            options=[_option("open", "未解决"), _option("resolved", "已解决")],
        ),
    ]

    if kind.data_type != "video":
        fields = [
            field for field in fields if field.key != "ai.pending_tracker_job_count"
        ]

    if _track_capable(project):
        fields.extend(
            [
                DataManagerFilterFieldOut(
                    key="annotation.has_track",
                    label="含轨迹",
                    group="轨迹",
                    value_type="boolean",
                    operators=["eq"],
                ),
                DataManagerFilterFieldOut(
                    key="annotation.track_id",
                    label="轨迹 ID",
                    group="轨迹",
                    value_type="text",
                    operators=["eq", "in"],
                ),
            ]
        )
    if kind.data_type == "video" and _track_capable(project):
        fields.append(
            DataManagerFilterFieldOut(
                key="keyframe.source",
                label="关键帧来源",
                group="视频",
                value_type="select",
                operators=["eq", "in"],
                options=[
                    _option("manual", "人工"),
                    _option("prediction", "预测"),
                    _option("interpolated", "插值"),
                ],
            )
        )

    if kind.scene_mode:
        fields.extend(
            [
                DataManagerFilterFieldOut(
                    key="scene.scene_name",
                    label="Scene",
                    group="Scene",
                    value_type="text",
                    operators=_TEXT_OPS,
                ),
                DataManagerFilterFieldOut(
                    key="scene.frame_index",
                    label="帧序号",
                    group="Scene",
                    value_type="number",
                    operators=_NUMBER_OPS,
                ),
            ]
        )

    for unit, field in _attribute_fields(project):
        attr_type = str(field.get("type") or "text")
        if attr_type in {"number", "range"}:
            value_type = "number"
            operators = ["eq", "gt", "gte", "lt", "lte", "between", "exists", "missing"]
        elif attr_type == "boolean":
            value_type = "boolean"
            operators = ["eq", "exists", "missing"]
        elif attr_type == "select":
            value_type = "select"
            operators = ["eq", "in", "exists", "missing"]
        elif attr_type == "multiselect":
            value_type = "multiselect"
            operators = ["contains_any", "contains_all", "exists", "missing"]
        else:
            value_type = "text"
            operators = ["eq", "contains", "exists", "missing"]
        options = [
            _option(str(item.get("value")), str(item.get("label") or item.get("value")))
            for item in field.get("options") or []
            if isinstance(item, dict) and item.get("value") is not None
        ]
        fields.append(
            DataManagerFilterFieldOut(
                key=f"annotation.attribute.{unit}.{field['key']}",
                label=str(field.get("label") or field["key"]),
                group=f"属性 · {unit}",
                value_type=value_type,  # type: ignore[arg-type]
                operators=operators,
                options=options,
                expensive=True,
                tool_unit_id=unit,
                attribute_key=str(field["key"]),
            )
        )
        fields.append(
            DataManagerFilterFieldOut(
                key=f"annotation.attribute_origin.{unit}.{field['key']}",
                label=f"{field.get('label') or field['key']}来源",
                group=f"属性来源 · {unit}",
                value_type="select",
                operators=["eq", "in"],
                options=[_option("human", "人工"), _option("ai", "AI")],
                expensive=True,
                tool_unit_id=unit,
                attribute_key=str(field["key"]),
            )
        )

    columns = [
        DataManagerColumnOut(
            key=key,
            label=label,
            group=group,
            default=default,
            expensive=expensive,
        )
        for key, label, group, default, expensive in _BASE_COLUMNS
        if (key != "pending_tracker_job_count" or kind.data_type == "video")
        and (key != "track_count" or _track_capable(project))
    ]
    if kind.data_type == "image":
        columns.append(
            DataManagerColumnOut(
                key="resolution", label="分辨率", group="图像", default=True
            )
        )
    if kind.scene_mode:
        columns.extend(
            [
                DataManagerColumnOut(
                    key="scene_name", label="Scene", group="Scene", default=True
                ),
                DataManagerColumnOut(
                    key="frame_index", label="帧", group="Scene", default=True
                ),
            ]
        )
    if kind.data_type == "video":
        columns.extend(
            [
                DataManagerColumnOut(
                    key="duration", label="时长", group="视频", default=True
                ),
                DataManagerColumnOut(key="fps", label="FPS", group="视频"),
                DataManagerColumnOut(
                    key="frame_count", label="总帧数", group="视频", default=True
                ),
                DataManagerColumnOut(
                    key="keyframe_count",
                    label="关键帧",
                    group="视频",
                    default=_track_capable(project),
                    expensive=True,
                ),
                DataManagerColumnOut(
                    key="outside_range_count",
                    label="不可见区间",
                    group="视频",
                    expensive=True,
                ),
            ]
        )
    if kind.data_type == "lidar":
        columns.extend(
            [
                DataManagerColumnOut(
                    key="camera_count", label="相机路数", group="点云", default=True
                ),
                DataManagerColumnOut(
                    key="calibration_issue_count",
                    label="标定异常",
                    group="点云",
                    default=True,
                    expensive=True,
                ),
            ]
        )
    if kind.scene_mode:
        columns.append(
            DataManagerColumnOut(
                key="scene_total_frames",
                label="Scene 总帧",
                group="Scene",
                default=True,
            )
        )

    available_scopes: list[DataManagerEntityScope] = ["tasks", "objects"]
    if _track_capable(project):
        available_scopes.append("tracks")
    if entity_scope not in available_scopes:
        raise HTTPException(
            status_code=422,
            detail=f"Data Manager scope is not supported: {entity_scope}",
        )

    sort_fields = [
        _option("task.created_at", "创建时间"),
        _option("task.updated_at", "更新时间"),
        _option("task.display_id", "任务编号"),
        _option("annotation_count", "标注数"),
        _option("unresolved_feedback_count", "未解决反馈"),
        _option("last_activity_at", "最近活动"),
    ]
    metrics = [
        DataManagerMetricOut(key="tasks", label="任务", group="任务"),
        DataManagerMetricOut(key="annotations", label="标注对象", group="标注"),
        DataManagerMetricOut(key="ai_review", label="AI 待审", group="AI 待审"),
        *(
            [DataManagerMetricOut(key="tracks", label="轨迹", group="轨迹")]
            if _track_capable(project)
            else []
        ),
        DataManagerMetricOut(key="feedback", label="未解决反馈", group="质量"),
    ]
    builtin_views = builtin_view_keys(project)

    if entity_scope in {"objects", "tracks"}:
        excluded = {
            "annotation.annotation_count",
            "ai.pending_prediction_shape_count",
            "ai.pending_tracker_job_count",
        }
        fields = [field for field in fields if field.key not in excluded]
        if entity_scope == "objects":
            object_columns = [
                ("class_name", "类别", "对象", True, "annotation.class_name"),
                ("source", "来源", "对象", True, "annotation.source"),
                (
                    "tool_geometry",
                    "工具 / 几何",
                    "对象",
                    True,
                    "annotation.annotation_type",
                ),
                ("track_id", "轨迹 ID", "轨迹", True, "annotation.track_id"),
                ("attributes", "属性", "属性", True, None),
                ("task_location", "任务 / 帧", "定位", True, "task.display_id"),
                ("feedback", "反馈", "质量", True, "feedback.unresolved_count"),
                ("updated_at", "更新时间", "对象", True, "annotation.updated_at"),
                ("confidence", "置信度", "对象", False, "annotation.confidence"),
                ("created_by", "创建者", "人员", False, None),
                ("annotation_id", "标注 ID", "对象", False, "annotation.id"),
            ]
            columns = [
                DataManagerColumnOut(
                    key=key,
                    label=label,
                    group=group,
                    default=default,
                    expensive=key in {"attributes", "feedback"},
                    sortable=sort_field is not None,
                    sort_field=sort_field,
                )
                for key, label, group, default, sort_field in object_columns
            ]
            sort_fields = [
                _option("annotation.updated_at", "更新时间"),
                _option("annotation.created_at", "创建时间"),
                _option("annotation.class_name", "类别"),
                _option("annotation.source", "来源"),
                _option("annotation.track_id", "轨迹 ID"),
                _option("annotation.confidence", "置信度"),
                _option("task.display_id", "任务编号"),
            ]
            metrics = [
                DataManagerMetricOut(key="objects", label="对象", group="对象"),
                DataManagerMetricOut(key="tasks", label="涉及任务", group="任务"),
                DataManagerMetricOut(key="feedback", label="未解决反馈", group="质量"),
            ]
            builtin_views = ["all", "manual", "accepted-ai", "feedback-open"]
        else:
            track_columns = [
                ("track_id", "轨迹 ID", "轨迹", True, "track.track_id"),
                ("class_name", "类别", "轨迹", True, "track.class_name"),
                ("track_kind", "类型", "轨迹", True, "track.track_kind"),
                ("range", "范围", "时空", True, "track.start_frame"),
                ("coverage", "实例 / 关键帧", "时空", True, "track.occurrence_count"),
                (
                    "visibility",
                    "不可见 / 遮挡",
                    "质量",
                    True,
                    "track.outside_range_count",
                ),
                ("sources", "来源", "来源", True, None),
                ("attributes", "属性", "属性", True, None),
                ("quality", "质量异常", "质量", True, "track.quality_issue_count"),
            ]
            columns = [
                DataManagerColumnOut(
                    key=key,
                    label=label,
                    group=group,
                    default=default,
                    expensive=key in {"visibility", "attributes", "quality"},
                    sortable=sort_field is not None,
                    sort_field=sort_field,
                )
                for key, label, group, default, sort_field in track_columns
            ]
            sort_fields = [
                _option("track.track_id", "轨迹 ID"),
                _option("track.class_name", "类别"),
                _option("track.track_kind", "类型"),
                _option("track.start_frame", "起始帧"),
                _option("track.occurrence_count", "实例 / 关键帧数"),
                _option("track.quality_issue_count", "质量异常"),
            ]
            metrics = [
                DataManagerMetricOut(key="tracks", label="轨迹", group="轨迹"),
                DataManagerMetricOut(key="objects", label="可见实例", group="对象"),
                DataManagerMetricOut(key="quality", label="质量异常", group="质量"),
            ]
            builtin_views = ["all", "manual", "ai-tracker", "interpolated"]

    return DataManagerSchemaResponse(
        entity_scope=entity_scope,
        available_entity_scopes=available_scopes,
        project_kind=DataManagerProjectKindOut(
            data_type=kind.data_type,
            type_key=project.type_key,
            scene_mode=kind.scene_mode,
        ),
        tool_units=[
            DataManagerToolUnitOut(
                id=unit,
                classes=_class_names(binding),
            )
            for unit, binding in bindings
        ],
        filter_fields=fields,
        columns=columns,
        default_columns=[column.key for column in columns if column.default],
        sort_fields=sort_fields,
        metrics=metrics,
        builtin_views=builtin_views,
    )


def pending_prediction_shapes_expr():
    prediction = aliased(Prediction)
    result_count = case(
        (
            func.jsonb_typeof(prediction.result) == "array",
            func.jsonb_array_length(prediction.result),
        ),
        else_=0,
    )
    rejected_count = case(
        (
            func.jsonb_typeof(prediction.rejected_shape_indexes) == "array",
            func.jsonb_array_length(prediction.rejected_shape_indexes),
        ),
        else_=0,
    )
    shape_index = cast(Annotation.attributes["_shape_index"].astext, Integer)
    accepted_not_rejected = (
        select(func.count(func.distinct(shape_index)))
        .where(
            Annotation.parent_prediction_id == prediction.id,
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
            Annotation.attributes.has_key("_shape_index"),  # noqa: W601
            not_(
                prediction.rejected_shape_indexes.op("@>")(
                    func.jsonb_build_array(shape_index)
                )
            ),
        )
        .correlate(prediction)
        .scalar_subquery()
    )
    return (
        select(
            func.coalesce(
                func.sum(
                    func.greatest(
                        result_count - rejected_count - accepted_not_rejected, 0
                    )
                ),
                0,
            )
        )
        .where(prediction.task_id == Task.id)
        .correlate(Task)
        .scalar_subquery()
    )


def pending_tracker_jobs_expr(user: User | None, project: Project):
    results = VideoTrackerJob.staged_result["results"]
    reviewable = and_(
        VideoTrackerJob.task_id == Task.id,
        VideoTrackerJob.status.in_(
            [
                VideoTrackerJobStatus.PENDING_REVIEW.value,
                VideoTrackerJobStatus.CANCELLED.value,
            ]
        ),
        VideoTrackerJob.staged_result.is_not(None),
        case(
            (func.jsonb_typeof(results) == "array", func.jsonb_array_length(results)),
            else_=0,
        )
        > 0,
    )
    if user is not None and not is_privileged_for_project(user, project):
        reviewable = and_(reviewable, VideoTrackerJob.created_by == user.id)
    return (
        select(func.count(VideoTrackerJob.id))
        .where(reviewable)
        .correlate(Task)
        .scalar_subquery()
    )


def _json_scalar_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def _attribute_eligibility_clause(
    annotation_base,
    unit: str,
    field: dict[str, Any],
):
    clauses = [annotation_base, Annotation.tool_unit_id == unit]
    applies_to = field.get("applies_to")
    if isinstance(applies_to, list) and applies_to:
        clauses.append(Annotation.class_name.in_([str(item) for item in applies_to]))
    visible_if = field.get("visible_if")
    if isinstance(visible_if, dict) and visible_if.get("key"):
        dependency = str(visible_if["key"])
        clauses.extend(
            [
                Annotation.attributes.has_key(dependency),  # noqa: W601
                Annotation.attributes[dependency].astext
                == _json_scalar_text(visible_if.get("equals")),
            ]
        )
    return and_(*clauses)


class DataManagerService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def summary(
        self,
        *,
        project_id,
        filter_json: dict[str, Any],
        user: User,
        project: Project,
    ) -> DataManagerSummaryResponse:
        visible_stmt = visible_tasks_stmt(project_id, user=user, project=project)
        matched_stmt = visible_tasks_stmt(project_id, user=user, project=project).where(
            compile_filter(filter_json, project=project, user=user)
        )
        visible_ids = visible_stmt.subquery("dm_visible_tasks")
        matched_ids = matched_stmt.subquery("dm_matched_tasks")

        visible_total = int(
            await self.db.scalar(select(func.count()).select_from(visible_ids)) or 0
        )
        matched_total = int(
            await self.db.scalar(select(func.count()).select_from(matched_ids)) or 0
        )

        status_rows = await self.db.execute(
            select(Task.status, func.count(Task.id))
            .join(matched_ids, matched_ids.c.id == Task.id)
            .group_by(Task.status)
        )
        task_status = {str(status): int(count) for status, count in status_rows}

        annotation_base = and_(
            Annotation.task_id.in_(select(matched_ids.c.id)),
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
        )
        annotation_counts = (
            await self.db.execute(
                select(
                    func.count(Annotation.id).label("total"),
                    func.count(Annotation.id)
                    .filter(Annotation.track_id.is_not(None))
                    .label("tracked"),
                    func.count(func.distinct(Annotation.track_id))
                    .filter(Annotation.track_id.is_not(None))
                    .label("distinct_tracks"),
                    func.count(Annotation.id)
                    .filter(
                        Annotation.attributes.op("@>")(
                            literal({"_imported": True}, type_=JSONB)
                        )
                    )
                    .label("imported"),
                ).where(annotation_base)
            )
        ).one()
        annotation_total = int(annotation_counts.total or 0)
        tracked = int(annotation_counts.tracked or 0)
        distinct_tracks = int(annotation_counts.distinct_tracks or 0)
        imported = int(annotation_counts.imported or 0)

        dimension_queries = []
        for dimension, column in (
            ("source", Annotation.source),
            ("class", Annotation.class_name),
            ("tool_unit", Annotation.tool_unit_id),
            ("type", Annotation.annotation_type),
        ):
            dimension_queries.append(
                select(
                    literal(dimension).label("dimension"),
                    cast(column, String).label("value"),
                    func.count(Annotation.id).label("count"),
                )
                .where(annotation_base, column.is_not(None))
                .group_by(column)
            )
        distribution_rows = await self.db.execute(union_all(*dimension_queries))
        distributions: dict[str, dict[str, int]] = {
            "source": {},
            "class": {},
            "tool_unit": {},
            "type": {},
        }
        for dimension, value, count in distribution_rows:
            distributions[str(dimension)][str(value)] = int(count)
        by_source = distributions["source"]
        by_class = distributions["class"]
        by_tool_unit = distributions["tool_unit"]
        by_type = distributions["type"]

        pending_shapes = int(
            await self.db.scalar(
                select(func.coalesce(func.sum(pending_prediction_shapes_expr()), 0))
                .select_from(Task)
                .join(matched_ids, matched_ids.c.id == Task.id)
            )
            or 0
        )
        pending_tracker_jobs = int(
            await self.db.scalar(
                select(
                    func.coalesce(func.sum(pending_tracker_jobs_expr(user, project)), 0)
                )
                .select_from(Task)
                .join(matched_ids, matched_ids.c.id == Task.id)
            )
            or 0
        )
        unresolved_feedback = int(
            await self.db.scalar(
                select(func.count(AnnotationFeedback.id)).where(
                    AnnotationFeedback.task_id.in_(select(matched_ids.c.id)),
                    AnnotationFeedback.is_active.is_(True),
                    AnnotationFeedback.status == "open",
                )
            )
            or 0
        )

        attribute_summaries: list[DataManagerAttributeSummary] = []
        # Attribute schemas are project-bounded (normally a handful of fields),
        # so this loop is bounded by configuration rather than task/annotation
        # cardinality. Each query aggregates the whole matched scope in SQL.
        for unit, field in _attribute_fields(project):
            key = str(field["key"])
            eligible_clause = _attribute_eligibility_clause(
                annotation_base, unit, field
            )
            counts = (
                await self.db.execute(
                    select(
                        func.count(Annotation.id).label("eligible"),
                        func.count(Annotation.id)
                        .filter(Annotation.attributes.has_key(key))  # noqa: W601
                        .label("present"),
                    ).where(eligible_clause)
                )
            ).one()
            eligible = int(counts.eligible or 0)
            present = int(counts.present or 0)
            values: dict[str, int] = {}
            if field.get("type") in {"boolean", "select"}:
                value_expr = Annotation.attributes[key].astext
                rows = await self.db.execute(
                    select(
                        value_expr,
                        func.count(Annotation.id),
                    )
                    .where(
                        eligible_clause,
                        Annotation.attributes.has_key(key),  # noqa: W601
                    )
                    .group_by(value_expr)
                    .limit(50)
                )
                values = {str(value): int(count) for value, count in rows}
            attribute_summaries.append(
                DataManagerAttributeSummary(
                    tool_unit_id=unit,
                    key=key,
                    label=str(field.get("label") or key),
                    eligible=eligible,
                    present=present,
                    missing=max(eligible - present, 0),
                    values=values,
                )
            )

        kind = project_kind(project)
        kind_metrics: dict[str, int | float | None] = {}
        if kind.data_type == "image":
            image_rows = (
                await self.db.execute(
                    select(
                        func.count(DatasetItem.id)
                        .filter(
                            DatasetItem.width.is_not(None),
                            DatasetItem.height.is_not(None),
                        )
                        .label("with_dimensions"),
                        func.count(
                            func.distinct(
                                func.concat(
                                    DatasetItem.width,
                                    "x",
                                    DatasetItem.height,
                                )
                            )
                        )
                        .filter(
                            DatasetItem.width.is_not(None),
                            DatasetItem.height.is_not(None),
                        )
                        .label("distinct_resolutions"),
                    )
                    .select_from(Task)
                    .join(matched_ids, matched_ids.c.id == Task.id)
                    .join(DatasetItem, DatasetItem.id == Task.dataset_item_id)
                )
            ).one()
            kind_metrics = {
                "images_with_dimensions": int(image_rows.with_dimensions or 0),
                "distinct_resolutions": int(image_rows.distinct_resolutions or 0),
            }
        elif kind.data_type == "video":
            video_meta = DatasetItem.metadata_["video"]
            video_rows = (
                await self.db.execute(
                    select(
                        func.coalesce(
                            func.sum(cast(video_meta["duration_ms"].astext, Integer)),
                            0,
                        ).label("duration_ms"),
                        func.coalesce(
                            func.sum(cast(video_meta["frame_count"].astext, Integer)),
                            0,
                        ).label("frame_count"),
                    )
                    .select_from(Task)
                    .join(matched_ids, matched_ids.c.id == Task.id)
                    .join(DatasetItem, DatasetItem.id == Task.dataset_item_id)
                )
            ).one()
            keyframes = case(
                (
                    func.jsonb_typeof(Annotation.geometry["keyframes"]) == "array",
                    func.jsonb_array_length(Annotation.geometry["keyframes"]),
                ),
                else_=0,
            )
            outside_ranges = case(
                (
                    func.jsonb_typeof(Annotation.geometry["outside"]) == "array",
                    func.jsonb_array_length(Annotation.geometry["outside"]),
                ),
                else_=0,
            )
            video_annotation_rows = (
                await self.db.execute(
                    select(
                        func.coalesce(func.sum(keyframes), 0).label("keyframes"),
                        func.coalesce(func.sum(outside_ranges), 0).label(
                            "outside_ranges"
                        ),
                    ).where(annotation_base)
                )
            ).one()
            kind_metrics = {
                "duration_ms": int(video_rows.duration_ms or 0),
                "frame_count": int(video_rows.frame_count or 0),
                "keyframes": int(video_annotation_rows.keyframes or 0),
                "outside_ranges": int(video_annotation_rows.outside_ranges or 0),
            }
        elif kind.data_type == "lidar":
            camera_clause = and_(
                TaskDatasetItemLink.task_id.in_(select(matched_ids.c.id)),
                TaskDatasetItemLink.role.like("camera_%"),
            )
            camera_links = int(
                await self.db.scalar(
                    select(func.count(TaskDatasetItemLink.id)).where(camera_clause)
                )
                or 0
            )
            calibration_issues = int(
                await self.db.scalar(
                    select(func.count(TaskDatasetItemLink.id))
                    .join(
                        DatasetItem,
                        DatasetItem.id == TaskDatasetItemLink.dataset_item_id,
                    )
                    .where(
                        camera_clause,
                        not_(
                            DatasetItem.metadata_.has_key("calibration")  # noqa: W601
                        ),
                    )
                )
                or 0
            )
            kind_metrics = {
                "box_3d": by_type.get("box_3d", 0),
                "point_mask_3d": by_type.get("point_mask_3d", 0),
                "camera_links": camera_links,
                "calibration_issues": calibration_issues,
            }
        if kind.scene_mode:
            primary_item_id = (
                select(TaskDatasetItemLink.dataset_item_id)
                .where(
                    TaskDatasetItemLink.task_id == Task.id,
                    TaskDatasetItemLink.role == "primary_lidar",
                )
                .limit(1)
                .correlate(Task)
                .scalar_subquery()
            )
            scene_ids = (
                select(DatasetItem.scene_id)
                .select_from(Task)
                .join(matched_ids, matched_ids.c.id == Task.id)
                .join(
                    DatasetItem,
                    DatasetItem.id
                    == func.coalesce(Task.dataset_item_id, primary_item_id),
                )
                .where(DatasetItem.scene_id.is_not(None))
                .subquery()
            )
            kind_metrics.update(
                {
                    "scenes": int(
                        await self.db.scalar(
                            select(func.count(func.distinct(scene_ids.c.scene_id)))
                        )
                        or 0
                    ),
                    "interpolated_annotations": by_source.get("interpolated", 0),
                }
            )

        return DataManagerSummaryResponse(
            scope=DataManagerScopeSummary(
                visible_task_total=visible_total,
                matched_task_total=matched_total,
            ),
            task_status=task_status,
            annotations=DataManagerAnnotationSummary(
                total=annotation_total,
                single_frame=max(annotation_total - tracked, 0),
                tracked=tracked,
                distinct_tracks=distinct_tracks,
                imported=imported,
                by_source=by_source,
                by_class=by_class,
                by_tool_unit=by_tool_unit,
                by_type=by_type,
            ),
            ai_review=DataManagerAiReviewSummary(
                prediction_shapes=pending_shapes,
                tracker_jobs=pending_tracker_jobs,
            ),
            unresolved_feedback=unresolved_feedback,
            attributes=attribute_summaries,
            kind_metrics=kind_metrics,
        )

    async def matches(
        self,
        *,
        project_id,
        task_id,
        filter_json: dict[str, Any],
        limit: int,
        offset: int,
        user: User,
        project: Project,
    ) -> DataManagerMatchesResponse:
        visible = await self.db.scalar(
            visible_tasks_stmt(project_id, user=user, project=project).where(
                Task.id == task_id
            )
        )
        if visible is None:
            raise HTTPException(status_code=404, detail="Task not found")
        matched = await self.db.scalar(
            visible_tasks_stmt(project_id, user=user, project=project).where(
                Task.id == task_id,
                compile_filter(filter_json, project=project, user=user),
            )
        )
        if matched is None:
            return DataManagerMatchesResponse(
                task_id=task_id, items=[], total=0, limit=limit, offset=offset
            )

        includes_ai_candidates = _filter_has_field(
            filter_json, "ai.pending_prediction_shape_count"
        ) or _filter_has_field(filter_json, "ai.pending_tracker_job_count")
        include_annotations = (
            _filter_has_annotation_field(filter_json) or not includes_ai_candidates
        )
        items: list[DataManagerMatchItem] = []
        if include_annotations:
            annotation_condition = compile_annotation_match_filter(
                filter_json, Annotation, project
            )
            annotation_rows = await self.db.execute(
                select(
                    Annotation.id,
                    Annotation.track_id,
                    Annotation.class_name,
                    Annotation.tool_unit_id,
                    Annotation.annotation_type,
                    Annotation.source,
                    Annotation.attributes,
                    cast(Annotation.geometry["frame_index"].astext, Integer).label(
                        "frame_index"
                    ),
                )
                .where(
                    Annotation.task_id == task_id,
                    Annotation.is_active.is_(True),
                    Annotation.was_cancelled.is_(False),
                    annotation_condition,
                )
                .order_by(Annotation.created_at, Annotation.id)
            )
            items.extend(
                DataManagerMatchItem(
                    entity_kind="annotation",
                    id=row.id,
                    track_id=row.track_id,
                    class_name=row.class_name,
                    tool_unit_id=row.tool_unit_id,
                    annotation_type=row.annotation_type,
                    source=row.source,
                    attributes={
                        key: value
                        for key, value in (row.attributes or {}).items()
                        if not str(key).startswith("_")
                    },
                    frame_index=row.frame_index,
                )
                for row in annotation_rows
            )

        if _filter_has_field(filter_json, "ai.pending_prediction_shape_count"):
            from app.services.prediction import to_internal_shape

            accepted_rows = await self.db.execute(
                select(Annotation.parent_prediction_id, Annotation.attributes).where(
                    Annotation.task_id == task_id,
                    Annotation.parent_prediction_id.is_not(None),
                    Annotation.is_active.is_(True),
                    Annotation.was_cancelled.is_(False),
                )
            )
            accepted = {
                (prediction_id, int(attributes["_shape_index"]))
                for prediction_id, attributes in accepted_rows
                if isinstance(attributes, dict) and "_shape_index" in attributes
            }
            prediction_rows = await self.db.execute(
                select(Prediction).where(Prediction.task_id == task_id)
            )
            for prediction in prediction_rows.scalars().all():
                rejected = set(prediction.rejected_shape_indexes or [])
                for shape_index, raw_shape in enumerate(prediction.result or []):
                    if (
                        shape_index in rejected
                        or (prediction.id, shape_index) in accepted
                    ):
                        continue
                    shape = to_internal_shape(raw_shape)
                    geometry = shape.get("geometry") or {}
                    items.append(
                        DataManagerMatchItem(
                            entity_kind="prediction_shape",
                            id=prediction.id,
                            shape_index=shape_index,
                            class_name=shape.get("class_name"),
                            tool_unit_id=prediction.tool_unit_id,
                            annotation_type=shape.get("type"),
                            source="prediction_candidate",
                            attributes=shape.get("attributes") or {},
                            frame_index=geometry.get("frame_index"),
                        )
                    )

        if _filter_has_field(filter_json, "ai.pending_tracker_job_count"):
            tracker_results = VideoTrackerJob.staged_result["results"]
            tracker_clause = and_(
                VideoTrackerJob.task_id == task_id,
                VideoTrackerJob.status.in_(
                    [
                        VideoTrackerJobStatus.PENDING_REVIEW.value,
                        VideoTrackerJobStatus.CANCELLED.value,
                    ]
                ),
                VideoTrackerJob.staged_result.is_not(None),
                case(
                    (
                        func.jsonb_typeof(tracker_results) == "array",
                        func.jsonb_array_length(tracker_results),
                    ),
                    else_=0,
                )
                > 0,
            )
            if not is_privileged_for_project(user, project):
                tracker_clause = and_(
                    tracker_clause, VideoTrackerJob.created_by == user.id
                )
            tracker_rows = await self.db.execute(
                select(VideoTrackerJob).where(tracker_clause)
            )
            items.extend(
                DataManagerMatchItem(
                    entity_kind="tracker_job",
                    id=job.id,
                    source="ai_tracker_candidate",
                    frame_index=job.from_frame,
                )
                for job in tracker_rows.scalars().all()
            )

        total = len(items)
        return DataManagerMatchesResponse(
            task_id=task_id,
            items=items[offset : offset + limit],
            total=total,
            limit=limit,
            offset=offset,
        )


def _filter_has_field(filter_json: dict[str, Any], field: str) -> bool:
    if filter_json.get("field") == field:
        return True
    return any(
        _filter_has_field(child, field)
        for child in filter_json.get("rules") or []
        if isinstance(child, dict)
    )


def _filter_has_annotation_field(filter_json: dict[str, Any]) -> bool:
    field = filter_json.get("field")
    if isinstance(field, str) and (
        field.startswith("annotation.") or field == "keyframe.source"
    ):
        return field != "annotation.annotation_count"
    return any(
        _filter_has_annotation_field(child)
        for child in filter_json.get("rules") or []
        if isinstance(child, dict)
    )
