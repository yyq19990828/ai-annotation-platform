#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPreciseFrameMeasurements } from "./precise-frame-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const defaultOutDir = resolve(repoRoot, "test-results/video-bench");

function parseArgs(argv) {
  const args = {
    dryRun: false,
    outDir: defaultOutDir,
    baseUrl: process.env.VIDEO_BENCH_BASE_URL ?? "http://localhost:3000",
    scenario: null,
    headed: process.env.VIDEO_BENCH_HEADED === "1",
    strict: process.env.VIDEO_BENCH_STRICT === "1",
    storageState: process.env.VIDEO_BENCH_STORAGE_STATE ?? null,
    playbackSeconds: Number(process.env.VIDEO_BENCH_PLAYBACK_SECONDS ?? 60),
    stabilityOperations: Number(process.env.VIDEO_BENCH_STABILITY_OPERATIONS ?? 5000),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--out") {
      args.outDir = resolve(argv[i + 1] ?? defaultOutDir);
      i += 1;
    } else if (arg === "--base-url") {
      args.baseUrl = argv[i + 1] ?? args.baseUrl;
      i += 1;
    } else if (arg === "--scenario") {
      args.scenario = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--headed") {
      args.headed = true;
    } else if (arg === "--strict") {
      args.strict = true;
    } else if (arg === "--storage-state") {
      args.storageState = resolve(argv[i + 1] ?? "");
      i += 1;
    } else if (arg === "--playback-seconds") {
      args.playbackSeconds = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--stability-operations") {
      args.stabilityOperations = Number(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.playbackSeconds) || args.playbackSeconds <= 0) {
    throw new Error("--playback-seconds must be a positive number");
  }
  if (!Number.isInteger(args.stabilityOperations) || args.stabilityOperations <= 0) {
    throw new Error("--stability-operations must be a positive integer");
  }
  return args;
}

function buildMatrix(config) {
  const matrix = [];
  for (const fixture of config.fixtures) {
    for (const density of config.annotationDensities) {
      matrix.push({
        id: `${fixture.id}-${density.id}`,
        fixtureId: fixture.id,
        densityId: density.id,
        label: `${fixture.label} / ${density.trackCount} tracks`,
        targetFile: fixture.targetFile,
        trackCount: density.trackCount,
        keyframesPerTrack: density.keyframesPerTrack,
        scenarios: config.scenarios,
      });
    }
  }
  return matrix;
}

/**
 * v0.23.15 §8 · WebCodecs 精确帧性能资格矩阵。生成结构化 manifest(§8.2 分辨率 × 场景)、
 * §8.3 退出门 budget 与 §9 Dedicated Worker 决策结论。真实 warm seek / long task / 内存
 * 测量需有 VideoDecoder 的有头 Chrome / GPU runner;headless 仅记录环境与 capability,
 * 不以一台开发机数字宣称硬件 SLA(§8.3)。
 */
function buildPreciseFrameManifest(config, args, runId, measurement) {
  const pf = config.preciseFrame;
  if (!pf) throw new Error("fixtures.json missing preciseFrame config");
  const matrix = pf.resolutions.map((r) => ({
    resolutionId: r.id,
    label: r.label,
    width: r.width,
    height: r.height,
    fps: r.fps,
    taskUrlEnv: r.taskUrlEnv,
    scenarios: pf.scenarios,
    result: measurement.rows.find((row) => row.resolutionId === r.id) ?? null,
  }));
  return {
    runId,
    scenario: "precise-frame",
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    environment: measurement.environment,
    matrix,
    budgets: pf.budgets,
    requiredSamples: pf.samples,
    workerDecision: measurement.workerDecision,
  };
}

