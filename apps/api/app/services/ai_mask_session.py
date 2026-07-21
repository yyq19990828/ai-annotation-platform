"""Short-lived signed envelope for backend low-resolution Mask logits."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import time
from typing import Any

from aap_protocol_v2 import MAX_LOW_RES_MASK_INPUT_CHARS, decode_low_res_mask

from app.config import settings

MASK_SESSION_TTL_SECONDS = 5 * 60
MAX_MASK_SESSION_TOKEN_CHARS = 1024 * 1024
_SESSION_VERSION = 1
_MAX_CLOCK_SKEW_SECONDS = 30
_RESERVED_CLAIMS = {"v", "iat", "exp", "raw"}


class AiMaskSessionError(ValueError):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


def _b64_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64_decode(value: str) -> bytes:
    return base64.b64decode(
        value + "=" * (-len(value) % 4), altchars=b"-_", validate=True
    )


def _session_key() -> bytes:
    return hashlib.sha256(
        f"aap:ai-mask-session:v{_SESSION_VERSION}:{settings.secret_key}".encode()
    ).digest()


def issue_ai_mask_session(
    raw: str,
    claims: dict[str, Any],
    *,
    now: int | None = None,
) -> str:
    if _RESERVED_CLAIMS.intersection(claims):
        raise ValueError("Mask session claims cannot override reserved fields")
    if not isinstance(raw, str) or len(raw) > MAX_LOW_RES_MASK_INPUT_CHARS:
        raise ValueError("backend mask_input exceeds the encoded byte budget")
    decode_low_res_mask(raw)
    issued_at = int(time.time() if now is None else now)
    payload = {
        "v": _SESSION_VERSION,
        "iat": issued_at,
        "exp": issued_at + MASK_SESSION_TTL_SECONDS,
        "raw": raw,
        **claims,
    }
    encoded = _b64_encode(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    )
    signature = hmac.new(_session_key(), encoded.encode(), hashlib.sha256).digest()
    token = f"{encoded}.{_b64_encode(signature)}"
    if len(token) > MAX_MASK_SESSION_TOKEN_CHARS:
        raise ValueError("Mask session token exceeds the byte budget")
    return token


def verify_ai_mask_session(token: str, *, now: int | None = None) -> dict[str, Any]:
    if not isinstance(token, str) or len(token) > MAX_MASK_SESSION_TOKEN_CHARS:
        raise AiMaskSessionError("invalid_mask_session", "Mask session is invalid")
    try:
        encoded, signature_text = token.split(".", 1)
        signature = _b64_decode(signature_text)
        expected = hmac.new(_session_key(), encoded.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        payload = json.loads(_b64_decode(encoded))
    except (
        ValueError,
        TypeError,
        binascii.Error,
        json.JSONDecodeError,
        UnicodeDecodeError,
    ) as exc:
        raise AiMaskSessionError("invalid_mask_session", "Mask session is invalid") from exc
    if not isinstance(payload, dict) or payload.get("v") != _SESSION_VERSION:
        raise AiMaskSessionError("invalid_mask_session", "Mask session is invalid")
    issued_at = payload.get("iat")
    expires_at = payload.get("exp")
    current = int(time.time() if now is None else now)
    if (
        type(issued_at) is not int
        or type(expires_at) is not int
        or expires_at - issued_at != MASK_SESSION_TTL_SECONDS
        or issued_at > current + _MAX_CLOCK_SKEW_SECONDS
    ):
        raise AiMaskSessionError("invalid_mask_session", "Mask session is invalid")
    if expires_at <= current:
        raise AiMaskSessionError("mask_session_expired", "Mask session has expired")
    raw = payload.get("raw")
    try:
        if not isinstance(raw, str) or len(raw) > MAX_LOW_RES_MASK_INPUT_CHARS:
            raise ValueError
        decode_low_res_mask(raw)
    except ValueError as exc:
        raise AiMaskSessionError("invalid_mask_session", "Mask session is invalid") from exc
    return payload


__all__ = [
    "AiMaskSessionError",
    "MASK_SESSION_TTL_SECONDS",
    "MAX_MASK_SESSION_TOKEN_CHARS",
    "issue_ai_mask_session",
    "verify_ai_mask_session",
]
