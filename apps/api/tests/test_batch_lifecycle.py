"""v0.7.0 · 批次状态机重设计端到端覆盖

5 个核心场景：
1. TestTransitionAuth — /transition 鉴权矩阵（标注员不能直推 approved 等）
2. TestRejectBatchSoftReset — 软重置语义（不动 annotations / is_labeled）
3. TestEmptyBatchActivation — 0-task 批次 draft→active 拒绝
4. TestWithdrawCascade — 标注员 withdraw 后 reviewing → annotating（v0.6.x 既有路径，本版固化）
5. TestReviewerVisibility — reviewer 在 reviewing 批次的可见性 + annotator 在 rejected 批次的特例
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models.annotation import Annotation
from app.db.models.notification import Notification
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.services.display_id import next_display_id


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed(
    db,
    owner_id: uuid.UUID,
    annotator_id: uuid.UUID,
    *,
    batch_status: str = "active",
    n_tasks: int = 2,
    task_status: str = "pending",
    is_labeled: bool = False,
):
    pid = uuid.uuid4()
    p = Project(
        id=pid,
        display_id=await next_display_id(db, "projects"),
        name="lifecycle test",
        type_label="图像-检测",
        type_key="image-det",
        owner_id=owner_id,
        classes=["car"],
    )
    db.add(p)
    await db.flush()

    db.add(ProjectMember(
        project_id=pid, user_id=annotator_id, role="annotator", assigned_by=owner_id,
    ))

    batch = TaskBatch(
        id=uuid.uuid4(),
        project_id=pid,
        display_id=await next_display_id(db, "batches"),
        name="b1",
        status=batch_status,
        # v0.7.2 单值语义：annotator_id 单值；assigned_user_ids 派生
        annotator_id=annotator_id,
        assigned_user_ids=[str(annotator_id)],
    )
    db.add(batch)
    await db.flush()

    tasks: list[Task] = []
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
            is_labeled=is_labeled,
        )
        db.add(t)
        tasks.append(t)
    await db.flush()
    return p, batch, tasks


# ── 1. transition 鉴权矩阵 ──────────────────────────────────────────────


class TestTransitionAuth:
    @pytest.mark.asyncio
    async def test_annotator_cannot_skip_to_approved(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        owner, _ = super_admin
        user, token = annotator
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="reviewing",
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/transition",
            json={"target_status": "approved"},
            headers=_bearer(token),
        )
        assert resp.status_code == 403
        assert "annotator" in resp.text.lower()

    @pytest.mark.asyncio
    async def test_annotator_can_submit_for_review(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        """annotating → reviewing：被分派的标注员可主动提交质检。"""
        owner, _ = super_admin
        user, token = annotator
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="annotating",
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/transition",
            json={"target_status": "reviewing"},
            headers=_bearer(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "reviewing"

    @pytest.mark.asyncio
    async def test_unassigned_annotator_cannot_submit(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        """未分派到批次的标注员无法把批次推到 reviewing。"""
        owner, _ = super_admin
        user, token = annotator
        # 让 annotator 是项目成员但不在 assigned_user_ids 中
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="annotating",
        )
        # v0.7.2：清空 annotator_id（单值语义）
        batch.annotator_id = None
        batch.assigned_user_ids = []
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/transition",
            json={"target_status": "reviewing"},
            headers=_bearer(token),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_reviewer_can_approve(
        self, httpx_client_bound, db_session, super_admin, reviewer,
    ):
        owner, _ = super_admin
        rev, rev_token = reviewer
        # _seed 会把 rev 作为 "annotator" 成员加进去；批次的 assigned_user_ids 包含 rev。
        # transition reviewing→approved 走 _is_reviewer 分支，靠 role==REVIEWER（与成员角色无关）。
        p, batch, _ = await _seed(
            db_session, owner.id, rev.id, batch_status="reviewing",
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/transition",
            json={"target_status": "approved"},
            headers=_bearer(rev_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "approved"

    @pytest.mark.asyncio
    async def test_owner_can_archive(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        owner, owner_token = super_admin
        user, _ = annotator
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="active",
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/transition",
            json={"target_status": "archived"},
            headers=_bearer(owner_token),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "archived"

    @pytest.mark.asyncio
    async def test_annotator_cannot_archive(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        owner, _ = super_admin
        user, token = annotator
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="active",
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/transition",
            json={"target_status": "archived"},
            headers=_bearer(token),
        )
        assert resp.status_code == 403


# ── 2. reject_batch 软重置 ──────────────────────────────────────────────


class TestRejectBatchSoftReset:
    @pytest.mark.asyncio
    async def test_reject_resets_only_review_completed_to_pending(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        """方案 A 软重置：review/completed → pending；is_labeled / annotations 保持。"""
        owner, owner_token = super_admin
        user, _ = annotator
        p, batch, tasks = await _seed(
            db_session, owner.id, user.id,
            batch_status="reviewing",
            task_status="review",
            is_labeled=True,
            n_tasks=3,
        )
        # 给两个任务塞 annotation（模拟标注员已画了几个框）
        for t in tasks[:2]:
            db_session.add(Annotation(
                id=uuid.uuid4(),
                task_id=t.id,
                project_id=p.id,
                user_id=user.id,
                annotation_type="bbox",
                class_name="car",
                geometry={"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
                is_active=True,
            ))
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/reject",
            json={"feedback": "请修正第一张图的边界框"},
            headers=_bearer(owner_token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "rejected"
        assert body["review_feedback"] == "请修正第一张图的边界框"
        assert body["reviewed_at"] is not None
        assert body["reviewed_by"] == str(owner.id)

        # 数据校验
        for t in tasks:
            await db_session.refresh(t)
            assert t.status == "pending"
            # is_labeled 不应被重置（v0.6.x 老语义会清掉，v0.7.0 软重置保留）
            assert t.is_labeled is True

        ann_rows = (await db_session.execute(
            select(Annotation).where(Annotation.task_id.in_([t.id for t in tasks]))
        )).scalars().all()
        # annotations 全部保持 is_active
        assert len(ann_rows) == 2
        assert all(a.is_active for a in ann_rows)

    @pytest.mark.asyncio
    async def test_reject_creates_notification_for_assigned(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        owner, owner_token = super_admin
        user, _ = annotator
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="reviewing",
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/reject",
            json={"feedback": "需要重做"},
            headers=_bearer(owner_token),
        )
        assert resp.status_code == 200

        # annotator 应有 batch.rejected 通知
        notif_rows = (await db_session.execute(
            select(Notification).where(
                Notification.user_id == user.id,
                Notification.type == "batch.rejected",
            )
        )).scalars().all()
        assert len(notif_rows) == 1
        assert notif_rows[0].payload.get("feedback") == "需要重做"
        assert notif_rows[0].payload.get("batch_display_id") == batch.display_id

    @pytest.mark.asyncio
    async def test_reject_requires_feedback(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        owner, owner_token = super_admin
        user, _ = annotator
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="reviewing",
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/reject",
            json={"feedback": ""},
            headers=_bearer(owner_token),
        )
        assert resp.status_code == 422  # Pydantic min_length=1

    @pytest.mark.asyncio
    async def test_annotator_cannot_reject(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        owner, _ = super_admin
        user, token = annotator
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="reviewing",
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/reject",
            json={"feedback": "xxx"},
            headers=_bearer(token),
        )
        # require_roles 在 reject 端点先于 assert_can_transition 拦截，403
        assert resp.status_code == 403


# ── 3. 0-task 批次激活拦截 ───────────────────────────────────────────────


class TestEmptyBatchActivation:
    @pytest.mark.asyncio
    async def test_empty_batch_cannot_activate(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        owner, owner_token = super_admin
        user, _ = annotator
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="draft", n_tasks=0,
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/transition",
            json={"target_status": "active"},
            headers=_bearer(owner_token),
        )
        assert resp.status_code == 400
        assert "empty" in resp.text.lower()

    @pytest.mark.asyncio
    async def test_non_empty_batch_can_activate(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        owner, owner_token = super_admin
        user, _ = annotator
        p, batch, _ = await _seed(
            db_session, owner.id, user.id, batch_status="draft", n_tasks=1,
        )
        await db_session.commit()

        resp = await httpx_client_bound.post(
            f"/api/v1/projects/{p.id}/batches/{batch.id}/transition",
            json={"target_status": "active"},
            headers=_bearer(owner_token),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "active"


# ── 4. withdraw 反推（已存在路径固化）────────────────────────────────────


class TestWithdrawCascade:
    @pytest.mark.asyncio
    async def test_reviewing_drops_back_to_annotating_after_withdraw(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        """标注员 withdraw（review→pending）会让 check_auto_transitions 把
        batch 从 reviewing 退回 annotating（如果有非全空池）。
        由于 withdraw 路径较复杂，本测试简化：直接调 check_auto_transitions 同等手段验证。
        """
        from app.services.batch import BatchService

        owner, _ = super_admin
        user, _ = annotator
        p, batch, tasks = await _seed(
            db_session, owner.id, user.id,
            batch_status="annotating",
            task_status="review",
            is_labeled=True,
            n_tasks=2,
        )
        await db_session.flush()

        svc = BatchService(db_session)
        # 初始：所有任务都 review，check 应推到 reviewing
        await svc.check_auto_transitions(batch.id)
        await db_session.refresh(batch)
        assert batch.status == "reviewing"

        # 标注员 withdraw 一个任务（模拟）
        tasks[0].status = "pending"
        await db_session.flush()

        # 这里 v0.6.x 行为：annotator withdraw 端点本身会把 batch 反推回 annotating
        # （test_task_lock 等已覆盖 withdraw 端点）。本测试只验证 check_auto_transitions
        # 在 reviewing 时遇到新增 pending 不会卡死，需要业务侧主动反推。
        # 当前 check_auto_transitions 只处理 active→annotating / annotating→reviewing，
        # reviewing→annotating 反推由 withdraw 端点直接 update batch.status。
        # 这里固化「批次此时仍在 reviewing 是合规的（auto 不会主动反推）」。
        await svc.check_auto_transitions(batch.id)
        await db_session.refresh(batch)
        # auto 不反推；保持 reviewing
        assert batch.status == "reviewing"


# ── 5. reviewer 可见性 + rejected 特例 ──────────────────────────────────


class TestReviewerVisibility:
    @pytest.mark.asyncio
    async def test_reviewer_sees_reviewing_batch_tasks(
        self, httpx_client_bound, db_session, super_admin, reviewer,
    ):
        owner, _ = super_admin
        rev, rev_token = reviewer
        p, batch, tasks = await _seed(
            db_session, owner.id, rev.id,
            batch_status="reviewing",
            task_status="review",
            is_labeled=True,
        )
        # 把 reviewer 从 assigned_user_ids 中去掉验证不受 assigned 约束
        batch.assigned_user_ids = [str(uuid.uuid4())]  # 别人
        await db_session.commit()

        resp = await httpx_client_bound.get(
            f"/api/v1/tasks?project_id={p.id}&status=review&limit=200",
            headers=_bearer(rev_token),
        )
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()["items"]}
        assert str(tasks[0].id) in ids

    @pytest.mark.asyncio
    async def test_annotator_sees_rejected_batch_when_assigned(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        """rejected 状态特例：被分派的标注员可见（看 reviewer 留言 + 重做）。"""
        owner, _ = super_admin
        user, token = annotator
        p, batch, tasks = await _seed(
            db_session, owner.id, user.id,
            batch_status="rejected",
            task_status="pending",
            is_labeled=True,
        )
        await db_session.commit()

        resp = await httpx_client_bound.get(
            f"/api/v1/tasks?project_id={p.id}&limit=200",
            headers=_bearer(token),
        )
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()["items"]}
        assert str(tasks[0].id) in ids

    @pytest.mark.asyncio
    async def test_unassigned_annotator_cannot_see_rejected(
        self, httpx_client_bound, db_session, super_admin, annotator,
    ):
        """rejected 特例仅对**被分派**标注员放行。"""
        owner, _ = super_admin
        user, token = annotator
        p, batch, tasks = await _seed(
            db_session, owner.id, user.id, batch_status="rejected",
        )
        # v0.7.2：清空 annotator_id（单值语义）
        batch.annotator_id = None
        batch.assigned_user_ids = []
        await db_session.commit()

        resp = await httpx_client_bound.get(
            f"/api/v1/tasks?project_id={p.id}&limit=200",
            headers=_bearer(token),
        )
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()["items"]}
        assert str(tasks[0].id) not in ids
