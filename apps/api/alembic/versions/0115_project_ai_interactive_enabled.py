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

不处理的两处 (刻意):
- projects.tool_bindings 里可能残留的 'ai_interactive' key 保持原样。删除它会丢掉
  该 binding 下已配的 classes/attribute_schema; 而 ai_interactive 移出前端
  TOOL_UNIT_GROUPS 后, 该 key 不再被任何 UI 读取, 留着无害。
- predictions.tool_unit_id: 交互式 AI 候选不落 Prediction (走前端 state, 采纳时直接
  建 Annotation), 故该表不会出现 'ai_interactive'。

downgrade 仅删列。数据不可逆: 迁移后无法区分哪些 region/bbox 标注原本是 ai_interactive,
且它们归入 region/bbox 本就是语义正确的归属, 无需回滚。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0115"
down_revision = "0114"
branch_labels = None
depends_on = None


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
    # AI 采纳的标注按几何类型归回正确工具单位。
    op.execute(
        """
        UPDATE annotations
        SET tool_unit_id = CASE
            WHEN geometry->>'type' IN (
                'polygon', 'multi_polygon', 'mask',
                'video_polygon', 'video_track_polygon'
            ) THEN 'region'
            ELSE 'bbox'
        END
        WHERE tool_unit_id = 'ai_interactive'
        """
    )


def downgrade() -> None:
    op.drop_column("projects", "ai_interactive_enabled")
