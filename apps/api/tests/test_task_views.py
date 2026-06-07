from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation_feedback import AnnotationFeedback
from app.db.models.prediction import Prediction
from app.db.models.project_member import ProjectMember
from tests.factory import create_batch, create_project, create_task

pytestmark = pytest.mark.asyncio


async def _seed_project(db: AsyncSession, owner_id):
    project = await create_project(db, owner_id=owner_id, type_key="image-det")
    task_a = await create_task(db, project_id=project.id, display_id="T-DM-A")
    task_b = await create_task(db, project_id=project.id, display_id="T-DM-B")
    await db.flush()
    return project, task_a, task_b


async def test_tasks_query_rejects_unknown_filter_field(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project, _, _ = await _seed_project(db_session, owner.id)

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "op": "and",
                "rules": [{"field": "task.raw_sql", "op": "eq", "value": "1=1"}],
            }
        },
    )
    assert r.status_code == 422
    assert "Unsupported filter field" in r.text


async def test_tasks_query_filters_unresolved_feedback_count(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project, task_a, task_b = await _seed_project(db_session, owner.id)
    db_session.add(
        AnnotationFeedback(
            kind="issue",
            anchor_type="task",
            project_id=project.id,
            task_id=task_b.id,
            status="open",
            severity="warn",
            body="needs review",
            author_id=owner.id,
        )
    )
    await db_session.flush()

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "op": "and",
                "rules": [
                    {"field": "feedback.unresolved_count", "op": "gt", "value": 0}
                ],
            }
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [item["id"] for item in body["items"]] == [str(task_b.id)]
    assert body["items"][0]["unresolved_feedback_count"] == 1
    assert str(task_a.id) not in [item["id"] for item in body["items"]]


async def test_tasks_query_filters_prediction_model_version(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project, task_a, task_b = await _seed_project(db_session, owner.id)
    task_a.total_predictions = 1
    task_b.total_predictions = 1
    db_session.add_all(
        [
            Prediction(
                task_id=task_a.id,
                project_id=project.id,
                model_version="sam3-v1",
                score=0.42,
                result={"type": "rectanglelabels", "value": {}},
            ),
            Prediction(
                task_id=task_b.id,
                project_id=project.id,
                model_version="other",
                score=0.95,
                result={"type": "rectanglelabels", "value": {}},
            ),
        ]
    )
    await db_session.flush()

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "op": "and",
                "rules": [
                    {
                        "field": "prediction.model_version",
                        "op": "eq",
                        "value": "sam3-v1",
                    }
                ],
            },
            "sort_json": [{"field": "avg_prediction_confidence", "direction": "asc"}],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [item["id"] for item in body["items"]] == [str(task_a.id)]
    assert body["items"][0]["avg_prediction_confidence"] == 0.42
    assert body["items"][0]["model_versions"] == ["sam3-v1"]


async def test_tasks_query_rejects_oversized_in_list(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project, _, _ = await _seed_project(db_session, owner.id)

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "op": "and",
                "rules": [
                    {
                        "field": "task.status",
                        "op": "in",
                        "value": [f"s{i}" for i in range(201)],
                    }
                ],
            }
        },
    )
    assert r.status_code == 422
    assert "in value too long" in r.text


async def test_task_views_list_reports_counts(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project, _, _ = await _seed_project(db_session, owner.id)

    r = await httpx_client.get(
        f"/api/v1/projects/{project.id}/task-views",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    by_name = {item["name"]: item for item in r.json()["items"]}
    # "全部任务" 内置视图 (filter {}) 计数应等于项目任务数。
    assert by_name["全部任务"]["task_count"] == 2
    assert by_name["待标注"]["task_count"] == 2


async def test_tasks_query_annotator_only_sees_visible_batches(
    httpx_client: httpx.AsyncClient,
    project_admin,
    annotator,
    reviewer,
    db_session: AsyncSession,
):
    """非特权 annotator 通过 Data Manager 查询时, 只能看到自己 batch 可见性范围内的
    任务, 不能看到项目里其他 batch / 孤儿任务; 项目 owner 则能看到全部。"""
    owner, owner_token = project_admin
    annotator_user, annotator_token = annotator
    reviewer_user, _ = reviewer
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=annotator_user.id,
            role="annotator",
        )
    )

    batch_mine = await create_batch(db_session, project_id=project.id, status="active")
    batch_mine.annotator_id = annotator_user.id
    batch_other = await create_batch(db_session, project_id=project.id, status="active")
    batch_other.annotator_id = reviewer_user.id

    task_mine = await create_task(
        db_session, project_id=project.id, display_id="T-DM-MINE"
    )
    task_mine.batch_id = batch_mine.id
    task_other = await create_task(
        db_session, project_id=project.id, display_id="T-DM-OTHER"
    )
    task_other.batch_id = batch_other.id
    # 无 batch 的孤儿任务: 对非特权不可见
    await create_task(db_session, project_id=project.id, display_id="T-DM-ORPHAN")
    await db_session.flush()

    anno_r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {annotator_token}"},
        json={"filter_json": {}},
    )
    assert anno_r.status_code == 200, anno_r.text
    anno_body = anno_r.json()
    assert [item["id"] for item in anno_body["items"]] == [str(task_mine.id)]
    assert anno_body["total"] == 1

    owner_r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"filter_json": {}},
    )
    assert owner_r.status_code == 200, owner_r.text
    owner_ids = {item["id"] for item in owner_r.json()["items"]}
    assert {str(task_mine.id), str(task_other.id)}.issubset(owner_ids)
    assert owner_r.json()["total"] == 3


async def test_task_view_visibility_and_shared_edit_permissions(
    httpx_client: httpx.AsyncClient,
    project_admin,
    reviewer,
    db_session: AsyncSession,
):
    owner, owner_token = project_admin
    reviewer_user, reviewer_token = reviewer
    project, _, _ = await _seed_project(db_session, owner.id)
    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=reviewer_user.id,
            role="reviewer",
        )
    )
    await db_session.flush()

    private_r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/task-views",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "name": "Owner private",
            "visibility": "private",
            "filter_json": {},
            "sort_json": [],
            "columns_json": ["display_id", "status"],
        },
    )
    assert private_r.status_code == 201, private_r.text

    shared_r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/task-views",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "name": "Shared review",
            "visibility": "project",
            "filter_json": {
                "op": "and",
                "rules": [{"field": "task.status", "op": "in", "value": ["review"]}],
            },
            "sort_json": [],
            "columns_json": ["display_id", "status"],
        },
    )
    assert shared_r.status_code == 201, shared_r.text
    shared_id = shared_r.json()["id"]

    list_r = await httpx_client.get(
        f"/api/v1/projects/{project.id}/task-views",
        headers={"Authorization": f"Bearer {reviewer_token}"},
    )
    assert list_r.status_code == 200, list_r.text
    names = [item["name"] for item in list_r.json()["items"]]
    assert "Shared review" in names
    assert "Owner private" not in names

    forbidden_r = await httpx_client.patch(
        f"/api/v1/projects/{project.id}/task-views/{shared_id}",
        headers={"Authorization": f"Bearer {reviewer_token}"},
        json={"name": "Reviewer edit"},
    )
    assert forbidden_r.status_code == 403

    ok_r = await httpx_client.patch(
        f"/api/v1/projects/{project.id}/task-views/{shared_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"name": "Owner edit"},
    )
    assert ok_r.status_code == 200, ok_r.text
    assert ok_r.json()["name"] == "Owner edit"
