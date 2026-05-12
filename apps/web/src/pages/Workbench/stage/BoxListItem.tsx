import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Annotation } from "@/types";
import { classColor } from "./colors";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}

function frameRange(frames: number[]): string {
  if (frames.length === 0) return "无帧";
  const min = Math.min(...frames);
  const max = Math.max(...frames);
  return min === max ? `F${min}` : `F${min}-F${max}`;
}

function rectText(
  x: number,
  y: number,
  w: number,
  h: number,
  imageWidth: number | null,
  imageHeight: number | null,
): string {
  if (imageWidth && imageHeight) {
    return `(${Math.round(x * imageWidth)}, ${Math.round(y * imageHeight)}) · ${Math.round(w * imageWidth)}×${Math.round(h * imageHeight)}`;
  }
  return `${pct(w)} × ${pct(h)}`;
}

function annotationToolMeta(
  b: Annotation,
  imageWidth: number | null,
  imageHeight: number | null,
): { label: string; detail: string } {
  const geometry = b.geometry;
  if (!geometry) {
    return {
      label: b.polygon ? "多边形" : "矩形框",
      detail: rectText(b.x, b.y, b.w, b.h, imageWidth, imageHeight),
    };
  }

  if (geometry.type === "bbox") {
    return {
      label: "矩形框",
      detail: rectText(geometry.x, geometry.y, geometry.w, geometry.h, imageWidth, imageHeight),
    };
  }
  if (geometry.type === "video_bbox") {
    return {
      label: "视频矩形框",
      detail: `F${geometry.frame_index} · ${rectText(geometry.x, geometry.y, geometry.w, geometry.h, imageWidth, imageHeight)}`,
    };
  }
  if (geometry.type === "video_track") {
    const frames = geometry.keyframes.map((kf) => kf.frame_index);
    const absent = geometry.keyframes.filter((kf) => kf.absent).length;
    const occluded = geometry.keyframes.filter((kf) => kf.occluded).length;
    return {
      label: "轨迹",
      detail: `${shortId(geometry.track_id)} · ${geometry.keyframes.length} 关键帧 · ${frameRange(frames)}${absent ? ` · ${absent} 消失` : ""}${occluded ? ` · ${occluded} 遮挡` : ""}`,
    };
  }
  if (geometry.type === "polygon") {
    return {
      label: "多边形",
      detail: `${geometry.points.length} 点${geometry.holes?.length ? ` · ${geometry.holes.length} 内环` : ""}`,
    };
  }
  return {
    label: "多连通域",
    detail: `${geometry.polygons.length} 区域 · ${geometry.polygons.reduce((sum, p) => sum + p.points.length, 0)} 点`,
  };
}

const rowActionButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  padding: 0,
  justifyContent: "center",
  borderRadius: 8,
};

interface BoxListItemProps {
  b: Annotation;
  isAi?: boolean;
  selected: boolean;
  /** dimmed 时整行半透明 + "已被覆盖" tag（IoU 去重）。 */
  dimmed?: boolean;
  /** 像素维度。null 时显示 — 占位（dataset_items 尚未回填 width/height）。 */
  imageWidth: number | null;
  imageHeight: number | null;
  onSelect: (e?: { shiftKey?: boolean }) => void;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
  onChangeClass?: () => void;
}

export function BoxListItem({
  b, isAi, selected, dimmed = false, imageWidth, imageHeight,
  onSelect, onAccept, onReject, onDelete, onChangeClass,
}: BoxListItemProps) {
  const color = classColor(b.cls);
  const toolMeta = annotationToolMeta(b, imageWidth, imageHeight);
  return (
    <div
      onClick={(e) => onSelect({ shiftKey: e.shiftKey })}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 8,
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: 8,
        cursor: "pointer",
        background: selected ? "color-mix(in oklab, var(--color-accent) 12%, var(--color-bg-elev))" : "transparent",
        border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
        marginBottom: 8,
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          gap: "4px 8px",
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <span style={{ gridRow: "1 / span 2", width: 10, height: 10, borderRadius: 999, background: color }} />
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <b style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.cls}</b>
          {isAi ? (
            <Badge variant="ai" style={{ fontSize: 10, padding: "1px 6px" }}>
              <Icon name="sparkle" size={8} />{(b.conf * 100).toFixed(0)}%
            </Badge>
          ) : (
            <Badge variant={b.source === "prediction_based" ? "default" : "accent"} style={{ fontSize: 10, padding: "1px 6px" }}>
              {b.source === "prediction_based" ? "AI 采纳" : "手动"}
            </Badge>
          )}
          {dimmed && (
            <span
              style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 6,
                background: "var(--color-bg-sunken)", color: "var(--color-fg-subtle)",
                border: "1px solid var(--color-border)",
              }}
              title="已被同类用户框（IoU > 0.7）覆盖"
            >已被覆盖</span>
          )}
        </div>
        <div
          className="mono"
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            minWidth: 0,
            fontSize: 11,
            color: "var(--color-fg-muted)",
          }}
        >
          <span
            style={{
              flex: "0 0 auto",
              padding: "1px 5px",
              borderRadius: 4,
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-sunken)",
              color: "var(--color-fg-muted)",
              fontFamily: "inherit",
            }}
          >
            {toolMeta.label}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {toolMeta.detail}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {isAi ? (
          <>
            {onAccept && (
              <Button
                variant="primary"
                size="sm"
                title="采纳预测"
                aria-label="采纳预测"
                onClick={(e) => { e.stopPropagation(); onAccept(); }}
                style={rowActionButtonStyle}
              >
                <Icon name="check" size={14} />
              </Button>
            )}
            {onReject && (
              <Button
                variant="danger"
                size="sm"
                title="驳回预测"
                aria-label="驳回预测"
                onClick={(e) => { e.stopPropagation(); onReject(); }}
                style={rowActionButtonStyle}
              >
                <Icon name="x" size={14} />
              </Button>
            )}
          </>
        ) : (
          <>
            {onChangeClass && (
              <Button
                size="sm"
                title="修改类别"
                aria-label="修改类别"
                onClick={(e) => { e.stopPropagation(); onChangeClass(); }}
                style={rowActionButtonStyle}
              >
                <Icon name="tag" size={14} />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="danger"
                size="sm"
                title="删除标注"
                aria-label="删除标注"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                style={rowActionButtonStyle}
              >
                <Icon name="trash" size={14} />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
