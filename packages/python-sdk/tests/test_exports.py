from uuid import uuid4

import httpx
import pytest

from ai_annotation.errors import AAPError
from ai_annotation.models import Job

from .conftest import API, BASE

PROJECT_ID = str(uuid4())
JOB_ID = str(uuid4())


def _completed_job(download_url: str) -> dict:
    return {
        "id": JOB_ID,
        "kind": "export",
        "status": "completed",
        "progress_pct": 100,
        "payload": {},
        "result": {"download_url": download_url},
        "error_message": None,
    }


def test_create_export_returns_job_id(client, respx_mock):
    route = respx_mock.post(f"{API}/projects/{PROJECT_ID}/export").mock(
        return_value=httpx.Response(202, json={"job_id": JOB_ID})
    )
    job_id = client.exports.create(
        PROJECT_ID,
        targets=["coco", "yolo-det"],
        include_attributes=True,
        video_frame_mode="keyframes",
    )
    params = route.calls.last.request.url.params
    assert params.get_list("targets") == ["coco", "yolo-det"]
    assert params["include_attributes"] == "true"
    assert params["video_frame_mode"] == "keyframes"
    assert job_id == JOB_ID


def test_download_presigned_absolute_url_no_auth(client, respx_mock, tmp_path):
    url = "http://minio.local/exports/P-1.zip?sig=abc"
    dl = respx_mock.get(host="minio.local", path="/exports/P-1.zip").mock(
        return_value=httpx.Response(200, content=b"PK\x03\x04zipbytes")
    )
    job = Job.model_validate(_completed_job(url))
    dest = client.exports.download(job, tmp_path / "out.zip")
    assert dest.read_bytes() == b"PK\x03\x04zipbytes"
    # 预签名 URL 不带平台 auth header
    assert "Authorization" not in dl.calls.last.request.headers


def test_download_relative_url_with_auth(client, respx_mock, tmp_path):
    # 传 job_id 时先 GET job, 再按相对路径拼回平台 origin 下载 (带 auth)
    respx_mock.get(f"{API}/async-jobs/{JOB_ID}").mock(
        return_value=httpx.Response(
            200, json=_completed_job("/api/v1/files/export.zip")
        )
    )
    dl = respx_mock.get(f"{BASE}/api/v1/files/export.zip").mock(
        return_value=httpx.Response(200, content=b"zip2")
    )
    dest = client.exports.download(JOB_ID, tmp_path / "out2.zip")
    assert dest.read_bytes() == b"zip2"
    assert dl.calls.last.request.headers["Authorization"] == "Bearer ak_test"


def test_download_without_url_raises(client, tmp_path):
    job = Job.model_validate(
        {"id": JOB_ID, "kind": "export", "status": "running", "result": {}}
    )
    with pytest.raises(AAPError):
        client.exports.download(job, tmp_path / "x.zip")
