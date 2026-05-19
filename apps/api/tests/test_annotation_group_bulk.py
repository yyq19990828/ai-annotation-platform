"""I12 · Object Group + bulk update service 层覆盖.

注意: router 层 E2E 需 require_roles + assert_project_visible + _assert_task_editable
配合 conftest 的 mock 客户端; 本套用例聚焦 service 行为:
- bulk_update partial fail (锁 / 已软删 / 不存在) 整体回滚
- group: next_group_seq 单调递增, 同 task ids 必须存在
- ungroup: orphan group (仅剩 1 个成员) 自动级联清理
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.annotation import AnnotationService
from tests.factory import create_project, create_task


async def _mk_ann(db, task_id, user_id, **kw):
    svc = AnnotationService(db)
    return await svc.create(
        task_id=task_id,
        user_id=user_id,
        annotation_type="bbox",
        class_name=kw.get("class_name", "__unknown"),
        geometry=kw.get("geometry", {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}),
        tool_unit_id=kw.get("tool_unit_id", "bbox"),
    )


@pytest.mark.asyncio
async def test_group_assigns_sequential_ids(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    a1 = await _mk_ann(db_session, task.id, user.id)
    a2 = await _mk_ann(db_session, task.id, user.id)
    a3 = await _mk_ann(db_session, task.id, user.id)
    a4 = await _mk_ann(db_session, task.id, user.id)
    await db_session.flush()

    svc = AnnotationService(db_session)
    gid1, _ = await svc.group([a1.id, a2.id], task.id)
    gid2, _ = await svc.group([a3.id, a4.id], task.id)

    assert gid1 == 1
    assert gid2 == 2
    assert a1.group_id == 1 and a2.group_id == 1
    assert a3.group_id == 2 and a4.group_id == 2


@pytest.mark.asyncio
async def test_group_then_ungroup_releases_orphan(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    a1 = await _mk_ann(db_session, task.id, user.id)
    a2 = await _mk_ann(db_session, task.id, user.id)
    a3 = await _mk_ann(db_session, task.id, user.id)
    await db_session.flush()

    svc = AnnotationService(db_session)
    gid, _ = await svc.group([a1.id, a2.id, a3.id], task.id)
    # ungroup 仅 2 个 → 剩 1 个 → orphan 自动清理
    cleared, orphans = await svc.ungroup([a1.id, a2.id])
    assert set(cleared) == {a1.id, a2.id}
    assert orphans == [a3.id]
    assert a1.group_id is None
    assert a2.group_id is None
    assert a3.group_id is None


@pytest.mark.asyncio
async def test_bulk_update_locked_raises(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    a1 = await _mk_ann(db_session, task.id, user.id)
    a2 = await _mk_ann(db_session, task.id, user.id)
    a2.is_locked = True
    await db_session.flush()

    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc:
        await svc.bulk_update([a1.id, a2.id], class_name="person")
    assert exc.value.status_code == 422
    # 整体回滚: a1.class_name 不应被改
    await db_session.refresh(a1)
    assert a1.class_name == "__unknown"


@pytest.mark.asyncio
async def test_bulk_update_attributes_applies_to_all(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    a1 = await _mk_ann(db_session, task.id, user.id)
    a2 = await _mk_ann(db_session, task.id, user.id)
    a3 = await _mk_ann(db_session, task.id, user.id)
    await db_session.flush()

    svc = AnnotationService(db_session)
    updated = await svc.bulk_update(
        [a1.id, a2.id, a3.id], is_occluded=True
    )
    assert len(updated) == 3
    assert all(r.is_occluded for r in updated)
    assert all(r.version == 2 for r in updated)


@pytest.mark.asyncio
async def test_group_requires_min_two(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()
    a1 = await _mk_ann(db_session, task.id, user.id)
    await db_session.flush()

    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc:
        await svc.group([a1.id], task.id)
    assert exc.value.status_code == 422
