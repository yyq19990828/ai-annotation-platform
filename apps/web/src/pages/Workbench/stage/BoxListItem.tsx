import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Annotation } from "@/types";
import { classColor, displayClassName } from "./colors";
import styles from "./BoxListItem.module.css";

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
  if (geometry.type === "rotated_bbox") {
    return {
      label: "旋转框",
      detail: `${(geometry.w * 100).toFixed(0)}% × ${(geometry.h * 100).toFixed(0)}% · ${geometry.angle.toFixed(0)}°`,
    };
  }
  return {
    label: "多连通域",
    detail: `${geometry.polygons.length} 区域 · ${geometry.polygons.reduce((sum, p) => sum + p.points.length, 0)} 点`,
  };
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
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
  /** v0.10.8 · I11 · 精修：仅 AI 行 + polygon 几何时由父级注入，否则不渲染按钮。 */
  onRefine?: () => void;
  onDelete?: () => void;
  onChangeClass?: () => void;
  /** v0.10.5 M4-β · I15 切换 lock/hidden/occluded；仅人工框传入。 */
  onToggleFlag?: (flag: "is_locked" | "is_hidden" | "is_occluded") => void;
}

export function BoxListItem({
  b, isAi, selected, dimmed = false, imageWidth, imageHeight,
  onSelect, onAccept, onReject, onRefine, onDelete, onChangeClass, onToggleFlag,
}: BoxListItemProps) {
  const color = classColor(b.cls);
  const toolMeta = annotationToolMeta(b, imageWidth, imageHeight);
  return (
    <div
      onClick={(e) => onSelect({ shiftKey: e.shiftKey })}
      className={cn(styles.row, selected && styles.rowSelected, dimmed && styles.rowDimmed)}
    >
      <div className={styles.metaGrid}>
        <svg className={styles.classDot} viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="5" fill={color} />
        </svg>
        <div className={styles.titleRow}>
          <b className={styles.className}>{displayClassName(b.cls)}</b>
          {isAi ? (
            <span className={cn(styles.badge, styles.badgeAi)}>
              <Icon name="sparkle" size={8} />{(b.conf * 100).toFixed(0)}%
            </span>
          ) : (
            <span className={cn(styles.badge, b.source === "prediction_based" ? styles.badgeDefault : styles.badgeAccent)}>
              {b.source === "prediction_based" ? "AI 采纳" : "手动"}
            </span>
          )}
          {dimmed && (
            <span
              className={styles.coveredTag}
              title="已被同类用户框（IoU > 0.7）覆盖"
            >已被覆盖</span>
          )}
        </div>
        <div className={cn("mono", styles.detailRow)}>
          <span className={styles.toolPill}>
            {toolMeta.label}
          </span>
          <span className={styles.toolDetail}>
            {toolMeta.detail}
          </span>
        </div>
      </div>
      <div className={styles.actions}>
        {isAi ? (
          <>
            {onAccept && (
              <Button
                variant="primary"
                size="sm"
                title="采纳预测"
                aria-label="采纳预测"
                onClick={(e) => { e.stopPropagation(); onAccept(); }}
                className={styles.rowActionButton}
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
                className={styles.rowActionButton}
              >
                <Icon name="x" size={14} />
              </Button>
            )}
            {onRefine && (
              <Button
                size="sm"
                title="精修 (Mask 笔刷)"
                aria-label="精修"
                onClick={(e) => { e.stopPropagation(); onRefine(); }}
                className={styles.rowActionButton}
                data-testid={`ai-refine-${b.id}`}
              >
                <Icon name="edit" size={14} />
              </Button>
            )}
          </>
        ) : (
          <>
            {onToggleFlag && (
              <>
                <Button
                  size="sm"
                  title={b.is_hidden ? "显示 (H)" : "隐藏 (H)"}
                  aria-label={b.is_hidden ? "显示" : "隐藏"}
                  aria-pressed={!!b.is_hidden}
                  onClick={(e) => { e.stopPropagation(); onToggleFlag("is_hidden"); }}
                  className={cn(styles.rowActionButton, !b.is_hidden && styles.inactiveFlagButton)}
                >
                  <Icon name={b.is_hidden ? "eyeOff" : "eye"} size={14} />
                </Button>
                <Button
                  size="sm"
                  title={b.is_locked ? "解锁 (L)" : "锁定 (L)"}
                  aria-label={b.is_locked ? "解锁" : "锁定"}
                  aria-pressed={!!b.is_locked}
                  onClick={(e) => { e.stopPropagation(); onToggleFlag("is_locked"); }}
                  className={cn(styles.rowActionButton, !b.is_locked && styles.inactiveFlagButton)}
                >
                  <Icon name={b.is_locked ? "lock" : "unlock"} size={14} />
                </Button>
                <Button
                  size="sm"
                  title={b.is_occluded ? "取消遮挡 (O)" : "标记遮挡 (O)"}
                  aria-label={b.is_occluded ? "取消遮挡" : "标记遮挡"}
                  aria-pressed={!!b.is_occluded}
                  onClick={(e) => { e.stopPropagation(); onToggleFlag("is_occluded"); }}
                  className={cn(styles.rowActionButton, !b.is_occluded && styles.inactiveFlagButton)}
                >
                  <Icon name="circleDot" size={14} />
                </Button>
              </>
            )}
            {onChangeClass && (
              <Button
                size="sm"
                title="修改类别"
                aria-label="修改类别"
                onClick={(e) => { e.stopPropagation(); onChangeClass(); }}
                className={styles.rowActionButton}
              >
                <Icon name="tag" size={14} />
              </Button>
            )}
            {onRefine && (
              <Button
                size="sm"
                title="Mask 笔刷精修"
                aria-label="精修"
                onClick={(e) => { e.stopPropagation(); onRefine(); }}
                className={styles.rowActionButton}
                data-testid={`user-refine-${b.id}`}
              >
                <Icon name="edit" size={14} />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="danger"
                size="sm"
                title="删除标注"
                aria-label="删除标注"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className={styles.rowActionButton}
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
