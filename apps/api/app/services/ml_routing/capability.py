"""v0.23.3 ADR-0050 §7 / §B.5 · capability canonicalization, fingerprint, diff.

A service pool represents interchangeable logical capability. Members join only on
exact fingerprint match (ADR-0050 D3); mismatch → 409 ``ml_backend_pool_capability_mismatch``
with a structured diff. Active members whose health refresh later shows fingerprint
drift are atomically disabled (§7.3).

The fingerprint is a SHA-256 of a canonical JSON encoding of routing-relevant
capability fields ONLY — it deliberately excludes URL, instance name, auth, GPU UUID,
VRAM, residency, cache, and display-only metadata (so replicas of the same model are
interchangeable). Field order, list order, and missing-vs-default must NOT change the
fingerprint (golden fixture §C.1).

This module is the single source of truth for canonicalization; the frontend must not
re-implement it (ADR-0050 §7).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

# Default values filled when a capability field is missing, so "omitted" and
# "explicitly default" produce the same fingerprint (golden fixture §C.1).
_DEFAULTS: dict[str, Any] = {
    "protocol_version": "1",
    "model_ids": [],
    "task": None,
    "modality": None,
    "infra": None,
    "model_version": None,
    "weights_version": None,
    "supported_prompts": [],
    "supported_inputs": [],
    "supported_outputs": [],
    "supported_trackers": [],
    "parameter_schema": {},
    "variant_axes": [],
    "stateful": False,
    "batchable": False,
    "warmup": False,
}

# Canonical field order (frozen; changing it changes every fingerprint).
_CANONICAL_FIELDS: tuple[str, ...] = (
    "protocol_version",
    "model_ids",
    "task",
    "modality",
    "infra",
    "model_version",
    "weights_version",
    "supported_prompts",
    "supported_inputs",
    "supported_outputs",
    "supported_trackers",
    "parameter_schema",
    "variant_axes",
    "stateful",
    "batchable",
    "warmup",
)

# Fields that are always excluded from routing fingerprint (runtime/display-only).
# Listed for documentation; the canonicalization only reads _CANONICAL_FIELDS so
# anything not listed there is implicitly excluded.
_EXCLUDED_FIELDS = frozenset(
    {
        "url",
        "name",
        "instance_name",
        "auth_method",
        "auth_token",
        "last_checked_at",
        "gpu_resource_id",
        "vram_budget_mb",
        "gpu_uuid",
        "memory_used_mb",
        "temperature",
        "residency",
        "model_loaded",
        "cache",
        "description",
    }
)


def _sorted_unique(value: list[Any]) -> list[Any]:
    """Sort a list of comparable scalars and dedupe, preserving JSON-serializability."""
    if not value:
        return []
    # Capability lists are strings or dicts-with-stable-keys; sort by JSON repr for determinism.
    return sorted({json.dumps(v, sort_keys=True, ensure_ascii=False): v for v in value}.values())


def _canonicalize_list_field(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return _sorted_unique(list(value))
    return [value]


def _canonicalize_param_schema(value: Any) -> dict:
    """Parameter schema: keep only fields that affect request legality.

    The full backend ``/setup.params`` may include display hints, defaults, UI ordering.
    For routing equivalence we only need the schema *shape* (which params are required,
    their types, and enum constraints) — two backends whose params render differently
    but accept the same request payload are interchangeable.
    """
    if not isinstance(value, dict):
        return {}
    # Normalize: sort keys, drop display-only sibling keys.
    display_only = {"label", "description", "placeholder", "order", "group", "help_text"}
    out: dict[str, Any] = {}
    for key in sorted(value):
        field_def = value[key]
        if not isinstance(field_def, dict):
            out[key] = field_def
            continue
        norm = {k: field_def[k] for k in sorted(field_def) if k not in display_only}
        out[key] = norm
    return out


def _canonicalize_variant_axes(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    out = []
    for axis in value:
        if not isinstance(axis, dict):
            continue
        norm = {
            "key": axis.get("key"),
            "values": _canonicalize_list_field(axis.get("values")),
            "default": axis.get("default"),
        }
        out.append(norm)
    # Stable order by axis key.
    out.sort(key=lambda a: json.dumps(a.get("key"), sort_keys=True, ensure_ascii=False))
    return out


def canonicalize_capability(raw: dict | None) -> dict:
    """Build the canonical routing-capability snapshot from a raw ``/setup`` / health_meta dict.

    Applies: defaults fill, list sort+dedupe, param-schema display-field strip,
    variant-axis normalization, fixed field order. Deterministic regardless of input
    field/list ordering or omitted-vs-default fields (golden fixture §C.1).
    """
    raw = raw or {}
    caps = raw.get("capabilities") if "capabilities" in raw else raw
    caps = caps if isinstance(caps, dict) else {}

    canonical: dict[str, Any] = {}
    for field_name in _CANONICAL_FIELDS:
        if field_name == "parameter_schema":
            canonical[field_name] = _canonicalize_param_schema(caps.get(field_name))
        elif field_name == "variant_axes":
            canonical[field_name] = _canonicalize_variant_axes(caps.get(field_name))
        elif field_name in {
            "model_ids",
            "supported_prompts",
            "supported_inputs",
            "supported_outputs",
            "supported_trackers",
        }:
            canonical[field_name] = _canonicalize_list_field(caps.get(field_name))
        elif field_name in {"stateful", "batchable", "warmup"}:
            canonical[field_name] = bool(caps.get(field_name, _DEFAULTS[field_name]))
        else:
            canonical[field_name] = caps.get(field_name, _DEFAULTS[field_name])
    return canonical


def capability_fingerprint(raw_or_canonical: dict | None) -> str:
    """SHA-256 hex (64 chars) of the canonical capability snapshot.

    Accepts either a raw ``/setup`` dict (canonicalized internally) or an already-
    canonicalized dict. Deterministic across field/list order and missing defaults.
    """
    if raw_or_canonical is None:
        raw_or_canonical = {}
    # Detect already-canonical input: it has exactly the canonical field set.
    if set(raw_or_canonical.keys()) == set(_CANONICAL_FIELDS):
        canonical = raw_or_canonical
    else:
        canonical = canonicalize_capability(raw_or_canonical)
    encoded = json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class CapabilityMismatch:
    """Structured diff between two canonical snapshots (returned with 409)."""

    pool_fingerprint: str
    candidate_fingerprint: str
    differing_fields: tuple[str, ...]


def diff_capabilities(
    pool_snapshot: dict | None, candidate_snapshot: dict | None
) -> CapabilityMismatch | None:
    """Compare two canonical snapshots field-by-field. Returns None if identical.

    Used when adding a member to a pool: exact match required (ADR-0050 D3 / §7.3).
    On mismatch returns the field names that differ for the 409 response body.
    """
    pool_canon = canonicalize_capability(pool_snapshot)
    cand_canon = canonicalize_capability(candidate_snapshot)
    differing = tuple(
        f
        for f in _CANONICAL_FIELDS
        if pool_canon.get(f) != cand_canon.get(f)
    )
    if not differing:
        return None
    return CapabilityMismatch(
        pool_fingerprint=capability_fingerprint(pool_canon),
        candidate_fingerprint=capability_fingerprint(cand_canon),
        differing_fields=differing,
    )
