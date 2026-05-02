import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle, Group, Label, Tag, Text } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import type { Annotation } from "@/types";
import type { Tool } from "../state/useWorkbenchState";
import type { AiBox } from "../state/transforms";
import { useElementSize, type Viewport } from "../state/useViewportTransform";
import { applyResize, type ResizeDirection } from "./ResizeHandles";
import { classColorForCanvas, hexToRgba } from "./colors";
import { SelectionOverlay } from "./SelectionOverlay";
import { TOOL_REGISTRY, type PolygonDraftHandle } from "./tools";
import { CLOSE_DISTANCE } from "./tools/PolygonTool";
import { CanvasDrawingLayer } from "./CanvasDrawingLayer";
import type { CommentCanvasDrawing } from "@/api/comments";
import { Icon } from "@/components/ui/Icon";
import { isSelfIntersecting, moveVertex, type Pt } from "./polygonGeom";

type Geom = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: "draw"; sx: number; sy: number; cx: number; cy: number }
  | { kind: "move"; id: string; start: Geom; sx: number; sy: number; cur: Geom }
  | { kind: "resize"; id: string; start: Geom; sx: number; sy: number; dir: ResizeDirection; cur: Geom }
  | { kind: "polyVertex"; id: string; vidx: number; start: Pt[]; cur: Pt[] }
  | { kind: "polyMove"; id: string; start: Pt[]; sx: number; sy: number; cur: Pt[] }
  | { kind: "pan"; sx: number; sy: number }
  | { kind: "canvasStroke"; points: number[] };

function translatePolygon(points: Pt[], dx: number, dy: number): Pt[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cdx = Math.max(-minX, Math.min(1 - maxX, dx));
  const cdy = Math.max(-minY, Math.min(1 - maxY, dy));
  return points.map(([x, y]) => [x + cdx, y + cdy] as Pt);
}

