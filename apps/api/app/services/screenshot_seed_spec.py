"""Single source of truth for screenshot seed logical resources."""

from __future__ import annotations

from dataclasses import dataclass


SEED_REVISION = "screenshots-2026-08-a"
SEED_MANAGED_BY = "screenshot-seed"
USER_SPECS = {
    "admin": ("admin", "super_admin"),
    "project_admin": ("pm", "project_admin"),
    "annotator": ("anno", "annotator"),
    "reviewer": ("qa", "reviewer"),
}


@dataclass(frozen=True)
class RecordingAnchorSpec:
    """Reviewed, normalized media coordinates consumed by deterministic recordings."""

    key: str
    label: str
    bbox: tuple[float, float, float, float]
    point: tuple[float, float]
    positive_stroke: tuple[tuple[float, float], ...]
    negative_stroke: tuple[tuple[float, float], ...]
    provenance: str = "verified-label-derived"


@dataclass(frozen=True)
class TaskSpec:
    key: str
    file_path: str
    status: str = "pending"
    batch_key: str | None = None
    assignee_key: str | None = None
    reviewer_key: str | None = None
    annotation: bool = False
    recording_anchors: tuple[RecordingAnchorSpec, ...] = ()


@dataclass(frozen=True)
class BatchSpec:
    key: str
    display_id: str
    name: str
    status: str
    annotator_key: str | None = None
    reviewer_key: str | None = None


@dataclass(frozen=True)
class BackendRequirement:
    key: str
    description: str
    required_prompts: tuple[str, ...] = ()
    required_tasks: tuple[str, ...] = ()
    required_inputs: tuple[str, ...] = ()
    required_geometries: tuple[str, ...] = ()
    required_output_attributes: tuple[str, ...] = ()
    tracker_priority: tuple[str, ...] = ()
    interactive: bool = False


@dataclass(frozen=True)
class ProjectSpec:
    display_id: str
    dataset_display_id: str
    data_type: str
    storage_prefix: str
    tasks: tuple[TaskSpec, ...]
    media_paths: tuple[str, ...] = ()
    required_backend: str | None = None
    batches: tuple[BatchSpec, ...] = ()
    require_members: bool = False
    axis_convention: str | None = None


BACKEND_REQUIREMENTS = {
    "image_interactive": BackendRequirement(
        key="image_interactive",
        description="point + interactive_box + exemplar image interaction",
        required_prompts=("point", "interactive_box", "exemplar"),
        required_tasks=("interactive_seg",),
        required_geometries=("polygon",),
        interactive=True,
    ),
    "video_tracker": BackendRequirement(
        key="video_tracker",
        description="interactive video tracking",
        required_tasks=("tracker",),
        tracker_priority=("sam3_video_interactive", "sam2_video"),
    ),
    "ocr": BackendRequirement(
        key="ocr",
        description="full-image OCR with text attributes",
        required_tasks=("ocr",),
        required_inputs=("full_image",),
        required_geometries=("polygon",),
        required_output_attributes=("text",),
    ),
}


IMAGE_BATCHES = (
    BatchSpec("draft", "B-SS-DRAFT", "截图 · 待分派", "draft"),
    BatchSpec("active", "B-SS-ACTIVE", "截图 · 待预标", "active"),
    BatchSpec(
        "annotating",
        "B-SS-ANNOTATING",
        "截图 · 标注中",
        "annotating",
        annotator_key="annotator",
        reviewer_key="reviewer",
    ),
    BatchSpec(
        "review",
        "B-SS-REVIEW",
        "截图 · 待审核",
        "reviewing",
        annotator_key="annotator",
        reviewer_key="reviewer",
    ),
    BatchSpec(
        "completed",
        "B-SS-COMPLETE",
        "截图 · 已完成",
        "approved",
        annotator_key="annotator",
        reviewer_key="reviewer",
    ),
)


