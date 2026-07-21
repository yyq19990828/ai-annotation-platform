"""Safe platform boundary for native single-frame Mask interactions."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from aap_protocol_v2 import (
    MAX_MASK_DIMENSION,
    MAX_MASK_PIXELS,
    MAX_MASK_RUNS,
    MAX_RLE_OBJECT_BYTES,
    MaskInteractionDiagnostic,
    NativeMaskCandidate,
    native_mask_candidate_id,
)
from fastapi import HTTPException
from pydantic import ValidationError


def _error(status_code: int, reason: str, message: str, **detail: Any) -> None:
    raise HTTPException(
        status_code=status_code,
        detail={"reason": reason, "message": message, **detail},
    )


def prepare_interactive_context(
    context: dict[str, Any],
    capabilities: dict[str, Any] | None,
    *,
    task_id: str,
) -> tuple[dict[str, Any], str | None]:
    """Resolve one image-interactive model and bind native output to a revision.

    Legacy requests that omit both ``output_geometry`` and ``model_id`` retain
    their pre-contract pass-through behavior.
    """

    prepared = dict(context)
    if "output_geometry" not in prepared and "model_id" not in prepared:
        return prepared, None

    prompt = prepared.get("type")
    if not isinstance(prompt, str) or not prompt:
        _error(422, "unsupported_prompt", "context.type must name a prompt")
    output_geometry = prepared.get("output_geometry", "polygon")
    if output_geometry not in ("polygon", "mask"):
        _error(
            422,
            "unsupported_output_geometry",
            "output_geometry must be polygon or mask",
            requested=output_geometry,
        )

    models = [
        model
        for model in (capabilities or {}).get("models", [])
        if isinstance(model, dict)
        and model.get("task") == "interactive_seg"
        and model.get("is_interactive") is True
    ]
    if not models:
        _error(
            503,
            "capability_unavailable",
            "interactive model capability is unavailable",
        )

    requested_model_id = prepared.get("model_id")
    target: dict[str, Any] | None = None
    if requested_model_id is not None:
        target = next(
            (model for model in models if model.get("id") == requested_model_id),
            None,
        )
        if target is None:
            _error(
                422,
                "unknown_model",
                "target interactive model is not available",
                model_id=requested_model_id,
            )
    else:
        prompt_models = [
            model
            for model in models
            if prompt in (model.get("supported_prompts") or [])
        ]
        output_models = [
            model
            for model in prompt_models
            if output_geometry
            in (model.get("supported_geometric_outputs") or [])
        ]
        if len(output_models) == 1:
            target = output_models[0]
        elif len(output_models) > 1:
            _error(
                422,
                "ambiguous_model",
                "multiple interactive models match the request",
                model_ids=[model.get("id") for model in output_models],
            )
        elif len(prompt_models) == 1:
            target = prompt_models[0]
        elif not prompt_models:
            _error(
                422,
                "unsupported_prompt",
                "no interactive model supports the requested prompt",
                requested=prompt,
            )
        else:
            _error(
                422,
                "ambiguous_model",
                "multiple interactive models support the prompt",
                model_ids=[model.get("id") for model in prompt_models],
            )

    assert target is not None
    supported_prompts = list(target.get("supported_prompts") or [])
    if prompt not in supported_prompts:
        _error(
            422,
            "unsupported_prompt",
            "target model does not support the requested prompt",
            model_id=target.get("id"),
            requested=prompt,
            supported_prompts=supported_prompts,
        )
    supported_outputs = list(target.get("supported_geometric_outputs") or [])
    if output_geometry not in supported_outputs:
        _error(
            422,
            "unsupported_output_geometry",
            "target model does not support the requested output geometry",
            model_id=target.get("id"),
            requested=output_geometry,
            supported_geometric_outputs=supported_outputs,
        )

    model_id = str(target.get("id"))
    prepared["model_id"] = model_id
    if output_geometry == "mask":
        revision_context = dict(prepared)
        revision_context.pop("prompt_revision", None)
        revision_bytes = json.dumps(
            {
                "task_id": task_id,
                "model_id": model_id,
                "context": revision_context,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        prepared["prompt_revision"] = hashlib.sha256(revision_bytes).hexdigest()
    return prepared, model_id


def _precheck_rle_budget(raw_candidate: Any, candidate_index: int) -> None:
    if not isinstance(raw_candidate, dict):
        return
    value = raw_candidate.get("value")
    rle = value.get("rle") if isinstance(value, dict) else None
    if not isinstance(rle, dict):
        return
    size = rle.get("size")
    counts = rle.get("counts")
    if isinstance(size, list) and len(size) == 2 and all(
        type(value) is int for value in size
    ):
        height, width = size
        if (
            height > MAX_MASK_DIMENSION
            or width > MAX_MASK_DIMENSION
            or (height > 0 and width > 0 and height * width > MAX_MASK_PIXELS)
        ):
            _error(
                413,
                "mask_payload_too_large",
                "native Mask dimensions exceed the payload budget",
                candidate_index=candidate_index,
            )
    if isinstance(counts, list) and len(counts) > MAX_MASK_RUNS:
        _error(
            413,
            "mask_payload_too_large",
            "native Mask run count exceeds the payload budget",
            candidate_index=candidate_index,
        )
    try:
        canonical_size = len(
            json.dumps(
                {
                    "encoding": rle.get("encoding"),
                    "size": size,
                    "counts": counts,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode()
        )
    except (TypeError, ValueError):
        return
    if canonical_size > MAX_RLE_OBJECT_BYTES:
        _error(
            413,
            "mask_payload_too_large",
            "native Mask RLE exceeds the payload byte budget",
            candidate_index=candidate_index,
        )


def normalize_native_mask_response(
    result: Any,
    diagnostic: Any,
    *,
    context: dict[str, Any],
    expected_size: tuple[int, int] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Validate and canonicalize one native Mask backend response."""

    if context.get("output_geometry", "polygon") != "mask":
        if not isinstance(result, list):
            _error(502, "invalid_backend_response", "backend result must be an array")
        return result, diagnostic if isinstance(diagnostic, dict) else None
    if not isinstance(result, list):
        _error(502, "invalid_mask_payload", "backend Mask result must be an array")

    prompt_revision = context.get("prompt_revision")
    if not isinstance(prompt_revision, str) or not prompt_revision:
        _error(502, "invalid_backend_response", "native Mask revision is missing")

    normalized: list[dict[str, Any]] = []
    for index, raw_candidate in enumerate(result):
        _precheck_rle_budget(raw_candidate, index)
        try:
            candidate = NativeMaskCandidate.model_validate(raw_candidate)
        except ValidationError:
            _error(
                502,
                "invalid_mask_payload",
                "backend returned an invalid native Mask candidate",
                candidate_index=index,
            )
        if expected_size is not None:
            expected_width, expected_height = expected_size
            if candidate.value.rle.size != [expected_height, expected_width]:
                _error(
                    502,
                    "invalid_mask_payload",
                    "backend Mask size does not match task media",
                    candidate_index=index,
                )
        expected_id = native_mask_candidate_id(
            candidate.value.rle,
            prompt_revision=prompt_revision,
            candidate_index=index,
        )
        if candidate.candidate_id != expected_id:
            _error(
                502,
                "invalid_mask_payload",
                "backend Mask candidate_id does not match its pixels and revision",
                candidate_index=index,
            )
        normalized.append(candidate.model_dump(mode="json"))

    if not normalized:
        try:
            parsed_diagnostic = MaskInteractionDiagnostic.model_validate(diagnostic)
        except ValidationError:
            _error(
                502,
                "invalid_mask_payload",
                "empty native Mask result requires an empty_mask diagnostic",
            )
        if parsed_diagnostic.reason != "empty_mask":
            _error(
                502,
                "invalid_mask_payload",
                "empty native Mask result requires an empty_mask diagnostic",
            )
        return [], parsed_diagnostic.model_dump(mode="json", exclude_none=True)

    parsed_diagnostic: dict[str, Any] | None = None
    if diagnostic is not None:
        try:
            parsed_diagnostic = MaskInteractionDiagnostic.model_validate(
                diagnostic
            ).model_dump(mode="json", exclude_none=True)
        except ValidationError:
            _error(
                502,
                "invalid_mask_payload",
                "backend returned an invalid Mask diagnostic",
            )
    return normalized, parsed_diagnostic


__all__ = [
    "normalize_native_mask_response",
    "prepare_interactive_context",
]
