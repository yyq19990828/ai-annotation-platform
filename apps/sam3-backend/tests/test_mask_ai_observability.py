from observability import (
    MASK_AI_BACKEND_INFERENCE_SECONDS,
    MASK_AI_BACKEND_INFERENCE_TOTAL,
    record_mask_ai_backend_inference,
)


def test_mask_ai_backend_metrics_normalize_untrusted_labels() -> None:
    counter = MASK_AI_BACKEND_INFERENCE_TOTAL.labels(
        model_role="sam3_pvs",
        operation="tracking",
        fallback_reason="none",
        candidate_count="11_plus",
        outcome="error",
    )
    histogram = MASK_AI_BACKEND_INFERENCE_SECONDS.labels(
        model_role="sam3_pvs",
        operation="tracking",
        outcome="error",
    )
    counter_before = float(counter._value.get())
    duration_before = float(histogram._sum.get())

    record_mask_ai_backend_inference(
        model_role="sam3_pvs",
        operation="untrusted-operation",
        fallback_reason="task-id",
        candidate_count=99,
        outcome="untrusted-outcome",
        duration_seconds=0.25,
    )

    assert float(counter._value.get()) == counter_before + 1
    assert float(histogram._sum.get()) == duration_before + 0.25
