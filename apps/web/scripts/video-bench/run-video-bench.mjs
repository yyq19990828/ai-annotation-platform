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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(__dirname, "fixtures.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const matrix = buildMatrix(config);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
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
  await writeFile(resolve(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
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
