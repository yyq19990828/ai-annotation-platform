"""v0.11.14 · 存储连接器 service：CRUD + 连通性测试。

密钥加解密只在本层发生，绝不出层；所有出网操作（test）前先过 connector_guard
（白名单 + SSRF）。实际数据拉取的 SourceAdapter 在 v0.11.15。
"""

from __future__ import annotations

import io
import uuid

import anyio
import boto3
from botocore.config import Config as BotoConfig
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_secret, encrypt_secret
from app.db.models.storage_connection import StorageConnection
from app.services import connector_guard

# 各 kind 的必填字段
_REQUIRED_CONFIG = {
    "s3": {"endpoint", "bucket"},
    "sftp": {"host", "username"},
}
# config 中允许保留的非密钥键（白名单式裁剪，杜绝密钥混入 config）
_ALLOWED_CONFIG = {
    "s3": {"endpoint", "bucket", "region", "base_prefix", "use_ssl"},
    "sftp": {"host", "port", "username", "base_path", "auth_type"},
}

_TEST_SAMPLE_LIMIT = 20


class ConnectorValidationError(Exception):
    """config/secret 校验失败。"""


def _validate_and_sanitize_config(kind: str, config: dict) -> dict:
    missing = _REQUIRED_CONFIG[kind] - set(config or {})
    if missing:
        raise ConnectorValidationError(
            f"{kind} 缺少必填配置: {', '.join(sorted(missing))}"
        )
    return {k: config[k] for k in _ALLOWED_CONFIG[kind] if k in config}


def _validate_secret(kind: str, secret: dict) -> None:
    secret = secret or {}
    if kind == "s3":
        if not secret.get("access_key") or not secret.get("secret_key"):
            raise ConnectorValidationError("s3 需提供 access_key 与 secret_key")
    elif kind == "sftp":
        auth = (secret.get("private_key") and "key") or (
            secret.get("password") and "password"
        )
        if not auth:
            raise ConnectorValidationError("sftp 需提供 password 或 private_key")


def target_host(conn: StorageConnection) -> str:
    """connector_guard 校验用的目标地址（endpoint / host）。"""
    if conn.kind == "s3":
        return str(conn.config.get("endpoint", ""))
    return str(conn.config.get("host", ""))


def to_out_dict(conn: StorageConnection) -> dict:
    """转 Out（脱敏：不含 secret，仅 secret_set）。"""
    return {
        "id": conn.id,
        "name": conn.name,
        "kind": conn.kind,
        "config": conn.config or {},
        "scope": conn.scope,
        "project_id": conn.project_id,
        "secret_set": conn.secret_enc is not None,
        "created_by": conn.created_by,
        "created_at": conn.created_at,
        "updated_at": conn.updated_at,
    }


