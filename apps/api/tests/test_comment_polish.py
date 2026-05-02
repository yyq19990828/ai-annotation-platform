"""v0.6.6 · 评论 polish（mentions / attachments / download）越权与校验测试。

覆盖 ROADMAP 列出的 4 个边界：
  1. mentions 含非项目成员 user_id → 422
  2. attachments storageKey 不以 comment-attachments/ 开头 → 422
  3. download key 不在 comment-attachments/{annotation_id}/ 前缀下 → 400
  4. 项目非成员请求 download → 404
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_project_with_annotation(
    db: AsyncSession, owner_id: uuid.UUID
) -> tuple[Project, Annotation]:
    suffix = uuid.uuid4().hex[:8]
    p = Project(
        id=uuid.uuid4(),
        display_id=f"P-CP-{suffix}",
        name="comment polish",
        type_label="图像-检测",
        type_key="image-det",
        owner_id=owner_id,
        classes=["car"],
    )
    db.add(p)
    await db.flush()

    from app.db.models.task import Task
    task = Task(
        id=uuid.uuid4(),
        project_id=p.id,
        display_id=f"T-CP-{suffix}",
        file_name="x.jpg",
        file_path="/tmp/x.jpg",
        file_type="image",
        status="in_progress",
    )
    db.add(task)
    await db.flush()

    ann = Annotation(
        id=uuid.uuid4(),
        task_id=task.id,
        project_id=p.id,
        user_id=owner_id,
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
        confidence=1.0,
        is_active=True,
    )
    db.add(ann)
    await db.flush()
    return p, ann


@pytest.mark.asyncio
async def test_mentions_non_member_rejected(httpx_client, db_session, super_admin):
    sa_user, sa_token = super_admin
    _, ann = await _seed_project_with_annotation(db_session, sa_user.id)

    stranger_id = str(uuid.uuid4())  # 不是项目成员
    r = await httpx_client.post(
        f"/api/v1/annotations/{ann.id}/comments",
        json={
            "body": "@stranger 看一下",
            "mentions": [{"userId": stranger_id, "displayName": "stranger", "offset": 0, "length": 9}],
            "attachments": [],
            "canvas_drawing": None,
        },
        headers=_bearer(sa_token),
    )
    # super_admin 可见所有项目，但 mentions 校验是「项目成员」—— 应 422 / 400
    assert r.status_code in (400, 422), f"expected 4xx, got {r.status_code}: {r.text}"


@pytest.mark.asyncio
async def test_attachment_storagekey_wrong_prefix_rejected(httpx_client, db_session, super_admin):
    sa_user, sa_token = super_admin
    _, ann = await _seed_project_with_annotation(db_session, sa_user.id)

    bad_key = f"some-other-bucket/{ann.id}/{uuid.uuid4()}-x.png"
    r = await httpx_client.post(
        f"/api/v1/annotations/{ann.id}/comments",
        json={
            "body": "see attached",
            "mentions": [],
            "attachments": [{
                "storageKey": bad_key,
                "fileName": "x.png",
                "mimeType": "image/png",
                "size": 1024,
            }],
            "canvas_drawing": None,
        },
        headers=_bearer(sa_token),
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_download_wrong_prefix_rejected(httpx_client, db_session, super_admin):
    sa_user, sa_token = super_admin
    _, ann = await _seed_project_with_annotation(db_session, sa_user.id)

    other_aid = uuid.uuid4()
    bad_key = f"comment-attachments/{other_aid}/{uuid.uuid4()}-y.png"
    r = await httpx_client.get(
        f"/api/v1/annotations/{ann.id}/comment-attachments/download",
        params={"key": bad_key},
        headers=_bearer(sa_token),
    )
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_download_non_member_404(httpx_client, db_session, super_admin, annotator):
    """super_admin 创建的项目、annotator 非项目成员 → 调 download 应 404 隐藏存在性。"""
    sa_user, _ = super_admin
    ann_user, ann_token = annotator
    _, ann = await _seed_project_with_annotation(db_session, sa_user.id)

    # 合法前缀的 key（不需真实存在；越权应优先于 storage 校验）
    valid_key = f"comment-attachments/{ann.id}/{uuid.uuid4()}-z.png"
    r = await httpx_client.get(
        f"/api/v1/annotations/{ann.id}/comment-attachments/download",
        params={"key": valid_key},
        headers=_bearer(ann_token),
    )
    # annotator 不是项目成员（也不是 owner）→ 404 隐藏存在性
    assert r.status_code == 404, r.text
