from __future__ import annotations

import boto3
from botocore.exceptions import ClientError

from app.config import settings


class StorageService:
    def __init__(self) -> None:
        scheme = "https" if settings.minio_use_ssl else "http"
        self.client = boto3.client(
            "s3",
            endpoint_url=f"{scheme}://{settings.minio_endpoint}",
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
        )
        self.bucket = settings.minio_bucket

    def ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError:
            self.client.create_bucket(Bucket=self.bucket)

    def generate_upload_url(self, key: str, content_type: str = "application/octet-stream", expires_in: int = 900) -> str:
        return self.client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )

    def generate_download_url(self, key: str, expires_in: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def verify_upload(self, key: str) -> dict | None:
        try:
            return self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError:
            return None

    def delete_object(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


storage_service = StorageService()
