"""v0.11.0 · ADR-0027 双写一致性对账（A 组安全网）.

`v_annotation_feedback_unified`（alembic 0077）把 4 个反馈源 UNION ALL 成统一读表面，
带 `source_table` 列区分来源。ADR-0027 第二段为 bug/comment/reject 三类旧源加了双写
mirror（见 `feedback.py` 的 `mirror_*`），把旧表行同事务镜像进 `annotation_feedbacks`。

本模块提供纯查询函数 `compute_feedback_drift`，对每个旧源比对「应 mirror 行数」与
「`annotation_feedbacks` 里实际存在的 mirror 行数」，找出漏写的旧表行 id。切单源
（v0.11.9+）前必须有 drift 长期为 0 的客观证据，否则 backfill / 停双写会静默丢数据。

无副作用：只读 view + 旧表，不写不删，便于单测断言。beat 包装（drift>0 时写
audit + notify superadmin）见 `app/workers/feedback_reconcile.py`。
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# 旧源 → annotation_feedbacks 里对应的 mirror kind。
# 注意 view 里 annotation_feedbacks 源同时含原生 issue/comment + 三类 mirror，
# 对账只针对有旧表权威的三类 mirror（issue 天生单源，无旧表，不参与对账）。
_MIRROR_KINDS = {
    "bug_reports": "bug",
    "annotation_comments": "comment",
    "tasks_reject": "reject",
}


# 各旧源「应被 mirror 的行」口径。排除按设计就不该出现在统一表的行，避免误报：
#   - bug_reports.project_id IS NULL：无项目归属的 bug（登录页等），设计上不 mirror
#   - annotation_comments.is_active = false：软删评论不进 view，也不该有 mirror
#   - tasks: status != 'rejected' OR reject_reason IS NULL：仅被驳回且填了理由的 task 行算一条 reject
# SELECT 返回旧源主键（统一 ::text），用于和 mirror 行做差集找 missing_ids。
_EXPECTED_SQL = {
    "bug_reports": (
        "SELECT id::text AS id FROM bug_reports WHERE project_id IS NOT NULL"
    ),
    "annotation_comments": (
        "SELECT id::text AS id FROM annotation_comments WHERE is_active = true"
    ),
    "tasks_reject": (
        "SELECT id::text AS id FROM tasks "
        "WHERE status = 'rejected' AND reject_reason IS NOT NULL"
    ),
}


async def compute_feedback_drift(db: AsyncSession) -> dict[str, dict]:
    """对账双写一致性，返回 {source_table: {expected, actual, missing_ids}}。

    对 bug_reports / annotation_comments / tasks_reject 三个有旧表权威的源，比对：
      - expected: 旧表里「应被 mirror」的行数（按上面 _EXPECTED_SQL 口径，已排除
        设计上不该 mirror 的行）。
      - actual: `v_annotation_feedback_unified` 中 source_table='annotation_feedbacks'
        且 kind=对应 mirror kind 的行数（即真正落进统一表的 mirror 行）。
      - missing_ids: 旧表里应 mirror 但在统一表里找不到对应行的旧表主键列表。匹配键
        是统一表的源行业务字段（见各分支 join 逻辑），不是主键——mirror 行是独立 PK，
        靠 (task_id/annotation_id/author_id/body) 等回连旧表行。

    纯查询、无副作用。drift = sum(len(missing_ids))；调用方据此决定是否告警。
    """
    out: dict[str, dict] = {}
    for source, kind in _MIRROR_KINDS.items():
        expected_rows = (await db.execute(text(_EXPECTED_SQL[source]))).all()
        expected_ids = [r[0] for r in expected_rows]

        actual = (
            await db.execute(
                text(
                    "SELECT COUNT(*) FROM v_annotation_feedback_unified "
                    "WHERE source_table = 'annotation_feedbacks' AND kind = :kind"
                ),
                {"kind": kind},
            )
        ).scalar() or 0

        missing_ids = await _missing_ids(db, source)
        out[source] = {
            "expected": len(expected_ids),
            "actual": int(actual),
            "missing_ids": missing_ids,
        }
    return out


async def _missing_ids(db: AsyncSession, source: str) -> list[str]:
    """旧表里「应 mirror」但 annotation_feedbacks 无对应 mirror 行的旧表主键。

    mirror 行不持有旧表 PK，故按双写时搬过去的业务字段回连：
      - bug_reports: (kind=bug, project_id, title, body=description, author_id)
      - annotation_comments: (kind=comment, annotation_id, body, author_id)
      - tasks_reject: (kind=reject, task_id, body=reject_reason, author_id=reviewer)
    用 NOT EXISTS 关联子查询，返回未被任何 mirror 行覆盖的旧表行 id。
    """
    if source == "bug_reports":
        sql = """
            SELECT br.id::text
            FROM bug_reports br
            WHERE br.project_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM annotation_feedbacks af
                WHERE af.kind = 'bug'
                  AND af.project_id = br.project_id
                  AND af.title IS NOT DISTINCT FROM br.title
                  AND af.body IS NOT DISTINCT FROM br.description
                  AND af.author_id IS NOT DISTINCT FROM br.reporter_id
              )
        """
    elif source == "annotation_comments":
        sql = """
            SELECT ac.id::text
            FROM annotation_comments ac
            WHERE ac.is_active = true
              AND NOT EXISTS (
                SELECT 1 FROM annotation_feedbacks af
                WHERE af.kind = 'comment'
                  AND af.annotation_id = ac.annotation_id
                  AND af.body IS NOT DISTINCT FROM ac.body
                  AND af.author_id IS NOT DISTINCT FROM ac.author_id
              )
        """
    elif source == "tasks_reject":
        sql = """
            SELECT t.id::text
            FROM tasks t
            WHERE t.status = 'rejected' AND t.reject_reason IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM annotation_feedbacks af
                WHERE af.kind = 'reject'
                  AND af.task_id = t.id
                  AND af.body IS NOT DISTINCT FROM t.reject_reason
              )
        """
    else:  # pragma: no cover - 调用方只传 _MIRROR_KINDS 里的 key
        return []
    rows = (await db.execute(text(sql))).all()
    return [r[0] for r in rows]
