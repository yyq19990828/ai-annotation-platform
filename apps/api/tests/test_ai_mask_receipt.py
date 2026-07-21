import pytest

from app.services.ai_mask_receipt import (
    AiMaskReceiptError,
    RECEIPT_TTL_SECONDS,
    issue_ai_mask_receipt,
    verify_ai_mask_receipt,
)


def test_ai_mask_receipt_roundtrip_and_expiry():
    token = issue_ai_mask_receipt(
        {"task_id": "task-1", "candidate_id": "candidate-1"}, now=100
    )
    claims = verify_ai_mask_receipt(token, now=99 + RECEIPT_TTL_SECONDS)
    assert claims["task_id"] == "task-1"
    assert claims["candidate_id"] == "candidate-1"

    with pytest.raises(AiMaskReceiptError) as caught:
        verify_ai_mask_receipt(token, now=100 + RECEIPT_TTL_SECONDS)
    assert caught.value.reason == "candidate_receipt_expired"


def test_ai_mask_receipt_rejects_tampering():
    token = issue_ai_mask_receipt({"task_id": "task-1"}, now=100)
    encoded, signature = token.split(".", 1)
    tampered = f"{encoded[:-1]}A.{signature}"
    with pytest.raises(AiMaskReceiptError) as caught:
        verify_ai_mask_receipt(tampered, now=100)
    assert caught.value.reason == "invalid_candidate_receipt"


def test_ai_mask_receipt_rejects_reserved_claims_and_future_issued_at():
    with pytest.raises(ValueError, match="reserved"):
        issue_ai_mask_receipt({"exp": 999}, now=100)

    token = issue_ai_mask_receipt({"task_id": "task-1"}, now=200)
    with pytest.raises(AiMaskReceiptError) as caught:
        verify_ai_mask_receipt(token, now=100)
    assert caught.value.reason == "invalid_candidate_receipt"
