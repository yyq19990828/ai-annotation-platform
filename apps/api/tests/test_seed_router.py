"""v0.8.3 · _test_seed router 烟测：reset + login 端点契约。"""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_e2e_seed_setting_defaults_off(monkeypatch):
    from app.config import Settings

    monkeypatch.delenv("E2E_SEED_ENABLED", raising=False)
    assert Settings(_env_file=None).e2e_seed_enabled is False


@pytest.mark.parametrize(
    ("environment", "enabled", "expected"),
    [
        ("development", False, False),
        ("development", True, True),
        ("staging", False, False),
        ("staging", True, True),
        ("production", False, False),
        ("production", True, False),
    ],
)
async def test_seed_router_mount_gate(
    monkeypatch, environment: str, enabled: bool, expected: bool
):
    from app.api.v1 import router as router_module

    monkeypatch.setattr(router_module._settings, "environment", environment)
    monkeypatch.setattr(router_module._settings, "e2e_seed_enabled", enabled)

    assert router_module._e2e_seed_routes_enabled() is expected


@pytest.mark.parametrize(
    ("environment", "enabled", "database_name", "allowed"),
    [
        ("development", True, "annotation_test", True),
        ("staging", True, "ANNOTATION_E2E", True),
        ("development", False, "annotation_test", False),
        ("production", True, "annotation_test", False),
        ("development", True, "annotation", False),
        ("development", True, "annotation_test_copy", False),
    ],
)
async def test_seed_router_runtime_guard_matrix(
    monkeypatch,
    environment: str,
    enabled: bool,
    database_name: str,
    allowed: bool,
):
    from fastapi import HTTPException

    from app.api.v1 import _test_seed

    class StubSession:
        async def scalar(self, statement):
            assert str(statement) == "SELECT current_database()"
            return database_name

    monkeypatch.setattr(_test_seed.settings, "environment", environment)
    monkeypatch.setattr(_test_seed.settings, "e2e_seed_enabled", enabled)

    if allowed:
        await _test_seed._require_e2e_seed_database(StubSession())
    else:
        with pytest.raises(HTTPException) as exc_info:
            await _test_seed._require_e2e_seed_database(StubSession())
        assert exc_info.value.status_code == 403


async def test_all_seed_routes_have_database_guard():
    from fastapi.routing import APIRoute

    from app.api.v1 import _test_seed

    routes = [
        route for route in _test_seed.router.routes if isinstance(route, APIRoute)
    ]
    assert routes
    assert all(
        any(
            dependency.call is _test_seed._require_e2e_seed_database
            for dependency in route.dependant.dependencies
        )
        for route in routes
    )


async def test_seed_router_uses_real_annotation_test_database(httpx_client, db_session):
    from sqlalchemy import text

    database_name = await db_session.scalar(text("SELECT current_database()"))
    assert database_name == "annotation_test"

    response = await httpx_client.get("/api/v1/__test/seed/peek")
    assert response.status_code == 200, response.text


async def test_seed_reset_returns_fixture_payload(httpx_client):
    res = await httpx_client.post("/api/v1/__test/seed/reset")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["admin_email"] == "admin@e2e.test"
    assert body["annotator_email"] == "anno@e2e.test"
    assert body["reviewer_email"] == "rev@e2e.test"
    assert isinstance(body["task_ids"], list)
    assert len(body["task_ids"]) == 5


