"""Predict request helpers for protocol v2.1."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

LEGACY_CONTEXT_VARIANT_FIELDS = (
    "variants",
    "sam_variant",
    "dino_variant",
    "model_variant",
)


def normalize_context_model_variants(
    context: Mapping[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Return a context dict with legacy variant fields merged into ``model_variants``.

    New ``context.model_variants`` values take precedence. Legacy fields fill missing
    axes so old clients keep working during the v2.0 -> v2.1 compatibility window.
    """

    normalized = dict(context)
    model_variants: dict[str, str] = {}
    deprecated_paths: list[str] = []

    raw_model_variants = normalized.get("model_variants")
    if raw_model_variants is not None:
        model_variants.update(
            _string_dict(
                _as_mapping(raw_model_variants, "context.model_variants"),
                "context.model_variants",
            )
        )

    raw_variants = normalized.get("variants")
    if raw_variants is not None:
        deprecated_paths.append("context.variants")
        for axis, value in _string_dict(
            _as_mapping(raw_variants, "context.variants"),
            "context.variants",
        ).items():
            model_variants.setdefault(axis, value)

    for field in ("sam_variant", "dino_variant", "model_variant"):
        value = normalized.get(field)
        if value is None:
            continue
        deprecated_paths.append(f"context.{field}")
        model_variants.setdefault(field, str(value))

    if model_variants:
        normalized["model_variants"] = model_variants
    return normalized, deprecated_paths


def log_deprecated_model_variant_fields(
    logger: logging.Logger,
    deprecated_paths: list[str],
) -> None:
    if deprecated_paths:
        logger.warning(
            "deprecation: %s -> context.model_variants",
            ", ".join(sorted(set(deprecated_paths))),
        )


def _string_dict(raw: Mapping[str, Any], field_name: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for axis, value in raw.items():
        if value is None:
            continue
        if not isinstance(axis, str):
            raise ValueError(f"{field_name} keys must be strings")
        out[axis] = str(value)
    return out


def _as_mapping(raw: Any, field_name: str) -> Mapping[str, Any]:
    if isinstance(raw, Mapping):
        return raw
    model_dump = getattr(raw, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump()
        if isinstance(dumped, Mapping):
            return dumped
    raise ValueError(f"{field_name} must be an object")
