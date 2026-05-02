"""v0.6.6 · DatasetService.link_project bulk_insert 路径覆盖。

历史：v0.6.5 之前 link_project 逐条 db.add + 逐条 nextval('display_seq_tasks')，
1000 items 需 ~2s。v0.6.6 改为单次 generate_series + insert，需要验证：
1. tasks 行数 == dataset_items 行数
2. display_id 唯一且符合 T-N 格式
3. project.total_tasks 正确累加
4. 重复 link 同一对返回已存在 link，不创建新 task
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.project import Project
from app.db.models.task import Task
from app.services.dataset import DatasetService


async def _seed_dataset(db: AsyncSession, owner_id: uuid.UUID, n_items: int) -> Dataset:
    suffix = uuid.uuid4().hex[:6]
    ds = Dataset(
        id=uuid.uuid4(),
        display_id=f"D-LINK-{suffix}",
        name="link_project bulk test",
        data_type="image",
        created_by=owner_id,
    )
    db.add(ds)
    await db.flush()

    for i in range(n_items):
        db.add(DatasetItem(
            id=uuid.uuid4(),
            dataset_id=ds.id,
            file_name=f"img-{i:04d}.jpg",
            file_path=f"/tmp/img-{i:04d}.jpg",
            file_type="image",
        ))
    await db.flush()
    return ds


async def _seed_project(db: AsyncSession, owner_id: uuid.UUID) -> Project:
    suffix = uuid.uuid4().hex[:6]
    p = Project(
        id=uuid.uuid4(),
        display_id=f"P-LINK-{suffix}",
        name="link_project target",
        type_label="图像-检测",
        type_key="image-det",
        owner_id=owner_id,
        total_tasks=0,
    )
    db.add(p)
    await db.flush()
    return p


@pytest.mark.asyncio
async def test_link_project_creates_tasks_in_bulk(db_session: AsyncSession, super_admin):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id, n_items=25)
    project = await _seed_project(db_session, user.id)

    svc = DatasetService(db_session)
    await svc.link_project(ds.id, project.id)

    count = (await db_session.execute(
        select(func.count()).select_from(Task).where(Task.project_id == project.id)
    )).scalar()
    assert count == 25

    rows = (await db_session.execute(
        select(Task.display_id).where(Task.project_id == project.id)
    )).all()
    display_ids = [r[0] for r in rows]
    assert len(set(display_ids)) == 25, "display_id 必须唯一"
    assert all(d.startswith("T-") for d in display_ids), "display_id 必须 T- 前缀"

    await db_session.refresh(project)
    assert project.total_tasks == 25


@pytest.mark.asyncio
async def test_link_project_idempotent(db_session: AsyncSession, super_admin):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id, n_items=5)
    project = await _seed_project(db_session, user.id)

    svc = DatasetService(db_session)
    link1 = await svc.link_project(ds.id, project.id)
    link2 = await svc.link_project(ds.id, project.id)
    assert link1.id == link2.id, "重复 link 应返回同一行"

    count = (await db_session.execute(
        select(func.count()).select_from(Task).where(Task.project_id == project.id)
    )).scalar()
    assert count == 5, "第二次 link 不应再创建 task"


@pytest.mark.asyncio
async def test_link_project_empty_dataset(db_session: AsyncSession, super_admin):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id, n_items=0)
    project = await _seed_project(db_session, user.id)

    svc = DatasetService(db_session)
    await svc.link_project(ds.id, project.id)

    count = (await db_session.execute(
        select(func.count()).select_from(Task).where(Task.project_id == project.id)
    )).scalar()
    assert count == 0


@pytest.mark.asyncio
async def test_link_project_auto_creates_named_batch(db_session: AsyncSession, super_admin):
    """v0.6.7 B-12-①：link_project 应为本次新接入的数据集自动建一个 batch，写入 task.batch_id。"""
    from app.db.models.task_batch import TaskBatch

    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id, n_items=8)
    ds.name = "MyImageSet"
    await db_session.flush()
    project = await _seed_project(db_session, user.id)

    svc = DatasetService(db_session)
    await svc.link_project(ds.id, project.id)

    # 这次 link 应该新建一个 batch 命名为「{ds.name} 默认包」
    batches = (await db_session.execute(
        select(TaskBatch).where(TaskBatch.project_id == project.id)
    )).scalars().all()
    new_batches = [b for b in batches if b.dataset_id == ds.id]
    assert len(new_batches) == 1
    assert "MyImageSet" in new_batches[0].name
    assert new_batches[0].total_tasks == 8

    # 所有由该 dataset 创建的 task 必须挂到此 batch
    tasks_in_batch = (await db_session.execute(
        select(func.count()).select_from(Task)
        .where(Task.project_id == project.id, Task.batch_id == new_batches[0].id)
    )).scalar()
    assert tasks_in_batch == 8


@pytest.mark.asyncio
async def test_unlink_project_hard_deletes_tasks(db_session: AsyncSession, super_admin):
    """v0.6.7 二修 B-10：unlink 应级联删除该 dataset 在该 project 下的 task，project.total_tasks 归零。"""
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id, n_items=10)
    project = await _seed_project(db_session, user.id)

    svc = DatasetService(db_session)
    await svc.link_project(ds.id, project.id)
    await db_session.refresh(project)
    assert project.total_tasks == 10

    info = await svc.unlink_project(ds.id, project.id)
    assert info is not None
    assert info["deleted_tasks"] == 10
    assert info["soft"] is False

    await db_session.refresh(project)
    real_total = (await db_session.execute(
        select(func.count()).select_from(Task).where(Task.project_id == project.id)
    )).scalar()
    assert real_total == 0, "hard-unlink 后该 dataset 创建的 task 应清光"
    assert project.total_tasks == 0


@pytest.mark.asyncio
async def test_link_unlink_relink_no_double_count(db_session: AsyncSession, super_admin):
    """v0.6.7 B-10：link → unlink → re-link 不出现 double-count。hard-unlink 下 task 真删 + 重 link 重新创建。"""
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id, n_items=4)
    project = await _seed_project(db_session, user.id)

    svc = DatasetService(db_session)
    await svc.link_project(ds.id, project.id)
    await svc.unlink_project(ds.id, project.id)
    await svc.link_project(ds.id, project.id)

    await db_session.refresh(project)
    real_total = (await db_session.execute(
        select(func.count()).select_from(Task).where(Task.project_id == project.id)
    )).scalar()
    assert project.total_tasks == real_total
    assert real_total == 4, "重 link 应重新创建 4 个 task"
