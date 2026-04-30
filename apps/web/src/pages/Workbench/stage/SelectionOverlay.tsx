import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Viewport } from "../state/useViewportTransform";
import { classColor } from "./colors";

interface OverlayProps {
  box: { id: string; x: number; y: number; w: number; h: number; cls: string };
  isAi: boolean;
  imgW: number;
  imgH: number;
  vp: Viewport;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
  onChangeClass?: () => void;
}

export function SelectionOverlay({ box, isAi, imgW, imgH, vp, onAccept, onReject, onDelete, onChangeClass }: OverlayProps) {
  const right = (box.x + box.w) * imgW * vp.scale + vp.tx;
  const bottom = (box.y + box.h) * imgH * vp.scale + vp.ty;

  return (
    <div
      style={{
        position: "absolute",
        left: right,
        top: bottom + 4,
        transform: "translateX(-100%)",
        display: "flex", gap: 4,
        background: "white",
        borderRadius: 4,
        padding: 2,
        boxShadow: "var(--shadow-md)",
        zIndex: 20,
        pointerEvents: "auto",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {isAi && onAccept && (
        <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onAccept(); }}>
          <Icon name="check" size={10} />采纳
        </Button>
      )}
      {isAi && onReject && (
        <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onReject(); }}>
          <Icon name="x" size={10} />驳回
        </Button>
      )}
      {!isAi && onChangeClass && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChangeClass(); }}
          title="改类别 (C)"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "3px 8px", fontSize: 11.5,
            background: "var(--color-bg-elev, #fff)",
            border: "1px solid var(--color-border)",
            borderRadius: 3, cursor: "pointer",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 2, background: classColor(box.cls) }} />
          {box.cls}
          <span style={{ color: "var(--color-fg-subtle)", fontSize: 10 }}>改类</span>
        </button>
      )}
      {!isAi && onDelete && (
        <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Icon name="trash" size={10} />删除
        </Button>
      )}
    </div>
  );
}
