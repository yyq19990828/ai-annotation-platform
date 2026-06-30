import { useEffect, useRef } from "react";
import { create } from "zustand";

// 工作台右下角悬浮按钮列(Issue / 像素落点 / BUG 上报)日常隐藏;
// 光标移动到右下角「指定区域」时露出。状态跨组件共享(按钮分散在 WorkbenchShell 与 App)。

interface FabRevealStore {
  revealed: boolean;
  set: (v: boolean) => void;
}

export const useFabRevealStore = create<FabRevealStore>((set) => ({
  revealed: false,
  set: (v) => set({ revealed: v }),
}));

export const useFabRevealed = (): boolean => useFabRevealStore((s) => s.revealed);

// 右下角触发区:覆盖三个按钮的横向 × 纵向范围(略放大,便于光标命中)。
const ZONE_W = 180;
const ZONE_H = 240;
const HIDE_DELAY_MS = 450;

/**
 * 在工作台顶层调用一次:监听全局指针,光标进入右下角指定区域 → 露出按钮列,
 * 离开后延迟收起(避免边界抖动)。1 次比较 / 移动,低开销;同值不写 store。
 */
export function useFabAutoHideDriver(): void {
  const hideTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const inZone =
        e.clientX >= window.innerWidth - ZONE_W &&
        e.clientY >= window.innerHeight - ZONE_H;
      const { revealed, set } = useFabRevealStore.getState();
      if (inZone) {
        if (hideTimer.current !== undefined) {
          window.clearTimeout(hideTimer.current);
          hideTimer.current = undefined;
        }
        if (!revealed) set(true);
      } else if (revealed && hideTimer.current === undefined) {
        hideTimer.current = window.setTimeout(() => {
          useFabRevealStore.getState().set(false);
          hideTimer.current = undefined;
        }, HIDE_DELAY_MS);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current);
    };
  }, []);
}
