#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const defaultOutDir = resolve(repoRoot, "test-results/video-bench");

function parseArgs(argv) {
  const args = {
    dryRun: false,
    outDir: defaultOutDir,
    baseUrl: process.env.VIDEO_BENCH_BASE_URL ?? "http://localhost:3000",
    scenario: null,
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
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
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
function buildPreciseFrameManifest(config, args, runId) {
  const pf = config.preciseFrame;
  if (!pf) throw new Error("fixtures.json missing preciseFrame config");
  const matrix = pf.resolutions.map((r) => ({
    resolutionId: r.id,
    label: r.label,
    width: r.width,
    height: r.height,
    fps: r.fps,
    scenarios: pf.scenarios,
  }));
  return {
    runId,
    scenario: "precise-frame",
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    environment: {
      chromiumVersion: null,
      gpuAdapter: null,
      hardwareAcceleration: null,
      webcodecsFlag: "on",
      performanceTier: process.env.VIDEO_BENCH_TIER ?? "standard",
      fixtureCodec: null,
      capabilityNote:
        "runner 填充 chromiumVersion / gpuAdapter / hardwareAcceleration / fixtureCodec;" +
        " headless 软解仅记录环境,warm seek / long task 等真实指标需有头 Chrome 或带 GPU 的 runner。",
    },
    matrix,
    budgets: pf.budgets,
    workerDecision: pf.workerDecision,
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
  ];
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
    "## Dedicated Worker 决策 (§9)",
    "",
    `- 触发: **${w.triggered ? "是" : "否"}**`,
    "",
    w.rationale,
    "",
    `**重新触发门**: ${w.retriggerGate}`,
    "",
  ].join("\n");
}

async function runPreciseFrame(config, args, runId) {
  const manifest = buildPreciseFrameManifest(config, args, runId);
  console.log(
    `video-bench precise-frame: ${manifest.matrix.length} resolutions × ${manifest.matrix[0].scenarios.length} scenarios`,
  );
  for (const m of manifest.matrix) console.log(`- ${m.resolutionId}: ${m.label}`);
  console.log(`worker decision: triggered=${manifest.workerDecision.triggered}`);
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
  await writeFile(resolve(runDir, "summary.md"), `${preciseFrameSummary(manifest)}\n`, "utf8");
  console.log(`wrote ${resolve(runDir, "manifest.json")}`);
  console.log(`wrote ${resolve(runDir, "summary.md")}`);
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
