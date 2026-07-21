"""Pre-parser request body limits for frame multipart and gzip mask JSON."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from app.utils.raster_mask_gzip import (
    MAX_COMPRESSED_BYTES,
    MAX_UNCOMPRESSED_BYTES,
    decompress_mask_gzip,
)

ASGIApp = Callable[
    [dict[str, Any], Callable[..., Awaitable[dict]], Callable[..., Awaitable[None]]],
    Awaitable[None],
]

MAX_FRAME_FILE_BYTES = 32 * 1024 * 1024
# Raw multipart includes boundaries and small form fields in addition to the file.
MAX_FRAME_MULTIPART_BODY_BYTES = MAX_FRAME_FILE_BYTES + 1024 * 1024


async def _json_error(send, status: int, detail: Any) -> None:
    body = json.dumps({"detail": detail}, separators=(",", ":")).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def _read_bounded(receive, limit: int) -> bytes:
    body = bytearray()
    more = True
    while more:
        message = await receive()
        if message["type"] == "http.disconnect":
            break
        if message["type"] != "http.request":
            continue
        body.extend(message.get("body", b""))
        if len(body) > limit:
            raise OverflowError
        more = bool(message.get("more_body", False))
    return bytes(body)


def _replacement_receive(body: bytes):
    sent = False

    async def receive() -> dict:
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return receive


def _replace_body_headers(scope: dict[str, Any], body: bytes) -> dict[str, Any]:
    copied = dict(scope)
    copied["headers"] = [
        (name, value)
        for name, value in scope.get("headers", [])
        if name.lower() not in {b"content-length", b"content-encoding"}
    ] + [(b"content-length", str(len(body)).encode())]
    return copied


class UploadBodyLimitMiddleware:
    """Bound selected upload bodies before FastAPI invokes multipart/JSON parsing."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http" or scope.get("method") != "POST":
            await self.app(scope, receive, send)
            return
        path = str(scope.get("path") or "")
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        is_frame = "/ml-backends/" in path and path.endswith(
            ("/predict-frame", "/interactive-annotating-frame")
        )
        is_mask_gzip = (
            path.startswith("/api/v1/tasks/")
            and path.endswith("/mask-content")
            and headers.get(b"content-encoding", b"").lower() == b"gzip"
        )
        is_mask = path.startswith("/api/v1/tasks/") and path.endswith("/mask-content")
        if is_mask and headers.get(b"content-encoding", b"").lower() not in {
            b"",
            b"identity",
            b"gzip",
        }:
            await _json_error(send, 415, "Unsupported Content-Encoding")
            return
        if not is_frame and not is_mask_gzip:
            await self.app(scope, receive, send)
            return

        limit = MAX_FRAME_MULTIPART_BODY_BYTES if is_frame else MAX_COMPRESSED_BYTES
        raw_length = headers.get(b"content-length")
        if raw_length:
            try:
                if int(raw_length) > limit:
                    await _json_error(
                        send,
                        413,
                        {"reason": "request_body_too_large", "max_bytes": limit},
                    )
                    return
            except ValueError:
                await _json_error(send, 400, "Invalid Content-Length")
                return
        try:
            raw = await _read_bounded(receive, limit)
        except OverflowError:
            await _json_error(
                send,
                413,
                {"reason": "request_body_too_large", "max_bytes": limit},
            )
            return
        if is_mask_gzip:
            try:
                body = decompress_mask_gzip(
                    raw,
                    max_compressed=MAX_COMPRESSED_BYTES,
                    max_uncompressed=MAX_UNCOMPRESSED_BYTES,
                )
            except ValueError as exc:
                status = 413 if "exceeds" in str(exc) else 400
                await _json_error(send, status, str(exc))
                return
            scope = _replace_body_headers(scope, body)
            receive = _replacement_receive(body)
        else:
            receive = _replacement_receive(raw)
        await self.app(scope, receive, send)
