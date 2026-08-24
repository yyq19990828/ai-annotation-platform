"""v0.14.2 · import_nuscenes 的 lite 测试(不依赖真 4GB nuScenes 数据)。

在 tmp_path 造一个极小 fake nuScenes 根目录:2 个 scene、每 scene 3 个 sample、
1 个相机(CAM_FRONT)。验证:
  - 脚本完整跑通无异常;
  - DB 产生 2 个 Scene 行;
  - 每个 scene 的 lidar items frame_index = 0/1/2,scene_id 正确;
  - 跨 scene neighbors 不串(scene A 末帧 task 的 next 为空)。
"""

from __future__ import annotations

import io
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import select

from app.db.models.dataset import Dataset, DatasetItem, Scene
from app.db.models.project import Project
from app.services import scene as scene_svc
from app.services.storage import storage_service
from scripts.import_nuscenes_scene import _derived_display_id, import_nuscenes

pytestmark = pytest.mark.asyncio


async def test_derived_display_id_keeps_short_names_and_bounds_long_names():
    assert _derived_display_id("DS-NU-", "nu-lite") == "DS-NU-nu-lite"

    long_name = "nu-ego-0061-v0143"
    dataset_display_id = _derived_display_id("DS-NU-", long_name)
    project_display_id = _derived_display_id("P-NU-", long_name)

    assert len(dataset_display_id) <= 20
    assert len(project_display_id) <= 20
    assert dataset_display_id.startswith("DS-NU-")
    assert project_display_id.startswith("P-NU-")
    assert dataset_display_id == _derived_display_id("DS-NU-", long_name)
    assert project_display_id == _derived_display_id("P-NU-", long_name)


# --------------------------------------------------------------------------- #
# fake S3:put_object 存 dict,get_object 读回(attach_calibration 要读 calib)
# --------------------------------------------------------------------------- #
class _FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, *, Bucket, Key, Body, ContentType=None):  # noqa: N803
        self.objects[(Bucket, Key)] = bytes(Body)

    def get_object(self, *, Bucket, Key):  # noqa: N803
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}


# --------------------------------------------------------------------------- #
# fake nuScenes 根目录构造
# --------------------------------------------------------------------------- #
_IDENTITY_QUAT = [1.0, 0.0, 0.0, 0.0]
_ZERO_TRANS = [0.0, 0.0, 0.0]
_INTRINSIC = [[1000.0, 0.0, 800.0], [0.0, 1000.0, 450.0], [0.0, 0.0, 1.0]]

# 两个 sensor:LIDAR_TOP + CAM_FRONT
_LIDAR_SENSOR = "sensor-lidar"
_CAM_SENSOR = "sensor-cam-front"
# 两个 calibrated_sensor(token 复用 sensor 名 + 后缀)
_CS_LIDAR = "cs-lidar"
_CS_CAM = "cs-cam-front"


