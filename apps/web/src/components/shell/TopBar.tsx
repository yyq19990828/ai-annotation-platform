import { useEffect, useState } from "react";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Icon } from "@/components/ui/Icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { Avatar } from "@/components/ui/Avatar";
import { useAuthStore } from "@/stores/authStore";
import { useTheme } from "@/hooks/useTheme";
import type { IconName } from "@/components/ui/Icon";
import { NotificationsPopover } from "./NotificationsPopover";
import { PreannotateJobsBadge } from "./PreannotateJobsBadge";
import { JobsBell } from "./JobsBell";
import { CommandPalette } from "@/components/CommandPalette";
import { usePerfHudStore } from "@/components/PerfHud";

const ICON_BTN_CLASS =
  "inline-flex size-[30px] cursor-pointer appearance-none items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground";

interface TopBarProps {
  workspace: string;
  onWorkspaceChange?: () => void;
  /** 窄屏时显示 hamburger 按钮，点击打开 SidebarDrawer。 */
  showHamburger?: boolean;
  onOpenDrawer?: () => void;
}

export function TopBar({ workspace, onWorkspaceChange, showHamburger = false, onOpenDrawer }: TopBarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const qc = useQueryClient();
  const isFetching = useIsFetching();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { resolved, setTheme } = useTheme();

  // v0.7.2 · 全局 ⌘K / Ctrl+K 触发命令搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        // 在 input/textarea/contenteditable 内不拦截系统快捷键
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleRefresh = () => {
    qc.invalidateQueries();
  };

  const nextTheme = resolved === "dark" ? "light" : "dark";
  const themeIcon: IconName = nextTheme === "dark" ? "moon" : "sun";
  const themeActionLabel = nextTheme === "dark" ? "切到夜间" : "切到日间";
  const themeTitle = `当前${resolved === "dark" ? "夜间" : "日间"}，${themeActionLabel}`;

  return (
    <>
      <header className="z-10 col-[1/-1] flex items-center justify-between border-b border-border bg-card px-4">
        <div className="flex min-w-0 shrink-0 items-center gap-6">
          {showHamburger && (
            <button
              type="button"
              title="打开导航菜单"
              aria-label="打开导航菜单"
              onClick={onOpenDrawer}
              className={ICON_BTN_CLASS}
            >
              <Icon name="menu" size={16} />
            </button>
          )}
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-semibold tracking-[0.01em]">
            <div className="relative size-[22px] overflow-hidden rounded-md bg-gradient-to-br from-brand to-violet-500">
              <div className="absolute inset-1 rounded-[3px] border-[1.5px] border-white/85" />
            </div>
            <span>标注中心</span>
            <span className="ml-1 text-[11px] font-normal text-muted-foreground">v2.5</span>
          </div>
          <div
            onClick={onWorkspaceChange}
            className={clsx(
              "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-muted py-1 pl-2 pr-2.5 text-xs text-muted-foreground",
              showHamburger && "hidden",
            )}
          >
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span>{workspace}</span>
            <Icon name="chevDown" size={12} />
          </div>
        </div>

        <div className={clsx("flex min-w-0 flex-1 justify-center px-3", showHamburger && "hidden")}>
          <SearchInput
            placeholder="搜索项目、任务、数据集、成员..."
            width={360}
            kbd="⌘K"
            onClick={() => setPaletteOpen(true)}
            readOnly
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* 刷新按钮 */}
          <button
            type="button"
            title="刷新"
            onClick={handleRefresh}
            className={ICON_BTN_CLASS}
          >
            <Icon
              name="refresh"
              size={15}
              className={isFetching > 0 ? "animate-spin" : undefined}
            />
          </button>

          {/* 主题切换 */}
          <button
            type="button"
            title={themeTitle}
            aria-label={themeTitle}
            onClick={() => setTheme(nextTheme)}
            className={clsx(ICON_BTN_CLASS, "text-foreground")}
          >
            <Icon name={themeIcon} size={15} />
          </button>

          {/* v0.9.11 PerfHud · 性能监控浮窗 toggle (admin only, 快捷键 Ctrl+Shift+P 同步) */}
          {(user?.role === "super_admin" || user?.role === "project_admin") ? (
            <button
              type="button"
              title="性能监控 (Ctrl+Shift+P)"
              onClick={() => usePerfHudStore.getState().toggle()}
              aria-label="切换性能监控浮窗"
              className={ICON_BTN_CLASS}
            >
              <Icon name="activity" size={15} />
            </button>
          ) : null}

          {/* v0.9.8 · 全局预标 job 徽章 (admin only, 0 个时隐身) */}
          <PreannotateJobsBadge />

          {/* v0.10.16 · 后台异步任务铃铛（all users, polling /async-jobs） */}
          <JobsBell />

          {/* 通知按钮（v0.7.6：组件自包含 trigger + popover，TopBar 不再管 open state） */}
          <NotificationsPopover />

          <div className="flex cursor-pointer items-center gap-2 rounded-lg py-1 pl-1 pr-2.5">
            <Avatar initial={user?.name?.[0] ?? "?"} size="sm" />
            <div
              className={clsx(
                "flex flex-col items-start leading-[1.2] whitespace-nowrap",
                showHamburger && "hidden",
              )}
            >
              <span className="text-xs font-medium">{user?.name ?? "—"}</span>
              <span className="text-[10.5px] text-muted-foreground">{user?.role ?? "—"}</span>
            </div>
          </div>
          <button
            type="button"
            title="退出登录"
            onClick={logout}
            className={ICON_BTN_CLASS}
          >
            <Icon name="logout" size={15} />
          </button>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
