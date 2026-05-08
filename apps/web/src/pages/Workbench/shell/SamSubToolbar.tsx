import { Icon, type IconName } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import type { SamPolarity, SamSubTool } from "../state/useWorkbenchState";

interface SamSubToolbarProps {
  samSubTool: SamSubTool;
  onSetSamSubTool: (sub: SamSubTool) => void;
  samPolarity: SamPolarity;
  onSetSamPolarity: (p: SamPolarity) => void;
}

interface SubToolDef {
  id: SamSubTool;
  icon: IconName;
  label: string;
  desc: string;
  hotkey: string;
}

const SAM_SUB_TOOLS: SubToolDef[] = [
  { id: "point", icon: "target", label: "点", desc: "单击 = 正向点；Alt+点 = 负向点", hotkey: "S" },
  { id: "bbox", icon: "rect", label: "框", desc: "拖框作为 SAM 提示", hotkey: "S" },
  { id: "text", icon: "messageSquareText", label: "文本", desc: "用 DINO 文本召回 + SAM 精修", hotkey: "S" },
];

/**
 * v0.9.6 P2-b · SAM 子工具栏 — 从 ToolDock 拆出，改右侧抽屉锚定 SAM 主按钮.
 *
 * 视觉重整:
 *  - 由 ToolDock 内部嵌套渲染改为独立 absolute 锚定 (position 由父容器控制)
 *  - 子工具激活背景从 10% 提到 20% accent
 *  - point/bbox/text 之间加细分隔
 *  - polarity 圆形按钮位置同步迁入抽屉内 (sam-point 子工具下显示)
 */
export function SamSubToolbar({
  samSubTool,
  onSetSamSubTool,
  samPolarity,
  onSetSamPolarity,
}: SamSubToolbarProps) {
  return (
    <div
      data-testid="sam-subtoolbar"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "6px 4px",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      {SAM_SUB_TOOLS.map((sub, i) => {
        const subActive = samSubTool === sub.id;
        return (
          <div key={sub.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
            {i > 0 && (
              <div
                style={{
                  width: 18,
                  height: 1,
                  background: "var(--color-border-subtle, var(--color-border))",
                  margin: "2px 0",
                }}
              />
            )}
            <Tooltip name={sub.label} desc={sub.desc} hotkey={sub.hotkey} side="right" delay={150}>
              <button
                type="button"
                onClick={() => onSetSamSubTool(sub.id)}
                aria-label={sub.label}
                aria-pressed={subActive}
                data-testid={`sam-sub-${sub.id}`}
                style={{
                  width: 30, height: 30,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: subActive
                    ? "var(--color-accent)"
                    : "color-mix(in oklab, var(--color-accent) 6%, transparent)",
                  color: subActive ? "white" : "var(--color-fg)",
                  border: "1px solid " + (subActive ? "var(--color-accent)" : "transparent"),
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                  boxShadow: subActive
                    ? "inset 2px 0 0 color-mix(in oklab, var(--color-accent) 80%, white)"
                    : "none",
                }}
                onMouseEnter={(e) => {
                  if (!subActive) {
                    e.currentTarget.style.background =
                      "color-mix(in oklab, var(--color-accent) 20%, transparent)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!subActive) {
                    e.currentTarget.style.background =
                      "color-mix(in oklab, var(--color-accent) 6%, transparent)";
                  }
                }}
              >
                <Icon name={sub.icon} size={14} />
              </button>
            </Tooltip>
          </div>
        );
      })}
      {samSubTool === "point" && (
        <>
          <div
            style={{
              width: 18,
              height: 1,
              background: "var(--color-border-subtle, var(--color-border))",
              margin: "2px 0",
            }}
          />
          <Tooltip
            name={samPolarity === "positive" ? "正向点 (+)" : "负向点 (−)"}
            desc="标记为目标 / 排除区域"
            hotkey={samPolarity === "positive" ? "-" : "+"}
            side="right"
            delay={150}
          >
            <button
              type="button"
              onClick={() => onSetSamPolarity(samPolarity === "positive" ? "negative" : "positive")}
              aria-label="polarity"
              data-testid="sam-polarity"
              style={{
                width: 24, height: 24,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
                background:
                  samPolarity === "positive"
                    ? "var(--color-success, #10b981)"
                    : "var(--color-warning, #f59e0b)",
                color: "white",
                border: "none",
                borderRadius: "50%",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              {samPolarity === "positive" ? "+" : "−"}
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
