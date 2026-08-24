"""Strict preflight contract for trusted LiDAR exports."""

from __future__ import annotations

import math
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.task import Task
from app.db.models.task_dataset_item_link import TaskDatasetItemLink
from app.schemas._jsonb_types import SensorCalibration
from app.schemas.export import (
    LidarExportIssue,
    LidarExportOptions,
    LidarExportPreflightResponse,
)
from app.services.axis_convention import R_NORM


MAX_PREFLIGHT_ISSUES = 200
PREFLIGHT_LINK_CHUNK_SIZE = 1000


class LidarExportPreflightFailed(ValueError):
    def __init__(self, report: LidarExportPreflightResponse):
        self.report = report
        codes = sorted({issue.code for issue in report.issues})
        super().__init__(",".join(codes) or "lidar_export_preflight_failed")


def _rotation_determinant(matrix: list[float]) -> float:
    a, b, c = matrix[0], matrix[1], matrix[2]
    d, e, f = matrix[4], matrix[5], matrix[6]
    g, h, i = matrix[8], matrix[9], matrix[10]
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)


def _rotation_is_orthonormal(matrix: list[float]) -> bool:
    rows = (
        (float(matrix[0]), float(matrix[1]), float(matrix[2])),
        (float(matrix[4]), float(matrix[5]), float(matrix[6])),
        (float(matrix[8]), float(matrix[9]), float(matrix[10])),
    )
    for row in rows:
        if abs(sum(value * value for value in row) - 1.0) > 1e-3:
            return False
    return all(
        abs(sum(left[i] * right[i] for i in range(3))) <= 1e-3
        for index, left in enumerate(rows)
        for right in rows[index + 1 :]
    )


def _frame_key(task: Task, item: DatasetItem | None) -> str:
    path = (task.file_path or "").lstrip("/")
    parts = path.split("/", 1)
    relative = parts[1] if len(parts) == 2 else path
    base = relative.rsplit(".", 1)[0]
    return base or task.display_id


def calibration_is_valid(raw: object) -> bool:
    try:
        calibration = SensorCalibration.model_validate(raw)
    except ValueError:
        return False
    values = [*calibration.extrinsic, *calibration.intrinsic]
    if calibration.rect:
        values.extend(calibration.rect)
    if not all(math.isfinite(float(value)) for value in values):
        return False
    extrinsic = calibration.extrinsic
    if abs(
        _rotation_determinant(extrinsic) - 1.0
    ) > 0.05 or not _rotation_is_orthonormal(extrinsic):
        return False
    if any(
        abs(float(extrinsic[index]) - expected) > 1e-6
        for index, expected in zip((12, 13, 14, 15), (0, 0, 0, 1), strict=True)
    ):
        return False
    intrinsic = calibration.intrinsic
    if float(intrinsic[0]) <= 1e-9 or float(intrinsic[4]) <= 1e-9:
        return False
    if (
        abs(float(intrinsic[6])) > 1e-9
        or abs(float(intrinsic[7])) > 1e-9
        or abs(float(intrinsic[8]) - 1.0) > 1e-9
    ):
        return False
    if calibration.rect and any(
        abs(float(calibration.rect[index]) - expected) > 1e-6
        for index, expected in zip((12, 13, 14, 15), (0, 0, 0, 1), strict=True)
    ):
        return False
    if calibration.rect and (
        abs(_rotation_determinant(calibration.rect) - 1.0) > 0.05
        or not _rotation_is_orthonormal(calibration.rect)
    ):
        return False
    return True


