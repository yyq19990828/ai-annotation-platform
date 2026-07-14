from __future__ import annotations

import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import ValidationError

from aap_protocol_v2.errors import LifecycleErrorCode, LifecycleHTTPError
from aap_protocol_v2.lifecycle import (
    AdmissionScope,
    AdmissionTokenClaims,
    AdmissionTokenError,
    BackendResidency,
    BoundLifecycleIdentity,
    DrainTransitionResponse,
    GPU_ADMISSION_TOKEN_HEADER,
    GPU_ADMISSION_TOKEN_TYPE,
    GPU_GENERATION_HEADER,
    GenerationTransitionRequest,
    LifecycleModeRequest,
    ManagedLifecycleCapabilities,
    ManagedUnloadResponse,
    PoolResidency,
    encode_ed25519_public_key,
    load_verify_keyring,
    sign_admission_token,
    validate_canonical_positive_int64,
    verify_admission_token,
)


@pytest.mark.parametrize(
    "value",
    ["1", "42", "9223372036854775807"],
)
def test_canonical_positive_int64_accepts_bounds(value: str) -> None:
    assert validate_canonical_positive_int64(value) == value


@pytest.mark.parametrize(
    "value",
    ["", "0", "00", "01", "+1", "-1", " 1", "1 ", "1.0", "9223372036854775808"],
)
def test_canonical_positive_int64_rejects_non_canonical_values(value: str) -> None:
    with pytest.raises(ValueError):
        validate_canonical_positive_int64(value)


def test_generation_and_control_epoch_reject_json_numbers() -> None:
    with pytest.raises(ValidationError):
        GenerationTransitionRequest.model_validate({"generation": 1})
    with pytest.raises(ValidationError):
        LifecycleModeRequest.model_validate({"gate": "enforce", "control_epoch": 1})


def test_managed_lifecycle_capability_payload_matches_adr() -> None:
    assert ManagedLifecycleCapabilities().model_dump(mode="json") == {
        "protocol_version": "1",
        "generation_fencing": True,
        "drain_endpoint": "/drain",
        "drain_cancel_endpoint": "/drain/cancel",
        "unload_endpoint": "/unload",
        "mode_endpoint": "/lifecycle/mode",
        "reset_endpoint": "/lifecycle/reset",
        "generation_header": GPU_GENERATION_HEADER,
        "token_header": GPU_ADMISSION_TOKEN_HEADER,
    }


def _residency(**overrides) -> BackendResidency:
    payload = {
        "state": "resident",
        "gpu_loaded": True,
        "active_requests": 0,
        "builders": 0,
        "borrowers": 0,
        "draining": False,
        "evictable": True,
        "generation": "42",
        "pools": {
            "models": {"resident": True, "device": "cuda:0", "provider": None},
        },
        "boot_id": "boot-1",
        "lifecycle_gate": "enforce",
        "control_epoch": "7",
        "identity": {
            "backend_registry_id": "backend-1",
            "gpu_resource_id": "node-a/GPU-1",
        },
    }
    payload.update(overrides)
    return BackendResidency.model_validate(payload)


def test_residency_round_trip_preserves_null_and_bound_identity() -> None:
    residency = _residency(
        state="unknown",
        gpu_loaded=None,
        evictable=False,
        generation=None,
        pools={
            "models": {"resident": None, "device": None, "provider": None},
        },
        lifecycle_gate="legacy",
        control_epoch=None,
        identity=None,
    )
    body = residency.model_dump(mode="json")
    assert body["gpu_loaded"] is None
    assert body["pools"]["models"] == {
        "resident": None,
        "device": None,
        "provider": None,
    }
    assert body["identity"] is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"generation": None},
        {"identity": None},
        {"lifecycle_gate": "legacy"},
    ],
)
def test_evictable_residency_requires_managed_enforce_identity(overrides: dict) -> None:
    with pytest.raises(ValidationError):
        _residency(**overrides)


@pytest.mark.parametrize(
    "overrides",
    [
        {"builders": 1},
        {"borrowers": 1},
        {"pools": {"models": {"resident": True, "device": "cuda:0", "provider": None}}},
        {"pools": {"models": {"resident": None, "device": None, "provider": None}}},
    ],
)
def test_gpu_loaded_false_requires_explicitly_empty_gpu_residency(
    overrides: dict,
) -> None:
    payload = {
        "state": "unloaded",
        "gpu_loaded": False,
        "evictable": False,
        "pools": {
            "models": {"resident": False, "device": None, "provider": None},
        },
    }
    payload.update(overrides)
    with pytest.raises(ValidationError):
        _residency(**payload)


def test_gpu_loaded_false_allows_explicit_cpu_fallback_pool() -> None:
    residency = _residency(
        state="resident",
        gpu_loaded=False,
        evictable=False,
        pools={
            "models": {"resident": False, "device": "cpu", "provider": None},
        },
    )
    assert residency.gpu_loaded is False


