"""projects.ai_interactive_enabled + 退役 ai_interactive 伪工具单位

「AI 交互」此前被错误建模成一个几何工具单位 (ToolUnitId.ai_interactive), 塞进
projects.tool_bindings。它并不产出独有几何 —— smart-point / smart-box / exemplar
产 polygon (本属 region), magic-box / text-prompt 产 bbox (本属 bbox) —— 由此派生
两个 bug:

1. 死开关: 因为它不是几何单位, 用「单位启用」过滤会误伤后端能力协商, 于是工作台
   ToolDock 写死一行豁免 (requiredPrompt 工具直接放行), 导致其 enabled 开关对
   工作台零作用。
2. 伪类别域: 采纳 AI 候选时落库 tool_unit_id='ai_interactive', 而几何是 bbox/polygon。
   类别按 tool_unit_id 隔离 -> 手画 polygon 归 region、AI 画 polygon 归 ai_interactive,
   两套类别列表互不相通, 须在两个 tab 各配一遍。

本迁移:
- projects 新增 ai_interactive_enabled (布尔总开关, 归项目设置「ML 模型」)。
  能否用 AI 工具取决于绑了什么 ML backend, 与几何类别无关。
- annotations.tool_unit_id 从 'ai_interactive' 按其几何类型改归正确单位
  (polygon 系 -> region, 其余 -> bbox)。

本迁移不动 predictions.tool_unit_id 与 projects.tool_bindings 里可能残留的
'ai_interactive' —— 那两处的存量清理 (predictions 分批回填 + tool_bindings 里
ai_interactive 单位的 classes/attributes 合并进 region/bbox) 由后续迁移 0116
`retire_ai_interactive_tool_unit` 承接, 与「从 ToolUnitId 字面量删除该值」同批落地。

downgrade 仅删列。数据不可逆: 迁移后无法区分哪些 region/bbox 标注原本是 ai_interactive,
且它们归入 region/bbox 本就是语义正确的归属, 无需回滚。

annotations.tool_unit_id 回填分批 (RETIRE_BATCH_SQL) 而非一条裸 UPDATE 的原因:
该列**全程无索引** (0072 建列时未建, 至今无迁移补过), 生产大表上一条
`UPDATE ... WHERE tool_unit_id='ai_interactive'` 是一次全表 seq scan + 单事务持锁写,
批量转换期间会长时间阻塞在线读写。改成按 PK 游标 `LIMIT :batch_size FOR UPDATE` 分批
(照抄 0103_workbench_prefs_subtrees 的 _run_batches 写法): 每条 UPDATE 只锁至多
一批行, 转换完的行不再命中 WHERE, 循环到某批 rowcount<1 收尾。CASE 归属语义与原裸
UPDATE 完全一致 (polygon 系 -> region, 其余 -> bbox)。零 ai_interactive 行时首轮即
rowcount=0 直接 break (dev 库 0115 已跑, 此处对 dev 是空跑)。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0115"
down_revision = "0114"
branch_labels = None
depends_on = None

BATCH_SIZE = 5000

# 与原裸 UPDATE 的 CASE 归属逐字一致; 只是包进 PK 游标分批, 限制单批持锁行数。
RETIRE_BATCH_SQL = """
WITH batch AS (
    SELECT id FROM annotations
    WHERE tool_unit_id = 'ai_interactive'
    LIMIT :batch_size
    FOR UPDATE
)
UPDATE annotations a
SET tool_unit_id = CASE
    WHEN a.geometry->>'type' IN (
        'polygon', 'multi_polygon', 'mask',
        'video_polygon', 'video_track_polygon'
    ) THEN 'region'
    ELSE 'bbox'
END
FROM batch b
WHERE a.id = b.id
"""


def _run_batches(sql: str) -> None:
    bind = op.get_bind()
    while True:
        result = bind.execute(sa.text(sql), {"batch_size": BATCH_SIZE})
        if result.rowcount < 1:
            break


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "ai_interactive_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    # AI 采纳的标注按几何类型归回正确工具单位 (无索引大表 -> 分批, 见模块 docstring)。
    _run_batches(RETIRE_BATCH_SQL)


def downgrade() -> None:
    op.drop_column("projects", "ai_interactive_enabled")
