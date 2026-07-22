from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.observability.mask_ai import refresh_mask_ai_inventory
from app.observability.metrics import (
    MASK_AI_ACCEPT_DECISIONS,
    MASK_AI_CORRECTION_JOBS,
    MASK_AI_CORRECTION_OLDEST_AGE_SECONDS,
    MASK_AI_OLDEST_EXPIRED_DECISION_AGE_SECONDS,
    MASK_AI_OPERATIONS_TOTAL,
    MASK_AI_PHASE_DURATION_SECONDS,
    MASK_AI_STAGED_MASK_REFERENCES,
    mask_ai_candidate_count_bucket,
    mask_ai_operation,
    mask_ai_prompt_family,
    observe_mask_ai_phase,
    record_mask_ai_operation,
)


def _counter_value(**labels: str) -> float:
    return float(MASK_AI_OPERATIONS_TOTAL.labels(**labels)._value.get())


def test_mask_ai_operation_metric_uses_only_controlled_labels() -> None:
    labels = {
        "operation": "single_frame",
        "prompt_family": "unknown",
        "output_geometry": "unknown",
        "candidate_count": "11_plus",
        "decision": "none",
        "fallback_reason": "unknown",
        "outcome": "error",
    }
    before = _counter_value(**labels)
    record_mask_ai_operation(
        operation="task-8de9d047",
        prompt_family="user secret",
        output_geometry="raster-masks/sha256/secret",
        candidate_count=99,
        decision="annotation-id",
        fallback_reason="backend-id",
        outcome="unexpected",
    )
    assert _counter_value(**labels) == before + 1


def test_mask_ai_classifiers_and_phase_histogram() -> None:
    assert mask_ai_operation({"type": "point"}) == "single_frame"
    assert mask_ai_operation({"type": "scribble", "mask_input": "opaque"}) == "refine"
    assert mask_ai_prompt_family({"type": "interactive_box"}) == "bbox"
    assert mask_ai_prompt_family({"type": "text"}) == "text"
    assert [mask_ai_candidate_count_bucket(value) for value in (0, 1, 3, 10, 11)] == [
        "0",
        "1",
        "2_3",
        "4_10",
        "11_plus",
    ]
    child = MASK_AI_PHASE_DURATION_SECONDS.labels(
        operation="refine", phase="commit", outcome="conflict"
    )
    before = float(child._sum.get())
    observe_mask_ai_phase(
        operation="refine",
        phase="commit",
        outcome="conflict",
        duration_seconds=0.25,
    )
    assert float(child._sum.get()) == pytest.approx(before + 0.25)


@pytest.mark.asyncio
async def test_inventory_refresh_sets_fixed_zero_series() -> None:
    db = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                SimpleNamespace(all=lambda: [("queued", 2), ("accepted", 3)]),
                SimpleNamespace(all=lambda: [("queued", 12.5)]),
                SimpleNamespace(all=lambda: [("correction", 4)]),
                SimpleNamespace(one=lambda: (5, 1, 42.0)),
            ]
        )
    )

    result = await refresh_mask_ai_inventory(db)

    assert result["correction_jobs"] == {"queued": 2, "accepted": 3}
    assert MASK_AI_CORRECTION_JOBS.labels(status="queued")._value.get() == 2
    assert MASK_AI_CORRECTION_JOBS.labels(status="running")._value.get() == 0
    assert (
        MASK_AI_CORRECTION_OLDEST_AGE_SECONDS.labels(status="queued")._value.get()
        == 12.5
    )
    assert (
        MASK_AI_STAGED_MASK_REFERENCES.labels(job_kind="correction")._value.get()
        == 4
    )
    assert MASK_AI_STAGED_MASK_REFERENCES.labels(job_kind="tracking")._value.get() == 0
    assert MASK_AI_ACCEPT_DECISIONS.labels(state="active")._value.get() == 5
    assert MASK_AI_ACCEPT_DECISIONS.labels(state="expired")._value.get() == 1
    assert MASK_AI_OLDEST_EXPIRED_DECISION_AGE_SECONDS._value.get() == 42


@pytest.mark.asyncio
async def test_inventory_refresh_queries_the_real_schema(db_session) -> None:
    result = await refresh_mask_ai_inventory(db_session)

    assert set(result) == {
        "correction_jobs",
        "correction_oldest_age_seconds",
        "staged_mask_references",
        "accept_decisions",
        "oldest_expired_decision_age_seconds",
    }
    assert set(result["accept_decisions"]) == {"active", "expired"}
