"""Increment A2 · durable annotation-phase contributor evidence.

The project-scoped employee roles plan needs a trustworthy record of *who*
contributed annotation-phase work to a task before any project-role model can
use that record for self-review.  This module owns the only writer of the
additive task fields introduced by the A1 schema revision:

* ``Task.annotation_contributor_ids`` — accumulated annotation-phase actors.
  ``None`` means completeness is **unknown** (legacy rows created before the
  recording binary, or a rolled-back recording interval).  ``[]`` means a
  known-empty set for a task created after every producer recorded.  Any other
  list is the accumulated actor set.
* ``Task.review_contributor_ids`` — the contributor set frozen for the current
  ``review_round_id`` at submit/skip/batch-send/video completion.
* ``Task.review_submitter_id`` — the actor who actually submitted that round.

Recording is strictly additive in this increment: it never grants or denies
authorization, and it never changes first-review performance facts.

Unknown is sticky.  A later edit on a legacy task whose accumulator is ``NULL``
must not narrow it to a known set containing only the new actor, because the
missing history would be silently treated as complete.  Unknown and malformed
values stay unknown.

The accumulator update is a read-modify-write under a task row lock so two
concurrent producers on the same task cannot lose each other's actor.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.task import Task


def new_task_annotation_contributors() -> list[str]:
    """Return the known-empty accumulator for a newly created task.

    Only tasks created by this recording binary use this value; the database
    column has no default, so an old binary or a pre-recording row stays
    ``NULL`` (unknown).
    """
    return []


def known_annotation_contributor_ids(task: Task) -> set[str] | None:
    """Return the accumulated actor set, or ``None`` when completeness is unknown."""
    values = task.annotation_contributor_ids
    if not isinstance(values, list):
        return None
    return {str(value) for value in values if value}


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
    When ``lock`` is true the task row is re-read under ``FOR UPDATE`` first, so
    the read-modify-write is serialized with concurrent producers.

    No-op for a ``None`` actor, a ``NULL`` (unknown) accumulator, or a
    malformed non-array value: unknown evidence stays unknown.

    A write while the task is in ``review`` is a review-phase adjustment (the
    annotation endpoints only admit reviewers and privileged managers in that
    state), so it must not turn the reviewer into an annotation author.
    """
    if actor_id is None:
        return False
    if task.status == "review":
        return False
    if lock:
        await db.refresh(task, ["annotation_contributor_ids"], with_for_update=True)
    current = task.annotation_contributor_ids
    if current is None or not isinstance(current, list):
        return False
    actor = str(actor_id)
    normalized = {str(value) for value in current if value}
    if actor in normalized:
        return False
    normalized.add(actor)
    task.annotation_contributor_ids = sorted(normalized)
    return True


async def record_annotation_actor_for_task(
    db: AsyncSession,
    task_id: uuid.UUID,
    actor_id: uuid.UUID | None,
) -> bool:
    """Accumulate ``actor_id`` on a task addressed by id, locking it first.

    The attribute-scoped refresh in :func:`record_annotation_actor` re-reads and
    locks only ``annotation_contributor_ids``, so a task with unrelated pending
    changes in this transaction is not clobbered by ``populate_existing``.
    """
    if actor_id is None:
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
    accumulator.  ``review_submitter_id`` is still recorded, because the actor
    is a known fact even when contributor completeness is not.
    """
    task.review_submitter_id = submitter_id
    accumulator = known_annotation_contributor_ids(task)
    if accumulator is None:
        task.review_contributor_ids = None
        return None
    frozen = set(accumulator)
    for value in contributor_ids:
        if value:
            frozen.add(str(value))
    if submitter_id is not None:
        frozen.add(str(submitter_id))
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
