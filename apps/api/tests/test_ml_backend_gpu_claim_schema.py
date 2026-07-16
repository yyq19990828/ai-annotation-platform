from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.ml_backend import (
    HealthMeta,
    MLBackendCreate,
    MLBackendRegistryCreate,
    MLBackendRegistryUpdate,
)


def _payload(**overrides):
    return {"name": "gpu-backend", "url": "http://gpu-backend:8000", **overrides}


def test_registry_create_accepts_one_strong_typed_gpu_claim() -> None:
    payload = MLBackendRegistryCreate.model_validate(
        _payload(
            gpu_resource_id="node-a/GPU-aaa",
            vram_budget_mb=22000,
            eviction_priority=-10,
        )
    )

    assert payload.gpu_resource_id == "node-a/GPU-aaa"
    assert payload.vram_budget_mb == 22000
    assert payload.eviction_priority == -10


@pytest.mark.parametrize(
    "claim",
    [
        {"gpu_resource_id": "node-a/GPU-aaa"},
        {"vram_budget_mb": 22000},
        {"gpu_resource_id": "node-a/GPU-a,GPU-b", "vram_budget_mb": 22000},
        {"gpu_resource_id": "node-a/GPU aaa", "vram_budget_mb": 22000},
        {"gpu_resource_id": "GPU-aaa", "vram_budget_mb": 22000},
        {"gpu_resource_id": "node-a/cuda:0", "vram_budget_mb": 22000},
        {"gpu_resource_id": "node-a/index:-1", "vram_budget_mb": 22000},
        {"gpu_resource_id": "node-a/banana", "vram_budget_mb": 22000},
        {"gpu_resource_id": "node-a/GPU-aaa", "vram_budget_mb": "22000"},
        {"gpu_resource_id": "node-a/GPU-aaa", "vram_budget_mb": True},
        {"gpu_resource_id": "node-a/GPU-aaa", "vram_budget_mb": 0},
    ],
)
def test_registry_create_rejects_incomplete_multi_or_weak_claim(claim: dict) -> None:
    with pytest.raises(ValidationError):
        MLBackendRegistryCreate.model_validate(_payload(**claim))


def test_registry_update_keeps_claim_partial_but_rejects_null_priority() -> None:
    update = MLBackendRegistryUpdate.model_validate({"vram_budget_mb": 18000})
    assert update.model_dump(exclude_unset=True) == {"vram_budget_mb": 18000}

    with pytest.raises(ValidationError):
        MLBackendRegistryUpdate.model_validate({"eviction_priority": None})


def test_project_payload_ignores_and_cannot_smuggle_global_gpu_claim() -> None:
    payload = MLBackendCreate.model_validate(
        _payload(
            gpu_resource_id="node-a/GPU-aaa",
            vram_budget_mb=22000,
        )
    )

    assert "gpu_resource_id" not in payload.model_dump()
    assert "vram_budget_mb" not in payload.model_dump()


def test_health_meta_preserves_physical_identity_process_memory_and_residency() -> None:
    health = HealthMeta.model_validate(
        {
            "gpu_info": {
                "device_index": 1,
                "device_uuid": "GPU-aaa",
                "mig_uuid": "MIG-bbb",
                "physical_device_token": "MIG-bbb",
                "process_memory_mb": 4096,
            },
            "residency": {
                "state": "unknown",
                "gpu_loaded": None,
                "active_requests": 0,
                "builders": 1,
                "borrowers": 0,
                "evictable": False,
                "pools": {
                    "models": {"resident": None, "provider": "CUDAExecutionProvider"}
                },
            },
        }
    ).model_dump()

    assert health["gpu_info"]["device_uuid"] == "GPU-aaa"
    assert health["gpu_info"]["mig_uuid"] == "MIG-bbb"
    assert health["gpu_info"]["process_memory_mb"] == 4096
    assert health["residency"]["state"] == "unknown"
    assert health["residency"]["builders"] == 1
