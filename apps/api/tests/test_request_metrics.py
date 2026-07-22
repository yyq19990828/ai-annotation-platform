from types import SimpleNamespace

import httpx
import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from app.middleware.request_id import RequestIDMiddleware, _metric_route_path
from app.observability.metrics import HTTP_REQUESTS_TOTAL


def _request(path: str, route_path: str | None) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [],
        "scheme": "http",
        "server": ("test", 80),
        "client": ("test", 123),
    }
    if route_path is not None:
        scope["route"] = SimpleNamespace(path_format=route_path)
    return Request(scope)


def test_metric_path_uses_route_template_not_uuid() -> None:
    task_id = "7c1e81ac-ef5c-4a1e-b61f-0ec699a8a710"
    request = _request(
        f"/api/v1/tasks/{task_id}/video/tracker-jobs",
        "/api/v1/tasks/{task_id}/video/tracker-jobs",
    )

    label = _metric_route_path(request)

    assert label == "/api/v1/tasks/{task_id}/video/tracker-jobs"
    assert task_id not in label


def test_metric_path_collapses_unmatched_api_urls() -> None:
    assert _metric_route_path(_request("/api/v1/private/value", None)) == "/api/unmatched"


@pytest.mark.asyncio
async def test_request_middleware_records_the_resolved_route_template() -> None:
    async def endpoint(_request: Request) -> PlainTextResponse:
        return PlainTextResponse("ok")

    app = Starlette(routes=[Route("/api/items/{item_id}", endpoint)])
    app.add_middleware(RequestIDMiddleware)
    metric = HTTP_REQUESTS_TOTAL.labels(
        method="GET",
        path="/api/items/{item_id}",
        status_code="200",
    )
    before = float(metric._value.get())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/items/7c1e81ac-ef5c-4a1e-b61f-0ec699a8a710"
        )

    assert response.status_code == 200
    assert float(metric._value.get()) == before + 1
