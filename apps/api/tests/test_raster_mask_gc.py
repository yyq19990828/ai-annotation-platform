from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.workers.cleanup import _eligible_raster_mask_objects


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
@pytest.mark.parametrize(
    ("finally_referenced", "expected_deleted"),
    [(True, 0), (False, 1)],
)
async def test_gc_rechecks_reference_under_object_lock_before_delete(
    monkeypatch, finally_referenced, expected_deleted
):
    import app.workers.cleanup as cleanup

    key = "raster-masks/sha256/aa/aa/live.json"
    db = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())

    @asynccontextmanager
    async def session():
        yield db

    monkeypatch.setattr(cleanup, "task_session", session)
    monkeypatch.setattr(
        cleanup,
        "_referenced_raster_mask_keys",
        AsyncMock(return_value=set()),
    )
    monkeypatch.setattr(
        cleanup,
        "_is_raster_mask_key_referenced",
        AsyncMock(return_value=finally_referenced),
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
    delete = MagicMock()
    monkeypatch.setattr(cleanup.storage_service, "delete_object", delete)

    result = await cleanup._purge_unreferenced_raster_masks_async()

    lock.assert_awaited_once_with(db, {"object_key": key}, verify=False)
    assert delete.call_count == expected_deleted
    assert result["deleted"] == expected_deleted
