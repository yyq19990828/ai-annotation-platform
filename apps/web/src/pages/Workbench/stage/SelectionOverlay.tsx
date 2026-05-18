import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Viewport } from "../state/useViewportTransform";
import { classColor } from "./colors";
import styles from "./SelectionOverlay.module.css";

interface OverlayProps {
  box: { id: string; x: number; y: number; w: number; h: number; cls: string };
  isAi: boolean;
  /** > 1 时进入批量浮条态。 */
  batchCount?: number;
  imgW: number;
  imgH: number;
  vp: Viewport;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
  onChangeClass?: () => void;
  onBatchDelete?: () => void;
  onBatchChangeClass?: () => void;
  onClearSelection?: () => void;
}

export function SelectionOverlay({
  box, isAi, batchCount,
  imgW, imgH, vp,
  onAccept, onReject, onDelete, onChangeClass,
  onBatchDelete, onBatchChangeClass, onClearSelection,
}: OverlayProps) {
  const right = (box.x + box.w) * imgW * vp.scale + vp.tx;
  const bottom = (box.y + box.h) * imgH * vp.scale + vp.ty;
  const isBatch = !!batchCount && batchCount > 1;
  const rootRef = useRef<HTMLDivElement>(null);
  const color = classColor(box.cls);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty("--selection-overlay-left", `${right}px`);
    el.style.setProperty("--selection-overlay-top", `${bottom + 4}px`);
  }, [bottom, right]);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {isBatch ? (
        <>
          <span className={styles.batchCount}>
            已选 <b className={styles.batchCountValue}>{batchCount}</b> 个
          </span>
          {onBatchChangeClass && (
            <Button size="sm" onClick={(e) => { e.stopPropagation(); onBatchChangeClass(); }}>
              <Icon name="rect" size={10} />批量改类
            </Button>
          )}
          {onBatchDelete && (
            <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onBatchDelete(); }}>
              <Icon name="trash" size={10} />批量删除
            </Button>
          )}
          {onClearSelection && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onClearSelection(); }}>
              取消
            </Button>
          )}
        </>
      ) : (
        <>
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
              className={styles.changeClassButton}
            >
              <svg className={styles.classSwatch} viewBox="0 0 8 8" aria-hidden="true">
                <rect width="8" height="8" rx="2" fill={color} />
              </svg>
              {box.cls}
              <span className={styles.changeClassHint}>改类</span>
            </button>
          )}
          {!isAi && onDelete && (
            <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <Icon name="trash" size={10} />删除
            </Button>
          )}
        </>
      )}
    </div>
  );
}
