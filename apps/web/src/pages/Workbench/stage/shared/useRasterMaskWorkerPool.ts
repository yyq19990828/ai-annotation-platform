import { useEffect, useMemo, useRef } from "react";
import { RasterMaskWorkerPool } from "./rasterMaskWorkerPool";
import type { RasterResourceCoordinator } from "./rasterResourceCoordinator";

/**
 * Keep one lazy Worker pool per task.
 *
 * React StrictMode replays effects as setup → cleanup → setup in development.
 * Disposal is therefore deferred by one microtask and cancelled when the same
 * pool is leased again, while task switches and real unmounts still release it.
 */
export function useRasterMaskWorkerPool(
  taskId: string | null | undefined,
  resourceCoordinator?: RasterResourceCoordinator,
): RasterMaskWorkerPool | undefined {
  const pool = useMemo(
    () =>
      typeof Worker === "undefined" || !taskId
        ? undefined
        : new RasterMaskWorkerPool({ diagnosticsTaskId: taskId, resourceCoordinator }),
    [resourceCoordinator, taskId],
  );
  const activePoolRef = useRef<RasterMaskWorkerPool | undefined>(pool);

  useEffect(() => {
    activePoolRef.current = pool;
    return () => {
      if (activePoolRef.current === pool) activePoolRef.current = undefined;
      queueMicrotask(() => {
        if (pool && activePoolRef.current !== pool) pool.dispose();
      });
    };
  }, [pool]);

  return pool;
}
