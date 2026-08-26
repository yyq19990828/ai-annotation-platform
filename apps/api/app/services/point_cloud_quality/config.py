from __future__ import annotations

from app.schemas.point_cloud_quality import PointCloudQualityConfig
from app.services.mask_qc.service import canonical_digest


DEFAULT_RULE_SEVERITIES = {
    "low_point_count": "warning",
    "size_outlier": "warning",
    "ground_clearance": "warning",
    "temporal_jump": "warning",
    "track_gap": "warning",
    "track_identity_drift": "blocker",
    "duplicate_track_member": "blocker",
}


def load_point_cloud_quality_config(stored: dict | None) -> PointCloudQualityConfig:
    return PointCloudQualityConfig.model_validate(stored or {})


def point_cloud_quality_config_digest(config: PointCloudQualityConfig) -> str:
    payload = config.model_dump(mode="json")
    payload.pop("config_revision", None)
    return canonical_digest(payload)


def severity_for_rule(config: PointCloudQualityConfig, code: str) -> str | None:
    if code not in config.enabled_rules:
        return None
    override = config.severity_overrides.get(code)
    if override == "off":
        return None
    return override or DEFAULT_RULE_SEVERITIES[code]
