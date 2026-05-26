from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import io
import stat
import sys
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy import func, select

from app.db.models.async_job import AsyncJob, AsyncJobStatus
from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.storage_connection import StorageConnection
from app.services import async_job as async_job_svc
from app.services.dataset import DatasetService
from app.services.sources.base import SourcePathError
from app.services.sources.s3 import S3CompatibleSource, validate_s3_source_path
from app.services.sources.sftp import SftpSource, validate_sftp_source_path
from app.services.storage import storage_service


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class _FakeS3Client:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects

    def list_objects_v2(self, **kwargs):
        prefix = kwargs.get("Prefix") or ""
        contents = []
        for key, data in sorted(self.objects.items()):
            if key.startswith(prefix):
                contents.append(
                    {
                        "Key": key,
                        "Size": len(data),
                        "LastModified": datetime(2026, 5, 26, tzinfo=timezone.utc),
                        "ETag": f'"{hashlib.md5(data).hexdigest()}"',
                    }
                )
        return {"Contents": contents, "IsTruncated": False}

    def get_object(self, *, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[Key])}


def test_s3_adapter_lists_opens_and_filters(monkeypatch):
    fake_client = _FakeS3Client(
        {
            "root/batch/a.jpg": b"a",
            "root/batch/b.txt": b"b",
            "root/batch/nested/c.png": b"c",
            "root-other/skip.jpg": b"x",
        }
    )
    monkeypatch.setattr(
        "app.services.sources.s3.boto3.client",
        lambda *args, **kwargs: fake_client,
    )

    source = S3CompatibleSource(
        {"endpoint": "http://example.test", "bucket": "bucket", "base_prefix": "root"},
        {"access_key": "AK", "secret_key": "SK"},
    )

    recursive = list(source.list("batch", recursive=True, include_globs=["*.png"]))
    assert [obj.relpath for obj in recursive] == ["batch/nested/c.png"]
    assert source.open("batch/nested/c.png").read() == b"c"

    flat = list(source.list("batch", recursive=False))
    assert [obj.relpath for obj in flat] == ["batch/a.jpg", "batch/b.txt"]


def test_source_path_traversal_rejected():
    with pytest.raises(SourcePathError):
        validate_s3_source_path({"base_prefix": "root"}, "../secret")
    with pytest.raises(SourcePathError):
        validate_sftp_source_path({"base_path": "/data/imports"}, "../secret")
    with pytest.raises(SourcePathError):
        validate_sftp_source_path({"base_path": "/data/imports"}, "/data/other")


class _FakeSftpAttr:
    def __init__(self, filename: str, mode: int, size: int = 0) -> None:
        self.filename = filename
        self.st_mode = mode
        self.st_size = size
        self.st_mtime = 1_777_000_000


class _FakeSftpClient:
    def __init__(self) -> None:
        self.files = {"/data/batch/a.jpg": b"image", "/data/batch/b.txt": b"text"}

    def listdir_attr(self, path: str):
        if path == "/data":
            return [_FakeSftpAttr("batch", stat.S_IFDIR)]
        if path == "/data/batch":
            return [
                _FakeSftpAttr("a.jpg", stat.S_IFREG, 5),
                _FakeSftpAttr("b.txt", stat.S_IFREG, 4),
            ]
        return []

    def open(self, path: str, mode: str):
        return io.BytesIO(self.files[path])

    def close(self) -> None:
        return None


def test_sftp_adapter_lists_and_opens(monkeypatch):
    fake_sftp = _FakeSftpClient()

    class FakeSSHClient:
        def load_system_host_keys(self):
            return None

        def set_missing_host_key_policy(self, policy):
            return None

        def connect(self, **kwargs):
            return None

        def open_sftp(self):
            return fake_sftp

        def close(self):
            return None

    fake_paramiko = SimpleNamespace(
        SSHClient=FakeSSHClient,
        RejectPolicy=lambda: object(),
        RSAKey=object,
        Ed25519Key=object,
        ECDSAKey=object,
        DSSKey=object,
    )
    monkeypatch.setitem(sys.modules, "paramiko", fake_paramiko)

    source = SftpSource(
        {"host": "sftp.example", "username": "u", "base_path": "/data"},
        {"password": "pw"},
    )

    objects = list(source.list("batch", recursive=True, include_globs=["*.jpg"]))
    assert [obj.relpath for obj in objects] == ["batch/a.jpg"]
    assert source.open("batch/a.jpg").read() == b"image"


class _FakeDatasetBucketClient:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.parts: dict[str, list[bytes]] = {}
        self.deleted: list[tuple[str, str]] = []
        self.next_upload_id = 1

    def create_multipart_upload(self, *, Bucket, Key, ContentType):
        upload_id = f"upload-{self.next_upload_id}"
        self.next_upload_id += 1
        self.parts[upload_id] = []
        return {"UploadId": upload_id}

    def upload_part(self, *, Bucket, Key, PartNumber, UploadId, Body):
        self.parts[UploadId].append(bytes(Body))
        return {"ETag": f"etag-{PartNumber}"}

    def complete_multipart_upload(self, *, Bucket, Key, UploadId, MultipartUpload):
        self.objects[(Bucket, Key)] = b"".join(self.parts.pop(UploadId))

    def abort_multipart_upload(self, *, Bucket, Key, UploadId):
        self.parts.pop(UploadId, None)

    def put_object(self, *, Bucket, Key, Body, ContentType=None):
        self.objects[(Bucket, Key)] = bytes(Body)

    def delete_object(self, *, Bucket, Key):
        self.deleted.append((Bucket, Key))
        self.objects.pop((Bucket, Key), None)


