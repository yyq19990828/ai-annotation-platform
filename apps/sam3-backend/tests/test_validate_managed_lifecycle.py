from __future__ import annotations

import hashlib

import pytest

from scripts import validate_managed_lifecycle as validator


def test_approved_artifact_requires_exact_hash(tmp_path, monkeypatch) -> None:
    weight = tmp_path / "sam3.pt"
    weight.write_bytes(b"approved-sam3")
    monkeypatch.setenv(
        "VALIDATION_SAM3_SHA256",
        hashlib.sha256(weight.read_bytes()).hexdigest(),
    )

    record = validator._approved_artifact(
        weight,
        kind="weight",
        approval_ref="models:approved",
        expected_sha_env="VALIDATION_SAM3_SHA256",
    )

    assert record["name"] == "sam3.pt"
    assert record["approval_ref"] == "models:approved"
    assert str(tmp_path) not in str(record)


def test_approved_artifact_rejects_hash_drift(tmp_path, monkeypatch) -> None:
    weight = tmp_path / "sam3.pt"
    weight.write_bytes(b"candidate")
    monkeypatch.setenv("VALIDATION_SAM3_SHA256", "0" * 64)

    with pytest.raises(RuntimeError, match="approved SHA-256"):
        validator._approved_artifact(
            weight,
            kind="weight",
            approval_ref="models:approved",
            expected_sha_env="VALIDATION_SAM3_SHA256",
        )


def test_failure_path_emits_strict_nonpassing_evidence() -> None:
    evidence = validator._failed_evidence(RuntimeError("local path must not leak"))

    assert evidence["schema_version"] == "1"
    assert evidence["passed"] is False
    assert "local path" not in str(evidence)
