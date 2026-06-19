import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "@/components/ui/Icon";
import { usePermissions } from "@/hooks/usePermissions";
import { useFailedPredictions } from "@/hooks/useFailedPredictions";
import { useAdminStats } from "@/hooks/useDashboard";
import type { PageKey } from "@/types";
import type { IconName } from "@/components/ui/Icon";

const NAV_ITEM_CLASS =
  "flex items-center gap-2.5 rounded-md border border-transparent bg-transparent px-2.5 py-1.5 text-[13px] font-normal text-muted-foreground no-underline cursor-pointer select-none transition-[background-color,border-color,color,box-shadow,transform] duration-200 hover:-translate-y-px hover:bg-accent hover:text-foreground active:translate-y-0 active:scale-[0.99] focus-visible:ring-[3px] focus-visible:ring-ring/20";
const NAV_ITEM_ACTIVE_CLASS =
  "border-border bg-card font-medium text-foreground surface-shadow-sm";
const BADGE_BASE =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-[10px] font-medium";
const BADGE_AI = "bg-violet-500/10 text-violet-600 dark:text-violet-400";
const BADGE_DANGER = "bg-rose-500/10 text-rose-600 dark:text-rose-400";

interface SidebarProps {
  reviewCount: number;
}

interface NavItem {
  key: PageKey;
  path: string;
  icon: IconName;
  label: string;
  badge?: string;
}

const sectionsForRole = (isSuperAdmin: boolean): { label: string; items: NavItem[] }[] => [
  {
    label: "工作区",
    items: [
      ...(isSuperAdmin
        ? [
            { key: "dashboard" as PageKey, path: "/dashboard", icon: "dashboard" as IconName, label: "平台概览" },
            { key: "dashboard" as PageKey, path: "/projects", icon: "layers" as IconName, label: "项目总览" },
          ]
        : [{ key: "dashboard" as PageKey, path: "/dashboard", icon: "dashboard" as IconName, label: "项目总览" }]),
      { key: "annotate", path: "/annotate", icon: "target", label: "标注工作" },
      { key: "review", path: "/review", icon: "check", label: "质检审核" },
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
      { key: "datasets", path: "/datasets", icon: "layers", label: "数据集" },
      { key: "storage", path: "/storage", icon: "db", label: "存储管理" },
      // v0.10.14 · E2 · 项目模板库
      { key: "project-templates", path: "/project-templates", icon: "book", label: "项目模板" },
      { key: "users", path: "/users", icon: "users", label: "用户与权限" },
      { key: "audit", path: "/audit", icon: "shield", label: "审计日志" },
      // v0.12.3 · 标注员绩效 + 离线分析（此前仅 Dashboard 卡片 / 直达 URL 可达，补 Sidebar 入口）
      // v0.12.6 (A3) · 标注员绩效对 project_admin 开放（项目级范围），由 canAccessPage 过滤；离线分析仍超管专属。
      { key: "admin-people" as PageKey, path: "/admin/people", icon: "users" as IconName, label: "标注员绩效" },
      ...(isSuperAdmin ? [{ key: "admin-analytics" as PageKey, path: "/admin/analytics", icon: "layers" as IconName, label: "离线分析" }] : []),
      ...(isSuperAdmin ? [{ key: "admin-health" as PageKey, path: "/admin/health", icon: "activity" as IconName, label: "系统健康" }] : []),
      ...(isSuperAdmin ? [{ key: "bugs" as PageKey, path: "/bugs", icon: "bug" as IconName, label: "BUG反馈" }] : []),
      // v0.12.3 · 我的绩效（所有角色自助自视）
      { key: "my-performance", path: "/me/performance", icon: "activity", label: "我的绩效" },
      { key: "settings", path: "/settings", icon: "settings", label: "设置" },
    ],
  },
];

export function Sidebar({ reviewCount }: SidebarProps) {
  const { canAccessPage, hasAnyPermission, role } = usePermissions();
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
    <aside className="surface-shadow-sm flex flex-col gap-0.5 overflow-y-auto border-r border-border bg-card/80 px-2 py-2.5">
      {visibleSections.map((sec) => (
        <div key={sec.label}>
          <div className="px-2.5 pb-1.5 pt-3.5 text-[11px] font-medium tracking-[0.02em] text-muted-foreground">
            {sec.label}
          </div>
          {sec.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => clsx(NAV_ITEM_CLASS, isActive && NAV_ITEM_ACTIVE_CLASS)}
            >
              <Icon name={item.icon} size={16} className="shrink-0 opacity-[0.85]" />
              <span>{item.label}</span>
              {item.key === "review" && reviewCount > 0 && (
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {reviewCount}
                </span>
              )}
              {item.badge && (
                <span className={clsx(BADGE_BASE, BADGE_AI, "ml-auto")}>
                  {item.badge}
                </span>
              )}
              {/* AI 预标注：待接管 + 失败预测两枚徽章同挂此项（失败预测已迁到 /ai-pre/jobs?status=failed，
                  此前误挂在「模型市场」上）。 */}
              {item.key === "ai-pre" && (preAnnotatedTotal > 0 || failedTotal > 0) && (
                <span className="ml-auto inline-flex gap-1">
                  {preAnnotatedTotal > 0 && (
                    <span
                      title={`${preAnnotatedTotal} 批 AI 预标完成、待人工接管`}
                      className={clsx(BADGE_BASE, BADGE_AI)}
                    >
                      {preAnnotatedTotal > 99 ? "99+" : preAnnotatedTotal} 待接管
                    </span>
                  )}
                  {failedTotal > 0 && (
                    <span
                      title={`${failedTotal} 条失败预测待处理`}
                      className={clsx(BADGE_BASE, BADGE_DANGER)}
                    >
                      {failedTotal > 99 ? "99+" : failedTotal} 失败
                    </span>
                  )}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      ))}

      <div className="flex-1" />
    </aside>
  );
}
