from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import Dataset, Scene
from app.services.dataset import DatasetService


@pytest.mark.asyncio
async def test_list_datasets_filters_by_derived_has_scenes(
    db_session: AsyncSession, super_admin
):
    user, _ = super_admin
    suffix = uuid.uuid4().hex[:6]
    plain = Dataset(
        id=uuid.uuid4(),
        display_id=f"D-HS-P-{suffix}",
        name="plain dataset",
        data_type="image",
        created_by=user.id,
    )
    scene_ds = Dataset(
        id=uuid.uuid4(),
        display_id=f"D-HS-S-{suffix}",
        name="scene dataset",
        data_type="image",
        created_by=user.id,
    )
    db_session.add_all([plain, scene_ds])
    await db_session.flush()
    db_session.add(
        Scene(
            id=uuid.uuid4(),
            display_id=f"S-HS-{suffix}",
            dataset_id=scene_ds.id,
            name="scene-a",
        )
    )
    await db_session.flush()

    svc = DatasetService(db_session)
    scene_items, _ = await svc.list(has_scenes=True)
    plain_items, _ = await svc.list(has_scenes=False)

    assert scene_ds.id in {item["id"] for item in scene_items}
    assert plain.id not in {item["id"] for item in scene_items}
    assert plain.id in {item["id"] for item in plain_items}
    assert scene_ds.id not in {item["id"] for item in plain_items}
    assert all(item["has_scenes"] is True for item in scene_items)
    assert all(item["has_scenes"] is False for item in plain_items)
