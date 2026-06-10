"""
初始化种子数据：管理员、测试用户、示例项目。
用法：
    cd apps/api
    PYTHONPATH=. uv run python scripts/seed.py
"""

import asyncio
import sys
import uuid

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select

# v0.13.11 · 点云夹具脚本与本文件同目录;PYTHONPATH 已含 apps/api,直接 import。
sys.path.insert(0, str(__file__.rsplit("/", 1)[0]))  # 让 `scripts/` 入 sys.path
from seed_pointcloud import seed_pointcloud, seed_nuscenes_scene  # noqa: E402
from seed_coco8 import seed_coco8  # noqa: E402  (依赖 sys.path 先扩)

from app.config import settings
from app.core.security import hash_password
from app.db.models.user import User

# 生产保护栏：seed.py 仅用于 dev / staging
if settings.environment == "production":
    print("[seed] refusing to run with environment=production", file=sys.stderr)
    raise SystemExit(2)

engine = create_async_engine(settings.database_url, echo=False)
Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ── 种子用户 ──────────────────────────────────────────────────────────────────

USERS = [
    {
        "email": "admin",
        "name": "超级管理员",
        "password": "123456",
        "role": "super_admin",
        "group_name": None,
    },
    {
        "email": "pm",
        "name": "张明轩",
        "password": "123456",
        "role": "project_admin",
        "group_name": "管理组",
    },
    {
        "email": "qa",
        "name": "李晓华",
        "password": "123456",
        "role": "reviewer",
        "group_name": "质检组",
    },
    {
        "email": "anno",
        "name": "王芳",
        "password": "123456",
        "role": "annotator",
        "group_name": "标注组A",
    },
    {
        "email": "viewer",
        "name": "赵观察",
        "password": "123456",
        "role": "viewer",
        "group_name": None,
    },
    {
        "email": "anno2",
        "name": "刘洋",
        "password": "123456",
        "role": "annotator",
        "group_name": "标注组A",
    },
    {
        "email": "anno3",
        "name": "陈思远",
        "password": "123456",
        "role": "annotator",
        "group_name": "标注组B",
    },
]

# ── 主逻辑 ────────────────────────────────────────────────────────────────────
# 示例项目不再造假数据:图片项目由 seed_coco8(真实 coco8) 单独建, 点云项目由
# seed_pointcloud / seed_nuscenes_scene 建, 均在 seed() 内按夹具可用性容错调用。


async def seed() -> None:
    async with Session() as db:
        created_users: dict[str, User] = {}

        for data in USERS:
            existing = await db.scalar(select(User).where(User.email == data["email"]))
            if existing:
                print(f"  skip  {data['email']} (已存在)")
                created_users[data["email"]] = existing
                continue

            user = User(
                id=uuid.uuid4(),
                email=data["email"],
                name=data["name"],
                password_hash=hash_password(data["password"]),
                role=data["role"],
                group_name=data["group_name"],
                is_active=True,
            )
            db.add(user)
            await db.flush()  # 拿到 id，后续项目引用
            created_users[data["email"]] = user
            print(f"  add   {data['email']}  [{data['role']}]")

        owner = created_users.get("pm") or created_users.get("pm@test.com")
        await db.commit()

        # 图片标注项目:真实 coco8(8 张图)+ GT 框, owner=pm(无 pm 则兜底 admin)。
        # 依赖 MinIO + third-party/coco8 夹具, 缺失则跳过, 不阻断核心账号种子。
        img_owner = owner or created_users.get("admin")
        if img_owner is not None:
            try:
                info = await seed_coco8(db, owner_id=img_owner.id)
                await db.commit()
                if info is None:
                    print("  skip  image P-COCO8 (已存在)")
                else:
                    print(
                        f"  add   image {info['project']}  "
                        f"images={info['images']} tasks={info['tasks']} "
                        f"pred={info['predictions']}"
                    )
            except Exception as e:  # noqa: BLE001 — 夹具/MinIO 不可用时不阻断 seed
                await db.rollback()
                print(f"  WARN  coco8 夹具跳过: {e}")

        # 点云开发夹具(owner=admin):依赖 MinIO + SUSTechPOINTS 夹具,缺失则跳过,
        # 不影响核心账号/项目种子。幂等:P-PC-DEV 已存在则跳过。
        admin = created_users.get("admin")
        if admin is not None:
            try:
                info = await seed_pointcloud(db, owner_id=admin.id)
                await db.commit()
                if info is None:
                    print("  skip  point-cloud P-PC-DEV (已存在)")
                else:
                    print(
                        f"  add   point-cloud {info['project']}  "
                        f"files={info['files']} tasks={info['tasks']}"
                    )
            except Exception as e:  # noqa: BLE001 — 夹具/MinIO 不可用时不阻断 seed
                await db.rollback()
                print(f"  WARN  point-cloud 夹具跳过: {e}")

            # scene 模式点云项目(owner=admin):nuScenes-mini 取 1 个 scene。依赖 MinIO +
            # third-party/nuscenes-mini 夹具(~5.1G), 缺失则跳过。幂等:同名 scene 跳过。
            try:
                nu = await seed_nuscenes_scene(db, owner_id=admin.id)
                await db.commit()
                scenes = ", ".join(
                    f"{s['name']}({s['frames']}帧{'·已存在' if s.get('skipped') else ''})"
                    for s in nu["scenes"]
                )
                print(
                    f"  add   nuscenes scene-mode  items={nu['total_items']} "
                    f"batches={nu['batches']}  {scenes}"
                )
            except Exception as e:  # noqa: BLE001 — 夹具/MinIO 不可用时不阻断 seed
                await db.rollback()
                print(f"  WARN  nuscenes 夹具跳过: {e}")

    await engine.dispose()


async def main() -> None:
    print("\n=== seed start ===")
    await seed()
    print("=== seed done  ===\n")
    print("测试账号一览 (密码统一: 123456):")
    print("  admin    超级管理员   → AdminDashboard")
    print("  pm       项目管理员   → 项目总览")
    print("  qa       质检员       → ReviewerDashboard")
    print("  anno     标注员       → AnnotatorDashboard")
    print("  viewer   观察者       → ViewerDashboard")
    print("  anno2    标注员 (标注组A)")
    print("  anno3    标注员 (标注组B)")


if __name__ == "__main__":
    asyncio.run(main())
