import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@/types";
import type { Tool } from "../state/useWorkbenchState";
import type { AiBox } from "../state/transforms";
import { useElementSize, type Viewport } from "../state/useViewportTransform";
import { BoxRenderer } from "./BoxRenderer";
import { DrawingPreview } from "./DrawingPreview";
import { ImageBackdrop } from "./ImageBackdrop";
import { applyResize, type ResizeDirection } from "./ResizeHandles";

const BASE_W = 900;
const BASE_H = 600;

type Geom = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: "draw"; sx: number; sy: number; cx: number; cy: number }
  | { kind: "move"; id: string; start: Geom; sx: number; sy: number; cur: Geom }
  | { kind: "resize"; id: string; start: Geom; sx: number; sy: number; dir: ResizeDirection; cur: Geom }
  | { kind: "pan"; sx: number; sy: number };

interface ImageStageProps {
  fileUrl: string | null;
  tool: Tool;
  activeClass: string;
  selectedId: string | null;
  userBoxes: Annotation[];
  aiBoxes: AiBox[];
  spacePan: boolean;
  /** 父层共享的 vp 状态（也用于 Topbar 显示与按钮）。 */
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  /** 父层触发的 fit 计数（每自增 1 都会触发一次居中适配）。 */
  fitTick: number;
  /** 只读模式：禁用绘制 / move / resize / accept / delete；仅保留 pan / 选中 / wheel-zoom。 */
  readOnly?: boolean;
  /** diff 模式：渲染时让某些 AI 框淡化，由父层决定哪些框需要 fade（如已被采纳）。 */
  fadedAiIds?: Set<string>;
  onSelectBox: (id: string | null) => void;
  onAcceptPrediction?: (b: AiBox) => void;
  onDeleteUserBox?: (id: string) => void;
  onCommitDrawing?: (geo: Geom) => void;
  onCommitMove?: (id: string, before: Geom, after: Geom) => void;
  onCommitResize?: (id: string, before: Geom, after: Geom) => void;
  onCursorMove: (pt: { x: number; y: number } | null) => void;
}

