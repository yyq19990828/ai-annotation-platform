from __future__ import annotations

import pytest

from aap_backend_runtime import deployment_verified_flag


FIRST_PARTY_GATES = (
    "YOLO_MANAGED_LIFECYCLE_VERIFIED",
    "GROUNDED_SAM2_MANAGED_LIFECYCLE_VERIFIED",
    "SAM3_MANAGED_LIFECYCLE_VERIFIED",
    "ONNXTOOLS_MANAGED_LIFECYCLE_VERIFIED",
    "RAPIDOCR_MANAGED_LIFECYCLE_VERIFIED",
)


@pytest.mark.parametrize("name", FIRST_PARTY_GATES)
def test_first_party_deployment_gate_defaults_off(name, monkeypatch) -> None:
    monkeypatch.delenv(name, raising=False)

    assert deployment_verified_flag(name) is False


@pytest.mark.parametrize("name", FIRST_PARTY_GATES)
def test_first_party_deployment_gate_accepts_only_literal_zero_or_one(
    name, monkeypatch
) -> None:
    monkeypatch.setenv(name, "0")
    assert deployment_verified_flag(name) is False

    monkeypatch.setenv(name, "1")
    assert deployment_verified_flag(name) is True

    for invalid in ("", "true", "yes", "2", " 1 "):
        monkeypatch.setenv(name, invalid)
        with pytest.raises(ValueError, match="exactly 0 or 1"):
            deployment_verified_flag(name)
