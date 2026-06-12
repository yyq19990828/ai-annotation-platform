from uuid import uuid4

import httpx

from ai_annotation.models import Task, TaskPage

from .conftest import API

PROJECT_ID = str(uuid4())
TASK = {
    "id": str(uuid4()),
    "project_id": PROJECT_ID,
    "display_id": "T-1",
    "file_name": "img.jpg",
    "file_type": "image",
    "status": "pending",
    "created_at": "2026-06-11T00:00:00Z",
}


def test_list_tasks(client, respx_mock):
    route = respx_mock.get(f"{API}/tasks").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [TASK],
                "total": 1,
                "limit": 20,
                "offset": 0,
                "next_cursor": "abc",
            },
        )
    )
    page = client.tasks.list(PROJECT_ID, status="pending", limit=20, offset=0)
    req = route.calls.last.request
    assert req.url.params["project_id"] == PROJECT_ID
    assert req.url.params["status"] == "pending"
    assert req.url.params["limit"] == "20"
    assert "cursor" not in req.url.params
    assert isinstance(page, TaskPage)
    assert page.next_cursor == "abc"
    assert page.items[0].display_id == "T-1"


def test_get_task(client, respx_mock):
    tid = TASK["id"]
    respx_mock.get(f"{API}/tasks/{tid}").mock(return_value=httpx.Response(200, json=TASK))
    t = client.tasks.get(tid)
    assert isinstance(t, Task)
    assert str(t.id) == tid


def test_next_task(client, respx_mock):
    route = respx_mock.get(f"{API}/tasks/next").mock(
        return_value=httpx.Response(200, json=TASK)
    )
    t = client.tasks.next(PROJECT_ID)
    assert route.calls.last.request.url.params["project_id"] == PROJECT_ID
    assert t is not None and t.display_id == "T-1"


def test_next_task_none(client, respx_mock):
    # 无可领任务时后端返回 null
    respx_mock.get(f"{API}/tasks/next").mock(return_value=httpx.Response(200, json=None))
    assert client.tasks.next(PROJECT_ID, batch_id=uuid4()) is None
