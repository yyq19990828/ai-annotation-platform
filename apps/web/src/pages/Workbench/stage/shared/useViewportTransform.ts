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

  const zoomAt = useCallback((cx: number, cy: number, nextScale: number) => {
    setVp((cur) => {
      const s2 = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      if (s2 === cur.scale) return cur;
      const ratio = s2 / cur.scale;
      return {
        scale: s2,
        tx: cx - (cx - cur.tx) * ratio,
        ty: cy - (cy - cur.ty) * ratio,
      };
    });
  }, []);

  const pan = useCallback((dx: number, dy: number) => {
    setVp((cur) => ({ ...cur, tx: cur.tx + dx, ty: cur.ty + dy }));
  }, []);

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

export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  // B-30 · 用 state 跟踪当前实际被 observe 的 element. 之前依赖 [ref] 让 effect 只跑一次,
  // 当 VideoStage / ImageStage 从 loading/error 状态切回主渲染、或切换 task 导致
  // ref.current 指向的 DOM 被 unmount → remount 时, ResizeObserver 还粘在旧节点上,
  // viewport.size 永远不再更新, 表现为 "好了一会儿又不行了" (fit/zoom/Minimap 全失效).
  const [el, setEl] = useState<T | null>(null);
  // 每次 render 后检测 ref.current 与上次 observed 节点的差异; 仅在变化时 setEl 触发
  // 第二个 effect 重新 observe. ref.current 变化会伴随 remount render, el 变更后再完成订阅切换.
  useEffect(() => {
    if (ref.current !== el) {
      setEl(ref.current);
    }
  }, [ref, el]);
  useEffect(() => {
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      const update = () => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
      };
      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    // 同步初次测量, 避免 ResizeObserver 首次回调落地前 size 停在 0×0
    const initial = el.getBoundingClientRect();
    if (initial.width > 0 && initial.height > 0) {
      setSize({ w: initial.width, h: initial.height });
    }
    // 忽略 contentRect = 0×0 (容器 detached / display:none 过渡瞬间), 保留上一次有效尺寸
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return size;
}