async def test_seed_reset_is_idempotent_with_singleton_pool(httpx_client, db_session):
    from sqlalchemy import select

    from app.db.models.dataset import DatasetItem
    from app.db.models.ml_backend_registry import ProjectMLBackendPool
    from app.db.models.task import Task

    first = await httpx_client.post("/api/v1/__test/seed/reset")
    second = await httpx_client.post("/api/v1/__test/seed/reset")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["ml_backend_id"]

    assoc = await db_session.scalar(
        select(ProjectMLBackendPool).where(
            ProjectMLBackendPool.project_id == body["project_id"]
        )
    )
    assert assoc is not None
    assert assoc.enabled is True

    tasks = list(
        (
            await db_session.scalars(
                select(Task).where(Task.project_id == body["project_id"])
            )
        ).all()
    )
    assert len(tasks) == 5
    assert all(task.dataset_item_id is not None for task in tasks)
    items = list(
        (
            await db_session.scalars(
                select(DatasetItem).where(
                    DatasetItem.id.in_([task.dataset_item_id for task in tasks])
                )
            )
        ).all()
    )
    assert {(item.width, item.height, item.file_type) for item in items} == {
        (64, 48, "image")
    }


async def test_seed_cleanup_is_idempotent_and_preserves_non_e2e_data(
    httpx_client, db_session
):
    import uuid

    from sqlalchemy import func, or_, select

    from app.db.models.dataset import Dataset
    from app.db.models.ml_backend_registry import MLBackendRegistry
    from app.db.models.project import Project
    from app.db.models.user import User

    dev_user_id = uuid.uuid4()
    dev_project_id = uuid.uuid4()
    dev_backend_id = uuid.uuid4()
    db_session.add(
        User(
            id=dev_user_id,
            email="cleanup-keeper@example.com",
            name="Cleanup Keeper",
            password_hash="x",
            role="super_admin",
            status="offline",
            is_active=True,
        )
    )
    await db_session.flush()
    db_session.add(
        Project(
            id=dev_project_id,
            display_id="P-DEV-CLEANUP-KEEP",
            name="Cleanup Keeper Project",
            type_label="image-det",
            type_key="image-det",
            owner_id=dev_user_id,
        )
    )
    db_session.add(
        MLBackendRegistry(
            id=dev_backend_id,
            name="Cleanup Keeper Backend",
            url="http://cleanup-keeper.test:9999",
            state="connected",
            is_interactive=True,
            source="manual",
        )
    )
    await db_session.commit()

    reset = await httpx_client.post("/api/v1/__test/seed/reset")
    assert reset.status_code == 200, reset.text

    first = await httpx_client.post("/api/v1/__test/seed/cleanup")
    second = await httpx_client.post("/api/v1/__test/seed/cleanup")
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json() == {"ok": True}
    assert second.json() == {"ok": True}

    assert (
        await db_session.scalar(
            select(func.count()).select_from(User).where(User.email.like("%@e2e.test"))
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Project)
            .where(
                or_(
                    Project.name == "E2E Demo Project",
                    Project.display_id.like("P-E2E-%"),
                )
            )
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Dataset)
            .where(Dataset.display_id.like("DS-E2E-%"))
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(MLBackendRegistry)
            .where(MLBackendRegistry.url == "http://mock-sam.e2e:9999")
        )
        == 0
    )

    for model, record_id in (
        (User, dev_user_id),
        (Project, dev_project_id),
        (MLBackendRegistry, dev_backend_id),
    ):
        assert (
            await db_session.scalar(
                select(func.count()).select_from(model).where(model.id == record_id)
            )
            == 1
        )


