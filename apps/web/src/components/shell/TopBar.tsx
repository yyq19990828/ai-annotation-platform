import { useEffect, useState } from "react";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { Avatar } from "@/components/ui/Avatar";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import { useAuthStore } from "@/stores/authStore";
import { useTheme, type ThemePref } from "@/hooks/useTheme";
import type { IconName } from "@/components/ui/Icon";
import { NotificationsPopover } from "./NotificationsPopover";
import { PreannotateJobsBadge } from "./PreannotateJobsBadge";
import { CommandPalette } from "@/components/CommandPalette";
import { usePerfHudStore } from "@/components/PerfHud";

interface TopBarProps {
  workspace: string;
  onWorkspaceChange?: () => void;
  /** 窄屏时显示 hamburger 按钮，点击打开 SidebarDrawer。 */
  showHamburger?: boolean;
  onOpenDrawer?: () => void;
}

const spinStyle = `
@keyframes __topbar_spin { to { transform: rotate(360deg); } }
`;

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
      <style>{spinStyle}</style>
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
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexShrink: 0, minWidth: 0 }}>
          {showHamburger && (
            <button
              type="button"
              title="打开导航菜单"
              aria-label="打开导航菜单"
              onClick={onOpenDrawer}
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
              <Icon name="menu" size={16} />
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13, letterSpacing: "0.01em", whiteSpace: "nowrap", flexShrink: 0 }}>
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
              v2.5
            </span>
          </div>
          <div
            onClick={onWorkspaceChange}
            style={{
              display: showHamburger ? "none" : "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px 4px 8px",
              background: "var(--color-bg-sunken)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
              color: "var(--color-fg-muted)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
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

        <div
          style={{
            flex: 1,
            display: showHamburger ? "none" : "flex",
            justifyContent: "center",
            minWidth: 0,
            padding: "0 12px",
          }}
        >
          <SearchInput
            placeholder="搜索项目、任务、数据集、成员..."
            width={360}
            kbd="⌘K"
            onClick={() => setPaletteOpen(true)}
            readOnly
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* 刷新按钮 */}
          <button
            title="刷新"
            onClick={handleRefresh}
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
            <Icon
              name="refresh"
              size={15}
              style={isFetching > 0 ? { animation: "__topbar_spin 0.8s linear infinite" } : undefined}
            />
          </button>

          {/* 主题切换 */}
          <DropdownMenu
            minWidth={160}
            items={themeItems}
            footer={
              theme === "system" ? (
                <div style={{
                  padding: "6px 10px 4px",
                  fontSize: 11,
                  color: "var(--color-fg-subtle)",
                  borderTop: "1px solid var(--color-border)",
                  marginTop: 4,
                }}>
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
                style={{
                  width: 30,
                  height: 30,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: open ? "var(--color-bg-sunken)" : "transparent",
                  border: "1px solid transparent",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg-muted)",
                  cursor: "pointer",
                }}
              >
                <Icon name={themeIcon} size={15} />
              </button>
            )}
          />

          {/* v0.9.11 PerfHud · 性能监控浮窗 toggle (admin only, 快捷键 Ctrl+Shift+P 同步) */}
          {(user?.role === "super_admin" || user?.role === "project_admin") ? (
            <button
              title="性能监控 (Ctrl+Shift+P)"
              onClick={() => usePerfHudStore.getState().toggle()}
              aria-label="切换性能监控浮窗"
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
              <Icon name="activity" size={15} />
            </button>
          ) : null}

          {/* v0.9.8 · 全局预标 job 徽章 (admin only, 0 个时隐身) */}
          <PreannotateJobsBadge />

          {/* 通知按钮（v0.7.6：组件自包含 trigger + popover，TopBar 不再管 open state） */}
          <NotificationsPopover />

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
            <Avatar initial={user?.name?.[0] ?? "?"} size="sm" />
            <div
              style={{
                display: showHamburger ? "none" : "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 500 }}>{user?.name ?? "—"}</span>
              <span style={{ fontSize: 10.5, color: "var(--color-fg-muted)" }}>{user?.role ?? "—"}</span>
            </div>
          </div>
          <button
            title="退出登录"
            onClick={logout}
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
            <Icon name="logout" size={15} />
          </button>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
