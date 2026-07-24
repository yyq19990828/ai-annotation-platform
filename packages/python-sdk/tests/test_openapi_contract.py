"""OpenAPI 快照 contract test — 防 SDK 与后端 API 漂移的关键测试。

SDK 使用的每个 (method, path-template) 必须存在于 apps/api/openapi.snapshot.json;
后端删改端点而 SDK 未跟进时, 此测试在 monorepo CI 中失败。
"""

import json
from pathlib import Path

import pytest

from ai_annotation._http import USED_ENDPOINTS

SNAPSHOT = (
    Path(__file__).resolve().parents[1]
    / ".."
    / ".."
    / "apps"
    / "api"
    / "openapi.snapshot.json"
).resolve()


@pytest.mark.skipif(not SNAPSHOT.is_file(), reason="OpenAPI 快照仅在 monorepo 内可用")
def test_used_endpoints_exist_in_snapshot():
    paths = json.loads(SNAPSHOT.read_text(encoding="utf-8"))["paths"]
    missing = [
        (method, path)
        for method, path in USED_ENDPOINTS
        if path not in paths or method.lower() not in paths[path]
    ]
    assert not missing, f"SDK 使用的端点不在 OpenAPI 快照中 (API 漂移): {missing}"
