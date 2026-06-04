"""v0.13.2 dev-only · 把 SUSTechPOINTS 夹具 scene 灌进当前栈(MinIO + DB),
建一个 lidar 项目 + 每帧 Task + link + 标定,供浏览器实测点云查看器。
owner 统一用标准 admin/123456 账号(与 seed.py 一致),不再随机造用户。

幂等:固定 display_id(P-PC-DEV / DS-PC-DEV),项目已存在则跳过,重复跑安全。

独立跑(从 apps/api,连本分支 .env 指向的栈):
    cd apps/api && uv run python ../../scripts/seed_pointcloud_dev.py

seed_pointcloud() 也被 apps/api/scripts/seed.py 复用,作为开发者初始化的一部分。
"""

import asyncio
import sys
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
FIXTURE = REPO / "third-party/SUSTechPOINTS/data/example"

# 让 app.* 可导入:本脚本在 repo 根 scripts/ 下,独立跑时 sys.path 不含 apps/api。
# (被 seed.py importlib 载入时 app 已可导入,这步幂等无害。)
_APP_ROOT = str(REPO / "apps/api")
if _APP_ROOT not in sys.path:
    sys.path.insert(0, _APP_ROOT)

PROJECT_DISPLAY_ID = "P-PC-DEV"
DATASET_DISPLAY_ID = "DS-PC-DEV"
DATASET_NAME = "pc-scene-dev"
ADMIN_EMAIL = "admin"
ADMIN_PASSWORD = "123456"


async def _ensure_admin(db) -> uuid.UUID:
    """取标准 admin 用户;独立运行且库里还没有 admin 时,按 admin/123456 建一个。"""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db.models.user import User

    admin = await db.scalar(select(User).where(User.email == ADMIN_EMAIL))
    if admin:
        return admin.id
    admin = User(
        id=uuid.uuid4(), email=ADMIN_EMAIL, name="超级管理员",
        password_hash=hash_password(ADMIN_PASSWORD), role="super_admin", is_active=True,
    )
    db.add(admin)
    await db.flush()
    return admin.id


async def seed_pointcloud(db, *, owner_id: uuid.UUID) -> dict | None:
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

    if not FIXTURE.exists():
        raise FileNotFoundError(f"点云夹具缺失: {FIXTURE}")

    project = Project(
        display_id=PROJECT_DISPLAY_ID, name="点云联合标注 (dev)",
        type_label="点云检测", type_key="lidar", data_type="lidar",
        owner_id=owner_id, tool_bindings={}, ai_enabled=False,
    )
    db.add(project)

    ds = Dataset(
        display_id=DATASET_DISPLAY_ID, name=DATASET_NAME, data_type="point_cloud",
        created_by=owner_id,
    )
    db.add(ds)
    await db.flush()

    bucket = storage_service.datasets_bucket

    def upload(relpath: str, file_type: str):
        local = FIXTURE / relpath
        key = f"{DATASET_NAME}/{relpath}"
        storage_service.client.put_object(
            Bucket=bucket, Key=key, Body=local.read_bytes(),
        )
        db.add(DatasetItem(
            dataset_id=ds.id, file_name=Path(relpath).name,
            file_path=key, file_type=file_type,
            file_size=local.stat().st_size,
        ))

    n = 0
    for pcd in sorted((FIXTURE / "lidar").glob("*.pcd")):
        upload(f"lidar/{pcd.name}", "point_cloud")
        n += 1
    for cam_dir in sorted((FIXTURE / "camera").iterdir()):
        if not cam_dir.is_dir():
            continue
        for jpg in sorted(cam_dir.glob("*.jpg")):
            upload(f"camera/{cam_dir.name}/{jpg.name}", "image")
            n += 1
    for cj in sorted((FIXTURE / "calib/camera").glob("*.json")):
        upload(f"calib/camera/{cj.name}", "other")
        n += 1

    db.add(ProjectDataset(project_id=project.id, dataset_id=ds.id))
    await db.flush()

    result = await build_tasks_for_link(
        db, dataset_id=ds.id, project_id=project.id
    )
    return {"project": PROJECT_DISPLAY_ID, "files": n, "tasks": result}


async def main() -> None:
    from app.db.base import async_session

    async with async_session() as db:
        owner_id = await _ensure_admin(db)
        info = await seed_pointcloud(db, owner_id=owner_id)
        await db.commit()

    print("=== 点云 dev 数据 ===")
    if info is None:
        print(f"项目 {PROJECT_DISPLAY_ID} 已存在,跳过")
    else:
        print(f"上传文件: {info['files']}  建任务: {info['tasks']}")
        print(f"项目: {info['project']}")
    print(f"登录: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
