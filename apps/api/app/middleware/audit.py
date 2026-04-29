from __future__ import annotations

import logging

from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.core.security import decode_access_token
from app.db.base import async_session
from app.db.models.audit_log import AuditLog
from app.services.audit import extract_client_ip

logger = logging.getLogger(__name__)

_API_PREFIX = "/api/v1"
_WRITE_METHODS = {"POST", "PATCH", "PUT", "DELETE"}
# 跳过的路径：登录 body 含明文密码，注册体含密码且接口本身会显式打点
_SKIP_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v1/auth/me/password",
}


class AuditMiddleware(BaseHTTPMiddleware):
    """
    全自动写请求审计：
      - 仅匹配 /api/v1 + 写方法（POST/PATCH/PUT/DELETE）
      - 在 call_next 之后写入，绝不阻塞主响应
      - 独立 session（避免污染请求作用域 session）
      - 任何异常被吞掉，仅 logger.warning，永不影响响应
      - actor 仅从 Authorization JWT 解析，不查 DB（detail_json 留空，业务层会另写带 detail 的行）
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        path = request.url.path
        method = request.method

        if (
            method not in _WRITE_METHODS
            or not path.startswith(_API_PREFIX)
            or path in _SKIP_PATHS
        ):
            return response

        try:
            await _persist_audit(request, response.status_code)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("AuditMiddleware persist failed: %s", exc)

        return response


async def _persist_audit(request: Request, status_code: int) -> None:
    actor_id = None
    actor_role = None
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        try:
            payload = decode_access_token(token)
            actor_id = payload.get("sub")
            actor_role = payload.get("role")
        except JWTError:
            actor_id = None

    entry = AuditLog(
        actor_id=actor_id,
        actor_email=None,
        actor_role=actor_role,
        action=f"http.{request.method.lower()}",
        target_type=None,
        target_id=None,
        method=request.method,
        path=path_short(request.url.path),
        status_code=status_code,
        ip=extract_client_ip(request),
        detail_json=None,
    )

    async with async_session() as session:
        session.add(entry)
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def path_short(path: str) -> str:
    if len(path) <= 256:
        return path
    return path[:255] + "…"
