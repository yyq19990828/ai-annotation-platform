import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  RECORDING_FLOWS,
  MARKETING_ONLY_FLOWS,
  recordingPlan,
} from "../e2e/screenshots/recording-plan.mjs";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    flow: { type: "string", multiple: true },
    profile: { type: "string", default: "docs" },
    list: { type: "boolean" },
    plan: { type: "boolean" },
    "validate-only": { type: "boolean" },
  },
});
if (values.list) {
  for (const [id, requirements] of Object.entries(RECORDING_FLOWS)) {
    console.log(
      `${id}\t${requirements.join(",") || "manual (no ML backend)"}\t${MARKETING_ONLY_FLOWS.includes(id) ? "marketing only" : "docs / marketing"}`,
    );
  }
  process.exit(0);
}
const plan = recordingPlan(values.flow ?? [], values.profile);
console.log(JSON.stringify(plan, null, 2));
if (values.plan) process.exit(0);

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const apiRoot = path.resolve(webRoot, "../api");
const databaseUrl = process.env.SCREENSHOT_DATABASE_URL;
if (!databaseUrl || !/(_test|_e2e)$/.test(new URL(databaseUrl).pathname)) {
  throw new Error("SCREENSHOT_DATABASE_URL must select an isolated *_test or *_e2e database.");
}
const redisUrl = process.env.REDIS_URL;
if (!redisUrl || !process.env.CELERY_BROKER_URL) {
  throw new Error(
    "Set REDIS_URL and CELERY_BROKER_URL to the isolated capture Redis before seeding.",
  );
}
const redis = new URL(redisUrl);
const broker = new URL(process.env.CELERY_BROKER_URL);
if (!/^\/[1-9]\d*$/.test(redis.pathname) || redis.href !== broker.href) {
  throw new Error(
    "Capture requires the same explicit nonzero Redis DB for REDIS_URL and CELERY_BROKER_URL.",
  );
}
if (values.profile === "marketing" && process.platform !== "linux") {
  throw new Error("Marketing masters require Linux X11/NVIDIA; use --profile docs on macOS.");
}
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  MIGRATION_DATABASE_URL: databaseUrl,
  PYTHONPATH: ".",
  SCREENSHOT_BACKEND_REQUIREMENTS: plan.backendRequirements,
  SCREENSHOT_RECORDING_FLOWS: plan.flows.join(","),
  SCREENSHOT_RECORDING_PROFILE: plan.profile,
  SCREENSHOT_RECORDING_RUN: `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`,
  SCREENSHOT_VALIDATE_ONLY: values["validate-only"] ? "1" : "0",
};
if (plan.backendRequirements !== "none") {
  const response = await fetch(
    new URL("/health", process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010"),
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error(`Capture API health failed: ${response.status}`);
  const health = await response.json();
  const workers = health?.checks?.celery?.workers ?? [];
  if (!workers.length || workers.some((worker) => !worker.name?.startsWith("screenshots@"))) {
    throw new Error("Live recording requires only screenshots@ workers on the capture API broker.");
  }
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Probe live registered backends during reconciliation, never silently start a stub.
run(
  path.join(apiRoot, ".venv/bin/python"),
  [
    "scripts/seed.py",
    "--profile",
    "screenshots",
    "--offline",
    "--repair",
    "--ml-backend-mode",
    "live",
    "--backend-requirements",
    plan.backendRequirements,
  ],
  apiRoot,
);
if (plan.profile === "marketing") {
  run(process.execPath, ["scripts/run-marketing-capture.mjs", "--grep", plan.grep], webRoot);
} else {
  run(
    path.join(webRoot, "node_modules/.bin/playwright"),
    ["test", "--config=playwright.screenshots.config.ts", "--project=flows", "--grep", plan.grep],
    webRoot,
  );
}
