"""v0.8.3 · 测试与 E2E 共用的对象工厂。

提取自 conftest.py 的 _make_user / _create_user，扩展项目 / 任务 / 批次工厂供
e2e/fixtures/seed.ts 通过 _test_seed router 调用。

约束：
  - 只在测试 / 非 production 环境使用（_test_seed router 自身有环境守卫）
  - 数据可重入（display_id 加随机后缀，避免重复 truncate 造数）
  - 不写 audit_log（避免污染 audit 测试）
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession


def make_user_dict(role: str, email: str, name: str, password: str = "Test1234") -> dict:
    from app.core.security import hash_password

    return {
        "id": uuid.uuid4(),
        "email": email,
        "name": name,
        "password_hash": hash_password(password),
        "role": role,
        "is_active": True,
    }


async def create_user(
    db: AsyncSession,
    role: str,
    email: str,
    name: str,
    password: str = "Test1234",
):
    from app.db.models.user import User

    data = make_user_dict(role, email, name, password)
    user = User(**data)
    db.add(user)
    await db.flush()
    return user


async def create_project(
    db: AsyncSession,
    *,
    owner_id: uuid.UUID,
    name: str = "E2E Project",
    type_key: str = "image-det",
    type_label: str = "图像目标检测",
    classes: list[str] | None = None,
):
    from app.db.models.project import Project

    suffix = secrets.token_hex(3)
    project = Project(
        display_id=f"P-E2E-{suffix}",
        name=name,
        type_label=type_label,
        type_key=type_key,
        owner_id=owner_id,
        classes=[{"name": c} for c in (classes or ["car", "person"])],
        ai_enabled=False,
    )
    db.add(project)
    await db.flush()
    return project


async def create_task(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    display_id: str | None = None,
    status: str = "pending",
):
    from app.db.models.task import Task

    suffix = secrets.token_hex(3)
    task = Task(
        display_id=display_id or f"T-E2E-{suffix}",
        project_id=project_id,
        status=status,
        file_name=f"e2e-{suffix}.jpg",
        file_path=f"e2e/{suffix}.jpg",
        file_type="image",
    )
    db.add(task)
    await db.flush()
    return task


async def create_batch(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    name: str | None = None,
    status: str = "draft",
):
    from app.db.models.task_batch import TaskBatch

    suffix = secrets.token_hex(3)
    batch = TaskBatch(
        project_id=project_id,
        display_id=f"B-E2E-{suffix}",
        name=name or f"E2E Batch {suffix}",
        status=status,
        created_at=datetime.now(timezone.utc),
    )
    db.add(batch)
    await db.flush()
    return batch
