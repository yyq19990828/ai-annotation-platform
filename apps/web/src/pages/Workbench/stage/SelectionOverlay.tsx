import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Viewport } from "../state/useViewportTransform";

interface OverlayProps {
  box: { x: number; y: number; w: number; h: number };
  isAi: boolean;
  imgW: number;
  imgH: number;
  vp: Viewport;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
}

export function SelectionOverlay({ box, isAi, imgW, imgH, vp, onAccept, onReject, onDelete }: OverlayProps) {
  // project box bottom-right corner from image-normalized → container pixels
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
      {!isAi && onDelete && (
        <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Icon name="trash" size={10} />删除
        </Button>
      )}
    </div>
  );
}
