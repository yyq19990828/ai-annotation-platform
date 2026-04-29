import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { Annotation } from "@/types";
import type { AiBox } from "../state/transforms";
import { BoxListItem } from "../stage/BoxListItem";

interface AIInspectorPanelProps {
  open: boolean;
  aiModel: string;
  aiRunning: boolean;
  aiBoxes: AiBox[];
  userBoxes: Annotation[];
  selectedId: string | null;
  confThreshold: number;
  aiTakeoverRate: number;
  imageWidth: number | null;
  imageHeight: number | null;
  onToggle: () => void;
  onRunAi: () => void;
  onAcceptAll: () => void;
  onSetConfThreshold: (v: number) => void;
  onSelect: (id: string) => void;
  onAcceptPrediction: (b: AiBox) => void;
  onClearSelection: () => void;
  onDeleteUserBox: (id: string) => void;
}

const stripStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  height: "100%", gap: 8, cursor: "pointer", userSelect: "none",
  background: "var(--color-bg-elev)", border: "none", width: "100%", padding: 0,
  color: "var(--color-fg-muted)",
};

export function AIInspectorPanel({
  open, aiModel, aiRunning, aiBoxes, userBoxes, selectedId, confThreshold, aiTakeoverRate,
  imageWidth, imageHeight,
  onToggle, onRunAi, onAcceptAll, onSetConfThreshold,
  onSelect, onAcceptPrediction, onClearSelection, onDeleteUserBox,
}: AIInspectorPanelProps) {
  if (!open) {
    return (
      <div style={{ borderLeft: "1px solid var(--color-border)", overflow: "hidden" }}>
        <button onClick={onToggle} title="展开 AI 助手" style={stripStyle}>
          <Icon name="chevLeft" size={13} />
          <span style={{ fontSize: 10, writingMode: "vertical-rl", letterSpacing: 1, opacity: 0.6 }}>AI 助手</span>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--color-bg-elev)", borderLeft: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-border)", background: "linear-gradient(180deg, var(--color-ai-soft), transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="sparkles" size={14} style={{ color: "var(--color-ai)" }} />
            <b style={{ fontSize: 13 }}>AI 助手</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Badge variant="ai" dot style={{ fontSize: 10 }}>{aiRunning ? "推理中" : "在线"}</Badge>
            <Button variant="ghost" size="sm" onClick={onToggle} title="收起 AI 助手" style={{ padding: "2px 6px" }}>
              <Icon name="chevRight" size={11} />
            </Button>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", marginBottom: 8 }}>
          模型: <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>{aiModel}</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <Button variant="ai" size="sm" onClick={onRunAi} disabled={aiRunning} style={{ flex: 1 }}>
            <Icon name="sparkles" size={11} />一键预标
          </Button>
          <Button size="sm" onClick={onAcceptAll} disabled={aiBoxes.length === 0} style={{ flex: 1 }}>
            <Icon name="check" size={11} />全部采纳
          </Button>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: "var(--color-fg-muted)" }}>置信度阈值</span>
            <span className="mono" style={{ fontWeight: 500 }}>{(confThreshold * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range" min="0" max="1" step="0.05" value={confThreshold}
            onChange={(e) => onSetConfThreshold(+e.target.value)}
            style={{ width: "100%", accentColor: "var(--color-ai)" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-fg-subtle)", marginTop: -2 }}>
            <span>显示更多</span><span>更精准</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>AI 待审</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{aiBoxes.length} 项</span>
        </div>
        {aiBoxes.length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--color-fg-subtle)", padding: "4px 0" }}>暂无,点击"一键预标"开始</div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
        {aiBoxes.map((b) => (
          <BoxListItem
            key={b.id} b={b} isAi
            selected={selectedId === b.id}
            imageWidth={imageWidth} imageHeight={imageHeight}
            onSelect={() => onSelect(b.id)}
            onAccept={() => onAcceptPrediction(b)}
            onReject={onClearSelection}
          />
        ))}
        {userBoxes.length > 0 && (
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-fg-muted)", padding: "10px 6px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
            已确认 ({userBoxes.length})
          </div>
        )}
        {userBoxes.map((b) => (
          <BoxListItem
            key={b.id} b={b}
            selected={selectedId === b.id}
            imageWidth={imageWidth} imageHeight={imageHeight}
            onSelect={() => onSelect(b.id)}
            onDelete={() => onDeleteUserBox(b.id)}
          />
        ))}
      </div>

      <div style={{ borderTop: "1px solid var(--color-border)", padding: "10px 14px", background: "var(--color-bg-sunken)" }}>
        <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 6 }}>本次效率</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>AI 接管率</span>
          <span className="mono" style={{ fontWeight: 600, color: "var(--color-ai)" }}>{aiTakeoverRate}%</span>
        </div>
        <ProgressBar value={aiTakeoverRate} color="var(--color-ai)" />
      </div>
    </div>
  );
}
