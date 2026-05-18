import { useEffect, useState } from "react";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Icon } from "@/components/ui/Icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { Avatar } from "@/components/ui/Avatar";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import { useAuthStore } from "@/stores/authStore";
import { useTheme, type ThemePref } from "@/hooks/useTheme";
import type { IconName } from "@/components/ui/Icon";
import { NotificationsPopover } from "./NotificationsPopover";
import { PreannotateJobsBadge } from "./PreannotateJobsBadge";
import { JobsBell } from "./JobsBell";
import { CommandPalette } from "@/components/CommandPalette";
import { usePerfHudStore } from "@/components/PerfHud";
import styles from "./TopBar.module.css";

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
  const { theme, resolved, setTheme } = useTheme();

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

  const themeIcon: IconName = theme === "system" ? "monitor" : theme === "dark" ? "moon" : "sun";
  const themeTitle =
    theme === "system"
      ? `主题：跟随系统（当前 ${resolved === "dark" ? "夜间" : "日间"}）`
      : theme === "dark"
      ? "主题：夜间"
      : "主题：日间";

  const themeItems: DropdownItem[] = (
    [
      { key: "light", label: "日间", icon: "sun" as IconName },
      { key: "dark", label: "夜间", icon: "moon" as IconName },
      { key: "system", label: "跟随系统", icon: "monitor" as IconName },
    ] as Array<{ key: ThemePref; label: string; icon: IconName }>
  ).map((opt) => ({
    id: opt.key,
    label: opt.label,
    icon: opt.icon,
    active: theme === opt.key,
    onSelect: () => setTheme(opt.key),
  }));

  return (
    <>
      <header className={styles.header}>
        <div className={styles.left}>
          {showHamburger && (
            <button
              type="button"
              title="打开导航菜单"
              aria-label="打开导航菜单"
              onClick={onOpenDrawer}
              className={styles.iconButton}
            >
              <Icon name="menu" size={16} />
            </button>
          )}
          <div className={styles.brand}>
            <div className={styles.brandMark}>
              <div className={styles.brandMarkInner} />
            </div>
            <span>标注中心</span>
            <span className={styles.version}>v2.5</span>
          </div>
          <div
            onClick={onWorkspaceChange}
            className={clsx(styles.workspace, showHamburger && styles.hidden)}
          >
            <span className={styles.workspaceDot} />
            <span>{workspace}</span>
            <Icon name="chevDown" size={12} />
          </div>
        </div>

        <div className={clsx(styles.searchWrap, showHamburger && styles.hidden)}>
          <SearchInput
            placeholder="搜索项目、任务、数据集、成员..."
            width={360}
            kbd="⌘K"
            onClick={() => setPaletteOpen(true)}
            readOnly
          />
        </div>

        <div className={styles.actions}>
          {/* 刷新按钮 */}
          <button
            type="button"
            title="刷新"
            onClick={handleRefresh}
            className={styles.iconButton}
          >
            <Icon
              name="refresh"
              size={15}
              className={isFetching > 0 ? styles.spin : undefined}
            />
          </button>

          {/* 主题切换 */}
          <DropdownMenu
            minWidth={160}
            items={themeItems}
            footer={
              theme === "system" ? (
                <div className={styles.themeFooter}>
                  当前 {resolved === "dark" ? "夜间" : "日间"}（跟随系统）
                </div>
              ) : null
            }
            trigger={({ open, toggle, ref }) => (
              <button
                ref={ref}
                title={themeTitle}
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open}
                className={clsx(styles.iconButton, open && styles.iconButtonActive)}
              >
                <Icon name={themeIcon} size={15} />
              </button>
            )}
          />

          {/* v0.9.11 PerfHud · 性能监控浮窗 toggle (admin only, 快捷键 Ctrl+Shift+P 同步) */}
          {(user?.role === "super_admin" || user?.role === "project_admin") ? (
            <button
              type="button"
              title="性能监控 (Ctrl+Shift+P)"
              onClick={() => usePerfHudStore.getState().toggle()}
              aria-label="切换性能监控浮窗"
              className={styles.iconButton}
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

          <div
            className={styles.user}
          >
            <Avatar initial={user?.name?.[0] ?? "?"} size="sm" />
            <div
              className={clsx(styles.userMeta, showHamburger && styles.hidden)}
            >
              <span className={styles.userName}>{user?.name ?? "—"}</span>
              <span className={styles.userRole}>{user?.role ?? "—"}</span>
            </div>
          </div>
          <button
            type="button"
            title="退出登录"
            onClick={logout}
            className={styles.iconButton}
          >
            <Icon name="logout" size={15} />
          </button>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
