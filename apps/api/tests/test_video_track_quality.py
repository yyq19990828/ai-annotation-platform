from uuid import uuid4

import pytest

from app.services.video_track_quality import _annotations


@pytest.mark.asyncio
async def test_boundary_annotations_are_scoped_to_task():
    class Result:
        def scalars(self):
            return self

        def all(self):
            return []

    class Db:
        statement = None

        async def execute(self, statement):
            self.statement = statement
            return Result()

    db = Db()
    await _annotations(db, uuid4(), [uuid4(), uuid4()])

    assert "annotations.task_id =" in str(db.statement)
