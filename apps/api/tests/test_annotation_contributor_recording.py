"""A2 · annotation-phase contributor evidence across real producers (DB-backed).

Each test drives one producer through the public service/HTTP boundary and
asserts the acting user was accumulated on the task.  The pure sticky-unknown
semantics live in ``test_annotation_evidence.py``; first-review performance
attribution must stay unchanged (asserted in the submit/skip cases).

These tests require the isolated PostgreSQL test database described in
``tests/conftest.py``.
"""

from __future__ import annotations

import uuid

import pytest

from app.db.models.prediction import Prediction
from app.db.models.project_member import ProjectMember
from app.services.annotation_slice import AnnotationSliceService
from tests.factory import create_project, create_task, create_user

pytestmark = pytest.mark.asyncio


def _bearer(token: str, **extra: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", **extra}


def _token_for(user, role: str = "super_admin") -> str:
    from app.core.security import create_access_token

    return create_access_token(subject=str(user.id), role=role)


def _bbox_payload(class_name: str = "car") -> dict:
    return {
        "annotation_type": "bbox",
        "class_name": class_name,
        "geometry": {"type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
    }


async def _seed_task(db, owner, *, accumulator="empty", status="in_progress"):
    project = await create_project(db, owner_id=owner.id)
    task = await create_task(db, project_id=project.id, status=status)
    task.annotation_contributor_ids = [] if accumulator == "empty" else None
    await db.flush()
    return project, task


async def _second_editor(db, *, email: str):
    """A second privileged actor so accumulation is observable across requests."""
    return await create_user(db, "super_admin", email, "Second Editor")


# ── direct annotation API ────────────────────────────────────────────


async def test_create_records_actor_on_known_accumulator(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    _, task = await _seed_task(db_session, user)

    resp = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_bbox_payload(),
        headers=_bearer(token),
    )
    assert resp.status_code == 201, resp.text

    await db_session.refresh(task)
    assert task.annotation_contributor_ids == [str(user.id)]


async def test_create_on_legacy_null_stays_unknown(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    _, task = await _seed_task(db_session, user, accumulator="unknown")

    resp = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_bbox_payload(),
        headers=_bearer(token),
    )
    assert resp.status_code == 201, resp.text

    await db_session.refresh(task)
    assert task.annotation_contributor_ids is None


async def test_update_records_the_editing_actor(httpx_client, db_session, super_admin):
    owner, owner_token = super_admin
    editor = await _second_editor(db_session, email="patch-editor@test.local")
    editor_token = _token_for(editor)
    _project, task = await _seed_task(db_session, owner)

    created = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_bbox_payload(),
        headers=_bearer(owner_token),
    )
    assert created.status_code == 201, created.text
    annotation_id = created.json()["id"]

    patched = await httpx_client.patch(
        f"/api/v1/tasks/{task.id}/annotations/{annotation_id}",
        json={"attributes": {"reviewed": True}},
        headers=_bearer(editor_token),
    )
    assert patched.status_code == 200, patched.text

    await db_session.refresh(task)
    assert task.annotation_contributor_ids == sorted([str(owner.id), str(editor.id)])


async def test_delete_records_the_deleting_actor_and_retains_authors(
    httpx_client, db_session, super_admin
):
    owner, owner_token = super_admin
    editor = await _second_editor(db_session, email="delete-editor@test.local")
    editor_token = _token_for(editor)
    _project, task = await _seed_task(db_session, owner)

    created = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_bbox_payload(),
        headers=_bearer(owner_token),
    )
    assert created.status_code == 201, created.text
    annotation_id = created.json()["id"]

    deleted = await httpx_client.delete(
        f"/api/v1/tasks/{task.id}/annotations/{annotation_id}",
        headers=_bearer(editor_token),
    )
    assert deleted.status_code == 204, deleted.text

    await db_session.refresh(task)
    # Conservative: the deleted annotation's author stays an accumulator member.
    assert task.annotation_contributor_ids == sorted([str(owner.id), str(editor.id)])


# ── submit / skip freeze and lifecycle invalidation ──────────────────


async def test_submit_freezes_round_evidence_without_changing_first_review(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    _, task = await _seed_task(db_session, user)
    task.assignee_id = user.id
    await db_session.flush()

    created = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_bbox_payload(),
        headers=_bearer(token),
    )
    assert created.status_code == 201, created.text

    resp = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/submit", headers=_bearer(token)
    )
    assert resp.status_code == 200, resp.text

    await db_session.refresh(task)
    assert task.status == "review"
    assert task.review_round_id is not None
    assert task.review_submitter_id == user.id
    assert task.review_contributor_ids == [str(user.id)]
    # First-review performance facts are unchanged.
    assert task.first_review_contributor_ids == [str(user.id)]


async def test_skip_freezes_round_evidence(httpx_client, db_session, super_admin):
    user, token = super_admin
    _, task = await _seed_task(db_session, user, status="pending")
    task.assignee_id = user.id
    await db_session.flush()

    resp = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/skip",
        json={"reason": "no_target"},
        headers=_bearer(token),
    )
    assert resp.status_code == 200, resp.text

    await db_session.refresh(task)
    assert task.review_round_id is not None
    assert task.review_submitter_id == user.id
    assert task.review_contributor_ids == [str(user.id)]
    assert task.first_review_contributor_ids == [str(user.id)]


