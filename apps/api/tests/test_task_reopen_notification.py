"""v0.7.6 · reopen → 通知中心 fan-out 联动。

reviewer approve / reject 后，标注员可单方面 reopen。reopen 应给原 reviewer
往通知中心 (NotificationService) 写一条 type='task.reopened' 的记录。
原 reviewer 调 GET /api/v1/notifications 应能在结果中看到该 entry。

历史：v0.6.6 用 audit-derived /me/notifications；v0.7.0 删了该端点改用持久化通知中心，
本测试在 v0.7.0 时 skip；v0.7.6 reopen 接 NotificationService.fan_out 后恢复。
"""

from __future__ import annotations

import uuid

import pytest
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
    httpx_client_bound, db_session, annotator, reviewer
):
    ann_user, ann_token = annotator
    rev_user, rev_token = reviewer
    _, task = await _seed_project_and_task(
        db_session, owner_id=ann_user.id, assignee_id=ann_user.id
    )
    tid = str(task.id)
    await db_session.commit()

    # submit → claim → approve → reopen
    r = await httpx_client_bound.post(
        f"/api/v1/tasks/{tid}/submit", headers=_bearer(ann_token)
    )
    assert r.status_code == 200, r.text
    r = await httpx_client_bound.post(
        f"/api/v1/tasks/{tid}/review/claim", headers=_bearer(rev_token)
    )
    assert r.status_code == 200, r.text
    r = await httpx_client_bound.post(
        f"/api/v1/tasks/{tid}/review/approve", headers=_bearer(rev_token)
    )
    assert r.status_code == 200, r.text

    r = await httpx_client_bound.post(
        f"/api/v1/tasks/{tid}/reopen", headers=_bearer(ann_token)
    )
    assert r.status_code == 200, r.text

    # reviewer 查通知中心，应能看到 task.reopened
    r = await httpx_client_bound.get(
        "/api/v1/notifications?limit=50", headers=_bearer(rev_token)
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    reopen = [
        it for it in items if it["type"] == "task.reopened" and it["target_id"] == tid
    ]
    assert len(reopen) == 1, [it["type"] for it in items]
    payload = reopen[0]["payload"]
    assert payload["actor_id"] == str(ann_user.id)
    assert payload["task_display_id"] == task.display_id
    assert payload["reopened_count"] == 1
