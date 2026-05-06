"""v0.8.1 · audit_logs 改为按月 RANGE 分区表

设计 / 风险见 ADR-0008。

迁移策略：
  1. 暂停旧 immutability 触发器（rename to legacy 后即同时挪过去）
  2. 重命名 audit_logs → audit_logs_legacy
  3. 创建新分区父表 audit_logs（PARTITION BY RANGE (created_at)）
     - PK 改为 (id, created_at)，分区键必须在主键中
     - 重建索引（actor_id/action/request_id/created_at + JSONB GIN）
  4. 创建覆盖 [min(legacy.created_at) 所在月, current_month + 3] 的子分区
  5. 把不可变 trigger 创建在父表上（PG13+ 自动级联到所有分区，包括未来新建的）
  6. INSERT INTO audit_logs SELECT * FROM audit_logs_legacy
     - 触发 trigger.deny_audit_log_mutation 仅对 UPDATE/DELETE 生效，INSERT 不受限
  7. setval audit_logs_id_seq
  8. DROP TABLE audit_logs_legacy

升级在锁表窗口内完成（事务内 BEGIN..COMMIT）。生产数据量 > 1M 行需评估改用 pg_partman，当前 v0.8.1 部署量级（< 100k）足够。

Revision ID: 0037
Revises: 0036
Create Date: 2026-05-06
"""

from datetime import date, datetime, timezone

import sqlalchemy as sa
from alembic import op


revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def _month_floor(d: date) -> date:
    return d.replace(day=1)


def _next_month(d: date) -> date:
    if d.month == 12:
        return d.replace(year=d.year + 1, month=1, day=1)
    return d.replace(month=d.month + 1, day=1)


def _partition_name(d: date) -> str:
    return f"audit_logs_y{d.year}m{d.month:02d}"


def _create_partition_sql(d: date) -> str:
    start = d.isoformat()
    end = _next_month(d).isoformat()
    return (
        f"CREATE TABLE IF NOT EXISTS {_partition_name(d)} PARTITION OF audit_logs "
        f"FOR VALUES FROM ('{start}') TO ('{end}')"
    )


def upgrade() -> None:
    bind = op.get_bind()

    # 1. 重命名旧表 + 重命名所有冲突索引（PG 不会自动重命名 index/constraint）
    op.execute("ALTER TABLE audit_logs RENAME TO audit_logs_legacy")
    # 实际索引名（参考迁移 0015 / 0023 + 早期建表迁移）：
    #   audit_logs_pkey / ix_audit_logs_action_created / ix_audit_logs_actor_created /
    #   ix_audit_logs_created / ix_audit_logs_detail_json_gin / ix_audit_logs_request_id /
    #   ix_audit_logs_target
    for old, new in [
        ("audit_logs_pkey", "audit_logs_legacy_pkey"),
        ("ix_audit_logs_action_created", "ix_audit_logs_legacy_action_created"),
        ("ix_audit_logs_actor_created", "ix_audit_logs_legacy_actor_created"),
        ("ix_audit_logs_created", "ix_audit_logs_legacy_created"),
        ("ix_audit_logs_detail_json_gin", "ix_audit_logs_legacy_detail_json_gin"),
        ("ix_audit_logs_request_id", "ix_audit_logs_legacy_request_id"),
        ("ix_audit_logs_target", "ix_audit_logs_legacy_target"),
    ]:
        op.execute(f"ALTER INDEX IF EXISTS {old} RENAME TO {new}")

    # 触发器自动跟随重命名后的表，且 legacy 即将 DROP，无需特别处理

    # 2. 取 legacy 最小 created_at（决定起始分区）
    res = bind.execute(sa.text("SELECT MIN(created_at), MAX(id) FROM audit_logs_legacy"))
    row = res.first()
    min_created_at = row[0] if row and row[0] else datetime.now(timezone.utc)
    max_id = row[1] if row and row[1] else 0

    # 3. 创建新分区父表（PARTITION BY RANGE (created_at)）
    op.execute(
        """
        CREATE TABLE audit_logs (
            id BIGSERIAL,
            actor_id UUID,
            actor_email VARCHAR(255),
            actor_role VARCHAR(32),
            action VARCHAR(64) NOT NULL,
            target_type VARCHAR(32),
            target_id VARCHAR(64),
            method VARCHAR(8),
            path VARCHAR(256),
            status_code SMALLINT,
            ip INET,
            detail_json JSONB,
            request_id VARCHAR(36),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (id, created_at),
            FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
        ) PARTITION BY RANGE (created_at)
        """
    )
    # 分区索引（自动级联到所有子分区）— 与原表索引一一对应
    op.execute(
        "CREATE INDEX ix_audit_logs_action_created ON audit_logs (action, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX ix_audit_logs_actor_created ON audit_logs (actor_id, created_at DESC)"
    )
    op.execute("CREATE INDEX ix_audit_logs_created ON audit_logs (created_at DESC)")
    op.execute("CREATE INDEX ix_audit_logs_request_id ON audit_logs (request_id)")
    op.execute(
        "CREATE INDEX ix_audit_logs_target ON audit_logs (target_type, target_id)"
    )
    op.execute(
        "CREATE INDEX ix_audit_logs_detail_json_gin ON audit_logs USING GIN (detail_json)"
    )

    # 4. 创建子分区：从 legacy 最早月份（含）到当前月 + 3
    today = datetime.now(timezone.utc).date()
    start = _month_floor(min_created_at.date())
    end = _next_month(_next_month(_next_month(_month_floor(today))))  # current+3
    cur = start
    while cur < end:
        op.execute(_create_partition_sql(cur))
        cur = _next_month(cur)

    # 5. 不可变 trigger：PG13+ 支持在分区父表上创建 BEFORE ROW 触发器，自动级联
    # 旧函数 deny_audit_log_mutation() 来自 0032 仍存在 — 直接复用
    op.execute(
        """
        CREATE TRIGGER trg_audit_log_no_update
            BEFORE UPDATE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION deny_audit_log_mutation()
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_audit_log_no_delete
            BEFORE DELETE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION deny_audit_log_mutation()
        """
    )

    # 6. 数据迁移
    op.execute(
        """
        INSERT INTO audit_logs (
            id, actor_id, actor_email, actor_role, action, target_type, target_id,
            method, path, status_code, ip, detail_json, request_id, created_at
        )
        SELECT
            id, actor_id, actor_email, actor_role, action, target_type, target_id,
            method, path, status_code, ip, detail_json, request_id, created_at
        FROM audit_logs_legacy
        """
    )

    # 7. 同步 sequence —— 用 pg_get_serial_sequence 获取实际名（BIGSERIAL 自动分配名可能含后缀）
    if max_id and max_id > 0:
        op.execute(
            f"SELECT setval(pg_get_serial_sequence('audit_logs', 'id'), {int(max_id)})"
        )

    # 8. 删除 legacy（DROP 自带 CASCADE 清掉 legacy 索引/触发器/旧 sequence）
    op.execute("DROP TABLE audit_logs_legacy CASCADE")


