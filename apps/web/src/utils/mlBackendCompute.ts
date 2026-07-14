export interface MLBackendCompute {
  configured_device?: string | null;
  effective_device?: string | null;
  effective_provider?: string | null;
  cpu_fallback_supported?: boolean | null;
}

interface RuntimeComputeObservation {
  status_code?: number | null;
  ok?: boolean;
  compute?: MLBackendCompute | null;
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/** 已知 GPU 配置的 backend 实际落到 CPU 时返回 true。 */
export function isCpuFallback(compute: MLBackendCompute | null | undefined): boolean {
  if (!compute || compute.cpu_fallback_supported === false) return false;

  const configured = normalized(compute.configured_device);
  const configuredForGpu =
    configured === "gpu" || configured === "cuda" || configured.startsWith("cuda:");
  if (!configuredForGpu) return false;

  return (
    normalized(compute.effective_device) === "cpu" ||
    normalized(compute.effective_provider) === "cpuexecutionprovider"
  );
}

/** 实时探测成功时以实时值为准；探测不可达时才回退到注册表快照。 */
export function resolveRuntimeCompute(
  observation: RuntimeComputeObservation | undefined,
  snapshot: MLBackendCompute | null | undefined,
): MLBackendCompute | null | undefined {
  return observation?.status_code === 200 ? observation.compute : snapshot;
}
