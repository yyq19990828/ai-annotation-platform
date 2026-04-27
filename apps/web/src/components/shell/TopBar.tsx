import { Icon } from "@/components/ui/Icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { Avatar } from "@/components/ui/Avatar";

interface TopBarProps {
  workspace: string;
  onWorkspaceChange?: () => void;
}

export function TopBar({ workspace, onWorkspaceChange }: TopBarProps) {
  return (
    <header
      style={{
        gridColumn: "1 / -1",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        background: "var(--color-bg-elev)",
        borderBottom: "1px solid var(--color-border)",
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13, letterSpacing: "0.01em" }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "var(--radius-md)",
              background: "linear-gradient(135deg, var(--color-accent), oklch(0.55 0.22 280))",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 4,
                border: "1.5px solid rgba(255,255,255,0.85)",
                borderRadius: 3,
              }}
            />
          </div>
          <span>标注中心</span>
          <span style={{ color: "var(--color-fg-subtle)", fontSize: 11, fontWeight: 400, marginLeft: 4 }}>
            v2.4
          </span>
        </div>
        <div
          onClick={onWorkspaceChange}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px 4px 8px",
            background: "var(--color-bg-sunken)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            color: "var(--color-fg-muted)",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-success)",
            }}
          />
          <span>{workspace}</span>
          <Icon name="chevDown" size={12} />
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <SearchInput
          placeholder="搜索项目、任务、数据集、成员..."
          width={360}
          kbd="⌘K"
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          title="刷新"
          style={{
            width: 30,
            height: 30,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: "var(--radius-md)",
            color: "var(--color-fg-muted)",
            cursor: "pointer",
          }}
        >
          <Icon name="refresh" size={15} />
        </button>
        <button
          title="通知"
          style={{
            width: 30,
            height: 30,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: "var(--radius-md)",
            color: "var(--color-fg-muted)",
            cursor: "pointer",
            position: "relative",
          }}
        >
          <Icon name="bell" size={15} />
          <span
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 6,
              height: 6,
              background: "var(--color-danger)",
              borderRadius: "50%",
            }}
          />
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 10px 4px 4px",
            borderRadius: "var(--radius-lg)",
            cursor: "pointer",
          }}
        >
          <Avatar initial="张" size="sm" />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>张明轩</span>
            <span style={{ fontSize: 10.5, color: "var(--color-fg-muted)" }}>项目管理员</span>
          </div>
        </div>
      </div>
    </header>
  );
}
