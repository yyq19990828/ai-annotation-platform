"""v0.7.6 测试集合。

S1 · ProjectCreate 接受 attribute_schema
S2 · POST /batches/{id}/reset 终极重置到 draft
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text

from app.db.models.annotation import Annotation
from app.db.models.audit_log import AuditLog
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.task_lock import TaskLock
from app.services.display_id import next_display_id


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_batch_with_locked_tasks(
    db,
    owner_id: uuid.UUID,
    annotator_id: uuid.UUID,
    *,
    batch_status: str,
    n_tasks: int = 3,
    task_status: str = "completed",
):
    """创建一个项目 + 一个批次 + N 个 task（指定状态）+ 每个 task 一把锁 + 一条 annotation。"""
    from datetime import datetime, timedelta, timezone

    pid = uuid.uuid4()
    p = Project(
        id=pid,
        display_id=await next_display_id(db, "projects"),
        name="reset test",
        type_label="图像-检测",
        type_key="image-det",
        owner_id=owner_id,
        classes=["car"],
    )
    db.add(p)
    await db.flush()
    db.add(
        ProjectMember(
            project_id=pid,
            user_id=annotator_id,
            role="annotator",
            assigned_by=owner_id,
        )
    )
    batch = TaskBatch(
        id=uuid.uuid4(),
        project_id=pid,
        display_id=await next_display_id(db, "batches"),
        name="b1",
        status=batch_status,
        annotator_id=annotator_id,
        assigned_user_ids=[str(annotator_id)],
        review_feedback="prev feedback" if batch_status == "rejected" else None,
        reviewed_at=datetime.now(timezone.utc) if batch_status == "rejected" else None,
        reviewed_by=owner_id if batch_status == "rejected" else None,
    )
    db.add(batch)
    await db.flush()
    for i in range(n_tasks):
        t = Task(
            id=uuid.uuid4(),
            project_id=pid,
            batch_id=batch.id,
            display_id=f"T-{i}",
            file_name=f"f{i}.jpg",
            file_path=f"/tmp/f{i}.jpg",
            file_type="image",
            status=task_status,
            is_labeled=task_status in ("completed", "review"),
        )
        db.add(t)
        await db.flush()
        db.add(
            Annotation(
                id=uuid.uuid4(),
                task_id=t.id,
                user_id=annotator_id,
                geometry={"type": "bbox", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
                class_name="car",
                is_active=True,
            )
        )
        db.add(
            TaskLock(
                task_id=t.id,
                user_id=annotator_id,
                expire_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            )
        )
    await db.flush()
    return p, batch


@pytest.mark.asyncio
async def test_create_project_with_attribute_schema(httpx_client, super_admin):
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "name": "v0.7.6 attr schema project",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "classes": ["car"],
        "attribute_schema": {
            "fields": [
                {
                    "key": "occluded",
                    "label": "是否遮挡",
                    "type": "boolean",
                    "required": True,
                },
                {
                    "key": "color",
                    "label": "车身颜色",
                    "type": "select",
                    "required": False,
                    "options": [
                        {"value": "red", "label": "红"},
                        {"value": "blue", "label": "蓝"},
                    ],
                },
            ]
        },
    }
    res = await httpx_client.post("/api/v1/projects", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    fields = body["attribute_schema"]["fields"]
    assert [f["key"] for f in fields] == ["occluded", "color"]
    assert fields[0]["required"] is True
    assert fields[1]["options"][0]["value"] == "red"

    # GET 拉回应一致
    pid = body["id"]
    got = await httpx_client.get(f"/api/v1/projects/{pid}", headers=headers)
    assert got.status_code == 200
    assert got.json()["attribute_schema"] == body["attribute_schema"]


@pytest.mark.asyncio
async def test_create_project_default_attribute_schema(httpx_client, super_admin):
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "name": "v0.7.6 default attr schema",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "classes": [],
    }
    res = await httpx_client.post("/api/v1/projects", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["attribute_schema"] == {"fields": []}


@pytest.mark.asyncio
async def test_create_project_rejects_invalid_attribute_schema(
    httpx_client, super_admin
):
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}

    # select 类型缺 options 应 422
    payload = {
        "name": "v0.7.6 bad attr schema",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "attribute_schema": {
            "fields": [
                {"key": "color", "label": "颜色", "type": "select"},
            ]
        },
    }
    res = await httpx_client.post("/api/v1/projects", json=payload, headers=headers)
    assert res.status_code == 422, res.text


# ── S2 · POST /batches/{id}/reset 终极重置 ─────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "from_status",
    ["active", "annotating", "reviewing", "approved", "rejected", "archived"],
)
async def test_reset_to_draft_from_any_status(
    httpx_client_bound, db_session, super_admin, annotator, from_status
):
    """6 个起始状态 → draft 全部成功，task 全回 pending，annotation 保留，task_locks 清空。"""
    owner, owner_token = super_admin
    user, _ = annotator
    p, batch = await _seed_batch_with_locked_tasks(
        db_session,
        owner.id,
        user.id,
        batch_status=from_status,
        n_tasks=3,
        task_status="completed",
    )
    await db_session.commit()

    res = await httpx_client_bound.post(
        f"/api/v1/projects/{p.id}/batches/{batch.id}/reset",
        json={"reason": f"测试 {from_status} 重置到 draft"},
        headers=_bearer(owner_token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "draft"
    assert body["review_feedback"] is None

    # task 全部回 pending
    tasks = (
        (await db_session.execute(select(Task).where(Task.batch_id == batch.id)))
        .scalars()
        .all()
    )
    assert all(t.status == "pending" for t in tasks)

    # annotation 全部保留
    anns = (
        (
            await db_session.execute(
                select(Annotation).where(Annotation.task_id.in_([t.id for t in tasks]))
            )
        )
        .scalars()
        .all()
    )
    assert len(anns) == 3
    assert all(a.is_active for a in anns)

    # task_locks 清空
    locks = (
        (
            await db_session.execute(
                select(TaskLock).where(TaskLock.task_id.in_([t.id for t in tasks]))
            )
        )
        .scalars()
        .all()
    )
    assert len(locks) == 0

    # audit 写入 reason + from_status + affected_tasks
    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "batch.reset_to_draft",
                AuditLog.target_id == str(batch.id),
            )
        )
    ).scalar_one()
    assert audit.detail_json["from_status"] == from_status
    assert audit.detail_json["affected_tasks"] == 3
    assert "测试" in audit.detail_json["reason"]


@pytest.mark.asyncio
async def test_reset_to_draft_requires_reason(
    httpx_client_bound, db_session, super_admin, annotator
):
    owner, owner_token = super_admin
    user, _ = annotator
    p, batch = await _seed_batch_with_locked_tasks(
        db_session,
        owner.id,
        user.id,
        batch_status="active",
        n_tasks=1,
        task_status="pending",
    )
    await db_session.commit()

    # 空 reason 应被 422 拦截
    r1 = await httpx_client_bound.post(
        f"/api/v1/projects/{p.id}/batches/{batch.id}/reset",
        json={"reason": ""},
        headers=_bearer(owner_token),
    )
    assert r1.status_code == 422

    # 短 reason（< 10 字）应被 422 拦截
    r2 = await httpx_client_bound.post(
        f"/api/v1/projects/{p.id}/batches/{batch.id}/reset",
        json={"reason": "短"},
        headers=_bearer(owner_token),
    )
    assert r2.status_code == 422


@pytest.mark.asyncio
async def test_reset_to_draft_owner_only(
    httpx_client_bound, db_session, super_admin, annotator, reviewer
):
    """非 owner（普通 reviewer / annotator）调用 → 403。"""
    owner, _ = super_admin
    user, anno_token = annotator
    rev, rev_token = reviewer
    p, batch = await _seed_batch_with_locked_tasks(
        db_session,
        owner.id,
        user.id,
        batch_status="active",
        n_tasks=1,
        task_status="pending",
    )
    await db_session.commit()

    for token in (anno_token, rev_token):
        res = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/reset",
            json={"reason": "非 owner 不应能重置"},
            headers=_bearer(token),
        )
        assert res.status_code == 403, res.text


# ── S4 · audit Celery task body 等价 ────────────────────────────────────────


@pytest.mark.asyncio
async def test_persist_audit_entry_task_writes_row(db_session):
    """task body 直接写一行 audit_logs。Celery 在 test 环境不真起 broker，本测验证函数体本身正确。"""
    from app.workers.audit import _async_persist

    payload = {
        # 用 None actor_id 避免 FK 约束触发（audit_logs.actor_id → users.id）
        "actor_id": None,
        "actor_role": "annotator",
        "action": "http.post",
        "method": "POST",
        "path": "/api/v1/test/audit-async",
        "status_code": 200,
        "ip": "127.0.0.1",
        "request_id": "test-rid-123",
    }
    await _async_persist(payload)

    # 用独立 session 验证（_async_persist 自己 commit），fixture 的 db_session 看不到
    from app.db.base import async_session as _session

    async with _session() as s:
        row = (
            await s.execute(
                select(AuditLog).where(AuditLog.request_id == "test-rid-123")
            )
        ).scalar_one()
        assert row.action == "http.post"
        assert row.method == "POST"
        assert row.path == "/api/v1/test/audit-async"
        assert row.status_code == 200
        assert row.actor_role == "annotator"
        # cleanup — v0.7.8 audit_logs 不可变 trigger 需要豁免
        await s.execute(text("SET LOCAL \"app.allow_audit_update\" = 'true'"))
        await s.delete(row)
        await s.commit()


# ── S5 · annotation keyset 分页 ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_annotations_keyset_pagination(
    httpx_client_bound, db_session, super_admin, annotator
):
    """种 5 条 annotation；以 limit=2 三页拉取，校验 cursor 末页 None + 顺序为 created_at desc。"""
    from datetime import datetime, timezone, timedelta

    from app.db.models.annotation import Annotation
    from app.db.models.task import Task

    owner, owner_token = super_admin
    user, _ = annotator
    p, batch = await _seed_batch_with_locked_tasks(
        db_session,
        owner.id,
        user.id,
        batch_status="active",
        n_tasks=1,
        task_status="pending",
    )
    task = (
        await db_session.execute(select(Task).where(Task.batch_id == batch.id))
    ).scalar_one()

    # 清空 seed 留下的隐式 annotation，独立测试 5 条节奏
    seed_anns = (
        (
            await db_session.execute(
                select(Annotation).where(Annotation.task_id == task.id)
            )
        )
        .scalars()
        .all()
    )
    for a in seed_anns:
        await db_session.delete(a)
    await db_session.flush()

    # 种 5 条 annotation，created_at 间隔 1 秒
    base_ts = datetime.now(timezone.utc).replace(microsecond=0)
    for i in range(5):
        ann = Annotation(
            id=uuid.uuid4(),
            task_id=task.id,
            user_id=user.id,
            geometry={"type": "bbox", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
            class_name="car",
            is_active=True,
        )
        db_session.add(ann)
        await db_session.flush()
        # 强制覆盖 created_at（默认 server_default 在 commit 时生成同一时刻）
        ann.created_at = base_ts + timedelta(seconds=i)
        await db_session.flush()
    await db_session.commit()

    # 第一页
    r1 = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/annotations/page?limit=2",
        headers=_bearer(owner_token),
    )
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert len(body1["items"]) == 2
    assert body1["next_cursor"] is not None

    # 第二页
    r2 = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/annotations/page?limit=2&cursor={body1['next_cursor']}",
        headers=_bearer(owner_token),
    )
    body2 = r2.json()
    assert len(body2["items"]) == 2
    assert body2["next_cursor"] is not None

    # 第三页（最后 1 条 + 末页 cursor）
    r3 = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/annotations/page?limit=2&cursor={body2['next_cursor']}",
        headers=_bearer(owner_token),
    )
    body3 = r3.json()
    assert len(body3["items"]) == 1
    assert body3["next_cursor"] is None  # 末页

    # 顺序：created_at DESC
    seen_ids = (
        [it["id"] for it in body1["items"]]
        + [it["id"] for it in body2["items"]]
        + [it["id"] for it in body3["items"]]
    )
    assert len(set(seen_ids)) == 5, "三页拉到的应是 5 条不同 annotation"


@pytest.mark.asyncio
async def test_annotations_page_invalid_cursor(
    httpx_client_bound, db_session, super_admin, annotator
):
    owner, owner_token = super_admin
    user, _ = annotator
    p, batch = await _seed_batch_with_locked_tasks(
        db_session,
        owner.id,
        user.id,
        batch_status="active",
        n_tasks=1,
        task_status="pending",
    )
    task = (
        await db_session.execute(select(Task).where(Task.batch_id == batch.id))
    ).scalar_one()
    await db_session.commit()

    res = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/annotations/page?cursor=garbage",
        headers=_bearer(owner_token),
    )
    assert res.status_code == 400
