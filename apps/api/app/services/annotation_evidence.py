"""Increment A2 · durable annotation-phase contributor evidence.

The project-scoped employee roles plan needs a trustworthy record of *who*
contributed annotation-phase work to a task before any project-role model can
use that record for self-review.  This module owns the only writer of the
additive task fields introduced by the A1 schema revision:

* ``Task.annotation_contributor_ids`` — accumulated annotation-phase actors.
  ``None`` means completeness is **unknown** (legacy rows created before the
  recording binary, or a rolled-back recording interval).  ``[]`` means a
  known-empty set for a task created by the recording binary.  Any other list
  is the accumulated actor set.
* ``Task.review_contributor_ids`` — the contributor set frozen for the current
  ``review_round_id`` at submit/skip/batch-send/video completion.
* ``Task.review_submitter_id`` — the actor who actually submitted that round.

Recording is strictly additive in this increment: it never grants or denies
authorization, and it never changes first-review performance facts.

Unknown is sticky.  A later edit on a legacy task whose accumulator is ``NULL``
must not narrow it to a known set containing only the new actor, because the
missing history would be silently treated as complete.  Malformed evidence
(any non-list value, or a list containing a non-canonical user id) is treated
as unknown too, never silently dropped.

Task-first locking
------------------

Every function that mutates a task row here takes that row lock.  Producers
must call :func:`record_annotation_actor` (or
:func:`record_annotation_actors_for_tasks`) **before** they take an Annotation
or SceneTrack row lock, because the existing writers already order
``Task -> Annotation``.  Recording first keeps the acquisition order uniform;
a failed transaction rolls the evidence update back with the mutation that
failed.  Where a producer instead records after the mutation, the task must
already be locked first (for example the single-task PATCH/DELETE endpoints).
:func:`lock_tasks_for_evidence` exists for paths that take resource locks in
preparation and need the task rows locked first.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.task import Task


def canonical_actor_id(value: object) -> str | None:
    """Return the canonical (lowercase) UUID string for a stored actor id.

    ``None`` means the value is not a usable user id.  Callers treat an invalid
    element as evidence corruption, not as an actor to skip.
    """
    if isinstance(value, uuid.UUID):
        return str(value)
    if not isinstance(value, str):
        return None
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        return None


def known_annotation_contributor_ids(task: Task) -> set[str] | None:
    """Return the accumulated actor set, or ``None`` when completeness is unknown.

    A malformed list (non-array, ``null``/empty element, or an element that is
    not a UUID) is unknown: evidence is never silently narrowed.
    """
    values = task.annotation_contributor_ids
    if not isinstance(values, list):
        return None
    canonical: set[str] = set()
    for value in values:
        parsed = canonical_actor_id(value)
        if parsed is None:
            return None
        canonical.add(parsed)
    return canonical


async def lock_tasks_for_evidence(
    db: AsyncSession, task_ids: Iterable[uuid.UUID | None]
) -> None:
    """Acquire task row locks in stable id order before resource locks.

    Call this from producers that take Annotation/SceneTrack locks while
    preparing a mutation; it keeps the global ``Task -> Annotation`` order even
    when the affected task set is only known after preparation.
    """
    ids = sorted({task_id for task_id in task_ids if task_id is not None}, key=str)
    if not ids:
        return
    await db.execute(
        select(Task.id).where(Task.id.in_(ids)).order_by(Task.id).with_for_update()
    )


async def refresh_task_evidence(db: AsyncSession, task: Task) -> None:
    """Lock the task row and refresh the evidence-relevant attributes.

    Callers that must freeze/clear evidence under the same task lock as a
    workflow transition use this to avoid trusting a stale in-memory row.
    Pending session changes are flushed first: ``Session.refresh`` expires the
    target attributes before its autoflush and would otherwise discard them.
    """
    await db.flush()
    await db.refresh(
        task,
        ["annotation_contributor_ids", "status"],
        with_for_update=True,
    )


async def record_annotation_actor(
    db: AsyncSession,
    task: Task,
    actor_id: uuid.UUID | None,
    *,
    lock: bool = True,
) -> bool:
    """Accumulate one annotation-phase actor on ``task``.

    Returns ``True`` when the stored accumulator changed.  ``actor_id`` is the
    acting user, not the original ``Annotation.user_id`` of a mutated row.

    When ``lock`` is true the task row is locked and both the accumulator and
    the workflow phase are re-read under that lock.  Pending session changes are
    flushed first because ``Session.refresh`` expires the target attributes
    before its autoflush and would otherwise discard an earlier accumulator
    addition from the same transaction.

    No-op for a ``None``/malformed actor, a ``NULL`` (unknown) or malformed
    accumulator: unknown evidence stays unknown.

    A write while the fresh locked phase is ``review`` is a review-phase
    adjustment (the annotation endpoints only admit reviewers and privileged
    managers in that state), so it must not turn the reviewer into an
    annotation author.
    """
    actor = canonical_actor_id(actor_id)
    if actor is None:
        return False
    if lock:
        await refresh_task_evidence(db, task)
    if task.status == "review":
        return False
    current = known_annotation_contributor_ids(task)
    if current is None:
        return False
    if actor in current:
        return False
    current.add(actor)
    task.annotation_contributor_ids = sorted(current)
    return True


async def record_annotation_actor_for_task(
    db: AsyncSession,
    task_id: uuid.UUID,
    actor_id: uuid.UUID | None,
) -> bool:
    """Accumulate ``actor_id`` on a task addressed by id, locking it first."""
    if canonical_actor_id(actor_id) is None:
        return False
    task = await db.get(Task, task_id)
    if task is None:
        return False
    return await record_annotation_actor(db, task, actor_id, lock=True)


async def record_annotation_actors_for_tasks(
    db: AsyncSession,
    task_ids: Iterable[uuid.UUID],
    actor_id: uuid.UUID | None,
) -> set[uuid.UUID]:
    """Accumulate one actor across distinct tasks in stable id order.

    Sorting keeps the per-task row-lock acquisition order deterministic, so two
    multi-task producers cannot deadlock against each other merely by ordering.
    Returns the distinct task ids that were touched.
    """
    touched: set[uuid.UUID] = set()
    for task_id in sorted(set(task_ids), key=str):
        await record_annotation_actor_for_task(db, task_id, actor_id)
        touched.add(task_id)
    return touched


def freeze_review_contributor_evidence(
    task: Task,
    *,
    submitter_id: uuid.UUID | None,
    contributor_ids: Iterable[str] = (),
) -> list[str] | None:
    """Freeze the current round's contributor evidence on the task row.

    The frozen set is the accumulated annotation contributors plus the surviving
    annotation authors, the effective annotation assignee and the actual
    submitter.  Returns the frozen list, or ``None`` when the accumulator is
    unknown — a known review set is never manufactured from an unknown
    accumulator.  Any malformed freeze input makes the round evidence unknown
    rather than silently dropping that actor.  ``review_submitter_id`` is
    recorded only when it is a canonical user id.
    """
    submitter = canonical_actor_id(submitter_id)
    task.review_submitter_id = submitter
    if submitter_id is not None and submitter is None:
        task.review_contributor_ids = None
        return None
    accumulator = known_annotation_contributor_ids(task)
    if accumulator is None:
        task.review_contributor_ids = None
        return None
    frozen = set(accumulator)
    for value in contributor_ids:
        parsed = canonical_actor_id(value)
        if parsed is None:
            task.review_contributor_ids = None
            return None
        frozen.add(parsed)
    if submitter is not None:
        frozen.add(submitter)
    task.review_contributor_ids = sorted(frozen)
    return task.review_contributor_ids


def clear_review_contributor_evidence(task: Task) -> None:
    """Invalidate the current round's frozen evidence when a task leaves review.

    The annotation contributor accumulator is deliberately retained: an actor
    who ever contributed stays disqualified for the task even after a reset,
    reassignment, rejection or reopen.
    """
    task.review_contributor_ids = None
    task.review_submitter_id = None
