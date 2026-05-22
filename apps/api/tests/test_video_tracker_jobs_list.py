"""v0.10.36 · GET /video-tracker-jobs 列表 + 聚合计数端点测试."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_video_task(
    db: AsyncSession, owner_id: uuid.UUID
) -> tuple[Task, DatasetItem]:
    suffix = uuid.uuid4().hex[:6]
    project = Project(
        display_id=f"P-VTL-{suffix}",
        name=f"VTL-{suffix}",
        type_key="video-track",
        type_label="视频 · 时序追踪",
        owner_id=owner_id,
        classes=["car"],
    )
    dataset = Dataset(
        display_id=f"D-VTL-{suffix}",
        name="videos",
        data_type="video",
        created_by=owner_id,
    )
    db.add_all([project, dataset])
    await db.flush()
    item = DatasetItem(
        dataset_id=dataset.id,
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        metadata_={"video": {"duration_ms": 3000, "fps": 30, "frame_count": 90}},
    )
    db.add(item)
    await db.flush()
    task = Task(
        project_id=project.id,
        dataset_item_id=item.id,
        display_id=f"T-VTL-{suffix}",
        file_name="clip.mp4",
        file_path="videos/clip.mp4",
        file_type="video",
        status="pending",
    )
    db.add(task)
    await db.flush()
    return task, item


async def _make_job(
    db: AsyncSession,
    task: Task,
    item: DatasetItem,
    owner_id: uuid.UUID,
    *,
    status: str,
    model_key: str = "sam2_video",
) -> VideoTrackerJob:
    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=owner_id,
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 1, "y": 2, "w": 10, "h": 12},
    )
    db.add(annotation)
    await db.flush()
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=annotation.id,
        created_by=owner_id,
        status=status,
        model_key=model_key,
        direction="forward",
        from_frame=0,
        to_frame=2,
        prompt={},
        event_channel="video-tracker-job:test",
    )
    db.add(job)
    await db.flush()
    return job


async def test_list_empty(httpx_client, super_admin):
    _, token = super_admin
    res = await httpx_client.get("/api/v1/video-tracker-jobs", headers=_bearer(token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["items"] == []
    assert body["next_cursor"] is None
    assert body["counts"] == {
        "queued": 0,
        "running": 0,
        "completed": 0,
        "failed": 0,
        "cancelled": 0,
    }


async def test_list_requires_admin(httpx_client, annotator):
    _, token = annotator
    res = await httpx_client.get("/api/v1/video-tracker-jobs", headers=_bearer(token))
    assert res.status_code == 403


async def test_counts_and_status_filter(httpx_client_bound, super_admin, db_session):
    user, token = super_admin
    task, item = await _make_video_task(db_session, user.id)
    await _make_job(
        db_session, task, item, user.id, status=VideoTrackerJobStatus.QUEUED.value
    )
    await _make_job(
        db_session, task, item, user.id, status=VideoTrackerJobStatus.RUNNING.value
    )
    await _make_job(
        db_session, task, item, user.id, status=VideoTrackerJobStatus.RUNNING.value
    )
    await _make_job(
        db_session, task, item, user.id, status=VideoTrackerJobStatus.COMPLETED.value
    )
    await _make_job(
        db_session, task, item, user.id, status=VideoTrackerJobStatus.FAILED.value
    )
    await db_session.commit()

    res = await httpx_client_bound.get(
        "/api/v1/video-tracker-jobs", headers=_bearer(token)
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["counts"]["queued"] == 1
    assert body["counts"]["running"] == 2
    assert body["counts"]["completed"] == 1
    assert body["counts"]["failed"] == 1
    assert body["counts"]["cancelled"] == 0
    assert len(body["items"]) == 5
    # 返回项带 project_id / task_id
    assert all(i["project_id"] == str(task.project_id) for i in body["items"])
    assert all(i["task_id"] == str(task.id) for i in body["items"])

    # status filter — counts 仍是全量, items 受过滤
    res = await httpx_client_bound.get(
        "/api/v1/video-tracker-jobs?status=running", headers=_bearer(token)
    )
    body = res.json()
    assert len(body["items"]) == 2
    assert all(i["status"] == "running" for i in body["items"])
    assert body["counts"]["completed"] == 1  # counts 忽略 status 过滤


async def test_project_and_model_key_filter(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    task_a, item_a = await _make_video_task(db_session, user.id)
    task_b, item_b = await _make_video_task(db_session, user.id)
    await _make_job(
        db_session, task_a, item_a, user.id, status="completed", model_key="sam2_video"
    )
    await _make_job(
        db_session, task_b, item_b, user.id, status="completed", model_key="sam3_video"
    )
    await db_session.commit()

    res = await httpx_client_bound.get(
        f"/api/v1/video-tracker-jobs?project_id={task_a.project_id}",
        headers=_bearer(token),
    )
    body = res.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["project_id"] == str(task_a.project_id)
    assert body["counts"]["completed"] == 1

    res = await httpx_client_bound.get(
        "/api/v1/video-tracker-jobs?model_key=sam3_video",
        headers=_bearer(token),
    )
    body = res.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["model_key"] == "sam3_video"


async def test_cursor_pagination(httpx_client_bound, super_admin, db_session):
    user, token = super_admin
    task, item = await _make_video_task(db_session, user.id)
    for _ in range(5):
        await _make_job(db_session, task, item, user.id, status="completed")
    await db_session.commit()

    res = await httpx_client_bound.get(
        "/api/v1/video-tracker-jobs?limit=2", headers=_bearer(token)
    )
    body = res.json()
    assert len(body["items"]) == 2
    cursor = body["next_cursor"]
    assert cursor is not None
    page1_ids = {i["id"] for i in body["items"]}

    res2 = await httpx_client_bound.get(
        f"/api/v1/video-tracker-jobs?limit=2&cursor={cursor}", headers=_bearer(token)
    )
    body2 = res2.json()
    assert len(body2["items"]) == 2
    page2_ids = {i["id"] for i in body2["items"]}
    assert page1_ids.isdisjoint(page2_ids)

    res3 = await httpx_client_bound.get(
        f"/api/v1/video-tracker-jobs?limit=2&cursor={body2['next_cursor']}",
        headers=_bearer(token),
    )
    body3 = res3.json()
    assert len(body3["items"]) == 1
    assert body3["next_cursor"] is None


async def test_invalid_status_rejected(httpx_client, super_admin):
    _, token = super_admin
    res = await httpx_client.get(
        "/api/v1/video-tracker-jobs?status=weird", headers=_bearer(token)
    )
    assert res.status_code == 422