def _write_fake_nuscenes(
    root: Path,
    *,
    scenes: int = 2,
    samples_per: int = 3,
    lidar_translation: list[float] | None = None,
) -> None:
    version = "v1.0-mini"
    meta = root / version
    meta.mkdir(parents=True)

    sensor = [
        {"token": _LIDAR_SENSOR, "channel": "LIDAR_TOP", "modality": "lidar"},
        {"token": _CAM_SENSOR, "channel": "CAM_FRONT", "modality": "camera"},
    ]
    calibrated_sensor = [
        {
            "token": _CS_LIDAR,
            "sensor_token": _LIDAR_SENSOR,
            "translation": lidar_translation or _ZERO_TRANS,
            "rotation": _IDENTITY_QUAT,
            "camera_intrinsic": [],
        },
        {
            "token": _CS_CAM,
            "sensor_token": _CAM_SENSOR,
            "translation": _ZERO_TRANS,
            "rotation": _IDENTITY_QUAT,
            "camera_intrinsic": _INTRINSIC,
        },
    ]

    scene_tbl: list[dict] = []
    sample_tbl: list[dict] = []
    sample_data_tbl: list[dict] = []
    ego_pose_tbl: list[dict] = []

    # 造极小 lidar bin(3 点,每点 5 float)+ 1x1 jpg
    lidar_dir = root / "samples" / "LIDAR_TOP"
    cam_dir = root / "samples" / "CAM_FRONT"
    lidar_dir.mkdir(parents=True)
    cam_dir.mkdir(parents=True)

    pcd_bin = lidar_dir / "lidar.pcd.bin"
    np.array(
        [1, 2, 3, 0.5, 0, 4, 5, 6, 0.5, 1, 7, 8, 9, 0.5, 2],
        dtype=np.float32,
    ).tofile(str(pcd_bin))
    jpg_path = cam_dir / "cam.jpg"
    Image.new("RGB", (1, 1)).save(str(jpg_path), format="JPEG")

    for s_i in range(scenes):
        sample_tokens = [f"sample-{s_i}-{i}" for i in range(samples_per)]
        scene_tbl.append(
            {
                "token": f"scene-token-{s_i}",
                "name": f"scene-{s_i:04d}",
                "description": "",
                "log_token": "log-0",
                "nbr_samples": samples_per,
                "first_sample_token": sample_tokens[0],
                "last_sample_token": sample_tokens[-1],
            }
        )
        for i, tok in enumerate(sample_tokens):
            sample_tbl.append(
                {
                    "token": tok,
                    "timestamp": (s_i * 100 + i) * 500000,
                    "prev": sample_tokens[i - 1] if i > 0 else "",
                    "next": sample_tokens[i + 1] if i < samples_per - 1 else "",
                    "scene_token": f"scene-token-{s_i}",
                }
            )
            ego_lidar = f"ego-lidar-{s_i}-{i}"
            ego_cam = f"ego-cam-{s_i}-{i}"
            # v0.15.0 · 每帧 ego 沿 x 直线前进 2m(造一段可断言差分的轨迹);
            # 同 sample 的 lidar/cam ego 取同值,首帧 calib 外参计算不受影响
            ego_translation = [(s_i * 100 + i) * 2.0, 0.0, 0.0]
            ego_pose_tbl.append(
                {
                    "token": ego_lidar,
                    "timestamp": (s_i * 100 + i) * 500000,
                    "rotation": _IDENTITY_QUAT,
                    "translation": ego_translation,
                }
            )
            ego_pose_tbl.append(
                {
                    "token": ego_cam,
                    "timestamp": (s_i * 100 + i) * 500000,
                    "rotation": _IDENTITY_QUAT,
                    "translation": ego_translation,
                }
            )
            sample_data_tbl.append(
                {
                    "token": f"sd-lidar-{s_i}-{i}",
                    "sample_token": tok,
                    "ego_pose_token": ego_lidar,
                    "calibrated_sensor_token": _CS_LIDAR,
                    "filename": "samples/LIDAR_TOP/lidar.pcd.bin",
                    "fileformat": "pcd",
                    "is_key_frame": True,
                    "height": 0,
                    "width": 0,
                    "timestamp": (s_i * 100 + i) * 500000,
                    "prev": "",
                    "next": "",
                }
            )
            sample_data_tbl.append(
                {
                    "token": f"sd-cam-{s_i}-{i}",
                    "sample_token": tok,
                    "ego_pose_token": ego_cam,
                    "calibrated_sensor_token": _CS_CAM,
                    "filename": "samples/CAM_FRONT/cam.jpg",
                    "fileformat": "jpg",
                    "is_key_frame": True,
                    "height": 1,
                    "width": 1,
                    "timestamp": (s_i * 100 + i) * 500000,
                    "prev": "",
                    "next": "",
                }
            )

    for name, rows in [
        ("scene", scene_tbl),
        ("sample", sample_tbl),
        ("sample_data", sample_data_tbl),
        ("calibrated_sensor", calibrated_sensor),
        ("sensor", sensor),
        ("ego_pose", ego_pose_tbl),
    ]:
        (meta / f"{name}.json").write_text(json.dumps(rows), encoding="utf-8")