def _claims(
    scope: AdmissionScope = AdmissionScope.PREDICT,
    *,
    exp: int | None = None,
) -> AdmissionTokenClaims:
    control = scope in {
        AdmissionScope.DRAIN,
        AdmissionScope.UNLOAD,
        AdmissionScope.RESUME,
        AdmissionScope.MODE,
        AdmissionScope.RESET,
    }
    return AdmissionTokenClaims(
        backend_registry_id="backend-1",
        gpu_resource_id="node-a/GPU-1",
        boot_id="boot-1",
        generation=None
        if scope in {AdmissionScope.MODE, AdmissionScope.RESET}
        else "42",
        control_epoch="7",
        scope=scope,
        jti="lease-1" if not control else "transition-1",
        exp=exp if exp is not None else int(time.time()) + 60,
        owner="owner-1" if control else None,
        operation="operation-1" if control else None,
    )


@pytest.mark.parametrize("scope", list(AdmissionScope))
def test_claim_scope_shapes(scope: AdmissionScope) -> None:
    claims = _claims(scope)
    if scope in {AdmissionScope.MODE, AdmissionScope.RESET}:
        assert claims.generation is None
    else:
        assert claims.generation == "42"


def test_claims_reject_generation_on_mode_and_missing_generation_on_workload() -> None:
    mode = _claims(AdmissionScope.MODE).model_dump(mode="json")
    mode["generation"] = "8"
    with pytest.raises(ValidationError):
        AdmissionTokenClaims.model_validate(mode)

    workload = _claims().model_dump(mode="json")
    workload["generation"] = None
    with pytest.raises(ValidationError):
        AdmissionTokenClaims.model_validate(workload)


def test_claims_require_owner_operation_only_for_control_transitions() -> None:
    control = _claims(AdmissionScope.DRAIN).model_dump(mode="json")
    control["owner"] = None
    with pytest.raises(ValidationError):
        AdmissionTokenClaims.model_validate(control)

    workload = _claims().model_dump(mode="json")
    workload["owner"] = "unexpected"
    workload["operation"] = "unexpected"
    with pytest.raises(ValidationError):
        AdmissionTokenClaims.model_validate(workload)


def _key_material():
    private_key = Ed25519PrivateKey.generate()
    encoded_public = encode_ed25519_public_key(private_key.public_key())
    keyring_json = json.dumps({"current": encoded_public})
    return private_key, load_verify_keyring(keyring_json)


def test_keyring_rejects_empty_bad_kid_and_bad_key_encoding() -> None:
    with pytest.raises(ValueError):
        load_verify_keyring("{}")
    with pytest.raises(ValueError):
        load_verify_keyring(json.dumps({"bad kid": "A" * 43}))
    with pytest.raises(ValueError):
        load_verify_keyring(json.dumps({"current": "A" * 42}))


def test_eddsa_token_round_trip_and_key_rotation_selection() -> None:
    private_key, keyring = _key_material()
    token = sign_admission_token(_claims(), private_key=private_key, kid="current")
    verified = verify_admission_token(token, keyring=keyring)
    assert verified == _claims(exp=verified.exp)
    assert jwt.get_unverified_header(token) == {
        "alg": "EdDSA",
        "kid": "current",
        "typ": GPU_ADMISSION_TOKEN_TYPE,
    }


def test_token_rejects_unknown_kid_bad_signature_expiry_and_wrong_audience() -> None:
    private_key, keyring = _key_material()

    unknown_kid = sign_admission_token(_claims(), private_key=private_key, kid="next")
    with pytest.raises(AdmissionTokenError):
        verify_admission_token(unknown_kid, keyring=keyring)

    other_key = Ed25519PrivateKey.generate()
    bad_signature = sign_admission_token(
        _claims(), private_key=other_key, kid="current"
    )
    with pytest.raises(AdmissionTokenError):
        verify_admission_token(bad_signature, keyring=keyring)

    expired = sign_admission_token(
        _claims(exp=int(time.time()) - 1),
        private_key=private_key,
        kid="current",
    )
    with pytest.raises(AdmissionTokenError):
        verify_admission_token(expired, keyring=keyring)

    payload = _claims().model_dump(mode="json", exclude_none=True)
    payload["aud"] = "wrong-audience"
    wrong_audience = jwt.encode(
        payload,
        private_key,
        algorithm="EdDSA",
        headers={"kid": "current", "typ": GPU_ADMISSION_TOKEN_TYPE},
    )
    with pytest.raises(AdmissionTokenError):
        verify_admission_token(wrong_audience, keyring=keyring)


