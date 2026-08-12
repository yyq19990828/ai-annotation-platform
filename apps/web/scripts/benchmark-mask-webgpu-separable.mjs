import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";

const baseUrl = process.env.RASTER_MASK_WEBGPU_BASE_URL ?? "http://localhost:3000";
const iterations = Number(process.env.RASTER_MASK_WEBGPU_SEPARABLE_ITERATIONS ?? 10);
const warmup = Number(process.env.RASTER_MASK_WEBGPU_SEPARABLE_WARMUP ?? 3);
const rounds = Number(process.env.RASTER_MASK_WEBGPU_SEPARABLE_ROUNDS ?? 2);
const budgetMiB = Number(process.env.RASTER_MASK_WEBGPU_SEPARABLE_BUDGET_MIB ?? 128);
const headless = process.env.RASTER_MASK_WEBGPU_HEADLESS !== "0";
const requireWebGpu = process.env.RASTER_MASK_WEBGPU_REQUIRE === "1";
const executablePath = process.env.RASTER_MASK_WEBGPU_EXECUTABLE_PATH;
const enableUnsafeVulkan = process.env.RASTER_MASK_WEBGPU_UNSAFE_VULKAN === "1";
const outputPath = process.env.RASTER_MASK_WEBGPU_OUTPUT_PATH;
const radii = (process.env.RASTER_MASK_WEBGPU_SEPARABLE_RADII ?? "8,16,31").split(",").map(Number);
const caseNames = (process.env.RASTER_MASK_WEBGPU_SEPARABLE_CASES ?? "2048,4k,4096")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const patterns = (process.env.RASTER_MASK_WEBGPU_SEPARABLE_PATTERNS ?? "contour")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const supportedCases = new Set(["1024", "2048", "4k", "4096"]);
const supportedPatterns = new Set(["contour", "dense", "checker", "edge", "random"]);