export function ImageStage({
  fileUrl, tool, activeClass,
  selectedId, userBoxes, aiBoxes, spacePan, vp, setVp, fitTick,
  readOnly = false, fadedAiIds,
  onSelectBox, onAcceptPrediction, onDeleteUserBox,
  onCommitDrawing, onCommitMove, onCommitResize, onCursorMove,
}: ImageStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const vpSize = useElementSize(viewportRef);
  const [drag, setDrag] = useState<Drag | null>(null);

  const zoomAtPt = useCallback((cx: number, cy: number, nextScale: number) => {
    setVp((cur) => {
      const s2 = Math.min(8, Math.max(0.2, nextScale));
      if (s2 === cur.scale) return cur;
      const ratio = s2 / cur.scale;
      return {
        scale: s2,
        tx: cx - (cx - cur.tx) * ratio,
        ty: cy - (cy - cur.ty) * ratio,
      };
    });
  }, [setVp]);
  const panBy = useCallback((dx: number, dy: number) => {
    setVp((cur) => ({ ...cur, tx: cur.tx + dx, ty: cur.ty + dy }));
  }, [setVp]);
  const fitNow = useCallback(() => {
    if (!vpSize.w || !vpSize.h) return;
    const s = Math.min(vpSize.w / BASE_W, vpSize.h / BASE_H);
    setVp({
      scale: s,
      tx: (vpSize.w - BASE_W * s) / 2,
      ty: (vpSize.h - BASE_H * s) / 2,
    });
  }, [vpSize.w, vpSize.h, setVp]);

  // 初次容器有尺寸时居中适配
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!fittedRef.current && vpSize.w && vpSize.h) {
      fitNow();
      fittedRef.current = true;
    }
  }, [vpSize.w, vpSize.h, fitNow]);

  // 父层 fit / reset 触发
  const lastFitTickRef = useRef(fitTick);
  useEffect(() => {
    if (fitTick !== lastFitTickRef.current) {
      lastFitTickRef.current = fitTick;
      fitNow();
    }
  }, [fitTick, fitNow]);

  /** 取标准化图像坐标（0-1）。 */
  const toImg = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  // ── Wheel zoom（Ctrl/Meta + wheel） ─────────────────────────────────────
  useEffect(() => {
    const vpEl = viewportRef.current;
    if (!vpEl) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = vpEl.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAtPt(cx, cy, vpRef.current.scale * factor);
    };
    vpEl.addEventListener("wheel", onWheel, { passive: false });
    return () => vpEl.removeEventListener("wheel", onWheel);
  }, [zoomAtPt]);

  // ── 全局 pointermove / up：把 drag 收尾收敛到此 ──────────────────────────
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      if (drag.kind === "pan") {
        panBy(e.movementX, e.movementY);
        return;
      }
      const pt = toImg(e);
      if (!pt) return;
      if (drag.kind === "draw") {
        setDrag({ ...drag, cx: pt.x, cy: pt.y });
      } else if (drag.kind === "move") {
        const dx = pt.x - drag.sx;
        const dy = pt.y - drag.sy;
        let nx = drag.start.x + dx;
        let ny = drag.start.y + dy;
        nx = Math.max(0, Math.min(1 - drag.start.w, nx));
        ny = Math.max(0, Math.min(1 - drag.start.h, ny));
        setDrag({ ...drag, cur: { ...drag.start, x: nx, y: ny } });
      } else if (drag.kind === "resize") {
        const cur = applyResize(
          { ...drag.start, id: "", cls: "", conf: 1, source: "manual" } as Annotation,
          { x: drag.sx, y: drag.sy }, pt, drag.dir,
        );
        setDrag({ ...drag, cur });
      }
    };
    const onUp = () => {
      if (drag.kind === "draw") {
        const x = Math.min(drag.sx, drag.cx);
        const y = Math.min(drag.sy, drag.cy);
        const w = Math.abs(drag.cx - drag.sx);
        const h = Math.abs(drag.cy - drag.sy);
        if (w > 0.005 && h > 0.005) onCommitDrawing?.({ x, y, w, h });
      } else if (drag.kind === "move") {
        if (drag.cur.x !== drag.start.x || drag.cur.y !== drag.start.y) {
          onCommitMove?.(drag.id, drag.start, drag.cur);
        }
      } else if (drag.kind === "resize") {
        if (drag.cur.w > 0.005 && drag.cur.h > 0.005 &&
            (drag.cur.x !== drag.start.x || drag.cur.y !== drag.start.y ||
             drag.cur.w !== drag.start.w || drag.cur.h !== drag.start.h)) {
          onCommitResize?.(drag.id, drag.start, drag.cur);
        }
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, onCommitDrawing, onCommitMove, onCommitResize, panBy]);

  const onCanvasMove = (e: React.MouseEvent) => {
    onCursorMove(toImg(e));
  };
  const onCanvasLeave = () => onCursorMove(null);

  const onCanvasDown = (e: React.PointerEvent) => {
    const pt = toImg(e);
    if (!pt) return;
    if (tool === "hand" || spacePan || readOnly) {
      setDrag({ kind: "pan", sx: pt.x, sy: pt.y });
      if (readOnly) onSelectBox(null);
      return;
    }
    if (tool === "box") {
      setDrag({ kind: "draw", sx: pt.x, sy: pt.y, cx: pt.x, cy: pt.y });
      onSelectBox(null);
    }
  };

  const handleMoveStart = useCallback((id: string, start: Geom) => (e: React.PointerEvent) => {
    const pt = toImg(e);
    if (!pt) return;
    setDrag({ kind: "move", id, start, sx: pt.x, sy: pt.y, cur: start });
  }, []);

  const handleResizeStart = useCallback((id: string, start: Geom) => (dir: ResizeDirection, e: React.PointerEvent) => {
    const pt = toImg(e);
    if (!pt) return;
    setDrag({ kind: "resize", id, start, sx: pt.x, sy: pt.y, dir, cur: start });
  }, []);

  // 双击空白 = fit
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    fitNow();
  }, [fitNow]);

  const overrideGeom = (id: string): Geom | null => {
    if (!drag) return null;
    if ((drag.kind === "move" || drag.kind === "resize") && drag.id === id) return drag.cur;
    return null;
  };

  const drawingPreview = drag?.kind === "draw"
    ? {
        x: Math.min(drag.sx, drag.cx),
        y: Math.min(drag.sy, drag.cy),
        w: Math.abs(drag.cx - drag.sx),
        h: Math.abs(drag.cy - drag.sy),
      }
    : null;

  const cursor = (tool === "hand" || spacePan)
    ? (drag?.kind === "pan" ? "grabbing" : "grab")
    : "crosshair";

  return (
    <div
      ref={viewportRef}
      onDoubleClick={onDoubleClick}
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: "repeating-conic-gradient(#e9e9ec 0% 25%, #f3f3f5 0% 50%) 0 0/16px 16px",
      }}
    >
      <div
        ref={canvasRef}
        onPointerDown={onCanvasDown}
        onMouseMove={onCanvasMove}
        onMouseLeave={onCanvasLeave}
        style={{
          position: "absolute",
          left: 0, top: 0,
          width: BASE_W, height: BASE_H,
          background: "#fff", boxShadow: "var(--shadow-lg)",
          transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})`,
          transformOrigin: "0 0",
          cursor,
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <ImageBackdrop url={fileUrl} />
        {aiBoxes.map((b) => (
          <BoxRenderer
            key={b.id} b={b} isAi
            selected={selectedId === b.id}
            editable={!readOnly}
            faded={fadedAiIds?.has(b.id)}
            onClick={() => onSelectBox(b.id)}
            onAccept={() => onAcceptPrediction?.(b)}
            onReject={() => onSelectBox(null)}
          />
        ))}
        {userBoxes.map((b) => {
          const ov = overrideGeom(b.id);
          const display: Annotation = ov ? { ...b, x: ov.x, y: ov.y, w: ov.w, h: ov.h } : b;
          return (
            <BoxRenderer
              key={b.id} b={display}
              selected={selectedId === b.id}
              editable={!readOnly}
              onClick={() => onSelectBox(b.id)}
              onDelete={() => onDeleteUserBox?.(b.id)}
              onMoveStart={handleMoveStart(b.id, { x: b.x, y: b.y, w: b.w, h: b.h })}
              onResizeStart={handleResizeStart(b.id, { x: b.x, y: b.y, w: b.w, h: b.h })}
            />
          );
        })}
        <DrawingPreview drawing={drawingPreview} activeClass={activeClass} />
      </div>
    </div>
  );
}
