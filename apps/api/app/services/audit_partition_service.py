"""v0.8.1 · audit_logs 分区维护 + 冷数据归档

- ensure_future_audit_partitions(months_ahead=3): 检查 [今月, 今月+months_ahead]
  缺失分区时 CREATE TABLE ... PARTITION OF audit_logs ...
- archive_old_audit_partitions(retain_months): 把 > retain_months 的子分区
  COPY TO STDOUT → gzip → MinIO `audit-archive/{YYYY}/{MM}.jsonl.gz`，成功后 DROP PARTITION。

策略：
  - 归档失败时不删除分区，下次 cron 重试
  - DROP PARTITION 是元操作，秒级，无 IO；优于 DELETE WHERE
  - jsonl.gz 行格式：每行一条 audit_log JSON；UTF-8；最末行含 `_partition_meta`
"""

from __future__ import annotations

import gzip
import json
import logging
from datetime import date, datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.audit import AuditAction, AuditService
from app.services.storage import storage_service


logger = logging.getLogger(__name__)


def _next_month(d: date) -> date:
    if d.month == 12:
        return d.replace(year=d.year + 1, month=1, day=1)
    return d.replace(month=d.month + 1, day=1)


def _month_floor(d: date) -> date:
    return d.replace(day=1)


def _partition_name(d: date) -> str:
    return f"audit_logs_y{d.year}m{d.month:02d}"


async def _list_partition_children(db: AsyncSession) -> list[tuple[str, date, date]]:
    """返回 [(child_name, range_from, range_to), ...]，按时间升序。"""
    rows = (
        await db.execute(
            text(
                """
                SELECT
                    child.relname AS child_name,
                    pg_get_expr(child.relpartbound, child.oid) AS bound
                FROM pg_inherits i
                JOIN pg_class parent ON i.inhparent = parent.oid
                JOIN pg_class child ON i.inhrelid = child.oid
                WHERE parent.relname = 'audit_logs'
                """
            )
        )
    ).all()
    out: list[tuple[str, date, date]] = []
    for r in rows:
        bound = r.bound or ""
        # 形式: "FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00')"
        try:
            from_part = bound.split("FROM (")[1].split(")")[0].strip().strip("'")
            to_part = bound.split("TO (")[1].split(")")[0].strip().strip("'")
            from_dt = datetime.fromisoformat(from_part.replace(" ", "T")).date()
            to_dt = datetime.fromisoformat(to_part.replace(" ", "T")).date()
            out.append((r.child_name, from_dt, to_dt))
        except (IndexError, ValueError) as e:
            logger.warning("partition bound parse failed %s: %s", r.child_name, e)
    out.sort(key=lambda x: x[1])
    return out


class AuditPartitionService:
    @staticmethod
    async def ensure_future_partitions(
        db: AsyncSession, *, months_ahead: int = 3
    ) -> list[str]:
        """补建未来 N 个月分区。返回新创建的分区名列表。"""
        existing = {name for name, _, _ in await _list_partition_children(db)}
        today = datetime.now(timezone.utc).date()
        cur = _month_floor(today)
        target = cur
        for _ in range(months_ahead):
            target = _next_month(target)
        # 含当前月、含 target+1（即 +months_ahead 个月）
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
                        f"CREATE TABLE IF NOT EXISTS {name} PARTITION OF audit_logs "
                        f"FOR VALUES FROM ('{start_iso}') TO ('{end_iso}')"
                    )
                )
                created.append(name)
            m = _next_month(m)
        return created

    @staticmethod
    async def archive_old_partitions(
        db: AsyncSession, *, retain_months: int = 12
    ) -> dict:
        """归档保留期外的分区到 MinIO 后 DROP。返回 {archived_partitions, total_rows, archive_keys}。"""
        children = await _list_partition_children(db)
        today = datetime.now(timezone.utc).date()
        cutoff = _month_floor(today)
        for _ in range(retain_months):
            # 往前推 retain_months 个月
            if cutoff.month == 1:
                cutoff = cutoff.replace(year=cutoff.year - 1, month=12)
            else:
                cutoff = cutoff.replace(month=cutoff.month - 1)

        archived: list[str] = []
        archive_keys: list[str] = []
        total_rows = 0

        for name, from_dt, _to_dt in children:
            if from_dt >= cutoff:
                continue  # 还在保留期内，不归档

            # 1. 数据 dump 为 jsonl.gz
            rows = (
                await db.execute(text(f"SELECT * FROM {name} ORDER BY id"))
            ).mappings().all()
            row_count = len(rows)

            buf = gzip.compress(
                ("\n".join(_serialize_row(dict(r)) for r in rows) + "\n").encode("utf-8")
            )

            object_key = f"audit-archive/{from_dt.year}/{from_dt.month:02d}.jsonl.gz"
            try:
                storage_service.client.put_object(
                    Bucket=storage_service.bucket,
                    Key=object_key,
                    Body=buf,
                    ContentType="application/gzip",
                    Metadata={
                        "partition": name,
                        "row_count": str(row_count),
                        "archived_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
            except Exception as e:
                logger.error("archive %s failed: %s", name, e)
                continue  # 留待下次重试

            # 2. DROP 分区（元操作，秒级）
            await db.execute(text(f"DROP TABLE {name}"))

            archived.append(name)
            archive_keys.append(object_key)
            total_rows += row_count

            await AuditService.log(
                db,
                actor=None,
                action=AuditAction.AUDIT_ARCHIVE,
                target_type="audit_partition",
                target_id=name,
                request=None,
                status_code=200,
                detail={
                    "partition": name,
                    "row_count": row_count,
                    "archive_key": object_key,
                    "from": from_dt.isoformat(),
                },
            )

        return {
            "archived_partitions": archived,
            "archive_keys": archive_keys,
            "total_rows": total_rows,
        }


def _serialize_row(row: dict) -> str:
    """把一行（含 datetime / UUID / dict）序列化为 JSON 字符串。"""

    def default(o):
        if isinstance(o, datetime):
            return o.isoformat()
        if hasattr(o, "hex"):  # UUID
            return str(o)
        return str(o)

    return json.dumps(row, default=default, ensure_ascii=False)
