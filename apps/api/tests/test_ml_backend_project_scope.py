"""项目级 ML Backend 端点的「项目可见性 / 归属」鉴权收口回归。

背景: backend 全局化 (ADR-0044) 后, /projects/{id}/ml-backends/* 端点原先只用
require_roles 校验「全局角色」, 未校验 URL 里的 project_id 是否对调用者可见/归其所有,
形成跨项目越权面:
  · 读端点 (list/setup/capabilities/interactive): 全局 annotator/reviewer 可读任意项目;
  · 写端点 (create/update/delete/unload/...): 任一 project_admin 可改他人名下项目。

修复: 读端点叠加 require_project_visible, 写端点叠加 require_project_owner。
本模块锁定该行为 (正/反各一)。
"""

from __future__ import annotations

import uuid

from app.db.models.ml_backend_registry import MLBackendRegistry, ProjectMLBackend
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember


async def _seed_project(db, owner_id) -> Project:
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-SCOPE-{suffix}",
        name=f"scope-{suffix}",
        type_label="image-det",
        type_key="image-det",
        owner_id=owner_id,
    )
    db.add(proj)
    await db.flush()
    return proj


async def _seed_backend(db, project_id) -> MLBackendRegistry:
    b = MLBackendRegistry(
        id=uuid.uuid4(),
        name="grounded-sam2",
        url=f"http://example-{uuid.uuid4().hex[:8]}/",
        is_interactive=True,
        state="connected",
    )
    db.add(b)
    await db.flush()
    db.add(ProjectMLBackend(project_id=project_id, registry_id=b.id, enabled=True))
    await db.flush()
    return b


# ── 读端点: require_project_visible ──────────────────────────────────


async def test_list_backends_denied_for_non_member_annotator(
    httpx_client_bound, super_admin, annotator, db_session
):
    """非项目成员的 annotator 读他人项目 backend 列表 → 404 (隐藏存在性)。"""
    owner, _ = super_admin
    _, anno_token = annotator
    proj = await _seed_project(db_session, owner.id)
    await _seed_backend(db_session, proj.id)
    await db_session.commit()

    resp = await httpx_client_bound.get(
        f"/api/v1/projects/{proj.id}/ml-backends",
        headers={"Authorization": f"Bearer {anno_token}"},
    )
    assert resp.status_code == 404, resp.text


async def test_list_backends_ok_for_member_annotator(
    httpx_client_bound, super_admin, annotator, db_session
):
    """项目成员的 annotator 可读本项目 backend 列表 → 200 (未被过度收紧)。"""
    owner, _ = super_admin
    anno, anno_token = annotator
    proj = await _seed_project(db_session, owner.id)
    await _seed_backend(db_session, proj.id)
    db_session.add(
        ProjectMember(
            project_id=proj.id,
            user_id=anno.id,
            role="annotator",
            assigned_by=owner.id,
        )
    )
    await db_session.commit()

    resp = await httpx_client_bound.get(
        f"/api/v1/projects/{proj.id}/ml-backends",
        headers={"Authorization": f"Bearer {anno_token}"},
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 1


# ── 写端点: require_project_owner ────────────────────────────────────


async def test_create_backend_denied_for_non_owner_project_admin(
    httpx_client_bound, super_admin, project_admin, db_session
):
    """非 owner 的 project_admin 给他人项目加 backend → 403。"""
    owner, _ = super_admin
    _, pm_token = project_admin
    proj = await _seed_project(db_session, owner.id)
    await db_session.commit()

    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/ml-backends",
        json={"name": "sam3", "url": "http://sam3-scope/", "is_interactive": True},
        headers={"Authorization": f"Bearer {pm_token}"},
    )
    assert resp.status_code == 403, resp.text


async def test_create_backend_ok_for_owning_project_admin(
    httpx_client_bound, project_admin, db_session
):
    """owner project_admin 给自己项目加 backend → 201 (未被过度收紧)。"""
    pm, pm_token = project_admin
    proj = await _seed_project(db_session, pm.id)
    await db_session.commit()

    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/ml-backends",
        json={"name": "sam3", "url": "http://sam3-own/", "is_interactive": True},
        headers={"Authorization": f"Bearer {pm_token}"},
    )
    assert resp.status_code == 201, resp.text
