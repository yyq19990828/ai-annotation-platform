import json

from app.middleware.upload_body_limits import UploadBodyLimitMiddleware
from app.utils.raster_mask_gzip import compress_mask_gzip


def _receive_chunks(*chunks: bytes):
    index = 0

    async def receive():
        nonlocal index
        body = chunks[index]
        index += 1
        return {
            "type": "http.request",
            "body": body,
            "more_body": index < len(chunks),
        }

    return receive


async def test_mask_content_encoding_gzip_is_decoded_before_json_parser():
    payload = json.dumps(
        {"encoding": "coco_rle", "size": [1, 2], "counts": [1, 1]}
    ).encode()
    compressed = compress_mask_gzip(payload)
    captured = {}

    async def downstream(scope, receive, send):
        captured["scope"] = scope
        captured["message"] = await receive()

    middleware = UploadBodyLimitMiddleware(downstream)
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/tasks/00000000-0000-0000-0000-000000000001/mask-content",
        "headers": [
            (b"content-encoding", b"gzip"),
            (b"content-type", b"application/json"),
            (b"content-length", str(len(compressed)).encode()),
        ],
    }
    await middleware(
        scope, _receive_chunks(compressed[:5], compressed[5:]), lambda _: None
    )
    assert captured["message"]["body"] == payload
    headers = dict(captured["scope"]["headers"])
    assert b"content-encoding" not in headers
    assert headers[b"content-length"] == str(len(payload)).encode()


async def test_mask_gzip_truncation_returns_400_without_downstream():
    called = False
    sent = []

    async def downstream(scope, receive, send):
        nonlocal called
        called = True

    async def send(message):
        sent.append(message)

    compressed = compress_mask_gzip(b"{}")[:-2]
    middleware = UploadBodyLimitMiddleware(downstream)
    await middleware(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/tasks/x/mask-content",
            "headers": [(b"content-encoding", b"gzip")],
        },
        _receive_chunks(compressed),
        send,
    )
    assert called is False
    assert sent[0]["status"] == 400


async def test_frame_body_content_length_rejected_before_multipart_parser():
    called = False
    sent = []

    async def downstream(scope, receive, send):
        nonlocal called
        called = True

    async def send(message):
        sent.append(message)

    middleware = UploadBodyLimitMiddleware(downstream)
    await middleware(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/projects/p/ml-backends/b/predict-frame",
            "headers": [(b"content-length", str(34 * 1024 * 1024).encode())],
        },
        _receive_chunks(b""),
        send,
    )
    assert called is False
    assert sent[0]["status"] == 413
