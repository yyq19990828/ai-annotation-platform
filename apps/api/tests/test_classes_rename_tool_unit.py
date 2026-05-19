"""v0.10.17 · POST /projects/{id}/classes/rename 的 tool_unit_id 过滤分支单测.

覆盖:
- 不传 tool_unit_id: 跨所有 enabled unit 一起改 (旧客户端兼容路径)
- 显式 tool_unit_id: 仅改该 unit, 其它 unit 的同名类不受影响 (强隔离)
- tool_unit_id 不存在 → 404
- 类别已存在于目标 unit → 409
- 空 / 相同名称: 400 / 200 no-op

使用 API POST /projects 建项目, 避免 ORM 直写 tool_bindings 与 conftest SAVEPOINT
事务交互导致的 greenlet 错乱.
"""

from __future__ import annotations

import pytest


async def _create_two_unit_project(client, token: str) -> dict:
    """通过 API POST /projects 建带 bbox + ai_interactive 两 unit 的项目, 两 unit 各一个 person."""
    body = {
        "name": "rename-isolation",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "tool_bindings": {
            "bbox": {
                "enabled": True,
                "classes": [{"name": "person", "color": "#aaaaaa", "order": 0}],
                "attribute_schema": {"fields": []},
            },
            "ai_interactive": {
                "enabled": True,
                "classes": [{"name": "person", "color": "#bbbbbb", "order": 0}],
                "attribute_schema": {"fields": []},
            },
        },
    }
    res = await client.post(
        "/api/v1/projects",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.asyncio
async def test_rename_class_scoped_to_one_unit_leaves_other_intact(
    httpx_client, super_admin
):
    _, token = super_admin
    proj = await _create_two_unit_project(httpx_client, token)
    res = await httpx_client.post(
        f"/api/v1/projects/{proj['id']}/classes/rename",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "old_name": "person",
            "new_name": "pedestrian",
            "tool_unit_id": "bbox",
        },
    )
    assert res.status_code == 200, res.text
    out = res.json()
    bbox_names = [c["name"] for c in out["tool_bindings"]["bbox"]["classes"]]
    ai_names = [c["name"] for c in out["tool_bindings"]["ai_interactive"]["classes"]]
    assert bbox_names == ["pedestrian"]
    # ai_interactive unit 的 person 不受影响 (强隔离).
    assert ai_names == ["person"]


@pytest.mark.asyncio
async def test_rename_class_without_unit_id_changes_all_units(
    httpx_client, super_admin
):
    _, token = super_admin
    proj = await _create_two_unit_project(httpx_client, token)
    res = await httpx_client.post(
        f"/api/v1/projects/{proj['id']}/classes/rename",
        headers={"Authorization": f"Bearer {token}"},
        json={"old_name": "person", "new_name": "ped"},
    )
    assert res.status_code == 200
    out = res.json()
    assert out["tool_bindings"]["bbox"]["classes"][0]["name"] == "ped"
    assert out["tool_bindings"]["ai_interactive"]["classes"][0]["name"] == "ped"


@pytest.mark.asyncio
async def test_rename_class_unknown_unit_returns_404(httpx_client, super_admin):
    _, token = super_admin
    proj = await _create_two_unit_project(httpx_client, token)
    res = await httpx_client.post(
        f"/api/v1/projects/{proj['id']}/classes/rename",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "old_name": "person",
            "new_name": "ped",
            "tool_unit_id": "lidar_box_3d",
        },
    )
    assert res.status_code == 404
    assert "lidar_box_3d" in res.json()["detail"]


@pytest.mark.asyncio
async def test_rename_class_conflict_within_unit_returns_409(
    httpx_client, super_admin
):
    _, token = super_admin
    # 单 bbox unit, 两个类 person + pedestrian, 然后 rename person → pedestrian → 409.
    body = {
        "name": "rename-conflict",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "tool_bindings": {
            "bbox": {
                "enabled": True,
                "classes": [
                    {"name": "person", "order": 0},
                    {"name": "pedestrian", "order": 1},
                ],
                "attribute_schema": {"fields": []},
            }
        },
    }
    res = await httpx_client.post(
        "/api/v1/projects",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    pid = res.json()["id"]

    res = await httpx_client.post(
        f"/api/v1/projects/{pid}/classes/rename",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "old_name": "person",
            "new_name": "pedestrian",
            "tool_unit_id": "bbox",
        },
    )
    assert res.status_code == 409
    assert "pedestrian" in res.json()["detail"]


@pytest.mark.asyncio
async def test_rename_class_missing_old_returns_404(httpx_client, super_admin):
    _, token = super_admin
    proj = await _create_two_unit_project(httpx_client, token)
    res = await httpx_client.post(
        f"/api/v1/projects/{proj['id']}/classes/rename",
        headers={"Authorization": f"Bearer {token}"},
        json={"old_name": "missing_cls", "new_name": "x"},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_rename_class_empty_names_rejected(httpx_client, super_admin):
    _, token = super_admin
    proj = await _create_two_unit_project(httpx_client, token)
    for old, new in (("", "x"), ("person", "  ")):
        res = await httpx_client.post(
            f"/api/v1/projects/{proj['id']}/classes/rename",
            headers={"Authorization": f"Bearer {token}"},
            json={"old_name": old, "new_name": new},
        )
        assert res.status_code == 400


@pytest.mark.asyncio
async def test_rename_class_no_op_when_old_eq_new(httpx_client, super_admin):
    _, token = super_admin
    proj = await _create_two_unit_project(httpx_client, token)
    res = await httpx_client.post(
        f"/api/v1/projects/{proj['id']}/classes/rename",
        headers={"Authorization": f"Bearer {token}"},
        json={"old_name": "person", "new_name": "person"},
    )
    assert res.status_code == 200
    # tool_bindings 应保持不变 (API 返回值反映当前状态).
    out = res.json()
    assert out["tool_bindings"]["bbox"]["classes"][0]["name"] == "person"
