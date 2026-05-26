import { useCallback, useRef, useState } from "react";
import styles from "./ResizeHandle.module.css";

interface ResizeHandleProps {
  /** "right" = handle 贴在容器右沿，往右拖增大宽度（左侧栏用）。
   *  "left"  = handle 贴在容器左沿，往左拖增大宽度（右侧栏用）。
   *  "top" = handle 贴在容器顶沿，往上拖增大高度（下方面板用）。
   *  "bottom" = handle 贴在容器底沿，往下拖增大高度（上下分段用，v0.11.1）。 */
  side: "left" | "right" | "top" | "bottom";
  /** 当前尺寸（受控）：水平方向是宽度，垂直方向（side="bottom"）是高度。 */
  width: number;
  onResize: (next: number) => void;
  min?: number;
  max?: number;
  /** 双击恢复的默认尺寸（不传时按 side 取内置默认）。 */
  resetTo?: number;
}

/**
 * VS Code 风格 拖拽条：默认透明，hover/拖拽中显示 accent 高亮。
 * 绝对定位贴在容器边沿外侧，不占容器内布局空间。
 */
export function ResizeHandle({ side, width, onResize, min = 200, max = 600, resetTo }: ResizeHandleProps) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);
  const startW = useRef(0);

  const vertical = side === "top" || side === "bottom";

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    start.current = vertical ? e.clientY : e.clientX;
    startW.current = width;
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      const pos = vertical ? ev.clientY : ev.clientX;
      const delta = pos - start.current;
      const next = side === "left" || side === "top" ? startW.current - delta : startW.current + delta;
      onResize(Math.max(min, Math.min(max, next)));
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = vertical ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  }, [width, side, vertical, onResize, min, max]);

  const active = hover || dragging;
  const sideClass =
    side === "right" ? styles.handleRight
    : side === "left" ? styles.handleLeft
    : side === "top" ? styles.handleTop
    : styles.handleBottom;
  const className = [
    styles.handle,
    sideClass,
    active ? styles.handleActive : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-label="拖拽调整尺寸"
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={() => onResize(resetTo ?? (side === "right" ? 260 : 280))}
      className={className}
      title="拖拽调整尺寸 · 双击恢复默认"
    />
  );
}