PROJECT_SPECS = {
    "image_demo": ProjectSpec(
        display_id="P-COCO8",
        dataset_display_id="DS-COCO8",
        data_type="image",
        storage_prefix="coco8-dev/",
        tasks=(
            TaskSpec("clean", "coco8-dev/train/screenshot_01.jpg", batch_key="draft"),
            TaskSpec(
                "predicted",
                "coco8-dev/train/screenshot_02.jpg",
                batch_key="draft",
            ),
            TaskSpec(
                "annotating",
                "coco8-dev/train/screenshot_03.jpg",
                status="in_progress",
                batch_key="annotating",
                assignee_key="annotator",
                recording_anchors=(
                    RecordingAnchorSpec(
                        key="primary_vehicle",
                        label="car",
                        bbox=(0.42, 0.48, 0.56, 0.75),
                        point=(0.49, 0.62),
                        positive_stroke=((0.51, 0.59), (0.58, 0.66)),
                        negative_stroke=((0.43, 0.54), (0.48, 0.61)),
                    ),
                ),
            ),
            TaskSpec(
                "submitted",
                "coco8-dev/train/screenshot_04.jpg",
                status="review",
                batch_key="review",
                assignee_key="annotator",
                annotation=True,
            ),
            TaskSpec(
                "review",
                "coco8-dev/val/screenshot_05.jpg",
                status="review",
                batch_key="review",
                assignee_key="annotator",
                reviewer_key="reviewer",
                annotation=True,
            ),
            TaskSpec(
                "completed",
                "coco8-dev/val/screenshot_06.jpg",
                status="completed",
                batch_key="completed",
                assignee_key="annotator",
                reviewer_key="reviewer",
                annotation=True,
            ),
            TaskSpec("spare_1", "coco8-dev/val/screenshot_07.jpg", batch_key="active"),
            TaskSpec("spare_2", "coco8-dev/val/screenshot_08.jpg", batch_key="draft"),
        ),
        required_backend="image_interactive",
        batches=IMAGE_BATCHES,
        require_members=True,
    ),
    "video_demo": ProjectSpec(
        display_id="P-VIDEO-DEV",
        dataset_display_id="DS-VIDEO-DEV",
        data_type="video",
        storage_prefix="tracking-car-dev/",
        tasks=(TaskSpec("tracking", "tracking-car-dev/tracking_scene.mp4"),),
        required_backend="video_tracker",
    ),
    "pointcloud_demo": ProjectSpec(
        display_id="P-PC-DEV",
        dataset_display_id="DS-PC-DEV",
        data_type="lidar",
        storage_prefix="pc-scene-dev/",
        tasks=tuple(
            TaskSpec(f"frame_{index:03d}", f"pc-scene-dev/lidar/{index:06d}.pcd")
            for index in range(4)
        ),
        media_paths=(
            *(f"pc-scene-dev/lidar/{index:06d}.pcd" for index in range(4)),
            *(f"pc-scene-dev/camera/front/{index:06d}.jpg" for index in range(4)),
            "pc-scene-dev/calib/camera/front.json",
        ),
        axis_convention="opencv_camera",
    ),
    "pointcloud_multicam_demo": ProjectSpec(
        display_id="P-PC-MULTI",
        dataset_display_id="DS-PC-MULTI",
        data_type="lidar",
        storage_prefix="pc-multicam-dev/",
        tasks=(TaskSpec("frame_000", "pc-multicam-dev/lidar/000000.pcd"),),
        media_paths=(
            "pc-multicam-dev/lidar/000000.pcd",
            *(
                f"pc-multicam-dev/camera/{role}/000000.jpg"
                for role in (
                    "front",
                    "front_left",
                    "front_right",
                    "back",
                    "back_left",
                    "back_right",
                )
            ),
            *(
                f"pc-multicam-dev/calib/camera/{role}.json"
                for role in (
                    "front",
                    "front_left",
                    "front_right",
                    "back",
                    "back_left",
                    "back_right",
                )
            ),
        ),
        axis_convention="apollo",
    ),
    "ocr_demo": ProjectSpec(
        display_id="P-OCR",
        dataset_display_id="DS-OCR",
        data_type="image",
        storage_prefix="ocr-dev/",
        tasks=(TaskSpec("ocr", "ocr-dev/ch_en_num.jpg"),),
        required_backend="ocr",
    ),
}
