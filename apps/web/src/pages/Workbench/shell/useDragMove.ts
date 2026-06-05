import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface FloatingPanelPoint {
  x: number;
  y: number;
}

export interface FloatingPanelSize {
  w: number;
  h: number;
}

const EDGE_MARGIN = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "button,a,input,select,textarea,[role='button'],[data-floating-panel-no-drag]",
    ),
  );
}

export function clampFloatingPosition(
  position: FloatingPanelPoint,
  size: FloatingPanelSize,
): FloatingPanelPoint {
  if (typeof window === "undefined") return position;
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - size.w - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - size.h - EDGE_MARGIN);
  return {
    x: clamp(Math.round(position.x), EDGE_MARGIN, maxX),
    y: clamp(Math.round(position.y), EDGE_MARGIN, maxY),
  };
}

export function useDragMove(opts: {
  position: FloatingPanelPoint;
  size: FloatingPanelSize;
  onChange: (pos: FloatingPanelPoint) => void;
}): { handleProps: HTMLAttributes<HTMLElement>; isDragging: boolean } {
  const { position, size, onChange } = opts;
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 && event.button !== undefined) return;
      if (isInteractiveTarget(event.target)) return;
      const panel = event.currentTarget.closest("[data-floating-panel]");
      const rect = panel?.getBoundingClientRect();
      dragRef.current = {
        dx: event.clientX - (rect?.left ?? position.x),
        dy: event.clientY - (rect?.top ?? position.y),
      };
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setIsDragging(true);
    },
    [position.x, position.y],
  );

  useEffect(() => {
    if (!isDragging) return;

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      onChange(
        clampFloatingPosition(
          { x: event.clientX - drag.dx, y: event.clientY - drag.dy },
          size,
        ),
      );
    };
    const onPointerUp = () => {
      dragRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [isDragging, onChange, size]);

  useEffect(() => {
    const onResize = () => {
      const next = clampFloatingPosition(position, size);
      if (next.x !== position.x || next.y !== position.y) {
        onChange(next);
      }
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [onChange, position, size]);

  return {
    handleProps: { onPointerDown },
    isDragging,
  };
}
