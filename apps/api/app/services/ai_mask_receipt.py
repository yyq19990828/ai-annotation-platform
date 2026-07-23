from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from app.config import settings

RECEIPT_TTL_SECONDS = 15 * 60
_RECEIPT_VERSION = 1
_MAX_CLOCK_SKEW_SECONDS = 30
_RESERVED_CLAIMS = {"v", "iat", "exp"}


class AiMaskReceiptError(ValueError):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


def _b64_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _receipt_key() -> bytes:
    return hashlib.sha256(
        f"aap:ai-mask-receipt:v{_RECEIPT_VERSION}:{settings.secret_key}".encode()
    ).digest()


def issue_ai_mask_receipt(claims: dict[str, Any], *, now: int | None = None) -> str:
    if _RESERVED_CLAIMS.intersection(claims):
        raise ValueError("receipt claims cannot override reserved fields")
    issued_at = int(time.time() if now is None else now)
    payload = {
        "v": _RECEIPT_VERSION,
        "iat": issued_at,
        "exp": issued_at + RECEIPT_TTL_SECONDS,
        **claims,
    }
    encoded = _b64_encode(
        json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    )
    signature = hmac.new(_receipt_key(), encoded.encode(), hashlib.sha256).digest()
    return f"{encoded}.{_b64_encode(signature)}"


def verify_ai_mask_receipt(token: str, *, now: int | None = None) -> dict[str, Any]:
    if len(token) > 4096:
        raise AiMaskReceiptError(
            "invalid_candidate_receipt", "candidate receipt is invalid"
        )
    try:
        encoded, signature_text = token.split(".", 1)
        signature = _b64_decode(signature_text)
        expected = hmac.new(_receipt_key(), encoded.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        payload = json.loads(_b64_decode(encoded))
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise AiMaskReceiptError(
            "invalid_candidate_receipt", "candidate receipt is invalid"
        ) from exc
    if not isinstance(payload, dict) or payload.get("v") != _RECEIPT_VERSION:
        raise AiMaskReceiptError(
            "invalid_candidate_receipt", "candidate receipt is invalid"
        )
    issued_at = payload.get("iat")
    expires_at = payload.get("exp")
    current = int(time.time() if now is None else now)
    if (
        type(issued_at) is not int
        or type(expires_at) is not int
        or expires_at - issued_at != RECEIPT_TTL_SECONDS
        or issued_at > current + _MAX_CLOCK_SKEW_SECONDS
    ):
        raise AiMaskReceiptError(
            "invalid_candidate_receipt", "candidate receipt is invalid"
        )
    if expires_at <= current:
        raise AiMaskReceiptError(
            "candidate_receipt_expired", "candidate receipt has expired"
        )
    return payload


__all__ = [
    "AiMaskReceiptError",
    "RECEIPT_TTL_SECONDS",
    "issue_ai_mask_receipt",
    "verify_ai_mask_receipt",
]
