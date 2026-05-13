import { useCallback, useEffect, useRef } from "react";

/**
 * rAF-coalesced callback scheduler. Multiple schedule() calls within one frame
 * collapse to a single flush() at the next animation frame. The latest task
 * wins; intermediate tasks are dropped. Useful for drag handlers that emit at
 * pointer rate but only need to commit one frame's worth of state.
 *
 * Returns { schedule, flush, cancel }.
 *   schedule(fn): queue fn for next frame (replacing any pending).
 *   flush(): run pending task synchronously (e.g. on mouseup).
 *   cancel(): drop pending without running.
 */
export function useRafThrottle() {
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    if (rafRef.current !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafRef.current);
      else window.clearTimeout(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const flush = useCallback(() => {
    const fn = pendingRef.current;
    pendingRef.current = null;
    if (rafRef.current !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafRef.current);
      else window.clearTimeout(rafRef.current);
      rafRef.current = null;
    }
    if (fn) fn();
  }, []);

  const schedule = useCallback((fn: () => void) => {
    pendingRef.current = fn;
    if (rafRef.current !== null) return;
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    rafRef.current = raf(() => {
      rafRef.current = null;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next) next();
    });
  }, []);

  useEffect(() => cancel, [cancel]);

  return { schedule, flush, cancel };
}