async def test_import_nuscenes_two_scenes(
    tmp_path, db_session, super_admin, monkeypatch
):
    user, _ = super_admin
    root = tmp_path / "nuscenes-mini"
    _write_fake_nuscenes(root, scenes=2, samples_per=3)

    monkeypatch.setattr(storage_service, "client", _FakeS3Client())

    result = await import_nuscenes(
        db_session,
        nuscenes_root=root,
        scene_names=["scene-0000", "scene-0001"],
        dataset_name="nu-lite-multi",
        owner_id=user.id,
        dataset_display_id="DS-PC-TEST",
        project_display_id="P-PC-TEST",
        project_name="nuScenes test seed",
        tool_bindings={"lidar_box_3d": {"enabled": True}},
    )

    # 1. 跑通,报告自洽
    assert len(result["scenes"]) == 2
    assert all(s["frames"] == 3 for s in result["scenes"])
    dataset_id = result["dataset_id"]
    dataset = await db_session.get(Dataset, dataset_id)
    project = await db_session.get(Project, result["project_id"])
    assert dataset.display_id == "DS-PC-TEST"
    assert dataset.file_count == 14
    assert dataset.metadata_["axis_convention"] == "iso_8855"
    assert dataset.metadata_["source"] == {
        "format": "nuscenes",
        "version": "v1.0-mini",
        "scenes": ["scene-0000", "scene-0001"],
        "pcd_encoding": "binary_xyz_f32",
    }
    assert project.display_id == "P-PC-TEST"
    assert project.name == "nuScenes test seed"
    assert project.tool_bindings == {"lidar_box_3d": {"enabled": True}}
    items = list(
        (
            await db_session.execute(
                select(DatasetItem).where(DatasetItem.dataset_id == dataset_id)
            )
        ).scalars()
    )
    assert len(items) == 14
    assert all(item.content_hash and len(item.content_hash) == 64 for item in items)

    # 2. DB 里 2 个 Scene 行,name 对应
    scenes = (
        (
            await db_session.execute(
                select(Scene).where(Scene.dataset_id == dataset_id).order_by(Scene.name)
            )
        )
        .scalars()
        .all()
    )
    assert [s.name for s in scenes] == ["scene-0000", "scene-0001"]

    # 3. 每个 scene 的 lidar items frame_index = 0/1/2,scene_id 正确
    for scene in scenes:
        lidar_rows = (
            (
                await db_session.execute(
                    select(DatasetItem)
                    .where(DatasetItem.scene_id == scene.id)
                    .where(DatasetItem.file_type == "point_cloud")
                    .order_by(DatasetItem.frame_index)
                )
            )
            .scalars()
            .all()
        )
        assert [r.frame_index for r in lidar_rows] == [0, 1, 2]
        assert all(r.scene_id == scene.id for r in lidar_rows)

    # 3.5 v0.15.0 · 每 scene 落 3 行 ego pose:frame_index 对齐、timestamp 单调、
    # translation 差分 = 设定步长(2m/帧)
    from app.services import scene_pose as scene_pose_svc

    for scene in scenes:
        traj = await scene_pose_svc.get_trajectory(db_session, scene.id)
        assert [p.frame_index for p in traj] == [0, 1, 2]
        ts = [p.timestamp_us for p in traj]
        assert ts == sorted(ts) and len(set(ts)) == 3
        xs = [p.ego_translation[0] for p in traj]
        assert xs[1] - xs[0] == pytest.approx(2.0)
        assert xs[2] - xs[1] == pytest.approx(2.0)
        assert all(p.ego_rotation == [1.0, 0.0, 0.0, 0.0] for p in traj)

    # 4. 跨 scene neighbors 不串:scene A 末帧 task 的 next 为空
    from app.db.models.task import Task

    scene_a = scenes[0]
    last_lidar = (
        await db_session.execute(
            select(DatasetItem)
            .where(DatasetItem.scene_id == scene_a.id)
            .where(DatasetItem.file_type == "point_cloud")
            .where(DatasetItem.frame_index == 2)
        )
    ).scalar_one()
    last_task = (
        await db_session.execute(
            select(Task).where(Task.dataset_item_id == last_lidar.id)
        )
    ).scalar_one()

    neighbors = await scene_svc.get_neighbors_for_task(
        db_session, task_id=last_task.id, k=1
    )
    assert neighbors is not None
    assert neighbors.scene_total_frames == 3
    assert neighbors.frame_index == 2
    assert neighbors.next == []  # 不串到 scene B 首帧
    assert len(neighbors.prev) == 1
    assert neighbors.prev[0].frame_index == 1


