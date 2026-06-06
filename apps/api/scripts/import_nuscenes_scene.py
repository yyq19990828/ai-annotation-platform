"""v0.14.2 · nuScenes-mini → 本平台原生目录结构 + 入库(MinIO + DB)一次性转换脚本。

把 nuScenes 数据集的一个或多个 scene 转成本平台点云原生目录结构,并 **显式调用
v0.14.0 的 scene service** 建 scene + 给 items 赋 frame_index(不依赖
build_pointcloud_tasks_for_link 的目录启发式 single-scene inference)。

不引入 nuscenes-devkit 依赖——自己读 JSON。只依赖 numpy + Pillow(均已是项目依赖)。

数据下载:https://www.nuscenes.org/nuscenes#download (取 "Mini" split,解压后
根目录形如 <root>/v1.0-mini/*.json + <root>/samples/<CHANNEL>/*.{jpg,pcd.bin})。

用法示例:
    cd apps/api

    # 单 scene(注意 PYTHONPATH=. 才能 import app.*,与其他 seed 脚本一致)
    PYTHONPATH=. uv run python scripts/import_nuscenes_scene.py \
        --nuscenes-root /data/nuscenes-mini \
        --scene-tokens scene-0061 \
        --dataset-name nu-scene-0061 \
        --frame ego

    # 多 scene 共用 dataset(验证 v0.14.0 多 scene 隔离)
    PYTHONPATH=. uv run python scripts/import_nuscenes_scene.py \
        --nuscenes-root /data/nuscenes-mini \
        --scene-tokens scene-0061,scene-0103,scene-0553 \
        --dataset-name nu-mini-multi

注意 `--scene-tokens` 实际匹配 scene.json 的 `name` 字段(如 scene-0061),不是 token。

平台原生目录约定(storage key);帧 stem 用 <scene_name>_<idx 6位> 保证跨 scene 全局唯一
(group_frames 以文件名 stem 作帧键,多 scene 同号帧会撞键):
    <dataset_name>/<scene_name>/lidar/<scene_name>_<idx 6位>.pcd            file_type=point_cloud
    <dataset_name>/<scene_name>/camera/<CHANNEL>/<scene_name>_<idx 6位>.jpg  file_type=image
    <dataset_name>/<scene_name>/calib/camera/<CHANNEL>.json                 file_type=other

标定:本版用 **每个 scene 第 1 帧** 的标定对全 scene 通用(metadata 记
timestamp_delta_us 备查;前端不消费;逐帧真补偿留 v0.15+)。

幂等:dataset 按派生 display_id 复用(短名为 DS-NU-<name>,超长名加 hash 截断到
DB display_id 长度限制内);scene 按 (dataset_id, name) 已存在则跳过该 scene;
build_tasks_for_link 本身幂等。

================================ 手动测试 checklist ================================
跑真实 nuScenes-mini 后人工验证(浏览器 + curl,token 自备):
  1. 脚本 stdout 报告:每个 scene 的 frames 数 = nbr_samples,total_items 合理。
  2. 浏览器打开任一 scene 第 1 帧 BEV:默认 --frame ego 时车头朝上
     (点已变换到 ego/ISO 系,axis_convention=iso_8855)。
  3. 6 路相机投影:点云投到各 CAM 图像上大致对齐(用第 1 帧标定,首帧最准)。
  4. curl /scenes?dataset_id=<id> 返回 N 个 scene(= 传入的 scene 数)。
  5. curl /tasks/<某 scene 末帧 task>/neighbors:next 为空,不串到下一个 scene 首帧。
  6. curl -X POST /datasets/<id>/sniff-axis-convention 命中 iso_8855。
     若显式 --frame sensor,则保留 v0.14.2 raw LIDAR_TOP/apollo 行为。
  7. (若已有 v0.14.1)工作台 Shift+→ 翻到 scene 末帧后不跳到下一 scene。
====================================================================================
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import uuid
from pathlib import Path
from typing import Literal

import numpy as np

# nuScenes 默认 6 相机通道(modality=camera 全收,这里仅作文档参考)。
_NUSCENES_CAM_CHANNELS = (
    "CAM_FRONT",
    "CAM_FRONT_RIGHT",
    "CAM_BACK_RIGHT",
    "CAM_BACK",
    "CAM_BACK_LEFT",
    "CAM_FRONT_LEFT",
)

_DISPLAY_ID_MAX_LENGTH = 20
_DISPLAY_ID_HASH_LENGTH = 8


def _derived_display_id(prefix: str, name: str) -> str:
    """Return a deterministic display_id that fits the current DB varchar(20)."""
    display_id = f"{prefix}{name}"
    if len(display_id) <= _DISPLAY_ID_MAX_LENGTH:
        return display_id

    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:_DISPLAY_ID_HASH_LENGTH]
    head_len = _DISPLAY_ID_MAX_LENGTH - len(prefix) - 1 - len(digest)
    if head_len <= 0:
        raise ValueError(f"display_id prefix {prefix!r} is too long")
    return f"{prefix}{name[:head_len]}-{digest}"


# --------------------------------------------------------------------------- #
# nuScenes JSON 读取 + 索引
# --------------------------------------------------------------------------- #
def _load_table(meta_dir: Path, name: str) -> list[dict]:
    """读 <meta_dir>/<name>.json(nuScenes 表都是 list[dict])。"""
    with (meta_dir / f"{name}.json").open(encoding="utf-8") as f:
        return json.load(f)


def _index_by_token(rows: list[dict]) -> dict[str, dict]:
    return {row["token"]: row for row in rows}


# --------------------------------------------------------------------------- #
# 几何:四元数 wxyz → 旋转矩阵;变换矩阵组装;lidar→camera 外参链
# --------------------------------------------------------------------------- #
def _quat_wxyz_to_rot(q: list[float]) -> np.ndarray:
    """nuScenes rotation 是 [w, x, y, z] 四元数 → 3x3 旋转矩阵。"""
    w, x, y, z = q
    n = w * w + x * x + y * y + z * z
    if n < 1e-12:
        return np.eye(3)
    s = 2.0 / n
    wx, wy, wz = s * w * x, s * w * y, s * w * z
    xx, xy, xz = s * x * x, s * x * y, s * x * z
    yy, yz, zz = s * y * y, s * y * z, s * z * z
    return np.array(
        [
            [1.0 - (yy + zz), xy - wz, xz + wy],
            [xy + wz, 1.0 - (xx + zz), yz - wx],
            [xz - wy, yz + wx, 1.0 - (xx + yy)],
        ]
    )


def _transform(rotation: list[float], translation: list[float]) -> np.ndarray:
    """由四元数(wxyz)+ 平移构造 4x4 齐次变换矩阵(source→target)。"""
    T = np.eye(4)
    T[:3, :3] = _quat_wxyz_to_rot(rotation)
    T[:3, 3] = np.asarray(translation, dtype=float)
    return T


def _compute_lidar_to_cam_extrinsic(
    *,
    cs_lidar: dict,
    ego_lidar: dict,
    cs_cam: dict,
    ego_cam: dict,
) -> list[float]:
    """标准 nuScenes 投影链:lidar 帧 → camera 帧的 4x4 外参,拍平成 row-major 16-float。

        T_cam_from_lidar =
            inv(T_ego_from_cam) @ inv(T_global_from_egoCam)
            @ T_global_from_egoLidar @ T_ego_from_lidar

    calibrated_sensor 的 (rotation, translation) 表示 sensor→ego;
    ego_pose 的 (rotation, translation) 表示 ego→global。
    """
    T_ego_from_lidar = _transform(cs_lidar["rotation"], cs_lidar["translation"])
    T_global_from_egoLidar = _transform(ego_lidar["rotation"], ego_lidar["translation"])
    T_ego_from_cam = _transform(cs_cam["rotation"], cs_cam["translation"])
    T_global_from_egoCam = _transform(ego_cam["rotation"], ego_cam["translation"])

    T_cam_from_lidar = (
        np.linalg.inv(T_ego_from_cam)
        @ np.linalg.inv(T_global_from_egoCam)
        @ T_global_from_egoLidar
        @ T_ego_from_lidar
    )
    return [float(v) for v in T_cam_from_lidar.reshape(-1)]


def _compute_ego_to_cam_extrinsic(
    *,
    ego_lidar: dict,
    cs_cam: dict,
    ego_cam: dict,
) -> list[float]:
    """nuScenes 投影链:lidar timestamp ego 帧 → camera 帧的 4x4 外参。

    ego 模式下点已先从 LIDAR_TOP sensor 系变换到 lidar sample 的 ego 系,所以
    外参链不再包含 T_ego_from_lidar。
    """
    T_global_from_egoLidar = _transform(ego_lidar["rotation"], ego_lidar["translation"])
    T_ego_from_cam = _transform(cs_cam["rotation"], cs_cam["translation"])
    T_global_from_egoCam = _transform(ego_cam["rotation"], ego_cam["translation"])

    T_cam_from_ego = (
        np.linalg.inv(T_ego_from_cam)
        @ np.linalg.inv(T_global_from_egoCam)
        @ T_global_from_egoLidar
    )
    return [float(v) for v in T_cam_from_ego.reshape(-1)]


# --------------------------------------------------------------------------- #
# .pcd.bin → ASCII PCD
# --------------------------------------------------------------------------- #
def _lidar_bin_to_ascii_pcd(
    bin_path: Path,
    *,
    transform: np.ndarray | None = None,
) -> bytes:
    """nuScenes LIDAR_TOP .pcd.bin 是 float32 数组,每点 5 个 float (x y z intensity ring)。
    只取前 3 列写成标准 ASCII PCD(x y z)。"""
    pts = np.fromfile(str(bin_path), dtype=np.float32).reshape(-1, 5)[:, :3]
    if transform is not None and pts.size:
        pts = pts @ transform[:3, :3].T + transform[:3, 3]
    n = pts.shape[0]
    header = (
        "# .PCD v0.7 - Point Cloud Data file format\n"
        "VERSION 0.7\n"
        "FIELDS x y z\n"
        "SIZE 4 4 4\n"
        "TYPE F F F\n"
        "COUNT 1 1 1\n"
        f"WIDTH {n}\n"
        "HEIGHT 1\n"
        "VIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {n}\n"
        "DATA ascii\n"
    )
    lines = "\n".join(f"{p[0]} {p[1]} {p[2]}" for p in pts)
    body = lines + ("\n" if n else "")
    return (header + body).encode("utf-8")


# --------------------------------------------------------------------------- #
# scene 遍历:沿 sample.next 链得到有序 sample 列表
# --------------------------------------------------------------------------- #
def _ordered_samples(scene: dict, samples_by_token: dict[str, dict]) -> list[dict]:
    """从 first_sample_token 沿 next 链得到该 scene 全部 sample(按时间顺序)。"""
    out: list[dict] = []
    token = scene["first_sample_token"]
    while token:
        sample = samples_by_token.get(token)
        if sample is None:
            break
        out.append(sample)
        token = sample.get("next") or ""
    return out


def _key_sample_data_by_channel(
    sample_token: str,
    sample_data: list[dict],
    cs_by_token: dict[str, dict],
    sensor_by_token: dict[str, dict],
) -> dict[str, dict]:
    """该 sample 下、is_key_frame==True 的 sample_data,按 sensor channel 归集。
    返回 {channel: sample_data_row}(每 channel 一条 keyframe)。"""
    out: dict[str, dict] = {}
    for sd in sample_data:
        if sd["sample_token"] != sample_token or not sd.get("is_key_frame"):
            continue
        cs = cs_by_token[sd["calibrated_sensor_token"]]
        sensor = sensor_by_token[cs["sensor_token"]]
        out[sensor["channel"]] = sd
    return out


# --------------------------------------------------------------------------- #
# 核心:可被 pytest 直接驱动的 async 入口
# --------------------------------------------------------------------------- #
async def import_nuscenes(
    db,
    *,
    nuscenes_root: Path,
    scene_names: list[str],
    dataset_name: str,
    owner_id: uuid.UUID,
    version: str = "v1.0-mini",
    frame: Literal["sensor", "ego"] = "ego",
) -> dict:
    """把 nuScenes 的若干 scene 转换并入库到一个共用 dataset。

    流程(每个 scene 一个顶层子目录,显式 create_scene + assign_items_to_scene):
      1. ensure/复用 dataset(display_id 由 dataset_name 稳定派生且不超过 20 字符,
         data_type=point_cloud, metadata_={axis_convention: iso_8855|apollo})。
      2. 逐 scene:沿 sample.next 链取有序 sample;每帧转 lidar PCD + 各 CAM jpg +
         (首帧)算 calib;建 DatasetItem;create_scene + assign(lidar 有序、cam 同帧、
         calib scene-level)。已存在同名 scene 则跳过(幂等)。
      3. 建/复用 lidar Project + ProjectDataset,build_tasks_for_link(route 到点云路径,
         此时 dataset 已有 scene → inference hook 幂等跳过)+ attach_calibration。

    调用方负责最终 commit(build_tasks_for_link 内部会 commit;参考 seed_pointcloud)。
    返回 {"dataset_id", "scenes": [{"name", "frames"}...], "total_items"}。
    """
    from sqlalchemy import select

    from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
    from app.db.models.project import Project
    from app.services import scene as scene_svc
    from app.services.dataset import build_tasks_for_link
    from app.services.pointcloud_import import attach_calibration
    from app.services.storage import storage_service

    meta_dir = nuscenes_root / version
    if not meta_dir.exists():
        raise FileNotFoundError(f"nuScenes 元数据目录缺失: {meta_dir}")

    # 读 nuScenes 表 + 建索引
    scenes_tbl = _load_table(meta_dir, "scene")
    samples_by_token = _index_by_token(_load_table(meta_dir, "sample"))
    sample_data = _load_table(meta_dir, "sample_data")
    cs_by_token = _index_by_token(_load_table(meta_dir, "calibrated_sensor"))
    sensor_by_token = _index_by_token(_load_table(meta_dir, "sensor"))
    ego_by_token = _index_by_token(_load_table(meta_dir, "ego_pose"))

    scene_by_name = {s["name"]: s for s in scenes_tbl}
    axis_convention = "iso_8855" if frame == "ego" else "apollo"

    # 1. ensure/复用 dataset(派生固定 display_id → 幂等)
    display_id = _derived_display_id("DS-NU-", dataset_name)
    ds = await db.scalar(select(Dataset).where(Dataset.display_id == display_id))
    if ds is None:
        ds = Dataset(
            id=uuid.uuid4(),
            display_id=display_id,
            name=dataset_name,
            data_type="point_cloud",
            created_by=owner_id,
            metadata_={"axis_convention": axis_convention},
        )
        db.add(ds)
        await db.flush()
    else:
        meta = dict(ds.metadata_ or {})
        existing_axis = meta.get("axis_convention")
        if existing_axis and existing_axis != axis_convention:
            raise ValueError(
                f"dataset {ds.display_id} axis_convention={existing_axis!r} "
                f"cannot accept --frame {frame} ({axis_convention!r}); "
                "use a different --dataset-name to avoid mixing sensor and ego frames"
            )
        if not existing_axis:
            meta["axis_convention"] = axis_convention
            ds.metadata_ = meta
            await db.flush()

    bucket = storage_service.datasets_bucket
    existing_scene_names = {s.name for s in await scene_svc.list_for_dataset(db, ds.id)}

    report_scenes: list[dict] = []
    total_items = 0

    # 2. 逐 scene 转换 + 入库
    for scene_name in scene_names:
        scene_row = scene_by_name.get(scene_name)
        if scene_row is None:
            raise ValueError(
                f"scene name {scene_name!r} 在 {meta_dir}/scene.json 中不存在"
            )

        if scene_name in existing_scene_names:
            # 幂等:同名 scene 已建过,跳过(仍记入报告)
            samples = _ordered_samples(scene_row, samples_by_token)
            report_scenes.append(
                {"name": scene_name, "frames": len(samples), "skipped": True}
            )
            continue

        samples = _ordered_samples(scene_row, samples_by_token)
        if not samples:
            raise ValueError(f"scene {scene_name!r} 无 sample(数据损坏?)")

        scene_token = scene_row["token"]
        first_ts = samples[0]["timestamp"]
        last_ts = samples[-1]["timestamp"]

        lidar_items: list[DatasetItem] = []  # 主帧,按帧序
        cam_frame_index: dict[uuid.UUID, int] = {}  # cam item.id -> frame_index
        calib_items: list[DatasetItem] = []  # scene-level(frame_index=NULL)
        calib_written = False

        for frame_idx, sample in enumerate(samples):
            idx6 = f"{frame_idx:06d}"
            # group_frames 以"文件名 stem"作帧键,而每个 scene 的 idx6 都从 0 起会重号;
            # 多 scene 共用一个 dataset 时,不同 scene 的同号帧 stem 冲突,
            # build_pointcloud_tasks_for_link 会把它们并成一个 task(漏建)。用 scene_name
            # 前缀让 stem 全局唯一即可绕开(不动 group_frames)。scene 内 frame_index 仍由
            # assign_items_to_scene 按 lidar_items 顺序赋 0..N-1,与文件名解耦。
            frame_stem = f"{scene_name}_{idx6}"
            by_channel = _key_sample_data_by_channel(
                sample["token"], sample_data, cs_by_token, sensor_by_token
            )

            # ---- LIDAR_TOP ----
            lidar_sd = None
            for channel, sd in by_channel.items():
                cs = cs_by_token[sd["calibrated_sensor_token"]]
                if sensor_by_token[cs["sensor_token"]]["modality"] == "lidar":
                    lidar_sd = sd
                    break
            if lidar_sd is None:
                raise ValueError(
                    f"scene {scene_name!r} sample {sample['token']!r} 无 lidar keyframe"
                )

            cs_lidar = cs_by_token[lidar_sd["calibrated_sensor_token"]]
            ego_lidar = ego_by_token[lidar_sd["ego_pose_token"]]
            T_ego_from_lidar = _transform(
                cs_lidar["rotation"],
                cs_lidar["translation"],
            )
            pcd_bytes = _lidar_bin_to_ascii_pcd(
                nuscenes_root / lidar_sd["filename"],
                transform=T_ego_from_lidar if frame == "ego" else None,
            )
            lidar_key = f"{dataset_name}/{scene_name}/lidar/{frame_stem}.pcd"
            storage_service.client.put_object(
                Bucket=bucket, Key=lidar_key, Body=pcd_bytes
            )
            lidar_item = DatasetItem(
                dataset_id=ds.id,
                file_name=f"{frame_stem}.pcd",
                file_path=lidar_key,
                file_type="point_cloud",
                file_size=len(pcd_bytes),
            )
            db.add(lidar_item)
            lidar_items.append(lidar_item)
            total_items += 1

            # ---- 各 CAM(modality==camera)----
            for channel, sd in by_channel.items():
                cs = cs_by_token[sd["calibrated_sensor_token"]]
                if sensor_by_token[cs["sensor_token"]]["modality"] != "camera":
                    continue

                jpg_bytes = (nuscenes_root / sd["filename"]).read_bytes()
                cam_key = f"{dataset_name}/{scene_name}/camera/{channel}/{frame_stem}.jpg"
                storage_service.client.put_object(
                    Bucket=bucket, Key=cam_key, Body=jpg_bytes
                )
                cam_item = DatasetItem(
                    dataset_id=ds.id,
                    file_name=f"{frame_stem}.jpg",
                    file_path=cam_key,
                    file_type="image",
                    file_size=len(jpg_bytes),
                )
                db.add(cam_item)
                await db.flush()  # 拿 id 以填 shared_frame_items
                cam_frame_index[cam_item.id] = frame_idx
                total_items += 1

                # 首帧:算该相机外参 + 内参,写 calib/camera/<channel>.json
                if not calib_written:
                    ego_cam = ego_by_token[sd["ego_pose_token"]]
                    intrinsic_3x3 = cs["camera_intrinsic"]
                    if not intrinsic_3x3:
                        # 无内参的相机(理论不应出现在 CAM_*),跳过 calib
                        continue
                    if frame == "ego":
                        extrinsic = _compute_ego_to_cam_extrinsic(
                            ego_lidar=ego_lidar,
                            cs_cam=cs,
                            ego_cam=ego_cam,
                        )
                    else:
                        extrinsic = _compute_lidar_to_cam_extrinsic(
                            cs_lidar=cs_lidar,
                            ego_lidar=ego_lidar,
                            cs_cam=cs,
                            ego_cam=ego_cam,
                        )
                    intrinsic = [float(v) for row in intrinsic_3x3 for v in row]
                    calib_payload = {"extrinsic": extrinsic, "intrinsic": intrinsic}
                    calib_key = (
                        f"{dataset_name}/{scene_name}/calib/camera/{channel}.json"
                    )
                    calib_bytes = json.dumps(calib_payload).encode("utf-8")
                    storage_service.client.put_object(
                        Bucket=bucket, Key=calib_key, Body=calib_bytes
                    )
                    calib_item = DatasetItem(
                        dataset_id=ds.id,
                        file_name=f"{channel}.json",
                        file_path=calib_key,
                        file_type="other",
                        file_size=len(calib_bytes),
                    )
                    db.add(calib_item)
                    calib_items.append(calib_item)
                    total_items += 1

            calib_written = True

        await db.flush()  # 确保 lidar_items 都有 id

        # 显式建 scene + 赋 frame_index(不依赖目录启发式 inference)
        scene = await scene_svc.create_scene(
            db,
            dataset_id=ds.id,
            name=scene_name,
            source_format="nuscenes",
            source_metadata={
                "scene_token": scene_token,
                "first_sample_token": scene_row["first_sample_token"],
                "frame_count": len(samples),
                "duration_s": (last_ts - first_ts) / 1e6,
                "nuscenes_version": version,
                "frame": frame,
                # 标定用首帧近似;末帧与首帧的时间差,备查(前端不消费)。
                "timestamp_delta_us": last_ts - first_ts,
            },
            created_by=owner_id,
        )
        await scene_svc.assign_items_to_scene(
            db,
            scene_id=scene.id,
            items_in_order=lidar_items,
            shared_frame_items=cam_frame_index,
            scene_level_items=calib_items,
        )
        report_scenes.append({"name": scene_name, "frames": len(samples)})

    # 3. 建/复用 lidar Project + ProjectDataset → build_tasks_for_link + attach_calibration
    project_display_id = _derived_display_id("P-NU-", dataset_name)
    project = await db.scalar(
        select(Project).where(Project.display_id == project_display_id)
    )
    if project is None:
        project = Project(
            id=uuid.uuid4(),
            display_id=project_display_id,
            name=f"nuScenes {dataset_name}",
            type_label="点云检测",
            type_key="lidar",
            data_type="lidar",
            owner_id=owner_id,
            tool_bindings={},
            ai_enabled=False,
        )
        db.add(project)
        await db.flush()

    link_exists = await db.scalar(
        select(ProjectDataset).where(
            ProjectDataset.project_id == project.id,
            ProjectDataset.dataset_id == ds.id,
        )
    )
    if link_exists is None:
        db.add(ProjectDataset(project_id=project.id, dataset_id=ds.id))
        await db.flush()

    # dataset 已有 scene → build_pointcloud_tasks_for_link 的 inference hook 幂等跳过,
    # task 通过 dataset_item_id → scene_id 反查到 frame_index。
    await build_tasks_for_link(db, dataset_id=ds.id, project_id=project.id)
    await attach_calibration(db, dataset_id=ds.id)
    await db.flush()

    return {
        "dataset_id": ds.id,
        "project_id": project.id,
        "scenes": report_scenes,
        "total_items": total_items,
    }


# --------------------------------------------------------------------------- #
# admin / CLI
# --------------------------------------------------------------------------- #
async def _ensure_admin(db) -> uuid.UUID:
    """取标准 admin 用户;库里没有则按 admin/123456 建一个(与 seed_pointcloud 一致)。"""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db.models.user import User

    admin = await db.scalar(select(User).where(User.email == "admin"))
    if admin:
        return admin.id
    admin = User(
        id=uuid.uuid4(),
        email="admin",
        name="超级管理员",
        password_hash=hash_password("123456"),
        role="super_admin",
        is_active=True,
    )
    db.add(admin)
    await db.flush()
    return admin.id


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="把 nuScenes-mini 的一个/多个 scene 转换并入库到本平台(MinIO + DB)。"
    )
    parser.add_argument(
        "--nuscenes-root",
        required=True,
        help="nuScenes 根目录(含 <version>/*.json 与 samples/<CHANNEL>/...)",
    )
    parser.add_argument(
        "--scene-tokens",
        required=True,
        help="逗号分隔的 scene name 列表(如 scene-0061,scene-0103)",
    )
    parser.add_argument("--dataset-name", required=True, help="目标 dataset 名(共用)")
    parser.add_argument("--version", default="v1.0-mini", help="nuScenes 版本子目录")
    parser.add_argument(
        "--frame",
        choices=["ego", "sensor"],
        default="ego",
        help="点云输出坐标系: ego=默认,点变换到 ego/ISO; sensor=保留 LIDAR_TOP/apollo",
    )
    args = parser.parse_args()

    scene_names = [s.strip() for s in args.scene_tokens.split(",") if s.strip()]

    from app.db.base import async_session

    async with async_session() as db:
        owner_id = await _ensure_admin(db)
        info = await import_nuscenes(
            db,
            nuscenes_root=Path(args.nuscenes_root),
            scene_names=scene_names,
            dataset_name=args.dataset_name,
            owner_id=owner_id,
            version=args.version,
            frame=args.frame,
        )
        await db.commit()

    print("=== nuScenes 导入完成 ===")
    print(f"dataset_id: {info['dataset_id']}  project_id: {info['project_id']}")
    print(f"total_items: {info['total_items']}")
    for s in info["scenes"]:
        tag = " (已存在,跳过)" if s.get("skipped") else ""
        print(f"  scene {s['name']}: {s['frames']} frames{tag}")


if __name__ == "__main__":
    asyncio.run(main())
