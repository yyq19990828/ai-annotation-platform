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

const result = await page.evaluate(
  async ({ width, height, iterations, warmup }) => {
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
    const rleModuleUrl = new URL(
      "/src/pages/Workbench/stage/shared/geometry/maskRle.ts",
      window.location.origin,
    ).href;
    const renderModuleUrl = new URL(
      "/src/pages/Workbench/stage/shared/rasterMaskRender.ts",
      window.location.origin,
    ).href;
    const { encodeCocoRle } = await import(rleModuleUrl);
    const { createTintedRasterMaskImage } = await import(renderModuleUrl);

    const buildSample = (kind) => {
      const alpha = new Uint8Array(width * height);
      const fillRect = (x0, y0, x1, y1, value = 255) => {
        for (let y = y0; y < y1; y += 1) {
          alpha.fill(value, y * width + x0, y * width + x1);
        }
      };
      if (kind === "sparse") {
        fillRect(
          Math.floor(width * 0.42),
          Math.floor(height * 0.35),
          Math.floor(width * 0.58),
          Math.floor(height * 0.65),
        );
      } else if (kind === "dense") {
        alpha.fill(255);
      } else if (kind === "hole") {
        fillRect(
          Math.floor(width * 0.15),
          Math.floor(height * 0.15),
          Math.floor(width * 0.85),
          Math.floor(height * 0.85),
        );
        fillRect(
          Math.floor(width * 0.4),
          Math.floor(height * 0.4),
          Math.floor(width * 0.6),
          Math.floor(height * 0.6),
          0,
        );
      } else {
        fillRect(
          Math.floor(width * 0.05),
          Math.floor(height * 0.08),
          Math.floor(width * 0.2),
          Math.floor(height * 0.3),
        );
        fillRect(
          Math.floor(width * 0.42),
          Math.floor(height * 0.38),
          Math.floor(width * 0.58),
          Math.floor(height * 0.62),
        );
        fillRect(
          Math.floor(width * 0.78),
          Math.floor(height * 0.7),
          Math.floor(width * 0.94),
          Math.floor(height * 0.92),
        );
      }
      return encodeCocoRle(alpha, width, height);
    };

    const workerSource = `
    self.onmessage = async (event) => {
      const rleModule = await import(${JSON.stringify(rleModuleUrl)});
      const renderModule = await import(${JSON.stringify(renderModuleUrl)});
      const decodeStarted = performance.now();
      const [height, width] = event.data.rle.size;
      const alpha = rleModule.decodeCocoRle(event.data.rle);
      const decodeMs = performance.now() - decodeStarted;
      const analyzeStarted = performance.now();
      const analysis = renderModule.analyzeRasterMaskAlpha(alpha, width, height);
      const analyzeMs = performance.now() - analyzeStarted;
      self.postMessage({ analysis, decodeMs, analyzeMs }, [analysis.crop.alpha.buffer]);
    };
  `;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const runWorker = (rle) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(workerUrl, { type: "module" });
        const started = performance.now();
        worker.onmessage = (event) => {
          const workerTotalMs = performance.now() - started;
          worker.terminate();
          resolve({ ...event.data, workerTotalMs });
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(event.message || "benchmark worker failed"));
        };
        worker.postMessage({ rle });
      });

    const rows = [];
    const heapBefore = performance.memory?.usedJSHeapSize ?? null;
    for (const kind of ["sparse", "dense", "hole", "multi_component"]) {
      const rle = buildSample(kind);
      const samples = [];
      for (let index = 0; index < warmup + iterations; index += 1) {
        const pipelineStarted = performance.now();
        const workerResult = await runWorker(rle);
        const bitmapStarted = performance.now();
        const rendered = await createTintedRasterMaskImage(workerResult.analysis, "#8b5cf6");
        const bitmapMs = performance.now() - bitmapStarted;
        const pipelineMs = performance.now() - pipelineStarted;
        if (!rendered) throw new Error(`${kind} produced an empty bitmap`);
        if (typeof rendered.image.close === "function") rendered.image.close();
        if (index >= warmup) {
          samples.push({
            decodeMs: workerResult.decodeMs,
            analyzeMs: workerResult.analyzeMs,
            workerTotalMs: workerResult.workerTotalMs,
            bitmapMs,
            pipelineMs,
            cropPixels: workerResult.analysis.crop.width * workerResult.analysis.crop.height,
            area: workerResult.analysis.area,
            components: workerResult.analysis.componentCount,
            holes: workerResult.analysis.holeCount,
            boundaryPixels: workerResult.analysis.boundaryPixelCount,
          });
        }
      }
      const cropPixels = samples[0].cropPixels;
      rows.push({
        kind,
        area: samples[0].area,
        components: samples[0].components,
        holes: samples[0].holes,
        boundary_pixels: samples[0].boundaryPixels,
        crop_pixels: cropPixels,
        retained_cache_bytes_per_mask: cropPixels * 5,
        estimated_peak_temporary_bytes: width * height + cropPixels * 6,
        decode: summarize(samples.map((sample) => sample.decodeMs)),
        analyze: summarize(samples.map((sample) => sample.analyzeMs)),
        worker_total: summarize(samples.map((sample) => sample.workerTotalMs)),
        bitmap: summarize(samples.map((sample) => sample.bitmapMs)),
        pipeline: summarize(samples.map((sample) => sample.pipelineMs)),
      });
    }
    URL.revokeObjectURL(workerUrl);
    const heapAfter = performance.memory?.usedJSHeapSize ?? null;
    return {
      resolution: [width, height],
      iterations,
      warmup,
      rows,
      heap_before_bytes: heapBefore,
      heap_after_bytes: heapAfter,
      heap_delta_bytes: heapBefore == null || heapAfter == null ? null : heapAfter - heapBefore,
      twenty_mask_cache_bytes: rows.reduce(
        (total, row) => total + row.retained_cache_bytes_per_mask * 5,
        0,
      ),
    };
  },
  { width, height, iterations, warmup },
);

await browser.close();
process.stdout.write(
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      node: process.version,
      browser: "chromium",
      os: `${platform()}-${release()}`,
      cpu: cpus()[0]?.model ?? "unknown",
      base_url: baseUrl,
      ...result,
    },
    null,
    2,
  )}\n`,
);
