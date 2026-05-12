from __future__ import annotations

import uuid

import pytest

from app.db.models.prediction import Prediction
from app.db.models.project import Project
from app.db.models.task import Task
from app.services.display_id import next_display_id


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_predictions_include_original_shape_index_after_confidence_filter(
    httpx_client_bound,
    db_session,
    super_admin,
):
    owner, token = super_admin
    project = Project(
        id=uuid.uuid4(),
        display_id=await next_display_id(db_session, "projects"),
        name="shape-index",
        type_label="图像-检测",
        type_key="image-det",
        owner_id=owner.id,
        classes=["商品", "价签"],
        classes_config={
            "商品": {"alias": "person"},
            "价签": {"alias": "car"},
        },
    )
    db_session.add(project)
    await db_session.flush()

    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id=f"T-{uuid.uuid4().hex[:8]}",
        file_name="sample.jpg",
        file_path="/tmp/sample.jpg",
        file_type="image",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    prediction = Prediction(
        id=uuid.uuid4(),
        task_id=task.id,
        project_id=project.id,
        ml_backend_id=None,
        model_version="test",
        score=None,
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
                "score": 0.4,
            },
            {
                "type": "rectanglelabels",
                "value": {
                    "x": 20,
                    "y": 20,
                    "width": 10,
                    "height": 10,
                    "rectanglelabels": ["person"],
                },
                "score": 0.9,
            },
            {
                "type": "rectanglelabels",
                "value": {
                    "x": 40,
                    "y": 40,
                    "width": 10,
                    "height": 10,
                    "rectanglelabels": ["car"],
                },
                "score": 0.8,
            },
        ],
    )
    db_session.add(prediction)
    await db_session.commit()

    resp = await httpx_client_bound.get(
        f"/api/v1/tasks/{task.id}/predictions?min_confidence=0.5",
        headers=_bearer(token),
    )

    assert resp.status_code == 200
    shapes = resp.json()[0]["result"]
    assert [s["shape_index"] for s in shapes] == [1, 2]
    assert [s["class_name"] for s in shapes] == ["person", "car"]
