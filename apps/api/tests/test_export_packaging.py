"""v0.10.27 · 导出打包纯函数单测（无 DB）。

覆盖 relative_path_from_file_path：剥 dataset 前缀拿相对路径（消除同名跨目录覆盖）。
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile

import pytest

from app.db.models.annotation import Annotation
from app.db.models.dataset import DatasetItem
from app.db.models.project import Project
from app.db.models.task import Task
from app.services.export_packaging import (
    _build_video_export_zip,
    clean_export_targets,
    relative_path_from_file_path,
)


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
    assert relative_path_from_file_path("/ds/a/b.jpg", "ds") == "a/b.jpg"


def test_empty_dataset_name_returns_full_path():
    assert relative_path_from_file_path("ds/a/b.jpg", "") == "ds/a/b.jpg"


def test_flat_file_at_dataset_root():
    assert relative_path_from_file_path("ds/001.jpg", "ds") == "001.jpg"


def test_clean_export_targets_accepts_video_yolo_frames_det():
    assert clean_export_targets(["video_json", "yolo-frames-det", "video_json"]) == [
        "video_json",
        "yolo-frames-det",
    ]


def test_clean_export_targets_rejects_video_target_for_image_project():
    # v0.10.47 · 图像项目混入视频目标应在端点层就被拒，而非派发后整批失败。
    with pytest.raises(ValueError, match="image project"):
        clean_export_targets(["coco", "mot"], data_type="image")


def test_clean_export_targets_rejects_image_target_for_video_project():
    with pytest.raises(ValueError, match="video project"):
        clean_export_targets(["video_json", "coco"], data_type="video")


def test_clean_export_targets_aap_json_valid_for_both_modalities():
    # aap_json 同属图像/视频目标集，两侧都应放行。
    assert clean_export_targets(["aap_json"], data_type="image") == ["aap_json"]
    assert clean_export_targets(["aap_json"], data_type="video") == ["aap_json"]


async def test_video_yolo_frames_zip_writes_grid_labels_and_manifest(monkeypatch):
    monkeypatch.setattr(
        "app.services.export_packaging.storage_service.generate_download_url",
        lambda *args, **kwargs: "signed-url",
    )
    project_id = uuid.uuid4()
    item_id = uuid.uuid4()
    dataset_id = uuid.uuid4()
    task_id = uuid.uuid4()
    project = Project(
        id=project_id,
        display_id="P-1",
        name="Video Project",
        type_key="video-track",
        type_label="Video Track",
        data_type="video",
        owner_id=uuid.uuid4(),
        video_sampling={"mode": "step", "frame_step": 2},
        tool_bindings={
            "bbox": {
                "enabled": True,
                "classes": [
                    {"name": "car", "order": 0},
                    {"name": "person", "order": 1},
                ],
                "attribute_schema": {"fields": [{"key": "speed"}]},
            }
        },
    )
    item = DatasetItem(
        id=item_id,
        dataset_id=dataset_id,
        file_name="clip-a.mp4",
        file_path="videos/clip-a.mp4",
        file_type="video",
        metadata_={"video": {"fps": 10, "frame_count": 5, "width": 640, "height": 360}},
    )
    task = Task(
        id=task_id,
        project_id=project_id,
        dataset_item_id=item_id,
        display_id="T-1",
        file_name="clip-a.mp4",
        file_path="videos/clip-a.mp4",
        file_type="video",
    )
    track = Annotation(
        id=uuid.uuid4(),
        task_id=task_id,
        project_id=project_id,
        user_id=uuid.uuid4(),
        annotation_type="video_track_bbox",
        class_name="car",
        geometry={
            "type": "video_track_bbox",
            "track_id": "trk-1",
            "keyframes": [
                {"frame_index": 0, "bbox": {"x": 0.0, "y": 0.0, "w": 0.2, "h": 0.2}},
                {"frame_index": 4, "bbox": {"x": 0.6, "y": 0.6, "w": 0.2, "h": 0.2}},
            ],
            "outside": [{"from": 2, "to": 2}],
        },
        attributes={"speed": 50},
    )
    bbox = Annotation(
        id=uuid.uuid4(),
        task_id=task_id,
        project_id=project_id,
        user_id=uuid.uuid4(),
        annotation_type="video_bbox",
        class_name="person",
        geometry={
            "type": "video_bbox",
            "frame_index": 2,
            "x": 0.2,
            "y": 0.2,
            "w": 0.2,
            "h": 0.4,
        },
        attributes={"speed": 3},
    )

    data, file_count = await _build_video_export_zip(
        None,
        None,
        project,
        [task],
        [track, bbox],
        {item_id: item},
        batch_id=None,
        targets=["yolo-frames-det"],
        include_attributes=True,
        video_frame_mode="keyframes",
    )

    assert file_count == 3
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        assert "data.yaml" in zf.namelist()
        assert "fetch_frames.py" in zf.namelist()
        assert zf.read("labels/clip-a/000001.txt").decode() == (
            "0 0.100000 0.100000 0.200000 0.200000"
        )
        assert zf.read("labels/clip-a/000002.txt").decode() == (
            "1 0.300000 0.400000 0.200000 0.400000"
        )
        assert zf.read("labels/clip-a/000003.txt").decode() == (
            "0 0.700000 0.700000 0.200000 0.200000"
        )
        manifest = json.loads(zf.read("manifest.json"))
        video = manifest["videos"][0]
        assert video["grid_source_frames"] == [0, 2, 4]
        assert video["frame_start_number"] == 1
        assert video["frame_output_dirs"] == ["images/clip-a"]
