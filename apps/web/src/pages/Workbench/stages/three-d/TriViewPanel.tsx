/**
 * v0.13.5 · 三正交视图面板 (主 3D 视图右栏)。B-1: 只读渲染基建; B-2: 拖边/角精修。
 *
 * 结构: 一块占满面板的 WebGL canvas (TriViewRenderer, 居底) + 纵向 3 行 (top/side/front),
 * 每行一个 2D overlay (TriOrthoView, 叠其上) + 标题。面板按 3 行的实测像素矩形给 renderer
 * 下发 viewport, 使 WebGL 分屏与 overlay 严丝对齐。未选中框 → 三窗空, 显示占位提示。
 *
 * 拖拽: 任一视图开拖 → frozen 记下起始姿态, 期间相机冻结 (setCameraRef) 让框在屏上真实
 * 长/移; 拖拽中 onEditPsr(psr,false) 走 draft 实时四方同步, 松手 onEditPsr(psr,true) 落 PATCH。
 *
 * 生命周期: renderer 随面板挂载建一次、卸载 dispose。点 geometry 复用主场景。
 * v0.17.6 · module.css → Tailwind。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";

import { TriViewRenderer, type ViewRectCss } from "./TriViewRenderer";
import { TriOrthoView, type TriSelected } from "./TriOrthoView";
import type { TriView, Psr } from "./geometry/triview";

// v0.17.6 · Tailwind class constants (was ThreeDWorkbench.module.css).
const TRI_PANEL = "relative flex-1 flex flex-col gap-1.5 p-1.5 bg-card min-h-0";
const TRI_ROW = "relative flex-1 min-h-0 border border-border rounded-sm overflow-hidden";
const TRI_CAPTION =
  "absolute top-1 left-1/2 z-local-2 -translate-x-1/2 px-1.5 py-px rounded-sm bg-card border border-border text-xs text-muted-foreground tabular-nums whitespace-nowrap pointer-events-none";
const TRI_AXIS_GLYPH =
  "absolute left-1.5 bottom-1 z-local-2 w-[42px] h-[42px] pointer-events-none [filter:drop-shadow(0_0_5px_var(--sc-muted))]";
const TRI_AXIS_PATH =
  "[fill:none] [stroke:currentColor] [stroke-width:2] [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]";
const TRI_AXIS_TEXT = "[fill:currentColor] font-mono text-xs font-bold";
const TRI_AXIS_ORIGIN = "[fill:var(--sc-foreground)] [stroke:var(--sc-card)] [stroke-width:1]";
const AXIS_X = "text-status-danger";
const AXIS_Y = "text-status-positive";
const AXIS_Z = "text-brand";
const TRI_EMPTY =
  "absolute inset-0 z-local-3 flex items-center justify-center text-center p-3 bg-card text-xs text-muted-foreground leading-relaxed";

const VIEWS: TriView[] = ["top", "side", "front"];
const TRI_LABEL: Record<TriView, string> = {
  top: "俯视 Top",
  side: "侧视 Side",
  front: "正视 Front",
};

const TRI_AXES: Record<TriView, { u: "x" | "y" | "z"; v: "x" | "y" | "z" }> = {
  top: { u: "x", v: "y" },
  side: { u: "x", v: "z" },
  front: { u: "y", v: "z" },
};

const AXIS_LABEL: Record<"x" | "y" | "z", string> = {
  x: "X",
  y: "Y",
  z: "Z",
};

interface TriViewPanelProps {
  /** 当前选中框 (PSR + 色); null = 无选中。拖拽中由上层下发 draft。 */
  selected: TriSelected | null;
  /** 取主场景当前点 BufferGeometry (复用同一份)。 */
  getPointsGeometry: () => THREE.BufferGeometry | null;
  /** 点云是否已加载完 (主场景 stats 到位); 变化时重绑 geometry。 */
  pointsReady: boolean;
  /** 是否可编辑 (任务非只读 且 框未锁定); false → 只读, overlay 不画 handle、不收事件。 */
  editable: boolean;
  /** 点大小 (米): 跟随主视图点大小滑杆。 */
  pointSize: number;
  /** 当前对象按视图记忆的缩放倍数。 */
  zoomByView: Record<TriView, number>;
  onZoomChange: (view: TriView, zoom: number) => void;
  /** 拖拽中 (commit=false, draft) / 松手 (commit=true, PATCH) 回写选中框 PSR。 */
  onEditPsr: (psr: Psr, commit: boolean) => void;
}

function axisClass(axis: "x" | "y" | "z") {
  if (axis === "x") return AXIS_X;
  if (axis === "y") return AXIS_Y;
  return AXIS_Z;
}