def test_token_rejects_algorithm_confusion_and_wrong_type() -> None:
    _private_key, keyring = _key_material()
    payload = _claims().model_dump(mode="json", exclude_none=True)
    hs_token = jwt.encode(
        payload,
        "x" * 32,
        algorithm="HS256",
        headers={"kid": "current", "typ": GPU_ADMISSION_TOKEN_TYPE},
    )
    with pytest.raises(AdmissionTokenError):
        verify_admission_token(hs_token, keyring=keyring)

    private_key, keyring = _key_material()
    wrong_type = jwt.encode(
        payload,
        private_key,
        algorithm="EdDSA",
        headers={"kid": "current", "typ": "JWT"},
    )
    with pytest.raises(AdmissionTokenError):
        verify_admission_token(wrong_type, keyring=keyring)


def test_token_rejects_extra_protected_headers_and_malformed_expiry() -> None:
    private_key, keyring = _key_material()
    payload = _claims().model_dump(mode="json", exclude_none=True)
    extra_header = jwt.encode(
        payload,
        private_key,
        algorithm="EdDSA",
        headers={
            "kid": "current",
            "typ": GPU_ADMISSION_TOKEN_TYPE,
            "jku": "https://attacker.invalid/keyring.json",
        },
    )
    with pytest.raises(AdmissionTokenError):
        verify_admission_token(extra_header, keyring=keyring)

    payload["exp"] = None
    malformed_expiry = jwt.encode(
        payload,
        private_key,
        algorithm="EdDSA",
        headers={"kid": "current", "typ": GPU_ADMISSION_TOKEN_TYPE},
    )
    with pytest.raises(AdmissionTokenError):
        verify_admission_token(malformed_expiry, keyring=keyring)


@pytest.mark.parametrize("leeway", [-1, 0.5, True])
def test_token_rejects_invalid_leeway_configuration(leeway) -> None:
    private_key, keyring = _key_material()
    token = sign_admission_token(_claims(), private_key=private_key, kid="current")
    with pytest.raises(ValueError):
        verify_admission_token(token, keyring=keyring, leeway_seconds=leeway)


def test_transition_response_models_round_trip() -> None:
    drain_residency = _residency(
        state="draining",
        draining=True,
        generation="43",
    )
    drain = DrainTransitionResponse(
        generation="43",
        draining=True,
        active_requests=0,
        ready_to_unload=True,
        residency=drain_residency,
    )
    unloaded_residency = _residency(
        state="unloaded",
        gpu_loaded=False,
        evictable=False,
        generation="43",
        pools={
            "models": {"resident": False, "device": None, "provider": None},
        },
    )
    unload = ManagedUnloadResponse(
        generation="43",
        unloaded=True,
        unloaded_count=2,
        residency=unloaded_residency,
    )
    assert drain.model_dump(mode="json")["generation"] == "43"
    assert unload.model_dump(mode="json")["unloaded_count"] == 2


def test_transition_responses_reject_stale_or_contradictory_residency() -> None:
    draining = _residency(state="draining", draining=True, generation="43")
    with pytest.raises(ValidationError):
        DrainTransitionResponse(
            generation="44",
            draining=True,
            active_requests=0,
            ready_to_unload=True,
            residency=draining,
        )
    with pytest.raises(ValidationError):
        DrainTransitionResponse(
            generation="43",
            draining=True,
            active_requests=1,
            ready_to_unload=True,
            residency=draining,
        )

    with pytest.raises(ValidationError):
        ManagedUnloadResponse(
            generation="43",
            unloaded=True,
            unloaded_count=1,
            residency=_residency(generation="43"),
        )


@pytest.mark.parametrize(
    ("code", "status"),
    [
        (LifecycleErrorCode.BACKEND_DRAINING, 503),
        (LifecycleErrorCode.BACKEND_ACTIVE, 409),
        (LifecycleErrorCode.GENERATION_CONFLICT, 409),
        (LifecycleErrorCode.TRANSITION_CONFLICT, 409),
        (LifecycleErrorCode.GENERATION_INVALID, 422),
        (LifecycleErrorCode.GENERATION_MISMATCH, 422),
        (LifecycleErrorCode.ADMISSION_DENIED, 403),
        (LifecycleErrorCode.UNLOAD_FAILED, 500),
    ],
)
def test_lifecycle_error_envelope(code: LifecycleErrorCode, status: int) -> None:
    error = LifecycleHTTPError(code, message="blocked")
    assert error.status_code == status
    assert {"detail": error.detail} == {
        "detail": {"error_code": code.value, "message": "blocked"},
    }


def test_draining_error_can_publish_retry_after() -> None:
    error = LifecycleHTTPError(
        LifecycleErrorCode.BACKEND_DRAINING,
        retry_after_s=3,
    )
    assert error.headers == {"Retry-After": "3"}


def test_public_models_are_importable_and_required_pool_fields_stay_present() -> None:
    identity = BoundLifecycleIdentity(
        backend_registry_id="backend-1",
        gpu_resource_id="node-a/GPU-1",
    )
    pool = PoolResidency(resident=False, device=None, provider=None)
    assert identity.audience == "aap-gpu-lifecycle"
    assert pool.model_dump() == {"resident": False, "device": None, "provider": None}
