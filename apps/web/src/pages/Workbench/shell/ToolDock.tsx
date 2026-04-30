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
        padding: "8px 4px", gap: 4,
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
            style={{
              width: 36, height: 36,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: active ? "var(--color-accent-soft)" : "transparent",
              color: active ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
              border: active ? "1px solid var(--color-accent)" : "1px solid transparent",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--color-bg-hover)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            <Icon name={t.icon as IconName} size={16} />
          </button>
        );
      })}
    </div>
  );
}
