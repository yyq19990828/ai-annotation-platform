from __future__ import annotations

import hashlib

import pytest

from scripts import validate_managed_lifecycle as validator


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def test_artifact_gate_accepts_only_approved_model_hashes(
    tmp_path,
    monkeypatch,
) -> None:
    detector = tmp_path / "det.onnx"
    classifier = tmp_path / "va.onnx"
    image = tmp_path / "vehicle.jpg"
    detector.write_bytes(b"approved-detector")
    classifier.write_bytes(b"approved-classifier")
    image.write_bytes(b"representative-vehicle")

    monkeypatch.setenv("ONNXTOOLS_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("ONNXTOOLS_DET_MODEL", detector.name)
    monkeypatch.setenv("ONNXTOOLS_VA_MODEL", classifier.name)
    monkeypatch.setenv("VALIDATION_IMAGE_PATH", str(image))
    monkeypatch.setenv("VALIDATION_DET_SHA256", _sha256(detector.read_bytes()))
    monkeypatch.setenv("VALIDATION_VA_SHA256", _sha256(classifier.read_bytes()))
    monkeypatch.setenv("VALIDATION_MODEL_APPROVAL_REF", "approval:test")

    artifacts = validator._validate_artifacts()

    assert artifacts["approval_ref"] == "approval:test"
    assert artifacts["detector"]["sha256"] == _sha256(detector.read_bytes())
    assert artifacts["vehicle_attribute"]["sha256"] == _sha256(classifier.read_bytes())


def test_artifact_gate_rejects_unapproved_model_hash(tmp_path, monkeypatch) -> None:
    detector = tmp_path / "det.onnx"
    classifier = tmp_path / "va.onnx"
    image = tmp_path / "vehicle.jpg"
    detector.write_bytes(b"candidate-detector")
    classifier.write_bytes(b"candidate-classifier")
    image.write_bytes(b"representative-vehicle")

    monkeypatch.setenv("ONNXTOOLS_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("ONNXTOOLS_DET_MODEL", detector.name)
    monkeypatch.setenv("ONNXTOOLS_VA_MODEL", classifier.name)
    monkeypatch.setenv("VALIDATION_IMAGE_PATH", str(image))
    monkeypatch.setenv("VALIDATION_DET_SHA256", "0" * 64)
    monkeypatch.setenv("VALIDATION_VA_SHA256", _sha256(classifier.read_bytes()))
    monkeypatch.setenv("VALIDATION_MODEL_APPROVAL_REF", "approval:test")

    with pytest.raises(RuntimeError, match="detector model SHA-256 is not approved"):
        validator._validate_artifacts()


def test_memory_gate_requires_ninety_percent_working_set_recovery() -> None:
    accepted = {
        "gpu_total_mb": 24576,
        "context_baseline_mb": [100, 100, 100],
        "cycle_1_loaded_mb": [1100, 1100, 1100],
        "cycle_1_unloaded_mb": [120, 120, 120],
        "cycle_2_loaded_mb": [1100, 1100, 1100],
        "cycle_2_unloaded_mb": [120, 120, 120],
    }
    validator._assert_memory_recovery(accepted)

    rejected = {
        **accepted,
        "cycle_1_unloaded_mb": [250, 250, 250],
        "cycle_2_unloaded_mb": [250, 250, 250],
    }
    with pytest.raises(AssertionError, match="less than 90%"):
        validator._assert_memory_recovery(rejected)


def test_failure_path_emits_strict_nonpassing_evidence() -> None:
    evidence = validator._failed_evidence(RuntimeError("local path must not leak"))

    assert evidence["schema_version"] == "1"
    assert evidence["passed"] is False
    assert "local path" not in str(evidence)
