import type { WorkbenchRasterResourceSnapshot } from "@/pages/Workbench/stage/shared/rasterResourceCoordinator";

const MAX_DIAGNOSTIC_JSON_CHARS = 12_000;

export interface RasterResourceDiagnosticsSnapshot {
  route: string;
  updatedAt: string;
  resources: WorkbenchRasterResourceSnapshot;
}

interface RasterResourceDiagnosticsStore extends RasterResourceDiagnosticsSnapshot {
  token: string;
}

function diagnosticsWindow(): {
  __rasterResourceDiagnostics?: RasterResourceDiagnosticsStore;
} | null {
  if (typeof window === "undefined") return null;
  return window as unknown as {
    __rasterResourceDiagnostics?: RasterResourceDiagnosticsStore;
  };
}

function currentRoute(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function stableStringify(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return json.length <= MAX_DIAGNOSTIC_JSON_CHARS
    ? json
    : `${json.slice(0, MAX_DIAGNOSTIC_JSON_CHARS)}\n... truncated`;
}

export function publishRasterResourceDiagnostics(
  token: string,
  resources: WorkbenchRasterResourceSnapshot,
): void {
  const target = diagnosticsWindow();
  if (!target) return;
  target.__rasterResourceDiagnostics = {
    token,
    route: currentRoute(),
    updatedAt: new Date().toISOString(),
    resources: {
      ...resources,
      owners: resources.owners.map((owner) => ({ ...owner })),
      categories: resources.categories.map((category) => ({ ...category })),
    },
  };
}

export function clearRasterResourceDiagnostics(token: string): void {
  const target = diagnosticsWindow();
  if (target?.__rasterResourceDiagnostics?.token === token) {
    delete target.__rasterResourceDiagnostics;
  }
}

export function getRasterResourceDiagnosticsSnapshot(): RasterResourceDiagnosticsSnapshot | null {
  const store = diagnosticsWindow()?.__rasterResourceDiagnostics;
  if (!store || store.route !== currentRoute()) return null;
  return {
    route: store.route,
    updatedAt: store.updatedAt,
    resources: {
      ...store.resources,
      owners: store.resources.owners.map((owner) => ({ ...owner })),
      categories: store.resources.categories.map((category) => ({ ...category })),
    },
  };
}

export function appendRasterResourceDiagnostics(
  description: string,
  snapshot: RasterResourceDiagnosticsSnapshot | null,
): string {
  if (!snapshot) return description;
  return `${description}\n\n---\n\n### Workbench Raster Resource Diagnostics\n\n\`\`\`json\n${stableStringify(snapshot)}\n\`\`\``;
}

export function rasterResourceDiagnosticsConsoleEntry(
  snapshot: RasterResourceDiagnosticsSnapshot | null,
): { msg: string; stack: string } | null {
  if (!snapshot) return null;
  return {
    msg: "[workbench-raster-resource-diagnostics]",
    stack: stableStringify(snapshot),
  };
}
