import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { usePermissions } from "@/hooks/usePermissions";
import type { PageKey } from "@/types";
import type { IconName } from "@/components/ui/Icon";

interface SidebarProps {
  page: PageKey;
  setPage: (p: PageKey) => void;
  reviewCount: number;
}

interface NavItem {
  key: PageKey | "";
  icon: IconName;
  label: string;
  count?: number;
  badge?: string;
}

const sections: { label: string; items: NavItem[] }[] = [
  {
    label: "工作区",
    items: [
      { key: "dashboard", icon: "dashboard", label: "项目总览" },
      { key: "annotate", icon: "target", label: "标注工作台" },
      { key: "review", icon: "check", label: "质检审核" },
      { key: "datasets", icon: "layers", label: "数据集", count: 42 },
      { key: "storage", icon: "db", label: "存储管理" },
    ],
  },
  {
    label: "智能",
    items: [
      { key: "ai-pre", icon: "sparkles", label: "AI 预标注", badge: "3 运行中" },
      { key: "model-market", icon: "bot", label: "模型市场" },
      { key: "training", icon: "activity", label: "训练队列" },
    ],
  },
  {
    label: "管理",
    items: [
      { key: "users", icon: "users", label: "用户与权限" },
      { key: "audit", icon: "shield", label: "审计日志" },
      { key: "settings", icon: "settings", label: "设置" },
    ],
  },
];

export function Sidebar({ page, setPage, reviewCount }: SidebarProps) {
  const { canAccessPage, hasAnyPermission } = usePermissions();
  const showAiQuota = hasAnyPermission("ai.trigger", "ml-backend.manage");

  const visibleSections = sections
    .map((sec) => ({
      ...sec,
      items: sec.items.filter((item) => !item.key || canAccessPage(item.key as PageKey)),
    }))
    .filter((sec) => sec.items.length > 0);

  return (
    <aside
      style={{
        background: "var(--color-panel)",
        borderRight: "1px solid var(--color-border)",
        padding: "10px 8px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {visibleSections.map((sec) => (
        <div key={sec.label}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--color-fg-subtle)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "14px 10px 6px",
            }}
          >
            {sec.label}
          </div>
          {sec.items.map((item) => {
            const isActive = item.key === page;
            return (
              <div
                key={item.key || item.label}
                onClick={() => item.key && setPage(item.key as PageKey)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: "var(--radius-md)",
                  color: isActive ? "var(--color-fg)" : "var(--color-fg-muted)",
                  cursor: "pointer",
                  fontSize: 13,
                  userSelect: "none",
                  border: isActive ? "1px solid var(--color-border)" : "1px solid transparent",
                  background: isActive ? "var(--color-bg-elev)" : "transparent",
                  boxShadow: isActive ? "var(--shadow-sm)" : "none",
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                <Icon name={item.icon} size={16} style={{ opacity: 0.85, flexShrink: 0 }} />
                <span>{item.label}</span>
                {item.key === "annotate" && reviewCount > 0 && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      color: "var(--color-fg-subtle)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {reviewCount}
                  </span>
                )}
                {item.count && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      color: "var(--color-fg-subtle)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {item.count}
                  </span>
                )}
                {item.badge && (
                  <Badge variant="ai" style={{ marginLeft: "auto", padding: "0 6px", fontSize: 10 }}>
                    {item.badge}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ flex: 1 }} />

      {showAiQuota && (
        <div
          style={{
            margin: "12px 4px 4px",
            padding: 12,
            background: "linear-gradient(135deg, var(--color-ai-soft), var(--color-accent-soft))",
            borderRadius: "var(--radius-lg)",
            border: "1px solid oklch(0.92 0.04 270)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Icon name="sparkles" size={13} style={{ color: "var(--color-ai)" }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>AI 配额</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 8 }}>
            本月已用 6,842 / 20,000 次
          </div>
          <ProgressBar value={34} color="var(--color-ai)" />
        </div>
      )}
    </aside>
  );
}
