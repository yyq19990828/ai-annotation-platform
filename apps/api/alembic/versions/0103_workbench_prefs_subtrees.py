"""v0.15.3 · users.preferences workbench 平铺键归位四子树（数据迁移）

WorkbenchPreferences 从平铺 5 字段拆为 common/image/video/pointcloud 四子树
（schemas/user.py 同版改动），存量 JSONB 按归位表搬迁：

- smoothImage / cssImageFilter / controlPointsSize / snapToGrid → workbench.image.*
- longTaskSampleRate → workbench.common.*
- layout 保持 workbench 顶层不动

实现要点：
- 纯 SQL jsonb 运算批量改写（不经 ORM 逐行加载），LIMIT 循环分批留 scale 余地
- 幂等：WHERE 只命中仍含平铺键的行，已是新形态的行天然跳过
- 平铺键与子树键同时存在时以子树值为准（jsonb || 右侧优先，与 me.py 提升器一致）
- down 逆映射：子树内已知键搬回平铺，丢弃子树容器键

UP_BATCH_SQL / DOWN_BATCH_SQL 暴露为模块常量，tests/test_me_preferences.py
直接对测试库执行同一份 SQL 验证转换 / 幂等 / 还原。

Revision ID: 0103
Revises: 0102
Create Date: 2026-06-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0103"
down_revision = "0102"
branch_labels = None
depends_on = None

BATCH_SIZE = 500

UP_BATCH_SQL = """
WITH batch AS (
    SELECT id, preferences->'workbench' AS wb
    FROM users
    WHERE preferences ? 'workbench'
      AND jsonb_typeof(preferences->'workbench') = 'object'
      AND preferences->'workbench' ?| ARRAY[
          'smoothImage', 'cssImageFilter', 'controlPointsSize',
          'snapToGrid', 'longTaskSampleRate'
      ]
    LIMIT :batch_size
    FOR UPDATE
)
UPDATE users u
SET preferences = jsonb_set(
    u.preferences,
    '{workbench}',
    (b.wb - 'smoothImage' - 'cssImageFilter' - 'controlPointsSize'
          - 'snapToGrid' - 'longTaskSampleRate')
    || jsonb_build_object(
        'common',
        (CASE WHEN b.wb ? 'longTaskSampleRate'
              THEN jsonb_build_object('longTaskSampleRate', b.wb->'longTaskSampleRate')
              ELSE '{}'::jsonb END)
        || COALESCE(b.wb->'common', '{}'::jsonb),
        'image',
        (CASE WHEN b.wb ? 'smoothImage'
              THEN jsonb_build_object('smoothImage', b.wb->'smoothImage')
              ELSE '{}'::jsonb END)
        || (CASE WHEN b.wb ? 'cssImageFilter'
                 THEN jsonb_build_object('cssImageFilter', b.wb->'cssImageFilter')
                 ELSE '{}'::jsonb END)
        || (CASE WHEN b.wb ? 'controlPointsSize'
                 THEN jsonb_build_object('controlPointsSize', b.wb->'controlPointsSize')
                 ELSE '{}'::jsonb END)
        || (CASE WHEN b.wb ? 'snapToGrid'
                 THEN jsonb_build_object('snapToGrid', b.wb->'snapToGrid')
                 ELSE '{}'::jsonb END)
        || COALESCE(b.wb->'image', '{}'::jsonb)
    )
)
FROM batch b
WHERE u.id = b.id
"""

DOWN_BATCH_SQL = """
WITH batch AS (
    SELECT id, preferences->'workbench' AS wb
    FROM users
    WHERE preferences ? 'workbench'
      AND jsonb_typeof(preferences->'workbench') = 'object'
      AND preferences->'workbench' ?| ARRAY['common', 'image', 'video', 'pointcloud']
    LIMIT :batch_size
    FOR UPDATE
)
UPDATE users u
SET preferences = jsonb_set(
    u.preferences,
    '{workbench}',
    (b.wb - 'common' - 'image' - 'video' - 'pointcloud')
    || (CASE WHEN b.wb->'image' ? 'smoothImage'
             THEN jsonb_build_object('smoothImage', b.wb->'image'->'smoothImage')
             ELSE '{}'::jsonb END)
    || (CASE WHEN b.wb->'image' ? 'cssImageFilter'
             THEN jsonb_build_object('cssImageFilter', b.wb->'image'->'cssImageFilter')
             ELSE '{}'::jsonb END)
    || (CASE WHEN b.wb->'image' ? 'controlPointsSize'
             THEN jsonb_build_object('controlPointsSize', b.wb->'image'->'controlPointsSize')
             ELSE '{}'::jsonb END)
    || (CASE WHEN b.wb->'image' ? 'snapToGrid'
             THEN jsonb_build_object('snapToGrid', b.wb->'image'->'snapToGrid')
             ELSE '{}'::jsonb END)
    || (CASE WHEN b.wb->'common' ? 'longTaskSampleRate'
             THEN jsonb_build_object('longTaskSampleRate', b.wb->'common'->'longTaskSampleRate')
             ELSE '{}'::jsonb END)
)
FROM batch b
WHERE u.id = b.id
"""


def _run_batches(sql: str) -> None:
    bind = op.get_bind()
    while True:
        result = bind.execute(sa.text(sql), {"batch_size": BATCH_SIZE})
        if result.rowcount < 1:
            break


def upgrade() -> None:
    _run_batches(UP_BATCH_SQL)


def downgrade() -> None:
    _run_batches(DOWN_BATCH_SQL)
