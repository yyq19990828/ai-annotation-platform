from __future__ import annotations

import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timezone
import uuid

import numpy as np
from sqlalchemy import select

from app.db.models.async_job import AsyncJob, AsyncJobStatus
from app.db.models.point_cloud_quality import (
    PointCloudQualityIssue,
    PointCloudQualityRun,
)
from app.db.models.project import Project
from app.schemas.point_cloud_quality import PointCloudQualityConfig
from app.services import async_job as async_job_svc
from app.services.axis_convention import R_NORM
from app.services.async_job_notify import notify_job_terminal
from app.services.point_cloud_quality.config import severity_for_rule
from app.services.point_cloud_quality.kernel import (
    Box3D,
    QualityFinding,
    TrackInterval,
    TrackMember,
    evaluate_box,
    evaluate_track,
    parse_pcd_positions,
)
from app.services.point_cloud_quality.service import (
    current_source_digest,
    issue_dedupe_key,
    thresholds_from_config,
)
from app.services.storage import storage_service
from app.workers._db import task_session
from app.workers.celery_app import celery_app


MAX_POINT_CLOUD_BYTES = 256 * 1024 * 1024
SEVERITY_RANK = {"blocker": 0, "warning": 1, "info": 2}


@celery_app.task(bind=True, name="app.workers.point_cloud_quality.run")
def run_point_cloud_quality(self, run_id: str) -> None:
    asyncio.run(_run(uuid.UUID(run_id), getattr(self.request, "id", None)))


def _box(value: dict) -> Box3D:
    return Box3D(
        center=tuple(float(item) for item in value["center"]),
        size=tuple(float(item) for item in value["size"]),
        rotation=tuple(float(item) for item in value["rotation"]),
    )


def _read_pointcloud(key: str) -> np.ndarray:
    response = storage_service.client.get_object(
        Bucket=storage_service.datasets_bucket, Key=key
    )
    body = response["Body"]
    try:
        payload = body.read(MAX_POINT_CLOUD_BYTES + 1)
    finally:
        close = getattr(body, "close", None)
        if close:
            close()
    if len(payload) > MAX_POINT_CLOUD_BYTES:
        raise ValueError("point cloud exceeds quality scan byte budget")
    return parse_pcd_positions(payload)


def _normalize_points(points: np.ndarray, axis_convention: str | None) -> np.ndarray:
    convention = axis_convention or "iso_8855"
    matrix = R_NORM.get(convention)
    if matrix is None:
        raise ValueError(f"unsupported axis convention: {convention}")
    transform = np.asarray(matrix, dtype=np.float32).reshape(3, 3)
    return np.asarray(points, dtype=np.float32) @ transform.T


def _read_normalized_pointcloud(key: str, axis_convention: str | None) -> np.ndarray:
    return _normalize_points(_read_pointcloud(key), axis_convention)


async def _cancel_requested(db, run: PointCloudQualityRun) -> bool:
    if run.async_job_id is None:
        return False
    job = (
        await db.execute(
            select(AsyncJob.status, AsyncJob.payload).where(
                AsyncJob.id == run.async_job_id
            )
        )
    ).one_or_none()
    return bool(
        job is not None
        and (
            job.status == AsyncJobStatus.CANCELLED.value
            or bool((job.payload or {}).get("cancel_requested"))
        )
    )


def _locator(
    *,
    scene_id: uuid.UUID,
    task_id: uuid.UUID | None,
    frame_index: int | None,
    annotation_id: uuid.UUID | None,
    scene_track_id: uuid.UUID | None,
    code: str,
) -> dict:
    auxiliary_layers = []
    if code == "ground_clearance":
        auxiliary_layers.append("ground")
    if code == "temporal_jump":
        auxiliary_layers.append("neighbor_frames")
    if code.startswith("track_") or code == "duplicate_track_member":
        auxiliary_layers.append("track")
    return {
        "scene_id": str(scene_id),
        "frame_index": frame_index,
        "task_id": str(task_id) if task_id else None,
        "annotation_id": str(annotation_id) if annotation_id else None,
        "scene_track_id": str(scene_track_id) if scene_track_id else None,
        "camera": None,
        "auxiliary_layers": auxiliary_layers,
    }


