from uuid import uuid4

import httpx
import pytest

from ai_annotation.errors import PermissionDeniedError
from ai_annotation.models import Batch, Me, Member

from .conftest import API

PID = str(uuid4())
BID = str(uuid4())


def _batch(**extra) -> dict:
    return {
        "id": BID,
        "project_id": PID,
        "display_id": "B-1",
        "name": "batch-alpha",
        "status": "active",
        "total_tasks": 20,
        "completed_tasks": 12,
        "review_tasks": 3,
        "approved_tasks": 8,
        "rejected_tasks": 1,
        "progress_pct": 60.0,
        "annotator": {
            "id": str(uuid4()),
            "name": "标注员甲",
            "email": "a@x.io",
            "role": "annotator",
            "avatar_initial": "甲",
        },
        "reviewer": None,
        "created_at": "2026-06-11T00:00:00Z",
        **extra,
    }


def test_list_batches(client, respx_mock):
    route = respx_mock.get(f"{API}/projects/{PID}/batches").mock(
        return_value=httpx.Response(200, json=[_batch()])
    )
    batches = client.batches.list(PID)
    assert route.called
    assert len(batches) == 1
    b = batches[0]
    assert isinstance(b, Batch)
    assert b.progress_pct == 60.0
    assert b.rejected_tasks == 1
    assert b.annotator.name == "标注员甲"
    assert b.reviewer is None


def test_list_batches_status_filter(client, respx_mock):
    route = respx_mock.get(f"{API}/projects/{PID}/batches").mock(
        return_value=httpx.Response(200, json=[])
    )
    client.batches.list(PID, status="reviewing")
    assert route.calls.last.request.url.params["status"] == "reviewing"


def test_get_batch(client, respx_mock):
    respx_mock.get(f"{API}/projects/{PID}/batches/{BID}").mock(
        return_value=httpx.Response(200, json=_batch(status="approved"))
    )
    b = client.batches.get(PID, BID)
    assert b.status == "approved"


def test_list_members(client, respx_mock):
    route = respx_mock.get(f"{API}/projects/{PID}/members").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "id": str(uuid4()),
                    "user_id": str(uuid4()),
                    "user_name": "张三",
                    "user_email": "zhang@x.io",
                    "role": "annotator",
                    "assigned_at": "2026-06-10T00:00:00Z",
                }
            ],
        )
    )
    members = client.members.list(PID)
    assert route.called
    assert len(members) == 1
    assert isinstance(members[0], Member)
    assert members[0].user_name == "张三"
    assert members[0].role == "annotator"


def test_me(client, respx_mock):
    respx_mock.get(f"{API}/auth/me").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": str(uuid4()),
                "email": "me@x.io",
                "name": "Me",
                "role": "project_admin",
                "status": "active",
            },
        )
    )
    me = client.me()
    assert isinstance(me, Me)
    assert me.role == "project_admin"
    assert me.email == "me@x.io"


def test_members_permission_denied(client, respx_mock):
    respx_mock.get(f"{API}/projects/{PID}/members").mock(
        return_value=httpx.Response(403, json={"detail": "forbidden"})
    )
    with pytest.raises(PermissionDeniedError):
        client.members.list(PID)
