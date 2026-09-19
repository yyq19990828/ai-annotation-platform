"""Unit tests for the A2 annotation-phase contributor evidence helpers.

These exercise the pure/sticky-unknown semantics without a database.  The
database-backed producer coverage lives in
``test_annotation_contributor_recording.py``.
"""

from __future__ import annotations

import uuid

import pytest

from app.db.models.task import Task
from app.services import annotation_evidence as evidence


class _StubSession:
    """Minimal AsyncSession stand-in recording ``refresh`` under lock."""

    def __init__(self) -> None:
        self.refreshed: list[tuple[Task, tuple[str, ...], bool | None]] = []

    async def refresh(self, instance, attribute_names=None, with_for_update=None):
        self.refreshed.append((instance, tuple(attribute_names or ()), with_for_update))


def _task(**kwargs) -> Task:
    task = Task()
    for key, value in kwargs.items():
        setattr(task, key, value)
    return task


@pytest.mark.asyncio
async def test_record_accumulates_actor_under_lock_on_known_accumulator():
    actor = uuid.uuid4()
    task = _task(annotation_contributor_ids=[])
    db = _StubSession()

    changed = await evidence.record_annotation_actor(db, task, actor)

    assert changed is True
    assert task.annotation_contributor_ids == [str(actor)]
    assert db.refreshed == [(task, ("annotation_contributor_ids",), True)]


@pytest.mark.asyncio
async def test_record_deduplicates_existing_actor():
    actor = uuid.uuid4()
    task = _task(annotation_contributor_ids=[str(actor)])

    changed = await evidence.record_annotation_actor(
        _StubSession(), task, actor, lock=False
    )

    assert changed is False
    assert task.annotation_contributor_ids == [str(actor)]


@pytest.mark.asyncio
async def test_record_unions_and_sorts_multiple_actors():
    first, second = uuid.uuid4(), uuid.uuid4()
    task = _task(annotation_contributor_ids=[str(second)])
    db = _StubSession()

    await evidence.record_annotation_actor(db, task, first)

    assert task.annotation_contributor_ids == sorted([str(first), str(second)])


@pytest.mark.asyncio
async def test_legacy_null_accumulator_stays_unknown():
    task = _task(annotation_contributor_ids=None)

    changed = await evidence.record_annotation_actor(
        _StubSession(), task, uuid.uuid4(), lock=False
    )

    assert changed is False
    assert task.annotation_contributor_ids is None


@pytest.mark.asyncio
async def test_malformed_accumulator_stays_unknown():
    task = _task(annotation_contributor_ids={"unexpected": "shape"})

    changed = await evidence.record_annotation_actor(
        _StubSession(), task, uuid.uuid4(), lock=False
    )

    assert changed is False
    assert task.annotation_contributor_ids == {"unexpected": "shape"}


@pytest.mark.asyncio
async def test_missing_actor_is_noop():
    task = _task(annotation_contributor_ids=[])

    changed = await evidence.record_annotation_actor(
        _StubSession(), task, None, lock=False
    )

    assert changed is False
    assert task.annotation_contributor_ids == []


def test_new_task_starts_known_empty():
    assert evidence.new_task_annotation_contributors() == []


@pytest.mark.asyncio
async def test_review_phase_adjustment_does_not_add_reviewer():
    task = _task(status="review", annotation_contributor_ids=[])

    changed = await evidence.record_annotation_actor(
        _StubSession(), task, uuid.uuid4(), lock=False
    )

    assert changed is False
    assert task.annotation_contributor_ids == []


@pytest.mark.asyncio
async def test_freeze_known_accumulator_includes_submitter_and_assignee():
    actor, assignee, prior = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    task = _task(annotation_contributor_ids=[str(prior)])

    frozen = evidence.freeze_review_contributor_evidence(
        task,
        submitter_id=actor,
        contributor_ids=[str(assignee), str(prior)],
    )

    assert frozen == sorted([str(actor), str(assignee), str(prior)])
    assert task.review_contributor_ids == frozen
    assert task.review_submitter_id == actor


@pytest.mark.asyncio
async def test_freeze_unknown_accumulator_does_not_manufacture_known_set():
    actor = uuid.uuid4()
    task = _task(annotation_contributor_ids=None)

    frozen = evidence.freeze_review_contributor_evidence(
        task, submitter_id=actor, contributor_ids=[str(actor)]
    )

    assert frozen is None
    assert task.review_contributor_ids is None
    assert task.review_submitter_id == actor


@pytest.mark.asyncio
async def test_freeze_empty_accumulator_keeps_submitter_only():
    actor = uuid.uuid4()
    task = _task(annotation_contributor_ids=[])

    frozen = evidence.freeze_review_contributor_evidence(
        task, submitter_id=actor, contributor_ids=[]
    )

    assert frozen == [str(actor)]


def test_clear_invalidates_round_but_retains_accumulator():
    task = _task(
        annotation_contributor_ids=["keep-me"],
        review_contributor_ids=["round"],
        review_submitter_id=uuid.uuid4(),
    )

    evidence.clear_review_contributor_evidence(task)

    assert task.review_contributor_ids is None
    assert task.review_submitter_id is None
    assert task.annotation_contributor_ids == ["keep-me"]


def test_known_annotation_contributor_ids_reads_arrays_only():
    assert (
        evidence.known_annotation_contributor_ids(_task(annotation_contributor_ids=[]))
        == set()
    )
    assert evidence.known_annotation_contributor_ids(
        _task(annotation_contributor_ids=["a", "b"])
    ) == {"a", "b"}
    assert (
        evidence.known_annotation_contributor_ids(
            _task(annotation_contributor_ids=None)
        )
        is None
    )
    assert (
        evidence.known_annotation_contributor_ids(
            _task(annotation_contributor_ids="not-a-list")
        )
        is None
    )
