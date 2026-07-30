from __future__ import annotations

import hashlib
import json

import pytest

from scripts import validate_managed_lifecycle as validator


def test_rapidocr_version_uses_distribution_metadata(monkeypatch) -> None:
    monkeypatch.setattr(validator, "distribution_version", lambda name: f"{name}-3.9.0")

    assert validator._rapidocr_version() == "rapidocr-3.9.0"


def test_approved_weights_require_exact_hash_manifest(tmp_path, monkeypatch) -> None:
    relative_paths = ["v5/det.onnx", "v5/cls.onnx", "v5/rec.onnx"]
    manifest = {}
    for relative_path in relative_paths:
        target = tmp_path / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        content = relative_path.encode()
        target.write_bytes(content)
        manifest[relative_path] = hashlib.sha256(content).hexdigest()
    monkeypatch.setenv("VALIDATION_WEIGHT_SHA256_JSON", json.dumps(manifest))

    records = validator._approved_weights(
        model_dir=tmp_path,
        relative_paths=relative_paths,
        approval_ref="models:approved",
    )

    assert {record["name"] for record in records} == {
        "det.onnx",
        "cls.onnx",
        "rec.onnx",
    }
    assert all(record["approval_ref"] == "models:approved" for record in records)
    assert str(tmp_path) not in str(records)


def test_approved_weights_reject_hash_drift(tmp_path, monkeypatch) -> None:
    weight = tmp_path / "v5/det.onnx"
    weight.parent.mkdir(parents=True)
    weight.write_bytes(b"candidate")
    monkeypatch.setenv(
        "VALIDATION_WEIGHT_SHA256_JSON",
        json.dumps({"v5/det.onnx": "0" * 64}),
    )

    with pytest.raises(RuntimeError, match="approved SHA-256"):
        validator._approved_weights(
            model_dir=tmp_path,
            relative_paths=["v5/det.onnx"],
            approval_ref="models:approved",
        )


def test_full_pool_requires_nine_cuda_sessions() -> None:
    sessions = {
        component: ["CUDAExecutionProvider", "CPUExecutionProvider"]
        for component in ("det", "cls", "rec")
    }
    snapshot = {
        "cap": 3,
        "current_size": 3,
        "session_count": 9,
        "gpu_resident": True,
        "device": "cuda",
        "provider": "CUDAExecutionProvider",
        "engines": {
            key: {
                "resident": True,
                "device": "cuda",
                "provider": "CUDAExecutionProvider",
                "sessions": sessions,
            }
            for key in ("mobile", "server", "medium")
        },
    }

    validator._assert_full_gpu_pool(snapshot)

    snapshot["engines"]["medium"]["sessions"]["rec"] = ["CPUExecutionProvider"]
    with pytest.raises(AssertionError):
        validator._assert_full_gpu_pool(snapshot)


def test_failure_path_emits_strict_nonpassing_evidence() -> None:
    evidence = validator._failed_evidence(RuntimeError("local path must not leak"))

    assert evidence["schema_version"] == "1"
    assert evidence["passed"] is False
    assert "local path" not in str(evidence)
