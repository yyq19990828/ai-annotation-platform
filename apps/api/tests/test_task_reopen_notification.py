"""v0.6.6 · reopen 后通知联动。

reviewer approve / reject 后，标注员可单方面 reopen。reopen 应给原 reviewer
留一条「task.reopen」审计行（detail.original_reviewer_id == reviewer.id），
原 reviewer 调 GET /me/notifications 应能在结果中看到。

v0.7.0：`GET /auth/me/notifications` 已删除（dead code，前端切到新 /notifications）。
本测试依赖 audit-derived 通知端点；新 `/notifications` 表暂不消费 task.reopen 事件，
将来如需复活，应改写为：reopen 端点 fan-out `task.reopened` 到 NotificationService，
并在此处校验通知中心 GET /notifications 命中。当前先跳过保留测试结构。
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.skip(reason="v0.7.0: deprecated endpoint removed; await task.reopened notification fan-out")
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.project import Project
from app.db.models.task import Task


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_project_and_task(
    db: AsyncSession, owner_id: uuid.UUID, assignee_id: uuid.UUID
) -> tuple[Project, Task]:
    suffix = uuid.uuid4().hex[:8]
    project = Project(
        id=uuid.uuid4(),
        display_id=f"P-RN-{suffix}",
        name="reopen notification test",
        type_label="图像-检测",
        type_key="image-det",
        owner_id=owner_id,
        classes=["car"],
    )
    db.add(project)
    await db.flush()

    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id=f"T-RN-{suffix}",
        file_name="x.jpg",
        file_path="/tmp/x.jpg",
        file_type="image",
        status="in_progress",
        assignee_id=assignee_id,
    )
    db.add(task)
    await db.flush()
    return project, task


@pytest.mark.asyncio
async def test_reopen_notifies_original_reviewer(
    httpx_client, db_session, annotator, reviewer
):
    ann_user, ann_token = annotator
    rev_user, rev_token = reviewer
    _, task = await _seed_project_and_task(db_session, owner_id=ann_user.id, assignee_id=ann_user.id)
    tid = str(task.id)

    # submit → claim → approve → reopen
    r = await httpx_client.post(f"/api/v1/tasks/{tid}/submit", headers=_bearer(ann_token))
    assert r.status_code == 200, r.text
    r = await httpx_client.post(f"/api/v1/tasks/{tid}/review/claim", headers=_bearer(rev_token))
    assert r.status_code == 200
    r = await httpx_client.post(f"/api/v1/tasks/{tid}/review/approve", headers=_bearer(rev_token))
    assert r.status_code == 200

    r = await httpx_client.post(f"/api/v1/tasks/{tid}/reopen", headers=_bearer(ann_token))
    assert r.status_code == 200

    # reviewer 调 /me/notifications，应见到 task.reopen 事件
    r = await httpx_client.get("/api/v1/auth/me/notifications?limit=50", headers=_bearer(rev_token))
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    reopen_items = [
        it for it in items
        if it["action"] == "task.reopen" and it["target_id"] == tid
    ]
    assert len(reopen_items) >= 1, f"reviewer 应能在通知中看到 task.reopen，实际：{[it['action'] for it in items]}"
    notification = reopen_items[0]
    assert notification["detail_json"]["original_reviewer_id"] == str(rev_user.id)
    # actor 应是 annotator（reopen 操作发起人）
    assert notification["actor_email"] == ann_user.email
