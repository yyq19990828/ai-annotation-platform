/**
 * v0.9.7 · Step 3: 输出形态选择 (box / mask / both).
 */

import { Card } from "@/components/ui/Card";
import { TabRow } from "@/components/ui/TabRow";
import type { TextOutputMode } from "@/hooks/usePreannotation";
import { cardBodyStyle, cardHeaderStyle, labelStyle, helperTextStyle } from "../styles";

const OUTPUT_MODE_LABELS: Record<TextOutputMode, string> = {
  box: "□ 框",
  mask: "○ 掩膜",
  both: "⊕ 全部",
};
const OUTPUT_MODE_BY_LABEL: Record<string, TextOutputMode> = {
  "□ 框": "box",
  "○ 掩膜": "mask",
  "⊕ 全部": "both",
};
const OUTPUT_MODE_TABS = Object.values(OUTPUT_MODE_LABELS);

const DESCRIPTIONS: Record<TextOutputMode, string> = {
  box: "仅 DINO 出框，跳过 SAM 推理（image-det 项目首选，速度 ×3-5）",
  mask: "DINO + SAM mask → polygon（image-seg 项目首选）",
  both: "同实例配对返回框 + 掩膜，标注员可挑选粒度",
};

interface Props {
  anchorId: string;
  stepBadge: string;
  outputMode: TextOutputMode;
  onChange: (mode: TextOutputMode) => void;
}

export function OutputModeSelector({ anchorId, stepBadge, outputMode, onChange }: Props) {
  return (
    <Card>
      <div id={anchorId} style={{ ...cardHeaderStyle, scrollMarginTop: 80 }}>
        <span>{stepBadge} · 输出形态</span>
      </div>
      <div style={cardBodyStyle}>
        <div>
          <label style={labelStyle}>输出形态</label>
          <TabRow
            tabs={OUTPUT_MODE_TABS}
            active={OUTPUT_MODE_LABELS[outputMode]}
            onChange={(label) => {
              const m = OUTPUT_MODE_BY_LABEL[label];
              if (m) onChange(m);
            }}
          />
          <div style={helperTextStyle}>{DESCRIPTIONS[outputMode]}</div>
        </div>
      </div>
    </Card>
  );
}
