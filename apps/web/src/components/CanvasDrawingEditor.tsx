import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { CommentCanvasDrawing } from "@/api/comments";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (drawing: CommentCanvasDrawing | null) => void;
  initial?: CommentCanvasDrawing | null;
  /** 背景图（可选）：reviewer 在原图缩略上绘制更直观；未提供则白底。 */
  backgroundUrl?: string | null;
}

const STROKE_COLORS = [
  { value: "#ef4444", label: "红" },
  { value: "#f59e0b", label: "黄" },
  { value: "#10b981", label: "绿" },
  { value: "#3b82f6", label: "蓝" },
];

const CANVAS_W = 600;
const CANVAS_H = 400;

/** Reviewer 用：在固定尺寸 SVG 上画自由曲线，序列化为 normalized [0,1] 坐标的 polyline 列表。
 *  Annotator 端用 CanvasDrawingPreview 只读渲染。 */
export function CanvasDrawingEditor({ open, onClose, onSave, initial, backgroundUrl }: Props) {
  const [shapes, setShapes] = useState<CommentCanvasDrawing["shapes"]>(initial?.shapes ?? []);
  const [stroke, setStroke] = useState<string>("#ef4444");
  const [drawing, setDrawing] = useState<number[] | null>(null); // 当前正在画的折线点 [x1, y1, x2, y2, ...]
  const svgRef = useRef<SVGSVGElement | null>(null);

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
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ color: "var(--color-fg-muted)" }}>颜色：</span>
          {STROKE_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setStroke(c.value)}
              aria-label={c.label}
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: stroke === c.value ? "2px solid var(--color-fg)" : "1px solid var(--color-border)",
                background: c.value,
                cursor: "pointer",
              }}
            />
          ))}
          <span style={{ marginLeft: "auto", color: "var(--color-fg-muted)", fontSize: 11 }}>
            按住鼠标拖动绘制 · {shapes.length} 条线
          </span>
        </div>
        <div
          style={{
            position: "relative",
            width: "100%",
            paddingBottom: `${(CANVAS_H / CANVAS_W) * 100}%`,
            background: backgroundUrl ? `center/contain no-repeat url(${backgroundUrl})` : "var(--color-bg-sunken)",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <svg
            ref={svgRef}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: "crosshair" }}
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
                strokeWidth={0.005}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ strokeWidth: 2 } as React.CSSProperties}
              />
            ))}
            {drawing && drawing.length >= 4 && (
              <polyline
                points={pointsToString(drawing)}
                fill="none"
                stroke={stroke}
                strokeWidth={0.005}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ strokeWidth: 2 } as React.CSSProperties}
              />
            )}
          </svg>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
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
}

/** 只读小缩略：annotator 端在评论卡片里展示 reviewer 的画布批注。 */
export function CanvasDrawingPreview({ drawing, width = 220, backgroundUrl }: PreviewProps) {
  const height = (CANVAS_H / CANVAS_W) * width;
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        background: backgroundUrl ? `center/contain no-repeat url(${backgroundUrl})` : "var(--color-bg-sunken)",
        border: "1px solid var(--color-border)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {drawing.shapes.map((s, i) => (
          <polyline
            key={i}
            points={pointsToString(s.points)}
            fill="none"
            stroke={s.stroke ?? "#ef4444"}
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: 2 } as React.CSSProperties}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}
