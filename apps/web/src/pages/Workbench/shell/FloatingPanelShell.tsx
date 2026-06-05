import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Icon } from "@/components/ui/Icon";
import {
  clampFloatingPosition,
  useDragMove,
  type FloatingPanelBounds,
  type FloatingPanelPoint,
  type FloatingPanelSize,
} from "./useDragMove";
import styles from "./FloatingPanelShell.module.css";

export interface FloatingPanelRect extends FloatingPanelPoint, FloatingPanelSize {}

interface FloatingPanelShellProps {
  title: string;
  position: FloatingPanelRect;
  onPositionChange: (patch: Partial<FloatingPanelRect>) => void;
  minSize: FloatingPanelSize;
  maxSize: FloatingPanelSize;
  bounds?: FloatingPanelBounds | null;
  onMergeBack?: () => void;
  onClose?: () => void;
  onCollapse?: () => void;
  variant?: "default" | "no-merge";
  className?: string;
  children: ReactNode;
}

type FloatingPanelStyle = CSSProperties & {
  "--floating-panel-x": string;
  "--floating-panel-y": string;
  "--floating-panel-w": string;
  "--floating-panel-h": string;
};

function clampSize(
  size: FloatingPanelSize,
  position: FloatingPanelPoint,
  minSize: FloatingPanelSize,
  maxSize: FloatingPanelSize,
  bounds?: FloatingPanelBounds | null,
): FloatingPanelSize {
  const margin = bounds ? (bounds.margin ?? 0) : 24;
  const right = bounds?.right ?? (typeof window === "undefined" ? maxSize.w : window.innerWidth);
  const bottom = bounds?.bottom ?? (typeof window === "undefined" ? maxSize.h : window.innerHeight);
  const maxW = Math.max(minSize.w, Math.min(maxSize.w, right - margin - position.x));
  const maxH = Math.max(minSize.h, Math.min(maxSize.h, bottom - margin - position.y));
  return {
    w: Math.max(minSize.w, Math.min(maxW, Math.round(size.w))),
    h: Math.max(minSize.h, Math.min(maxH, Math.round(size.h))),
  };
}

export function FloatingPanelShell({
  title,
  position,
  onPositionChange,
  minSize,
  maxSize,
  bounds,
  onMergeBack,
  onClose,
  onCollapse,
  variant = "default",
  className,
  children,
}: FloatingPanelShellProps) {
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const size = useMemo(
    () => ({ w: position.w, h: position.h }),
    [position.h, position.w],
  );
  const drag = useDragMove({
    position,
    size,
    bounds,
    onChange: onPositionChange,
  });

  useEffect(() => {
    const clampPanel = () => {
      const clampedPosition = clampFloatingPosition(position, size, bounds);
      const clampedSize = clampSize(size, clampedPosition, minSize, maxSize, bounds);
      const patch: Partial<FloatingPanelRect> = {};
      if (clampedPosition.x !== position.x) patch.x = clampedPosition.x;
      if (clampedPosition.y !== position.y) patch.y = clampedPosition.y;
      if (clampedSize.w !== position.w) patch.w = clampedSize.w;
      if (clampedSize.h !== position.h) patch.h = clampedSize.h;
      if (Object.keys(patch).length > 0) onPositionChange(patch);
    };
    clampPanel();
    window.addEventListener("resize", clampPanel);
    return () => window.removeEventListener("resize", clampPanel);
  }, [bounds, maxSize, minSize, onPositionChange, position, size]);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 && event.button !== undefined) return;
      resizeRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startW: position.w,
        startH: position.h,
      };
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setIsResizing(true);
    },
    [position.h, position.w],
  );

  useEffect(() => {
    if (!isResizing) return;

    const onPointerMove = (event: PointerEvent) => {
      const resizing = resizeRef.current;
      if (!resizing) return;
      const next = clampSize(
        {
          w: resizing.startW + event.clientX - resizing.startX,
          h: resizing.startH + event.clientY - resizing.startY,
        },
        position,
        minSize,
        maxSize,
        bounds,
      );
      onPositionChange(next);
    };
    const onPointerUp = () => {
      resizeRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [bounds, isResizing, maxSize, minSize, onPositionChange, position]);

  return (
    <section
      data-floating-panel
      className={[
        styles.shell,
        drag.isDragging && styles.dragging,
        isResizing && styles.resizing,
        className,
      ].filter(Boolean).join(" ")}
      // eslint-disable-next-line no-restricted-syntax -- 浮窗位置/尺寸来自用户拖拽状态，经 CSS 变量注入。
      style={
        {
          "--floating-panel-x": `${position.x}px`,
          "--floating-panel-y": `${position.y}px`,
          "--floating-panel-w": `${position.w}px`,
          "--floating-panel-h": `${position.h}px`,
        } as FloatingPanelStyle
      }
    >
      <div className={styles.header} {...drag.handleProps}>
        <div className={styles.titleGroup}>
          <Icon name="move" size={14} />
          <span className={styles.title}>{title}</span>
        </div>
        <div
          className={styles.actions}
          data-floating-panel-no-drag
          onPointerDown={(event) => event.stopPropagation()}
        >
          {onCollapse && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onCollapse}
              aria-label="收起浮窗"
              title="收起"
            >
              <Icon name="chevDown" size={14} />
            </button>
          )}
          {onMergeBack && variant !== "no-merge" && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onMergeBack}
              aria-label="合并回侧栏"
              title="合并回侧栏"
            >
              <Icon name="pictureInPicture" size={14} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onClose}
              aria-label="关闭浮窗"
              title="关闭"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.content}>{children}</div>
      <button
        type="button"
        className={styles.resizeHandle}
        onPointerDown={onResizePointerDown}
        aria-label="调整浮窗尺寸"
      />
    </section>
  );
}