async def _upsert_finding(
    db,
    *,
    run: PointCloudQualityRun,
    finding: QualityFinding,
    config: PointCloudQualityConfig,
    scene_id: uuid.UUID,
    task_id: uuid.UUID | None,
    annotation_id: uuid.UUID | None,
    annotation_version: int | None,
    scene_track_id: uuid.UUID | None,
    track_revision: int | None,
    source_versions: dict[str, int],
    class_name: str | None,
    source_evidence: dict | None = None,
) -> PointCloudQualityIssue | None:
    severity = severity_for_rule(config, finding.code)
    if severity is None:
        return None
    if finding.code not in config.severity_overrides:
        severity = finding.severity
    related_ids = sorted(set(finding.annotation_ids), key=str)
    frame_start = finding.frame_start
    frame_end = finding.frame_end
    key = issue_dedupe_key(
        project_id=run.project_id,
        code=finding.code,
        scene_id=scene_id,
        annotation_id=annotation_id,
        scene_track_id=scene_track_id,
        frame_start=frame_start,
        frame_end=frame_end,
        related_annotation_ids=related_ids,
    )
    issue = (
        await db.execute(
            select(PointCloudQualityIssue).where(
                PointCloudQualityIssue.project_id == run.project_id,
                PointCloudQualityIssue.dedupe_key == key,
            )
        )
    ).scalar_one_or_none()
    locator = _locator(
        scene_id=scene_id,
        task_id=task_id,
        frame_index=frame_start,
        annotation_id=annotation_id,
        scene_track_id=scene_track_id,
        code=finding.code,
    )
    if issue is None:
        issue = PointCloudQualityIssue(
            run_id=run.id,
            last_seen_run_id=run.id,
            project_id=run.project_id,
            scene_id=scene_id,
            task_id=task_id,
            annotation_id=annotation_id,
            annotation_version=annotation_version,
            scene_track_id=scene_track_id,
            track_revision=track_revision,
            related_annotation_ids=related_ids,
            source_versions=source_versions,
            class_name=class_name,
            code=finding.code,
            rule_version=1,
            severity=severity,
            severity_rank=SEVERITY_RANK[severity],
            frame_start=frame_start,
            frame_end=frame_end,
            metric=finding.metric,
            threshold=finding.threshold,
            evidence={**finding.evidence, **(source_evidence or {})},
            locator=locator,
            suggested_command=finding.suggestion,
            dedupe_key=key,
        )
        db.add(issue)
    else:
        issue.run_id = run.id
        issue.last_seen_run_id = run.id
        issue.task_id = task_id
        issue.annotation_id = annotation_id
        issue.annotation_version = annotation_version
        issue.scene_track_id = scene_track_id
        issue.track_revision = track_revision
        issue.related_annotation_ids = related_ids
        issue.source_versions = source_versions
        issue.class_name = class_name
        issue.severity = severity
        issue.severity_rank = SEVERITY_RANK[severity]
        issue.metric = finding.metric
        issue.threshold = finding.threshold
        issue.evidence = {**finding.evidence, **(source_evidence or {})}
        issue.locator = locator
        issue.suggested_command = finding.suggestion
        if issue.status == "stale":
            issue.status = "open"
            issue.resolution_reason = None
            issue.resolved_by_id = None
            issue.resolved_at = None
            issue.review_verdict = None
            issue.review_note = None
            issue.reviewed_by_id = None
            issue.reviewed_at = None
    await db.flush()
    return issue