if (
  !Number.isInteger(iterations) ||
  iterations <= 0 ||
  !Number.isInteger(warmup) ||
  warmup < 0 ||
  !Number.isInteger(rounds) ||
  rounds <= 0 ||
  !Number.isFinite(budgetMiB) ||
  budgetMiB <= 0 ||
  !Number.isSafeInteger(budgetMiB * 1024 * 1024) ||
  radii.length === 0 ||
  radii.some((radius) => !Number.isInteger(radius) || radius < 1 || radius > 31) ||
  caseNames.length === 0 ||
  caseNames.some((name) => !supportedCases.has(name)) ||
  patterns.length === 0 ||
  patterns.some((name) => !supportedPatterns.has(name))
) {
  throw new Error("separable qualification benchmark options are outside the supported range");
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
    async ({
      caseNames,
      iterations,
      warmup,
      rounds,
      radii,
      patterns,
      budgetMiB,
      requireWebGpu,
    }) => {
      const moduleUrl = (path) => new URL(path, window.location.origin).href;
      const [{ RasterMaskWebGpuProvider }, { RasterMaskWebGpuSeparableQualificationProvider }] =
        await Promise.all([
          import(moduleUrl("/src/pages/Workbench/stage/shared/rasterMaskWebGpu.ts")),
          import(
            moduleUrl("/src/pages/Workbench/stage/shared/rasterMaskWebGpuSeparableQualification.ts")
          ),
        ]);

      const summarize = (values) => {
        const sorted = [...values].sort((left, right) => left - right);
        const percentile = (quantile) =>
          sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
        return {
          p50_ms: percentile(0.5),
          p95_ms: percentile(0.95),
          max_ms: Math.max(...values),
        };
      };
      const assertEqual = (label, baseline, candidate) => {
        if (baseline.length !== candidate.length) {
          throw new Error(`${label}: XOR length mismatch`);
        }
        for (let index = 0; index < baseline.length; index += 1) {
          if (baseline[index] !== candidate[index]) {
            throw new Error(
              `${label}: XOR mismatch at word ${index} (${baseline[index]} != ${candidate[index]})`,
            );
          }
        }
      };
      const setBit = (words, wordsPerRow, x, y) => {
        words[y * wordsPerRow + (x >>> 5)] |= 1 << (x & 31);
      };
      const buildSource = (width, height, pattern) => {
        const wordsPerRow = Math.ceil(width / 32);
        const words = new Uint32Array(wordsPerRow * height);
        if (pattern === "dense") {
          words.fill(0xffff_ffff);
          for (let y = 0; y < height; y += 17) {
            for (let x = 0; x < width; x += 29) {
              words[y * wordsPerRow + (x >>> 5)] &= ~(1 << (x & 31));
            }
          }
        } else if (pattern === "checker") {
          for (let y = 0; y < height; y += 1) {
            const first = (y >>> 3) & 1 ? 0xff00_ff00 : 0x00ff_00ff;
            const second = ~first >>> 0;
            for (let wordX = 0; wordX < wordsPerRow; wordX += 1) {
              words[y * wordsPerRow + wordX] = wordX & 1 ? second : first;
            }
          }
        } else if (pattern === "edge") {
          for (let x = 0; x < width; x += 1) {
            setBit(words, wordsPerRow, x, 0);
            setBit(words, wordsPerRow, x, height - 1);
          }
          for (let y = 0; y < height; y += 1) {
            setBit(words, wordsPerRow, 0, y);
            setBit(words, wordsPerRow, width - 1, y);
            setBit(words, wordsPerRow, y % width, y);
          }
        } else if (pattern === "random") {
          let state = (width ^ (height << 11) ^ 0x9e37_79b9) >>> 0;
          for (let index = 0; index < words.length; index += 1) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            words[index] = state >>> 0;
          }
        } else {
          const x0 = Math.floor(width * 0.13);
          const x1 = Math.max(x0, Math.floor(width * 0.83) - 1);
          const y0 = Math.floor(height * 0.17);
          const y1 = Math.max(y0, Math.floor(height * 0.79) - 1);
          for (let x = x0; x <= x1; x += 1) {
            setBit(words, wordsPerRow, x, y0);
            setBit(words, wordsPerRow, x, y1);
          }
          for (let y = y0; y <= y1; y += 1) {
            setBit(words, wordsPerRow, x0, y);
            setBit(words, wordsPerRow, x1, y);
          }
          for (let index = 0; index < Math.min(width, height); index += 97) {
            setBit(words, wordsPerRow, index, index);
          }
        }
        const remaining = width & 31;
        if (remaining !== 0) {
          const tailMask = 0xffff_ffff >>> (32 - remaining);
          for (let y = 0; y < height; y += 1) {
            words[y * wordsPerRow + wordsPerRow - 1] &= tailMask;
          }
        }
        return { words, wordsPerRow };
      };

      const baseline = new RasterMaskWebGpuProvider();
      baseline.warmup();
      const baselineState = await baseline.whenSettled();
      const candidate = new RasterMaskWebGpuSeparableQualificationProvider();
      await candidate.initialize();
      if (requireWebGpu && (baselineState !== "ready" || candidate.snapshot().state !== "ready")) {
        throw new Error(
          `WebGPU providers unavailable (one-pass=${baselineState}, separable=${candidate.snapshot().state})`,
        );
      }
      if (baselineState !== "ready" || candidate.snapshot().state !== "ready") {
        return {
          conclusive: false,
          reason: "webgpu-unavailable",
          baseline: baseline.snapshot(),
          candidate: candidate.snapshot(),
        };
      }

      const budgetBytes = budgetMiB * 1024 * 1024;
      const runBaseline = async (options) => {
        const started = performance.now();
        const run = await baseline.runSquareDilateXor(options);
        if (!run.ok) throw new Error(`one-pass failed: ${run.reason}/${run.failureStage}`);
        return { run, elapsedMs: performance.now() - started };
      };
      const runCandidate = async (options) => {
        const started = performance.now();
        const run = await candidate.run(options);
        return { run, elapsedMs: performance.now() - started };
      };

      const exactness = [];
      const exactnessShapes = [
        { name: "tail", width: 65, height: 39, core: { x: 7, y: 3, width: 33, height: 31 } },
        {
          name: "unaligned",
          width: 321,
          height: 193,
          core: { x: 31, y: 17, width: 257, height: 129 },
        },
      ];
      for (const shape of exactnessShapes) {
        for (const pattern of ["contour", "dense", "checker", "edge", "random"]) {
          const source = buildSource(shape.width, shape.height, pattern);
          for (const radius of [1, 4, 8, 16, 31]) {
            const options = {
              sourceWords: source.words,
              sourceWordsPerRow: source.wordsPerRow,
              inputWidth: shape.width,
              inputHeight: shape.height,
              coreOffsetX: shape.core.x,
              coreOffsetY: shape.core.y,
              coreWidth: shape.core.width,
              coreHeight: shape.core.height,
              radius,
              budgetBytes,
            };
            const onePass = await runBaseline(options);
            const separable = await runCandidate(options);
            assertEqual(
              `${shape.name}/${pattern}/r${radius}`,
              onePass.run.xorWords,
              separable.run.xorWords,
            );
            exactness.push({
              shape: shape.name,
              pattern,
              radius,
              words: onePass.run.xorWords.length,
            });
          }
        }
      }

      const cases = [
        { name: "1024", width: 1024, height: 1024 },
        { name: "2048", width: 2048, height: 2048 },
        { name: "4k", width: 3840, height: 2160 },
        { name: "4096", width: 4096, height: 4096 },
      ].filter((entry) => caseNames.includes(entry.name));
      const longTasks = [];
      const observer =
        typeof PerformanceObserver !== "undefined" &&
        PerformanceObserver.supportedEntryTypes?.includes("longtask")
          ? new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) longTasks.push(entry.duration);
            })
          : null;
      observer?.observe({ type: "longtask", buffered: false });
      const rows = [];
      for (const entry of cases) {
        for (const pattern of patterns) {
          const source = buildSource(entry.width, entry.height, pattern);
          for (const radius of radii) {
            const options = {
              sourceWords: source.words,
              sourceWordsPerRow: source.wordsPerRow,
              inputWidth: entry.width,
              inputHeight: entry.height,
              coreOffsetX: 0,
              coreOffsetY: 0,
              coreWidth: entry.width,
              coreHeight: entry.height,
              radius,
              budgetBytes,
            };
            const roundRows = [];
            for (let round = 0; round < rounds; round += 1) {
              for (let index = 0; index < warmup; index += 1) {
                const pair = [() => runBaseline(options), () => runCandidate(options)];
                if ((round + index) & 1) pair.reverse();
                for (const execute of pair) await execute();
              }
              const onePassTotal = [];
              const separableTotal = [];
              const onePassWall = [];
              const separableWall = [];
              let lastOnePass;
              let lastSeparable;
              for (let index = 0; index < iterations; index += 1) {
                const executions = [
                  async () => {
                    lastOnePass = await runBaseline(options);
                    onePassTotal.push(lastOnePass.run.metrics.totalMs);
                    onePassWall.push(lastOnePass.elapsedMs);
                  },
                  async () => {
                    lastSeparable = await runCandidate(options);
                    separableTotal.push(lastSeparable.run.metrics.totalMs);
                    separableWall.push(lastSeparable.elapsedMs);
                  },
                ];
                if ((round + index) & 1) executions.reverse();
                for (const execute of executions) await execute();
              }
              assertEqual(
                `${entry.name}/${pattern}/r${radius}/round${round + 1}`,
                lastOnePass.run.xorWords,
                lastSeparable.run.xorWords,
              );
              const onePass = summarize(onePassTotal);
              const separable = summarize(separableTotal);
              roundRows.push({
                round: round + 1,
                one_pass: onePass,
                separable,
                one_pass_wall: summarize(onePassWall),
                separable_wall: summarize(separableWall),
                p95_improvement_percent:
                  ((onePass.p95_ms - separable.p95_ms) / onePass.p95_ms) * 100,
              });
            }
            const improvements = roundRows.map((round) => round.p95_improvement_percent);
            rows.push({
              case: entry.name,
              width: entry.width,
              height: entry.height,
              pattern,
              radius,
              rounds: roundRows,
              arithmetic_mean_p95_improvement_percent:
                improvements.reduce((sum, value) => sum + value, 0) / improvements.length,
              passes_gate:
                improvements.every((value) => value >= 10) &&
                improvements.reduce((sum, value) => sum + value, 0) / improvements.length >= 15,
            });
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      observer?.takeRecords().forEach((entry) => longTasks.push(entry.duration));
      observer?.disconnect();
      const beforeDispose = {
        baseline: baseline.snapshot(),
        candidate: candidate.snapshot(),
      };
      baseline.dispose();
      candidate.dispose();
      const afterDispose = {
        baseline: baseline.snapshot(),
        candidate: candidate.snapshot(),
      };
      return {
        conclusive: true,
        exactness,
        rows,
        all_rows_pass: rows.length > 0 && rows.every((row) => row.passes_gate),
        long_tasks: {
          count: longTasks.length,
          total_ms: longTasks.reduce((sum, value) => sum + value, 0),
          max_ms: longTasks.length > 0 ? Math.max(...longTasks) : 0,
        },
        resources_before_dispose: beforeDispose,
        resources_after_dispose: afterDispose,
      };
    },
    { caseNames, iterations, warmup, rounds, radii, patterns, budgetMiB, requireWebGpu },
  );
} finally {
  await browser.close();
}

const report = {
  schema: "mask-webgpu-separable-qualification/v1",
  generated_at: new Date().toISOString(),
  environment: {
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? null,
    browser: browserVersion,
    headless,
    unsafe_vulkan: enableUnsafeVulkan,
  },
  config: { baseUrl, iterations, warmup, rounds, radii, caseNames, patterns, budgetMiB },
  result,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized, "utf8");
  process.stdout.write(
    `${JSON.stringify({ schema: report.schema, generated_at: report.generated_at, outputPath })}\n`,
  );
} else {
  process.stdout.write(serialized);
}

if (requireWebGpu && (!result?.conclusive || !result?.all_rows_pass)) process.exitCode = 2;
