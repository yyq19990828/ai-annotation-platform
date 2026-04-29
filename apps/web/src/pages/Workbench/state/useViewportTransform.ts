import { useCallback, useEffect, useRef, useState } from "react";

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function useViewportTransform(initial: Viewport = { scale: 1, tx: 0, ty: 0 }) {
  const [vp, setVp] = useState<Viewport>(initial);
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const reset = useCallback(() => setVp({ scale: 1, tx: 0, ty: 0 }), []);

  /** 以容器内坐标 (cx, cy) 为锚点缩放至 nextScale。 */
  const zoomAt = useCallback((cx: number, cy: number, nextScale: number) => {
    setVp((cur) => {
      const s2 = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      if (s2 === cur.scale) return cur;
      // 公式：保持锚点在视觉上不动
      // tx2 = cx - (cx - tx) * s2 / s
      const ratio = s2 / cur.scale;
      return {
        scale: s2,
        tx: cx - (cx - cur.tx) * ratio,
        ty: cy - (cy - cur.ty) * ratio,
      };
    });
  }, []);

  /** 平移 dx / dy（容器坐标）。 */
  const pan = useCallback((dx: number, dy: number) => {
    setVp((cur) => ({ ...cur, tx: cur.tx + dx, ty: cur.ty + dy }));
  }, []);

  /** 居中以 contentSize 适配 viewportSize（contain 模式）。 */
  const fit = useCallback(
    (viewportW: number, viewportH: number, contentW: number, contentH: number) => {
      if (!contentW || !contentH || !viewportW || !viewportH) return;
      const s = Math.min(viewportW / contentW, viewportH / contentH);
      const tx = (viewportW - contentW * s) / 2;
      const ty = (viewportH - contentH * s) / 2;
      setVp({ scale: s, tx, ty });
    },
    [],
  );

  const setScale = useCallback((s: number) => {
    setVp((cur) => ({ ...cur, scale: clamp(s, MIN_SCALE, MAX_SCALE) }));
  }, []);

  return { vp, vpRef, reset, zoomAt, pan, fit, setScale, setVp };
}

/** 容器尺寸观察（搭配 fit 使用）。 */
export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        setSize({ w: r.width, h: r.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
