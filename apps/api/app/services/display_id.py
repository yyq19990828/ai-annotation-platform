"""v0.6.4 · 统一 display_id 生成器：Postgres SEQUENCE 驱动的「字母前缀 + 顺序号」。

替代 v0.6.3 之前散落的 `MAX(display_id)+1` 与 UUID hex 截断逻辑。bug_reports
保持 `B-N`；tasks/datasets/projects/task_batches 改造，task_batches 用 `BT-N`
前缀以避免与 bug 的 `B-` 冲突。

迁移见 `alembic/versions/0021_unify_display_id.py`：建 5 个序列、回填存量、
unique 约束、setval 同步。
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


ENTITY_TO_PREFIX: dict[str, str] = {
    "bug_reports": "B",
    "tasks": "T",
    "datasets": "D",
    "projects": "P",
    "batches": "BT",
}


def _seq_name(entity: str) -> str:
    if entity not in ENTITY_TO_PREFIX:
        raise ValueError(f"unknown display_id entity: {entity!r}")
    return f"display_seq_{entity}"


async def next_display_id(db: AsyncSession, entity: str) -> str:
    seq = _seq_name(entity)
    result = await db.execute(text(f"SELECT nextval('{seq}')"))
    n = result.scalar()
    return f"{ENTITY_TO_PREFIX[entity]}-{n}"
