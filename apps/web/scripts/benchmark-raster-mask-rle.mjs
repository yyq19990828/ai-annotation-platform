import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { decodeCocoRle } from "../src/pages/Workbench/stage/shared/geometry/maskRle.ts";

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const iterations = Number(process.env.RASTER_MASK_BENCH_ITERATIONS ?? 7);
const rows = [];

for (const sample of input.samples) {
  for (let warmup = 0; warmup < 2; warmup += 1) decodeCocoRle(sample.rle);
  const timings = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const started = performance.now();
    const decoded = decodeCocoRle(sample.rle);
    timings.push(performance.now() - started);
    if (decoded.length !== sample.width * sample.height) throw new Error("decoded size mismatch");
  }
  timings.sort((a, b) => a - b);
  const percentile = (p) => timings[Math.min(timings.length - 1, Math.floor(timings.length * p))];
  rows.push({
    name: sample.name,
    resolution: sample.resolution,
    iterations,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
  });
}

process.stdout.write(JSON.stringify({ node: process.version, rows }));