async def execute_scan(db, run: PointCloudQualityRun) -> dict:
    config = PointCloudQualityConfig.model_validate(run.config_snapshot)
    records = list(run.source_snapshot or [])
    tasks = {row["task_id"]: row for row in records if row["kind"] == "task"}
    annotations = sorted(
        (row for row in records if row["kind"] == "annotation"),
        key=lambda row: (row["task_id"], row["annotation_id"]),
    )
    all_tracks = [row for row in records if row["kind"] == "track"]
    complete_track_scope = run.scope_json.get("scope") in {"project", "scene_ids"}
    tracks = all_tracks if complete_track_scope else []
    intervals_by_track: dict[str, list[dict]] = defaultdict(list)
    for row in records:
        if row["kind"] == "interval":
            intervals_by_track[row["scene_track_id"]].append(row)
    poses = {
        (row["scene_id"], int(row["frame_index"])): row
        for row in records
        if row["kind"] == "pose"
    }
    task_by_scene_frame = {
        (row["scene_id"], int(row["frame_index"])): row["task_id"]
        for row in tasks.values()
        if row["frame_index"] is not None
    }
    sizes_by_class: dict[str, list[tuple[float, float, float]]] = defaultdict(list)
    for row in annotations:
        geometry = row["geometry"]
        if geometry.get("type") == "box_3d":
            sizes_by_class[row["class_name"]].append(
                tuple(float(value) for value in geometry["size"])
            )

    issue_counts: Counter[str] = Counter()
    skip_counts: Counter[str] = Counter()
    if all_tracks and not complete_track_scope:
        skip_counts["track_rules:scope_incomplete"] = len(all_tracks)
    pointcloud_cache_key: tuple[str, str] | None = None
    pointcloud_cache_value: np.ndarray | None = None
    total_units = max(1, len(annotations) + len(tracks))
    processed = 0
    for row in annotations:
        if await _cancel_requested(db, run):
            raise asyncio.CancelledError
        task = tasks[row["task_id"]]
        pointcloud = task.get("pointcloud")
        points: np.ndarray | None = None
        if pointcloud and pointcloud.get("file_path"):
            key = pointcloud["file_path"]
            convention = pointcloud.get("axis_convention") or "iso_8855"
            cache_key = (key, convention)
            if cache_key != pointcloud_cache_key:
                try:
                    pointcloud_cache_value = await asyncio.to_thread(
                        _read_normalized_pointcloud, key, convention
                    )
                except Exception as exc:
                    pointcloud_cache_value = None
                    skip_counts[f"pointcloud:{type(exc).__name__}"] += 1
                pointcloud_cache_key = cache_key
            points = pointcloud_cache_value
        else:
            skip_counts["pointcloud:missing"] += 1
        findings = evaluate_box(
            points,
            _box(row["geometry"]),
            thresholds=thresholds_from_config(config, row["class_name"]),
            size_samples=sizes_by_class[row["class_name"]],
        )
        for finding in findings:
            issue = await _upsert_finding(
                db,
                run=run,
                finding=finding,
                config=config,
                scene_id=uuid.UUID(row["scene_id"]),
                task_id=uuid.UUID(row["task_id"]),
                annotation_id=uuid.UUID(row["annotation_id"]),
                annotation_version=int(row["annotation_version"]),
                scene_track_id=(
                    uuid.UUID(row["scene_track_id"]) if row["scene_track_id"] else None
                ),
                track_revision=None,
                source_versions={row["annotation_id"]: int(row["annotation_version"])},
                class_name=row["class_name"],
                source_evidence=(
                    {
                        "pointcloud_item_id": pointcloud["item_id"],
                        "pointcloud_content_hash": pointcloud.get("content_hash"),
                        "pointcloud_file_path": pointcloud["file_path"],
                        "axis_convention": pointcloud.get("axis_convention")
                        or "iso_8855",
                    }
                    if pointcloud
                    else None
                ),
            )
            if issue is not None:
                issue_counts[finding.code] += 1
        processed += 1
        run.progress_pct = min(95, int(processed * 95 / total_units))
        if run.async_job_id:
            await async_job_svc.update_progress(db, run.async_job_id, run.progress_pct)
        await db.commit()

    annotations_by_track: dict[str, list[dict]] = defaultdict(list)
    for row in annotations:
        if row["scene_track_id"]:
            annotations_by_track[row["scene_track_id"]].append(row)
    for track in tracks:
        if await _cancel_requested(db, run):
            raise asyncio.CancelledError
        track_id = track["scene_track_id"]
        members: list[TrackMember] = []
        for row in annotations_by_track.get(track_id, []):
            pose = poses.get((row["scene_id"], int(row["frame_index"])))
            members.append(
                TrackMember(
                    annotation_id=uuid.UUID(row["annotation_id"]),
                    frame_index=int(row["frame_index"]),
                    class_name=row["class_name"],
                    track_id=row["track_id"],
                    box=_box(row["geometry"]),
                    annotation_version=int(row["annotation_version"]),
                    ego_translation=(
                        tuple(float(value) for value in pose["ego_translation"])
                        if pose
                        else None
                    ),
                    ego_rotation=(
                        tuple(float(value) for value in pose["ego_rotation"])
                        if pose
                        else None
                    ),
                )
            )
        intervals = [
            TrackInterval(
                start_frame=int(value["start_frame"]),
                end_frame=int(value["end_frame"]),
                version=int(value["version"]),
            )
            for value in intervals_by_track.get(track_id, [])
            if value["end_frame"] is not None
        ]
        findings = evaluate_track(
            scene_track_id=uuid.UUID(track_id),
            authoritative_class=track["class_name"],
            authoritative_track_id=track["track_id"],
            track_revision=int(track["revision"]),
            presence_mode=track["presence_mode"],
            intervals=intervals,
            members=members,
            thresholds=thresholds_from_config(config, track["class_name"]),
        )
        member_by_id = {member.annotation_id: member for member in members}
        for finding in findings:
            primary_id = finding.annotation_ids[0] if finding.annotation_ids else None
            primary = member_by_id.get(primary_id) if primary_id else None
            frame = finding.frame_start
            raw_task_id = task_by_scene_frame.get((track["scene_id"], frame))
            source_versions = {
                str(value.annotation_id): value.annotation_version
                for value in members
                if not finding.annotation_ids
                or value.annotation_id in finding.annotation_ids
            }
            issue = await _upsert_finding(
                db,
                run=run,
                finding=finding,
                config=config,
                scene_id=uuid.UUID(track["scene_id"]),
                task_id=uuid.UUID(raw_task_id) if raw_task_id else None,
                annotation_id=primary.annotation_id if primary else None,
                annotation_version=primary.annotation_version if primary else None,
                scene_track_id=uuid.UUID(track_id),
                track_revision=int(track["revision"]),
                source_versions=source_versions,
                class_name=track["class_name"],
            )
            if issue is not None:
                issue_counts[finding.code] += 1
        processed += 1
        run.progress_pct = min(95, int(processed * 95 / total_units))
        if run.async_job_id:
            await async_job_svc.update_progress(db, run.async_job_id, run.progress_pct)
        await db.commit()

    summary = {
        **(run.summary or {}),
        "issue_count": sum(issue_counts.values()),
        "issues_by_code": dict(sorted(issue_counts.items())),
        "skips": dict(sorted(skip_counts.items())),
    }
    run.summary = summary
    return summary


