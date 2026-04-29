import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Annotation } from "@/types";
import { classColor } from "./colors";
import { ResizeHandles, type ResizeDirection } from "./ResizeHandles";

interface BoxRendererProps {
  b: Annotation;
  isAi?: boolean;
  selected: boolean;
  /** 编辑态：选中后允许 body drag、resize handles、accept/reject/delete 浮按钮。审核只读时关掉。 */
  editable?: boolean;
  /** diff 模式：用户已采纳的 AI 预测（parent_prediction_id 命中）会被淡化以避免与最终标注堆叠。 */
  faded?: boolean;
  onClick: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
  onMoveStart?: (e: React.PointerEvent) => void;
  onResizeStart?: (dir: ResizeDirection, e: React.PointerEvent) => void;
}

export function BoxRenderer({
  b, isAi, selected, editable = true, faded = false,
  onClick, onAccept, onReject, onDelete, onMoveStart, onResizeStart,
}: BoxRendererProps) {
  const color = classColor(b.cls);
  const isUserSelected = selected && !isAi && editable;

  return (
    <div
      onPointerDown={(e) => {
        // 选中态 + 用户框：左键 drag = move；其它：单击选中
        if (isUserSelected && e.button === 0 && onMoveStart) {
          e.stopPropagation();
          onMoveStart(e);
          return;
        }
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position: "absolute",
        left: b.x * 100 + "%", top: b.y * 100 + "%",
        width: b.w * 100 + "%", height: b.h * 100 + "%",
        border: `${selected ? 2 : 1.5}px ${isAi ? "dashed" : "solid"} ${color}`,
        background: isAi ? color + "15" : color + "12",
        boxShadow: selected ? `0 0 0 1px ${color}, 0 4px 12px ${color}40` : "none",
        cursor: isUserSelected ? "move" : "pointer",
        opacity: faded ? 0.35 : 1,
        zIndex: selected ? 5 : 1,
      }}
    >
      <div style={{
        position: "absolute", top: -22, left: -1,
        background: color, color: "white", fontSize: 10.5,
        padding: "2px 6px", borderRadius: 3, whiteSpace: "nowrap",
        display: "flex", alignItems: "center", gap: 4,
        pointerEvents: "none",
      }}>
        {isAi && <Icon name="sparkles" size={9} />}
        {b.cls}
        {b.conf !== undefined && <span style={{ opacity: 0.85, fontFamily: "var(--font-mono)" }}>{(b.conf * 100).toFixed(0)}</span>}
      </div>
      {isAi && selected && editable && (
        <div onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} style={{ position: "absolute", bottom: -28, right: 0, display: "flex", gap: 4, background: "white", borderRadius: 4, padding: 2, boxShadow: "var(--shadow-md)" }}>
          <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onAccept?.(); }}>
            <Icon name="check" size={10} />采纳
          </Button>
          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onReject?.(); }}>
            <Icon name="x" size={10} />驳回
          </Button>
        </div>
      )}
      {!isAi && selected && editable && (
        <div onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} style={{ position: "absolute", bottom: -28, right: 0, display: "flex", gap: 4, background: "white", borderRadius: 4, padding: 2, boxShadow: "var(--shadow-md)" }}>
          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete?.(); }}>
            <Icon name="trash" size={10} />删除
          </Button>
        </div>
      )}
      {isUserSelected && onResizeStart && (
        <ResizeHandles b={b} onResizeStart={onResizeStart} />
      )}
    </div>
  );
}
