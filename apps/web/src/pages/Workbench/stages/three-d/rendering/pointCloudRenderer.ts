import * as THREE from "three";

import type { PointCloudRendererMode } from "../pointCloudExperiment";

export {
  POINT_CLOUD_WEBGPU_STORAGE_KEY,
  pointCloudRendererModeFromExperiment,
  readPointCloudWebGpuExperiment,
  writePointCloudWebGpuExperiment,
} from "../pointCloudExperiment";
export type { PointCloudRendererMode } from "../pointCloudExperiment";
export type PointCloudActualBackend = "legacy-webgl2" | "webgpu" | "webgl2-fallback";

export interface PointCloudRendererStatus {
  requestedMode: PointCloudRendererMode;
  actualBackend: PointCloudActualBackend;
  initMs: number;
  fallbackReason: string | null;
}

export interface PointCloudRenderer {
  readonly domElement: HTMLCanvasElement;
  autoClear: boolean;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  setScissorTest(enabled: boolean): void;
  setScissor(x: number, y: number, width: number, height: number): void;
  setViewport(x: number, y: number, width: number, height: number): void;
  clearDepth(): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  compileAsync(scene: THREE.Object3D, camera: THREE.Camera): Promise<unknown>;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  dispose(): void;
  forceContextLoss?: () => void;
}

export interface PointCloudRendererSurface {
  renderer: PointCloudRenderer;
  status: PointCloudRendererStatus;
}

interface RendererFactoryOptions {
  mode: PointCloudRendererMode;
  antialias?: boolean;
  onDeviceLost?: (reason: string) => void;
}

function createLegacySurface(
  requestedMode: PointCloudRendererMode,
  antialias: boolean,
  fallbackReason: string | null = null,
  initStartedAt = performance.now(),
): PointCloudRendererSurface {
  const renderer = new THREE.WebGLRenderer({ antialias });
  return {
    renderer,
    status: {
      requestedMode,
      actualBackend: "legacy-webgl2",
      initMs: performance.now() - initStartedAt,
      fallbackReason,
    },
  };
}

export async function createPointCloudRenderer(
  options: RendererFactoryOptions,
): Promise<PointCloudRendererSurface> {
  const startedAt = performance.now();
  const antialias = options.antialias ?? true;
  if (options.mode === "legacy") {
    return createLegacySurface("legacy", antialias, null, startedAt);
  }

  try {
    const THREE_GPU = await import("three/webgpu");
    const renderer = new THREE_GPU.WebGPURenderer({
      antialias,
      alpha: false,
      outputBufferType: THREE_GPU.UnsignedByteType,
    });
    renderer.onDeviceLost = (info) => {
      const reason = [info.api, info.reason, info.message].filter(Boolean).join(": ");
      options.onDeviceLost?.(reason || "device-lost");
    };
    await renderer.init();
    const actualBackend = (
      renderer.backend as typeof renderer.backend & { isWebGPUBackend?: boolean }
    ).isWebGPUBackend
      ? "webgpu"
      : "webgl2-fallback";
    return {
      renderer: renderer as unknown as PointCloudRenderer,
      status: {
        requestedMode: options.mode,
        actualBackend,
        initMs: performance.now() - startedAt,
        fallbackReason: actualBackend === "webgl2-fallback" ? "webgpu-adapter-unavailable" : null,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return createLegacySurface(options.mode, antialias, `webgpu-init-failed: ${reason}`, startedAt);
  }
}

export function disposePointCloudRenderer(renderer: PointCloudRenderer): void {
  renderer.dispose();
  renderer.forceContextLoss?.();
}
