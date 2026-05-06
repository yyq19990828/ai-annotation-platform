"""v0.7.8 · 审计日志不可变 — PG trigger 拒绝 UPDATE/DELETE

安全加固：审计日志一旦写入不可篡改。
GDPR 数据清除路径通过 SET LOCAL app.allow_audit_update = 'true' 豁免。

Revision ID: 0032
Revises: 0031
Create Date: 2026-05-06
"""

from alembic import op


revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION deny_audit_log_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
            IF current_setting('app.allow_audit_update', true) = 'true' THEN
                RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
            END IF;
            RAISE EXCEPTION 'audit_logs rows are immutable: % operation denied', TG_OP;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER trg_audit_log_no_update
            BEFORE UPDATE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION deny_audit_log_mutation()
    """)
    op.execute("""
        CREATE TRIGGER trg_audit_log_no_delete
            BEFORE DELETE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION deny_audit_log_mutation()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON audit_logs")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS deny_audit_log_mutation()")