def downgrade() -> None:
    """回滚：把分区表回展平为普通表。**生产环境慎用** —— 大表数据迁移会锁表。"""
    op.execute("ALTER TABLE audit_logs RENAME TO audit_logs_partitioned_tmp")
    # 重命名分区表的索引，避免与新建普通表的索引名冲突
    for old, new in [
        ("ix_audit_logs_action_created", "ix_audit_logs_partitioned_action_created"),
        ("ix_audit_logs_actor_created", "ix_audit_logs_partitioned_actor_created"),
        ("ix_audit_logs_created", "ix_audit_logs_partitioned_created"),
        ("ix_audit_logs_detail_json_gin", "ix_audit_logs_partitioned_detail_json_gin"),
        ("ix_audit_logs_request_id", "ix_audit_logs_partitioned_request_id"),
        ("ix_audit_logs_target", "ix_audit_logs_partitioned_target"),
        ("audit_logs_pkey", "audit_logs_partitioned_pkey"),
    ]:
        op.execute(f"ALTER INDEX IF EXISTS {old} RENAME TO {new}")
    op.execute(
        """
        CREATE TABLE audit_logs (
            id BIGSERIAL PRIMARY KEY,
            actor_id UUID,
            actor_email VARCHAR(255),
            actor_role VARCHAR(32),
            action VARCHAR(64) NOT NULL,
            target_type VARCHAR(32),
            target_id VARCHAR(64),
            method VARCHAR(8),
            path VARCHAR(256),
            status_code SMALLINT,
            ip INET,
            detail_json JSONB,
            request_id VARCHAR(36),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_audit_logs_action_created ON audit_logs (action, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX ix_audit_logs_actor_created ON audit_logs (actor_id, created_at DESC)"
    )
    op.execute("CREATE INDEX ix_audit_logs_created ON audit_logs (created_at DESC)")
    op.execute("CREATE INDEX ix_audit_logs_request_id ON audit_logs (request_id)")
    op.execute(
        "CREATE INDEX ix_audit_logs_target ON audit_logs (target_type, target_id)"
    )
    op.execute(
        "CREATE INDEX ix_audit_logs_detail_json_gin ON audit_logs USING GIN (detail_json)"
    )
    op.execute(
        """
        INSERT INTO audit_logs (
            id, actor_id, actor_email, actor_role, action, target_type, target_id,
            method, path, status_code, ip, detail_json, request_id, created_at
        )
        SELECT
            id, actor_id, actor_email, actor_role, action, target_type, target_id,
            method, path, status_code, ip, detail_json, request_id, created_at
        FROM audit_logs_partitioned_tmp
        """
    )
    op.execute(
        """
        SELECT setval(
            'audit_logs_id_seq',
            COALESCE((SELECT MAX(id) FROM audit_logs), 1)
        )
        """
    )
    op.execute("DROP TABLE audit_logs_partitioned_tmp CASCADE")
    op.execute(
        """
        CREATE TRIGGER trg_audit_log_no_update
            BEFORE UPDATE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION deny_audit_log_mutation()
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_audit_log_no_delete
            BEFORE DELETE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION deny_audit_log_mutation()
        """
    )
