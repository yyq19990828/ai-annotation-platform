"""ADR-0027 第二段 · v_annotation_feedback_unified UNION ALL view.

把 4 个反馈数据源对齐到统一 schema, 为 v0.10.21 切单源前的"对账阶段"准备:
- annotation_feedbacks (新表, v0.10.19 落)
- bug_reports
- annotation_comments
- tasks.reject_reason / reject_reason_type

视图带 source_table 列, 方便诊断双写一致性 (每天 cron 跑 SELECT source_table, COUNT(*) 对账).

注意: 视图依赖底表, 任何 DROP/RENAME 底表列都需要先 DROP VIEW. downgrade 也是先 DROP VIEW.

Revision ID: 0077
Revises: 0076
Create Date: 2026-05-19
"""

from __future__ import annotations

from alembic import op


revision = "0077"
down_revision = "0076"
branch_labels = None
depends_on = None


VIEW_SQL = """
CREATE OR REPLACE VIEW v_annotation_feedback_unified AS
-- 新表 annotation_feedbacks (主源, 含所有 4 个 kind)
SELECT
    af.id::text                          AS id,
    af.kind                              AS kind,
    af.anchor_type                       AS anchor_type,
    af.project_id                        AS project_id,
    af.task_id                           AS task_id,
    af.annotation_id                     AS annotation_id,
    af.anchor_position                   AS anchor_position,
    af.status                            AS status,
    af.severity                          AS severity,
    af.title                             AS title,
    af.body                              AS body,
    af.author_id                         AS author_id,
    af.created_at                        AS created_at,
    af.updated_at                        AS updated_at,
    af.is_active                         AS is_active,
    'annotation_feedbacks'::text         AS source_table
FROM annotation_feedbacks af
WHERE af.is_active = true

UNION ALL

-- bug_reports (kind='bug', anchor=project 或 task)
SELECT
    br.id::text                          AS id,
    'bug'::varchar(16)                   AS kind,
    CASE WHEN br.task_id IS NOT NULL THEN 'task'::varchar(16) ELSE 'project'::varchar(16) END AS anchor_type,
    br.project_id                        AS project_id,
    br.task_id                           AS task_id,
    NULL::uuid                           AS annotation_id,
    NULL::jsonb                          AS anchor_position,
    -- 旧 bug_reports.status 值域: new/triaged/in_progress/fixed/wont_fix/duplicate
    -- 映射到统一 open/resolved/wont_fix:
    CASE br.status
        WHEN 'fixed' THEN 'resolved'
        WHEN 'wont_fix' THEN 'wont_fix'
        WHEN 'duplicate' THEN 'wont_fix'
        ELSE 'open'
    END::varchar(16)                     AS status,
    br.severity                          AS severity,
    br.title                             AS title,
    br.description                       AS body,
    br.reporter_id                       AS author_id,
    br.created_at                        AS created_at,
    br.created_at                        AS updated_at,
    true                                 AS is_active,
    'bug_reports'::text                  AS source_table
FROM bug_reports br
WHERE br.project_id IS NOT NULL  -- view 要求 project_id 非空 (annotation_feedbacks.project_id NOT NULL)

UNION ALL

-- annotation_comments (kind='comment', anchor=annotation)
SELECT
    ac.id::text                          AS id,
    'comment'::varchar(16)               AS kind,
    'annotation'::varchar(16)            AS anchor_type,
    COALESCE(ac.project_id, a.project_id) AS project_id,
    a.task_id                            AS task_id,
    ac.annotation_id                     AS annotation_id,
    ac.anchor                            AS anchor_position,
    CASE WHEN ac.is_resolved THEN 'resolved'::varchar(16) ELSE 'open'::varchar(16) END AS status,
    NULL::varchar(16)                    AS severity,
    NULL::varchar(500)                   AS title,
    ac.body                              AS body,
    ac.author_id                         AS author_id,
    ac.created_at                        AS created_at,
    ac.updated_at                        AS updated_at,
    ac.is_active                         AS is_active,
    'annotation_comments'::text          AS source_table
FROM annotation_comments ac
JOIN annotations a ON a.id = ac.annotation_id
WHERE ac.is_active = true

UNION ALL

-- tasks.reject_reason (kind='reject', anchor=task)
SELECT
    t.id::text                           AS id,
    'reject'::varchar(16)                AS kind,
    'task'::varchar(16)                  AS anchor_type,
    t.project_id                         AS project_id,
    t.id                                 AS task_id,
    NULL::uuid                           AS annotation_id,
    NULL::jsonb                          AS anchor_position,
    'open'::varchar(16)                  AS status,
    t.reject_reason_type                 AS severity,
    NULL::varchar(500)                   AS title,
    t.reject_reason                      AS body,
    t.reviewer_id                        AS author_id,
    COALESCE(t.reviewed_at, t.updated_at) AS created_at,
    COALESCE(t.reviewed_at, t.updated_at) AS updated_at,
    true                                 AS is_active,
    'tasks_reject'::text                 AS source_table
FROM tasks t
WHERE t.status = 'rejected' AND t.reject_reason IS NOT NULL
"""


def upgrade() -> None:
    op.execute(VIEW_SQL)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_annotation_feedback_unified")