async def test_backfill_frame_poses_restores_deleted_rows(
    tmp_path, db_session, super_admin, monkeypatch
):
    """v0.15.0 · backfill 脚本:模拟 v0.15.0 前导入的库(无 pose 行)→ 补齐。"""
    from sqlalchemy import delete

    from app.db.models.scene_pose import SceneFramePose
    from app.services import scene_pose as scene_pose_svc
    from scripts.backfill_frame_poses import backfill_frame_poses

    user, _ = super_admin
    root = tmp_path / "nuscenes-mini"
    _write_fake_nuscenes(root, scenes=1, samples_per=3)
    monkeypatch.setattr(storage_service, "client", _FakeS3Client())

    result = await import_nuscenes(
        db_session,
        nuscenes_root=root,
        scene_names=["scene-0000"],
        dataset_name="nu-lite-bf",
        owner_id=user.id,
    )
    await db_session.execute(delete(SceneFramePose))

    report = await backfill_frame_poses(
        db_session,
        dataset_ref=str(result["dataset_id"]),
        nuscenes_root=root,
    )
    assert report == [{"name": "scene-0000", "poses": 3}]

    scene = (
        await db_session.execute(
            select(Scene).where(Scene.dataset_id == result["dataset_id"])
        )
    ).scalar_one()
    traj = await scene_pose_svc.get_trajectory(db_session, scene.id)
    assert [p.frame_index for p in traj] == [0, 1, 2]
    assert [p.ego_translation[0] for p in traj] == [0.0, 2.0, 4.0]

    # display_id 引用同样可用,且 upsert 幂等(重跑不翻倍)
    report2 = await backfill_frame_poses(
        db_session, dataset_ref="DS-NU-nu-lite-bf", nuscenes_root=root
    )
    assert report2 == [{"name": "scene-0000", "poses": 3}]
    assert len(await scene_pose_svc.get_trajectory(db_session, scene.id)) == 3


