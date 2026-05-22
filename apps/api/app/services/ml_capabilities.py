"""v0.10.37 · ML Backend 能力快照抽取 + 模态派生（epic 阶段 1）.

平台对 backend「能力 / 模态」的持久化感知统一在此派生：
- `extract_capabilities`：从 backend `/setup` 响应抽出平台关心的能力快照。
- `derive_modalities`：由能力快照派生平台视图概念「模态」(image / video)，不入库、读时算。

能力快照随 `services.ml_backend.check_health` 写入 `ml_backends.health_meta["capabilities"]`
(HealthMeta schema `extra="allow"`，无 alembic 迁移)。
"""

from __future__ import annotations


def extract_capabilities(setup: dict | None) -> dict | None:
    """从 `/setup` 响应抽能力快照；setup 为空返回 None。

    派生 `modalities` 一并存入，方便前端 / 绑定校验直接消费。
    """
    if not setup:
        return None
    caps: dict = {
        "is_interactive": bool(setup.get("is_interactive")),
        "supported_prompts": list(setup.get("supported_prompts") or []),
        "supported_trackers": list(setup.get("supported_trackers") or []),
        "supported_text_outputs": list(setup.get("supported_text_outputs") or []),
        "supported_geometric_outputs": list(
            setup.get("supported_geometric_outputs") or []
        ),
    }
    caps["modalities"] = derive_modalities(caps)
    return caps


def derive_modalities(caps: dict | None) -> list[str]:
    """由能力快照派生支持的模态。

    - `supported_prompts` 非空 ⇒ 支持 image（point/bbox/text/exemplar 都是图片侧交互）。
    - `supported_trackers` 非空 ⇒ 支持 video。
    """
    if not caps:
        return []
    modalities: list[str] = []
    if caps.get("supported_prompts"):
        modalities.append("image")
    if caps.get("supported_trackers"):
        modalities.append("video")
    return modalities
