"""v0.13.2 dev-only · 把 SUSTechPOINTS 夹具 scene 灌进当前栈(MinIO + DB),
建一个 lidar 项目 + 每帧 Task + link + 标定,供浏览器实测点云查看器。
owner 统一用标准 admin/123456 账号(与 seed.py 一致),不再随机造用户。

幂等:固定 display_id(P-PC-DEV / DS-PC-DEV),项目已存在则跳过,重复跑安全。

独立跑:
    cd apps/api && PYTHONPATH=. uv run python scripts/seed_pointcloud.py

seed_pointcloud() 也被 apps/api/scripts/seed.py 复用,作为开发者初始化的一部分。

v0.13.11 · 由 `scripts/seed_pointcloud_dev.py` 移入 apps/api/scripts/, 与其余 seed
脚本同处一目录;同时删除旧的 standalone seed_pointcloud.py。
"""

import asyncio
import hashlib
import sys
import uuid
from pathlib import Path

# repo root。host 布局 apps/api/scripts/<this> 取 parents[3];浅布局(如容器把代码挂在
# /app)parents[3] 会越界,退化为文件系统根 → 夹具 .exists()=False 时各 seed 优雅跳过不崩。
_parents = Path(__file__).resolve().parents
REPO = _parents[3] if len(_parents) > 3 else _parents[-1]
FIXTURE = REPO / "third-party/SUSTechPOINTS/data/example"

# nuScenes-mini scene 模式项目:复用同目录 import_nuscenes_scene.py 的转换/入库逻辑。
# scripts/ 在独立跑时即 sys.path[0];经 seed.py 导入时 seed.py 已把 scripts/ 入 path,
# 这里再补一次保证两种入口都能 import 兄弟脚本。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_nuscenes_scene import import_nuscenes  # noqa: E402  (依赖 sys.path 先扩)

PROJECT_DISPLAY_ID = "P-PC-DEV"
DATASET_DISPLAY_ID = "DS-PC-DEV"
DATASET_NAME = "pc-scene-dev"
ADMIN_EMAIL = "admin"
ADMIN_PASSWORD = "123456"

POINTCLOUD_TOOL_BINDINGS = {
    "lidar_box_3d": {
        "classes": [
            {"name": "car", "order": 0},
            {"name": "person", "order": 1},
        ],
        "enabled": True,
        "attribute_schema": {"fields": []},
    },
    "point_mask_3d": {
        "classes": [
            {"name": "ground", "order": 0},
            {"name": "obstacle", "order": 1},
        ],
        "enabled": True,
        "attribute_schema": {"fields": []},
    },
}

# nuScenes-mini 共 10 个 scene(~5.1G)。仅取 1 个 scene(scene-0061, 39 帧)做 scene
# 模式点云项目演示——"不要全用,有点大"。dataset_name 取短名让派生 display_id 不被 hash 截断
# (DS-NU-nuscenes-mini / P-NU-nuscenes-mini 均 ≤ 20 字符)。
NUSCENES_FIXTURE = REPO / "third-party/nuscenes-mini"
NUSCENES_SCENES = ["scene-0061"]
NUSCENES_DATASET_NAME = "nuscenes-mini"


async def _ensure_admin(db) -> uuid.UUID:
    """取标准 admin 用户;独立运行且库里还没有 admin 时,按 admin/123456 建一个。"""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db.models.user import User

    admin = await db.scalar(select(User).where(User.email == ADMIN_EMAIL))
    if admin:
        return admin.id
    admin = User(
        id=uuid.uuid4(),
        email=ADMIN_EMAIL,
        name="超级管理员",
        password_hash=hash_password(ADMIN_PASSWORD),
        role="super_admin",
        is_active=True,
    )
    db.add(admin)
    await db.flush()
    return admin.id


