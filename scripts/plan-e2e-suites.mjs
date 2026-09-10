import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const functional = [
  ...["one", "two", "three", "four"].map((name, index) => ({
    suite: `default-${name}`,
    command: `test:e2e --shard=${index + 1}/4`,
    built: true,
  })),
  ...["readonly", "native", "ai-native"].map((name) => ({
    suite: `mask-${name}`,
    command: `test:e2e:mask-${name}`,
    built: false,
  })),
];

const extended = [
  { suite: "visual", command: "test:e2e:visual", built: true },
  { suite: "layout-stress", command: "test:e2e:stress", built: true },
];

function affectsExtended(path) {
  // Start conservatively: shared frontend/runtime changes can affect every surface.
  return (
    ["apps/web/", "apps/api/", "packages/"].some((prefix) => path.startsWith(prefix)) ||
    ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".env.example"].includes(
      path,
    ) ||
    /^docker-compose[^/]*\.ya?ml$/.test(path) ||
    /^\.github\/workflows\/(ci|e2e-[^/]+)\.yml$/.test(path) ||
    /^scripts\/plan-e2e-suites(\.test)?\.mjs$/.test(path)
  );
}

export function planE2ESuites(eventName, paths) {
  if (["schedule", "workflow_dispatch"].includes(eventName)) return { include: extended };
  if (eventName === "push") return { include: [...functional, ...extended] };
  if (eventName !== "pull_request") throw new Error(`Unsupported E2E event: ${eventName}`);
  if (!Array.isArray(paths)) throw new Error("PR changed paths must be supplied");
  return { include: [...functional, ...(paths.some(affectsExtended) ? extended : [])] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const eventName = process.env.GITHUB_EVENT_NAME;
  let paths;
  if (eventName === "pull_request") {
    const base = process.argv[2];
    if (!/^[a-f0-9]{40}$/.test(base ?? "")) throw new Error("A full PR base SHA is required");
    // --no-renames includes both deleted and added paths; NUL handles unusual filenames.
    paths = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);
  }
  console.log(`matrix=${JSON.stringify(planE2ESuites(eventName, paths))}`);
}
