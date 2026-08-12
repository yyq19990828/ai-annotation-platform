import json

import pytest

from scripts.seed_large_images import (
    LargeImageSeedError,
    load_fixture_manifest,
    select_fixtures,
    verify_fixture_file,
)


def _fixture_payload(content: bytes) -> dict:
    import hashlib

    return {
        "version": 1,
        "realLargeImages": [
            {
                "id": "large-a",
                "label": "Large A",
                "role": "required-happy-path",
                "filename": "large-a.png",
                "format": "png",
                "widthPx": 4,
                "heightPx": 3,
                "pixelCount": 12,
                "byteSize": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
                "sourcePage": "https://example.test/source",
                "credit": "Example",
                "usagePolicy": "https://example.test/policy",
                "usageNote": "Test only",
            }
        ],
    }


def test_load_and_verify_fixture_manifest(tmp_path):
    content = b"pinned-real-image-bytes"
    manifest = tmp_path / "fixtures.json"
    manifest.write_text(json.dumps(_fixture_payload(content)), encoding="utf-8")
    fixture_file = tmp_path / "large-a.png"
    fixture_file.write_bytes(content)

    version, fixtures = load_fixture_manifest(manifest)

    assert version == 1
    assert fixtures[0].pixel_count == 12
    assert fixtures[0].storage_key == "large-image-dev/large-a.png"
    verify_fixture_file(fixtures[0], fixture_file)


def test_manifest_rejects_dimension_mismatch(tmp_path):
    payload = _fixture_payload(b"bytes")
    payload["realLargeImages"][0]["pixelCount"] = 13
    manifest = tmp_path / "fixtures.json"
    manifest.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(LargeImageSeedError, match="pixelCount"):
        load_fixture_manifest(manifest)


def test_select_fixtures_preserves_manifest_order_and_rejects_unknown(tmp_path):
    payload = _fixture_payload(b"a")
    second = dict(payload["realLargeImages"][0])
    second.update(
        {
            "id": "large-b",
            "filename": "large-b.png",
            "byteSize": 1,
            "sha256": "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
        }
    )
    payload["realLargeImages"].append(second)
    manifest = tmp_path / "fixtures.json"
    manifest.write_text(json.dumps(payload), encoding="utf-8")
    _, fixtures = load_fixture_manifest(manifest)

    assert [
        fixture.id for fixture in select_fixtures(fixtures, ["large-b", "large-a"])
    ] == [
        "large-a",
        "large-b",
    ]
    with pytest.raises(LargeImageSeedError, match="unknown fixture id"):
        select_fixtures(fixtures, ["missing"])


def test_verify_fixture_file_rejects_integrity_mismatch(tmp_path):
    expected = b"expected"
    actual = b"tampered"
    manifest = tmp_path / "fixtures.json"
    manifest.write_text(json.dumps(_fixture_payload(expected)), encoding="utf-8")
    fixture_file = tmp_path / "large-a.png"
    fixture_file.write_bytes(actual)
    _, fixtures = load_fixture_manifest(manifest)

    with pytest.raises(LargeImageSeedError, match="sha256 mismatch"):
        verify_fixture_file(fixtures[0], fixture_file)
