import { chromium } from "@playwright/test";
import { cpus, platform, release } from "node:os";

const baseUrl = process.env.RASTER_MASK_WEBGPU_BASE_URL ?? "http://localhost:3000";
const iterations = Number(process.env.RASTER_MASK_WEBGPU_OPERATION_ITERATIONS ?? 10);
const warmup = Number(process.env.RASTER_MASK_WEBGPU_OPERATION_WARMUP ?? 3);
const radius = Number(process.env.RASTER_MASK_WEBGPU_RADIUS ?? 2);
const candidateBudgetMiB = Number(process.env.RASTER_MASK_WEBGPU_OPERATION_BUDGET_MIB ?? 128);
const headless = process.env.RASTER_MASK_WEBGPU_HEADLESS !== "0";
const requireWebGpu = process.env.RASTER_MASK_WEBGPU_REQUIRE === "1";
const executablePath = process.env.RASTER_MASK_WEBGPU_EXECUTABLE_PATH;
const enableUnsafeVulkan = process.env.RASTER_MASK_WEBGPU_UNSAFE_VULKAN === "1";
const caseNames = (process.env.RASTER_MASK_WEBGPU_OPERATION_CASES ?? "1024,2048,4k")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const supportedCases = new Set(["1024", "2048", "4k", "unaligned", "overlap", "disjoint"]);

if (
  !Number.isInteger(iterations) ||
  iterations <= 0 ||
  !Number.isInteger(warmup) ||
  warmup < 0 ||
  !Number.isInteger(radius) ||
  radius < 1 ||
  radius > 31 ||
  !Number.isFinite(candidateBudgetMiB) ||
  candidateBudgetMiB <= 0 ||
  !Number.isSafeInteger(candidateBudgetMiB * 1024 * 1024) ||
  caseNames.length === 0 ||
  caseNames.some((value) => !supportedCases.has(value))
) {
  throw new Error("production operation benchmark options are outside the supported range");
}

const launchArgs = ["--enable-precise-memory-info", "--js-flags=--expose-gc"];
if (enableUnsafeVulkan) {
  launchArgs.push(
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE",
    "--use-angle=vulkan",
  );
}

const browser = await chromium.launch({
  headless,
  args: launchArgs,
  ...(executablePath ? { executablePath } : {}),
});
const browserVersion = browser.version();

