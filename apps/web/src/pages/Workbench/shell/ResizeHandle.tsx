import { useCallback, useRef, useState } from "react";
import styles from "./ResizeHandle.module.css";

interface ResizeHandleProps {
  /** "right" = handle 贴在容器右沿，往右拖增大宽度（左侧栏用）。
   *  "left"  = handle 贴在容器左沿，往左拖增大宽度（右侧栏用）。 */
  side: "left" | "right";
  /** 当前宽度（受控）。 */
  width: number;
  onResize: (next: number) => void;
  min?: number;
  max?: number;
}

/**
 * VS Code 风格 4px 拖拽条：默认透明，hover/拖拽中显示 accent 高亮。
 * 绝对定位贴在容器边沿外侧，不占容器内布局空间。
 */
export function ResizeHandle({ side, width, onResize, min = 200, max = 600 }: ResizeHandleProps) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    startW.current = width;
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX.current;
      const next = side === "right" ? startW.current + delta : startW.current - delta;
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
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width, side, onResize, min, max]);

  const active = hover || dragging;
  const className = [
    styles.handle,
    side === "right" ? styles.handleRight : styles.handleLeft,
    active ? styles.handleActive : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖拽调整宽度"
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={() => onResize(side === "right" ? 260 : 280)}
      className={className}
      title="拖拽调整宽度 · 双击恢复默认"
    />
  );
}