interface ImageStageProps {
  fileUrl: string | null;
  blurhash?: string | null;
  tool: Tool;
  activeClass: string;
  selectedId: string | null;
  /** primary 之外的全部选中（含 primary）。仅 user 框可多选；AI 框单选。 */
  selectedIds?: string[];
  userBoxes: Annotation[];
  aiBoxes: AiBox[];
  spacePan: boolean;
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  fitTick: number;
  readOnly?: boolean;
  fadedAiIds?: Set<string>;
  /** 待确认绘制框：画完框后等待用户在 popover 里选类别。 */
  pendingDrawing?: { geom: Geom } | null;
  /** 临时几何 override（方向键 nudge 期间用于显示）。优先级：drag > nudgeMap > b。 */
  nudgeMap?: Map<string, Geom>;
  /** 多选批量浮条按钮（selectedIds.length > 1 时由 Shell 处理）。 */
  onBatchDelete?: () => void;
  onBatchChangeClass?: () => void;
  onSelectBox: (id: string | null, opts?: { shift?: boolean }) => void;
  onAcceptPrediction?: (b: AiBox) => void;
  onDeleteUserBox?: (id: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
  onCommitDrawing?: (geo: Geom) => void;
  onCommitMove?: (id: string, before: Geom, after: Geom) => void;
  onCommitResize?: (id: string, before: Geom, after: Geom) => void;
  /** polygon 顶点几何变更（拖动 / Alt 新增 / Shift 删除）；before/after 为完整 points 列表。 */
  onCommitPolygonGeometry?: (id: string, before: Pt[], after: Pt[]) => void;
  onCursorMove: (pt: { x: number; y: number } | null) => void;
  /** 画布几何信息上抛，供父级渲染 Minimap / popover。 */
  onStageGeometry?: (g: { imgW: number; imgH: number; vpSize: { w: number; h: number } }) => void;
  /** 渲染在画布层之上的覆盖物（与 SelectionOverlay 同坐标系，container 内绝对定位）。 */
  overlay?: React.ReactNode;
  /** polygon 工具草稿（v0.5.3）。仅 tool === "polygon" 时使用。 */
  polygonDraft?: PolygonDraftHandle;
  /** v0.6.4：画布批注 shapes（已落地的笔触）。read-only 渲染。 */
  canvasShapes?: NonNullable<CommentCanvasDrawing["shapes"]>;
  /** canvas 工具激活：监听 + 渲染 draft，新笔触通过 onCanvasStrokeCommit 上报。 */
  canvasEditable?: boolean;
  /** 当前 stroke 颜色（draft 用，commit 时也带上）。*/
  canvasStroke?: string;
  /** 一段笔触落定时回调，points 是归一化 [x1,y1,x2,y2,...]。*/
  onCanvasStrokeCommit?: (points: number[], stroke: string) => void;
  /** v0.6.6：历史画布批注（来自 hover 的某条 comment.canvas_drawing），半透明叠加只读。
   *  与 canvasShapes 并存：上层主笔触不变，下方覆盖一层 0.5 opacity 的「历史回看」。*/
  historicalShapes?: NonNullable<CommentCanvasDrawing["shapes"]>;
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
  onClick: (e?: Konva.KonvaEventObject<MouseEvent>) => void;
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
        onClick={(e) => { e.cancelBubble = true; onClick(e); }}
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

// ── KonvaPolygon: 渲染已落库的 polygon 标注 + 选中态顶点 / 边编辑 ─────────
function KonvaPolygon({
  b, isAi, selected, faded, imgW, imgH, scale, onClick,
  points,
  selfIntersect,
  editable,
  onVertexMouseDown,
  onEdgeMouseDown,
  onBodyMouseDown,
}: {
  b: Annotation;
  isAi: boolean;
  selected: boolean;
  faded: boolean;
  imgW: number;
  imgH: number;
  scale: number;
  onClick: (e?: Konva.KonvaEventObject<MouseEvent>) => void;
  /** 实际渲染顶点（drag 期间走 override）。空时回落到 b.polygon。 */
  points?: Pt[];
  selfIntersect?: boolean;
  editable?: boolean;
  onVertexMouseDown?: (vidx: number, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onEdgeMouseDown?: (edgeIdx: number, e: Konva.KonvaEventObject<MouseEvent>) => void;
  /** 选中态下在多边形 body 上按下左键 → 整体平移。 */
  onBodyMouseDown?: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null;
}) {
  const color = classColorForCanvas(b.cls);
  const sw = (selected ? 2 : 1.5) / scale;
  const labelFontSize = 10.5 / scale;
  const labelPad = 4 / scale;
  const labelText = `${isAi ? "✦ " : ""}${b.cls} ${(b.conf * 100).toFixed(0)}`;
  const ps: Pt[] = points && points.length >= 3 ? points : (b.polygon ?? []);
  const flat: number[] = [];
  for (const [px, py] of ps) flat.push(px * imgW, py * imgH);
  const strokeColor = selfIntersect ? "oklch(0.55 0.22 25)" : color;
  return (
    <Group>
      <Line
        points={flat}
        closed
        stroke={strokeColor}
        strokeWidth={sw}
        dash={isAi || selfIntersect ? [4 / scale, 3 / scale] : undefined}
        fill={hexToRgba(color, isAi ? 0.08 : 0.07)}
        opacity={faded ? 0.35 : 1}
        shadowEnabled={selected && !faded}
        shadowColor={selfIntersect ? "oklch(0.55 0.22 25)" : color}
        shadowBlur={8 / scale}
        shadowOpacity={0.4}
        onClick={(e) => { e.cancelBubble = true; onClick(e); }}
        onMouseDown={(e) => {
          if (!editable || !onBodyMouseDown || e.evt.button !== 0) return;
          e.cancelBubble = true;
          onBodyMouseDown(e);
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage && editable && onBodyMouseDown) stage.container().style.cursor = "move";
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "";
        }}
      />
      {/* 标签锚定到第一个点 */}
      {flat.length >= 2 && (
        <Label x={flat[0]} y={flat[1] - 22 / scale} listening={false}>
          <Tag fill={strokeColor} cornerRadius={3 / scale} />
          <Text
            text={labelText + (selfIntersect ? " ⚠" : "")}
            fill="white"
            fontSize={labelFontSize}
            padding={labelPad}
            fontFamily="var(--font-sans, sans-serif)"
          />
        </Label>
      )}

      {/* 编辑态：边的 hit-area（透明粗线，用于 Alt+点击新增顶点） */}
      {editable && onEdgeMouseDown && ps.map((_, i) => {
        const a = ps[i];
        const c = ps[(i + 1) % ps.length];
        return (
          <Line
            key={`edge-${i}`}
            points={[a[0] * imgW, a[1] * imgH, c[0] * imgW, c[1] * imgH]}
            stroke="rgba(0,0,0,0)"
            strokeWidth={10 / scale}
            hitStrokeWidth={10 / scale}
            onMouseDown={(e) => {
              if (!e.evt.altKey) return; // 仅 Alt+左键 → 新增顶点；普通点走选中冒泡
              e.cancelBubble = true;
              onEdgeMouseDown(i, e);
            }}
            onMouseEnter={(e) => {
              if (!e.evt.altKey) return;
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "copy";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "";
            }}
          />
        );
      })}

      {/* 编辑态：顶点圆点（拖动 / Shift+点击删除） */}
      {editable && onVertexMouseDown && ps.map(([px, py], i) => (
        <Circle
          key={`v-${i}`}
          x={px * imgW}
          y={py * imgH}
          radius={5 / scale}
          fill="white"
          stroke={color}
          strokeWidth={1.5 / scale}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            onVertexMouseDown(i, e);
          }}
          onMouseEnter={(e) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = e.evt.shiftKey ? "not-allowed" : "grab";
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
  fileUrl, blurhash, tool, activeClass,
  selectedId, selectedIds, userBoxes, aiBoxes, spacePan, vp, setVp, fitTick,
  readOnly = false, fadedAiIds, pendingDrawing, nudgeMap,
  onBatchDelete, onBatchChangeClass,
  onSelectBox, onAcceptPrediction, onDeleteUserBox, onChangeUserBoxClass,
  onCommitDrawing, onCommitMove, onCommitResize, onCommitPolygonGeometry, onCursorMove,
  onStageGeometry, overlay, polygonDraft,
  canvasShapes, canvasEditable = false, canvasStroke = "#ef4444", onCanvasStrokeCommit,
  historicalShapes,
}: ImageStageProps) {
  const selSet = useMemo(
    () => new Set(selectedIds && selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []),
    [selectedIds, selectedId],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const vpSize = useElementSize(containerRef);

  const [image] = useImage(fileUrl ?? "");
  const imgW = image?.naturalWidth || 900;
  const imgH = image?.naturalHeight || 600;
  const imageLoaded = !!image?.naturalWidth;

  // 把几何信息上抛给父级（Minimap / popover 锚点用）
  useEffect(() => {
    onStageGeometry?.({ imgW, imgH, vpSize });
  }, [imgW, imgH, vpSize, onStageGeometry]);

  const [drag, setDrag] = useState<Drag | null>(null);
  // mousemove 监听走 ref 读取 kind/坐标，避免每次 setDrag 都让 useEffect 重挂监听 →
  // 解决 v0.6.4 BUG B-2「画框时框体不实时 / 拖动卡」。
  const dragRef = useRef<Drag | null>(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);

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

  const fittedRef = useRef(false);
  useEffect(() => {
    if (!fittedRef.current && vpSize.w && vpSize.h && imageLoaded) {
      fitNow();
      fittedRef.current = true;
    }
  }, [vpSize.w, vpSize.h, imageLoaded, fitNow]);

  const prevFileUrl = useRef(fileUrl);
  useEffect(() => {
    if (fileUrl !== prevFileUrl.current) {
      prevFileUrl.current = fileUrl;
      fittedRef.current = false;
    }
  }, [fileUrl]);

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

  // ── window-level drag events (rAF-throttled) ─────────────────────────────
  // 依赖数组用 `!!drag` 而非 `drag` 本身：mousemove 期间 setDrag 频繁触发 React
  // re-render，但不会让监听重挂；只在 drag 进 / 出 null 时切换。
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    let rafId: number | null = null;
    const pending = { current: null as null | (() => void) };

    const schedule = (apply: () => void) => {
      pending.current = apply;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const fn = pending.current;
        pending.current = null;
        if (fn) fn();
      });
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "pan") {
        const dx = e.movementX;
        const dy = e.movementY;
        schedule(() => setVp((cur) => ({ ...cur, tx: cur.tx + dx, ty: cur.ty + dy })));
        return;
      }
      const pt = toImg(e.clientX, e.clientY);
      if (!pt) return;
      if (d.kind === "draw") {
        schedule(() => setDrag((cur) => (cur && cur.kind === "draw" ? { ...cur, cx: pt.x, cy: pt.y } : cur)));
      } else if (d.kind === "move") {
        schedule(() => setDrag((cur) => {
          if (!cur || cur.kind !== "move") return cur;
          const dx = pt.x - cur.sx;
          const dy = pt.y - cur.sy;
          return {
            ...cur,
            cur: {
              ...cur.start,
              x: Math.max(0, Math.min(1 - cur.start.w, cur.start.x + dx)),
              y: Math.max(0, Math.min(1 - cur.start.h, cur.start.y + dy)),
            },
          };
        }));
      } else if (d.kind === "resize") {
        schedule(() => setDrag((cur) => {
          if (!cur || cur.kind !== "resize") return cur;
          const next = applyResize(
            { ...cur.start, id: "", cls: "", conf: 1, source: "manual" } as Annotation,
            { x: cur.sx, y: cur.sy }, pt, cur.dir,
          );
          return { ...cur, cur: next };
        }));
      } else if (d.kind === "polyVertex") {
        schedule(() => setDrag((cur) => {
          if (!cur || cur.kind !== "polyVertex") return cur;
          return { ...cur, cur: moveVertex(cur.cur, cur.vidx, [pt.x, pt.y]) };
        }));
      } else if (d.kind === "polyMove") {
        schedule(() => setDrag((cur) => {
          if (!cur || cur.kind !== "polyMove") return cur;
          return { ...cur, cur: translatePolygon(cur.start, pt.x - cur.sx, pt.y - cur.sy) };
        }));
      } else if (d.kind === "canvasStroke") {
        schedule(() => setDrag((cur) => {
          if (!cur || cur.kind !== "canvasStroke") return cur;
          return { ...cur, points: [...cur.points, pt.x, pt.y] };
        }));
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d) {
        if (d.kind === "draw") {
          const x = Math.min(d.sx, d.cx);
          const y = Math.min(d.sy, d.cy);
          const w = Math.abs(d.cx - d.sx);
          const h = Math.abs(d.cy - d.sy);
          if (w > 0.005 && h > 0.005) onCommitDrawing?.({ x, y, w, h });
        } else if (d.kind === "move") {
          if (d.cur.x !== d.start.x || d.cur.y !== d.start.y) {
            onCommitMove?.(d.id, d.start, d.cur);
          }
        } else if (d.kind === "resize") {
          if (d.cur.w > 0.005 && d.cur.h > 0.005 &&
              (d.cur.x !== d.start.x || d.cur.y !== d.start.y ||
               d.cur.w !== d.start.w || d.cur.h !== d.start.h)) {
            onCommitResize?.(d.id, d.start, d.cur);
          }
        } else if (d.kind === "polyVertex" || d.kind === "polyMove") {
          const before = d.start;
          const after = d.cur;
          const changed = before.length !== after.length ||
            before.some((p, i) => p[0] !== after[i][0] || p[1] !== after[i][1]);
          if (changed) onCommitPolygonGeometry?.(d.id, before, after);
        } else if (d.kind === "canvasStroke") {
          // 至少 2 个点（4 个数字）才算一笔；点击没有移动会被丢弃
          if (d.points.length >= 4) onCanvasStrokeCommit?.(d.points, canvasStroke);
        }
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, setVp, toImg, onCommitDrawing, onCommitMove, onCommitResize, onCommitPolygonGeometry, onCanvasStrokeCommit, canvasStroke]);

  // ── stage event handlers ─────────────────────────────────────────────────
  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target !== (stageRef.current as unknown)) {
      return;
    }
    const pt = toImg(e.evt.clientX, e.evt.clientY);
    if (!pt) return;
    // spacePan 模式下强制走 hand 工具的 pan 行为，无视当前 tool
    const effective = spacePan ? TOOL_REGISTRY.hand : TOOL_REGISTRY[tool];
    const init = effective.onPointerDown?.({
      pt,
      evt: e.evt,
      vp,
      activeClass,
      imgW, imgH,
      spacePan,
      readOnly,
      pendingDrawing: !!pendingDrawing,
      onClearSelection: () => onSelectBox(null),
      polygonDraft,
    });
    if (init) setDrag(init);
  };

