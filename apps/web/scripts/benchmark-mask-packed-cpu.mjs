import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";

const baseUrl = process.env.RASTER_MASK_PACKED_CPU_BASE_URL ?? "http://localhost:3000";
const iterations = Number(process.env.RASTER_MASK_PACKED_CPU_ITERATIONS ?? 3);
const warmup = Number(process.env.RASTER_MASK_PACKED_CPU_WARMUP ?? 1);
const radius = Number(process.env.RASTER_MASK_WEBGPU_RADIUS ?? 8);
const outputPath = process.env.RASTER_MASK_PACKED_CPU_OUTPUT_PATH;
const caseNames = (process.env.RASTER_MASK_PACKED_CPU_CASES ?? "2048,4k")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const supportedCases = new Set(["2048", "4k"]);

if (
  !Number.isInteger(iterations) ||
  iterations <= 0 ||
  !Number.isInteger(warmup) ||
  warmup < 0 ||
  !Number.isInteger(radius) ||
  radius < 1 ||
  radius > 31 ||
  caseNames.length === 0 ||
  caseNames.some((value) => !supportedCases.has(value))
) {
  throw new Error("packed CPU benchmark options are outside the supported range");
}

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
});
const browserVersion = browser.version();

let result;
try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  result = await page.evaluate(
    async ({ caseNames, iterations, warmup, radius }) => {
      const moduleUrl = (path) => new URL(path, window.location.origin).href;
      const {
        estimateRasterMaskPackedCpuBytes,
        squareDilatePackedXorDirect,
        squareDilatePackedXorSeparable,
      } = await import(
        moduleUrl("/src/pages/Workbench/stage/shared/rasterMaskPackedMorphology.ts")
      );
      const cases = [
        { name: "2048", width: 2048, height: 2048 },
        { name: "4k", width: 3840, height: 2160 },
      ].filter((entry) => caseNames.includes(entry.name));
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
      const equalWords = (left, right) => {
        if (left.length !== right.length) return false;
        for (let index = 0; index < left.length; index += 1) {
          if (left[index] !== right[index]) return false;
        }
        return true;
      };
      const rows = [];
      for (const entry of cases) {
        const wordsPerRow = Math.ceil(entry.width / 32);
        let seed = 0x23_21_00_01;
        const sourceWords = Uint32Array.from(
          { length: wordsPerRow * entry.height },
          (_value, index) => {
            seed = (Math.imul(seed, 1_664_525) + 1_013_904_223 + index) >>> 0;
            return seed & 0x1111_1111;
          },
        );
        const options = {
          sourceWords,
          sourceWordsPerRow: wordsPerRow,
          inputWidth: entry.width,
          inputHeight: entry.height,
          coreOffsetX: 0,
          coreOffsetY: 0,
          coreWidth: entry.width,
          coreHeight: entry.height,
          radius,
        };
        for (let index = 0; index < warmup; index += 1) {
          squareDilatePackedXorDirect(options);
          squareDilatePackedXorSeparable(options);
        }
        const directTimes = [];
        const separableTimes = [];
        let lastDirect;
        let lastSeparable;
        for (let index = 0; index < iterations; index += 1) {
          const directStarted = performance.now();
          lastDirect = squareDilatePackedXorDirect(options);
          directTimes.push(performance.now() - directStarted);
          const separableStarted = performance.now();
          lastSeparable = squareDilatePackedXorSeparable(options);
          separableTimes.push(performance.now() - separableStarted);
          if (!equalWords(lastDirect.xorWords, lastSeparable.xorWords)) {
            throw new Error(`${entry.name}: direct/separable XOR mismatch`);
          }
        }
        const direct = summarize(directTimes);
        const separable = summarize(separableTimes);
        rows.push({
          ...entry,
          pixels: entry.width * entry.height,
          radius,
          direct,
          separable,
          p95_improvement_percent: ((direct.p95_ms - separable.p95_ms) / direct.p95_ms) * 100,
          byte_estimate: estimateRasterMaskPackedCpuBytes({
            inputWidth: entry.width,
            inputHeight: entry.height,
            coreWidth: entry.width,
            coreHeight: entry.height,
          }),
          xor_words: lastSeparable.xorWords.length,
        });
      }
      return { rows };
    },
    { caseNames, iterations, warmup, radius },
  );
} finally {
  await browser.close();
}

const report = {
  schema: "mask-packed-cpu-kernel/v1",
  generated_at: new Date().toISOString(),
  environment: {
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? null,
    browser: browserVersion,
  },
  config: { baseUrl, iterations, warmup, radius, caseNames },
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
