from __future__ import annotations

import hashlib
import json

import pytest

from scripts import validate_managed_lifecycle as validator


def test_approved_weights_require_exact_hash_manifest(tmp_path, monkeypatch) -> None:
    filenames = ["detect.pt", "segment.pt", "pose.pt", "obb.pt"]
    manifest = {}
    for filename in filenames:
        content = filename.encode()
        (tmp_path / filename).write_bytes(content)
        manifest[filename] = hashlib.sha256(content).hexdigest()
    monkeypatch.setenv("VALIDATION_WEIGHT_SHA256_JSON", json.dumps(manifest))

    records = validator._approved_weights(
        checkpoint_dir=tmp_path,
        filenames=filenames,
        approval_ref="models:approved",
    )

    assert {record["name"] for record in records} == set(filenames)
    assert all(record["approval_ref"] == "models:approved" for record in records)
    assert str(tmp_path) not in str(records)


def test_approved_weights_reject_hash_drift(tmp_path, monkeypatch) -> None:
    weight = tmp_path / "detect.pt"
    weight.write_bytes(b"candidate")
    monkeypatch.setenv(
        "VALIDATION_WEIGHT_SHA256_JSON",
        json.dumps({"detect.pt": "0" * 64}),
    )

    with pytest.raises(RuntimeError, match="approved SHA-256"):
        validator._approved_weights(
            checkpoint_dir=tmp_path,
            filenames=["detect.pt"],
            approval_ref="models:approved",
        )


def test_failure_path_emits_strict_nonpassing_evidence() -> None:
    evidence = validator._failed_evidence(RuntimeError("local path must not leak"))

    assert evidence["schema_version"] == "1"
    assert evidence["passed"] is False
    assert "local path" not in str(evidence)
