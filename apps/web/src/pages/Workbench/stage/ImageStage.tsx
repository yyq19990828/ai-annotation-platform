import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Group, Label, Tag, Text } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import type { Annotation } from "@/types";
import type { Tool } from "../state/useWorkbenchState";
import type { AiBox } from "../state/transforms";
import { useElementSize, type Viewport } from "../state/useViewportTransform";
import { applyResize, type ResizeDirection } from "./ResizeHandles";
import { classColorForCanvas, hexToRgba } from "./colors";
import { SelectionOverlay } from "./SelectionOverlay";
import { Icon } from "@/components/ui/Icon";

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
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  fitTick: number;
  readOnly?: boolean;
  fadedAiIds?: Set<string>;
  onSelectBox: (id: string | null) => void;
  onAcceptPrediction?: (b: AiBox) => void;
  onDeleteUserBox?: (id: string) => void;
  onCommitDrawing?: (geo: Geom) => void;
  onCommitMove?: (id: string, before: Geom, after: Geom) => void;
  onCommitResize?: (id: string, before: Geom, after: Geom) => void;
  onCursorMove: (pt: { x: number; y: number } | null) => void;
}

// ── resize handle directions ────────────────────────────────────────────────
const HANDLE_DIRECTIONS: { dir: ResizeDirection; cx: number; cy: number; cursor: string }[] = [
  { dir: "nw", cx: 0,   cy: 0,   cursor: "nwse-resize" },
  { dir: "n",  cx: 0.5, cy: 0,   cursor: "ns-resize" },
  { dir: "ne", cx: 1,   cy: 0,   cursor: "nesw-resize" },
  { dir: "e",  cx: 1,   cy: 0.5, cursor: "ew-resize" },
  { dir: "se", cx: 1,   cy: 1,   cursor: "nwse-resize" },
  { dir: "s",  cx: 0.5, cy: 1,   cursor: "ns-resize" },
  { dir: "sw", cx: 0,   cy: 1,   cursor: "nesw-resize" },
  { dir: "w",  cx: 0,   cy: 0.5, cursor: "ew-resize" },
];
const HANDLE_SCREEN_PX = 9;

// ── single box rendered as Konva nodes ─────────────────────────────────────
function KonvaBox({
  b, isAi, selected, editable, faded,
  imgW, imgH, scale,
  onClick,
  onMoveStart,
  onResizeStart,
}: {
  b: Annotation;
  isAi: boolean;
  selected: boolean;
  editable: boolean;
  faded: boolean;
  imgW: number;
  imgH: number;
  scale: number;
  onClick: () => void;
  onMoveStart: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null;
  onResizeStart: ((dir: ResizeDirection, e: Konva.KonvaEventObject<MouseEvent>) => void) | null;
}) {
  const color = classColorForCanvas(b.cls);
  const sw = (selected ? 2 : 1.5) / scale;
  const handleSize = HANDLE_SCREEN_PX / scale;
  const labelFontSize = 10.5 / scale;
  const labelPad = 4 / scale;
  const isUserSelected = selected && !isAi && editable;

  const labelText = `${isAi ? "✦ " : ""}${b.cls} ${(b.conf * 100).toFixed(0)}`;

  return (
    <Group>
      {/* box body */}
      <Rect
        x={b.x * imgW}
        y={b.y * imgH}
        width={b.w * imgW}
        height={b.h * imgH}
        stroke={color}
        strokeWidth={sw}
        dash={isAi ? [4 / scale, 3 / scale] : undefined}
        fill={hexToRgba(color, isAi ? 0.08 : 0.07)}
        opacity={faded ? 0.35 : 1}
        shadowEnabled={selected && !faded}
        shadowColor={color}
        shadowBlur={8 / scale}
        shadowOpacity={0.4}
        onClick={(e) => { e.cancelBubble = true; onClick(); }}
        onMouseDown={(e) => {
          if (!isUserSelected || e.evt.button !== 0 || !onMoveStart) return;
          e.cancelBubble = true;
          onMoveStart(e);
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage && isUserSelected) stage.container().style.cursor = "move";
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "";
        }}
      />

      {/* class label above box */}
      <Label x={b.x * imgW} y={b.y * imgH - 22 / scale} listening={false}>
        <Tag fill={color} cornerRadius={3 / scale} />
        <Text
          text={labelText}
          fill="white"
          fontSize={labelFontSize}
          padding={labelPad}
          fontFamily="var(--font-sans, sans-serif)"
        />
      </Label>

      {/* resize handles (only for selected, non-AI, editable) */}
      {isUserSelected && onResizeStart && HANDLE_DIRECTIONS.map(({ dir, cx, cy, cursor }) => (
        <Rect
          key={dir}
          x={(b.x + b.w * cx) * imgW - handleSize / 2}
          y={(b.y + b.h * cy) * imgH - handleSize / 2}
          width={handleSize}
          height={handleSize}
          fill="white"
          stroke={color}
          strokeWidth={1.5 / scale}
          cornerRadius={2 / scale}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            onResizeStart(dir, e);
          }}
          onMouseEnter={(e) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = cursor;
          }}
          onMouseLeave={(e) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "";
          }}
        />
      ))}
    </Group>
  );
}

