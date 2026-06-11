"""共享 fixtures: 指向 mock server 的 Client (respx 拦截所有 HTTP)。"""

import pytest

from ai_annotation import Client

BASE = "http://testserver"
API = f"{BASE}/api/v1"


@pytest.fixture
def client(monkeypatch):
    # 隔离宿主机环境变量 / config.toml 的干扰 (显式参数本就最高优先, 双保险)
    monkeypatch.delenv("AAP_BASE_URL", raising=False)
    monkeypatch.delenv("AAP_API_KEY", raising=False)
    c = Client(base_url=BASE, api_key="ak_test")
    yield c
    c.close()
