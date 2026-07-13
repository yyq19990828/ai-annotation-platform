from __future__ import annotations

from app.config import settings
from app.services.storage import StorageService


def test_dev_same_origin_public_url_and_ml_backend_url_are_independent(monkeypatch):
    monkeypatch.setattr(settings, "minio_use_ssl", False)
    monkeypatch.setattr(settings, "minio_endpoint", "localhost:9000")
    monkeypatch.setattr(settings, "minio_public_url", "/minio")
    monkeypatch.setattr(settings, "ml_backend_storage_host", "172.17.0.1:9000")
    service = object.__new__(StorageService)
    internal = "http://localhost:9000/datasets/example.jpg?signature=test"

    public = service._public_url(internal)

    assert public == "/minio/datasets/example.jpg?signature=test"
    assert service.rewrite_host_for_ml_backend(public) == (
        "http://172.17.0.1:9000/datasets/example.jpg?signature=test"
    )
