from __future__ import annotations

import base64
import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.sql.elements import ColumnElement


def encode_cursor(*, field: str, direction: str, value: Any, tie: str) -> str:
    if hasattr(value, "isoformat"):
        value = value.isoformat()
    raw = json.dumps(
        {"field": field, "direction": direction, "value": value, "tie": tie},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str, *, field: str, direction: str) -> tuple[Any, str]:
    try:
        padding = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(cursor + padding))
        if payload.get("field") != field or payload.get("direction") != direction:
            raise ValueError("cursor sort mismatch")
        tie = payload.get("tie")
        if not isinstance(tie, str) or not tie:
            raise ValueError("missing cursor tie")
        return payload.get("value"), tie
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=422, detail="Invalid Data Manager cursor"
        ) from exc


def keyset_after(
    sort_expr: ColumnElement[Any],
    tie_expr: ColumnElement[Any],
    *,
    direction: str,
    value: Any,
    tie: Any,
) -> ColumnElement[bool]:
    comparison = sort_expr < value if direction == "desc" else sort_expr > value
    return or_(comparison, and_(sort_expr == value, tie_expr > tie))
