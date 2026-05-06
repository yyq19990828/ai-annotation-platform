"""
初始化种子数据：管理员、测试用户、示例项目。
用法：
    cd apps/api
    uv run python scripts/seed.py
"""

import asyncio
import sys
import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select

from app.config import settings
from app.core.security import hash_password
from app.db.models.user import User
from app.db.models.project import Project

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

# ── 示例项目（owner 取 pm@example.com 的 id，在运行时填入）─────────────────


def make_projects(owner_id: uuid.UUID) -> list[dict]:
    return [
        {
            "display_id": "P-0001",
            "name": "智能门店货架商品检测",
            "type_label": "图像 · 目标检测",
            "type_key": "image-det",
            "owner_id": owner_id,
            "status": "in_progress",
            "ai_enabled": True,
            "ai_model": "GroundingDINO + SAM",
            "classes": ["商品", "价签", "标识牌", "缺货位", "促销贴"],
            "total_tasks": 8420,
            "completed_tasks": 6312,
            "review_tasks": 412,
            "due_date": date(2026, 5, 12),
        },
        {
            "display_id": "P-0002",
            "name": "自动驾驶路面障碍分割",
            "type_label": "图像 · 实例分割",
            "type_key": "image-seg",
            "owner_id": owner_id,
            "status": "in_progress",
            "ai_enabled": True,
            "ai_model": "SAM2",
            "classes": ["车辆", "行人", "自行车", "路锥", "路面坑洞"],
            "total_tasks": 12000,
            "completed_tasks": 4800,
            "review_tasks": 960,
            "due_date": date(2026, 6, 30),
        },
    ]


# ── 主逻辑 ────────────────────────────────────────────────────────────────────


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
        if not owner:
            print("  WARN: pm 用户未找到，跳过项目创建")
            await db.commit()
            await engine.dispose()
            return

        for pdata in make_projects(owner.id):
            existing = await db.scalar(
                select(Project).where(Project.display_id == pdata["display_id"])
            )
            if existing:
                if existing.owner_id != owner.id:
                    existing.owner_id = owner.id
                    print(f"  fix   project {pdata['display_id']} owner -> pm")
                else:
                    print(f"  skip  project {pdata['display_id']} (已存在)")
                continue

            project = Project(id=uuid.uuid4(), **pdata)
            db.add(project)
            print(f"  add   project {pdata['display_id']}  {pdata['name']}")

        await db.commit()

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