async def test_review_adjustment_does_not_add_reviewer_as_contributor(
    httpx_client, db_session, super_admin
):
    owner, owner_token = super_admin
    reviewer = await create_user(
        db_session, "reviewer", "review-edit@test.local", "Reviewer"
    )
    reviewer_token = _token_for(reviewer, role="reviewer")
    project, task = await _seed_task(db_session, owner)
    task.assignee_id = owner.id
    db_session.add(
        ProjectMember(project_id=project.id, user_id=reviewer.id, role="reviewer")
    )
    await db_session.flush()

    created = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_bbox_payload(),
        headers=_bearer(owner_token),
    )
    assert created.status_code == 201, created.text
    annotation_id = created.json()["id"]

    submitted = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/submit", headers=_bearer(owner_token)
    )
    assert submitted.status_code == 200, submitted.text

    task.reviewer_id = reviewer.id
    await db_session.flush()
    adjusted = await httpx_client.patch(
        f"/api/v1/tasks/{task.id}/annotations/{annotation_id}",
        json={"attributes": {"qc_adjusted": True}},
        headers=_bearer(reviewer_token),
    )
    assert adjusted.status_code == 200, adjusted.text

    await db_session.refresh(task)
    assert task.annotation_contributor_ids == [str(owner.id)]
    assert str(reviewer.id) not in (task.annotation_contributor_ids or [])


async def test_withdraw_invalidates_round_but_retains_accumulator(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    _, task = await _seed_task(db_session, user)
    task.assignee_id = user.id
    await db_session.flush()
    await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_bbox_payload(),
        headers=_bearer(token),
    )
    submitted = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/submit", headers=_bearer(token)
    )
    assert submitted.status_code == 200, submitted.text

    withdrawn = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/withdraw", headers=_bearer(token)
    )
    assert withdrawn.status_code == 200, withdrawn.text

    await db_session.refresh(task)
    assert task.status == "in_progress"
    assert task.review_contributor_ids is None
    assert task.review_submitter_id is None
    assert task.annotation_contributor_ids == [str(user.id)]


# ── AI acceptance and import side routes ─────────────────────────────


async def test_accept_prediction_records_actor(httpx_client, db_session, super_admin):
    owner, token = super_admin
    project, task = await _seed_task(db_session, owner, status="pending")
    prediction = Prediction(
        id=uuid.uuid4(),
        task_id=task.id,
        project_id=project.id,
        ml_backend_id=None,
        model_version="test",
        score=0.9,
        result=[
            {
                "type": "rectanglelabels",
                "value": {
                    "x": 0,
                    "y": 0,
                    "width": 10,
                    "height": 10,
                    "rectanglelabels": ["car"],
                },
                "score": 0.9,
            }
        ],
    )
    db_session.add(prediction)
    await db_session.commit()

    resp = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/predictions/{prediction.id}/accept?shape_index=0",
        headers=_bearer(token),
    )
    assert resp.status_code == 200, resp.text

    await db_session.refresh(task)
    assert task.annotation_contributor_ids == [str(owner.id)]


async def test_aap_import_records_operator(db_session, super_admin):
    from tests.test_annotations_import import (
        _aap_envelope,
        _ann_entry,
        _seed_project_with_tasks,
    )

    operator, _ = super_admin
    project, tasks = await _seed_project_with_tasks(db_session, operator.id, n_tasks=1)
    tasks[0].annotation_contributor_ids = []
    await db_session.flush()
    envelope = _aap_envelope(
        [
            {
                "task_match": {"display_id": tasks[0].display_id},
                "annotations": [
                    _ann_entry(
                        geometry={
                            "type": "bbox",
                            "x": 0.1,
                            "y": 0.1,
                            "w": 0.2,
                            "h": 0.2,
                        }
                    )
                ],
            }
        ]
    )

    from app.services.annotations_import import import_aap_json_annotations

    result = await import_aap_json_annotations(
        db_session,
        project.id,
        envelope,
        operator_user_id=operator.id,
    )
    assert result.imported == 1, result.errors

    await db_session.refresh(tasks[0])
    assert tasks[0].annotation_contributor_ids == [str(operator.id)]


# ── undo / restore side route ────────────────────────────────────────


async def test_slice_commit_and_restore_record_the_actor(db_session, super_admin):
    from tests.test_annotation_slices import _payload, _restore, _seed

    owner, _ = super_admin
    editor = await create_user(
        db_session, "super_admin", "slice-editor@test.local", "Slice Editor"
    )
    task, source, _parent = await _seed(db_session, owner)
    task.annotation_contributor_ids = []
    await db_session.flush()

    service = AnnotationSliceService(db_session)
    committed = await service.commit(task.id, _payload(source), owner)
    await db_session.flush()

    await db_session.refresh(task)
    assert task.annotation_contributor_ids == [str(owner.id)]

    restore_payload = _restore(committed)
    await service.restore(
        task.id, committed.slice_operation_id, restore_payload, editor
    )
    await db_session.flush()

    await db_session.refresh(task)
    assert task.annotation_contributor_ids == sorted([str(owner.id), str(editor.id)])
