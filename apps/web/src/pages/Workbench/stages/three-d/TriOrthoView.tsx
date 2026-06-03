/**
 * v0.13.5 · 单个正交视图的 2D overlay (B-1: 只读, 仅画框矩形 + 标题)。
 *
 * 叠在 TriViewRenderer 该视图 viewport 之上 (同一像素矩形)。框已对齐正交相机, 故投影成一个
 * **居中的轴对齐矩形**: 宽 = size[u]·s、高 = size[v]·s, s = (cssW/2)/halfW (与 frameOrtho 同口径,
 * 与 WebGL 底严丝对齐)。命中/handle/拖拽是 B-2/B-3, 这里先不画。
 *
 * dpr 缩放与重绘时机沿用 CameraProjectionView 模式 (ctx.setTransform(dpr,…) + ResizeObserver)。
 */
import { useCallback, useEffect, useRef } from "react";

import { VIEW_AXES, frameOrtho, type TriView } from "./geometry/triview";
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
  selected: TriSelected | null;
}

export function TriOrthoView({ view, selected }: TriOrthoViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const { u, v } = VIEW_AXES[view];
    const { halfW } = frameOrtho(selected.size, view, cssW / cssH);
    const s = cssW / 2 / halfW; // px per meter (与 WebGL 正交相机同口径)
    const rw = selected.size[u] * s;
    const rh = selected.size[v] * s;
    const cx = cssW / 2;
    const cy = cssH / 2;
    ctx.strokeStyle = selected.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
  }, [view, selected]);

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

  return <canvas ref={canvasRef} className={styles.triOverlay} />;
}

export default TriOrthoView;
