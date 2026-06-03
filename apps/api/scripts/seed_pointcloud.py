"""
导入 SUSTechPOINTS 示例 scene，造一个「点云 + 图像」联合标注项目（可在 3D 工作台打开）。

走真实导入管线：上传场景文件到 MinIO datasets 桶 → 建 DatasetItem →
build_tasks_for_link（project.data_type=="lidar" 自动分流到 attach_calibration +
逐帧建 Task + 多文件 link）。幂等，可重跑。

前置：先跑 scripts/seed.py 建好用户（项目 owner 取 pm）。
夹具：<repo_root>/third-party/SUSTechPOINTS/data/example（git clone naurril/SUSTechPOINTS）。

用法：
    cd apps/api
    PYTHONPATH=. uv run python scripts/seed_pointcloud.py
"""

import asyncio
import sys
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
from app.db.models.project import Project
from app.db.models.user import User
from app.services.dataset import build_tasks_for_link
from app.services.storage import storage_service

# 生产保护栏：仅用于 dev / staging
if settings.environment == "production":
    print("[seed_pc] refusing to run with environment=production", file=sys.stderr)
    raise SystemExit(2)

# 夹具目录：<repo_root>/third-party/SUSTechPOINTS/data/example
_FIXTURE = (
    Path(__file__).resolve().parents[3] / "third-party/SUSTechPOINTS/data/example"
)

DS_NAME = "pc-scene-a"  # 同时作为 MinIO key 前缀
PROJECT_DISPLAY_ID = "P-PC01"

engine = create_async_engine(settings.database_url, echo=False)
Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def _file_type(relpath: str) -> str:
    p = relpath.lower()
    if p.endswith(".pcd"):
        return "point_cloud"
    if p.endswith((".jpg", ".jpeg", ".png")):
        return "image"
    return "other"


def _content_type(relpath: str) -> str:
    p = relpath.lower()
    if p.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if p.endswith(".png"):
        return "image/png"
    if p.endswith(".json"):
        return "application/json"
    return "application/octet-stream"


def _scan_files() -> list[str]:
    """夹具内 lidar / camera / calib 下所有文件（相对 _FIXTURE 的 posix 路径）。

    跳过 label/（SUSTechPOINTS 的标注，本平台暂不解析，见 v0.13.1 计划）。
    """
    out: list[str] = []
    for sub in ("lidar", "camera", "calib"):
        base = _FIXTURE / sub
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file():
                out.append(p.relative_to(_FIXTURE).as_posix())
    return out


async def main() -> None:
    if not (_FIXTURE / "lidar").is_dir():
        print(f"[seed_pc] fixture not found: {_FIXTURE}", file=sys.stderr)
        print("[seed_pc] git clone https://github.com/naurril/SUSTechPOINTS.git "
              "third-party/SUSTechPOINTS", file=sys.stderr)
        raise SystemExit(1)

    storage_service.ensure_bucket(storage_service.datasets_bucket)

    async with Session() as db:
        # owner：pm 优先，回退任意 project_admin / super_admin
        owner = await db.scalar(select(User).where(User.email == "pm"))
        if owner is None:
            owner = await db.scalar(
                select(User).where(User.role.in_(["project_admin", "super_admin"]))
            )
        if owner is None:
            print("[seed_pc] no owner user found; run scripts/seed.py first",
                  file=sys.stderr)
            raise SystemExit(1)

        # 项目（幂等 by display_id）
        project = await db.scalar(
            select(Project).where(Project.display_id == PROJECT_DISPLAY_ID)
        )
        if project is None:
            project = Project(
                id=uuid.uuid4(),
                display_id=PROJECT_DISPLAY_ID,
                name="点云+图像联合标注（SUSTechPOINTS 示例）",
                type_label="点云 · 3D 检测",
                type_key="lidar",
                data_type="lidar",  # 触发点云建任务分流 + 工作台 3D 路由
                owner_id=owner.id,
                status="in_progress",
                ai_enabled=False,
                # 默认 lidar_box_3d 类别集；不设 → 工作台 canPlace=false、B 键无效
                # → 首次试用必卡在「点了没反应」。
                tool_bindings={
                    "lidar_box_3d": {
                        "enabled": True,
                        "classes": [
                            {"name": "车辆", "order": 0},
                            {"name": "行人", "order": 1},
                            {"name": "自行车", "order": 2},
                            {"name": "路锥", "order": 3},
                        ],
                    },
                },
            )
            db.add(project)
            await db.flush()
            print(f"  add   project {PROJECT_DISPLAY_ID}  {project.name}")
        else:
            print(f"  skip  project {PROJECT_DISPLAY_ID} (已存在)")

        # 数据集（幂等 by name）
        ds = await db.scalar(select(Dataset).where(Dataset.name == DS_NAME))
        if ds is None:
            ds = Dataset(
                display_id=f"DS-PC-{uuid.uuid4().hex[:6]}",
                name=DS_NAME,
                data_type="point_cloud",
                created_by=owner.id,
            )
            db.add(ds)
            await db.flush()
            print(f"  add   dataset {DS_NAME}")
        else:
            print(f"  skip  dataset {DS_NAME} (已存在)")

        # 项目-数据集关联（幂等）
        pd = await db.scalar(
            select(ProjectDataset).where(
                ProjectDataset.project_id == project.id,
                ProjectDataset.dataset_id == ds.id,
            )
        )
        if pd is None:
            db.add(ProjectDataset(project_id=project.id, dataset_id=ds.id))

        # 上传文件 + DatasetItem（幂等 by file_path / storage key）
        existing = set(
            (
                await db.execute(
                    select(DatasetItem.file_path).where(
                        DatasetItem.dataset_id == ds.id
                    )
                )
            ).scalars().all()
        )
        uploaded = 0
        for relpath in _scan_files():
            key = f"{DS_NAME}/{relpath}"
            if key in existing:
                continue
            storage_service.upload_file(
                str(_FIXTURE / relpath),
                key,
                bucket=storage_service.datasets_bucket,
                content_type=_content_type(relpath),
            )
            db.add(
                DatasetItem(
                    dataset_id=ds.id,
                    file_name=Path(relpath).name,
                    file_path=key,
                    file_type=_file_type(relpath),
                )
            )
            uploaded += 1
        await db.commit()
        print(f"  upload {uploaded} files → MinIO {storage_service.datasets_bucket}/{DS_NAME}/")

        # 建任务：data_type=="lidar" → attach_calibration + 逐帧 Task + link
        result = await build_tasks_for_link(
            db, dataset_id=ds.id, project_id=project.id
        )
        print(f"  tasks  created={result['created']} total={result['total']}")

    await engine.dispose()
    print("=== seed_pointcloud done ===")


if __name__ == "__main__":
    asyncio.run(main())
