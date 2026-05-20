"""v0.10.27 · 导出打包纯函数单测（无 DB）。

覆盖 relative_path_from_file_path：剥 dataset 前缀拿相对路径（消除同名跨目录覆盖）。
"""

from __future__ import annotations

from app.services.export_packaging import relative_path_from_file_path


def test_strips_dataset_prefix():
    assert (
        relative_path_from_file_path("mydataset/animals/cat/001.jpg", "mydataset")
        == "animals/cat/001.jpg"
    )


def test_same_leaf_different_dir_stay_distinct():
    a = relative_path_from_file_path("ds/animals/cat/001.jpg", "ds")
    b = relative_path_from_file_path("ds/animals/dog/001.jpg", "ds")
    assert a == "animals/cat/001.jpg"
    assert b == "animals/dog/001.jpg"
    assert a != b


def test_prefix_mismatch_returns_path_unchanged():
    # 首段非 dataset_name 时保守返回（不误删层级）。
    assert (
        relative_path_from_file_path("other/animals/cat/001.jpg", "mydataset")
        == "other/animals/cat/001.jpg"
    )


def test_leading_slash_normalized():
    assert (
        relative_path_from_file_path("/ds/a/b.jpg", "ds") == "a/b.jpg"
    )


def test_empty_dataset_name_returns_full_path():
    assert relative_path_from_file_path("ds/a/b.jpg", "") == "ds/a/b.jpg"


def test_flat_file_at_dataset_root():
    assert relative_path_from_file_path("ds/001.jpg", "ds") == "001.jpg"