class StorageConnectionService:
    @staticmethod
    async def create(
        db: AsyncSession,
        *,
        name: str,
        kind: str,
        config: dict,
        secret: dict,
        scope: str,
        project_id: uuid.UUID | None,
        created_by: uuid.UUID,
    ) -> StorageConnection:
        clean_config = _validate_and_sanitize_config(kind, config)
        _validate_secret(kind, secret)
        conn = StorageConnection(
            name=name,
            kind=kind,
            config=clean_config,
            secret_enc=encrypt_secret(secret),
            scope=scope,
            project_id=project_id,
            created_by=created_by,
        )
        # 落库前先过白名单/SSRF：拒绝建一个根本连不出去的连接器。
        await connector_guard.assert_connection_target_allowed(db, target_host(conn))
        db.add(conn)
        await db.flush()
        return conn

    @staticmethod
    async def get(db: AsyncSession, conn_id: uuid.UUID) -> StorageConnection | None:
        return await db.get(StorageConnection, conn_id)

    @staticmethod
    async def list_visible(
        db: AsyncSession,
        *,
        all_scopes: bool,
        project_id: uuid.UUID | None,
    ) -> list[StorageConnection]:
        """all_scopes=True（超管）→ 全部；否则 global + 指定项目的。"""
        stmt = select(StorageConnection).order_by(StorageConnection.created_at.desc())
        if not all_scopes:
            if project_id is not None:
                stmt = stmt.where(
                    (StorageConnection.scope == "global")
                    | (StorageConnection.project_id == project_id)
                )
            else:
                stmt = stmt.where(StorageConnection.scope == "global")
        rows = await db.execute(stmt)
        return list(rows.scalars().all())

    @staticmethod
    async def update(
        db: AsyncSession,
        conn: StorageConnection,
        *,
        name: str | None,
        config: dict | None,
        secret: dict | None,
    ) -> StorageConnection:
        if name is not None:
            conn.name = name
        if config is not None:
            conn.config = _validate_and_sanitize_config(conn.kind, config)
            await connector_guard.assert_connection_target_allowed(
                db, target_host(conn)
            )
        if secret is not None:
            _validate_secret(conn.kind, secret)
            conn.secret_enc = encrypt_secret(secret)
        await db.flush()
        return conn

    @staticmethod
    async def delete(db: AsyncSession, conn: StorageConnection) -> None:
        await db.delete(conn)

    @staticmethod
    async def test_connection(
        db: AsyncSession, conn: StorageConnection
    ) -> tuple[bool, str, int | None]:
        """连通性测试。出网前复检白名单/SSRF。返回 (ok, message, sample_count)。"""
        await connector_guard.assert_connection_target_allowed(db, target_host(conn))
        secret = decrypt_secret(conn.secret_enc) if conn.secret_enc else {}
        try:
            count = await anyio.to_thread.run_sync(
                _test_blocking, conn.kind, dict(conn.config or {}), secret
            )
            return True, "连接成功", count
        except Exception as e:  # noqa: BLE001 — 探测失败统一回报，不泄漏堆栈
            return False, f"连接失败: {e}", None


def _test_blocking(kind: str, config: dict, secret: dict) -> int:
    """同步连通性探测（在线程池执行）。返回采样到的条目数。"""
    if kind == "s3":
        return _test_s3(config, secret)
    return _test_sftp(config, secret)


def _test_s3(config: dict, secret: dict) -> int:
    scheme = "https" if config.get("use_ssl") else "http"
    endpoint = config["endpoint"]
    if "://" not in endpoint:
        endpoint = f"{scheme}://{endpoint}"
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=secret.get("access_key"),
        aws_secret_access_key=secret.get("secret_key"),
        region_name=config.get("region"),
        config=BotoConfig(
            connect_timeout=10, read_timeout=15, retries={"max_attempts": 1}
        ),
    )
    resp = client.list_objects_v2(
        Bucket=config["bucket"],
        Prefix=config.get("base_prefix", "") or "",
        MaxKeys=_TEST_SAMPLE_LIMIT,
    )
    return int(resp.get("KeyCount", 0))


def _test_sftp(config: dict, secret: dict) -> int:
    import paramiko

    client = paramiko.SSHClient()
    # 不用 AutoAddPolicy（静默接受 = MITM 风险）；首版用 RejectPolicy + 系统 known_hosts。
    # TODO(v0.11.15): 支持超管预置 / TOFU 记录指纹到 system_settings。
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    pkey = None
    if secret.get("private_key"):
        pkey = paramiko.RSAKey.from_private_key(
            io.StringIO(secret["private_key"]), password=secret.get("passphrase")
        )
    try:
        client.connect(
            hostname=config["host"],
            port=int(config.get("port", 22)),
            username=config["username"],
            password=secret.get("password") if not pkey else None,
            pkey=pkey,
            timeout=10,
            allow_agent=False,
            look_for_keys=False,
        )
        sftp = client.open_sftp()
        try:
            entries = sftp.listdir(config.get("base_path", ".") or ".")
            return min(len(entries), _TEST_SAMPLE_LIMIT)
        finally:
            sftp.close()
    finally:
        client.close()
