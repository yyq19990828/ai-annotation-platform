import json
from uuid import uuid4

import httpx

from ai_annotation.models import (
    Dataset,
    LinkResult,
    Page,
    UploadedItem,
    ZipUploadResult,
)

from .conftest import API

DS_ID = str(uuid4())
DATASET = {
    "id": DS_ID,
    "display_id": "D-1",
    "name": "ds",
    "description": "",
    "data_type": "image",
    "file_count": 2,
    "total_size": 100,
    "created_at": "2026-06-11T00:00:00Z",
}


def test_list_datasets(client, respx_mock):
    route = respx_mock.get(f"{API}/datasets").mock(
        return_value=httpx.Response(
            200, json={"items": [DATASET], "total": 1, "limit": 10, "offset": 0}
        )
    )
    page = client.datasets.list(search="ds", limit=10, offset=0)
    req = route.calls.last.request
    assert req.url.params["search"] == "ds"
    assert req.url.params["limit"] == "10"
    assert isinstance(page, Page)
    assert isinstance(page.items[0], Dataset)
    assert page.total == 1


def test_create_and_get_dataset(client, respx_mock):
    create = respx_mock.post(f"{API}/datasets").mock(
        return_value=httpx.Response(201, json=DATASET)
    )
    ds = client.datasets.create(name="ds", data_type="image", is_temporal=False)
    body = json.loads(create.calls.last.request.content)
    assert body == {"name": "ds", "data_type": "image", "is_temporal": False}
    assert ds.display_id == "D-1"

    respx_mock.get(f"{API}/datasets/{DS_ID}").mock(
        return_value=httpx.Response(200, json=DATASET)
    )
    assert client.datasets.get(DS_ID).name == "ds"


def test_upload_files_three_step_flow(client, respx_mock, tmp_path):
    item_id = str(uuid4())
    f = tmp_path / "img.jpg"
    f.write_bytes(b"jpegdata")

    init = respx_mock.post(f"{API}/datasets/{DS_ID}/items/upload-init").mock(
        return_value=httpx.Response(
            200,
            json={
                "item_id": item_id,
                "upload_url": "http://minio.local/bucket/img.jpg?sig=1",
                "expires_in": 900,
            },
        )
    )
    put = respx_mock.put(host="minio.local", path="/bucket/img.jpg").mock(
        return_value=httpx.Response(200)
    )
    complete = respx_mock.post(
        f"{API}/datasets/{DS_ID}/items/upload-complete/{item_id}"
    ).mock(
        return_value=httpx.Response(
            200, json={"status": "ok", "item_id": item_id, "linked_tasks": 1}
        )
    )

    progress = []
    items = client.datasets.upload_files(
        DS_ID,
        [f],
        on_progress=lambda done, total, name: progress.append((done, total, name)),
    )

    init_body = json.loads(init.calls.last.request.content)
    assert init_body == {"file_name": "img.jpg", "content_type": "image/jpeg"}
    put_req = put.calls.last.request
    assert put_req.content == b"jpegdata"
    assert put_req.headers["Content-Type"] == "image/jpeg"
    # 预签名 PUT 不应携带平台 auth
    assert "Authorization" not in put_req.headers
    assert complete.called
    assert isinstance(items[0], UploadedItem)
    assert str(items[0].item_id) == item_id
    assert items[0].file_name == "img.jpg"
    assert progress == [(1, 1, "img.jpg")]


def test_upload_zip(client, respx_mock, tmp_path):
    z = tmp_path / "data.zip"
    z.write_bytes(b"PK\x03\x04fakezip")
    route = respx_mock.post(f"{API}/datasets/{DS_ID}/items/upload-zip").mock(
        return_value=httpx.Response(
            200,
            json={
                "added": 3,
                "deduped": 0,
                "skipped": 1,
                "errors": [],
                "total_in_zip": 4,
                "linked_tasks": 3,
                "scene_inference_notes": [],
            },
        )
    )
    result = client.datasets.upload_zip(DS_ID, z)
    content = route.calls.last.request.content
    assert b'name="file"' in content
    assert b'filename="data.zip"' in content
    assert isinstance(result, ZipUploadResult)
    assert result.added == 3
    assert result.skipped == 1


def test_link_project_async(client, respx_mock):
    pid = str(uuid4())
    job_id = str(uuid4())
    route = respx_mock.post(f"{API}/datasets/{DS_ID}/link").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "linking",
                "dataset_id": DS_ID,
                "project_id": pid,
                "async_job_id": job_id,
            },
        )
    )
    result = client.datasets.link_project(DS_ID, pid)
    assert json.loads(route.calls.last.request.content) == {"project_id": pid}
    assert isinstance(result, LinkResult)
    assert result.status == "linking"
    assert str(result.async_job_id) == job_id
