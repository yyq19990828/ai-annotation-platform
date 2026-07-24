// v0.16.x 第 2 批 · 从 ThreeDWorkbench 抽出的选中框 PSR 面板 UI hook:
// 渐进展开 + 整体拖动,展开态与位置偏移按用户记忆(localStorage)。
// 自包含(不碰 Three.js scene),仅依赖 userId;逐字搬运,行为零变化。
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  readPsrPanelUiState,
  writePsrPanelUiState,
  type PsrPanelUiState,
} from "./pointcloudPreferenceStorage";

export function usePsrFloatingPanel(userId: string | null) {
  const [psrPanel, setPsrPanel] = useState<PsrPanelUiState>({ expanded: false, dx: 0, dy: 0 });
  const psrPanelRef = useRef(psrPanel);
  psrPanelRef.current = psrPanel;
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    setPsrPanel(readPsrPanelUiState(userId, window.localStorage));
  }, [userId]);
  const persistPsrPanel = useCallback(
    (next: PsrPanelUiState) => {
      if (userId && typeof window !== "undefined")
        writePsrPanelUiState(userId, next, window.localStorage);
    },
    [userId],
  );
  const togglePsrExpanded = useCallback(() => {
    setPsrPanel((p) => {
      const next = { ...p, expanded: !p.expanded };
      persistPsrPanel(next);
      return next;
    });
  }, [persistPsrPanel]);
  const psrDragRef = useRef<{ sx: number; sy: number; dx0: number; dy0: number } | null>(null);
  const [psrDragging, setPsrDragging] = useState(false);
  const onPsrHeaderPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    // 拖柄落在交互控件(类别下拉 / 锁 / 删 / 展开钮)上时不起拖,保持可点。
    if ((e.target as HTMLElement).closest("button, select, input, a")) return;
    psrDragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      dx0: psrPanelRef.current.dx,
      dy0: psrPanelRef.current.dy,
    };
    setPsrDragging(true);
  }, []);
  useEffect(() => {
    if (!psrDragging) return;
    const onMove = (e: PointerEvent) => {
      const d = psrDragRef.current;
      if (!d) return;
      setPsrPanel((p) => ({ ...p, dx: d.dx0 + e.clientX - d.sx, dy: d.dy0 + e.clientY - d.sy }));
    };
    const onUp = () => {
      psrDragRef.current = null;
      setPsrDragging(false);
      persistPsrPanel(psrPanelRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [psrDragging, persistPsrPanel]);

  return { psrPanel, psrDragging, onPsrHeaderPointerDown, togglePsrExpanded };
}
