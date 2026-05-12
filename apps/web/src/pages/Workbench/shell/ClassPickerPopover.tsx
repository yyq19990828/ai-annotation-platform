import { useEffect, useRef } from "react";
import type { Viewport } from "../state/useViewportTransform";
import { ClassPalette, shortcutForIndex } from "./ClassPalette";

type Geom = { x: number; y: number; w: number; h: number };
type FixedAnchor = { left: number; top: number };
export type ClassPickerCancelReason = "escape" | "outside";

type CommonProps = {
  classes: string[];
  recent: string[];
  defaultClass: string;
  title?: string;
  onPick: (cls: string) => void;
  onCancel: (reason: ClassPickerCancelReason) => void;
};

type ImagePositionProps = CommonProps & {
  position?: "image";
  geom: Geom;
  imgW: number;
  imgH: number;
  vp: Viewport;
};

type FixedPositionProps = CommonProps & {
  position: "fixed";
  anchor: FixedAnchor;
};

type ClassPickerPopoverProps = ImagePositionProps | FixedPositionProps;

/**
 * 画框完成后的类别选择 popover。
 * - image 模式锚定到框左下角；fixed 模式使用调用方给出的 viewport 坐标
 * - 数字 1-9 / 字母 a-z 直选；Enter 默认 default；Esc 取消；点外部取消
 */
export function ClassPickerPopover({
  classes, recent, defaultClass, title = "选择类别", onPick, onCancel, ...positionProps
}: ClassPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  const isFixed = positionProps.position === "fixed";
  // image 模式：框左下角（容器坐标）；fixed 模式：调用方传 viewport/client 坐标。
  const left = isFixed
    ? positionProps.anchor.left
    : (positionProps.geom.x * positionProps.imgW * positionProps.vp.scale + positionProps.vp.tx);
  const top = isFixed
    ? positionProps.anchor.top
    : ((positionProps.geom.y + positionProps.geom.h) * positionProps.imgH * positionProps.vp.scale + positionProps.vp.ty + 6);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.key !== "Escape" && e.key !== "Enter") {
        return; // 让搜索框正常输入
      }
      if (e.key === "Escape") { e.preventDefault(); onCancel("escape"); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const fallback = defaultClass || classes[0];
        if (fallback) onPick(fallback);
        return;
      }
      // 数字 1-9
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (classes[idx]) { e.preventDefault(); onPick(classes[idx]); }
        return;
      }
      // 字母 a-z (映射到 classes[9..])
      if (/^[a-z]$/i.test(e.key)) {
        const letterIdx = e.key.toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
        const idx = 9 + letterIdx;
        if (classes[idx]) { e.preventDefault(); onPick(classes[idx]); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [classes, defaultClass, onPick, onCancel]);

  // click outside to cancel
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel("outside");
    };
    // 延迟绑定，避免捕获到落框那次 mouseup
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onCancel]);

  return (
    <div
      ref={ref}
      data-testid="class-picker-popover"
      style={{
        position: isFixed ? "fixed" : "absolute",
        left,
        top,
        minWidth: 220,
        maxWidth: 280,
        maxHeight: 360,
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-lg)",
        padding: 10,
        zIndex: 30,
        overflowY: "auto",
        pointerEvents: "auto",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 10, color: "var(--color-fg-subtle)" }}>
          Enter ↵ 默认 · Esc 取消
        </div>
      </div>
      <ClassPalette
        classes={classes}
        recent={recent}
        activeClass={defaultClass}
        onPick={onPick}
        dense
        enableSearch={classes.length > 9}
      />
      {classes.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--color-fg-subtle)", padding: 8, textAlign: "center" }}>
          该项目尚未配置类别
        </div>
      )}
      {classes.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--color-fg-subtle)", textAlign: "center" }}>
          快捷键: {shortcutForIndex(0)}…{shortcutForIndex(Math.min(classes.length - 1, 34))}
        </div>
      )}
    </div>
  );
}
