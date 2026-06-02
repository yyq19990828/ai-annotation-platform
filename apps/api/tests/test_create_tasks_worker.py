"""v0.12.0 · B4 建任务异步化核心逻辑覆盖。

直接测 build_tasks_for_link（worker 的核心 async 函数，不测 celery 包装）：
1. 建出 N 个 task（batch_id 全为 None）、project.total_tasks 增加 N
2. 幂等：再调一次不双建（created=0）
3. 小 dataset（≤阈值）走 link_project 同步路径：async_job_id is None 且 task 已建好
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
from app.db.models.project import Project
from app.db.models.task import Task
from app.services.dataset import DatasetService, build_tasks_for_link


async def _seed_dataset(db: AsyncSession, owner_id: uuid.UUID, n_items: int) -> Dataset:
    suffix = uuid.uuid4().hex[:6]
    ds = Dataset(
        id=uuid.uuid4(),
        display_id=f"D-CT-{suffix}",
        name="create_tasks worker test",
        data_type="image",
        created_by=owner_id,
    )
    db.add(ds)
    await db.flush()

    for i in range(n_items):
        db.add(
            DatasetItem(
                id=uuid.uuid4(),
                dataset_id=ds.id,
                file_name=f"img-{i:04d}.jpg",
                file_path=f"/tmp/img-{i:04d}.jpg",
                file_type="image",
            )
        )
    await db.flush()
    return ds


async def _seed_project(db: AsyncSession, owner_id: uuid.UUID) -> Project:
    suffix = uuid.uuid4().hex[:6]
    p = Project(
        id=uuid.uuid4(),
        display_id=f"P-CT-{suffix}",
        name="create_tasks target",
        type_label="图像-检测",
        type_key="image-det",
        owner_id=owner_id,
        total_tasks=0,
    )
    db.add(p)
    await db.flush()
    return p


@pytest.mark.asyncio
async def test_build_tasks_for_link_creates_and_is_idempotent(
    db_session: AsyncSession, super_admin
):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id, n_items=12)
    project = await _seed_project(db_session, user.id)

    # 建 link（不经 link_project 的同步建 task，直接驱动核心函数）。
    db_session.add(ProjectDataset(dataset_id=ds.id, project_id=project.id))
    await db_session.flush()

    result = await build_tasks_for_link(
        db_session, dataset_id=ds.id, project_id=project.id
    )
    assert result == {"created": 12, "total": 12}

    tasks = (
        await db_session.execute(
            select(Task.batch_id).where(Task.project_id == project.id)
        )
    ).all()
    assert len(tasks) == 12
    assert all(row[0] is None for row in tasks)

    await db_session.refresh(project)
    assert project.total_tasks == 12

    # 幂等：再跑一次不双建。
    again = await build_tasks_for_link(
        db_session, dataset_id=ds.id, project_id=project.id
    )
    assert again == {"created": 0, "total": 0}

    count = (
        await db_session.execute(
            select(func.count()).select_from(Task).where(Task.project_id == project.id)
        )
    ).scalar()
    assert count == 12
    await db_session.refresh(project)
    assert project.total_tasks == 12


@pytest.mark.asyncio
async def test_link_project_small_dataset_is_sync(
    db_session: AsyncSession, super_admin
):
    user, _ = super_admin
    n = min(8, settings.task_create_sync_threshold)
    ds = await _seed_dataset(db_session, user.id, n_items=n)
    project = await _seed_project(db_session, user.id)

    svc = DatasetService(db_session)
    link_result = await svc.link_project(ds.id, project.id)

    assert link_result.async_job_id is None
    assert link_result.created_tasks == n

    count = (
        await db_session.execute(
            select(func.count()).select_from(Task).where(Task.project_id == project.id)
        )
    ).scalar()
    assert count == n
