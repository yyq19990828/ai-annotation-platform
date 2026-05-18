import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle, Label, Tag, Text } from "react-konva";
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
import { MaskOverlayLayer } from "./overlays/MaskOverlayLayer";
import type { UseMaskEditorReturn } from "../state/useMaskEditor";
import { MASK_BRUSH_MIN_PX, MASK_BRUSH_MAX_PX } from "../state/useMaskEditor";
import type { CommentCanvasDrawing } from "@/api/comments";
import { Icon } from "@/components/ui/Icon";
import { isSelfIntersecting, isSelfIntersectingIncremental, moveVertex, type Pt } from "./polygonGeom";
import { BlurhashLayer } from "./BlurhashLayer";
import { KonvaBox, KonvaPolygon } from "./ImageStageShapes";
import { useWorkbenchConfig } from "../state/useWorkbenchConfig";
import { useWorkbenchPerf } from "./shared/useWorkbenchPerf";
import styles from "./ImageStage.module.css";

type Geom = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: "draw"; sx: number; sy: number; cx: number; cy: number }
  | {
      kind: "samProbe";
      // v0.10.2 · 加 exemplar; 行为同 bbox 但松手时派发到 onSamPrompt.kind="exemplar".
      mode: "point" | "bbox" | "exemplar";
      sx: number;
      sy: number;
      cx: number;
      cy: number;
      alt: boolean;
    }
  | { kind: "move"; id: string; start: Geom; sx: number; sy: number; cur: Geom }
  | { kind: "resize"; id: string; start: Geom; sx: number; sy: number; dir: ResizeDirection; cur: Geom }
  | { kind: "polyVertex"; id: string; vidx: number; start: Pt[]; cur: Pt[] }
  | { kind: "polyMove"; id: string; start: Pt[]; sx: number; sy: number; cur: Pt[] }
  | { kind: "pan"; sx: number; sy: number }
  | { kind: "canvasStroke"; points: number[] }
  | { kind: "maskBrush"; lastX: number; lastY: number };

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

function SamRefineButton({
  left,
  top,
  onClick,
}: {
  left: number;
  top: number;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--sam-refine-left", `${left}px`);
    el.style.setProperty("--sam-refine-top", `${top - 32}px`);
  }, [left, top]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      data-testid="sam-candidate-refine"
      className={styles.samRefineButton}
      title="精修 SAM 候选 (R)"
    >
      ✎ 精修 <kbd className={styles.samRefineKey}>R</kbd>
    </button>
  );
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
  /** B-11 · 驳回 AI 预测 (将 prediction 从画布隐去, 不调后端). */
  onRejectPrediction?: (b: AiBox) => void;
  onDeleteUserBox?: (id: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
  onCommitDrawing?: (geo: Geom) => void;
  /**
   * v0.9.2 · SAM 工具松手时派发 prompt.
   * v0.10.2 · 新增 exemplar 类型 (与 bbox 同手势, kind 区分由父层路由到 runExemplar).
   */
  onSamPrompt?: (prompt:
    | { kind: "point"; pt: [number, number]; alt: boolean }
    | { kind: "bbox"; bbox: [number, number, number, number] }
    | { kind: "exemplar"; bbox: [number, number, number, number] }
  ) => void;
  /**
   * v0.9.2 · SAM 候选 polygon（待确认紫虚线）。当前候选 stroke 加粗，其它半透。
   * v0.9.4 phase 2 · 加 type discriminator 支持 box/mask/both 三模式; rectanglelabels
   * 类型用 bbox 字段渲染矩形, polygonlabels 用 points 渲染多边形.
   */
  samCandidates?: {
    id: string;
    type: "polygonlabels" | "rectanglelabels";
    points?: [number, number][];
    bbox?: { x: number; y: number; width: number; height: number };
  }[];
  samActiveIdx?: number;
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
  /**
   * v0.9.4 phase 2 / v0.10.2 · 派生型 sub-tool; 仅作 cursor / preview hint 用.
   * 派生自 tool: smart-point → "point", smart-box → "bbox", text-prompt → "text", exemplar → "exemplar".
   * 非 AI 工具时为 null.
   */
  samSubTool?: "point" | "bbox" | "text" | "exemplar" | null;
  /** v0.9.4 phase 2 · 仅 sam-point 子工具下生效, "+/-" 切换 (与 Alt 修饰键合并). */
  samPolarity?: "positive" | "negative";
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
  /** v0.10.8 · Mask 编辑器 hook 返回；mask 工具激活时挂 MaskOverlayLayer + 派发 paintAt。 */
  maskEditor?: UseMaskEditorReturn;
  /** v0.10.9 · 当前 SAM 候选「精修」入口；点击后由 useImageAnnotationActions.handleRefineSamCandidate 启动 mask 编辑。 */
  onRefineSamCandidate?: (idx: number) => void;
  /** v0.10.10 · I17.3 · 当前项目级渲染配置覆盖；与用户级 preferences 合并后驱动 KonvaImage 等。
   *  缺省 / null = 项目不覆盖，纯用户级。 */
  projectRenderingConfig?: import("@/api/projects").ProjectRenderingConfig | null;
}

