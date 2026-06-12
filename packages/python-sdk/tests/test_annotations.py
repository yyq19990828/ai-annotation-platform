import json
from uuid import uuid4

import httpx
import pytest

from ai_annotation.errors import NotFoundError
from ai_annotation.models import Annotation

from .conftest import API

TASK_ID = str(uuid4())
ANN_ID = str(uuid4())
ANN = {
    "id": ANN_ID,
    "task_id": TASK_ID,
    "source": "manual",
    "annotation_type": "bbox",
    "tool_unit_id": "bbox",
    "class_name": "car",
    "geometry": {"type": "bbox", "x": 1, "y": 2, "width": 3, "height": 4},
    "is_active": True,
    "version": 1,
    "created_at": "2026-06-11T00:00:00Z",
}


def test_list_annotations(client, respx_mock):
    respx_mock.get(f"{API}/tasks/{TASK_ID}/annotations").mock(
        return_value=httpx.Response(200, json=[ANN])
    )
    anns = client.annotations.list(TASK_ID)
    assert isinstance(anns[0], Annotation)
    assert anns[0].class_name == "car"


def test_create_annotation(client, respx_mock):
    route = respx_mock.post(f"{API}/tasks/{TASK_ID}/annotations").mock(
        return_value=httpx.Response(201, json=ANN)
    )
    geometry = {"type": "bbox", "x": 1, "y": 2, "width": 3, "height": 4}
    ann = client.annotations.create(
        TASK_ID, "bbox", geometry, class_name="car", confidence=0.9
    )
    body = json.loads(route.calls.last.request.content)
    assert body == {
        "annotation_type": "bbox",
        "geometry": geometry,
        "class_name": "car",
        "confidence": 0.9,
    }
    assert str(ann.id) == ANN_ID


def test_update_annotation_patch(client, respx_mock):
    route = respx_mock.patch(f"{API}/tasks/{TASK_ID}/annotations/{ANN_ID}").mock(
        return_value=httpx.Response(200, json={**ANN, "class_name": "truck"})
    )
    ann = client.annotations.update(TASK_ID, ANN_ID, class_name="truck", is_hidden=True)
    body = json.loads(route.calls.last.request.content)
    assert body == {"class_name": "truck", "is_hidden": True}
    assert ann.class_name == "truck"


def test_delete_annotation(client, respx_mock):
    route = respx_mock.delete(f"{API}/tasks/{TASK_ID}/annotations/{ANN_ID}").mock(
        return_value=httpx.Response(204)
    )
    client.annotations.delete(TASK_ID, ANN_ID)
    assert route.called


def test_delete_missing_maps_404(client, respx_mock):
    respx_mock.delete(f"{API}/tasks/{TASK_ID}/annotations/{ANN_ID}").mock(
        return_value=httpx.Response(404, json={"detail": "Annotation not found"})
    )
    with pytest.raises(NotFoundError) as ei:
        client.annotations.delete(TASK_ID, ANN_ID)
    assert ei.value.status_code == 404
    assert ei.value.detail == "Annotation not found"
