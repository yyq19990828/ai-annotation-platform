from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest

from app.services.raster_mask_storage import (
    load_coco_rle,
    lock_raster_mask_references,
    store_coco_rle,
    validate_mask_geometry_for_task,
)


def _storage(*, exists: bool = False):
    storage = MagicMock()
    storage.bucket = "annotation-data"
    storage.verify_upload.return_value = {} if exists else None
    return storage


def test_store_coco_rle_uses_content_addressed_key_and_put_if_absent():
    storage = _storage()
    reference = store_coco_rle(
        {"encoding": "coco_rle", "size": [2, 3], "counts": [1, 2, 2, 1]},
        storage=storage,
    )
    assert reference["encoding"] == "coco_rle_ref"
    assert reference["object_key"].endswith(f"{reference['sha256']}.json")
    assert reference["runs"] == 4
    storage.client.put_object.assert_called_once()

    existing = _storage(exists=True)
    store_coco_rle(
        {"encoding": "coco_rle", "size": [2, 3], "counts": [1, 2, 2, 1]},
        storage=existing,
    )
    existing.client.put_object.assert_not_called()


def test_load_coco_rle_verifies_reference_metadata():
    storage = _storage()
    reference = store_coco_rle(
        {"encoding": "coco_rle", "size": [2, 3], "counts": [1, 2, 2, 1]},
        storage=storage,
    )
    body = storage.client.put_object.call_args.kwargs["Body"]
    stream = BytesIO(body)
    stream.close = MagicMock()
    storage.client.get_object.return_value = {"Body": stream}
    assert load_coco_rle(reference, storage=storage)["counts"] == [1, 2, 2, 1]
    stream.close.assert_called_once()


def test_load_coco_rle_rejects_digest_mismatch():
    storage = _storage()
    reference = store_coco_rle(
        {"encoding": "coco_rle", "size": [2, 3], "counts": [6]},
        storage=storage,
    )
    stream = BytesIO(b'{"encoding":"coco_rle","size":[2,3],"counts":[0,6]}')
    stream.close = MagicMock()
    storage.client.get_object.return_value = {"Body": stream}
    with pytest.raises(ValueError, match="digest mismatch"):
        load_coco_rle(reference, storage=storage)


@pytest.mark.asyncio
async def test_reference_locks_are_sorted_deduplicated_and_verified(monkeypatch):
    import app.services.raster_mask_storage as module

    db = SimpleNamespace(execute=AsyncMock())
    refs = [
        {"object_key": "raster-masks/sha256/b.json", "sha256": "b"},
        {"object_key": "raster-masks/sha256/a.json", "sha256": "a"},
        {"object_key": "raster-masks/sha256/b.json", "sha256": "b"},
    ]
    load = MagicMock()
    monkeypatch.setattr(module, "load_coco_rle", load)

    assert await lock_raster_mask_references(db, {"items": refs}) == [
        "raster-masks/sha256/a.json",
        "raster-masks/sha256/b.json",
    ]
    assert [call.args[1]["key"] for call in db.execute.await_args_list] == [
        "aap:raster-mask:raster-masks/sha256/a.json",
        "aap:raster-mask:raster-masks/sha256/b.json",
    ]
    assert [call.args[0]["sha256"] for call in load.call_args_list] == ["a", "b"]


@pytest.mark.asyncio
async def test_mask_geometry_context_matches_video_size_and_frame_count():
    db = SimpleNamespace(
        get=AsyncMock(
            return_value=SimpleNamespace(
                file_type="video",
                width=1920,
                height=1080,
                metadata_={"video": {"frame_count": 10}},
            )
        )
    )
    task = SimpleNamespace(dataset_item_id="item-1")
    geometry = {
        "type": "video_track_mask",
        "keyframes": [{"frame_index": 9, "mask": {"size": [1080, 1920]}}],
        "outside": [{"from": 2, "to": 4}],
    }
    await validate_mask_geometry_for_task(db, task, geometry)

    geometry["keyframes"][0]["mask"]["size"] = (1080, 1920)
    await validate_mask_geometry_for_task(db, task, geometry)

    geometry["keyframes"][0]["frame_index"] = 10
    with pytest.raises(ValueError, match="frame_index"):
        await validate_mask_geometry_for_task(db, task, geometry)

    geometry["keyframes"][0] = {"frame_index": 9, "mask": {"size": [720, 1280]}}
    with pytest.raises(ValueError, match="mask size"):
        await validate_mask_geometry_for_task(db, task, geometry)
