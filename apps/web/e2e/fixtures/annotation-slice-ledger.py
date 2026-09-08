"""Inspect slice receipts or age one receipt in an explicitly disposable E2E DB."""

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine


async def main():
    action, task_value, *operation_values = sys.argv[1:]
    task_id = UUID(task_value)
    url = make_url(os.environ["PLAYWRIGHT_E2E_DATABASE_URL"])
    assert url.database and url.database.endswith(("_e2e", "_test"))
    assert os.environ.get("E2E_SEED_ENABLED") == "true"
    assert os.environ.get("ENVIRONMENT") == "development"
    engine = create_async_engine(url)
    try:
        async with engine.begin() as connection:
            if action == "expire":
                operation_id = UUID(operation_values[0])
                changed = await connection.execute(
                    text(
                        "UPDATE annotation_operations SET created_at=:created "
                        "WHERE id=:operation AND task_id=:task AND kind='slice_polygon'"
                    ),
                    {
                        "created": datetime.now(timezone.utc) - timedelta(days=31),
                        "operation": operation_id,
                        "task": task_id,
                    },
                )
                assert changed.rowcount == 1
            else:
                assert action == "inspect"
            operations = (
                (
                    await connection.execute(
                        text(
                            "SELECT id, kind, idempotency_key, result_versions, report->>'current_side' AS current_side "
                            "FROM annotation_operations WHERE task_id=:task ORDER BY created_at, id"
                        ),
                        {"task": task_id},
                    )
                )
                .mappings()
                .all()
            )
            annotations = (
                (
                    await connection.execute(
                        text(
                            "SELECT id, version, is_active, geometry, parent_annotation_id, attributes, attributes_meta, source, confidence "
                            "FROM annotations WHERE task_id=:task ORDER BY id"
                        ),
                        {"task": task_id},
                    )
                )
                .mappings()
                .all()
            )
            print(
                json.dumps(
                    {
                        "operations": [dict(row) for row in operations],
                        "annotations": [dict(row) for row in annotations],
                    },
                    default=str,
                )
            )
    finally:
        await engine.dispose()


asyncio.run(main())
