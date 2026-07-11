"""presigned URL 的过期时刻对齐到窗口网格，同一对象在窗口内签出的 URL 才逐字节相同。

MinIO 不下发 Cache-Control，浏览器按完整 URL（含签名）做缓存 key。Expires 若逐秒递增，
每次任务列表 refetch 都会让全部缩略图缓存失效并重下。
"""

from __future__ import annotations

import pytest

from app.services import storage as storage_mod
from app.services.storage import _PRESIGN_ALIGN_WINDOW, _aligned_expires_in


@pytest.fixture
def frozen_now(monkeypatch):
    """把 time.time() 钉死，返回一个可推进时刻的 setter。"""
    holder = {"t": 1_700_000_000}
    monkeypatch.setattr(storage_mod.time, "time", lambda: holder["t"])
    return holder


def _deadline(expires_in: int) -> int:
    return int(storage_mod.time.time()) + _aligned_expires_in(expires_in)


def test_same_window_yields_same_absolute_expiry(frozen_now):
    """窗口内任意时刻签发，绝对过期时刻恒定 —— 这是 URL 稳定的充要条件。"""
    start = frozen_now["t"] - frozen_now["t"] % _PRESIGN_ALIGN_WINDOW

    deadlines = set()
    for offset in (0, 1, 137, _PRESIGN_ALIGN_WINDOW - 1):
        frozen_now["t"] = start + offset
        deadlines.add(_deadline(3600))

    assert len(deadlines) == 1


def test_next_window_rolls_over(frozen_now):
    """跨过窗口边界后必须换新的过期时刻，否则 URL 永不轮换。"""
    start = frozen_now["t"] - frozen_now["t"] % _PRESIGN_ALIGN_WINDOW

    frozen_now["t"] = start + _PRESIGN_ALIGN_WINDOW - 1
    before = _deadline(3600)
    frozen_now["t"] = start + _PRESIGN_ALIGN_WINDOW
    after = _deadline(3600)

    assert after - before == _PRESIGN_ALIGN_WINDOW


@pytest.mark.parametrize("expires_in", [900, 3600, 7 * 24 * 3600])
def test_effective_lifetime_never_shorter_than_requested(frozen_now, expires_in):
    """对齐只会延长有效期，绝不提前失效 —— 否则导出链接会在标称期限内失效。"""
    start = frozen_now["t"] - frozen_now["t"] % _PRESIGN_ALIGN_WINDOW

    for offset in range(0, _PRESIGN_ALIGN_WINDOW, 61):
        frozen_now["t"] = start + offset
        lifetime = _aligned_expires_in(expires_in)
        assert expires_in <= lifetime <= expires_in + _PRESIGN_ALIGN_WINDOW