async def preflight_lidar_export(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    batch_id: uuid.UUID | None,
    targets: list[str],
    options: LidarExportOptions | None,
) -> LidarExportPreflightResponse:
    selected_role = options.kitti_camera_role if options else None
    issues: list[LidarExportIssue] = []
    issue_count = 0

    def add_issue(issue: LidarExportIssue) -> None:
        nonlocal issue_count
        issue_count += 1
        if len(issues) < MAX_PREFLIGHT_ISSUES:
            issues.append(issue)

    if "nuscenes" in targets:
        add_issue(
            LidarExportIssue(
                code="nuscenes_export_not_trusted",
                message="nuScenes 导出尚未具备真实 scene、timestamp 与 ego pose 合同",
            )
        )

    needs_kitti = "kitti" in targets
    if not needs_kitti:
        return LidarExportPreflightResponse(
            ready=issue_count == 0,
            camera_roles=[],
            selected_camera_role=selected_role,
            checked_tasks=0,
            issue_count=issue_count,
            issues_truncated=issue_count > len(issues),
            issues=issues,
        )

    task_query = (
        select(Task, DatasetItem, Dataset)
        .outerjoin(DatasetItem, DatasetItem.id == Task.dataset_item_id)
        .outerjoin(Dataset, Dataset.id == DatasetItem.dataset_id)
        .where(Task.project_id == project_id)
        .order_by(Task.sequence_order, Task.created_at)
    )
    if batch_id is not None:
        task_query = task_query.where(Task.batch_id == batch_id)
    task_rows = list((await db.execute(task_query)).all())
    tasks = [row[0] for row in task_rows]
    task_ids = [task.id for task in tasks]

    links_by_task: dict[uuid.UUID, dict[str, DatasetItem]] = {}
    camera_roles: set[str] = set()
    for start in range(0, len(task_ids), PREFLIGHT_LINK_CHUNK_SIZE):
        chunk_ids = task_ids[start : start + PREFLIGHT_LINK_CHUNK_SIZE]
        link_rows = (
            await db.execute(
                select(TaskDatasetItemLink, DatasetItem)
                .join(
                    DatasetItem, DatasetItem.id == TaskDatasetItemLink.dataset_item_id
                )
                .where(
                    TaskDatasetItemLink.task_id.in_(chunk_ids),
                    TaskDatasetItemLink.role.like("camera_%"),
                )
                .order_by(TaskDatasetItemLink.role)
            )
        ).all()
        for link, item in link_rows:
            links_by_task.setdefault(link.task_id, {})[link.role] = item
            camera_roles.add(link.role)

    if selected_role is None:
        add_issue(
            LidarExportIssue(
                code="kitti_camera_required",
                message="KITTI 导出必须显式选择一条相机通道",
            )
        )
    elif selected_role not in camera_roles:
        add_issue(
            LidarExportIssue(
                code="kitti_camera_role_not_found",
                message=f"项目中不存在相机通道 {selected_role}",
                camera_role=selected_role,
            )
        )

    for task, primary_item, dataset in task_rows:
        frame_key = _frame_key(task, primary_item)
        common = {
            "task_id": task.id,
            "task_display_id": task.display_id,
            "frame_key": frame_key,
        }
        if primary_item is None:
            add_issue(
                LidarExportIssue(
                    code="primary_lidar_missing",
                    message="任务缺少主点云数据项",
                    **common,
                )
            )
        convention = (
            (dataset.metadata_ or {}).get("axis_convention") if dataset else None
        )
        if convention is None:
            add_issue(
                LidarExportIssue(
                    code="axis_convention_missing",
                    message="主点云数据集缺少 axis_convention",
                    **common,
                )
            )
        elif convention == "raw" or convention not in R_NORM:
            add_issue(
                LidarExportIssue(
                    code="axis_convention_untrusted",
                    message=f"axis_convention={convention!s} 无法用于可信坐标反变换",
                    **common,
                )
            )

        if selected_role is None:
            continue
        camera_item = links_by_task.get(task.id, {}).get(selected_role)
        if camera_item is None:
            add_issue(
                LidarExportIssue(
                    code="camera_frame_missing",
                    message=f"当前帧缺少相机通道 {selected_role}",
                    camera_role=selected_role,
                    **common,
                )
            )
            continue
        if (
            not camera_item.width
            or camera_item.width <= 0
            or not camera_item.height
            or camera_item.height <= 0
        ):
            add_issue(
                LidarExportIssue(
                    code="camera_image_size_missing",
                    message=f"相机通道 {selected_role} 缺少有效图像宽高",
                    camera_role=selected_role,
                    **common,
                )
            )
        if not calibration_is_valid((camera_item.metadata_ or {}).get("calibration")):
            add_issue(
                LidarExportIssue(
                    code="camera_calibration_invalid",
                    message=f"相机通道 {selected_role} 缺少有效内外参",
                    camera_role=selected_role,
                    **common,
                )
            )

    return LidarExportPreflightResponse(
        ready=issue_count == 0,
        camera_roles=sorted(camera_roles),
        selected_camera_role=selected_role,
        checked_tasks=len(tasks),
        issue_count=issue_count,
        issues_truncated=issue_count > len(issues),
        issues=issues,
    )


async def assert_lidar_export_ready(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    batch_id: uuid.UUID | None,
    targets: list[str],
    options: LidarExportOptions | None,
) -> LidarExportPreflightResponse:
    report = await preflight_lidar_export(
        db,
        project_id=project_id,
        batch_id=batch_id,
        targets=targets,
        options=options,
    )
    if not report.ready:
        raise LidarExportPreflightFailed(report)
    return report
