from __future__ import annotations

import io
import logging

import boto3
from botocore.exceptions import ClientError

from app.config import settings

logger = logging.getLogger(__name__)


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
                    "etag": (obj.get("ETag") or "").strip('"'),
                })
            if resp.get("IsTruncated"):
                continuation_token = resp["NextContinuationToken"]
            else:
                break
        return result

    def head_object_etag(self, key: str, bucket: str | None = None) -> str | None:
        meta = self.verify_upload(key, bucket=bucket)
        if not meta:
            return None
        etag = meta.get("ETag") or ""
        return etag.strip('"') or None

    def summarize_bucket(self, bucket: str | None = None) -> dict:
        """统计桶内对象数量与总字节数；状态字段独立返回 (ok|error)。"""
        b = bucket or self.bucket
        try:
            objs = self.list_objects("", bucket=b)
        except ClientError as e:
            return {"name": b, "status": "error", "object_count": 0, "total_size_bytes": 0, "error": str(e)}
        total = sum(o["size"] for o in objs if not o["key"].endswith("/"))
        count = sum(1 for o in objs if not o["key"].endswith("/"))
        return {"name": b, "status": "ok", "object_count": count, "total_size_bytes": int(total)}

    def list_all_buckets(self) -> list[str]:
        return [self.bucket, self.datasets_bucket]

    def create_folder(self, folder_name: str, bucket: str | None = None) -> None:
        b = bucket or self.bucket
        self.client.put_object(Bucket=b, Key=f"{folder_name}/", Body=b"")

    @staticmethod
    def read_image_dimensions_from_bytes(data: bytes) -> tuple[int, int] | None:
        """从已下载字节直接解析图像尺寸（zip 内文件已在内存）。"""
        try:
            from PIL import Image  # noqa: PLC0415
        except ImportError:
            return None
        try:
            with Image.open(io.BytesIO(data)) as img:
                return int(img.width), int(img.height)
        except Exception:  # noqa: BLE001
            return None

    def read_image_dimensions(
        self, key: str, bucket: str | None = None, head_bytes: int = 256 * 1024,
    ) -> tuple[int, int] | None:
        """读取对象前若干字节交给 Pillow 解析尺寸。无法解析返回 None；不抛。

        Pillow 大多格式（JPEG / PNG / WEBP / GIF）只需读到文件头即可拿到 size，
        故只 Range-fetch 头部 head_bytes（默认 256KB）来避开整张大图的下载与内存。
        """
        try:
            from PIL import Image  # noqa: PLC0415 - 延迟导入，未安装时仅尺寸功能失效
        except ImportError:
            logger.warning("Pillow 未安装，跳过尺寸读取 key=%s", key)
            return None

        b = bucket or self.bucket
        try:
            resp = self.client.get_object(Bucket=b, Key=key, Range=f"bytes=0-{head_bytes - 1}")
            data = resp["Body"].read()
        except ClientError as exc:
            logger.warning("读取对象 head 失败 key=%s err=%s", key, exc)
            return None

        try:
            with Image.open(io.BytesIO(data)) as img:
                return int(img.width), int(img.height)
        except Exception as exc:  # noqa: BLE001 - 任意 PIL / 损坏文件错误
            logger.info("Pillow 解析失败 key=%s err=%s", key, exc)
            return None


storage_service = StorageService()
