import { describe, expect, it } from "vitest";
import { isCpuFallback, resolveRuntimeCompute, type MLBackendCompute } from "./mlBackendCompute";

describe("isCpuFallback", () => {
  const cases: Array<[MLBackendCompute | null, boolean]> = [
    [{ configured_device: "cuda", effective_device: "cpu" }, true],
    [
      {
        configured_device: "gpu",
        effective_provider: "CPUExecutionProvider",
      },
      true,
    ],
    [{ configured_device: " CUDA:1 ", effective_device: " CPU " }, true],
    [
      {
        configured_device: "CUDA",
        effective_provider: " cpuexecutionprovider ",
      },
      true,
    ],
    [{ configured_device: "cpu", effective_device: "cpu" }, false],
    [{ configured_device: "unknown", effective_device: "cpu" }, false],
    [{ configured_device: null, effective_device: "cpu" }, false],
    [{ configured_device: "cuda", effective_device: null }, false],
    [{ configured_device: "cuda", effective_provider: null }, false],
    [
      {
        configured_device: "cuda",
        effective_device: "cpu",
        cpu_fallback_supported: false,
      },
      false,
    ],
    [null, false],
  ];

  it.each(cases)("classifies %j as %s", (compute, expected) => {
    expect(isCpuFallback(compute)).toBe(expected);
  });
});

describe("resolveRuntimeCompute", () => {
  const staleCpu = { configured_device: "cuda", effective_device: "cpu" };

  it("keeps a successful real-time null instead of reviving a stale snapshot", () => {
    expect(resolveRuntimeCompute({ status_code: 200, compute: null }, staleCpu)).toBeNull();
  });

  it("uses real-time compute when the HTTP probe succeeds even if backend health is degraded", () => {
    const live = { configured_device: "cuda", effective_device: "cuda" };
    expect(resolveRuntimeCompute({ status_code: 200, ok: false, compute: live }, staleCpu)).toBe(
      live,
    );
  });

  it("falls back to the snapshot when the real-time probe is unavailable", () => {
    expect(resolveRuntimeCompute({ status_code: null }, staleCpu)).toBe(staleCpu);
    expect(resolveRuntimeCompute({ status_code: 503 }, staleCpu)).toBe(staleCpu);
    expect(resolveRuntimeCompute(undefined, staleCpu)).toBe(staleCpu);
  });
});
