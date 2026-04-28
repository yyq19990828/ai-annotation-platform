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
        self.datasets_bucket = settings.minio_datasets_bucket

    def ensure_bucket(self, bucket: str | None = None) -> None:
        b = bucket or self.bucket
        try:
            self.client.head_bucket(Bucket=b)
        except ClientError:
            self.client.create_bucket(Bucket=b)

    def ensure_all_buckets(self) -> None:
        self.ensure_bucket(self.bucket)
        self.ensure_bucket(self.datasets_bucket)

    def generate_upload_url(self, key: str, content_type: str = "application/octet-stream", expires_in: int = 900, bucket: str | None = None) -> str:
        return self.client.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket or self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )

    def generate_download_url(self, key: str, expires_in: int = 3600, bucket: str | None = None) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket or self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def verify_upload(self, key: str, bucket: str | None = None) -> dict | None:
        try:
            return self.client.head_object(Bucket=bucket or self.bucket, Key=key)
        except ClientError:
            return None

    def delete_object(self, key: str, bucket: str | None = None) -> None:
        self.client.delete_object(Bucket=bucket or self.bucket, Key=key)

    def list_objects(self, prefix: str, bucket: str | None = None) -> list[dict]:
        b = bucket or self.bucket
        result: list[dict] = []
        continuation_token = None
        while True:
            kwargs: dict = {"Bucket": b, "Prefix": prefix}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            resp = self.client.list_objects_v2(**kwargs)
            for obj in resp.get("Contents", []):
                result.append({
                    "key": obj["Key"],
                    "size": obj["Size"],
                    "last_modified": obj["LastModified"],
                })
            if resp.get("IsTruncated"):
                continuation_token = resp["NextContinuationToken"]
            else:
                break
        return result

    def create_folder(self, folder_name: str, bucket: str | None = None) -> None:
        b = bucket or self.bucket
        self.client.put_object(Bucket=b, Key=f"{folder_name}/", Body=b"")


storage_service = StorageService()