let result;
try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  result = await page.evaluate(
    async ({ caseNames, iterations, warmup, radius, requireWebGpu, candidateBudgetMiB }) => {
      const moduleUrl = (path) => new URL(path, window.location.origin).href;
      const [{ RasterMaskWorkerPool }, { SparseMaskTileStore }, { encodeCocoRle }] =
        await Promise.all([
          import(moduleUrl("/src/pages/Workbench/stage/shared/rasterMaskWorkerPool.ts")),
          import(moduleUrl("/src/pages/Workbench/stage/shared/sparseMaskTileStore.ts")),
          import(moduleUrl("/src/pages/Workbench/stage/shared/geometry/maskRle.ts")),
        ]);

      const summarize = (values) => {
        const sorted = [...values].sort((left, right) => left - right);
        const percentile = (quantile) =>
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
        return {
          p50_ms: percentile(0.5),
          p95_ms: percentile(0.95),
          max_ms: Math.max(...values),
        };
      };
      const patchChecksum = (command) => {
        let checksum = 2166136261;
        for (const patch of command?.patches ?? []) {
          checksum = Math.imul(checksum ^ patch.tileX, 16777619);
          checksum = Math.imul(checksum ^ patch.tileY, 16777619);
          for (const byte of patch.xorBits) checksum = Math.imul(checksum ^ byte, 16777619);
        }
        return `${command?.changedPixels ?? 0}:${checksum >>> 0}`;
      };
      const rleChecksum = (rle) => {
        let checksum = Math.imul(rle.size[0] ^ rle.size[1], 16777619);
        for (const count of rle.counts) checksum = Math.imul(checksum ^ count, 16777619);
        return `${rle.counts.length}:${checksum >>> 0}`;
      };
      const buildSource = (width, height) => {
        const alpha = new Uint8Array(width * height);
        const x0 = Math.floor(width * 0.12);
        const x1 = Math.floor(width * 0.81);
        const y0 = Math.floor(height * 0.16);
        const y1 = Math.floor(height * 0.84);
        for (let y = y0; y < y1; y += 1) alpha.fill(255, y * width + x0, y * width + x1);
        const holeX0 = Math.floor(width * 0.39);
        const holeX1 = Math.floor(width * 0.57);
        const holeY0 = Math.floor(height * 0.37);
        const holeY1 = Math.floor(height * 0.61);
        for (let y = holeY0; y < holeY1; y += 1) {
          alpha.fill(0, y * width + holeX0, y * width + holeX1);
        }
        for (const [x, y] of [
          [31, 31],
          [32, 32],
          [511, 511],
          [512, 512],
          [width - 1, height - 1],
        ]) {
          if (x >= 0 && y >= 0 && x < width && y < height) alpha[y * width + x] = 255;
        }
        return alpha;
      };

      const pool = new RasterMaskWorkerPool({ size: 1 });
      const cases = [
        { name: "1024", width: 1024, height: 1024 },
        { name: "2048", width: 2048, height: 2048 },
        { name: "4k", width: 3840, height: 2160 },
        {
          name: "unaligned",
          width: 2112,
          height: 2112,
          core: { x: 31, y: 31, width: 2048, height: 2048 },
        },
        {
          name: "overlap",
          width: 3072,
          height: 2048,
          cores: [
            { x: 0, y: 0, width: 2048, height: 2048 },
            { x: 1024, y: 0, width: 2048, height: 2048 },
          ],
        },
        {
          name: "disjoint",
          width: 5120,
          height: 2048,
          cores: [
            { x: 0, y: 0, width: 2048, height: 2048 },
            { x: 3072, y: 0, width: 2048, height: 2048 },
          ],
        },
      ].filter((entry) => caseNames.includes(entry.name));
      const stores = [];
      for (const entry of cases) {
        const baseRle = encodeCocoRle(
          buildSource(entry.width, entry.height),
          entry.width,
          entry.height,
        );
        stores.push({
          ...entry,
          cpu: new SparseMaskTileStore({
            sessionId: `cpu-${entry.name}`,
            sha256: `cpu-${entry.name}`,
            baseRle,
            backend: pool,
            deviceMemory: 8,
            morphologyBackendPolicy: "cpu",
            computeBudgetBytes: 0,
          }),
          candidate: new SparseMaskTileStore({
            sessionId: `candidate-${entry.name}`,
            sha256: `candidate-${entry.name}`,
            baseRle,
            backend: pool,
            deviceMemory: 8,
            morphologyBackendPolicy: "webgpu-candidate",
            computeBudgetBytes: candidateBudgetMiB * 1024 * 1024,
          }),
        });
      }

      let warmupSnapshot = await pool.warmupWebGpu();
      const warmupDeadline = performance.now() + 20_000;
      while (warmupSnapshot.state === "warming" && performance.now() < warmupDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        warmupSnapshot = await pool.warmupWebGpu();
      }
      if (requireWebGpu && warmupSnapshot.state !== "ready") {
        throw new Error(`production WebGPU provider is ${warmupSnapshot.state}`);
      }

      const longTasks = [];
      const observer =
        typeof PerformanceObserver !== "undefined" &&
        PerformanceObserver.supportedEntryTypes?.includes("longtask")
          ? new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) longTasks.push(entry.duration);
            })
          : null;
      observer?.observe({ type: "longtask", buffered: false });
      globalThis.gc?.();
      const heapBefore = performance.memory?.usedJSHeapSize ?? null;
      const rows = [];
      const operation = { operation: "dilate", kernelShape: "square", radius };

      for (const entry of stores) {
        const cores = entry.cores ?? [
          entry.core ?? { x: 0, y: 0, width: entry.width, height: entry.height },
        ];
        const cpuHistory = [];
        const candidateHistory = [];
        const run = async (store, history, name, revision, core) => {
          const started = performance.now();
          const command = await store.morphologyRoi(core, operation, {
            name,
            sourceRevision: revision,
          });
          if (command) {
            store.retainHistoryCommand(command);
            history.push(command);
          }
          const elapsed = performance.now() - started;
          const checksum = patchChecksum(command);
          if (command) store.applyHistoryCommand(command);
          return { elapsed, checksum, compute: pool.getComputeResources() };
        };

        let lastCpu;
        let lastCandidate;
        const cpuWarmupSamples = [];
        const candidateWarmupSamples = [];
        for (let index = 0; index < warmup; index += 1) {
          const core = cores[index % cores.length];
          lastCpu = await run(entry.cpu, cpuHistory, "cpu-warmup", index, core);
          lastCandidate = await run(
            entry.candidate,
            candidateHistory,
            "candidate-warmup",
            index,
            core,
          );
          cpuWarmupSamples.push({
            phase: index === 0 ? "cold" : "warmup",
            core,
            elapsed_ms: lastCpu.elapsed,
            backend: lastCpu.compute.lastBackend,
            fallback_reason: lastCpu.compute.lastFallbackReason,
            metrics: lastCpu.compute.lastMetrics,
          });
          candidateWarmupSamples.push({
            phase: index === 0 ? "cold" : "warmup",
            core,
            elapsed_ms: lastCandidate.elapsed,
            backend: lastCandidate.compute.lastBackend,
            fallback_reason: lastCandidate.compute.lastFallbackReason,
            metrics: lastCandidate.compute.lastMetrics,
          });
        }
        const cpuTimes = [];
        const candidateTimes = [];
        const cpuComputeTimes = [];
        const candidateComputeTimes = [];
        const cpuSamples = [];
        const candidateSamples = [];
        const candidateAllocatedBytes = [];
        const candidateOwnerWorkers = [];
        for (let index = 0; index < iterations; index += 1) {
          const core = cores[(warmup + index) % cores.length];
          lastCpu = await run(entry.cpu, cpuHistory, "cpu", warmup + index, core);
          lastCandidate = await run(
            entry.candidate,
            candidateHistory,
            "candidate",
            warmup + index,
            core,
          );
          if (lastCpu.checksum !== lastCandidate.checksum) {
            throw new Error(`${entry.name}: CPU/WebGPU XOR patch parity mismatch`);
          }
          cpuTimes.push(lastCpu.elapsed);
          candidateTimes.push(lastCandidate.elapsed);
          cpuComputeTimes.push(lastCpu.compute.lastTotalMs ?? 0);
          candidateComputeTimes.push(lastCandidate.compute.lastTotalMs ?? 0);
          cpuSamples.push({
            phase: "measured",
            core,
            elapsed_ms: lastCpu.elapsed,
            backend: lastCpu.compute.lastBackend,
            fallback_reason: lastCpu.compute.lastFallbackReason,
            metrics: lastCpu.compute.lastMetrics,
          });
          candidateSamples.push({
            phase: "measured",
            core,
            elapsed_ms: lastCandidate.elapsed,
            backend: lastCandidate.compute.lastBackend,
            fallback_reason: lastCandidate.compute.lastFallbackReason,
            metrics: lastCandidate.compute.lastMetrics,
          });
          candidateAllocatedBytes.push(lastCandidate.compute.gpuAllocatedBytes);
          candidateOwnerWorkers.push(lastCandidate.compute.gpuOwnerWorkers);
        }
        const cpuSavedRle = await entry.cpu.merge();
        const candidateSavedRle = await entry.candidate.merge();
        const cpuSavedChecksum = rleChecksum(cpuSavedRle);
        const candidateSavedChecksum = rleChecksum(candidateSavedRle);
        if (cpuSavedChecksum !== candidateSavedChecksum) {
          throw new Error(`${entry.name}: CPU/WebGPU save parity mismatch`);
        }
        const reloaded = new SparseMaskTileStore({
          sessionId: `reload-${entry.name}`,
          sha256: `reload-${entry.name}`,
          baseRle: candidateSavedRle,
          backend: pool,
          deviceMemory: 8,
          morphologyBackendPolicy: "cpu",
          computeBudgetBytes: 0,
        });
        const reloadedSavedChecksum = rleChecksum(await reloaded.merge());
        reloaded.dispose();
        if (reloadedSavedChecksum !== candidateSavedChecksum) {
          throw new Error(`${entry.name}: reloaded save parity mismatch`);
        }
        const cpu = summarize(cpuTimes);
        const candidate = summarize(candidateTimes);
        rows.push({
          name: entry.name,
          width: entry.width,
          height: entry.height,
          pixels: entry.width * entry.height,
          backend: lastCandidate.compute.lastBackend,
          fallback_reason: lastCandidate.compute.lastFallbackReason,
          checksum: lastCandidate.checksum,
          cpu,
          candidate,
          worker_cpu: summarize(cpuComputeTimes),
          worker_candidate: summarize(candidateComputeTimes),
          p95_improvement_percent:
            lastCandidate.compute.lastBackend === "webgpu"
              ? ((cpu.p95_ms - candidate.p95_ms) / cpu.p95_ms) * 100
              : null,
          saved_checksum: candidateSavedChecksum,
          reloaded_saved_checksum: reloadedSavedChecksum,
          warmup_samples: { cpu: cpuWarmupSamples, candidate: candidateWarmupSamples },
          resource_plateau: {
            min_allocated_bytes: Math.min(...candidateAllocatedBytes),
            max_allocated_bytes: Math.max(...candidateAllocatedBytes),
            max_owner_workers: Math.max(...candidateOwnerWorkers),
          },
          samples: { cpu: cpuSamples, candidate: candidateSamples },
        });
        for (const command of cpuHistory) entry.cpu.releaseHistoryCommand(command);
        for (const command of candidateHistory) entry.candidate.releaseHistoryCommand(command);
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
      observer?.takeRecords().forEach((entry) => longTasks.push(entry.duration));
      observer?.disconnect();
      globalThis.gc?.();
      const heapAfter = performance.memory?.usedJSHeapSize ?? null;
      const beforeDispose = pool.getSnapshot();
      for (const entry of stores) {
        entry.cpu.dispose();
        entry.candidate.dispose();
      }
      pool.dispose();
      return {
        gate_enabled: beforeDispose.compute.webGpuGateEnabled,
        warmup: warmupSnapshot,
        rows,
        long_tasks: {
          count: longTasks.length,
          total_ms: longTasks.reduce((sum, value) => sum + value, 0),
          max_ms: longTasks.length > 0 ? Math.max(...longTasks) : 0,
        },
        heap: { before: heapBefore, after: heapAfter },
        resources_before_dispose: beforeDispose,
        resources_after_dispose: pool.getSnapshot(),
      };
    },
    { caseNames, iterations, warmup, radius, requireWebGpu, candidateBudgetMiB },
  );
} finally {
  await browser.close();
}

process.stdout.write(
  `${JSON.stringify(
    {
      schema: "mask-webgpu-production-operation/v3",
      generated_at: new Date().toISOString(),
      environment: {
        platform: platform(),
        release: release(),
        cpu: cpus()[0]?.model ?? null,
        browser: browserVersion,
        headless,
        unsafe_vulkan: enableUnsafeVulkan,
      },
      config: { baseUrl, iterations, warmup, radius, candidateBudgetMiB, caseNames },
      result,
    },
    null,
    2,
  )}\n`,
);