function preciseFrameSummary(manifest) {
  const b = manifest.budgets;
  const w = manifest.workerDecision;
  const rows = [
    ["warm same-GOP seek p95", `≤ ${b.warmSameGopSeekP95Ms} ms`],
    ["warm same-chunk random seek p95", `≤ ${b.warmSameChunkRandomSeekP95Ms} ms`],
    ["flag off 新增 precise 请求", `${b.flagOffPreciseRequests}`],
    ["连续播放逐帧 precise 请求", `${b.continuousPlaybackPreciseRequests}`],
    ["stale frame 激活", `${b.staleFrameActivations}`],
    ["预算淘汰后持续内存增长", `${b.budgetEvictionMemoryGrowth}`],
    ["活动 decoder", `≤ ${b.activeDecodersMax}`],
    ["操作结束 live VideoFrame", `${b.liveVideoFramesAfterOps}`],
    ["pipeline JS blocking p95", `≤ ${b.pipelineBlockingP95Ms} ms`],
    ["归因 pipeline 的 ≥50ms long task", `${b.longTaskGte50Ms}`],
    ["连续播放 rAF", `≥ ${b.continuousPlaybackRafFpsMin} fps`],
    ["逐帧交互相对 flag-off rAF", `≥ ${b.interactionRafRatioMin}`],
  ];
  const resultRows = manifest.matrix.map((item) => {
    const summary = item.result?.summary ?? {};
    return [
      item.label,
      summary.status ?? "inconclusive",
      summary.warmSameGopSeekP95Ms ?? "—",
      summary.warmSameChunkRandomSeekP95Ms ?? "—",
      summary.pipelineBlockingP95Ms ?? "—",
      summary.attributedLongTaskGte50Ms ?? "—",
      summary.interactionRafRatio ?? "—",
      summary.fallbackCount ?? "—",
      summary.playbackPreciseRequests ?? "—",
      summary.flagOffPreciseRequests ?? "—",
      summary.staleFrameActivations ?? "—",
      summary.activeDecodersMax ?? "—",
      summary.liveVideoFramesAfterOpsMax ?? "—",
      summary.ledgerGrowthBytes ?? "—",
      summary.resourcesWithinBudget ?? "—",
    ];
  });
  return [
    "# WebCodecs Precise-Frame Bench",
    "",
    `- Run ID: \`${manifest.runId}\``,
    `- Scenario: \`precise-frame\``,
    `- Base URL: \`${manifest.baseUrl}\``,
    `- Performance tier: \`${manifest.environment.performanceTier}\``,
    "",
    "## 退出门 (§8.3)",
    "",
    "| 指标 | 门 |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "> 绝对延迟受硬件影响;真实测量需有头 Chrome / 带 GPU 的 runner,并以固定 runner 阈值与相对 baseline 判定。headless 仅记录环境与 capability,不以一台开发机数字宣称硬件 SLA。",
    "",
    "## 实测结果",
    "",
    "| 矩阵 | 状态 | same-GOP p95(ms) | same-chunk p95(ms) | blocking p95(ms) | ≥50ms long task | 交互 rAF ratio | fallback | 播放请求 | flag-off 请求 | stale | decoder max | live frame max | 账本增长(B) | 资源合规 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...resultRows.map((row) => `| ${row.join(" | ")} |`),
    "",
    "## Dedicated Worker 决策 (§9)",
    "",
    `- 状态: **${w.status}**`,
    `- 触发: **${w.triggered === null ? "未判定" : w.triggered ? "是" : "否"}**`,
    "",
    w.rationale,
    "",
  ].join("\n");
}

async function runPreciseFrame(config, args, runId) {
  const precise = config.preciseFrame;
  if (!precise) throw new Error("fixtures.json missing preciseFrame config");
  console.log(
    `video-bench precise-frame: ${precise.resolutions.length} resolutions × ${precise.scenarios.length} scenarios`,
  );
  for (const resolution of precise.resolutions) {
    console.log(`- ${resolution.id}: ${resolution.label} (${resolution.taskUrlEnv})`);
  }
  if (args.dryRun) {
    console.log("dry-run: matrix only; no browser launched, no Worker decision, no files written");
    return;
  }
  const measurement = await runPreciseFrameMeasurements(precise, args);
  const manifest = buildPreciseFrameManifest(config, args, runId, measurement);
  console.log(
    `worker decision: status=${manifest.workerDecision.status} triggered=${manifest.workerDecision.triggered}`,
  );
  const runDir = resolve(args.outDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    resolve(runDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(resolve(runDir, "summary.md"), `${preciseFrameSummary(manifest)}\n`, "utf8");
  console.log(`wrote ${resolve(runDir, "manifest.json")}`);
  console.log(`wrote ${resolve(runDir, "summary.md")}`);
  if (args.strict && manifest.workerDecision.status !== "not-triggered") {
    throw new Error(`strict precise-frame qualification failed: ${manifest.workerDecision.status}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(__dirname, "fixtures.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");

  if (args.scenario === "precise-frame") {
    await runPreciseFrame(config, args, runId);
    return;
  }

  const matrix = buildMatrix(config);
  const manifest = {
    runId,
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    fixtureConfig: "apps/web/scripts/video-bench/fixtures.json",
    traceOutputDir: `test-results/video-bench/${runId}/traces`,
    reportOutput: `test-results/video-bench/${runId}/summary.json`,
    budgets: config.budgets,
    matrix,
  };

  console.log(`video-bench matrix: ${matrix.length} runs`);
  for (const item of matrix) {
    console.log(`- ${item.id}: ${item.label}`);
  }

  if (args.dryRun) {
    console.log("dry-run: no files written");
    return;
  }

  const runDir = resolve(args.outDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    resolve(runDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(runDir, "README.md"),
    [
      "# Video Bench Run",
      "",
      `- Run ID: \`${runId}\``,
      `- Base URL: \`${args.baseUrl}\``,
      `- Matrix: ${matrix.length} runs`,
      "",
      "Attach this directory to the PR when collecting manual traces:",
      "",
      `\`${manifest.traceOutputDir}\``,
      "",
      "This script currently fixes the benchmark matrix and output contract; Playwright trace capture will be added after the fixture videos are available in local seed data.",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`wrote ${resolve(runDir, "manifest.json")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
