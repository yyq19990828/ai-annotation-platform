# 0039 — Protocol field name unification with model_variants

- **Status:** Accepted
- **Date:** 2026-06-08
- **Deciders:** core team
- **Supersedes:** —

## Context

Protocol v2 added multi-model capability metadata, but `/predict.context` still used backend-specific variant fields:

| Backend | Existing fields |
|---|---|
| yolo-backend | `context.variants.{series,size}` |
| grounded-sam2-backend | `context.sam_variant` / `context.dino_variant` |
| sam3-backend | `context.model_variant` |

The frontend already learned generic axes from `/setup.supported_variants[]`, yet request construction still needed backend-specific mapping. Error behavior also drifted: yolo used 400 for unsupported combinations, grounded-sam2 used 422 for invalid variants, and model-unavailable cases were not consistently distinguishable from backend bugs.

Inference parameter names had a different problem. `conf`, `iou`, `box_threshold`, `text_threshold`, `score_threshold`, and `simplify_tolerance` are not exact synonyms across model families. Physically renaming them into one shared shape would hide useful model-specific semantics and force extra adapter code into every backend.

## Decision

Protocol v2.1 introduces `context.model_variants: dict[str, str]`.

The dict keys are axis keys declared by `/setup.supported_variants[].key`; values are the selected axis values. Examples:

```json
{ "model_variants": { "series": "yolov11", "size": "s" } }
{ "model_variants": { "sam_variant": "tiny", "dino_variant": "T" } }
{ "model_variants": { "model_variant": "sam3.1" } }
```

Backends keep a v2.0 compatibility path for one release line:

- yolo `context.variants` fills missing `model_variants` axes.
- grounded-sam2 top-level `context.sam_variant` / `context.dino_variant` fill missing axes.
- sam3 top-level `context.model_variant` fills the missing axis.
- If both new and old fields are present, the new field wins and the old field only logs a deprecation warning.

Inference parameter physical names stay backend-specific. `/setup.params.properties.*` may declare `x-platform-role` with a controlled value such as `confidence`, `iou`, `maxDet`, `textThreshold`, `simplifyTolerance`, or `modelVariant`. The frontend uses the role for labels and placement, but the request still sends the original parameter key.

Error handling is standardized:

- Unsupported variant value or combination returns 422 with `error_code=variant_not_supported`.
- A supported variant that cannot currently be served returns 503 with `error_code=model_unavailable` and `Retry-After`.
- Other backend 5xx errors remain backend failures and may be surfaced through the platform as 502.

`/setup.protocol_version` is bumped to `"2.1"` and `compat_protocol_versions` declares `"2.0"` compatibility.

## Consequences

Positive:

- The frontend can build predict requests from capability metadata without backend-specific variant mapping.
- Backend-specific threshold semantics remain visible and do not require lossy renames.
- Error handling can present actionable UX: parameter errors, retryable model-unavailable states, and service failures are distinct.
- External backend authors get a small migration path instead of a v3 rewrite.

Negative:

- Backends must maintain compatibility normalization for one release line.
- `x-platform-role` adds a small schema maintenance burden; misspelled role strings would reduce frontend label quality.
- `model_variants` is generic but not self-validating. Backend runtime validation remains required.

## Alternatives Considered

### Keep backend-specific variant fields

This would avoid backend changes but keep the frontend mapping problem unsolved. Every new backend would add another request-shaping branch.

### Rename every axis into shared physical fields

This fails for multi-axis and future backends. `series/size`, `sam_variant/dino_variant`, and `model_variant` are not one common finite field set.

### Physically unify inference parameter names

Rejected because parameters are model-family-specific. `conf`, `score_threshold`, and `box_threshold` are all confidence-like, but they are applied at different stages. A role metadata layer preserves display consistency without hiding semantics.

### Move variants under `params`

Rejected because variants control model selection and pool keys, while params control inference behavior. Keeping `model_variants` separate lets the frontend exclude variants from ordinary parameter forms and lets runtime observability key off the same axis dict.

## Notes

- Shared helpers and error classes live in `apps/_shared/protocol_v2/`.
- Related ADRs: ADR-0020 capability negotiation, ADR-0036 protocol v2 multi-model catalog, ADR-0038 shared schemas without a backend base class.
