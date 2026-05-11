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
        padding: "6px 8px", borderRadius: "var(--radius-md)", cursor: "pointer",
        background: selected ? "var(--color-bg-sunken)" : "transparent",
        border: "1px solid " + (selected ? "var(--color-border-strong)" : "transparent"),
        marginBottom: 2,
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "0 0 8px" }} />
        <span style={{ fontWeight: 500 }}>{b.cls}</span>
        {dimmed && (
          <span
            style={{
              fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
              background: "var(--color-bg-sunken)", color: "var(--color-fg-subtle)",
              border: "1px solid var(--color-border)",
            }}
            title="已被同类用户框（IoU > 0.7）覆盖"
          >已被覆盖</span>
        )}
        {isAi ? (
          <Badge variant="ai" style={{ fontSize: 9.5, padding: "1px 5px", marginLeft: "auto" }}>
            <Icon name="sparkle" size={8} />{(b.conf * 100).toFixed(0)}%
          </Badge>
        ) : (
          <Badge variant={b.source === "prediction_based" ? "default" : "accent"} style={{ fontSize: 9.5, padding: "1px 5px", marginLeft: "auto" }}>
            {b.source === "prediction_based" ? "AI 采纳" : "手动"}
          </Badge>
        )}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--color-fg-subtle)",
          marginTop: 4,
          paddingLeft: 14,
          display: "flex",
          gap: 6,
          alignItems: "center",
          minWidth: 0,
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
