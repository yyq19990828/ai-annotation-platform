"""EmbeddingCache 行为单测 (无需 GPU)."""

from __future__ import annotations

import threading

import pytest

from embedding_cache import CacheEntry, EmbeddingCache, compute_cache_key


def _entry(tag: int = 0) -> CacheEntry:
    return CacheEntry(features={"tag": tag}, orig_hw=(100, 200), is_batch=False, wh=(200, 100))


# ---------- compute_cache_key ----------


def test_cache_key_strips_query_string():
    a = compute_cache_key(
        "https://minio.local/bucket/img.jpg?X-Amz-Signature=aaa&X-Amz-Date=20260101", "tiny"
    )
    b = compute_cache_key(
        "https://minio.local/bucket/img.jpg?X-Amz-Signature=bbb&X-Amz-Date=20260102", "tiny"
    )
    assert a == b, "presigned URL signature 滚动不应让 key 变化"


def test_cache_key_distinguishes_paths():
    a = compute_cache_key("https://minio.local/bucket/a.jpg", "tiny")
    b = compute_cache_key("https://minio.local/bucket/b.jpg", "tiny")
    assert a != b


def test_cache_key_distinguishes_variants():
    base = "https://minio.local/bucket/img.jpg"
    assert compute_cache_key(base, "tiny") != compute_cache_key(base, "small")
    assert compute_cache_key(base, "small") != compute_cache_key(base, "large")


def test_cache_key_local_path():
    a = compute_cache_key("/data/a.jpg", "tiny")
    b = compute_cache_key("/data/a.jpg", "tiny")
    c = compute_cache_key("/data/b.jpg", "tiny")
    assert a == b
    assert a != c


# ---------- EmbeddingCache ----------


def test_put_get_roundtrip():
    c = EmbeddingCache(capacity=4, sam_variant="tiny")
    c.put("k1", _entry(1))
    got = c.get("k1")
    assert got is not None and got.features == {"tag": 1}


def test_get_miss_returns_none_and_counts():
    c = EmbeddingCache(capacity=4)
    assert c.get("nope") is None
    s = c.stats()
    assert s["misses"] == 1 and s["hits"] == 0


def test_get_hit_counts():
    c = EmbeddingCache(capacity=4)
    c.put("k1", _entry())
    c.get("k1")
    c.get("k1")
    s = c.stats()
    assert s["hits"] == 2 and s["misses"] == 0
    assert s["hit_rate"] == 1.0


def test_lru_eviction_order():
    c = EmbeddingCache(capacity=2)
    c.put("a", _entry(1))
    c.put("b", _entry(2))
    c.get("a")  # a 变最近用
    c.put("c", _entry(3))  # 应淘汰 b
    assert c.get("a") is not None
    assert c.get("b") is None
    assert c.get("c") is not None
    assert c.size() == 2


def test_capacity_upper_bound():
    c = EmbeddingCache(capacity=3)
    for i in range(10):
        c.put(f"k{i}", _entry(i))
    assert c.size() == 3


def test_put_existing_key_updates_value_and_recency():
    c = EmbeddingCache(capacity=2)
    c.put("a", _entry(1))
    c.put("b", _entry(2))
    c.put("a", _entry(99))  # 更新 + 提到最近
    c.put("c", _entry(3))  # 应淘汰 b 而不是 a
    a = c.get("a")
    assert a is not None and a.features == {"tag": 99}
    assert c.get("b") is None


def test_clear_resets_state():
    c = EmbeddingCache(capacity=2)
    c.put("a", _entry())
    c.get("a")
    c.clear()
    s = c.stats()
    assert s["size"] == 0 and s["hits"] == 0 and s["misses"] == 0


def test_peek_does_not_change_counters_or_lru_order():
    c = EmbeddingCache(capacity=2)
    c.put("a", _entry(1))
    c.put("b", _entry(2))
    assert c.peek("a") is True
    assert c.peek("missing") is False
    s = c.stats()
    assert s["hits"] == 0 and s["misses"] == 0
    # peek 不动 LRU 顺序: 插 c 应淘汰 a (最老), 而不是 b
    c.put("c", _entry(3))
    assert c.peek("a") is False
    assert c.peek("b") is True
    assert c.peek("c") is True


def test_invalid_capacity():
    with pytest.raises(ValueError):
        EmbeddingCache(capacity=0)
    with pytest.raises(ValueError):
        EmbeddingCache(capacity=-1)


def test_stats_hit_rate_rounding():
    c = EmbeddingCache(capacity=2)
    c.put("a", _entry())
    for _ in range(7):
        c.get("a")
    for _ in range(3):
        c.get("missing")
    s = c.stats()
    assert s["hits"] == 7 and s["misses"] == 3
    assert s["hit_rate"] == 0.7


def test_concurrent_put_get_lock_safe():
    c = EmbeddingCache(capacity=64)

    def worker(start: int):
        for i in range(start, start + 50):
            c.put(f"k{i}", _entry(i))
            c.get(f"k{i}")

    threads = [threading.Thread(target=worker, args=(i * 50,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    s = c.stats()
    assert s["size"] <= 64
    assert s["hits"] + s["misses"] == 200