async def seed_pointcloud(
    db,
    *,
    owner_id: uuid.UUID,
    fixture: Path | None = None,
    axis_convention: str = "sustechpoints_demo",
) -> dict | None:
    """把点云夹具灌入当前栈,owner 为传入用户。

    幂等:项目 P-PC-DEV 已存在则直接返回 None(不重复造)。
    调用方负责最终 commit(build_tasks_for_link 内部已 commit 一次)。
    返回 {"project": display_id, "files": n, "tasks": result} 或 None(已存在)。
    """
    from sqlalchemy import select

    from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
    from app.db.models.project import Project
    from app.services.dataset import build_tasks_for_link
    from app.services.storage import storage_service

    existing = await db.scalar(
        select(Project).where(Project.display_id == PROJECT_DISPLAY_ID)
    )
    if existing:
        return None

    fixture = fixture or FIXTURE
    if not fixture.exists():
        raise FileNotFoundError(f"点云夹具缺失: {fixture}")

    project = Project(
        display_id=PROJECT_DISPLAY_ID,
        name="点云联合标注 (dev)",
        type_label="点云检测",
        type_key="lidar",
        data_type="lidar",
        owner_id=owner_id,
        tool_bindings=POINTCLOUD_TOOL_BINDINGS,
        ai_enabled=False,
    )
    db.add(project)

    # SUSTechPOINTS 默认用其实测轴向;截图 profile 的 PCL RGB-D 扫描则显式传
    # opencv_camera(+X 右 / +Y 下 / +Z 前),前端统一归一到 ISO 8855。
    ds = Dataset(
        display_id=DATASET_DISPLAY_ID,
        name=DATASET_NAME,
        data_type="point_cloud",
        created_by=owner_id,
        metadata_={"axis_convention": axis_convention},
    )
    db.add(ds)
    await db.flush()

    bucket = storage_service.datasets_bucket

    def upload(relpath: str, file_type: str):
        local = fixture / relpath
        key = f"{DATASET_NAME}/{relpath}"
        payload = local.read_bytes()
        storage_service.client.put_object(
            Bucket=bucket,
            Key=key,
            Body=payload,
        )
        db.add(
            DatasetItem(
                dataset_id=ds.id,
                file_name=Path(relpath).name,
                file_path=key,
                file_type=file_type,
                file_size=local.stat().st_size,
                content_hash=hashlib.sha256(payload).hexdigest(),
            )
        )

    n = 0
    for pcd in sorted((fixture / "lidar").glob("*.pcd")):
        upload(f"lidar/{pcd.name}", "point_cloud")
        n += 1
    camera_root = fixture / "camera"
    if camera_root.is_dir():
        for cam_dir in sorted(camera_root.iterdir()):
            if not cam_dir.is_dir():
                continue
            for jpg in sorted(cam_dir.glob("*.jpg")):
                upload(f"camera/{cam_dir.name}/{jpg.name}", "image")
                n += 1
    calibration_root = fixture / "calib/camera"
    if calibration_root.is_dir():
        for cj in sorted(calibration_root.glob("*.json")):
            upload(f"calib/camera/{cj.name}", "other")
            n += 1

    ds.file_count = n

    db.add(ProjectDataset(project_id=project.id, dataset_id=ds.id))
    await db.flush()

    result = await build_tasks_for_link(db, dataset_id=ds.id, project_id=project.id)
    return {"project": PROJECT_DISPLAY_ID, "files": n, "tasks": result}


async def seed_nuscenes_scene(db, *, owner_id: uuid.UUID) -> dict:
    """把 nuScenes-mini 的 scene-0061(39 帧)灌入当前栈,建 scene 模式点云项目并按 scene 建包。

    复用 import_nuscenes_scene.import_nuscenes:每帧转 ego 系 PCD + 6 路相机 jpg +
    首帧标定,显式建 scene + 逐帧 frame_index/ego_pose,项目 scene_mode=True。

    scene 模式建包以 scene 为单位:前端 CreateProjectWizard 在 scene_mode 项目下会自动
    用 by_scene 策略切批(components/projects/steps/Step5Datasets.tsx · runSplit,
    name_prefix="Scene")。seed 直接走 import_nuscenes 建项目、绕过向导,故在此复刻同一步:
    import 后跑 BatchService 的 by_scene split,把未分包任务按 scene 分组,每个 scene 建一个
    TaskBatch(按 frame_index 排序)。name_prefix 与向导一致用 "Scene"。

    幂等:dataset/scene/project 均按派生 display_id 复用,同名 scene 已存在则跳过;重跑时
    无未分包任务 → by_scene split 抛 400,捕获后视作已建包(batches=0)。
    调用方负责最终 commit(import_nuscenes 内部 build_tasks_for_link 会 commit)。
    返回 import_nuscenes 报告 + {"batches": 本次新建包数}。
    """
    from fastapi import HTTPException

    from app.schemas.batch import BatchSplitRequest
    from app.services.batch import BatchService

    if not NUSCENES_FIXTURE.exists():
        raise FileNotFoundError(f"nuScenes-mini 夹具缺失: {NUSCENES_FIXTURE}")

    info = await import_nuscenes(
        db,
        nuscenes_root=NUSCENES_FIXTURE,
        scene_names=NUSCENES_SCENES,
        dataset_name=NUSCENES_DATASET_NAME,
        owner_id=owner_id,
        version="v1.0-mini",
        frame="ego",
    )

    try:
        batches = await BatchService(db).split(
            info["project_id"],
            BatchSplitRequest(strategy="by_scene", name_prefix="Scene"),
            created_by=owner_id,
        )
        info["batches"] = len(batches)
    except HTTPException:
        info["batches"] = 0  # 无未分包任务(重跑已建包)
    return info


async def main() -> None:
    from app.db.base import async_session

    async with async_session() as db:
        owner_id = await _ensure_admin(db)
        info = await seed_pointcloud(db, owner_id=owner_id)
        await db.commit()
        nu = await seed_nuscenes_scene(db, owner_id=owner_id)
        await db.commit()

    print("=== 点云 dev 数据 ===")
    if info is None:
        print(f"SUSTechPOINTS 项目 {PROJECT_DISPLAY_ID} 已存在,跳过")
    else:
        print(f"SUSTechPOINTS  上传文件: {info['files']}  建任务: {info['tasks']}")
        print(f"  项目: {info['project']}")
    print(
        f"nuScenes scene 模式  total_items: {nu['total_items']}  本次建包: {nu['batches']}"
    )
    for s in nu["scenes"]:
        tag = " (已存在,跳过)" if s.get("skipped") else ""
        print(f"  scene {s['name']}: {s['frames']} frames{tag}")
    print(f"登录: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
