import { Avatar } from "@/components/ui/Avatar";

export interface AssigneeBrief {
  id: string;
  name: string;
  email?: string;
  role?: string | null;
  avatar_initial?: string;
}

interface Props {
  users: AssigneeBrief[];
  max?: number;
  size?: "sm" | "md";
  /** 标签前缀，例如「标注员」「审核员」；不传不渲染 */
  label?: string;
  /** 0 用户时是否显示「未分派」灰条 */
  emptyHint?: string;
  title?: string;
}

/**
 * v0.7.2 · 责任人头像组（最多 N 个 + 计数）。
 * 抽自 BatchesSection inline 实现，供 ProjectsPage / Annotator·Reviewer Dashboard
 * / Workbench Topbar 等多处复用。
 */
export function AssigneeAvatarStack({
  users,
  max = 3,
  size = "sm",
  label,
  emptyHint = "未分派",
  title,
}: Props) {
  if (users.length === 0) {
    return (
      <span
        style={{
          fontSize: 11,
          color: "var(--color-fg-subtle)",
          fontStyle: "italic",
        }}
      >
        {label ? `${label}：` : ""}{emptyHint}
      </span>
    );
  }

  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  const tooltip = title ?? users.map((u) => u.name).join("、");

  return (
    <span
      title={tooltip}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {label && (
        <span style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
          {label}
        </span>
      )}
      <span style={{ display: "inline-flex" }}>
        {visible.map((u, i) => (
          <span
            key={u.id}
            style={{
              marginLeft: i === 0 ? 0 : -6,
              border: "1.5px solid var(--color-bg-elev)",
              borderRadius: "50%",
              background: "var(--color-bg-elev)",
            }}
          >
            <Avatar
              initial={
                (u.avatar_initial ||
                  (u.name || u.email || "?").slice(0, 1).toUpperCase())
              }
              size={size}
            />
          </span>
        ))}
      </span>
      {overflow > 0 && (
        <span
          style={{
            fontSize: 11,
            color: "var(--color-fg-muted)",
            marginLeft: 2,
          }}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
