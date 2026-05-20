"""v0.10.25 · predictions 月分区维护（ADR-0006 Stage 2）

ensure_future_partitions(months_ahead=3): 检查 [今月, 今月+months_ahead] 缺失分区时
CREATE TABLE ... PARTITION OF predictions ...。与 audit_partition_service 同构，但
predictions 无冷数据归档需求（ADR-0006 仅要求自动建分区，不归档预测结果）。
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)


def _next_month(d: date) -> date:
    if d.month == 12:
        return d.replace(year=d.year + 1, month=1, day=1)
    return d.replace(month=d.month + 1, day=1)


def _month_floor(d: date) -> date:
    return d.replace(day=1)


def _partition_name(d: date) -> str:
    return f"predictions_y{d.year}m{d.month:02d}"


async def _existing_partition_names(db: AsyncSession) -> set[str]:
    rows = (
        await db.execute(
            text(
                """
                SELECT child.relname AS child_name
                FROM pg_inherits i
                JOIN pg_class parent ON i.inhparent = parent.oid
                JOIN pg_class child ON i.inhrelid = child.oid
                WHERE parent.relname = 'predictions'
                """
            )
        )
    ).all()
    return {r.child_name for r in rows}


class PredictionPartitionService:
    @staticmethod
    async def ensure_future_partitions(
        db: AsyncSession, *, months_ahead: int = 3
    ) -> list[str]:
        """补建未来 N 个月分区。返回新创建的分区名列表。"""
        existing = await _existing_partition_names(db)
        today = datetime.now(timezone.utc).date()
        cur = _month_floor(today)
        target = cur
        for _ in range(months_ahead):
            target = _next_month(target)
        end = _next_month(target)

        created: list[str] = []
        m = cur
        while m < end:
            name = _partition_name(m)
            if name not in existing:
                start_iso = m.isoformat()
                end_iso = _next_month(m).isoformat()
                await db.execute(
                    text(
                        f"CREATE TABLE IF NOT EXISTS {name} PARTITION OF predictions "
                        f"FOR VALUES FROM ('{start_iso}') TO ('{end_iso}')"
                    )
                )
                created.append(name)
            m = _next_month(m)
        return created
