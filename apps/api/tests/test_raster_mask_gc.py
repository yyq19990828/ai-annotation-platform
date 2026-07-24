from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus
from app.workers.cleanup import (
    _eligible_raster_mask_objects,
    _expire_mask_annotation_revisions,
    _expire_stale_video_tracker_candidates,
    _referenced_raster_mask_keys,
)
from tests.test_video_tracker_jobs_list import _make_video_task


def test_raster_mask_gc_keeps_referenced_and_grace_period_objects():
    now = datetime.now(timezone.utc)
    candidates = [
        {
            "key": "raster-masks/sha256/aa/aa/referenced.json",
            "last_modified": now - timedelta(days=3),
        },
        {
            "key": "raster-masks/sha256/bb/bb/recent.json",
            "last_modified": now - timedelta(hours=2),
        },
        {
            "key": "raster-masks/sha256/cc/cc/orphan.json",
            "last_modified": now - timedelta(days=2),
        },
    ]
    eligible = _eligible_raster_mask_objects(
        candidates,
        {"raster-masks/sha256/aa/aa/referenced.json"},
        now - timedelta(hours=24),
    )
    assert [item["key"] for item in eligible] == [
        "raster-masks/sha256/cc/cc/orphan.json"
    ]


def test_raster_mask_gc_caps_each_run_at_1000():
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    old = cutoff - timedelta(days=1)
    candidates = [
        {"key": f"raster-masks/sha256/{index:04d}.json", "last_modified": old}
        for index in range(1005)
    ]
    assert len(_eligible_raster_mask_objects(candidates, set(), cutoff)) == 1000


@pytest.mark.asyncio
async def test_expire_mask_annotation_revisions_uses_database_retention_deadline():
    result = MagicMock()
    result.scalars.return_value.all.return_value = ["revision-1", "revision-2"]
    db = SimpleNamespace(execute=AsyncMock(return_value=result))
    now = datetime.now(timezone.utc)

    assert await _expire_mask_annotation_revisions(db, now=now) == 2
    statement = db.execute.await_args.args[0]
    assert "mask_annotation_revisions.expires_at" in str(statement)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("reference_checks", "upload_exists", "expected_deleted"),
    [([True], None, 0), ([False, False], None, 1), ([False], "upload-id", 0)],
)
async def test_gc_rechecks_reference_under_object_lock_before_delete(
    monkeypatch, reference_checks, upload_exists, expected_deleted
):
    import app.workers.cleanup as cleanup

    key = "raster-masks/sha256/aa/aa/live.json"
    events: list[str] = []
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = upload_exists
    execute = AsyncMock(return_value=execute_result)
    db = SimpleNamespace(
        execute=execute,
        commit=AsyncMock(side_effect=lambda: events.append("commit")),
        rollback=AsyncMock(),
    )

    @asynccontextmanager
    async def session():
        yield db

    monkeypatch.setattr(cleanup, "task_session", session)
    refresh_gauge = AsyncMock()
    monkeypatch.setattr(
        cleanup,
        "refresh_raster_mask_active_geometries_safely",
        refresh_gauge,
    )
    monkeypatch.setattr(
        cleanup,
        "_referenced_raster_mask_keys",
        AsyncMock(return_value=set()),
    )
    expire_candidates = AsyncMock(return_value=0)
    monkeypatch.setattr(
        cleanup,
        "_expire_stale_video_tracker_candidates",
        expire_candidates,
    )
    monkeypatch.setattr(
        cleanup,
        "_is_raster_mask_key_referenced",
        AsyncMock(side_effect=reference_checks),
    )
    lock = AsyncMock()
    monkeypatch.setattr(cleanup, "lock_raster_mask_references", lock)
    monkeypatch.setattr(
        cleanup.storage_service,
        "list_objects",
        MagicMock(
            return_value=[
                {
                    "key": key,
                    "last_modified": datetime.now(timezone.utc) - timedelta(days=2),
                }
            ]
        ),
    )
    delete = MagicMock(side_effect=lambda _key: events.append("delete"))
    monkeypatch.setattr(cleanup.storage_service, "delete_object", delete)

    result = await cleanup._purge_unreferenced_raster_masks_async()

    refresh_gauge.assert_awaited_once_with(db)
    expire_candidates.assert_awaited_once_with(db)
    assert lock.await_count == (2 if reference_checks[0] is False else 1)
    lock.assert_any_await(db, {"object_key": key}, verify=False)
    assert delete.call_count == expected_deleted
    assert result["deleted"] == expected_deleted
    if expected_deleted:
        assert events[-3:] == ["commit", "delete", "commit"]


@pytest.mark.asyncio
async def test_gc_keeps_partially_reviewed_tracker_mask_reference(
    db_session, super_admin
):
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    key = "raster-masks/sha256/aa/aa/partial.json"
    db_session.add(
        VideoTrackerJob(
            task_id=task.id,
            dataset_item_id=item.id,
            annotation_id=None,
            created_by=user.id,
            status=VideoTrackerJobStatus.PARTIALLY_REVIEWED.value,
            model_key="sam3_video",
            direction="forward",
            from_frame=0,
            to_frame=1,
            prompt={},
            staged_result={
                "results": [
                    {
                        "frame_index": 1,
                        "geometry": {
                            "type": "mask",
                            "mask": {"object_key": key},
                        },
                    }
                ]
            },
            event_channel="video-tracker-job:test",
        )
    )
    await db_session.flush()
    assert key in await _referenced_raster_mask_keys(db_session)


@pytest.mark.asyncio
async def test_gc_expires_abandoned_staged_candidates_and_releases_refs(
    db_session, super_admin
):
    user, _ = super_admin
    task, item = await _make_video_task(db_session, user.id)
    key = "raster-masks/sha256/aa/aa/expired.json"
    job = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=item.id,
        annotation_id=None,
        created_by=user.id,
        status=VideoTrackerJobStatus.PENDING_REVIEW.value,
        model_key="sam3_video",
        direction="forward",
        from_frame=0,
        to_frame=1,
        prompt={},
        staged_result={
            "results": [
                {
                    "frame_index": 1,
                    "geometry": {"type": "mask", "mask": {"object_key": key}},
                }
            ]
        },
        completed_at=datetime.now(timezone.utc) - timedelta(hours=25),
        event_channel="video-tracker-job:expired",
    )
    db_session.add(job)
    await db_session.flush()

    expired = await _expire_stale_video_tracker_candidates(db_session)
    await db_session.refresh(job)

    assert expired == 1
    assert job.status == VideoTrackerJobStatus.DISCARDED.value
    assert job.staged_result is None
    assert key not in await _referenced_raster_mask_keys(db_session)