function TriAxisGlyph({ view }: { view: TriView }) {
  const axes = TRI_AXES[view];
  return (
    <svg className={TRI_AXIS_GLYPH} viewBox="0 0 52 52" aria-hidden="true">
      <g className={axisClass(axes.u)}>
        <path className={TRI_AXIS_PATH} d="M10 42H38" />
        <path className={TRI_AXIS_PATH} d="M38 42L32 37M38 42L32 47" />
        <text className={TRI_AXIS_TEXT} x="42" y="46">
          {AXIS_LABEL[axes.u]}
        </text>
      </g>
      <g className={axisClass(axes.v)}>
        <path className={TRI_AXIS_PATH} d="M10 42V12" />
        <path className={TRI_AXIS_PATH} d="M10 12L5 18M10 12L15 18" />
        <text className={TRI_AXIS_TEXT} x="4" y="10">
          {AXIS_LABEL[axes.v]}
        </text>
      </g>
      <circle className={TRI_AXIS_ORIGIN} cx="10" cy="42" r="2.8" />
    </svg>
  );
}

export function TriViewPanel({
  selected,
  getPointsGeometry,
  pointsReady,
  editable,
  pointSize,
  zoomByView,
  onZoomChange,
  onEditPsr,
}: TriViewPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<TriView, HTMLDivElement | null>>({
    top: null,
    side: null,
    front: null,
  });
  const rendererRef = useRef<TriViewRenderer | null>(null);
  // 拖拽期冻结取景参考 (起始姿态); null = 无拖拽。
  const [frozen, setFrozen] = useState<Psr | null>(null);

  // 量出 3 行相对面板的像素矩形, 下发给 renderer 当 viewport。
  const layout = useCallback(() => {
    const panel = panelRef.current;
    const r = rendererRef.current;
    if (!panel || !r) return;
    r.resize();
    const pr = panel.getBoundingClientRect();
    const rects: ViewRectCss[] = [];
    for (const view of VIEWS) {
      const el = rowRefs.current[view];
      if (!el) continue;
      const b = el.getBoundingClientRect();
      rects.push({ view, x: b.left - pr.left, y: b.top - pr.top, w: b.width, h: b.height });
    }
    r.setViewports(rects);
  }, []);

  // 挂载建 renderer, 卸载 dispose; 面板尺寸变化重排。
  useEffect(() => {
    if (!panelRef.current) return;
    const r = new TriViewRenderer(panelRef.current);
    rendererRef.current = r;
    layout();
    const ro = new ResizeObserver(() => layout());
    ro.observe(panelRef.current);
    return () => {
      ro.disconnect();
      r.dispose();
      rendererRef.current = null;
    };
  }, [layout]);

  // 点云加载完 (或换帧) 重绑 geometry。
  useEffect(() => {
    rendererRef.current?.setGeometry(getPointsGeometry());
  }, [pointsReady, getPointsGeometry]);

  // 点大小跟随主视图滑杆。
  useEffect(() => {
    rendererRef.current?.setPointSize(pointSize);
  }, [pointSize]);

  useEffect(() => {
    rendererRef.current?.setZoomByView(zoomByView);
  }, [zoomByView]);

  // 选中框 PSR 变化 (含拖拽 draft): 更新裁剪面/相机, 并重排。
  useEffect(() => {
    rendererRef.current?.setBox(
      selected
        ? { center: selected.center, size: selected.size, rotation: selected.rotation }
        : null,
    );
    layout();
  }, [selected, layout]);

  // 拖拽期冻结相机取景 (裁剪面仍随实时 box)。
  useEffect(() => {
    rendererRef.current?.setCameraRef(frozen);
  }, [frozen]);

  const handleDragStart = useCallback((startPsr: Psr) => setFrozen(startPsr), []);
  const handleDragMove = useCallback((psr: Psr) => onEditPsr(psr, false), [onEditPsr]);
  const handleDragEnd = useCallback(
    (psr: Psr) => {
      onEditPsr(psr, true);
      setFrozen(null);
    },
    [onEditPsr],
  );

  return (
    <div ref={panelRef} className={TRI_PANEL}>
      {VIEWS.map((view) => (
        <div
          key={view}
          ref={(el) => {
            rowRefs.current[view] = el;
          }}
          className={TRI_ROW}
        >
          <TriOrthoView
            view={view}
            selected={selected}
            frozen={frozen}
            editable={editable}
            zoom={zoomByView[view]}
            onZoomChange={(zoom) => onZoomChange(view, zoom)}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          />
          <TriAxisGlyph view={view} />
          <figcaption className={TRI_CAPTION}>
            {TRI_LABEL[view]} · {Math.round(zoomByView[view] * 100)}%
          </figcaption>
        </div>
      ))}
      {!selected && (
        <div className={TRI_EMPTY}>
          选中一个 3D 框后
          <br />
          在此俯 / 侧 / 正三视图精修
        </div>
      )}
    </div>
  );
}

export default TriViewPanel;