// ── main component ──────────────────────────────────────────────────────────
export function ImageStage({
  fileUrl, tool, activeClass,
  selectedId, userBoxes, aiBoxes, spacePan, vp, setVp, fitTick,
  readOnly = false, fadedAiIds,
  onSelectBox, onAcceptPrediction, onDeleteUserBox,
  onCommitDrawing, onCommitMove, onCommitResize, onCursorMove,
}: ImageStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const vpSize = useElementSize(containerRef);

  const [image] = useImage(fileUrl ?? "");
  // 渲染用尺寸：image 未加载时用 900×600 占位，避免 Stage 坍塌
  const imgW = image?.naturalWidth || 900;
  const imgH = image?.naturalHeight || 600;
  // 只有拿到真实尺寸后才允许触发 fit，避免用占位尺寸算出错误的初始缩放
  const imageLoaded = !!image?.naturalWidth;

  const [drag, setDrag] = useState<Drag | null>(null);

  // ── coordinate: client → normalized image [0,1] ──────────────────────────
  const toImg = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !imgW || !imgH) return null;
    const cur = vpRef.current;
    return {
      x: (clientX - rect.left - cur.tx) / cur.scale / imgW,
      y: (clientY - rect.top - cur.ty) / cur.scale / imgH,
    };
  }, [imgW, imgH]);

  // ── fit ──────────────────────────────────────────────────────────────────
  const fitNow = useCallback(() => {
    if (!vpSize.w || !vpSize.h || !imgW || !imgH) return;
    const s = Math.min(vpSize.w / imgW, vpSize.h / imgH);
    setVp({ scale: s, tx: (vpSize.w - imgW * s) / 2, ty: (vpSize.h - imgH * s) / 2 });
  }, [vpSize.w, vpSize.h, imgW, imgH, setVp]);

  // initial fit — 等真实图像尺寸就绪后才计算，避免用 900×600 占位尺寸算出错误缩放
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!fittedRef.current && vpSize.w && vpSize.h && imageLoaded) {
      fitNow();
      fittedRef.current = true;
    }
  }, [vpSize.w, vpSize.h, imageLoaded, fitNow]);

  // re-fit when task changes
  const prevFileUrl = useRef(fileUrl);
  useEffect(() => {
    if (fileUrl !== prevFileUrl.current) {
      prevFileUrl.current = fileUrl;
      fittedRef.current = false;
    }
  }, [fileUrl]);

  // parent-triggered fit
  const lastFitTickRef = useRef(fitTick);
  useEffect(() => {
    if (fitTick !== lastFitTickRef.current) {
      lastFitTickRef.current = fitTick;
      fitNow();
    }
  }, [fitTick, fitNow]);

  // ── wheel zoom ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nextScale = Math.min(8, Math.max(0.2, vpRef.current.scale * factor));
      const cur = vpRef.current;
      const ratio = nextScale / cur.scale;
      setVp({ scale: nextScale, tx: cx - (cx - cur.tx) * ratio, ty: cy - (cy - cur.ty) * ratio });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setVp]);

  // ── window-level drag events ─────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      if (drag.kind === "pan") {
        setVp((cur) => ({ ...cur, tx: cur.tx + e.movementX, ty: cur.ty + e.movementY }));
        return;
      }
      const pt = toImg(e.clientX, e.clientY);
      if (!pt) return;
      if (drag.kind === "draw") {
        setDrag({ ...drag, cx: pt.x, cy: pt.y });
      } else if (drag.kind === "move") {
        const dx = pt.x - drag.sx;
        const dy = pt.y - drag.sy;
        setDrag({
          ...drag,
          cur: {
            ...drag.start,
            x: Math.max(0, Math.min(1 - drag.start.w, drag.start.x + dx)),
            y: Math.max(0, Math.min(1 - drag.start.h, drag.start.y + dy)),
          },
        });
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
  }, [drag, setVp, toImg, onCommitDrawing, onCommitMove, onCommitResize]);

  // ── stage event handlers ─────────────────────────────────────────────────
  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // if pointer is on a box/handle node, let the node handler handle it
    if (e.target !== (stageRef.current as unknown)) {
      return;
    }
    const pt = toImg(e.evt.clientX, e.evt.clientY);
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

  const handleStageDblClick = () => fitNow();

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pt = toImg(e.evt.clientX, e.evt.clientY);
    onCursorMove(pt && pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1 ? pt : null);
  };

  // ── cursor style on container ────────────────────────────────────────────
  const containerCursor = (tool === "hand" || spacePan)
    ? (drag?.kind === "pan" ? "grabbing" : "grab")
    : "crosshair";

  // ── drawing preview ───────────────────────────────────────────────────────
  const drawingPreview = drag?.kind === "draw"
    ? { x: Math.min(drag.sx, drag.cx), y: Math.min(drag.sy, drag.cy),
        w: Math.abs(drag.cx - drag.sx), h: Math.abs(drag.cy - drag.sy) }
    : null;

  const overrideGeom = (id: string): Geom | null => {
    if (!drag) return null;
    if ((drag.kind === "move" || drag.kind === "resize") && drag.id === id) return drag.cur;
    return null;
  };

  // ── selected box for overlay ─────────────────────────────────────────────
  const selectedBox = useMemo(() => {
    if (!selectedId) return null;
    return (userBoxes as (Annotation | AiBox)[]).concat(aiBoxes).find((b) => b.id === selectedId) ?? null;
  }, [selectedId, userBoxes, aiBoxes]);

  const isSelectedAi = selectedBox ? "predictionId" in selectedBox : false;

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: "repeating-conic-gradient(#e9e9ec 0% 25%, #f3f3f5 0% 50%) 0 0/16px 16px",
        cursor: containerCursor,
      }}
      onMouseLeave={() => onCursorMove(null)}
    >
      {!fileUrl && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 10,
          color: "var(--color-fg-subtle)", background: "var(--color-bg-sunken)",
        }}>
          <Icon name="warning" size={32} />
          <div style={{ fontSize: 13 }}>图像不可用</div>
        </div>
      )}

      <Stage
        ref={stageRef}
        width={vpSize.w || 1}
        height={vpSize.h || 1}
        x={vp.tx}
        y={vp.ty}
        scaleX={vp.scale}
        scaleY={vp.scale}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onDblClick={handleStageDblClick}
        style={{ position: "absolute", top: 0, left: 0, display: "block" }}
      >
        <Layer>
          {image && (
            <KonvaImage image={image} x={0} y={0} width={imgW} height={imgH} listening={false} />
          )}

          {/* AI boxes */}
          {aiBoxes.map((b) => (
            <KonvaBox
              key={b.id}
              b={b}
              isAi
              selected={selectedId === b.id}
              faded={fadedAiIds?.has(b.id) ?? false}
              editable={!readOnly}
              imgW={imgW} imgH={imgH} scale={vp.scale}
              onClick={() => onSelectBox(b.id)}
              onMoveStart={null}
              onResizeStart={null}
            />
          ))}

          {/* User boxes */}
          {userBoxes.map((b) => {
            const ov = overrideGeom(b.id);
            const display: Annotation = ov ? { ...b, ...ov } : b;
            const isUserSelected = selectedId === b.id && !readOnly;
            return (
              <KonvaBox
                key={b.id}
                b={display}
                isAi={false}
                selected={selectedId === b.id}
                faded={false}
                editable={!readOnly}
                imgW={imgW} imgH={imgH} scale={vp.scale}
                onClick={() => onSelectBox(b.id)}
                onMoveStart={isUserSelected ? (e) => {
                  const pt = toImg(e.evt.clientX, e.evt.clientY);
                  if (!pt) return;
                  setDrag({ kind: "move", id: b.id, start: { x: b.x, y: b.y, w: b.w, h: b.h }, sx: pt.x, sy: pt.y, cur: { x: b.x, y: b.y, w: b.w, h: b.h } });
                } : null}
                onResizeStart={isUserSelected ? (dir, e) => {
                  const pt = toImg(e.evt.clientX, e.evt.clientY);
                  if (!pt) return;
                  setDrag({ kind: "resize", id: b.id, start: { x: b.x, y: b.y, w: b.w, h: b.h }, sx: pt.x, sy: pt.y, dir, cur: { x: b.x, y: b.y, w: b.w, h: b.h } });
                } : null}
              />
            );
          })}

          {/* Drawing preview */}
          {drawingPreview && drawingPreview.w > 0 && (
            <Rect
              x={drawingPreview.x * imgW}
              y={drawingPreview.y * imgH}
              width={drawingPreview.w * imgW}
              height={drawingPreview.h * imgH}
              stroke={classColorForCanvas(activeClass)}
              strokeWidth={1.5 / vp.scale}
              dash={[4 / vp.scale, 3 / vp.scale]}
              fill={hexToRgba(classColorForCanvas(activeClass), 0.12)}
              listening={false}
            />
          )}
        </Layer>
      </Stage>

      {/* HTML overlay: floating action buttons for selected box */}
      {selectedBox && !readOnly && (
        <SelectionOverlay
          box={selectedBox}
          isAi={isSelectedAi}
          imgW={imgW}
          imgH={imgH}
          vp={vp}
          onAccept={isSelectedAi && onAcceptPrediction
            ? () => onAcceptPrediction(selectedBox as AiBox)
            : undefined}
          onReject={isSelectedAi ? () => onSelectBox(null) : undefined}
          onDelete={!isSelectedAi && onDeleteUserBox
            ? () => onDeleteUserBox(selectedBox.id)
            : undefined}
        />
      )}
    </div>
  );
}
