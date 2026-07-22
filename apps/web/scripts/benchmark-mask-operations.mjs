import { chromium } from "@playwright/test";
import { cpus, platform, release } from "node:os";

const baseUrl = process.env.RASTER_MASK_BENCH_BASE_URL ?? "http://localhost:3000";
const iterations = Number(process.env.RASTER_MASK_BENCH_ITERATIONS ?? 7);
const warmup = Number(process.env.RASTER_MASK_BENCH_WARMUP ?? 2);
const width = Number(process.env.RASTER_MASK_BENCH_WIDTH ?? 1920);
const height = Number(process.env.RASTER_MASK_BENCH_HEIGHT ?? 1080);

if (![iterations, warmup, width, height].every(Number.isFinite)) {
  throw new Error("benchmark numeric options must be finite");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

const result = await page.evaluate(async ({ width, height, iterations, warmup }) => {
  const summarize = (values) => {
    const sorted = [...values].sort((left, right) => left - right);
    const percentile = (quantile) => sorted[
      Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))
    ];
    return {
      p50_ms: percentile(0.5),
      p95_ms: percentile(0.95),
      max_ms: Math.max(...values),
    };
  };
  const moduleUrl = (path) => new URL(path, window.location.origin).href;
  const { encodeCocoRle } = await import(moduleUrl(
    "/src/pages/Workbench/stage/shared/geometry/maskRle.ts",
  ));
  const { applyMaskOperation } = await import(moduleUrl(
    "/src/pages/Workbench/stage/shared/geometry/maskOperations.ts",
  ));
  const { applyMaskInstanceOperation } = await import(moduleUrl(
    "/src/pages/Workbench/stage/shared/geometry/maskInstanceOperations.ts",
  ));
  const {
    executeRasterMaskInstanceOperationAsync,
    executeRasterMaskOperationAsync,
  } = await import(moduleUrl(
    "/src/pages/Workbench/stage/shared/rasterMaskCompute.ts",
  ));

  const buildSample = (kind) => {
    const alpha = new Uint8Array(width * height);
    const fillRect = (x0, y0, x1, y1, value = 255) => {
      for (let y = y0; y < y1; y += 1) alpha.fill(value, y * width + x0, y * width + x1);
    };
    if (kind === "sparse") {
      fillRect(Math.floor(width * 0.35), Math.floor(height * 0.3), Math.floor(width * 0.65), Math.floor(height * 0.7));
    } else if (kind === "hole") {
      fillRect(Math.floor(width * 0.15), Math.floor(height * 0.15), Math.floor(width * 0.85), Math.floor(height * 0.85));
      fillRect(Math.floor(width * 0.4), Math.floor(height * 0.4), Math.floor(width * 0.6), Math.floor(height * 0.6), 0);
    } else {
      fillRect(Math.floor(width * 0.05), Math.floor(height * 0.08), Math.floor(width * 0.2), Math.floor(height * 0.3));
      fillRect(Math.floor(width * 0.42), Math.floor(height * 0.38), Math.floor(width * 0.58), Math.floor(height * 0.62));
      fillRect(Math.floor(width * 0.78), Math.floor(height * 0.7), Math.floor(width * 0.94), Math.floor(height * 0.92));
      for (let index = 0; index < 16; index += 1) {
        alpha[(10 + index * 3) * width + 10 + index * 5] = 255;
      }
    }
    return alpha;
  };

  const samples = {
    sparse: buildSample("sparse"),
    hole: buildSample("hole"),
    multi_component: buildSample("multi_component"),
  };
  const cases = [
    {
      name: "component_keep",
      sample: "multi_component",
      operation: {
        type: "component",
        action: "keep",
        x: Math.floor(width * 0.1),
        y: Math.floor(height * 0.15),
        connectivity: 4,
      },
    },
    {
      name: "remove_small_components",
      sample: "multi_component",
      operation: { type: "remove_small_components", maxArea: 16, connectivity: 4 },
    },
    {
      name: "fill_all_holes",
      sample: "hole",
      operation: { type: "fill_holes", mode: "all" },
    },
    {
      name: "morphology_close_disk_r2",
      sample: "sparse",
      operation: { type: "morphology", operation: "close", kernelShape: "disk", radius: 2 },
    },
    {
      name: "smooth_square_r2",
      sample: "multi_component",
      operation: { type: "smooth", kernelShape: "square", radius: 2 },
    },
    {
      name: "split_components",
      sample: "multi_component",
      instance: true,
      operation: { type: "split_components", keep: "largest", connectivity: 4 },
    },
  ];

  const heapBefore = performance.memory?.usedJSHeapSize ?? null;
  const rows = [];
  let operationId = 0;
  for (const entry of cases) {
    const source = samples[entry.sample];
    const rle = encodeCocoRle(source, width, height);
    const mainSamples = [];
    const workerSamples = [];
    let resultArea = 0;
    let resultCount = 0;
    for (let index = 0; index < warmup + iterations; index += 1) {
      const mainStarted = performance.now();
      const mainResult = entry.instance
        ? applyMaskInstanceOperation(source, width, height, entry.operation)
        : applyMaskOperation(source, width, height, entry.operation);
      const mainMs = performance.now() - mainStarted;
      operationId += 1;
      const workerStarted = performance.now();
      const workerResult = entry.instance
        ? await executeRasterMaskInstanceOperationAsync(rle, entry.operation, {
            sessionId: "benchmark",
            generation: 1,
            operationId,
          })
        : await executeRasterMaskOperationAsync(rle, entry.operation, {
            sessionId: "benchmark",
            generation: 1,
            operationId,
          });
      const workerMs = performance.now() - workerStarted;
      if (entry.instance) {
        if (!mainResult || !workerResult.plan) throw new Error(`${entry.name} produced no instance plan`);
        resultArea = workerResult.plan.resultAreas.reduce((sum, value) => sum + value, 0);
        resultCount = workerResult.plan.resultCount;
      } else {
        resultArea = workerResult.result.report.afterArea;
        resultCount = workerResult.result.report.afterComponents;
      }
      if (index >= warmup) {
        mainSamples.push(mainMs);
        workerSamples.push(workerMs);
      }
    }
    rows.push({
      name: entry.name,
      sample: entry.sample,
      result_area: resultArea,
      result_count: resultCount,
      main_thread: summarize(mainSamples),
      worker_round_trip: summarize(workerSamples),
    });
  }
  const heapAfter = performance.memory?.usedJSHeapSize ?? null;
  return {
    resolution: [width, height],
    iterations,
    warmup,
    rows,
    heap_before_bytes: heapBefore,
    heap_after_bytes: heapAfter,
    heap_delta_bytes: heapBefore == null || heapAfter == null ? null : heapAfter - heapBefore,
  };
}, { width, height, iterations, warmup });

await browser.close();
process.stdout.write(`${JSON.stringify({
  generated_at: new Date().toISOString(),
  node: process.version,
  browser: "chromium",
  os: `${platform()}-${release()}`,
  cpu: cpus()[0]?.model ?? "unknown",
  base_url: baseUrl,
  ...result,
}, null, 2)}\n`);