async def _run(run_id: uuid.UUID, celery_task_id: str | None) -> None:
    async with task_session() as db:
        run = await db.get(PointCloudQualityRun, run_id)
        if run is None or run.status != "pending":
            return
        run.status = "running"
        run.progress_pct = 1
        run.started_at = datetime.now(timezone.utc)
        if run.async_job_id:
            await async_job_svc.mark_running(
                db, run.async_job_id, celery_task_id=celery_task_id
            )
        await db.commit()
        try:
            project = await db.get(Project, run.project_id)
            if project is None:
                raise RuntimeError("point cloud quality project disappeared")
            if (
                await current_source_digest(db, run, project)
                != run.source_snapshot_digest
            ):
                run.status = "stale"
                run.error_message = "source snapshot changed before execution"
                run.completed_at = datetime.now(timezone.utc)
                if run.async_job_id:
                    await async_job_svc.mark_complete(
                        db,
                        run.async_job_id,
                        result={"run_id": str(run.id), "status": "stale"},
                    )
            else:
                summary = await execute_scan(db, run)
                run.status = "completed"
                run.progress_pct = 100
                run.completed_at = datetime.now(timezone.utc)
                if run.async_job_id:
                    await async_job_svc.mark_complete(
                        db,
                        run.async_job_id,
                        result={
                            "run_id": str(run.id),
                            "status": "completed",
                            **summary,
                        },
                    )
        except asyncio.CancelledError:
            run.status = "cancelled"
            run.completed_at = datetime.now(timezone.utc)
            if run.async_job_id:
                await async_job_svc.mark_cancelled(
                    db, run.async_job_id, result={"reason": "cancelled_by_user"}
                )
        except Exception as exc:
            run.status = "failed"
            run.error_message = f"{type(exc).__name__}: {exc}"[:4000]
            run.completed_at = datetime.now(timezone.utc)
            if run.async_job_id:
                await async_job_svc.mark_failed(
                    db, run.async_job_id, error=run.error_message
                )
        if run.async_job_id:
            await notify_job_terminal(db, job_id=run.async_job_id)
        await db.commit()