class _ChunkOnlyStream(io.BytesIO):
    def read(self, size: int = -1) -> bytes:
        assert size != -1
        return super().read(size)


async def _seed_dataset(db_session, owner_id: uuid.UUID) -> Dataset:
    ds = Dataset(
        id=uuid.uuid4(),
        display_id=f"D-IMP-{uuid.uuid4().hex[:6]}",
        name=f"dataset-import-{uuid.uuid4().hex[:6]}",
        data_type="image",
        created_by=owner_id,
    )
    db_session.add(ds)
    await db_session.flush()
    return ds


async def test_ingest_one_streams_upload_and_skips_duplicate(
    db_session, super_admin, monkeypatch
):
    user, _ = super_admin
    ds = await _seed_dataset(db_session, user.id)
    fake_client = _FakeDatasetBucketClient()
    monkeypatch.setattr(storage_service, "client", fake_client)
    monkeypatch.setattr(storage_service, "read_image_dimensions", lambda *a, **k: None)
    monkeypatch.setattr(
        storage_service, "read_image_dimensions_from_bytes", lambda *a, **k: None
    )

    svc = DatasetService(db_session)
    first = await svc.ingest_one(
        ds.id,
        "remote/sample.txt",
        _ChunkOnlyStream(b"same-bytes"),
        size=10,
    )
    assert first.status == "added"
    assert first.file_size == 10
    assert first.content_hash == hashlib.md5(b"same-bytes").hexdigest()
    assert (
        fake_client.objects[(storage_service.datasets_bucket, f"{ds.name}/sample.txt")]
        == b"same-bytes"
    )

    second = await svc.ingest_one(
        ds.id,
        "remote/sample.txt",
        _ChunkOnlyStream(b"same-bytes"),
        size=10,
    )
    assert second.status == "skipped"
    assert second.reason == "content_hash_exists"
    assert (
        storage_service.datasets_bucket,
        f"{ds.name}/sample-1.txt",
    ) in fake_client.deleted

    count = (
        await db_session.execute(
            select(func.count())
            .select_from(DatasetItem)
            .where(DatasetItem.dataset_id == ds.id)
        )
    ).scalar_one()
    assert count == 1


async def test_import_from_connection_api_creates_secretless_job(
    httpx_client, db_session, super_admin, monkeypatch
):
    user, token = super_admin
    ds = await _seed_dataset(db_session, user.id)
    conn = StorageConnection(
        id=uuid.uuid4(),
        name="external-s3",
        kind="s3",
        config={"endpoint": "http://8.8.8.8:9000", "bucket": "incoming"},
        secret_enc=None,
        scope="global",
        created_by=user.id,
    )
    db_session.add(conn)
    await db_session.flush()

    async def allow(_db, _target):
        return None

    monkeypatch.setattr(
        "app.services.connector_guard.assert_connection_target_allowed", allow
    )

    class Result:
        id = "celery-dataset-import"

    queued: list[str] = []

    def fake_delay(job_id: str):
        queued.append(job_id)
        return Result()

    from app.workers import dataset_import

    monkeypatch.setattr(dataset_import.run_dataset_import, "delay", fake_delay)

    response = await httpx_client.post(
        f"/api/v1/datasets/{ds.id}/import-from-connection",
        headers=_bearer(token),
        json={
            "connection_id": str(conn.id),
            "source_path": "batch-a",
            "recursive": True,
            "include_globs": ["*.jpg"],
        },
    )

    assert response.status_code == 202, response.text
    job_id = uuid.UUID(response.json()["job_id"])
    assert queued == [str(job_id)]
    job = await db_session.get(AsyncJob, job_id)
    assert job is not None
    assert job.kind == "dataset_import"
    assert job.celery_task_id == "celery-dataset-import"
    assert job.payload["connection_id"] == str(conn.id)
    assert "secret" not in job.payload
    assert "access_key" not in str(job.payload)


async def test_dataset_import_cancel_is_allowed(
    httpx_client_bound, db_session, annotator
):
    user, token = annotator
    job = await async_job_svc.create_job(
        db_session,
        kind="dataset_import",
        user_id=user.id,
    )
    await async_job_svc.mark_running(db_session, job.id)
    await db_session.flush()

    response = await httpx_client_bound.post(
        f"/api/v1/async-jobs/{job.id}/cancel",
        headers=_bearer(token),
    )

    assert response.status_code == 200
    await db_session.refresh(job)
    assert job.status == AsyncJobStatus.CANCELLED.value