async def test_seed_login_after_reset_returns_jwt(httpx_client):
    await httpx_client.post("/api/v1/__test/seed/reset")
    res = await httpx_client.post(
        "/api/v1/__test/seed/login",
        json={"email": "admin@e2e.test"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == "admin@e2e.test"


async def test_seed_login_unknown_email_404(httpx_client):
    await httpx_client.post("/api/v1/__test/seed/reset")
    res = await httpx_client.post(
        "/api/v1/__test/seed/login",
        json={"email": "no-such@nowhere"},
    )
    assert res.status_code == 404


async def test_seed_raster_mask_project_opt_in_and_content_fixtures(httpx_client):
    reset = await httpx_client.post("/api/v1/__test/seed/reset")
    data = reset.json()

    configured = await httpx_client.post(
        "/api/v1/__test/seed/configure-raster-mask",
        json={"project_id": data["project_id"], "enabled": True},
    )
    assert configured.status_code == 200, configured.text
    assert configured.json()["enabled"] is True

    healthy = await httpx_client.post(
        "/api/v1/__test/seed/inject-raster-mask",
        json={
            "task_id": data["task_ids"][0],
            "user_email": data["annotator_email"],
            "variant": "donut_three",
        },
    )
    assert healthy.status_code == 200, healthy.text
    assert healthy.json()["mask"]["size"] == [48, 64]

    corrupt = await httpx_client.post(
        "/api/v1/__test/seed/inject-raster-mask",
        json={
            "task_id": data["task_ids"][0],
            "user_email": data["annotator_email"],
            "variant": "corrupt",
            "locked": True,
        },
    )
    assert corrupt.status_code == 200, corrupt.text
    assert corrupt.json()["mask"]["object_key"].endswith(".json")

    five_k = await httpx_client.post(
        "/api/v1/__test/seed/inject-raster-mask",
        json={
            "task_id": data["task_ids"][1],
            "user_email": data["annotator_email"],
            "canvas": "5k",
        },
    )
    assert five_k.status_code == 200, five_k.text
    assert five_k.json()["mask"]["size"] == [2880, 5120]

    eight_k = await httpx_client.post(
        "/api/v1/__test/seed/inject-raster-mask",
        json={
            "task_id": data["task_ids"][2],
            "user_email": data["annotator_email"],
            "canvas": "8k",
        },
    )
    assert eight_k.status_code == 200, eight_k.text
    assert eight_k.json()["mask"]["size"] == [8192, 8192]
    assert eight_k.json()["mask"]["runs"] == 129


async def test_seed_raster_mask_media_canvas_preserves_item_dimensions(
    httpx_client, db_session
):
    from uuid import UUID

    from app.db.models.dataset import DatasetItem
    from app.db.models.task import Task

    reset = await httpx_client.post("/api/v1/__test/seed/reset")
    data = reset.json()
    task = await db_session.get(Task, UUID(data["task_ids"][0]))
    assert task is not None and task.dataset_item_id is not None
    item = await db_session.get(DatasetItem, task.dataset_item_id)
    assert item is not None
    item.width = 1280
    item.height = 720
    await db_session.commit()

    response = await httpx_client.post(
        "/api/v1/__test/seed/inject-raster-mask",
        json={
            "task_id": str(task.id),
            "user_email": data["annotator_email"],
            "variant": "smart_scribble_source",
            "canvas": "media",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["mask"]["size"] == [720, 1280]
    await db_session.refresh(item)
    assert (item.width, item.height) == (1280, 720)


async def test_seed_reset_preserves_dev_data(httpx_client_bound, db_session):
    """v0.8.7+ · D 方案核心断言：reset 不动非 fixture 的开发数据。

    造一个 dev 用户 + dev 项目，跑 reset，断言它们仍然存在；同时 fixture
    （admin@e2e.test 等）被重建。
    """
    import uuid

    from app.db.models.project import Project
    from app.db.models.user import User
    from sqlalchemy import select

    # 造 dev 数据（与 E2E fixture 用 distinct 命名）
    dev_user = User(
        id=uuid.uuid4(),
        email="dev-keeper@example.com",
        name="Dev Keeper",
        password_hash="x",
        role="super_admin",
        status="offline",
        is_active=True,
    )
    db_session.add(dev_user)
    await db_session.flush()
    dev_proj = Project(
        id=uuid.uuid4(),
        display_id="P-DEV-KEEP",
        name="Dev Keeper Project",
        type_label="image-det",
        type_key="image-det",
        owner_id=dev_user.id,
    )
    db_session.add(dev_proj)
    await db_session.commit()

    # 跑 reset
    res = await httpx_client_bound.post("/api/v1/__test/seed/reset")
    assert res.status_code == 200, res.text

    # dev 数据应保留
    kept_user = (
        await db_session.execute(
            select(User).where(User.email == "dev-keeper@example.com")
        )
    ).scalar_one_or_none()
    assert kept_user is not None, "dev 用户被误删"
    kept_proj = (
        await db_session.execute(
            select(Project).where(Project.display_id == "P-DEV-KEEP")
        )
    ).scalar_one_or_none()
    assert kept_proj is not None, "dev 项目被误删"

    # fixture 应存在
    e2e_admin = (
        await db_session.execute(select(User).where(User.email == "admin@e2e.test"))
    ).scalar_one_or_none()
    assert e2e_admin is not None, "E2E fixture admin 应被重建"


async def test_seed_video_webcodecs_rejects_unknown_fixture():
    """未知 fixture 名在 DB 操作前被拒(422),不触碰数据库。"""
    from fastapi import HTTPException

    from app.api.v1 import _test_seed

    req = _test_seed.SeedVideoWebCodecsRequest(
        project_id="11111111-1111-4111-8111-111111111111",
        fixture="not-a-real-fixture",
    )
    with pytest.raises(HTTPException) as exc_info:
        await _test_seed.seed_video_webcodecs(req, db=None)
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "unknown_fixture"


async def test_webcodecs_object_cleanup_paginates_batches_and_verifies():
    from types import SimpleNamespace

    from app.api.v1._test_seed import _delete_webcodecs_seed_objects

    keys = [f"e2e/video/webcodecs/{index}.mp4" for index in range(1001)]

    class Client:
        def __init__(self):
            self.list_calls = 0
            self.deleted_batches: list[list[str]] = []

        def list_objects_v2(self, **kwargs):
            self.list_calls += 1
            if kwargs.get("MaxKeys") == 1:
                return {"Contents": []}
            if kwargs.get("ContinuationToken"):
                return {"Contents": [{"Key": keys[-1]}], "IsTruncated": False}
            return {
                "Contents": [{"Key": key} for key in keys[:1000]],
                "IsTruncated": True,
                "NextContinuationToken": "page-2",
            }

        def delete_objects(self, **kwargs):
            self.deleted_batches.append(
                [item["Key"] for item in kwargs["Delete"]["Objects"]]
            )
            return {}

    client = Client()
    _delete_webcodecs_seed_objects(
        SimpleNamespace(client=client, datasets_bucket="datasets")
    )
    assert [len(batch) for batch in client.deleted_batches] == [1000, 1]
    assert client.list_calls == 3


async def test_webcodecs_object_cleanup_fails_on_partial_delete():
    from types import SimpleNamespace

    from app.api.v1._test_seed import _delete_webcodecs_seed_objects

    class Client:
        def list_objects_v2(self, **kwargs):
            return {
                "Contents": [{"Key": "e2e/video/webcodecs/a.mp4"}],
                "IsTruncated": False,
            }

        def delete_objects(self, **kwargs):
            return {"Errors": [{"Key": "redacted", "Code": "AccessDenied"}]}

    with pytest.raises(RuntimeError, match="delete failed for 1 object"):
        _delete_webcodecs_seed_objects(
            SimpleNamespace(client=Client(), datasets_bucket="datasets")
        )


async def test_webcodecs_object_cleanup_fails_when_verification_finds_residual():
    from types import SimpleNamespace

    from app.api.v1._test_seed import _delete_webcodecs_seed_objects

    class Client:
        def list_objects_v2(self, **kwargs):
            return {
                "Contents": [{"Key": "e2e/video/webcodecs/a.mp4"}],
                "IsTruncated": False,
            }

        def delete_objects(self, **kwargs):
            return {}

    with pytest.raises(RuntimeError, match="left MinIO objects"):
        _delete_webcodecs_seed_objects(
            SimpleNamespace(client=Client(), datasets_bucket="datasets")
        )
