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
        self.bug_reports_bucket = settings.minio_bug_reports_bucket
        self.media_cache_bucket = settings.minio_media_cache_bucket
        self.audit_archive_bucket = settings.minio_audit_archive_bucket
        self.import_bucket = settings.minio_import_bucket
        self.export_bucket = settings.minio_export_bucket

    def ensure_bucket(self, bucket: str | None = None) -> None:
        b = bucket or self.bucket
        try:
            self.client.head_bucket(Bucket=b)
        except ClientError:
            self.client.create_bucket(Bucket=b)

    def ensure_all_buckets(self) -> None:
        self.ensure_bucket(self.bucket)
        self.ensure_bucket(self.datasets_bucket)
        self.ensure_bucket(self.bug_reports_bucket)
        self.ensure_bucket(self.media_cache_bucket)
        self.ensure_bucket(self.audit_archive_bucket)
        self.ensure_bucket(self.import_bucket)
        self.ensure_bucket(self.export_bucket)
        self._ensure_lifecycle()

    def _ensure_lifecycle(self) -> None:
        """v0.6.6 · 评论附件 90 天过期。
        B-4 · bug 截图迁到独立桶 ``bug-reports``,在该桶上挂 180 天 lifecycle。
        v0.10.17 · 派生媒体缓存独立桶 ``media-cache`` 整桶 30 天过期。
        若 MinIO 不支持（旧版本）静默忽略。
        """
        anno_rules = [
            {
                "ID": "comment-attachments-90d",
                "Status": "Enabled",
                "Filter": {"Prefix": "comment-attachments/"},
                "Expiration": {"Days": 90},
            },
        ]
        try:
            self.client.put_bucket_lifecycle_configuration(
                Bucket=self.bucket,
                LifecycleConfiguration={"Rules": anno_rules},
            )
        except ClientError as exc:
            logger.warning("Failed to set bucket lifecycle on %s: %s", self.bucket, exc)

        bug_rules = [
            {
                "ID": "bug-screenshots-180d",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "Expiration": {"Days": 180},
            },
        ]
        try:
            self.client.put_bucket_lifecycle_configuration(
                Bucket=self.bug_reports_bucket,
                LifecycleConfiguration={"Rules": bug_rules},
            )
        except ClientError as exc:
            logger.warning(
                "Failed to set bucket lifecycle on %s: %s", self.bug_reports_bucket, exc
            )

        media_cache_rules = [
            {
                "ID": "media-cache-30d",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "Expiration": {"Days": 30},
            },
        ]
        try:
            self.client.put_bucket_lifecycle_configuration(
                Bucket=self.media_cache_bucket,
                LifecycleConfiguration={"Rules": media_cache_rules},
            )
        except ClientError as exc:
            logger.warning(
                "Failed to set bucket lifecycle on %s: %s", self.media_cache_bucket, exc
            )

        # v0.10.27 · 导入/导出产物桶整桶 7 天过期(短生命周期产物)。
        for short_lived_bucket, rule_id in (
            (self.import_bucket, "import-artifacts-7d"),
            (self.export_bucket, "export-artifacts-7d"),
        ):
            try:
                self.client.put_bucket_lifecycle_configuration(
                    Bucket=short_lived_bucket,
                    LifecycleConfiguration={
                        "Rules": [
                            {
                                "ID": rule_id,
                                "Status": "Enabled",
                                "Filter": {"Prefix": ""},
                                "Expiration": {"Days": 7},
                            },
                        ]
                    },
                )
            except ClientError as exc:
                logger.warning(
                    "Failed to set bucket lifecycle on %s: %s", short_lived_bucket, exc
                )

        # audit-archive 桶不挂 lifecycle:合规要求永久保留。运维可单独开 object lock。

    def _public_url(self, url: str) -> str:
        if settings.minio_public_url:
            scheme = "https" if settings.minio_use_ssl else "http"
            internal = f"{scheme}://{settings.minio_endpoint}"
            url = url.replace(internal, settings.minio_public_url.rstrip("/"), 1)
        return url

    def generate_upload_url(
        self,
        key: str,
        content_type: str = "application/octet-stream",
        expires_in: int = 900,
        bucket: str | None = None,
    ) -> str:
        url = self.client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket or self.bucket,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
        )
        return self._public_url(url)

    def generate_download_url(
        self,
        key: str,
        expires_in: int = 3600,
        bucket: str | None = None,
        download_name: str | None = None,
    ) -> str:
        # v0.10.43 · download_name 经 ResponseContentDisposition 给浏览器一个友好文件名。
        params: dict = {"Bucket": bucket or self.bucket, "Key": key}
        if download_name:
            params["ResponseContentDisposition"] = (
                f'attachment; filename="{download_name}"'
            )
        url = self.client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in,
        )
        return self._public_url(url)

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
                result.append(
                    {
                        "key": obj["Key"],
                        "size": obj["Size"],
                        "last_modified": obj["LastModified"],
                        "etag": (obj.get("ETag") or "").strip('"'),
                    }
                )
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
            return {
                "name": b,
                "status": "error",
                "object_count": 0,
                "total_size_bytes": 0,
                "error": str(e),
            }
        total = sum(o["size"] for o in objs if not o["key"].endswith("/"))
        count = sum(1 for o in objs if not o["key"].endswith("/"))
        return {
            "name": b,
            "status": "ok",
            "object_count": count,
            "total_size_bytes": int(total),
        }

    def list_all_buckets(self) -> list[str]:
        return [
            self.bucket,
            self.datasets_bucket,
            self.bug_reports_bucket,
            self.media_cache_bucket,
            self.audit_archive_bucket,
            self.import_bucket,
            self.export_bucket,
        ]

    # v0.10.17 · 派生媒体缓存按 key 前缀路由到 media-cache 桶。
    # 老数据若仍在 datasets 桶,运维可用 mc mirror 一次性搬迁,期间无下行兼容
    # (派生缓存可重生)。前缀清单与 workers/media.py / video_frame_service.py 写侧保持一致。
    MEDIA_CACHE_PREFIXES: tuple[str, ...] = (
        "thumbnails/",
        "videos/",
        "playback/",
    )

    def bucket_for_cache_key(self, key: str, default: str | None = None) -> str:
        """根据派生缓存 key 前缀选桶。默认回退到 default(通常 datasets_bucket)。"""
        if key and key.startswith(self.MEDIA_CACHE_PREFIXES):
            return self.media_cache_bucket
        return default or self.datasets_bucket

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
        self,
        key: str,
        bucket: str | None = None,
        head_bytes: int = 256 * 1024,
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
            resp = self.client.get_object(
                Bucket=b, Key=key, Range=f"bytes=0-{head_bytes - 1}"
            )
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
