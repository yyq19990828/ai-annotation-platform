"""Explicit GC/version-loss injection in an owned disposable E2E environment."""

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "api"))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402


async def main():
    action, task_value, operation_value = sys.argv[1:]
    task_id, operation_id = UUID(task_value), UUID(operation_value)
    url = make_url(os.environ["PLAYWRIGHT_E2E_DATABASE_URL"])
    assert url.database and url.database.endswith(("_e2e", "_test"))
    assert os.environ.get("E2E_SEED_ENABLED") == "true"
    assert os.environ.get("ENVIRONMENT") == "development"
    # A disposable DB alone is insufficient: GC must never scan a shared bucket.
    bucket = os.environ.get("MINIO_BUCKET", "")
    assert bucket.endswith(("-e2e", "_e2e", "-test", "_test")), (
        "MINIO_BUCKET must name an exclusively owned disposable test bucket"
    )
    from app.workers._db import task_session
    from app.services.storage import storage_service
    from app.services.raster_mask_storage import store_coco_rle
    from app.workers.cleanup import _purge_unreferenced_raster_masks_async

    assert storage_service.bucket == bucket
    async with task_session() as db:
        operation = (
            (
                await db.execute(
                    text(
                        "SELECT report, response_json FROM annotation_operations WHERE id=:operation AND task_id=:task AND kind='slice_mask'"
                    ),
                    {"operation": operation_id, "task": task_id},
                )
            )
            .mappings()
            .one()
        )
        source_id = UUID(
            operation["response_json"]["slice_restore"]["source_annotation_id"]
        )
        source_version = operation["report"]["before"][str(source_id)][
            "annotation_version"
        ]
        if action in {"drop_revision", "expire_revision"}:
            sql = (
                "DELETE FROM mask_annotation_revisions"
                if action == "drop_revision"
                else "UPDATE mask_annotation_revisions SET expires_at=now()-interval '1 day'"
            )
            changed = await db.execute(
                text(
                    sql
                    + " WHERE task_id=:task AND annotation_id=:source AND annotation_version=:version"
                ),
                {"task": task_id, "source": source_id, "version": source_version},
            )
            assert changed.rowcount == 1
            await db.commit()
            print(json.dumps({"action": action, "changed": 1}))
            return
        assert action == "gc" and operation["report"]["current_side"] == "before"
        rows = (
            (
                await db.execute(
                    text("SELECT geometry FROM annotations WHERE task_id=:task"),
                    {"task": task_id},
                )
            )
            .scalars()
            .all()
        )
        protected = [
            row["mask"]["object_key"]
            for row in rows
            if row.get("type") == "raster_mask"
        ]

    # Add an actual unreferenced object to show that GC deletes eligible content.
    length = 128
    bits = uuid4().int
    counts, last = [0], False
    for index in range(length):
        value = bool(bits & (1 << index))
        if value != last:
            counts.append(0)
            last = value
        counts[-1] += 1
    orphan = await store_coco_rle(
        {"encoding": "coco_rle", "size": [1, length], "counts": counts}
    )
    original_list = storage_service.list_objects
    # Explicit age fixture bypasses the 24-hour grace while running the real GC.
    storage_service.list_objects = lambda *args, **kwargs: [
        {**item, "last_modified": datetime.now(timezone.utc) - timedelta(days=2)}
        for item in original_list(*args, **kwargs)
    ]
    try:
        result = await _purge_unreferenced_raster_masks_async(dry_run=False)
    finally:
        storage_service.list_objects = original_list
    remaining = {row["key"] for row in original_list("raster-masks/sha256/")}
    assert set(protected) <= remaining
    assert orphan["object_key"] not in remaining
    assert result["errors"] == 0 and result["deleted"] >= 1
    print(
        json.dumps(
            {
                "action": action,
                "result": result,
                "protected": protected,
                "orphan_deleted": True,
            }
        )
    )


asyncio.run(main())
