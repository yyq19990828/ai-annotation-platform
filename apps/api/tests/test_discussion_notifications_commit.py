"""Real-commit notification transport ordering regression.

This test is intentionally guarded to the separately owned notification commit
database.  The normal ``db_session`` fixture is SAVEPOINT-bound and cannot prove
visibility from a second PostgreSQL connection.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import delete, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.models.notification import Notification
from app.db.models.user import User
from app.services.notification import NotificationService


_OWNED_DATABASE = "annotation_discussion_260911_notifications_commit_test"


@pytest.mark.asyncio
async def test_real_commit_precedes_publish_and_redis_failure_is_nonfatal(
    test_db_url, monkeypatch
):
    parsed_url = make_url(test_db_url)
    if parsed_url.database != _OWNED_DATABASE:
        pytest.skip("requires the separately owned notification commit database")

    # This test owns the empty database's migration lifecycle; it deliberately
    # avoids the SAVEPOINT fixture so a second connection can observe commits.
    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)
    # Alembic's async env uses ``asyncio.run``; run it in a worker thread so
    # it does not collide with pytest's event loop.
    await asyncio.to_thread(command.upgrade, alembic_cfg, "head")

    engine = create_async_engine(test_db_url, echo=False)
    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    user_id = uuid.uuid4()
    notification_ids: list[uuid.UUID] = []
    publish_calls: list[dict] = []
    visible_during_publish: list[bool] = []

    async def fake_publish(*, user_id, message):
        publish_calls.append(message)
        async with session_factory() as reader:
            row = await reader.get(Notification, uuid.UUID(message["id"]))
            visible_during_publish.append(row is not None)
        if len(publish_calls) == 2:
            raise RuntimeError("redis unavailable after commit")

    monkeypatch.setattr("app.services.notification._publish", fake_publish)
    try:
        async with session_factory() as writer:
            writer.add(
                User(
                    id=user_id,
                    email=f"n1-commit-{user_id.hex}@test.local",
                    name="N1 commit test",
                    password_hash="not-used",
                    role="super_admin",
                    is_active=True,
                )
            )
            await writer.flush()
            service = NotificationService(writer)

            first = await service.notify(
                user_id=user_id,
                type="feedback.reply_created",
                target_type="feedback",
                target_id=uuid.uuid4(),
                payload={"source": "feedback"},
                defer_publish=True,
            )
            assert first is not None
            notification_ids.append(first.id)
            assert publish_calls == []
            await writer.commit()

            # The independent reader in fake_publish sees this row, proving the
            # route-level ordering is commit -> publish rather than publish -> commit.
            await service.publish_committed([first])

            second = await service.notify(
                user_id=user_id,
                type="feedback.status_changed",
                target_type="feedback",
                target_id=uuid.uuid4(),
                payload={"source": "feedback"},
                defer_publish=True,
            )
            assert second is not None
            notification_ids.append(second.id)
            await writer.commit()
            # Redis failure is swallowed by publish_committed after the durable commit.
            await service.publish_committed([second])

            rolled_back = await service.notify(
                user_id=user_id,
                type="annotation.comment_mentioned",
                target_type="annotation_comment",
                target_id=uuid.uuid4(),
                payload={"source": "annotation_comment"},
                defer_publish=True,
            )
            assert rolled_back is not None
            rolled_back_id = rolled_back.id
            await writer.rollback()

        assert len(publish_calls) == 2
        assert visible_during_publish == [True, True]

        async with session_factory() as reader:
            persisted = await reader.execute(
                select(Notification).where(Notification.id.in_(notification_ids))
            )
            assert {row.id for row in persisted.scalars()} == set(notification_ids)
            assert await reader.get(Notification, rolled_back_id) is None
    finally:
        async with session_factory() as cleaner:
            if notification_ids:
                await cleaner.execute(
                    delete(Notification).where(Notification.id.in_(notification_ids))
                )
            await cleaner.execute(delete(User).where(User.id == user_id))
            await cleaner.commit()
        await engine.dispose()
