import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

interface SidebarDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 抽屉宽度，默认 240px。 */
  width?: number;
}

/**
 * 窄屏 hamburger 抽屉（v0.5.5 phase 2）：
 * - 从左侧滑入；
 * - 遮罩点击 / Esc / 路由变化自动关闭；
 * - body 滚动锁定；
 * - 通过 Portal 渲染到 document.body，避免 grid 布局影响。
 */
export function SidebarDrawer({ open, onClose, children, width = 240 }: SidebarDrawerProps) {
  const location = useLocation();

  // 路由变化关闭抽屉
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // body 滚动锁
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return createPortal(
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.4)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 220ms ease-out",
          zIndex: 1099,
        }}
      />
      {/* 抽屉本体 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="导航菜单"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "100vh",
          width,
          background: "var(--color-bg-elev)",
          borderRight: "1px solid var(--color-border)",
          boxShadow: open ? "2px 0 12px rgba(0,0,0,0.12)" : "none",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 220ms ease-out",
          zIndex: 1100,
          overflow: "auto",
        }}
      >
        {children}
      </aside>
    </>,
    document.body,
  );
}
