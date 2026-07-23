"""v0.15.12 · ML Backend 实时统计 WS 消费器 — URL 拼接 + 帧解析单元测试。"""

import json

from ai_annotation.models import MLBackendStatsSnapshot
from ai_annotation.tui.ml_stats_ws import build_ws_url, parse_frame


def test_build_ws_url_http_to_ws():
    url = build_ws_url("http://localhost:8000", "ak_abc")
    assert url == "ws://localhost:8000/ws/ml-backend-stats?token=ak_abc"


def test_build_ws_url_https_to_wss_and_strip_slash():
    url = build_ws_url("https://api.example.com/", "ak_x/y+z")
    assert url.startswith("wss://api.example.com/ws/ml-backend-stats?token=")
    # token 做了 url 编码 (/ 和 + 不能裸传)
    assert "ak_x%2Fy%2Bz" in url


def test_parse_frame_stats():
    frame = json.dumps(
        {
            "backends": [
                {
                    "backend_id": "11111111-1111-1111-1111-111111111111",
                    "backend_name": "sam",
                    "state": "connected",
                    "gpu_info": {
                        "gpu_utilization_percent": 73,
                        "memory_used_mb": 100,
                        "memory_total_mb": 200,
                    },
                    "cache": {"hit_rate": 0.9},
                    "loaded": True,
                    "idle_unload_seconds": 42.0,
                    "pool": {"size": 1, "capacity": 4},
                    "timestamp": "2026-06-11T00:00:00Z",
                }
            ],
            "timestamp": "2026-06-11T00:00:00Z",
        }
    )
    snaps = parse_frame(frame)
    assert snaps is not None and len(snaps) == 1
    s = snaps[0]
    assert isinstance(s, MLBackendStatsSnapshot)
    assert s.backend_name == "sam"
    assert s.gpu_info.gpu_utilization_percent == 73
    assert s.loaded is True
    assert s.pool == {"size": 1, "capacity": 4}


def test_parse_frame_ping_and_garbage():
    assert parse_frame(json.dumps({"type": "ping"})) is None
    assert parse_frame("not json") is None
    assert parse_frame(json.dumps([1, 2, 3])) is None


def test_parse_frame_skips_bad_snapshot():
    # state 必填; 缺失的坏条目被跳过, 不拖垮整帧
    frame = json.dumps(
        {
            "backends": [
                {
                    "backend_id": "11111111-1111-1111-1111-111111111111",
                    "state": "connected",
                },
                {"backend_name": "broken"},  # 缺 state → 跳过
            ]
        }
    )
    snaps = parse_frame(frame)
    assert snaps is not None and len(snaps) == 1
