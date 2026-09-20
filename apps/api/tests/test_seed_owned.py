"""Regression tests for the owned (per-test) E2E seed fixture routes.

P7 fixture isolation contract (`POST /api/v1/__test/seed/owned` and
`POST /api/v1/__test/seed/owned-cleanup`):

* identifiers derive deterministically from a validated namespace token, so a
  test (and only that test) can rebuild or remove its own fixture;
* creation is non-destructive: another namespace's fixture and ordinary data
  are never matched by build or cleanup;
* cleanup is exact and idempotent, and fails loudly on residuals instead of
  silently leaving partial state;
* the shared `seed/reset` namespace keeps its documented converging semantics.

These tests run against the disposable test database and the real storage
service, mirroring the existing `test_seed_router.py` harness.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio

A = "regaa"
B = "regbb"


async def _build_owned(client, namespace: str) -> dict:
    response = await client.post(
        "/api/v1/__test/seed/owned", json={"namespace": namespace}
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _cleanup_owned(client, namespace: str):
    return await client.post(
        "/api/v1/__test/seed/owned-cleanup", json={"namespace": namespace}
    )


def _owned_project_name(namespace: str) -> str:
    return f"E2E Owned {namespace}"


@pytest.mark.parametrize(
    "namespace",
    ["", "AB", "abc", "a" * 13, "ab-cd", "ab_cd", "тест"],
)
async def test_owned_namespace_rejects_malformed_tokens(httpx_client, namespace):
    response = await httpx_client.post(
        "/api/v1/__test/seed/owned", json={"namespace": namespace}
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "e2e_owned_namespace_invalid"

    cleanup = await _cleanup_owned(httpx_client, namespace)
    assert cleanup.status_code == 422, cleanup.text


@pytest.mark.parametrize("namespace", ["abcd", "a" * 12])
async def test_owned_namespace_accepts_boundary_tokens(httpx_client, namespace):
    body = await _build_owned(httpx_client, namespace)
    try:
        assert body["admin_email"] == f"admin-{namespace}@e2e.test"
    finally:
        assert (await _cleanup_owned(httpx_client, namespace)).status_code == 200


async def test_owned_fixture_builds_complete_namespaced_workbench(
    httpx_client, db_session: AsyncSession
):
    from app.db.models.dataset import Dataset, DatasetItem
    from app.db.models.ml_backend_pool import MLBackendPoolMember, MLBackendServicePool
    from app.db.models.ml_backend_registry import (
        MLBackendRegistry,
        ProjectMLBackendPool,
    )
    from app.db.models.project import Project
    from app.db.models.project_member import ProjectMember
    from app.db.models.task import Task
    from app.db.models.task_batch import TaskBatch
    from app.db.models.user import User
    from app.services.storage import storage_service

    body = await _build_owned(httpx_client, A)

    # Response shape matches SeedData so existing spec call sites keep working.
    assert body["admin_email"] == f"admin-{A}@e2e.test"
    assert body["annotator_email"] == f"anno-{A}@e2e.test"
    assert body["reviewer_email"] == f"rev-{A}@e2e.test"
    assert len(body["task_ids"]) == 5
    assert body["ml_backend_id"]

    users = {
        row.email: row
        for row in (
            await db_session.scalars(
                select(User).where(
                    User.email.in_(
                        [
                            body["admin_email"],
                            body["annotator_email"],
                            body["reviewer_email"],
                        ]
                    )
                )
            )
        ).all()
    }
    assert set(users) == {
        body["admin_email"],
        body["annotator_email"],
        body["reviewer_email"],
    }
    assert users[body["admin_email"]].role == "super_admin"
    assert users[body["annotator_email"]].role == "employee"
    assert users[body["reviewer_email"]].role == "employee"

    project = await db_session.get(Project, uuid.UUID(body["project_id"]))
    assert project is not None
    assert project.name == _owned_project_name(A)
    assert project.tool_bindings["region"]["enabled"] is True

    memberships = {
        row.role
        for row in (
            await db_session.scalars(
                select(ProjectMember).where(ProjectMember.project_id == project.id)
            )
        ).all()
    }
    assert memberships == {"annotator", "reviewer"}

    batch = await db_session.scalar(
        select(TaskBatch).where(TaskBatch.display_id == f"B-E2E-{A}")
    )
    assert batch is not None and batch.project_id == project.id

    dataset = await db_session.scalar(
        select(Dataset).where(Dataset.display_id == f"DS-E2E-{A}")
    )
    assert dataset is not None
    tasks = list(
        (
            await db_session.scalars(select(Task).where(Task.project_id == project.id))
        ).all()
    )
    assert len(tasks) == 5
    assert all(task.display_id.startswith(f"T-E2E-{A}") for task in tasks)
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
    assert all(item.file_path.startswith(f"e2e/owned/{A}/image/") for item in items)

    registry = await db_session.scalar(
        select(MLBackendRegistry).where(
            MLBackendRegistry.url == f"http://mock-sam-{A}.e2e:9999"
        )
    )
    assert registry is not None
    assert str(registry.id) == body["ml_backend_id"]
    pool = await db_session.scalar(
        select(MLBackendServicePool).where(
            MLBackendServicePool.legacy_instance_id == registry.id
        )
    )
    assert pool is not None
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(MLBackendPoolMember)
            .where(MLBackendPoolMember.pool_id == pool.id)
        )
        == 1
    )
    binding = await db_session.scalar(
        select(ProjectMLBackendPool).where(
            ProjectMLBackendPool.project_id == project.id
        )
    )
    assert binding is not None and binding.enabled is True

    # Login works for the namespace's own accounts through the normal route.
    login = await httpx_client.post(
        "/api/v1/__test/seed/login", json={"email": body["annotator_email"]}
    )
    assert login.status_code == 200, login.text

    listing = storage_service.client.list_objects_v2(
        Bucket=storage_service.datasets_bucket, Prefix=f"e2e/owned/{A}/image/"
    )
    assert {obj["Key"] for obj in listing.get("Contents", [])} == {
        f"e2e/owned/{A}/image/task-{index}.svg" for index in range(1, 6)
    }

    assert (await _cleanup_owned(httpx_client, A)).status_code == 200


async def test_owned_cleanup_is_exact_idempotent_and_neighbour_safe(
    httpx_client, db_session: AsyncSession
):
    from app.db.models.dataset import Dataset
    from app.db.models.ml_backend_registry import MLBackendRegistry
    from app.db.models.project import Project
    from app.db.models.task_batch import TaskBatch
    from app.db.models.user import User

    # Ordinary rows that no fixture scope may ever match.
    keeper_user_id = uuid.uuid4()
    keeper_project_id = uuid.uuid4()
    keeper_backend_id = uuid.uuid4()
    db_session.add(
        User(
            id=keeper_user_id,
            email="owned-keeper@example.com",
            name="Owned Keeper",
            password_hash="x",
            role="employee",
            status="offline",
            is_active=True,
        )
    )
    await db_session.flush()
    db_session.add(
        Project(
            id=keeper_project_id,
            display_id="P-OWNED-KEEPER",
            name="Owned Keeper Project",
            type_label="image-det",
            type_key="image-det",
            owner_id=keeper_user_id,
        )
    )
    db_session.add(
        MLBackendRegistry(
            id=keeper_backend_id,
            name="Owned Keeper Backend",
            url="http://owned-keeper.test:9999",
            state="connected",
            is_interactive=True,
            source="manual",
        )
    )
    await db_session.commit()

    body_a = await _build_owned(httpx_client, A)
    body_b = await _build_owned(httpx_client, B)

    first = await _cleanup_owned(httpx_client, A)
    second = await _cleanup_owned(httpx_client, A)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json() == {"ok": True} == second.json()

    # Namespace A is fully gone, by every exact selector.
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.email.in_(
                    [f"admin-{A}@e2e.test", f"anno-{A}@e2e.test", f"rev-{A}@e2e.test"]
                )
            )
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Project)
            .where(Project.name == _owned_project_name(A))
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Dataset)
            .where(Dataset.display_id == f"DS-E2E-{A}")
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(TaskBatch)
            .where(TaskBatch.display_id == f"B-E2E-{A}")
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(MLBackendRegistry)
            .where(MLBackendRegistry.url == f"http://mock-sam-{A}.e2e:9999")
        )
        == 0
    )

    # Neighbouring namespace B survives intact, as does ordinary data.
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.email.in_(
                    [f"admin-{B}@e2e.test", f"anno-{B}@e2e.test", f"rev-{B}@e2e.test"]
                )
            )
        )
        == 3
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Project)
            .where(Project.name == _owned_project_name(B))
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Dataset)
            .where(Dataset.display_id == f"DS-E2E-{B}")
        )
        == 1
    )
    for model, record_id in (
        (User, keeper_user_id),
        (Project, keeper_project_id),
        (MLBackendRegistry, keeper_backend_id),
    ):
        assert (
            await db_session.scalar(
                select(func.count()).select_from(model).where(model.id == record_id)
            )
            == 1
        )

    # A can be rebuilt after its cleanup, and B still converges afterwards.
    rebuilt = await _build_owned(httpx_client, A)
    assert rebuilt["project_id"] not in (body_a["project_id"], body_b["project_id"])
    assert (await _cleanup_owned(httpx_client, B)).status_code == 200
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.email.in_(
                    [f"admin-{B}@e2e.test", f"anno-{B}@e2e.test", f"rev-{B}@e2e.test"]
                )
            )
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.email.in_(
                    [f"admin-{A}@e2e.test", f"anno-{A}@e2e.test", f"rev-{A}@e2e.test"]
                )
            )
        )
        == 3
    )


async def test_owned_rebuild_is_retry_safe(httpx_client, db_session: AsyncSession):
    from app.db.models.project import Project
    from app.db.models.task import Task
    from app.db.models.user import User

    first = await _build_owned(httpx_client, A)
    stale_project_id = uuid.UUID(first["project_id"])
    stale_task_ids = {uuid.UUID(task_id) for task_id in first["task_ids"]}

    second = await _build_owned(httpx_client, A)
    assert second["admin_email"] == first["admin_email"]
    rebuilt_project_id = uuid.UUID(second["project_id"])
    assert rebuilt_project_id != stale_project_id
    rebuilt_task_ids = {uuid.UUID(task_id) for task_id in second["task_ids"]}
    assert len(rebuilt_task_ids) == 5
    assert rebuilt_task_ids.isdisjoint(stale_task_ids)

    # No leftovers from the crashed attempt survive the retry.
    assert await db_session.get(Project, stale_project_id) is None
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.id.in_(stale_task_ids | rebuilt_task_ids))
        )
        == 5
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.email.in_(
                    [f"admin-{A}@e2e.test", f"anno-{A}@e2e.test", f"rev-{A}@e2e.test"]
                )
            )
        )
        == 3
    )


async def test_owned_cleanup_never_touches_the_shared_fixture(
    httpx_client, db_session: AsyncSession
):
    from app.db.models.dataset import Dataset
    from app.db.models.ml_backend_registry import MLBackendRegistry
    from app.db.models.project import Project
    from app.db.models.user import User

    shared = await httpx_client.post("/api/v1/__test/seed/reset")
    assert shared.status_code == 200, shared.text
    await _build_owned(httpx_client, A)

    assert (await _cleanup_owned(httpx_client, A)).status_code == 200

    assert (
        await db_session.scalar(
            select(func.count()).select_from(User).where(User.email == "admin@e2e.test")
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Project)
            .where(Project.name == "E2E Demo Project")
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Dataset)
            .where(Dataset.display_id == "DS-E2E-IMAGE")
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(MLBackendRegistry)
            .where(MLBackendRegistry.url == "http://mock-sam.e2e:9999")
        )
        == 1
    )


async def test_owned_cleanup_exposes_residuals_on_partial_failure(
    httpx_client, db_session: AsyncSession, monkeypatch
):
    """A silently failing delete must fail the request, not pass quietly.

    `_try_delete` deliberately absorbs individual DELETE failures so one drift
    cannot abort the whole ordered teardown; the residual guard is what turns
    a partial failure into a visible error. Simulate exactly that: a stray
    project referencing an owned user (a FK the engine does not own) blocks
    the users DELETE, the swallow-and-continue path proceeds, and the residual
    check must reject the cleanup with exact counts. Once the blocker is
    removed the same cleanup converges.
    """
    from app.db.models.project import Project
    from app.db.models.user import User

    body = await _build_owned(httpx_client, A)
    annotator = await db_session.scalar(
        select(User).where(User.email == body["annotator_email"])
    )
    assert annotator is not None
    blocker = Project(
        id=uuid.uuid4(),
        display_id="P-E2E-RBLOCK",
        name="Residual Blocker",
        type_label="image-det",
        type_key="image-det",
        owner_id=annotator.id,
    )
    db_session.add(blocker)
    await db_session.commit()

    response = await _cleanup_owned(httpx_client, A)
    assert response.status_code == 500, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "e2e_seed_cleanup_incomplete"
    assert detail["residuals"]["users"] == 3

    await db_session.delete(blocker)
    await db_session.commit()
    assert (await _cleanup_owned(httpx_client, A)).status_code == 200


async def test_owned_routes_stay_hidden_from_openapi(httpx_client, app_module):
    for path in ("/api/v1/__test/seed/owned", "/api/v1/__test/seed/owned-cleanup"):
        route = next(
            route for route in app_module.routes if getattr(route, "path", None) == path
        )
        assert route.include_in_schema is False
        assert path not in app_module.openapi()["paths"]
