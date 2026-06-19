// v0.16.x 第 2 批 · 从 ThreeDWorkbench 抽出的悬浮相机面板布局 hook:
// 相机面板位置/折叠态落库(按 role 分桶,经 onWorkbenchLayoutChange 回写 user config)、
// 窄屏自动折叠(ResizeObserver)、旧 localStorage 键一次性迁移兜底。
// viewportWrapRef 由壳层共用(还驱动 toolbar 高度 / triFloatBounds 两个 effect),故作参数传入。
// 逐字搬运,行为零变化。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CameraPanelState } from "@/api/auth";
import type { WorkbenchLayoutPatch } from "@/pages/Workbench/state/useWorkbenchConfig";
import { CAMERA_AUTO_COLLAPSE_WIDTH } from "./ThreeDWorkbench.helpers";

interface UseCameraPanelsParams {
  cameraPanels: Record<string, CameraPanelState>;
  onWorkbenchLayoutChange: (patch: WorkbenchLayoutPatch) => void;
  viewportWrapRef: RefObject<HTMLDivElement>;
}

export function useCameraPanels({
  cameraPanels,
  onWorkbenchLayoutChange,
  viewportWrapRef,
}: UseCameraPanelsParams) {
  const [autoCollapseCameras, setAutoCollapseCameras] = useState(false);

  // v0.15.x · 相机面板位置/折叠态落库:多面板可连续拖动,故用 ref 取最新整份 Record,
  // 避免相邻回调读到 props 旧值互相覆盖。复位则删该 role 键。
  const cameraPanelsRef = useRef(cameraPanels);
  cameraPanelsRef.current = cameraPanels;
  const handleCameraPanelPosition = useCallback(
    (role: string, pos: { x: number; y: number } | null) => {
      const next = { ...cameraPanelsRef.current };
      const prev = next[role];
      if (pos === null) {
        // 归位:仅清位置;若仍有非默认折叠态则保留该 role 键,否则整键删除。
        if (prev?.collapsed) {
          next[role] = { x: null, y: null, collapsed: true };
        } else {
          delete next[role];
        }
      } else {
        next[role] = { ...prev, x: pos.x, y: pos.y };
      }
      cameraPanelsRef.current = next;
      onWorkbenchLayoutChange({ cameraPanels: next });
    },
    [onWorkbenchLayoutChange],
  );
  const handleCameraPanelCollapsed = useCallback(
    (role: string, collapsed: boolean) => {
      const prev = cameraPanelsRef.current[role];
      const next = { ...cameraPanelsRef.current };
      // 折叠态独立于位置;回到默认(展开)且无自定义位置时整键删除,保持 Record 干净。
      if (!collapsed && prev?.x == null && prev?.y == null) {
        delete next[role];
      } else {
        next[role] = { x: prev?.x ?? null, y: prev?.y ?? null, collapsed };
      }
      cameraPanelsRef.current = next;
      onWorkbenchLayoutChange({ cameraPanels: next });
    },
    [onWorkbenchLayoutChange],
  );
  const handleResetCameraPanels = useCallback(() => {
    cameraPanelsRef.current = {};
    onWorkbenchLayoutChange({ cameraPanels: {} });
  }, [onWorkbenchLayoutChange]);

  // v0.15.x · 一次性迁移兜底:user config 的 cameraPanels 为空但本地仍有旧
  // pcwb:cam-pos / pcwb:cam-collapsed 键时,读出灌入 config 后清掉旧键(避免双写)。
  useEffect(() => {
    if (Object.keys(cameraPanelsRef.current).length > 0) return;
    let migrated: Record<string, CameraPanelState> | null = null;
    const staleKeys: string[] = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        const posMatch = key.match(/^pcwb:cam-pos:(.+)$/);
        const collMatch = key.match(/^pcwb:cam-collapsed:(.+)$/);
        const role = posMatch?.[1] ?? collMatch?.[1];
        if (!role) continue;
        staleKeys.push(key);
        migrated ??= {};
        const entry = (migrated[role] ??= { x: null, y: null });
        if (posMatch) {
          const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
          if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
            entry.x = Number(parsed.x);
            entry.y = Number(parsed.y);
          }
        } else {
          entry.collapsed = window.localStorage.getItem(key) === "1";
        }
      }
    } catch {
      /* 隐私模式 / 解析失败:放弃迁移,不影响功能 */
    }
    if (migrated && Object.keys(migrated).length > 0) {
      cameraPanelsRef.current = migrated;
      onWorkbenchLayoutChange({ cameraPanels: migrated });
    }
    for (const key of staleKeys) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    // 仅首挂载跑一次;onWorkbenchLayoutChange 稳定(useCallback),不进依赖避免重复迁移。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const sync = () => {
      const width = viewportWrapRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setAutoCollapseCameras(width < CAMERA_AUTO_COLLAPSE_WIDTH);
    };
    sync();
    window.addEventListener("resize", sync);
    if (typeof ResizeObserver === "undefined" || !viewportWrapRef.current) {
      return () => window.removeEventListener("resize", sync);
    }
    const observer = new ResizeObserver(sync);
    observer.observe(viewportWrapRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
    // viewportWrapRef 稳定(useRef);仅首挂载装一次 observer。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    autoCollapseCameras,
    handleCameraPanelPosition,
    handleCameraPanelCollapsed,
    handleResetCameraPanels,
  };
}
