import { NavLink } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { usePermissions } from "@/hooks/usePermissions";
import { useFailedPredictions } from "@/hooks/useFailedPredictions";
import { useAdminStats } from "@/hooks/useDashboard";
import type { PageKey } from "@/types";
import type { IconName } from "@/components/ui/Icon";

interface SidebarProps {
  reviewCount: number;
}

interface NavItem {
  key: PageKey;
  path: string;
  icon: IconName;
  label: string;
  count?: number;
  badge?: string;
}

const sectionsForRole = (isSuperAdmin: boolean): { label: string; items: NavItem[] }[] => [
  {
    label: "工作区",
    items: [
      ...(isSuperAdmin
        ? [
            { key: "dashboard" as PageKey, path: "/dashboard", icon: "dashboard" as IconName, label: "平台概览" },
            { key: "dashboard" as PageKey, path: "/dashboard?view=projects", icon: "layers" as IconName, label: "项目总览" },
          ]
        : [{ key: "dashboard" as PageKey, path: "/dashboard", icon: "dashboard" as IconName, label: "项目总览" }]),
      { key: "annotate", path: "/annotate", icon: "target", label: "标注工作" },
      { key: "review", path: "/review", icon: "check", label: "质检审核" },
      { key: "datasets", path: "/datasets", icon: "layers", label: "数据集", count: 42 },
      { key: "storage", path: "/storage", icon: "db", label: "存储管理" },
    ],
  },
  {
    label: "智能",
    items: [
      { key: "ai-pre", path: "/ai-pre", icon: "sparkles", label: "AI 预标注" },
      { key: "model-market", path: "/model-market", icon: "bot", label: "模型市场" },
      { key: "training", path: "/training", icon: "activity", label: "训练队列" },
    ],
  },
  {
    label: "管理",
    items: [
      { key: "users", path: "/users", icon: "users", label: "用户与权限" },
      { key: "audit", path: "/audit", icon: "shield", label: "审计日志" },
      { key: "settings", path: "/settings", icon: "settings", label: "设置" },
    ],
  },
];

export function Sidebar({ reviewCount }: SidebarProps) {
  const { canAccessPage, hasAnyPermission, role } = usePermissions();
  const showAiQuota = hasAnyPermission("ai.trigger", "ml-backend.manage");
  const canSeeFailed = hasAnyPermission("ml-backend.manage");
  const failedQuery = useFailedPredictions(1, 1, false, canSeeFailed);
  const failedTotal = failedQuery.data?.total ?? 0;
  // v0.9.5 · pre_annotated 批次徽章（仅 super_admin 能拉 /dashboard/admin）
  // B-19：非超管角色禁用此查询，避免 dashboard 加载时弹出"需要角色权限"toast。
  const adminStatsQ = useAdminStats(role === "super_admin");
  const preAnnotatedTotal = adminStatsQ.data?.pre_annotated_batches ?? 0;

  const sections = sectionsForRole(role === "super_admin");
  const visibleSections = sections
    .map((sec) => ({
      ...sec,
      items: sec.items.filter((item) => canAccessPage(item.key)),
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
          {sec.items.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              style={({ isActive }) => ({
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
                textDecoration: "none",
              })}
            >
              <Icon name={item.icon} size={16} style={{ opacity: 0.85, flexShrink: 0 }} />
              <span>{item.label}</span>
              {item.key === "review" && reviewCount > 0 && (
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
              {item.key === "ai-pre" && preAnnotatedTotal > 0 && (
                <span
                  title={`${preAnnotatedTotal} 批 AI 预标完成、待人工接管`}
                  style={{ marginLeft: "auto", display: "inline-flex" }}
                >
                  <Badge variant="ai" style={{ padding: "0 6px", fontSize: 10 }}>
                    {preAnnotatedTotal > 99 ? "99+" : preAnnotatedTotal} 待接管
                  </Badge>
                </span>
              )}
              {item.key === "model-market" && failedTotal > 0 && (
                <span
                  title={`${failedTotal} 条失败预测待处理`}
                  style={{ marginLeft: "auto", display: "inline-flex" }}
                >
                  <Badge
                    variant="danger"
                    style={{ padding: "0 6px", fontSize: 10 }}
                  >
                    {failedTotal > 99 ? "99+" : failedTotal} 失败
                  </Badge>
                </span>
              )}
            </NavLink>
          ))}
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
