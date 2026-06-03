/**
 * v0.13.5 · 单个正交视图的 2D overlay。
 *
 * B-1: 只读画框矩形。B-2: 叠加 8 个 handle (4 边中点 + 4 角), 命中后拖拽改 size/center
 * (拖边/拖角), 数学全走 triview.ts 纯函数 (dragHandle)。拖拽期相机冻结在起始姿态
 * (frozen), overlay 把实时框投影进该冻结系 → 框在屏上真实地长/移、点不动, 便于贴合。
 *
 * 投影: 框已对齐正交相机, 故为屏上轴对齐矩形。中心 = 冻结系下 (实时中心−冻结中心) 沿
 * box-local u/v 世界方向的分量·s; 半宽/半高 = 实时 size[u/v]/2·s, s = (cssW/2)/halfW。
 * dpr 缩放沿用 CameraProjectionView 模式。
 */
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";

import { boxAxisWorldDir } from "./geometry/box3d";
import {
  VIEW_AXES,
  frameOrtho,
  dragHandle,
  type TriView,
  type Handle,
  type Psr,
} from "./geometry/triview";
import styles from "./ThreeDWorkbench.module.css";

/** overlay 需要的选中框信息 (size 决定矩形, color 描边)。 */
export interface TriSelected {
  center: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
  color: string;
}

interface TriOrthoViewProps {
  view: TriView;
  /** 实时 (draft) 选中框; null = 无选中。 */
  selected: TriSelected | null;
  /** 拖拽期冻结取景参考 (= 起始姿态, 只用 center/size/rotation); null = 无拖拽。 */
  frozen: Psr | null;
  /** 是否可编辑 (任务非只读 且 框未锁定); false → 只读, 不画 handle、不收事件。 */
  editable: boolean;
  onDragStart: (startPsr: Psr) => void;
  onDragMove: (psr: Psr) => void;
  onDragEnd: (psr: Psr) => void;
}

const HANDLE_TOL = 9; // 命中半径 (px)
const HANDLE_SZ = 6; // handle 方块边长 (px)
// 命中优先级: 角先于边 (角同时压在两边端点上)。
const HIT_ORDER: Handle[] = ["ne", "nw", "se", "sw", "e", "w", "n", "s"];
const CURSOR: Record<Handle, string> = {
  e: "ew-resize",
  w: "ew-resize",
  n: "ns-resize",
  s: "ns-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/** 框矩形在屏上的中心/半宽半高 + 米→px 比例 (draw 与命中共用同一口径)。 */
function projectRect(
  view: TriView,
  selected: TriSelected,
  ref: Psr,
  cssW: number,
  cssH: number,
) {
  const { u, v } = VIEW_AXES[view];
  const { halfW } = frameOrtho(ref.size, view, cssW / cssH);
  const s = cssW / 2 / halfW;
  const uDir = boxAxisWorldDir(ref.rotation, u);
  const vDir = boxAxisWorldDir(ref.rotation, v);
  const dC = new THREE.Vector3(
    selected.center[0] - ref.center[0],
    selected.center[1] - ref.center[1],
    selected.center[2] - ref.center[2],
  );
  const cx = cssW / 2 + dC.dot(uDir) * s;
  const cy = cssH / 2 - dC.dot(vDir) * s; // 屏幕 y 朝下, v 朝上 → 取负
  return { s, cx, cy, rw: selected.size[u] * s, rh: selected.size[v] * s };
}

/** 8 个 handle 的屏幕坐标。 */
function handlePoints(cx: number, cy: number, rw: number, rh: number): Record<Handle, [number, number]> {
  const l = cx - rw / 2;
  const r = cx + rw / 2;
  const t = cy - rh / 2; // 屏上方 = box-local +v (n)
  const b = cy + rh / 2;
  return { e: [r, cy], w: [l, cy], n: [cx, t], s: [cx, b], ne: [r, t], nw: [l, t], se: [r, b], sw: [l, b] };
}

function hitHandle(
  px: number,
  py: number,
  pts: Record<Handle, [number, number]>,
): Handle | null {
  for (const h of HIT_ORDER) {
    const [hx, hy] = pts[h];
    if (Math.abs(px - hx) <= HANDLE_TOL && Math.abs(py - hy) <= HANDLE_TOL) return h;
  }
  return null;
}

export function TriOrthoView({
  view,
  selected,
  frozen,
  editable,
  onDragStart,
  onDragMove,
  onDragEnd,
}: TriOrthoViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 拖拽态 (命中 handle 后): 起始 PSR / 起始指针 / px↔米 比例 / 当前结果。用 ref 避免重渲。
  const dragRef = useRef<{
    handle: Handle;
    startPsr: Psr;
    s0: number;
    startX: number;
    startY: number;
    last: Psr;
  } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    if (!cssW || !cssH) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!selected) return;

    const ref = frozen ?? selected;
    const { cx, cy, rw, rh } = projectRect(view, selected, ref, cssW, cssH);
    ctx.strokeStyle = selected.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);

    if (editable) {
      const pts = handlePoints(cx, cy, rw, rh);
      ctx.fillStyle = selected.color;
      for (const h of HIT_ORDER) {
        const [hx, hy] = pts[h];
        ctx.fillRect(hx - HANDLE_SZ / 2, hy - HANDLE_SZ / 2, HANDLE_SZ, HANDLE_SZ);
      }
    }
  }, [view, selected, frozen, editable]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(parent);
    return () => ro.disconnect();
  }, [draw]);

  // 拖拽: window 级 move/up, 用相对起点的累计位移 (米) 喂 dragHandle(起始 PSR)。
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dU = (e.clientX - d.startX) / d.s0;
      const dV = -(e.clientY - d.startY) / d.s0; // 屏幕 y 朝下 → v 取负
      const psr = dragHandle(d.startPsr, view, d.handle, dU, dV);
      d.last = psr;
      onDragMove(psr);
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onDragEnd(d.last);
    };
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: MouseEvent) => {
      if (!editable || !selected) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { s, cx, cy, rw, rh } = projectRect(view, selected, selected, rect.width, rect.height);
      const handle = hitHandle(px, py, handlePoints(cx, cy, rw, rh));
      if (!handle) return;
      e.preventDefault();
      const startPsr: Psr = {
        center: selected.center,
        size: selected.size,
        rotation: selected.rotation,
      };
      dragRef.current = { handle, startPsr, s0: s, startX: e.clientX, startY: e.clientY, last: startPsr };
      onDragStart(startPsr);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    // 悬停光标反馈 (非拖拽时)。
    const onHover = (e: MouseEvent) => {
      if (dragRef.current || !editable || !selected) return;
      const rect = canvas.getBoundingClientRect();
      const { cx, cy, rw, rh } = projectRect(view, selected, selected, rect.width, rect.height);
      const h = hitHandle(e.clientX - rect.left, e.clientY - rect.top, handlePoints(cx, cy, rw, rh));
      canvas.style.cursor = h ? CURSOR[h] : "default";
    };

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onHover);
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onHover);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [view, selected, editable, onDragStart, onDragMove, onDragEnd]);

  return (
    <canvas
      ref={canvasRef}
      className={editable ? `${styles.triOverlay} ${styles.triOverlayEditable}` : styles.triOverlay}
    />
  );
}

export default TriOrthoView;