// ── main component ──────────────────────────────────────────────────────────
export function ImageStage({
  fileUrl, blurhash, tool, activeClass,
  selectedId, selectedIds, userBoxes, aiBoxes, spacePan, vp, setVp, fitTick,
  readOnly = false, fadedAiIds, pendingDrawing, nudgeMap,
  onBatchDelete, onBatchChangeClass,
  onSelectBox, onAcceptPrediction, onRejectPrediction, onDeleteUserBox, onChangeUserBoxClass,
  onCommitDrawing, onSamPrompt, samCandidates, samActiveIdx = 0,
  onCommitMove, onCommitResize, onCommitPolygonGeometry, onCursorMove,
  onStageGeometry, overlay, polygonDraft, samPolarity,
  canvasShapes, canvasEditable = false, canvasStroke = "#ef4444", onCanvasStrokeCommit,
  historicalShapes,
  maskEditor,
  onRefineSamCandidate,
  projectRenderingConfig,
}: ImageStageProps) {
  // selSet 引用稳定化（I3）：以排序后的 id 串作为签名，签名不变则返回上次同一 Set 实例，
  // 让下游 KonvaBox / KonvaPolygon 的 selected prop 维持引用稳定，避免误触发 memo 失效。
  const selSetCacheRef = useRef<{ sig: string; set: Set<string> }>({ sig: " ", set: new Set() });
  const selSet = useMemo(() => {
    const ids = selectedIds && selectedIds.length > 0
      ? selectedIds
      : selectedId
        ? [selectedId]
        : [];
    if (ids.length === 0) {
      if (selSetCacheRef.current.sig !== "") {
        selSetCacheRef.current = { sig: "", set: new Set() };
      }
      return selSetCacheRef.current.set;
    }
    const sorted = [...ids].sort();
    const sig = sorted.join("");
    if (sig === selSetCacheRef.current.sig) return selSetCacheRef.current.set;
    const set = new Set(ids);
    selSetCacheRef.current = { sig, set };
    return set;
  }, [selectedIds, selectedId]);
  // user 层在 HandTool / 只读时关闭 listening，省 hit-test 开销。
  // ai 层只要不在只读模式都开（支持点击采纳），HandTool 下也可点选 AI 候选。
  const userLayerListening = tool !== "hand" && !readOnly;
  // v0.9.41 · 标注偏好（I17）：smoothImage / cssImageFilter / longTaskSampleRate。
  // v0.10.10 · I17.3 · 合并项目级 rendering_config 覆盖（项目级 > 用户级 > 默认）。
  const { config: workbenchConfig } = useWorkbenchConfig(projectRenderingConfig);
  useWorkbenchPerf(workbenchConfig.longTaskSampleRate);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const vpSize = useElementSize(containerRef);

  const [image] = useImage(fileUrl ?? "");
  const imgW = image?.naturalWidth || 900;
  const imgH = image?.naturalHeight || 600;
  const imageLoaded = !!image?.naturalWidth;

  // v0.10.5 M4-β · 按 is_hidden 过滤；按 z_order ASC 排序（高 z_order 后渲染 = 在上层）。
  // 同 z_order 保持原数组顺序作 tie-breaker，避免选中态下渲染顺序闪烁。
  const visibleSortedUserBoxes = useMemo(() => {
    const visible = userBoxes.filter((b) => !b.is_hidden);
    return visible
      .map((b, i) => ({ b, i }))
      .sort((a, c) => (a.b.z_order ?? 0) - (c.b.z_order ?? 0) || a.i - c.i)
      .map((entry) => entry.b);
  }, [userBoxes]);

  // v0.10.4 I2.3 · 当前视口在归一化 [0,1] 空间的 bbox，用于大 polygon 顶点视口粗筛。
  // 加 1 顶点 buffer 防边缘抖动；imgW/imgH 未就绪时返回 undefined（不启用粗筛）。
  const viewportBBox = useMemo(() => {
    if (!imgW || !imgH || vp.scale <= 0 || !vpSize.w || !vpSize.h) return undefined;
    const bufferPx = 8;
    const sxW = vp.scale * imgW;
    const sxH = vp.scale * imgH;
    return {
      minX: Math.max(0, (-vp.tx - bufferPx) / sxW),
      minY: Math.max(0, (-vp.ty - bufferPx) / sxH),
      maxX: Math.min(1, (vpSize.w - vp.tx + bufferPx) / sxW),
      maxY: Math.min(1, (vpSize.h - vp.ty + bufferPx) / sxH),
    };
  }, [imgW, imgH, vp.scale, vp.tx, vp.ty, vpSize.w, vpSize.h]);

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
      // v0.10.8 · Shift+滚轮在 mask 工具激活时调笔刷半径（步长 ±2，clamp [1,200]）。
      // 仅 deltaY 主导时响应（避免 macOS trackpad 横向滚动误触发）。
      if (e.shiftKey && !(e.ctrlKey || e.metaKey) && maskEditor?.active &&
          Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 2 : -2;
        const next = Math.max(MASK_BRUSH_MIN_PX, Math.min(MASK_BRUSH_MAX_PX, maskEditor.radius + delta));
        maskEditor.setRadius(next);
        return;
      }
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
  }, [setVp, maskEditor]);

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
      } else if (d.kind === "samProbe") {
        schedule(() => setDrag((cur) => (cur && cur.kind === "samProbe" ? { ...cur, cx: pt.x, cy: pt.y } : cur)));
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
        // v0.8.7 F6 · 透传 shift/alt 修饰键给 applyResize
        const shiftKey = e.shiftKey;
        const altKey = e.altKey;
        schedule(() => setDrag((cur) => {
          if (!cur || cur.kind !== "resize") return cur;
          const next = applyResize(
            { ...cur.start, id: "", cls: "", conf: 1, source: "manual" } as Annotation,
            { x: cur.sx, y: cur.sy }, pt, cur.dir,
            { shiftKey, altKey },
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
      } else if (d.kind === "maskBrush") {
        // v0.10.8 · 相邻两点线段插值 (步长 = radius/2)；不走 rAF 节流，避免漏笔。
        if (!maskEditor) return;
        const px = pt.x * imgW;
        const py = pt.y * imgH;
        const dx = px - d.lastX;
        const dy = py - d.lastY;
        const dist = Math.hypot(dx, dy);
        const step = Math.max(1, maskEditor.radius / 2);
        const n = Math.max(1, Math.floor(dist / step));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          maskEditor.paintAt(d.lastX + dx * t, d.lastY + dy * t);
        }
        d.lastX = px;
        d.lastY = py;
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
        } else if (d.kind === "samProbe") {
          // v0.10.2 · 按 mode 分发 (point / bbox / exemplar).
          if (d.mode === "point") {
            onSamPrompt?.({ kind: "point", pt: [d.sx, d.sy], alt: d.alt });
          } else {
            const x1 = Math.min(d.sx, d.cx);
            const y1 = Math.min(d.sy, d.cy);
            const x2 = Math.max(d.sx, d.cx);
            const y2 = Math.max(d.sy, d.cy);
            if (x2 - x1 > 0.005 && y2 - y1 > 0.005) {
              if (d.mode === "exemplar") {
                onSamPrompt?.({ kind: "exemplar", bbox: [x1, y1, x2, y2] });
              } else {
                onSamPrompt?.({ kind: "bbox", bbox: [x1, y1, x2, y2] });
              }
            }
          }
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
        // v0.10.8 · maskBrush 松手不 commit；buffer 累积笔迹，由 Enter / MaskToolbar 显式触发 commitMaskAsPolygon。
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
  }, [dragging, setVp, toImg, onCommitDrawing, onCommitMove, onCommitResize, onCommitPolygonGeometry, onCanvasStrokeCommit, canvasStroke, onSamPrompt, maskEditor, imgW, imgH]);

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
      samPolarity,
      maskEditor,
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
    // v0.10.9 · Mask 工具下追踪笔刷光标位置（image-space pixels），驱动 overlay 圆圈渲染。
    if (tool === "mask") {
      setMaskCursor(pt ? { x: pt.x * imgW, y: pt.y * imgH } : null);
    } else if (maskCursor) {
      setMaskCursor(null);
    }
  };

  const containerCursor = (tool === "hand" || spacePan)
    ? (drag?.kind === "pan" ? "grabbing" : "grab")
    : tool === "canvas" ? "crosshair"
    // v0.10.9 · Mask 工具用自绘 overlay 圆圈替代系统光标，让笔刷大小与图像同比例可视。
    : tool === "mask" ? "none"
    : pendingDrawing ? "default" : "crosshair";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.setProperty("--image-stage-cursor", containerCursor);
    if (workbenchConfig.cssImageFilter) {
      el.style.setProperty("--image-stage-filter", workbenchConfig.cssImageFilter);
    } else {
      el.style.removeProperty("--image-stage-filter");
    }
  }, [containerCursor, workbenchConfig.cssImageFilter]);

  // polygon 草稿当前光标位置（用于动态预览线段）
  const [polygonCursor, setPolygonCursor] = useState<{ x: number; y: number } | null>(null);
  // v0.10.9 · Mask 笔刷光标 (image-space pixels)；overlay 层据此画跟随圆圈。
  const [maskCursor, setMaskCursor] = useState<{ x: number; y: number } | null>(null);

  const drawingPreview = drag?.kind === "draw"
    ? { x: Math.min(drag.sx, drag.cx), y: Math.min(drag.sy, drag.cy),
        w: Math.abs(drag.cx - drag.sx), h: Math.abs(drag.cy - drag.sy) }
    : null;

  // SAM 拖框预览：与 drawingPreview 同形态，但样式为紫色虚线（与 PendingPolygonsOverlay 视觉对齐）
  const samPreview = drag?.kind === "samProbe"
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
      data-testid="workbench-stage"
      className={styles.root}
      onMouseLeave={() => onCursorMove(null)}
    >
      {/* blurhash 占位（图像加载前） */}
      {!imageLoaded && fileUrl && blurhash && (
        <BlurhashLayer hash={blurhash} />
      )}

      {!fileUrl && (
        <div className={styles.emptyState}>
          <Icon name="warning" size={32} />
          <div className={styles.emptyStateText}>图像不可用</div>
        </div>
      )}

      <div className={styles.konvaHost}>
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
        >
        {/* bg 层：图像本体；不响应 hit-test，独立缓存 */}
        <Layer name="bg" listening={false}>
          {image && (
            <KonvaImage
              image={image}
              x={0}
              y={0}
              width={imgW}
              height={imgH}
              listening={false}
              imageSmoothingEnabled={workbenchConfig.smoothImage}
            />
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
        <Layer name="user" listening={userLayerListening}>
          {visibleSortedUserBoxes.map((b) => {
            const ov = overrideGeom(b.id);
            const display: Annotation = ov ? { ...b, ...ov } : b;
            // polygon 走多边形渲染（v0.5.4 加顶点编辑 / Alt 新增 / Shift 删除）
            if (display.polygon && display.polygon.length >= 3) {
              const polyOv = polyOverridePoints(b.id);
              const livePoints = polyOv ?? (display.polygon as Pt[]);
              // v0.10.5 M4-β · 锁定时不进入编辑态，但仍允许 click 选中。
              const isOnlySelected = selectedId === b.id && selSet.size === 1 && !readOnly && !b.is_locked;
              // v0.10.4 I2.2 · 顶点拖拽中走 O(n) 增量检测；静态态用 O(n²) 全量（n 通常 <50）。
              const draggingThisVertex =
                drag?.kind === "polyVertex" && drag.id === b.id ? drag.vidx : -1;
              const intersects = isOnlySelected && (draggingThisVertex >= 0
                ? !isSelfIntersectingIncremental(livePoints, draggingThisVertex).ok
                : !isSelfIntersecting(livePoints).ok);
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
                  viewportBBox={viewportBBox}
                  editable={isOnlySelected}
                  occluded={!!b.is_occluded}
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
            // v0.10.5 M4-β · 锁定 (is_locked) 时禁 move/resize；occluded 影响 stroke 风格。
            const isPrimarySingleSelect = selectedId === b.id && selSet.size === 1 && !readOnly && !b.is_locked;
            return (
              <KonvaBox
                key={b.id}
                b={display}
                isAi={false}
                selected={selSet.has(b.id)}
                faded={false}
                editable={!readOnly && !b.is_locked}
                occluded={!!b.is_occluded}
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

        {/* v0.10.8 · Mask 编辑器临时叠加层 (仅 tool === "mask" 且 active 时挂)。 */}
        {tool === "mask" && maskEditor?.active && maskEditor.buffer && (
          <MaskOverlayLayer
            buffer={maskEditor.buffer}
            revision={maskEditor.revision}
            imgW={imgW}
            imgH={imgH}
            visible={true}
          />
        )}

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
          {samPreview && samPreview.w > 0 && (
            <Rect
              x={samPreview.x * imgW}
              y={samPreview.y * imgH}
              width={samPreview.w * imgW}
              height={samPreview.h * imgH}
              stroke="#a855f7"
              strokeWidth={1.5 / vp.scale}
              dash={[6 / vp.scale, 4 / vp.scale]}
              fill={hexToRgba("#a855f7", 0.08)}
              listening={false}
            />
          )}
          {samCandidates && samCandidates.length > 0 && samCandidates.map((c, idx) => {
            const isActive = idx === samActiveIdx;
            const stroke = "#a855f7";
            const strokeWidth = (isActive ? 2.5 : 1.4) / vp.scale;
            const dashArr = [6 / vp.scale, 4 / vp.scale];
            const fillRgba = hexToRgba(stroke, isActive ? 0.18 : 0.06);
            const opacity = isActive ? 1 : 0.55;
            // v0.9.4 phase 2 · 按 type 分发渲染: rectanglelabels → Rect; polygonlabels → Line.
            if (c.type === "rectanglelabels" && c.bbox) {
              return (
                <Rect
                  key={c.id}
                  x={c.bbox.x * imgW}
                  y={c.bbox.y * imgH}
                  width={c.bbox.width * imgW}
                  height={c.bbox.height * imgH}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  dash={dashArr}
                  fill={fillRgba}
                  opacity={opacity}
                  listening={false}
                />
              );
            }
            if (!c.points || c.points.length < 3) return null;
            const flat: number[] = [];
            for (const [x, y] of c.points) flat.push(x * imgW, y * imgH);
            return (
              <Line
                key={c.id}
                points={flat}
                closed
                stroke={stroke}
                strokeWidth={strokeWidth}
                dash={dashArr}
                fill={fillRgba}
                opacity={opacity}
                listening={false}
              />
            );
          })}

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
          {/* v0.10.9 · Mask 笔刷光标圈：仅 mask 工具激活时渲染；圆心 = maskCursor，半径 = maskEditor.radius
              (image-space px)，描边宽度按 vp.scale 取倒数保持像素级视觉。brush=红、erase=灰。 */}
          {tool === "mask" && maskCursor && maskEditor && (
            <Circle
              x={maskCursor.x}
              y={maskCursor.y}
              radius={maskEditor.radius}
              stroke={maskEditor.mode === "erase" ? "#64748b" : "#dc2626"}
              strokeWidth={1.5 / vp.scale}
              dash={[4 / vp.scale, 3 / vp.scale]}
              listening={false}
            />
          )}
        </Layer>
        </Stage>
      </div>

      {/* v0.10.9 · SAM 候选精修浮按钮：active polygonlabels 候选 + 未 Enter 时显示。
          位置贴在候选 polygon 顶点 bbox 右上角；点击/按 R 都触发 onRefineSamCandidate。 */}
      {onRefineSamCandidate && samCandidates && samCandidates.length > 0 && (() => {
        const cand = samCandidates[samActiveIdx];
        if (!cand || cand.type !== "polygonlabels" || !cand.points || cand.points.length < 3) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity;
        for (const [x, y] of cand.points) {
          if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x;
        }
        if (!isFinite(minX)) return null;
        const left = maxX * imgW * vp.scale + vp.tx;
        const top = minY * imgH * vp.scale + vp.ty;
        return (
          <SamRefineButton
            left={left}
            top={top}
            onClick={(e) => { e.stopPropagation(); onRefineSamCandidate(samActiveIdx); }}
          />
        );
      })()}

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
          onReject={isSelectedAi
            ? () => {
                if (onRejectPrediction) onRejectPrediction(selectedBox as AiBox);
                onSelectBox(null);
              }
            : undefined}
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
