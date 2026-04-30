import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Annotation } from "@/types";
import { classColor } from "./colors";

interface BoxListItemProps {
  b: Annotation;
  isAi?: boolean;
  selected: boolean;
  /** 像素维度。null 时显示 — 占位（dataset_items 尚未回填 width/height）。 */
  imageWidth: number | null;
  imageHeight: number | null;
  onSelect: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
  onChangeClass?: () => void;
}

export function BoxListItem({
  b, isAi, selected, imageWidth, imageHeight,
  onSelect, onAccept, onReject, onDelete, onChangeClass,
}: BoxListItemProps) {
  const color = classColor(b.cls);
  const dimsText = imageWidth && imageHeight
    ? `(${Math.round(b.x * imageWidth)}, ${Math.round(b.y * imageHeight)}) · ${Math.round(b.w * imageWidth)}×${Math.round(b.h * imageHeight)}`
    : `${(b.w * 100).toFixed(1)}% × ${(b.h * 100).toFixed(1)}%`;
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "6px 8px", borderRadius: "var(--radius-md)", cursor: "pointer",
        background: selected ? "var(--color-bg-sunken)" : "transparent",
        border: "1px solid " + (selected ? "var(--color-border-strong)" : "transparent"),
        marginBottom: 2,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "0 0 8px" }} />
        <span style={{ fontWeight: 500 }}>{b.cls}</span>
        {isAi ? (
          <Badge variant="ai" style={{ fontSize: 9.5, padding: "1px 5px", marginLeft: "auto" }}>
            <Icon name="sparkles" size={8} />{(b.conf * 100).toFixed(0)}%
          </Badge>
        ) : (
          <Badge variant={b.source === "prediction_based" ? "default" : "accent"} style={{ fontSize: 9.5, padding: "1px 5px", marginLeft: "auto" }}>
            {b.source === "prediction_based" ? "AI 采纳" : "手动"}
          </Badge>
        )}
      </div>
      <div className="mono" style={{ fontSize: 10, color: "var(--color-fg-subtle)", marginTop: 3, paddingLeft: 14 }}>
        {dimsText}
      </div>
      {selected && (
        <div style={{ display: "flex", gap: 4, marginTop: 6, paddingLeft: 14 }}>
          {isAi ? (
            <>
              <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onAccept?.(); }} style={{ flex: 1 }}>采纳</Button>
              <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onReject?.(); }} style={{ flex: 1 }}>驳回</Button>
            </>
          ) : (
            <>
              {onChangeClass && (
                <Button size="sm" onClick={(e) => { e.stopPropagation(); onChangeClass(); }} style={{ flex: 1 }} title="改类别 (C)">
                  改类
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete?.(); }} style={{ flex: 1 }}>
                <Icon name="trash" size={10} />删除
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
