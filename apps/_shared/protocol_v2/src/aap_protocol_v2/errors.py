"""Shared HTTP error helpers for protocol v2 backends."""

from __future__ import annotations

from fastapi import HTTPException


class VariantNotSupportedError(HTTPException):
    """Requested variant is syntactically valid but unsupported by this backend."""

    def __init__(self, axis: str, value: str, allowed: list[str] | tuple[str, ...]) -> None:
        super().__init__(
            status_code=422,
            detail={
                "error_code": "variant_not_supported",
                "axis": axis,
                "value": value,
                "allowed": list(allowed),
            },
        )


class ModelUnavailableError(HTTPException):
    """Requested model/variant cannot be served by the backend right now."""

    def __init__(self, key: str, reason: str, retry_after_s: int = 30) -> None:
        super().__init__(
            status_code=503,
            detail={
                "error_code": "model_unavailable",
                "key": key,
                "reason": reason,
            },
            headers={"Retry-After": str(retry_after_s)},
        )
