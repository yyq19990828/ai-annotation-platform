from datetime import datetime, timedelta, timezone

from app.workers.cleanup import _eligible_raster_mask_objects


def test_raster_mask_gc_keeps_referenced_and_grace_period_objects():
    now = datetime.now(timezone.utc)
    candidates = [
        {
            "key": "raster-masks/sha256/aa/aa/referenced.json",
            "last_modified": now - timedelta(days=3),
        },
        {
            "key": "raster-masks/sha256/bb/bb/recent.json",
            "last_modified": now - timedelta(hours=2),
        },
        {
            "key": "raster-masks/sha256/cc/cc/orphan.json",
            "last_modified": now - timedelta(days=2),
        },
    ]
    eligible = _eligible_raster_mask_objects(
        candidates,
        {"raster-masks/sha256/aa/aa/referenced.json"},
        now - timedelta(hours=24),
    )
    assert [item["key"] for item in eligible] == [
        "raster-masks/sha256/cc/cc/orphan.json"
    ]


def test_raster_mask_gc_caps_each_run_at_1000():
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    old = cutoff - timedelta(days=1)
    candidates = [
        {"key": f"raster-masks/sha256/{index:04d}.json", "last_modified": old}
        for index in range(1005)
    ]
    assert len(_eligible_raster_mask_objects(candidates, set(), cutoff)) == 1000
