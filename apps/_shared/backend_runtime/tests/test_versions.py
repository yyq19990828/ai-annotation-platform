"""versions_payload: 形状 + extra 字段透传。"""

from __future__ import annotations

from aap_backend_runtime import versions_payload


def test_versions_payload_basic() -> None:
    assert versions_payload("m-1", "b-2") == {
        "versions": ["m-1"],
        "backend_version": "b-2",
    }


def test_versions_payload_extra() -> None:
    out = versions_payload("ultralytics-8.4.x", "0.1.1", ultralytics="8.4.0")
    assert out == {
        "versions": ["ultralytics-8.4.x"],
        "backend_version": "0.1.1",
        "ultralytics": "8.4.0",
    }
