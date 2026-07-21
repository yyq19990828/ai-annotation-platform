from __future__ import annotations

import httpx
import pytest
from aap_protocol_v2 import (
    CocoRlePayload,
    NativeMaskCandidate,
    NativeMaskCandidateValue,
    native_mask_candidate_id,
)
from fastapi import HTTPException

from app.services.ml_client import _bounded_stream_response
from app.services.ml_interaction_proxy import (
    normalize_native_mask_response,
    prepare_interactive_context,
)


def _capabilities(*, interactive_outputs: list[str]) -> dict:
    return {
        "models": [
            {
                "id": "image-interactive",
                "task": "interactive_seg",
                "is_interactive": True,
                "supported_prompts": ["point", "interactive_box"],
                "supported_geometric_outputs": interactive_outputs,
            },
            {
                "id": "video-tracker",
                "task": "tracker",
                "is_interactive": True,
                "supported_prompts": ["bbox"],
                "supported_geometric_outputs": ["bbox", "polygon", "mask"],
            },
        ]
    }


def _candidate(revision: str) -> dict:
    rle = CocoRlePayload(
        encoding="coco_rle",
        size=[2, 3],
        counts=[1, 2, 2, 1],
    )
    return NativeMaskCandidate(
        value=NativeMaskCandidateValue(rle=rle, masklabels=["object"]),
        score=0.9,
        candidate_id=native_mask_candidate_id(
            rle,
            prompt_revision=revision,
            candidate_index=0,
        ),
    ).model_dump(mode="json")


def test_tracker_mask_capability_does_not_authorize_image_model() -> None:
    with pytest.raises(HTTPException) as raised:
        prepare_interactive_context(
            {"type": "point", "output_geometry": "mask"},
            _capabilities(interactive_outputs=["polygon"]),
            task_id="task-1",
        )
    assert raised.value.status_code == 422
    assert raised.value.detail["reason"] == "unsupported_output_geometry"
    assert raised.value.detail["model_id"] == "image-interactive"


def test_native_context_resolves_model_and_replaces_client_revision() -> None:
    context, model_id = prepare_interactive_context(
        {
            "type": "point",
            "points": [[0.25, 0.5]],
            "output_geometry": "mask",
            "prompt_revision": "client-controlled",
        },
        _capabilities(interactive_outputs=["polygon", "mask"]),
        task_id="task-1",
    )
    assert model_id == "image-interactive"
    assert context["model_id"] == model_id
    assert context["prompt_revision"] != "client-controlled"
    assert len(context["prompt_revision"]) == 64


def test_native_response_preserves_non_square_rle() -> None:
    context, _ = prepare_interactive_context(
        {"type": "point", "output_geometry": "mask"},
        _capabilities(interactive_outputs=["polygon", "mask"]),
        task_id="task-1",
    )
    raw = _candidate(context["prompt_revision"])
    result, diagnostic = normalize_native_mask_response(
        [raw],
        None,
        context=context,
        expected_size=(3, 2),
    )
    assert result == [raw]
    assert diagnostic is None


def test_native_response_rejects_candidate_id_mismatch() -> None:
    context, _ = prepare_interactive_context(
        {"type": "point", "output_geometry": "mask"},
        _capabilities(interactive_outputs=["polygon", "mask"]),
        task_id="task-1",
    )
    raw = _candidate(context["prompt_revision"])
    raw["candidate_id"] = "sha256:" + "0" * 64
    with pytest.raises(HTTPException) as raised:
        normalize_native_mask_response([raw], None, context=context)
    assert raised.value.status_code == 502
    assert raised.value.detail["reason"] == "invalid_mask_payload"


def test_native_response_classifies_oversized_dimension_as_413() -> None:
    context = {"output_geometry": "mask", "prompt_revision": "revision"}
    raw = {
        "type": "mask",
        "value": {
            "rle": {
                "encoding": "coco_rle",
                "size": [1, 4097],
                "counts": [4097],
            },
            "masklabels": ["object"],
        },
        "score": 0.5,
        "candidate_id": "sha256:" + "0" * 64,
    }
    with pytest.raises(HTTPException) as raised:
        normalize_native_mask_response([raw], None, context=context)
    assert raised.value.status_code == 413
    assert raised.value.detail["reason"] == "mask_payload_too_large"


def test_empty_native_response_requires_and_keeps_diagnostic() -> None:
    context = {"output_geometry": "mask", "prompt_revision": "revision"}
    result, diagnostic = normalize_native_mask_response(
        [],
        {"reason": "empty_mask", "retryable": False},
        context=context,
    )
    assert result == []
    assert diagnostic == {"reason": "empty_mask", "retryable": False}

    with pytest.raises(HTTPException) as raised:
        normalize_native_mask_response([], None, context=context)
    assert raised.value.status_code == 502
    assert raised.value.detail["reason"] == "invalid_mask_payload"


class _ChunkStream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks

    async def __aiter__(self):
        for chunk in self._chunks:
            yield chunk


@pytest.mark.asyncio
async def test_bounded_response_rejects_declared_size_before_read() -> None:
    response = httpx.Response(
        200,
        headers={"content-length": "5"},
        stream=_ChunkStream([b"12345"]),
        request=httpx.Request("POST", "http://backend/predict"),
    )
    with pytest.raises(HTTPException) as raised:
        await _bounded_stream_response(response, max_bytes=4)
    assert raised.value.status_code == 413
    assert raised.value.detail["reason"] == "mask_response_too_large"


@pytest.mark.asyncio
async def test_bounded_response_rejects_chunked_overflow() -> None:
    response = httpx.Response(
        200,
        stream=_ChunkStream([b"12", b"345"]),
        request=httpx.Request("POST", "http://backend/predict"),
    )
    with pytest.raises(HTTPException) as raised:
        await _bounded_stream_response(response, max_bytes=4)
    assert raised.value.status_code == 413
    assert raised.value.detail["reason"] == "mask_response_too_large"


@pytest.mark.asyncio
async def test_bounded_response_accepts_exact_limit() -> None:
    response = httpx.Response(
        200,
        stream=_ChunkStream([b"12", b"34"]),
        request=httpx.Request("POST", "http://backend/predict"),
    )
    bounded = await _bounded_stream_response(response, max_bytes=4)
    assert bounded.content == b"1234"
