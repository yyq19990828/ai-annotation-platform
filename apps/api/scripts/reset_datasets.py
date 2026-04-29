"""
清空所有数据集记录（dataset_items, project_datasets, datasets）。

用法：
    cd apps/api
    uv run python scripts/reset_datasets.py
"""

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import text

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def reset() -> None:
    async with Session() as db:
        rows = (await db.execute(text("SELECT id, display_id, name FROM datasets"))).fetchall()
        if not rows:
            print("没有数据集需要清理")
            return

        print(f"即将删除 {len(rows)} 个数据集：")
        for r in rows:
            print(f"  {r[1]}  {r[2]}")

        await db.execute(text("UPDATE tasks SET dataset_item_id = NULL WHERE dataset_item_id IS NOT NULL"))
        await db.execute(text("DELETE FROM project_datasets"))
        await db.execute(text("DELETE FROM dataset_items"))
        await db.execute(text("DELETE FROM datasets"))
        await db.commit()
        print(f"\n已清空 {len(rows)} 个数据集及关联记录")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(reset())
