import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useElementStyle } from "@/components/ui/useElementStyle";
import type { CommentCanvasDrawing } from "@/api/comments";
import styles from "./CanvasDrawingEditor.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (drawing: CommentCanvasDrawing | null) => void;
  initial?: CommentCanvasDrawing | null;
  /** 背景图（可选）：reviewer 在原图缩略上绘制更直观；未提供则白底。 */
  backgroundUrl?: string | null;
  /** v0.6.4：图像真实尺寸（像素）。给定后画布外层比例按 imageWidth:imageHeight 渲染，
   *  避免在 16:9 / 4:3 / 1:1 图上画的批注与 reviewer 看到的比例不一致。
   *  未给定时回退到 600×400 默认比例（兼容旧调用）。*/
  imageWidth?: number | null;
  imageHeight?: number | null;
}

const STROKE_COLORS = [
  { value: "#ef4444", label: "红" },
  { value: "#f59e0b", label: "黄" },
  { value: "#10b981", label: "绿" },
  { value: "#3b82f6", label: "蓝" },
];

// 默认画布比例（旧版固定 600×400，仍保留作为 fallback）
const DEFAULT_W = 600;
const DEFAULT_H = 400;

function aspectRatioPercent(w: number | null | undefined, h: number | null | undefined): number {
  const aw = w && w > 0 ? w : DEFAULT_W;
  const ah = h && h > 0 ? h : DEFAULT_H;
  return (ah / aw) * 100;
}

/** Reviewer 用：在固定尺寸 SVG 上画自由曲线，序列化为 normalized [0,1] 坐标的 polyline 列表。
 *  Annotator 端用 CanvasDrawingPreview 只读渲染。 */
type Shape = NonNullable<CommentCanvasDrawing["shapes"]>[number];

export function CanvasDrawingEditor({ open, onClose, onSave, initial, backgroundUrl, imageWidth, imageHeight }: Props) {
  const [shapes, setShapes] = useState<Shape[]>(initial?.shapes ?? []);
  const [stroke, setStroke] = useState<string>("#ef4444");
  const [drawing, setDrawing] = useState<number[] | null>(null); // 当前正在画的折线点 [x1, y1, x2, y2, ...]
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useElementStyle<HTMLDivElement>(useMemo<CSSProperties>(() => ({
    "--canvas-drawing-aspect-padding": `${aspectRatioPercent(imageWidth, imageHeight)}%`,
    "--canvas-drawing-bg": backgroundUrl
      ? `center/contain no-repeat url(${backgroundUrl})`
      : "var(--color-bg-sunken)",
  } as CSSProperties), [backgroundUrl, imageHeight, imageWidth]));

  // 重置 shapes（每次打开同步 initial）
  useEffect(() => {
    if (open) setShapes(initial?.shapes ?? []);
  }, [open, initial]);

  const toNormalized = useCallback((e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  }, []);

  const handleDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = toNormalized(e);
    setDrawing([x, y]);
  };

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drawing === null) return;
    const [x, y] = toNormalized(e);
    setDrawing((d) => (d ? [...d, x, y] : d));
  };

  const handleUp = () => {
    if (drawing && drawing.length >= 4) {
      setShapes((prev) => [...prev, { type: "line", points: drawing, stroke }]);
    }
    setDrawing(null);
  };

  const handleClear = () => {
    setShapes([]);
    setDrawing(null);
  };

  const handleUndo = () => {
    setShapes((prev) => prev.slice(0, -1));
  };

  const handleSave = () => {
    onSave(shapes.length > 0 ? { shapes } : null);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="画布批注（reviewer）" width={680}>
      <div className={styles.editor}>
        <div className={styles.toolbar}>
          <span className={styles.muted}>颜色：</span>
          {STROKE_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setStroke(c.value)}
              aria-label={c.label}
              className={stroke === c.value ? styles.swatchActive : styles.swatch}
              data-color={c.value}
            />
          ))}
          <span className={styles.hint}>
            按住鼠标拖动绘制 · {shapes.length} 条线
          </span>
        </div>
        <div ref={canvasRef} className={styles.canvas}>
          <svg
            ref={svgRef}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className={styles.drawingSvg}
            onPointerDown={handleDown}
            onPointerMove={handleMove}
            onPointerUp={handleUp}
            onPointerCancel={handleUp}
          >
            {shapes.map((s, i) => (
              <polyline
                key={i}
                points={pointsToString(s.points)}
                fill="none"
                stroke={s.stroke ?? "#ef4444"}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {drawing && drawing.length >= 4 && (
              <polyline
                points={pointsToString(drawing)}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>
        <div className={styles.actions}>
          <Button size="sm" onClick={handleUndo} disabled={shapes.length === 0}>
            <Icon name="trash" size={11} /> 撤销
          </Button>
          <Button size="sm" onClick={handleClear} disabled={shapes.length === 0}>
            清空
          </Button>
          <Button size="sm" variant="primary" onClick={handleSave}>
            保存批注
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function pointsToString(pts: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    out.push(`${pts[i]},${pts[i + 1]}`);
  }
  return out.join(" ");
}

interface PreviewProps {
  drawing: CommentCanvasDrawing;
  width?: number;
  backgroundUrl?: string | null;
  /** v0.6.4：图像真实尺寸；给定后高度按真实比例缩放。fallback 600×400。*/
  imageWidth?: number | null;
  imageHeight?: number | null;
}

/** 只读小缩略：annotator 端在评论卡片里展示 reviewer 的画布批注。 */
export function CanvasDrawingPreview({ drawing, width = 220, backgroundUrl, imageWidth, imageHeight }: PreviewProps) {
  const aw = imageWidth && imageWidth > 0 ? imageWidth : DEFAULT_W;
  const ah = imageHeight && imageHeight > 0 ? imageHeight : DEFAULT_H;
  const height = (ah / aw) * width;
  const previewRef = useElementStyle<HTMLDivElement>(useMemo<CSSProperties>(() => ({
    "--canvas-drawing-preview-width": width,
    "--canvas-drawing-preview-height": height,
    "--canvas-drawing-bg": backgroundUrl
      ? `center/contain no-repeat url(${backgroundUrl})`
      : "var(--color-bg-sunken)",
  } as CSSProperties), [backgroundUrl, height, width]));
  return (
    <div ref={previewRef} className={styles.preview}>
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className={styles.previewSvg}
      >
        {(drawing.shapes ?? []).map((s, i) => (
          <polyline
            key={i}
            points={pointsToString(s.points)}
            fill="none"
            stroke={s.stroke ?? "#ef4444"}
            vectorEffect="non-scaling-stroke"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}
