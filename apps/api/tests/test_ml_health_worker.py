"""v0.8.6 F2 · ML Backend 周期健康检查 worker 单测。

覆盖：
- `MLBackendService.check_health` 写入 `last_checked_at` + 更新 `state`
- worker `check_all_backends` 遍历所有 backend、单个失败不阻断其他
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project
from app.services.ml_backend import MLBackendService


async def _make_project(db: AsyncSession, owner_id: uuid.UUID) -> Project:
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-{suffix}",
        name=f"p-{suffix}",
        type_label="image-det",
        type_key="image-det",
        owner_id=owner_id,
        status="in_progress",
    )
    db.add(proj)
    await db.flush()
    return proj


async def _make_backend(
    db: AsyncSession, project_id: uuid.UUID, url: str = "http://example/"
) -> MLBackend:
    backend = MLBackend(
        id=uuid.uuid4(),
        project_id=project_id,
        name="test-backend",
        url=url,
        state="disconnected",
        is_interactive=True,
    )
    db.add(backend)
    await db.flush()
    return backend


async def test_check_health_updates_last_checked_at(
    db_session: AsyncSession, monkeypatch, super_admin
):
    user, _ = super_admin
    proj = await _make_project(db_session, user.id)
    backend = await _make_backend(db_session, proj.id)

    async def fake_health(self) -> bool:  # noqa: ARG001
        return True

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.health", fake_health, raising=True
    )

    svc = MLBackendService(db_session)
    before = datetime.now(timezone.utc)
    healthy = await svc.check_health(backend.id)
    await db_session.flush()

    assert healthy is True
    fresh = await svc.get(backend.id)
    assert fresh is not None
    assert fresh.state == "connected"
    assert fresh.last_checked_at is not None
    assert fresh.last_checked_at >= before


async def test_check_health_marks_error_on_failure(
    db_session: AsyncSession, monkeypatch, super_admin
):
    user, _ = super_admin
    proj = await _make_project(db_session, user.id)
    backend = await _make_backend(db_session, proj.id)

    async def fake_health(self) -> bool:  # noqa: ARG001
        return False

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.health", fake_health, raising=True
    )

    svc = MLBackendService(db_session)
    healthy = await svc.check_health(backend.id)

    assert healthy is False
    fresh = await svc.get(backend.id)
    assert fresh.state == "error"
    assert fresh.last_checked_at is not None


async def test_check_health_returns_false_for_missing_backend(
    db_session: AsyncSession,
):
    svc = MLBackendService(db_session)
    assert await svc.check_health(uuid.uuid4()) is False


def test_worker_module_imports_and_registers_task():
    """worker 模块能 import；celery_app.tasks 注册了周期任务名。"""
    from app.workers import ml_health
    from app.workers.celery_app import celery_app

    assert hasattr(ml_health, "check_ml_backends_health")
    assert "app.workers.ml_health.check_ml_backends_health" in celery_app.tasks
    assert "check-ml-backends-health" in celery_app.conf.beat_schedule


@pytest.mark.parametrize("jitter", [0.0])
async def test_check_all_backends_iterates_without_jitter(monkeypatch, jitter):
    """jitter=0 时 worker 不 sleep；遍历所有 backend，逐个调用 check_health。

    用 monkeypatch 替换 async_session + service 以绕开 DB（保持快速 + 与 conftest 不耦合）。
    """
    from app.workers import ml_health

    fake_ids = [uuid.uuid4() for _ in range(3)]
    call_log: list[uuid.UUID] = []

    class _StubResult:
        def __init__(self, ids):
            self._ids = ids

        def scalars(self):
            class _Scalars:
                def __init__(self, ids):
                    self._ids = ids

                def all(self):
                    return self._ids

            return _Scalars(self._ids)

    class _FakeSession:
        async def execute(self, stmt):  # noqa: ARG002
            return _StubResult(fake_ids)

        async def commit(self):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    def _factory():
        return _FakeSession()

    class _FakeBackend:
        state = "connected"

    class _FakeService:
        def __init__(self, db):  # noqa: ARG002
            pass

        async def check_health(self, bid):
            call_log.append(bid)
            return True

        async def get(self, bid):  # noqa: ARG002
            return _FakeBackend()

    monkeypatch.setattr(ml_health, "async_session", _factory)
    monkeypatch.setattr(ml_health, "MLBackendService", _FakeService)

    result = await ml_health.check_all_backends(jitter_max_seconds=jitter)

    assert result["checked"] == 3
    assert call_log == fake_ids
    assert all(r["healthy"] is True for r in result["results"])


async def test_check_all_backends_isolates_per_backend_failure(monkeypatch):
    """单个 backend 抛错不阻断其他。"""
    from app.workers import ml_health

    fake_ids = [uuid.uuid4() for _ in range(3)]

    class _StubResult:
        def scalars(self):
            class _S:
                def all(self_inner):
                    return fake_ids

            return _S()

    class _FakeSession:
        async def execute(self, stmt):  # noqa: ARG002
            return _StubResult()

        async def commit(self):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(ml_health, "async_session", lambda: _FakeSession())

    class _FakeService:
        def __init__(self, db):  # noqa: ARG002
            pass

        async def check_health(self, bid):
            if bid == fake_ids[1]:
                raise RuntimeError("middle backend boom")
            return True

        async def get(self, bid):  # noqa: ARG002
            class _B:
                state = "connected"

            return _B()

    monkeypatch.setattr(ml_health, "MLBackendService", _FakeService)

    result = await ml_health.check_all_backends(jitter_max_seconds=0.0)

    assert result["checked"] == 3
    healthy_ids = [r["id"] for r in result["results"] if r["healthy"]]
    error_ids = [r["id"] for r in result["results"] if not r["healthy"]]
    assert len(healthy_ids) == 2
    assert len(error_ids) == 1
    assert error_ids[0] == str(fake_ids[1])
