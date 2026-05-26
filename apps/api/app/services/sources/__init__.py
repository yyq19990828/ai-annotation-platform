from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_secret
from app.db.models.storage_connection import StorageConnection
from app.services import connector_guard
from app.services.sources.base import SourceAdapter, SourceObject, SourcePathError
from app.services.sources.s3 import S3CompatibleSource, validate_s3_source_path
from app.services.sources.sftp import SftpSource, validate_sftp_source_path
from app.services.storage_connection import target_host

__all__ = [
    "SourceAdapter",
    "SourceObject",
    "SourcePathError",
    "S3CompatibleSource",
    "SftpSource",
    "build_adapter",
    "validate_source_path",
]


def validate_source_path(conn: StorageConnection, source_path: str | None) -> None:
    if conn.kind == "s3":
        validate_s3_source_path(conn.config or {}, source_path)
        return
    if conn.kind == "sftp":
        validate_sftp_source_path(conn.config or {}, source_path)
        return
    raise ValueError(f"unsupported storage connection kind: {conn.kind}")


async def build_adapter(
    db: AsyncSession, conn: StorageConnection
) -> SourceAdapter:
    await connector_guard.assert_connection_target_allowed(db, target_host(conn))
    validate_source_path(conn, "")
    secret = decrypt_secret(conn.secret_enc) if conn.secret_enc else {}
    if conn.kind == "s3":
        return S3CompatibleSource(dict(conn.config or {}), secret)
    if conn.kind == "sftp":
        return SftpSource(dict(conn.config or {}), secret)
    raise ValueError(f"unsupported storage connection kind: {conn.kind}")
