import type { ImageTileResourceSnapshot } from "@/pages/Workbench/stage/imageTileScheduler";

const MAX_DIAGNOSTIC_JSON_CHARS = 8_000;

export interface ImageTileDiagnosticsSnapshot {
  route: string;
  updatedAt: string;
  resources: ImageTileResourceSnapshot;
}

interface ImageTileDiagnosticsStore extends ImageTileDiagnosticsSnapshot {
  generation: number;
}

function diagnosticsWindow(): {
  __imageTileDiagnostics?: ImageTileDiagnosticsStore;
} | null {
  if (typeof window === "undefined") return null;
  return window as unknown as { __imageTileDiagnostics?: ImageTileDiagnosticsStore };
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

export function publishImageTileDiagnostics(resources: ImageTileResourceSnapshot): void {
  const target = diagnosticsWindow();
  if (!target) return;
  target.__imageTileDiagnostics = {
    generation: resources.generation,
    route: currentRoute(),
    updatedAt: new Date().toISOString(),
    resources: { ...resources },
  };
}

export function clearImageTileDiagnostics(generation: number): void {
  const target = diagnosticsWindow();
  if (target?.__imageTileDiagnostics?.generation === generation) {
    delete target.__imageTileDiagnostics;
  }
}

export function getImageTileDiagnosticsSnapshot(): ImageTileDiagnosticsSnapshot | null {
  const store = diagnosticsWindow()?.__imageTileDiagnostics;
  if (!store || store.route !== currentRoute()) return null;
  return {
    route: store.route,
    updatedAt: store.updatedAt,
    resources: { ...store.resources },
  };
}

export function appendImageTileDiagnostics(
  description: string,
  snapshot: ImageTileDiagnosticsSnapshot | null,
): string {
  if (!snapshot) return description;
  return `${description}\n\n---\n\n### Large Image Tile Diagnostics\n\n\`\`\`json\n${stableStringify(snapshot)}\n\`\`\``;
}

export function imageTileDiagnosticsConsoleEntry(
  snapshot: ImageTileDiagnosticsSnapshot | null,
): { msg: string; stack: string } | null {
  if (!snapshot) return null;
  return {
    msg: "[large-image-tile-diagnostics]",
    stack: stableStringify(snapshot),
  };
}