  const handleStageDblClick = () => {
    // polygon 模式下双击 → 闭合（≥ 3 点）；否则适应视口
    if (tool === "polygon" && polygonDraft && polygonDraft.points.length >= 3) {
      polygonDraft.close();
      return;
    }
    fitNow();
  };

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pt = toImg(e.evt.clientX, e.evt.clientY);
    onCursorMove(pt && pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1 ? pt : null);
    if (tool === "polygon" && polygonDraft && polygonDraft.points.length > 0) {
      setPolygonCursor(pt);
    } else if (polygonCursor) {
      setPolygonCursor(null);
    }
  };

  const containerCursor = (tool === "hand" || spacePan)
    ? (drag?.kind === "pan" ? "grabbing" : "grab")
    : tool === "canvas" ? "crosshair"
    : pendingDrawing ? "default" : "crosshair";

  // polygon 草稿当前光标位置（用于动态预览线段）
  const [polygonCursor, setPolygonCursor] = useState<{ x: number; y: number } | null>(null);

  const drawingPreview = drag?.kind === "draw"
    ? { x: Math.min(drag.sx, drag.cx), y: Math.min(drag.sy, drag.cy),
        w: Math.abs(drag.cx - drag.sx), h: Math.abs(drag.cy - drag.sy) }
    : null;

  const overrideGeom = (id: string): Geom | null => {
    if (drag && (drag.kind === "move" || drag.kind === "resize") && drag.id === id) return drag.cur;
    if (nudgeMap?.has(id)) return nudgeMap.get(id) ?? null;
    return null;
  };

  /** polygon 顶点 / 整体平移 drag 期间的实时 override；返回当前应渲染的 points 列表（或 null 表示无 override）。 */
  const polyOverridePoints = (id: string): Pt[] | null => {
    if (drag && (drag.kind === "polyVertex" || drag.kind === "polyMove") && drag.id === id) return drag.cur;
    return null;
  };

  const selectedBox = useMemo(() => {
    if (!selectedId) return null;
    return (userBoxes as (Annotation | AiBox)[]).concat(aiBoxes).find((b) => b.id === selectedId) ?? null;
  }, [selectedId, userBoxes, aiBoxes]);

  const isSelectedAi = selectedBox ? "predictionId" in selectedBox : false;

  // pending color = activeClass (default class for visual preview)
  const pendingColor = classColorForCanvas(activeClass || "pending");

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: "repeating-conic-gradient(var(--color-canvas-checker-a) 0% 25%, var(--color-canvas-checker-b) 0% 50%) 0 0/16px 16px",
        cursor: containerCursor,
      }}
      onMouseLeave={() => onCursorMove(null)}
    >
      {/* blurhash 占位（图像加载前） */}
      {!imageLoaded && fileUrl && blurhash && (
        <BlurhashLayer hash={blurhash} />
      )}

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
        {/* bg 层：图像本体；不响应 hit-test，独立缓存 */}
        <Layer name="bg" listening={false}>
          {image && (
            <KonvaImage image={image} x={0} y={0} width={imgW} height={imgH} listening={false} />
          )}
        </Layer>

        {/* ai 层：AI 预测框（虚线 + 浅填充）。listening 保持开以支持点击采纳；
            但与 user 层分离后，user 框的 move/resize 重绘不再连带触发 AI 层重绘。 */}
        <Layer name="ai">
          {aiBoxes.map((b) => (
            b.polygon && b.polygon.length >= 3 ? (
              <KonvaPolygon
                key={b.id}
                b={b}
                isAi
                selected={selSet.has(b.id)}
                faded={fadedAiIds?.has(b.id) ?? false}
                imgW={imgW} imgH={imgH} scale={vp.scale}
                onClick={(evt) => onSelectBox(b.id, { shift: !!evt?.evt?.shiftKey })}
              />
            ) : (
              <KonvaBox
                key={b.id}
                b={b}
                isAi
                selected={selSet.has(b.id)}
                faded={fadedAiIds?.has(b.id) ?? false}
                editable={!readOnly}
                imgW={imgW} imgH={imgH} scale={vp.scale}
                onClick={(evt) => onSelectBox(b.id, { shift: !!evt?.evt?.shiftKey })}
                onMoveStart={null}
                onResizeStart={null}
              />
            )
          ))}
        </Layer>

        {/* user 层：人工框 + 选中态 + resize handle */}
        <Layer name="user">
          {userBoxes.map((b) => {
            const ov = overrideGeom(b.id);
            const display: Annotation = ov ? { ...b, ...ov } : b;
            // polygon 走多边形渲染（v0.5.4 加顶点编辑 / Alt 新增 / Shift 删除）
            if (display.polygon && display.polygon.length >= 3) {
              const polyOv = polyOverridePoints(b.id);
              const livePoints = polyOv ?? (display.polygon as Pt[]);
              const isOnlySelected = selectedId === b.id && selSet.size === 1 && !readOnly;
              const intersects = isOnlySelected && !isSelfIntersecting(livePoints).ok;
              return (
                <KonvaPolygon
                  key={b.id}
                  b={display}
                  isAi={false}
                  selected={selSet.has(b.id)}
                  faded={false}
                  imgW={imgW} imgH={imgH} scale={vp.scale}
                  points={livePoints}
                  selfIntersect={intersects}
                  editable={isOnlySelected}
                  onClick={(evt) => onSelectBox(b.id, { shift: !!evt?.evt?.shiftKey })}
                  onVertexMouseDown={(vidx, e) => {
                    const cur = (polyOverridePoints(b.id) ?? (b.polygon as Pt[])).slice();
                    if (e.evt.shiftKey) {
                      // Shift+点击 → 删除顶点（≤3 顶点拒绝）
                      if (cur.length <= 3) return;
                      const next = cur.slice();
                      next.splice(vidx, 1);
                      onCommitPolygonGeometry?.(b.id, cur, next);
                      return;
                    }
                    setDrag({ kind: "polyVertex", id: b.id, vidx, start: cur, cur });
                  }}
                  onEdgeMouseDown={(edgeIdx, e) => {
                    if (!e.evt.altKey) return;
                    const pt = toImg(e.evt.clientX, e.evt.clientY);
                    if (!pt) return;
                    const cur = (polyOverridePoints(b.id) ?? (b.polygon as Pt[])).slice();
                    const next = cur.slice();
                    next.splice(edgeIdx + 1, 0, [pt.x, pt.y]);
                    onCommitPolygonGeometry?.(b.id, cur, next);
                  }}
                  onBodyMouseDown={isOnlySelected ? (e) => {
                    const pt = toImg(e.evt.clientX, e.evt.clientY);
                    if (!pt) return;
                    const cur = (polyOverridePoints(b.id) ?? (b.polygon as Pt[])).slice();
                    setDrag({ kind: "polyMove", id: b.id, start: cur, sx: pt.x, sy: pt.y, cur });
                  } : null}
                />
              );
            }
            // 单体选中时（且只有一个选中）才允许 move/resize；多选时禁用以避免冲突
            const isPrimarySingleSelect = selectedId === b.id && selSet.size === 1 && !readOnly;
            return (
              <KonvaBox
                key={b.id}
                b={display}
                isAi={false}
                selected={selSet.has(b.id)}
                faded={false}
                editable={!readOnly}
                imgW={imgW} imgH={imgH} scale={vp.scale}
                onClick={(evt) => onSelectBox(b.id, { shift: !!evt?.evt?.shiftKey })}
                onMoveStart={isPrimarySingleSelect ? (e) => {
                  const pt = toImg(e.evt.clientX, e.evt.clientY);
                  if (!pt) return;
                  setDrag({ kind: "move", id: b.id, start: { x: b.x, y: b.y, w: b.w, h: b.h }, sx: pt.x, sy: pt.y, cur: { x: b.x, y: b.y, w: b.w, h: b.h } });
                } : null}
                onResizeStart={isPrimarySingleSelect ? (dir, e) => {
                  const pt = toImg(e.evt.clientX, e.evt.clientY);
                  if (!pt) return;
                  setDrag({ kind: "resize", id: b.id, start: { x: b.x, y: b.y, w: b.w, h: b.h }, sx: pt.x, sy: pt.y, dir, cur: { x: b.x, y: b.y, w: b.w, h: b.h } });
                } : null}
              />
            );
          })}
        </Layer>

        {/* v0.6.6 · 历史画布批注（hover 评论触发）：半透明只读叠加，比主层 z 高一点点 */}
        {historicalShapes && historicalShapes.length > 0 && (
          <Layer name="historical-canvas" listening={false} opacity={0.5}>
            {historicalShapes.map((shape, idx) => {
              const flat: number[] = [];
              for (let i = 0; i < shape.points.length; i += 2) {
                flat.push(shape.points[i] * imgW, shape.points[i + 1] * imgH);
              }
              return (
                <Line
                  key={`hist-${idx}`}
                  points={flat}
                  stroke={shape.stroke ?? "#ef4444"}
                  strokeWidth={3 / vp.scale}
                  lineCap="round"
                  lineJoin="round"
                  tension={0.3}
                  dash={[6 / vp.scale, 4 / vp.scale]}
                />
              );
            })}
          </Layer>
        )}

        {/* v0.6.4 · 画布批注层：reviewer/annotator 在原图上画的红圈/箭头，
            坐标系归一化 [0,1] → 与 ImageStage vp 共享，缩放 / 平移自动跟随。 */}
        <CanvasDrawingLayer
          shapes={canvasShapes ?? []}
          draftStroke={drag?.kind === "canvasStroke" ? drag.points : null}
          draftColor={canvasStroke}
          imgW={imgW}
          imgH={imgH}
          scale={vp.scale}
          editable={canvasEditable && tool === "canvas"}
        />

        {/* overlay 层：绘制预览 + pending 框 + polygon 草稿；不参与 hit-test */}
        <Layer name="overlay" listening={false}>
          {/* polygon 草稿：已落点 + 跟随光标的预览线段 + 顶点圆点 + 首点高亮（提示可闭合） */}
          {polygonDraft && polygonDraft.points.length > 0 && (() => {
            const ps = polygonDraft.points;
            const flat: number[] = [];
            for (const [px, py] of ps) flat.push(px * imgW, py * imgH);
            // 加上指向当前光标的预览段
            if (polygonCursor) flat.push(polygonCursor.x * imgW, polygonCursor.y * imgH);
            const draftColor = classColorForCanvas(activeClass || "polygon");
            // 首点是否处于"可闭合"距离
            const canClose = ps.length >= 3 && polygonCursor &&
              Math.hypot(polygonCursor.x - ps[0][0], polygonCursor.y - ps[0][1]) <= CLOSE_DISTANCE;
            return (
              <>
                <Line
                  points={flat}
                  closed={false}
                  stroke={draftColor}
                  strokeWidth={1.5 / vp.scale}
                  dash={[4 / vp.scale, 3 / vp.scale]}
                  fill={hexToRgba(draftColor, 0.10)}
                />
                {ps.map(([px, py], i) => (
                  <Circle
                    key={i}
                    x={px * imgW}
                    y={py * imgH}
                    radius={(i === 0 ? 4.5 : 3) / vp.scale}
                    fill={i === 0 && canClose ? draftColor : "white"}
                    stroke={draftColor}
                    strokeWidth={1.5 / vp.scale}
                  />
                ))}
              </>
            );
          })()}
          {drawingPreview && drawingPreview.w > 0 && (
            <Rect
              x={drawingPreview.x * imgW}
              y={drawingPreview.y * imgH}
              width={drawingPreview.w * imgW}
              height={drawingPreview.h * imgH}
              stroke={pendingColor}
              strokeWidth={1.5 / vp.scale}
              dash={[4 / vp.scale, 3 / vp.scale]}
              fill={hexToRgba(pendingColor, 0.12)}
              listening={false}
            />
          )}

          {pendingDrawing && (
            <>
              <Rect
                x={pendingDrawing.geom.x * imgW}
                y={pendingDrawing.geom.y * imgH}
                width={pendingDrawing.geom.w * imgW}
                height={pendingDrawing.geom.h * imgH}
                stroke="oklch(0.65 0.18 75)"
                strokeWidth={2 / vp.scale}
                dash={[5 / vp.scale, 3 / vp.scale]}
                fill={hexToRgba("#f59e0b", 0.10)}
                shadowColor="oklch(0.65 0.18 75)"
                shadowBlur={6 / vp.scale}
                shadowOpacity={0.5}
                listening={false}
              />
              <Label
                x={pendingDrawing.geom.x * imgW}
                y={pendingDrawing.geom.y * imgH - 22 / vp.scale}
                listening={false}
              >
                <Tag fill="oklch(0.65 0.18 75)" cornerRadius={3 / vp.scale} />
                <Text
                  text="? 待选类别"
                  fill="white"
                  fontSize={10.5 / vp.scale}
                  padding={4 / vp.scale}
                  fontFamily="var(--font-sans, sans-serif)"
                />
              </Label>
            </>
          )}
        </Layer>
      </Stage>

      {selectedBox && !readOnly && !pendingDrawing && tool !== "canvas" && (
        <SelectionOverlay
          box={selectedBox}
          isAi={isSelectedAi}
          batchCount={selSet.size > 1 ? selSet.size : undefined}
          imgW={imgW}
          imgH={imgH}
          vp={vp}
          onAccept={isSelectedAi && onAcceptPrediction
            ? () => onAcceptPrediction(selectedBox as AiBox)
            : undefined}
          onReject={isSelectedAi ? () => onSelectBox(null) : undefined}
          onDelete={!isSelectedAi && onDeleteUserBox && selSet.size === 1
            ? () => onDeleteUserBox(selectedBox.id)
            : undefined}
          onChangeClass={!isSelectedAi && onChangeUserBoxClass && selSet.size === 1
            ? () => onChangeUserBoxClass(selectedBox.id)
            : undefined}
          onBatchDelete={selSet.size > 1 ? onBatchDelete : undefined}
          onBatchChangeClass={selSet.size > 1 ? onBatchChangeClass : undefined}
          onClearSelection={selSet.size > 1 ? () => onSelectBox(null) : undefined}
        />
      )}

      {overlay}
    </div>
  );
}

// ── blurhash placeholder layer ─────────────────────────────────────────────
function BlurhashLayer({ hash }: { hash: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    import("blurhash").then(({ decode }) => {
      if (cancelled || !canvasRef.current) return;
      const W = 32, H = 24;
      const pixels = decode(hash, W, H);
      const canvas = canvasRef.current;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const imageData = ctx.createImageData(W, H);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [hash]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        objectFit: "contain", filter: "blur(8px)", opacity: 0.7,
        pointerEvents: "none",
      }}
    />
  );
}
