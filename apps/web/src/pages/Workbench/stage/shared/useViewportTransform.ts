import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, Ref } from "react";
import { fitToCanvas } from "./viewport/fit";
import { clampScale, zoomAtPoint } from "./viewport/zoom";

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export function useViewportTransform(initial: Viewport = { scale: 1, tx: 0, ty: 0 }) {
  const [vp, setVp] = useState<Viewport>(initial);
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const reset = useCallback(() => setVp({ scale: 1, tx: 0, ty: 0 }), []);

  const zoomAt = useCallback((cx: number, cy: number, nextScale: number) => {
    setVp((cur) => zoomAtPoint(cur, cx, cy, nextScale));
  }, []);

  const pan = useCallback((dx: number, dy: number) => {
    setVp((cur) => ({ ...cur, tx: cur.tx + dx, ty: cur.ty + dy }));
  }, []);

  const fit = useCallback(
    (viewportW: number, viewportH: number, contentW: number, contentH: number) => {
      const next = fitToCanvas(viewportW, viewportH, contentW, contentH);
      if (next) setVp(next);
    },
    [],
  );

  const setScale = useCallback((s: number) => {
    setVp((cur) => ({ ...cur, scale: clampScale(s) }));
  }, []);

  return { vp, vpRef, reset, zoomAt, pan, fit, setScale, setVp };
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    (ref as MutableRefObject<T | null>).current = value;
  }
}

export function useElementSize<T extends HTMLElement>(forwardedRef?: Ref<T>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  // el 用 state 持有当前被 observe 的节点。用 callback ref：元素挂载 / 卸载 / 重挂载时 React
  // 直接回调拿到真实节点并 setEl，触发下方 effect 切换 ResizeObserver 订阅。这天然覆盖了两个
  // 故障场景：VideoStage / ImageStage 从 loading/error 切回主渲染、或切换 task 导致 DOM
  // unmount → remount 时 ResizeObserver 粘在旧节点 (B-30)；容器在 isLoading / 无 manifest 时
  // 不渲染、manifest 异步到达后才挂载真节点 (B-55) —— 都由 React 在挂载时回调保证拿到新节点，
  // 无需"无依赖 effect 每次 render 轮询 ref.current"，少跑一次 effect。forwardedRef 把节点
  // 回写给调用方自己的 ref，供其在事件 handler 中读取 .current。
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback(
    (node: T | null) => {
      setEl(node);
      setRef(forwardedRef, node);
    },
    [forwardedRef],
  );
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
  return { ref, size };
}
