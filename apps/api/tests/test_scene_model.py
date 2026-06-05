"""v0.14.0 · Scene model + service CRUD 烟雾测试。"""

from __future__ import annotations

import uuid

import pytest

from app.db.models.dataset import Dataset, DatasetItem
from app.services import scene as scene_svc


async def _make_dataset(db, owner_id, name="ds-scene-test"):
    ds = Dataset(
        display_id=f"DS-{uuid.uuid4().hex[:6]}",
        name=name,
        data_type="point_cloud",
        created_by=owner_id,
    )
    db.add(ds)
    await db.flush()
    return ds


async def test_create_scene_assigns_display_id(db_session, super_admin):
    ds = await _make_dataset(db_session, super_admin[0].id)
    scene = await scene_svc.create_scene(
        db_session,
        dataset_id=ds.id,
        name="alpha",
        source_format="manual",
        created_by=super_admin[0].id,
    )
    assert scene.display_id.startswith("SCN-")
    assert scene.dataset_id == ds.id
    assert scene.name == "alpha"
    assert scene.source_metadata == {}


async def test_create_scene_name_conflict(db_session, super_admin):
    ds = await _make_dataset(db_session, super_admin[0].id)
    await scene_svc.create_scene(db_session, dataset_id=ds.id, name="dup")

    with pytest.raises(scene_svc.SceneNameConflict):
        await scene_svc.create_scene(db_session, dataset_id=ds.id, name="dup")


async def test_assign_items_to_scene_writes_frame_index(db_session, super_admin):
    ds = await _make_dataset(db_session, super_admin[0].id)
    scene = await scene_svc.create_scene(db_session, dataset_id=ds.id, name="s")

    items = []
    for i in range(3):
        item = DatasetItem(
            dataset_id=ds.id,
            file_name=f"{i}.pcd",
            file_path=f"{ds.name}/lidar/{i}.pcd",
            file_type="point_cloud",
        )
        db_session.add(item)
        await db_session.flush()
        items.append(item)

    updated = await scene_svc.assign_items_to_scene(
        db_session, scene_id=scene.id, items_in_order=items
    )
    assert updated == 3
    assert [it.frame_index for it in items] == [0, 1, 2]
    assert all(it.scene_id == scene.id for it in items)


async def test_list_for_dataset_returns_ordered(db_session, super_admin):
    ds = await _make_dataset(db_session, super_admin[0].id)
    s1 = await scene_svc.create_scene(db_session, dataset_id=ds.id, name="s1")
    s2 = await scene_svc.create_scene(db_session, dataset_id=ds.id, name="s2")
    scenes = await scene_svc.list_for_dataset(db_session, ds.id)
    assert [s.id for s in scenes] == [s1.id, s2.id]


async def test_scenes_api_get_and_patch(db_session, httpx_client, super_admin):
    user, token = super_admin
    ds = await _make_dataset(db_session, user.id)
    scene = await scene_svc.create_scene(db_session, dataset_id=ds.id, name="orig")

    # GET list
    resp = await httpx_client.get(
        f"/api/v1/scenes?dataset_id={ds.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # GET single
    resp = await httpx_client.get(
        f"/api/v1/scenes/{scene.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "orig"

    # PATCH name
    resp = await httpx_client.patch(
        f"/api/v1/scenes/{scene.id}",
        json={"name": "renamed"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "renamed"

    # PATCH name conflict
    await scene_svc.create_scene(db_session, dataset_id=ds.id, name="other")
    resp = await httpx_client.patch(
        f"/api/v1/scenes/{scene.id}",
        json={"name": "other"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 409
