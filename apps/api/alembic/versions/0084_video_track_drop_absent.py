"""v0.10.30 · 2.2 video_track 删除 keyframe.absent, 语义并入 outside 区间

schema 收敛: VideoTrackKeyframe 移除 absent 字段 (pydantic extra="forbid")。
存量 geometry 里 keyframes[*].absent=true 的帧, 转写为 outside range (与该帧号合并),
再删除所有 keyframe 的 absent 键, 否则旧 geometry 读取会校验失败。

downgrade 不还原 absent (语义已不可逆地并入 outside; 仅注明)。

Revision ID: 0084
Revises: 0083
Create Date: 2026-05-21
"""

import json

import sqlalchemy as sa
from alembic import op


revision = "0084"
down_revision = "0083"
branch_labels = None
depends_on = None


def _normalize_outside(ranges: list[dict]) -> list[dict]:
    cleaned: list[dict] = []
    for item in ranges or []:
        try:
            start = max(0, int(item.get("from")))
            end = max(0, int(item.get("to")))
        except (TypeError, ValueError):
            continue
        lo, hi = (start, end) if start <= end else (end, start)
        source = "prediction" if item.get("source") == "prediction" else "manual"
        cleaned.append({"from": lo, "to": hi, "source": source})
    cleaned.sort(key=lambda r: (r["from"], r["to"]))
    merged: list[dict] = []
    for r in cleaned:
        prev = merged[-1] if merged else None
        if prev and r["from"] <= prev["to"] + 1:
            prev["to"] = max(prev["to"], r["to"])
            if r["source"] == "prediction":
                prev["source"] = "prediction"
            continue
        merged.append(dict(r))
    return merged


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, geometry FROM annotations "
            "WHERE geometry->>'type' = 'video_track'"
        )
    ).fetchall()

    for row in rows:
        geometry = row.geometry
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        if not isinstance(geometry, dict):
            continue
        keyframes = geometry.get("keyframes") or []

        absent_ranges = [
            {
                "from": int(kf.get("frame_index", 0)),
                "to": int(kf.get("frame_index", 0)),
                "source": "prediction"
                if kf.get("source") == "prediction"
                else "manual",
            }
            for kf in keyframes
            if isinstance(kf, dict) and bool(kf.get("absent"))
        ]
        had_absent_key = any(
            isinstance(kf, dict) and "absent" in kf for kf in keyframes
        )
        if not had_absent_key:
            continue

        new_keyframes = []
        for kf in keyframes:
            if isinstance(kf, dict):
                kf = {k: v for k, v in kf.items() if k != "absent"}
            new_keyframes.append(kf)

        new_outside = _normalize_outside(
            list(geometry.get("outside") or []) + absent_ranges
        )
        new_geometry = {**geometry, "keyframes": new_keyframes, "outside": new_outside}

        bind.execute(
            sa.text("UPDATE annotations SET geometry = :g WHERE id = :id"),
            {"g": json.dumps(new_geometry), "id": str(row.id)},
        )


def downgrade() -> None:
    # 不还原 absent: 语义已并入 outside 区间, 无法区分哪些 outside 帧源自 absent。
    pass
