import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { usePermissions } from "@/hooks/usePermissions";
import { useFailedPredictions } from "@/hooks/useFailedPredictions";
import { useAdminStats } from "@/hooks/useDashboard";
import type { PageKey } from "@/types";
import type { IconName } from "@/components/ui/Icon";
import styles from "./Sidebar.module.css";

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
      // v0.10.14 · E2 · 项目模板库
      { key: "project-templates", path: "/project-templates", icon: "book", label: "项目模板" },
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
      ...(isSuperAdmin ? [{ key: "bugs" as PageKey, path: "/bugs", icon: "bug" as IconName, label: "BUG反馈" }] : []),
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
    <aside className={styles.sidebar}>
      {visibleSections.map((sec) => (
        <div key={sec.label}>
          <div className={styles.sectionLabel}>
            {sec.label}
          </div>
          {sec.items.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              className={({ isActive }) => clsx(styles.navItem, isActive && styles.navItemActive)}
            >
              <Icon name={item.icon} size={16} className={styles.navIcon} />
              <span>{item.label}</span>
              {item.key === "review" && reviewCount > 0 && (
                <span className={styles.navCount}>
                  {reviewCount}
                </span>
              )}
              {item.count && (
                <span className={styles.navCount}>
                  {item.count}
                </span>
              )}
              {item.badge && (
                <span className={clsx(styles.badge, styles.badgeAi, styles.navBadge)}>
                  {item.badge}
                </span>
              )}
              {item.key === "ai-pre" && preAnnotatedTotal > 0 && (
                <span
                  title={`${preAnnotatedTotal} 批 AI 预标完成、待人工接管`}
                  className={styles.navBadgeWrap}
                >
                  <span className={clsx(styles.badge, styles.badgeAi)}>
                    {preAnnotatedTotal > 99 ? "99+" : preAnnotatedTotal} 待接管
                  </span>
                </span>
              )}
              {item.key === "model-market" && failedTotal > 0 && (
                <span
                  title={`${failedTotal} 条失败预测待处理`}
                  className={styles.navBadgeWrap}
                >
                  <span className={clsx(styles.badge, styles.badgeDanger)}>
                    {failedTotal > 99 ? "99+" : failedTotal} 失败
                  </span>
                </span>
              )}
            </NavLink>
          ))}
        </div>
      ))}

      <div className={styles.spacer} />

      {showAiQuota && (
        <div className={styles.aiQuota}>
          <div className={styles.aiQuotaHeader}>
            <Icon name="sparkles" size={13} className={styles.aiQuotaIcon} />
            <span className={styles.aiQuotaTitle}>AI 配额</span>
          </div>
          <div className={styles.aiQuotaText}>
            本月已用 6,842 / 20,000 次
          </div>
          <ProgressBar value={34} color="var(--color-ai)" />
        </div>
      )}
    </aside>
  );
}
