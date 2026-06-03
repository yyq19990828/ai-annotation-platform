"""v0.13.2 dev-only · 把 SUSTechPOINTS 夹具 scene 灌进当前栈(MinIO + DB),
建一个 lidar 项目 + 每帧 Task + link + 标定,供浏览器实测点云查看器。

跑法(从 apps/api,连本分支 .env 指向的栈):
    cd apps/api && uv run python ../../scripts/seed_pointcloud_dev.py
"""

import asyncio
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
FIXTURE = REPO / "third-party/SUSTechPOINTS/data/example"


async def main() -> None:
    from app.core.security import hash_password
    from app.db.base import async_session
    from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
    from app.db.models.project import Project
    from app.db.models.user import User
    from app.services.dataset import build_tasks_for_link
    from app.services.storage import storage_service

    suffix = uuid.uuid4().hex[:6]
    ds_name = f"pc-scene-{suffix}"
    email = f"pc-{suffix}@dev.local"
    password = "Test1234"

    async with async_session() as db:
        user = User(
            id=uuid.uuid4(), email=email, name="PC Dev",
            password_hash=hash_password(password), role="super_admin", is_active=True,
        )
        db.add(user)
        await db.flush()

        project = Project(
            display_id=f"P-PC-{suffix}", name=f"点云联合标注 {suffix}",
            type_label="点云检测", type_key="lidar", data_type="lidar",
            owner_id=user.id, tool_bindings={}, ai_enabled=False,
        )
        db.add(project)

        ds = Dataset(
            display_id=f"DS-PC-{suffix}", name=ds_name, data_type="point_cloud",
            created_by=user.id,
        )
        db.add(ds)
        await db.flush()

        bucket = storage_service.datasets_bucket

        def upload(relpath: str, file_type: str):
            local = FIXTURE / relpath
            key = f"{ds_name}/{relpath}"
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
            upload(f"lidar/{pcd.name}", "point_cloud"); n += 1
        for cam_dir in sorted((FIXTURE / "camera").iterdir()):
            if not cam_dir.is_dir():
                continue
            for jpg in sorted(cam_dir.glob("*.jpg")):
                upload(f"camera/{cam_dir.name}/{jpg.name}", "image"); n += 1
        for cj in sorted((FIXTURE / "calib/camera").glob("*.json")):
            upload(f"calib/camera/{cj.name}", "other"); n += 1

        db.add(ProjectDataset(project_id=project.id, dataset_id=ds.id))
        await db.flush()

        result = await build_tasks_for_link(
            db, dataset_id=ds.id, project_id=project.id
        )
        await db.commit()

        print("=== 点云 dev 数据已就绪 ===")
        print(f"上传文件: {n}  建任务: {result}")
        print(f"项目: {project.display_id}  id={project.id}")
        print(f"登录: {email} / {password}")


if __name__ == "__main__":
    asyncio.run(main())
