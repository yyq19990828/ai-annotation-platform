import { Icon, type IconName } from "@/components/ui/Icon";
import { ALL_TOOLS, type ToolId } from "../stage/tools";
import type { SamPolarity, SamSubTool } from "../state/useWorkbenchState";

interface ToolDockProps {
  tool: ToolId;
  onSetTool: (t: ToolId) => void;
  /** v0.9.4 phase 2 · 仅 tool === "sam" 时浮出子工具栏. */
  samSubTool?: SamSubTool;
  onSetSamSubTool?: (sub: SamSubTool) => void;
  samPolarity?: SamPolarity;
  onSetSamPolarity?: (p: SamPolarity) => void;
}

/** v0.9.4 phase 2 · SAM 子工具配置 (与 SamTool.ts mode 一致). */
const SAM_SUB_TOOLS: { id: SamSubTool; icon: IconName; label: string }[] = [
  { id: "point", icon: "target", label: "点 (Click)" },
  { id: "bbox", icon: "rect", label: "框 (Box)" },
  { id: "text", icon: "sparkles", label: "文本 (Text)" },
];

/**
 * 左侧垂直工具栏（v0.5.3）。
 * 从 ALL_TOOLS 自动渲染按钮；新增工具仅需在 tools/ 目录下注册并加入 ALL_TOOLS。
 *
 * v0.9.4 phase 2 · SAM 工具被选中时, 在 S 按钮下方嵌入子工具栏 [点 / 框 / 文本] +
 *   sam-point 子工具下额外露 [+/-] polarity 切换. 子工具消除 v0.9.2 的隐式分流
 *   (动作派生 prompt 类型, 新人不可见).
 */
export function ToolDock({
  tool,
  onSetTool,
  samSubTool = "point",
  onSetSamSubTool,
  samPolarity = "positive",
  onSetSamPolarity,
}: ToolDockProps) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "10px 4px", gap: 6,
        background: "var(--color-bg-elev)",
        borderRight: "1px solid var(--color-border)",
      }}
    >
      {ALL_TOOLS.map((t) => {
        const active = tool === t.id;
        const isSamActive = t.id === "sam" && active;
        return (
          <div key={t.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              onClick={() => onSetTool(t.id)}
              title={`${t.label} (${t.hotkey})`}
              aria-label={t.label}
              aria-pressed={active}
              data-testid={`tool-btn-${t.id}`}
              style={{
                position: "relative",
                width: 38, height: 38,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: active ? "var(--color-accent)" : "transparent",
                color: active ? "white" : "var(--color-fg-muted)",
                border: "1px solid " + (active ? "var(--color-accent)" : "transparent"),
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                transition: "background 0.12s, color 0.12s, transform 0.08s",
                boxShadow: active ? "0 2px 6px color-mix(in oklab, var(--color-accent) 45%, transparent)" : "none",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = "var(--color-bg-hover)";
                  e.currentTarget.style.color = "var(--color-fg)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--color-fg-muted)";
                }
              }}
            >
              <Icon name={t.icon as IconName} size={17} />
            </button>
            {isSamActive && onSetSamSubTool && (
              <div
                data-testid="sam-subtoolbar"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  padding: "4px 2px",
                  background: "color-mix(in oklab, var(--color-accent) 10%, transparent)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                {SAM_SUB_TOOLS.map((sub) => {
                  const subActive = samSubTool === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => onSetSamSubTool(sub.id)}
                      title={sub.label}
                      aria-label={sub.label}
                      aria-pressed={subActive}
                      data-testid={`sam-sub-${sub.id}`}
                      style={{
                        width: 28, height: 28,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: subActive ? "var(--color-accent)" : "transparent",
                        color: subActive ? "white" : "var(--color-fg-muted)",
                        border: "1px solid " + (subActive ? "var(--color-accent)" : "transparent"),
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                        transition: "background 0.12s, color 0.12s",
                      }}
                    >
                      <Icon name={sub.icon} size={13} />
                    </button>
                  );
                })}
                {samSubTool === "point" && onSetSamPolarity && (
                  <button
                    type="button"
                    onClick={() =>
                      onSetSamPolarity(samPolarity === "positive" ? "negative" : "positive")
                    }
                    title={
                      samPolarity === "positive"
                        ? "正向点 (+); 按 - 切负向"
                        : "负向点 (-); 按 + 切正向"
                    }
                    aria-label="polarity"
                    data-testid="sam-polarity"
                    style={{
                      width: 22, height: 22,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12,
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
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
