import { useEffect, useMemo, useRef } from "react";
import {
  clearRasterResourceDiagnostics,
  publishRasterResourceDiagnostics,
} from "@/utils/rasterResourceDiagnostics";
import {
  RasterResourceCoordinator,
  type RasterResourceDeviceBudget,
} from "./rasterResourceCoordinator";

interface UseRasterResourceCoordinatorOptions {
  taskId: string | null | undefined;
  deviceMemory?: number | null;
  budget?: RasterResourceDeviceBudget;
}

let diagnosticsSequence = 0;

export function useRasterResourceCoordinator({
  taskId,
  deviceMemory,
  budget,
}: UseRasterResourceCoordinatorOptions): RasterResourceCoordinator | undefined {
  const coordinator = useMemo(
    () =>
      taskId
        ? new RasterResourceCoordinator({
            ...(budget ? { budget } : {}),
            ...(deviceMemory === undefined ? {} : { deviceMemory }),
          })
        : undefined,
    [budget, deviceMemory, taskId],
  );
  const activeRef = useRef<RasterResourceCoordinator | undefined>(coordinator);
  const diagnosticsToken = useMemo(
    () => (coordinator ? `raster-resources-${++diagnosticsSequence}` : null),
    [coordinator],
  );

  useEffect(() => {
    activeRef.current = coordinator;
    if (!coordinator || !diagnosticsToken) return;
    const publish = () =>
      publishRasterResourceDiagnostics(diagnosticsToken, coordinator.getSnapshot());
    const unsubscribe = coordinator.subscribe(publish);
    publish();
    return () => {
      unsubscribe();
      clearRasterResourceDiagnostics(diagnosticsToken);
      if (activeRef.current === coordinator) activeRef.current = undefined;
      queueMicrotask(() => {
        if (activeRef.current !== coordinator) coordinator.dispose();
      });
    };
  }, [coordinator, diagnosticsToken]);

  useEffect(() => {
    if (!coordinator || typeof document === "undefined" || typeof window === "undefined") return;
    const onVisibilityChange = () => coordinator.setVisible(document.visibilityState !== "hidden");
    const onPageHide = (event: PageTransitionEvent) => coordinator.handlePageHide(event.persisted);
    const onPageShow = (event: PageTransitionEvent) => coordinator.handlePageShow(event.persisted);
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [coordinator]);

  return coordinator;
}