async def test_manifest_exposes_ego_pose(
    tmp_path, db_session, httpx_client, super_admin, monkeypatch
):
    """v0.15.0 · manifest 透出本帧 ego_pose(无位姿时为 null,此处验证有值路径)。"""
    from app.db.models.task import Task

    user, token = super_admin
    root = tmp_path / "nuscenes-mini"
    _write_fake_nuscenes(root, scenes=1, samples_per=2)
    monkeypatch.setattr(storage_service, "client", _FakeS3Client())
    monkeypatch.setattr(
        storage_service,
        "generate_download_url",
        lambda key, **kw: f"https://fake/{key}",
    )

    result = await import_nuscenes(
        db_session,
        nuscenes_root=root,
        scene_names=["scene-0000"],
        dataset_name="nu-lite-mani",
        owner_id=user.id,
    )

    frame1_item = (
        await db_session.execute(
            select(DatasetItem)
            .where(DatasetItem.dataset_id == result["dataset_id"])
            .where(DatasetItem.file_type == "point_cloud")
            .where(DatasetItem.frame_index == 1)
        )
    ).scalar_one()
    task = (
        await db_session.execute(
            select(Task).where(Task.dataset_item_id == frame1_item.id)
        )
    ).scalar_one()

    resp = await httpx_client.get(
        f"/api/v1/tasks/{task.id}/point-cloud/manifest",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["frame_index"] == 1
    assert body["ego_pose"]["frame_index"] == 1
    assert body["ego_pose"]["ego_translation"] == [2.0, 0.0, 0.0]
    assert body["ego_pose"]["ego_rotation"] == [1.0, 0.0, 0.0, 0.0]
    assert body["ego_pose"]["timestamp_us"] == 500000


async def test_import_nuscenes_bounds_long_derived_display_ids(
    tmp_path, db_session, super_admin, monkeypatch
):
    user, _ = super_admin
    root = tmp_path / "nuscenes-mini"
    _write_fake_nuscenes(root, scenes=1, samples_per=1)
    monkeypatch.setattr(storage_service, "client", _FakeS3Client())

    dataset_name = "nu-ego-0061-v0143"
    result = await import_nuscenes(
        db_session,
        nuscenes_root=root,
        scene_names=["scene-0000"],
        dataset_name=dataset_name,
        owner_id=user.id,
    )

    dataset = await db_session.get(Dataset, result["dataset_id"])
    project = await db_session.get(Project, result["project_id"])

    assert dataset.display_id == _derived_display_id("DS-NU-", dataset_name)
    assert project.display_id == _derived_display_id("P-NU-", dataset_name)
    assert len(dataset.display_id) <= 20
    assert len(project.display_id) <= 20


async def test_import_nuscenes_frame_modes_axis_and_points(
    tmp_path, db_session, super_admin, monkeypatch
):
    user, _ = super_admin
    root = tmp_path / "nuscenes-mini"
    _write_fake_nuscenes(
        root,
        scenes=1,
        samples_per=1,
        lidar_translation=[10.0, 20.0, 30.0],
    )

    fake_client = _FakeS3Client()
    monkeypatch.setattr(storage_service, "client", fake_client)

    ego_result = await import_nuscenes(
        db_session,
        nuscenes_root=root,
        scene_names=["scene-0000"],
        dataset_name="nu-lite-ego",
        owner_id=user.id,
        frame="ego",
    )
    sensor_result = await import_nuscenes(
        db_session,
        nuscenes_root=root,
        scene_names=["scene-0000"],
        dataset_name="nu-lite-sensor",
        owner_id=user.id,
        frame="sensor",
    )

    ego_dataset = await db_session.get(Dataset, ego_result["dataset_id"])
    sensor_dataset = await db_session.get(Dataset, sensor_result["dataset_id"])
    assert ego_dataset.metadata_["axis_convention"] == "iso_8855"
    assert sensor_dataset.metadata_["axis_convention"] == "apollo"

    def first_point(dataset_name: str) -> tuple[float, float, float]:
        key = next(
            k
            for _, k in fake_client.objects
            if f"{dataset_name}/" in k and k.endswith(".pcd")
        )
        payload = fake_client.objects[(storage_service.datasets_bucket, key)]
        marker = b"DATA binary\n"
        offset = payload.index(marker) + len(marker)
        return tuple(np.frombuffer(payload[offset : offset + 12], dtype="<f4"))

    assert first_point("nu-lite-ego") == pytest.approx((11.0, 22.0, 33.0))
    assert first_point("nu-lite-sensor") == pytest.approx((1.0, 2.0, 3.0))


async def test_existing_ascii_scene_is_upgraded_in_place(
    tmp_path, db_session, super_admin, monkeypatch
):
    user, _ = super_admin
    root = tmp_path / "nuscenes-mini"
    _write_fake_nuscenes(root, scenes=1, samples_per=1)
    fake_client = _FakeS3Client()
    monkeypatch.setattr(storage_service, "client", fake_client)

    first = await import_nuscenes(
        db_session,
        nuscenes_root=root,
        scene_names=["scene-0000"],
        dataset_name="nu-lite-upgrade",
        owner_id=user.id,
    )
    dataset = await db_session.get(Dataset, first["dataset_id"])
    item = (
        await db_session.execute(
            select(DatasetItem)
            .where(DatasetItem.dataset_id == dataset.id)
            .where(DatasetItem.file_type == "point_cloud")
        )
    ).scalar_one()
    legacy = (
        b"# .PCD v0.7 - Point Cloud Data file format\n"
        b"VERSION 0.7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\n"
        b"WIDTH 3\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 3\nDATA ascii\n"
        b"1 2 3\n4 5 6\n7 8 9\n"
    )
    fake_client.objects[(storage_service.datasets_bucket, item.file_path)] = legacy
    item.file_size = len(legacy)
    item.content_hash = hashlib.sha256(legacy).hexdigest()
    metadata = dict(dataset.metadata_ or {})
    source = dict(metadata["source"])
    source.pop("pcd_encoding", None)
    metadata["source"] = source
    dataset.metadata_ = metadata
    await db_session.flush()

    second = await import_nuscenes(
        db_session,
        nuscenes_root=root,
        scene_names=["scene-0000"],
        dataset_name="nu-lite-upgrade",
        owner_id=user.id,
    )

    upgraded = fake_client.objects[(storage_service.datasets_bucket, item.file_path)]
    assert second["scenes"] == [
        {
            "name": "scene-0000",
            "frames": 1,
            "skipped": True,
            "upgraded_point_clouds": 1,
        }
    ]
    assert b"DATA binary\n" in upgraded[:200]
    assert item.file_size == len(upgraded)
    assert item.content_hash == hashlib.sha256(upgraded).hexdigest()
    assert dataset.metadata_["source"]["pcd_encoding"] == "binary_xyz_f32"
