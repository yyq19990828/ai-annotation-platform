from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
from app.db.models.image_pyramid import ImagePyramidAsset, ImagePyramidGeneration
from app.db.models.ml_backend_registry import MLBackendRegistry, ProjectMLBackendPool
from app.db.models.prediction import Prediction
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.user import User
from app.services.ml_backend import MLBackendService
from app.services.screenshot_seed_spec import (
    PROJECT_SPECS,
    SEED_MANAGED_BY,
    SEED_REVISION,
)
from scripts.seed_screenshot_profile import (
    ANNOTATION_NAMESPACE,
    ScreenshotSeedReconcileError,
    ScreenshotSeedPreparation,
    prepare_screenshot_seed,
    reconcile_screenshot_seed,
)


pytestmark = pytest.mark.asyncio
FIXED_TIME = datetime(2026, 7, 1, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _mock_seed_storage(monkeypatch):
    monkeypatch.setattr(
        "app.services.screenshot_seed_catalog._storage_object_digest",
        lambda file_path: hashlib.sha256(file_path.encode()).hexdigest(),
    )


async def _ready_profile(db):
    users: dict[str, User] = {}
    for email, role in (
        ("admin", "super_admin"),
        ("pm", "project_admin"),
        ("anno", "annotator"),
        ("qa", "reviewer"),
    ):
        user = User(
            id=uuid.uuid4(),
            email=email,
            name=email,
            password_hash="test",
            role=role,
            is_active=True,
        )
        db.add(user)
        users[email] = user
    await db.flush()

    projects: dict[str, Project] = {}
    tasks_by_project: dict[str, dict[str, Task]] = {}
    for project_index, (logical_key, spec) in enumerate(PROJECT_SPECS.items()):
        owner = users["admin"] if spec.data_type == "lidar" else users["pm"]
        project = Project(
            id=uuid.uuid4(),
            display_id=spec.display_id,
            name=logical_key,
            type_label=logical_key,
            type_key=logical_key,
            data_type=spec.data_type,
            owner_id=owner.id,
            ai_enabled=spec.required_backend is not None,
            ai_interactive_enabled=True,
        )
        db.add(project)
        projects[logical_key] = project
        metadata = {
            "seed": {
                "managed_by": SEED_MANAGED_BY,
                "profile": "screenshots",
                "logical_key": logical_key,
                "revision": SEED_REVISION,
                "asset_sha256": "a" * 64,
            }
        }
        if spec.axis_convention:
            metadata["axis_convention"] = spec.axis_convention
        media_paths = set(spec.media_paths) or {
            task_spec.file_path for task_spec in spec.tasks
        }
        dataset = Dataset(
            id=uuid.uuid4(),
            display_id=spec.dataset_display_id,
            name=logical_key,
            data_type="point_cloud" if spec.data_type == "lidar" else spec.data_type,
            file_count=len(media_paths),
            created_by=owner.id,
            metadata_=metadata,
        )
        db.add(dataset)
        await db.flush()
        db.add(ProjectDataset(project_id=project.id, dataset_id=dataset.id))

        items: dict[str, DatasetItem] = {}
        for file_path in sorted(media_paths):
            item = DatasetItem(
                id=uuid.uuid4(),
                dataset_id=dataset.id,
                file_name=file_path.rsplit("/", 1)[-1],
                file_path=file_path,
                file_type=(
                    "point_cloud"
                    if file_path.endswith(".pcd")
                    else "image"
                    if file_path.endswith(".jpg")
                    else "other"
                ),
                content_hash=hashlib.sha256(file_path.encode()).hexdigest(),
                metadata_=(
                    {
                        "calibration": {
                            "extrinsic": [
                                1,
                                0,
                                0,
                                0,
                                0,
                                1,
                                0,
                                0,
                                0,
                                0,
                                1,
                                0,
                                0,
                                0,
                                0,
                                1,
                            ],
                            "intrinsic": [525, 0, 319.5, 0, 525, 239.5, 0, 0, 1],
                        }
                    }
                    if "/camera/" in file_path and file_path.endswith(".jpg")
                    else {}
                ),
            )
            db.add(item)
            items[file_path] = item
        await db.flush()

        batches: dict[str, TaskBatch] = {}
        for batch_spec in spec.batches:
            batch = TaskBatch(
                project_id=project.id,
                dataset_id=dataset.id,
                display_id=batch_spec.display_id,
                name=batch_spec.name,
                status=batch_spec.status,
                created_by=users["pm"].id,
            )
            db.add(batch)
            batches[batch_spec.key] = batch
        await db.flush()

        tasks: dict[str, Task] = {}
        for task_index, task_spec in enumerate(reversed(spec.tasks)):
            item = items[task_spec.file_path]
            task = Task(
                id=uuid.uuid4(),
                project_id=project.id,
                dataset_item_id=item.id,
                display_id=f"T-SS-{project_index}-{task_index}",
                file_name=item.file_name,
                file_path=item.file_path,
                file_type=item.file_type,
                status=task_spec.status,
                assignee_id=(
                    users["anno"].id if task_spec.assignee_key == "annotator" else None
                ),
                reviewer_id=(
                    users["qa"].id if task_spec.reviewer_key == "reviewer" else None
                ),
                batch_id=(
                    batches[task_spec.batch_key].id if task_spec.batch_key else None
                ),
                total_annotations=int(task_spec.annotation),
                total_predictions=int(
                    logical_key == "image_demo" and task_spec.key == "predicted"
                ),
                is_labeled=task_spec.annotation,
            )
            db.add(task)
            tasks[task_spec.key] = task
        tasks_by_project[logical_key] = tasks
        await db.flush()

        for task_spec in spec.tasks:
            task = tasks[task_spec.key]
            if task_spec.annotation:
                db.add(
                    Annotation(
                        id=uuid.uuid5(
                            ANNOTATION_NAMESPACE,
                            f"{project.display_id}:{task_spec.key}",
                        ),
                        task_id=task.id,
                        project_id=project.id,
                        user_id=users["anno"].id,
                        class_name="car",
                        geometry={
                            "type": "bbox",
                            "x": 0.2,
                            "y": 0.3,
                            "w": 0.2,
                            "h": 0.2,
                        },
                    )
                )
            if logical_key == "image_demo" and task_spec.key == "predicted":
                db.add(
                    Prediction(
                        id=uuid.uuid4(),
                        created_at=FIXED_TIME,
                        task_id=task.id,
                        project_id=project.id,
                        model_version=f"screenshot-seed:{SEED_REVISION}",
                        source="external_import",
                        result={"result": []},
                    )
                )

    image = projects["image_demo"]
    db.add_all(
        [
            ProjectMember(
                project_id=image.id,
                user_id=users["anno"].id,
                role="annotator",
                assigned_by=users["pm"].id,
            ),
            ProjectMember(
                project_id=image.id,
                user_id=users["qa"].id,
                role="reviewer",
                assigned_by=users["pm"].id,
            ),
        ]
    )

    image_backend = MLBackendRegistry(
        id=uuid.uuid4(),
        name="screenshot-image",
        url=f"http://image-{uuid.uuid4().hex}.test",
        state="connected",
        is_interactive=True,
        health_meta={
            "capabilities": {
                "is_interactive": True,
                "supported_prompts": ["point", "interactive_box", "exemplar"],
                "supported_geometric_outputs": ["polygon"],
                "models": [
                    {
                        "task": "interactive_seg",
                        "output_attribute_types": [],
                    }
                ],
            }
        },
    )
    video_backend = MLBackendRegistry(
        id=uuid.uuid4(),
        name="screenshot-video",
        url=f"http://video-{uuid.uuid4().hex}.test",
        state="connected",
        is_interactive=False,
        health_meta={
            "capabilities": {
                "supported_trackers": ["sam2_video"],
                "models": [{"task": "tracker", "output_attribute_types": []}],
            }
        },
    )
    ocr_backend = MLBackendRegistry(
        id=uuid.uuid4(),
        name="screenshot-ocr",
        url=f"http://ocr-{uuid.uuid4().hex}.test",
        state="connected",
        is_interactive=False,
        health_meta={
            "capabilities": {
                "supported_inputs": ["full_image"],
                "supported_geometric_outputs": ["polygon"],
                "models": [{"task": "ocr", "output_attribute_types": ["text"]}],
            }
        },
    )
    db.add_all([image_backend, video_backend, ocr_backend])
    await db.flush()
    # v0.23.3 ADR-0050 · 每 registry 须有 singleton pool 才能被项目主绑定 / 启用。
    svc = MLBackendService(db)
    image_pool = await svc._create_singleton_pool(image_backend)
    video_pool = await svc._create_singleton_pool(video_backend)
    ocr_pool = await svc._create_singleton_pool(ocr_backend)
    image.ml_backend_pool_id = image_pool.id
    video = projects["video_demo"]
    video.ml_backend_pool_id = video_pool.id
    ocr = projects["ocr_demo"]
    ocr.ml_backend_pool_id = ocr_pool.id
    db.add_all(
        [
            ProjectMLBackendPool(
                project_id=image.id, pool_id=image_pool.id, enabled=True
            ),
            ProjectMLBackendPool(
                project_id=video.id, pool_id=video_pool.id, enabled=True
            ),
            ProjectMLBackendPool(project_id=ocr.id, pool_id=ocr_pool.id, enabled=True),
        ]
    )
    await db.flush()
    return projects, tasks_by_project


async def test_catalog_returns_explicit_stable_logical_resources(
    httpx_client, db_session
):
    await _ready_profile(db_session)

    response = await httpx_client.get(
        "/api/v1/__test/seed/catalog", params={"profile": "screenshots"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schema_version"] == 1
    assert body["seed_revision"] == SEED_REVISION
    assert body["users"]["annotator"]["email"] == "anno"
    image = body["projects"]["image_demo"]
    assert image["display_id"] == "P-COCO8"
    assert image["tasks"]["review"]["file_path"].endswith("screenshot_05.jpg")
    assert image["tasks"]["review"]["status"] == "review"
    anchor = image["tasks"]["annotating"]["recording_anchors"]["primary_vehicle"]
    assert anchor["coordinate_space"] == "normalized_media"
    assert anchor["label"] == "car"
    assert anchor["point"] == [0.49, 0.62]
    assert anchor["polygon"][0] == [0.44, 0.49]
    assert anchor["brush_strokes"][0] == [[0.435, 0.545], [0.515, 0.545]]
    assert anchor["negative_point"] is None
    assert anchor["provenance"] == "verified-label-derived"
    pointcloud = body["projects"]["pointcloud_demo"]
    assert pointcloud["tasks"].keys() == {
        "frame_000",
        "frame_001",
        "frame_002",
        "frame_003",
    }
    pointcloud_anchor = pointcloud["tasks"]["frame_000"]["recording_anchors"][
        "foreground_object"
    ]
    assert pointcloud_anchor["label"] == "object"
    assert pointcloud_anchor["bbox"] == [0.472, 0.566, 0.704, 0.982]
    assert pointcloud_anchor["point"] == [0.588, 0.774]
    assert pointcloud_anchor["provenance"] == "reviewed-depth-frame-derived"
    assert body["projects"]["pointcloud_multicam_demo"]["display_id"] == ("P-PC-MULTI")
    assert body["projects"]["pointcloud_multicam_demo"]["tasks"].keys() == {"frame_000"}
    assert body["projects"]["video_demo"]["ml_backend"]["name"] == "screenshot-video"
    video_anchor = body["projects"]["video_demo"]["tasks"]["tracking"][
        "recording_anchors"
    ]["front_truck_f4"]
    assert video_anchor["frame_index"] == 4
    assert video_anchor["bbox"] == [0.492, 0.455, 0.722, 0.825]
    assert video_anchor["negative_point"] == [0.755, 0.755]
    assert "large_image_demo" not in body["projects"]


async def test_catalog_includes_ready_optional_large_image_fixture(
    httpx_client, db_session
):
    projects, _ = await _ready_profile(db_session)
    owner = projects["pointcloud_demo"].owner_id
    project = Project(
        id=uuid.uuid4(),
        display_id="P-LARGE-IMG",
        name="large image",
        type_label="image",
        type_key="image-seg",
        data_type="image",
        owner_id=owner,
    )
    dataset = Dataset(
        id=uuid.uuid4(),
        display_id="DS-LARGE-IMG",
        name="large-image-dev",
        data_type="image",
        file_count=1,
        created_by=owner,
        metadata_={"seed": {"managed_by": "large-image-seed", "manifest_version": 1}},
    )
    db_session.add_all([project, dataset])
    await db_session.flush()
    db_session.add(ProjectDataset(project_id=project.id, dataset_id=dataset.id))
    item = DatasetItem(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        file_name="nasa-cosmic-cliffs-14575x8441.png",
        file_path="large-image-dev/nasa-cosmic-cliffs-14575x8441.png",
        file_type="image",
        file_size=130764157,
        content_hash="e" * 64,
        width=14575,
        height=8441,
        metadata_={
            "seed": {
                "managed_by": "large-image-seed",
                "fixture_id": "nasa-cosmic-cliffs",
                "role": "required-happy-path-high-entropy",
            }
        },
    )
    db_session.add(item)
    await db_session.flush()
    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        dataset_item_id=item.id,
        display_id="T-LARGE-1",
        file_name=item.file_name,
        file_path=item.file_path,
        file_type="image",
    )
    asset = ImagePyramidAsset(
        id=uuid.uuid4(),
        dataset_item_id=item.id,
        profile_version="v1",
        active_generation=1,
    )
    db_session.add_all([task, asset])
    await db_session.flush()
    db_session.add(
        ImagePyramidGeneration(
            asset_id=asset.id,
            generation=1,
            source_identity="etag:test:bytes:130764157",
            source_fingerprint="f" * 64,
            status="ready",
            width=item.width,
            height=item.height,
            max_level=15,
            normalization_version="v1",
            manifest_key="image-pyramids/a/1/manifest.json",
            overview_key="image-pyramids/a/1/overview.webp",
            overview_width=2048,
            overview_height=1186,
            tile_count=694,
            retained_bytes=1234,
        )
    )
    await db_session.flush()

    response = await httpx_client.get(
        "/api/v1/__test/seed/catalog", params={"profile": "screenshots"}
    )

    assert response.status_code == 200, response.text
    large = response.json()["projects"]["large_image_demo"]
    assert large["display_id"] == "P-LARGE-IMG"
    assert large["tasks"]["cosmic_cliffs"]["id"] == str(task.id)


async def test_catalog_rejects_unexpected_task_in_managed_project(
    httpx_client, db_session
):
    projects, _ = await _ready_profile(db_session)
    project = projects["ocr_demo"]
    db_session.add(
        Task(
            project_id=project.id,
            display_id="T-SS-UNEXPECTED",
            file_name="earlier.jpg",
            file_path="ocr-dev/00-earlier.jpg",
            file_type="image",
        )
    )
    await db_session.flush()

    response = await httpx_client.get("/api/v1/__test/seed/catalog")

    assert response.status_code == 409
    assert any(
        "contains unexpected or missing tasks" in issue
        for issue in response.json()["detail"]["issues"]
    )


async def test_catalog_fails_closed_when_primary_backend_is_unbound(
    httpx_client, db_session
):
    projects, _ = await _ready_profile(db_session)
    projects["image_demo"].ml_backend_pool_id = None
    await db_session.flush()

    response = await httpx_client.get("/api/v1/__test/seed/catalog")

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "screenshot_seed_not_ready"
    assert any("primary ML backend is not bound" in issue for issue in detail["issues"])


async def test_catalog_fails_closed_when_media_object_is_missing(
    httpx_client, db_session, monkeypatch
):
    await _ready_profile(db_session)

    def digest_or_missing(file_path: str) -> str:
        if file_path.endswith("screenshot_01.jpg"):
            raise FileNotFoundError(file_path)
        return hashlib.sha256(file_path.encode()).hexdigest()

    monkeypatch.setattr(
        "app.services.screenshot_seed_catalog._storage_object_digest",
        digest_or_missing,
    )

    response = await httpx_client.get("/api/v1/__test/seed/catalog")

    assert response.status_code == 409
    assert any(
        "screenshot_01.jpg is unavailable in storage" in issue
        for issue in response.json()["detail"]["issues"]
    )


async def test_catalog_rejects_multicamera_media_without_calibration(
    httpx_client, db_session
):
    await _ready_profile(db_session)
    camera = await db_session.scalar(
        select(DatasetItem).where(
            DatasetItem.file_path == "pc-multicam-dev/camera/back_right/000000.jpg"
        )
    )
    assert camera is not None
    camera.metadata_ = {}
    await db_session.flush()

    response = await httpx_client.get("/api/v1/__test/seed/catalog")

    assert response.status_code == 409
    assert any(
        "camera pc-multicam-dev/camera/back_right/000000.jpg has no valid calibration"
        in issue
        for issue in response.json()["detail"]["issues"]
    )


async def test_desired_state_reconcile_is_idempotent_and_preserves_user_project(
    db_session,
):
    projects, tasks = await _ready_profile(db_session)
    owner = await db_session.scalar(select(User).where(User.email == "pm"))
    user_project = Project(
        id=uuid.uuid4(),
        display_id="P-USER-KEEP",
        name="user-owned project",
        type_label="图像 · 分类",
        type_key="image-cls",
        data_type="image",
        owner_id=owner.id,
    )
    db_session.add(user_project)
    await db_session.flush()
    task_ids = {
        logical_key: {key: task.id for key, task in project_tasks.items()}
        for logical_key, project_tasks in tasks.items()
    }
    preparation = ScreenshotSeedPreparation(adopt_keys=frozenset())
    digests = {logical_key: "a" * 64 for logical_key in PROJECT_SPECS}

    first = await reconcile_screenshot_seed(
        db_session,
        preparation=preparation,
        asset_sha256=digests,
    )
    second = await reconcile_screenshot_seed(
        db_session,
        preparation=preparation,
        asset_sha256=digests,
    )

    assert first == second == {"projects": 5, "tasks": 15, "batches": 5}
    assert {
        logical_key: {key: task.id for key, task in project_tasks.items()}
        for logical_key, project_tasks in tasks.items()
    } == task_ids
    kept = await db_session.scalar(
        select(Project).where(Project.display_id == "P-USER-KEEP")
    )
    assert kept is not None
    assert kept.name == "user-owned project"
    assert projects["image_demo"].total_tasks == 8
    assert projects["image_demo"].completed_tasks == 1
    assert projects["image_demo"].raster_mask_native_editing_enabled is True


async def test_repair_refuses_unmarked_fixed_id_collision(db_session):
    users = {}
    for email, role in (
        ("admin", "super_admin"),
        ("pm", "project_admin"),
        ("anno", "annotator"),
        ("qa", "reviewer"),
    ):
        user = User(
            id=uuid.uuid4(),
            email=email,
            name=email,
            password_hash="test",
            role=role,
            is_active=True,
        )
        db_session.add(user)
        users[email] = user
    await db_session.flush()
    collision = Project(
        id=uuid.uuid4(),
        display_id="P-COCO8",
        name="user project using a fixed id",
        type_label="图像 · 分类",
        type_key="image-cls",
        data_type="image",
        owner_id=users["pm"].id,
    )
    db_session.add(collision)
    await db_session.flush()

    with pytest.raises(ScreenshotSeedReconcileError, match="not an owned screenshot"):
        await prepare_screenshot_seed(db_session, repair=True)

    kept = await db_session.scalar(select(Project).where(Project.id == collision.id))
    assert kept is collision
