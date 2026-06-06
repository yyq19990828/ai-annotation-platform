from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import Dataset, DatasetItem, Scene
from app.db.models.project import Project
from app.db.models.task import Task
from app.schemas.batch import BatchSplitRequest
from app.services.batch import BatchService
from app.services.dataset import DatasetService


@pytest.mark.asyncio
async def test_split_by_scene_creates_one_batch_per_scene_in_frame_order(
    db_session: AsyncSession, super_admin
):
    user, _ = super_admin
    suffix = uuid.uuid4().hex[:6]
    ds = Dataset(
        id=uuid.uuid4(),
        display_id=f"D-BYS-{suffix}",
        name="by scene dataset",
        data_type="image",
        created_by=user.id,
    )
    db_session.add(ds)
    await db_session.flush()

    scenes = []
    for scene_name in ("scene-b", "scene-a"):
        scene = Scene(
            id=uuid.uuid4(),
            display_id=f"S-BYS-{scene_name}-{suffix}",
            dataset_id=ds.id,
            name=scene_name,
        )
        db_session.add(scene)
        scenes.append(scene)
    await db_session.flush()

    for scene in scenes:
        for frame_index in (2, 0, 1):
            db_session.add(
                DatasetItem(
                    id=uuid.uuid4(),
                    dataset_id=ds.id,
                    file_name=f"{scene.name}-{frame_index}.jpg",
                    file_path=f"/tmp/{scene.name}-{frame_index}.jpg",
                    file_type="image",
                    scene_id=scene.id,
                    frame_index=frame_index,
                )
            )
    project = Project(
        id=uuid.uuid4(),
        display_id=f"P-BYS-{suffix}",
        name="by scene project",
        type_label="图像",
        type_key="image-det",
        data_type="image",
        scene_mode=True,
        owner_id=user.id,
        total_tasks=0,
    )
    db_session.add(project)
    await db_session.flush()

    await DatasetService(db_session).link_project(ds.id, project.id)
    batches = await BatchService(db_session).split(
        project.id,
        BatchSplitRequest(strategy="by_scene", name_prefix="Scene"),
        user.id,
    )

    assert len(batches) == 2
    assert {batch.total_tasks for batch in batches} == {3}

    for batch in batches:
        rows = (
            await db_session.execute(
                select(Task.sequence_order, DatasetItem.scene_id)
                .join(DatasetItem, Task.dataset_item_id == DatasetItem.id)
                .where(Task.batch_id == batch.id)
                .order_by(Task.sequence_order)
            )
        ).all()
        assert [row[0] for row in rows] == [0, 1, 2]
        assert len({row[1] for row in rows}) == 1
