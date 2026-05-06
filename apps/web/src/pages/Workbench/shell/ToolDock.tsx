import { Icon, type IconName } from "@/components/ui/Icon";
import { ALL_TOOLS, type ToolId } from "../stage/tools";

interface ToolDockProps {
  tool: ToolId;
  onSetTool: (t: ToolId) => void;
}

/**
 * 左侧垂直工具栏（v0.5.3）。
 * 从 ALL_TOOLS 自动渲染按钮；新增工具仅需在 tools/ 目录下注册并加入 ALL_TOOLS。
 */
export function ToolDock({ tool, onSetTool }: ToolDockProps) {
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
        return (
          <button
            key={t.id}
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
        );
      })}
    </div>
  );
}
