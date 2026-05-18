"""v0.10.11 · POST /projects 加 source_project_id 支持 (从已有项目复制配置).

覆盖:
- 仅给 source_project_id, 不带其它字段 — 配置字段全部从源克隆.
- source + 显式 name/ai_enabled — 显式字段覆盖源.
- 源项目带 ml_backend_id — 自动复制 backend (无需 ml_backend_source_id).
- 调用者对源项目无 view 权限 — 404 (与 assert_project_visible 语义一致).
- 不带 source_project_id — 原路径回归.
- 复制是深拷贝, 修改新项目的 JSONB 字段不污染源.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project
from app.db.models.user import User


async def _seed_project(
    db: AsyncSession, owner_id: uuid.UUID, **overrides
) -> Project:
    suffix = uuid.uuid4().hex[:8]
    defaults = dict(
        id=uuid.uuid4(),
        display_id=f"P-CL-{suffix}",
        name=f"src-{suffix}",
        type_label="图像-检测",
        type_key="image-det",
        owner_id=owner_id,
    )
    defaults.update(overrides)
    proj = Project(**defaults)
    db.add(proj)
    await db.flush()
    return proj


async def _seed_backend(
    db: AsyncSession, project_id: uuid.UUID, name: str = "src-backend"
) -> MLBackend:
    b = MLBackend(
        id=uuid.uuid4(),
        project_id=project_id,
        name=name,
        url="http://example.test/",
        is_interactive=True,
        state="connected",
        auth_method="bearer",
        auth_token="tok-secret",
        extra_params={"variant": "tiny"},
    )
    db.add(b)
    await db.flush()
    return b


async def test_clone_copies_all_cloneable_fields(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    src = await _seed_project(
        db_session,
        user.id,
        classes=["car", "pedestrian"],
        classes_config={
            "car": {"color": "#ff0000", "order": 0, "alias": "car"},
            "pedestrian": {"color": "#00ff00", "order": 1},
        },
        attribute_schema={
            "fields": [
                {
                    "key": "occluded",
                    "label": "遮挡",
                    "type": "boolean",
                    "required": False,
                }
            ]
        },
        ai_enabled=True,
        ai_model="grounded-sam2",
        box_threshold=0.4,
        text_threshold=0.3,
        text_output_default="mask",
        sampling="random",
        maximum_annotations=3,
        show_overlap_first=True,
        iou_dedup_threshold=0.85,
        rendering_config={"smoothImage": False, "controlPointsSize": 8},
        label_config={"choice": "single"},
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "name": "克隆出来的项目",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "source_project_id": str(src.id),
    }
    resp = await httpx_client_bound.post(
        "/api/v1/projects", json=body, headers=headers
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # 显式字段保留
    assert data["name"] == "克隆出来的项目"
    # 配置字段从源克隆
    assert data["classes"] == ["car", "pedestrian"]
    assert data["classes_config"]["car"]["color"] == "#ff0000"
    assert data["attribute_schema"]["fields"][0]["key"] == "occluded"
    assert data["ai_enabled"] is True
    assert data["ai_model"] == "grounded-sam2"
    assert data["box_threshold"] == pytest.approx(0.4, rel=1e-5)
    assert data["text_threshold"] == pytest.approx(0.3, rel=1e-5)
    assert data["text_output_default"] == "mask"
    assert data["sampling"] == "random"
    assert data["maximum_annotations"] == 3
    assert data["show_overlap_first"] is True
    assert data["iou_dedup_threshold"] == pytest.approx(0.85, rel=1e-5)
    assert data["rendering_config"]["smoothImage"] is False
    assert data["rendering_config"]["controlPointsSize"] == 8
    # 不复制运行时数据
    assert data["total_tasks"] == 0
    assert data["completed_tasks"] == 0
    # 新项目独立 id
    assert data["id"] != str(src.id)
    # 新项目独立 display_id
    assert data["display_id"] != src.display_id


async def test_clone_explicit_field_overrides_source(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    src = await _seed_project(
        db_session,
        user.id,
        ai_enabled=True,
        ai_model="grounded-sam2",
        box_threshold=0.4,
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "name": "覆盖测试",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "source_project_id": str(src.id),
        # 显式 override
        "ai_enabled": False,
        "box_threshold": 0.6,
    }
    resp = await httpx_client_bound.post(
        "/api/v1/projects", json=body, headers=headers
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # 显式字段优先
    assert data["ai_enabled"] is False
    assert data["box_threshold"] == pytest.approx(0.6, rel=1e-5)
    # ai_model 没显式覆盖, 仍从源克隆 (尽管 ai_enabled=False, 但 ai_model 只是
    # display hint, 复制是无害的)
    assert data["ai_model"] == "grounded-sam2"


async def test_clone_auto_derives_ml_backend_from_source(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    src = await _seed_project(db_session, user.id, ai_enabled=True)
    backend = await _seed_backend(db_session, src.id, name="auto-clone-backend")
    src.ml_backend_id = backend.id
    await db_session.flush()
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "name": "自动 backend 复制",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "source_project_id": str(src.id),
    }
    resp = await httpx_client_bound.post(
        "/api/v1/projects", json=body, headers=headers
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # 新项目获得了自己的 backend (id != 源 backend id)
    assert data["ml_backend_id"] is not None
    assert data["ml_backend_id"] != str(backend.id)
    # ai_model 同步为 backend.name (走 _clone_backend_to_new_project 后的 display hint)
    assert data["ai_model"] == "auto-clone-backend"


async def test_clone_without_view_permission_returns_404(
    httpx_client_bound, project_admin, db_session
):
    """project_admin 复制别人 (非 self 所有) 的源项目 -> 404 (隐藏存在性)."""
    pm_user, pm_token = project_admin

    # 另一个 super_admin 拥有源项目 (project_admin 看不到)
    from app.core.security import hash_password

    other_owner = User(
        id=uuid.uuid4(),
        email=f"other-owner-{uuid.uuid4().hex[:6]}@test.local",
        name="other-owner",
        password_hash=hash_password("Test1234"),
        role=UserRole.SUPER_ADMIN.value,
        is_active=True,
    )
    db_session.add(other_owner)
    await db_session.flush()

    src = await _seed_project(db_session, other_owner.id)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {pm_token}"}
    body = {
        "name": "越权复制",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "source_project_id": str(src.id),
    }
    resp = await httpx_client_bound.post(
        "/api/v1/projects", json=body, headers=headers
    )
    # assert_project_visible 隐藏存在性, 返回 404 (project_admin 只能看 owner=self)
    assert resp.status_code == 404, resp.text


async def test_create_project_without_source_unchanged(
    httpx_client_bound, super_admin
):
    """回归: 不带 source_project_id 时, 走原路径, 不报错."""
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "name": "普通新建",
        "type_label": "图像-检测",
        "type_key": "image-det",
    }
    resp = await httpx_client_bound.post(
        "/api/v1/projects", json=body, headers=headers
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["name"] == "普通新建"
    assert data["classes"] == []
    assert data["ai_enabled"] is False


async def test_clone_jsonb_is_deep_copied(
    httpx_client_bound, super_admin, db_session
):
    """修改新项目的 classes_config 不应该污染源项目 (避免共享 JSONB 引用)."""
    user, token = super_admin
    src = await _seed_project(
        db_session,
        user.id,
        classes=["a"],
        classes_config={"a": {"color": "#111111", "order": 0}},
    )
    await db_session.commit()
    src_id = src.id

    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "name": "深拷贝校验",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "source_project_id": str(src_id),
    }
    resp = await httpx_client_bound.post(
        "/api/v1/projects", json=body, headers=headers
    )
    assert resp.status_code == 200
    new_id = resp.json()["id"]

    # 走 PATCH 改新项目 classes_config
    patch = await httpx_client_bound.patch(
        f"/api/v1/projects/{new_id}",
        json={"classes_config": {"a": {"color": "#999999", "order": 0}}},
        headers=headers,
    )
    assert patch.status_code == 200

    # 重新读源项目, color 应保持 #111111
    db_session.expire_all()
    refreshed = await db_session.get(Project, src_id)
    assert refreshed is not None
    assert refreshed.classes_config["a"]["color"] == "#111111"
