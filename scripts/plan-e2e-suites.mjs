import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * E2E suite selection for CI.
 *
 * Two layers live here:
 *
 * 1. The LEGACY gate selection (`planE2ESuites`) that drives the actual
 *    `Frontend E2E` matrix. Its behavior is frozen: P9 owns any gate switch
 *    after comparative shadow execution.
 * 2. The SHADOW selection (`selectSuites`/`shadowPlan`) implementing plan §6:
 *    explicit core/specialty/extended scopes with reasons, docs-only
 *    whitelist, fail-closed diff classification (empty diff, unknown paths,
 *    multiple domains, rename/delete pairs, unsupported events), and a
 *    machine-readable diff against the legacy gate so the planning job can
 *    record what a future switch would change without changing it.
 *
 * Every suite entry documents its scope, trigger paths and reason. Runtime
 * numbers (`collects`/`skips`) come from measured P7 evidence
 * (docs/research/31 §4.1) so collection and runtime-skip differences stay
 * visible alongside the selection.
 */

/** Shared `apps/_shared/*` packages and ML backends: CPU-verifiable contract
 * suites vs hardware/model qualification. `wired: false` entries are surfaced
 * in the shadow report with their run commands but are never scheduled. */
const SHARED_CONTRACT_SUITES = {
  "shared-protocol-v2": {
    command: "bash -lc 'cd apps/_shared/protocol_v2 && uv run --extra test pytest -q'",
    scope: "specialty",
    built: false,
    wired: true,
    triggers: [
      "apps/_shared/protocol_v2/",
      "apps/sam3-backend/",
      "apps/grounded-sam2-backend/",
      "apps/yolo-backend/",
    ],
    reason:
      "protocol v2 schema/vocab/mask-codec contracts consumed by the SAM/yolo backends; pure CPU (pytest + numpy)",
    dependencies: "uv + python 3.11; test extra pytest>=8, numpy>=1.24; no database, no GPU",
  },
  "shared-mask-utils": {
    command: "bash -lc 'cd apps/_shared/mask_utils && uv run --extra test pytest -q'",
    scope: "specialty",
    built: false,
    wired: true,
    triggers: ["apps/_shared/mask_utils/", "apps/grounded-sam2-backend/", "apps/sam3-backend/"],
    reason:
      "shared mask→polygon conversion contracts used by the segmentation backends; pure CPU (pytest + numpy/opencv/shapely)",
    dependencies: "uv + python 3.11; test extra pytest>=8; no database, no GPU",
  },
  "shared-backend-runtime": {
    command: "bash -lc 'cd apps/_shared/backend_runtime && uv run --extra test pytest -q'",
    scope: "qualification",
    built: false,
    wired: false,
    triggers: ["apps/_shared/backend_runtime/"],
    reason:
      "hardware/model qualification: five tests import torch directly (CPU tensor paths); needs the torch toolchain, so it stays out of the PR selection and belongs to a dedicated qualification run",
    dependencies: "uv + torch toolchain; no database; GPU not required but heavyweight",
  },
};

/** ML backend test suites: torch/model weights per backend venv. Recorded for
 * the shadow report with their run commands; never scheduled from the planner. */
const ML_QUALIFICATION_SUITES = [
  "grounded-sam2-backend",
  "sam3-backend",
  "yolo-backend",
  "rapidocr-backend",
  "onnxtools-backend",
].map((backend) => ({
  suite: `ml-${backend}`,
  command: `bash -lc 'cd apps/${backend} && uv run --extra test pytest -q'`,
  scope: "qualification",
  built: false,
  wired: false,
  triggers: [`apps/${backend}/`],
  reason:
    "hardware/model qualification: backend tests need the torch toolchain and (for some cases) real weights; run manually in the backend venv, never from the PR selection",
  dependencies: `uv + ${backend} test extra (torch); local model weights for qualification cases`,
}));

// Plan §6.2 bounded smoke: a real minimal user chain (login → project entry →
// annotate save+refresh → submit/review → permission denial → workbench
// switch). Explicit spec membership, never the whole default suite renamed.
const smoke = [
  {
    suite: "smoke",
    legacyGate: false,
    command:
      "test:e2e e2e/tests/auth.spec.ts e2e/tests/workbench-image-konva-smoke.spec.ts e2e/tests/review-approve-loop.spec.ts e2e/tests/workbench-secondary-permissions.spec.ts e2e/tests/mask-session-guard.spec.ts",
    built: true,
    scope: "smoke",
    reason:
      "bounded real chain: UI login, workbench entry with canvas save+refresh, annotation submit→review approve, permission denial, workbench switch guard",
  },
];

// Full functional matrix: four shards over every functional spec. Runs on
// push/nightly (§6.2 全量) and as the broadened fallback; the legacy PR gate
// still runs it until P9 switches.
const functional = [
  ...["one", "two", "three", "four"].map((name, index) => ({
    suite: `default-${name}`,
    command: `test:e2e --shard=${index + 1}/4`,
    built: true,
    legacyGate: true,
    scope: "full",
    reason: "whole functional suite shard; nightly/full scope, not part of the bounded smoke",
    collects: {
      chromium: 271,
      note: "default --list, list-only; shared Mask specs skip at runtime without a matrix",
    },
  })),
  ...["readonly", "native", "ai-native"].map((name) => ({
    suite: `mask-${name}`,
    command: `test:e2e:mask-${name}`,
    built: false,
    legacyGate: true,
    scope: "specialty",
    triggers: [
      "apps/web/e2e/tests/mask-",
      "apps/web/e2e/tests/raster-mask-",
      "apps/web/src/pages/Workbench/",
      "apps/api/app/api/v1/mask_",
      "apps/api/app/services/",
    ],
    reason: `raster Mask ${name} matrix contract`,
    runtime: {
      "mask-readonly": {
        collects: 13,
        skipped: 11,
        note: "readonly describe executes; native write matrix skipped",
      },
      "mask-native": {
        collects: 22,
        skipped: 2,
        note: "native write + advanced execute; readonly describe skipped",
      },
      "mask-ai-native": {
        collects: 7,
        skipped: 0,
        note: "mock SAM backend + alternative tracker service, not a real model/GPU run",
      },
    }[`mask-${name}`],
  })),
];

function sharedContractEntries() {
  return Object.entries(SHARED_CONTRACT_SUITES)
    .filter(([, suite]) => suite.wired)
    .map(([suite, contract]) => ({ suite, ...contract, scope: "specialty" }));
}

const extended = [
  {
    suite: "visual",
    command: "test:e2e:visual",
    built: true,
    legacyGate: true,
    scope: "extended",
    reason: "visual baselines for shared layout/theme surfaces",
  },
  {
    suite: "layout-stress",
    command: "test:e2e:stress",
    built: true,
    legacyGate: true,
    scope: "extended",
    reason: "long-horizon layout stress (54 rearrangements)",
  },
];

// Shadow-only domain specialties (plan §6.2 受影响专项). Never part of the
// legacy gate; the shadow diff shows what a P9 switch would add.
const domainSpecialties = [
  {
    suite: "video-pipeline",
    command: "test:e2e e2e/tests/video-*.spec.ts e2e/tests/workbench-video-*.spec.ts",
    built: true,
    scope: "specialty",
    triggers: [
      "apps/web/e2e/tests/video-",
      "apps/web/e2e/tests/workbench-video-",
      "apps/web/src/pages/Workbench/stages/video/",
      "apps/api/app/api/v1/video",
      "apps/api/app/services/video",
      "apps/api/app/workers/",
    ],
    reason:
      "video pipeline specialty: manifest/chunk playback, tracker jobs, keyframe and Issue chains",
  },
  {
    suite: "pointcloud",
    command: "test:e2e --project=pointcloud e2e/tests/workbench-pointcloud-*.spec.ts",
    built: true,
    legacyGate: false,
    scope: "specialty",
    triggers: [
      "apps/web/e2e/tests/workbench-pointcloud-",
      "apps/web/src/pages/Workbench/stages/three-d/",
      "apps/api/app/api/v1/lidar",
      "apps/api/app/services/point",
    ],
    reason: "point-cloud specialty under the SwiftShader software-rendering project",
  },
];

export const SUITE_CONTRACT = [...smoke, ...functional, ...domainSpecialties, ...extended];
const allSuites = SUITE_CONTRACT;

// Legacy gate rule (frozen): shared frontend/runtime changes can affect every
// surface, so any app input proposes the extended checks.
function affectsExtended(path) {
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

// Shadow rule (plan §6.3 narrowing proposal): extended checks target shared
// visual/layout surfaces, so only those inputs (plus shared runtime, tooling
// and CI definitions) propose them. P9 evaluates the diff before any switch.
function affectsExtendedShadow(path) {
  return (
    ["apps/web/src/styles/", "apps/web/index.html", "apps/web/e2e/tests/workbench-layout"].some(
      (prefix) => path.startsWith(prefix),
    ) ||
    /\.(css|scss)$/.test(path) ||
    ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".env.example"].includes(
      path,
    ) ||
    /^docker-compose[^/]*\.ya?ml$/.test(path) ||
    /^\.github\/workflows\/(ci|e2e-[^/]+)\.yml$/.test(path) ||
    /^scripts\/plan-e2e-suites(\.test)?\.mjs$/.test(path) ||
    /^apps\/web\/(playwright[^/]*|vite\.config\.ts|tailwind\.config\.[cm]?js|postcss\.config\.cjs)/.test(
      path,
    )
  );
}

const legacyInclude = (eventName, paths) =>
  planE2ESuites(eventName, paths).include.map(({ suite }) => suite);

// Docs-only is a whitelist, never a fallback: executable examples, docs build
// config and anything unrecognized must classify as app code.
const DOCS_ONLY = [
  /^README\.md$/,
  /^LICENSE$/,
  /^CHANGELOG\.md$/,
  /^CONTRIBUTING\.md$/,
  /^\.github\/(PULL_REQUEST_TEMPLATE|ISSUE_TEMPLATE)\//,
  /\.md$/,
  /^docs-site\/(?!dev\/examples\/|\.vitepress\/config)/,
];

function classifyPaths(paths) {
  if (!Array.isArray(paths)) throw new Error("PR changed paths must be supplied");
  const docs = paths.filter((path) => DOCS_ONLY.some((pattern) => pattern.test(path)));
  const docsSet = new Set(docs);
  const appCode = paths.filter((path) => !docsSet.has(path));
  const domains = new Set(
    appCode.map((path) => {
      const topLevel = path.split("/")[0];
      if (topLevel === "apps") return `apps/${path.split("/")[1] ?? ""}`;
      if (
        topLevel === ".github" ||
        topLevel === "scripts" ||
        topLevel === "packages" ||
        topLevel === "docs-site"
      )
        return topLevel;
      return "unknown";
    }),
  );
  return {
    docsOnly: appCode.length === 0 && paths.length > 0,
    emptyDiff: paths.length === 0,
    appCode,
    docs,
    multiDomain: domains.size > 1,
    domains: [...domains],
    unknownPaths: appCode.filter((path) => {
      const topLevel = path.split("/")[0];
      return (
        !["apps", "packages", "scripts", ".github", "docs-site", "docker-compose.yml"].includes(
          topLevel,
        ) &&
        ![
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          ".npmrc",
          ".env.example",
        ].includes(path)
      );
    }),
  };
}

function triggeredSpecialties(appCode) {
  const triggered = [];
  for (const suite of [...SUITE_CONTRACT, ...sharedContractEntries()]) {
    if (suite.scope !== "specialty" || !suite.triggers || suite.wired === false) continue;
    const hit = suite.triggers.find((prefix) => appCode.some((path) => path.startsWith(prefix)));
    if (hit)
      triggered.push({
        suite: suite.suite,
        because: `${suite.reason} (triggered by ${hit})`,
      });
  }
  return triggered;
}

/**
 * Shadow selection per plan §6.2/§6.3. Never drives the gate: the caller keeps
 * using `planE2ESuites` for the matrix and records the diff for P9.
 */
export function selectSuites(eventName, paths) {
  if (eventName === "push" || eventName === "schedule") {
    return {
      planned: allSuites.map(({ suite }) => suite),
      classification: {
        event: eventName,
        note: "explicit full scope: bounded smoke + full functional shards + extended (plan §6.2)",
      },
      reasons: [
        {
          suite: "all",
          selected: true,
          because:
            "post-merge/nightly verification is the explicit full scope (smoke + full shards + extended)",
        },
      ],
      warnings:
        eventName === "schedule"
          ? [
              "legacy gate runs extended-only for schedule; the shadow full selection is a proposed change for P9, not applied",
            ]
          : [],
    };
  }
  if (eventName === "workflow_dispatch") {
    return {
      planned: extended.map(({ suite }) => suite),
      classification: {
        event: "workflow_dispatch",
        note: "manual entry stays extended-only and explicitly labeled",
      },
      reasons: [
        {
          suite: "visual+layout-stress",
          selected: true,
          because: "manual runs select the extended checks explicitly",
        },
      ],
      warnings: [],
    };
  }
  if (eventName !== "pull_request") throw new Error(`Unsupported E2E event: ${eventName}`);
  if (!Array.isArray(paths)) throw new Error("PR changed paths must be supplied");

  const classification = classifyPaths(paths);
  const planned = [];
  const reasons = [];
  const warnings = [];

  if (classification.docsOnly) {
    reasons.push({
      suite: "(none)",
      selected: false,
      because: "docs-only change (whitelisted markdown/docs-site paths); no app E2E required",
    });
  } else {
    // Fail-closed conservative defaults: an empty diff or unrecognized paths
    // must broaden, never narrow.
    if (classification.emptyDiff)
      warnings.push(
        "empty diff cannot be classified; falling back to the full conservative selection",
      );
    if (classification.unknownPaths.length)
      warnings.push(
        `unrecognized top-level paths broaden the selection: ${classification.unknownPaths.join(", ")}`,
      );
    if (classification.multiDomain)
      warnings.push(
        `multiple domains touched (${classification.domains.join(", ")}); broadening the selection`,
      );

    const broaden =
      classification.emptyDiff ||
      classification.unknownPaths.length > 0 ||
      classification.multiDomain;
    const addPlanned = (suite, because) => {
      if (!planned.includes(suite)) {
        planned.push(suite);
        reasons.push({ suite, selected: true, because });
      }
    };
    for (const suite of allSuites.filter(({ scope }) => scope === "smoke"))
      addPlanned(suite.suite, suite.reason);
    for (const { suite, because } of triggeredSpecialties(classification.appCode))
      addPlanned(suite, because);
    if (broaden) {
      for (const suite of allSuites.filter(({ scope }) => scope === "full"))
        addPlanned(
          suite.suite,
          "multi-domain/unknown change broadens to the full functional shards",
        );
    }
    if (broaden || classification.appCode.some(affectsExtendedShadow)) {
      for (const suite of extended) {
        addPlanned(
          suite.suite,
          classification.multiDomain
            ? "multi-domain change broadens verification to the extended checks"
            : "shared visual/layout surface (styles, layout tooling or runtime config) changed",
        );
      }
    }
    if (planned.length === 0)
      throw new Error(
        "Illegal E2E selection: app-code changes must always select at least the core suites",
      );
  }

  return { planned, classification, reasons, warnings };
}

/** Full shadow report: legacy gate suites vs the §6 selection, with the diff
 * and the newly-wired shared CPU contract suites surfaced for P9 review. */
export function shadowPlan(eventName, paths) {
  const { planned, classification, reasons, warnings } = selectSuites(eventName, paths);
  const legacy = legacyInclude(eventName, paths);
  const legacySet = new Set(legacy);
  const plannedSet = new Set(planned);
  const wiredContracts = Object.entries(SHARED_CONTRACT_SUITES)
    .filter(([, suite]) => suite.wired)
    .filter(([, suite]) =>
      eventName !== "pull_request"
        ? false
        : suite.triggers.some((prefix) => (paths ?? []).some((path) => path.startsWith(prefix))),
    )
    .map(([suite, suiteContract]) => ({ suite, ...suiteContract }));
  return {
    legacy,
    planned,
    added: planned.filter((suite) => !legacySet.has(suite)),
    removed: legacy.filter((suite) => !plannedSet.has(suite)),
    classification,
    reasons,
    warnings,
    sharedContracts: {
      wired: wiredContracts,
      qualification: [
        ...Object.entries(SHARED_CONTRACT_SUITES),
        ...ML_QUALIFICATION_SUITES.map((suite) => [suite.suite, suite]),
      ]
        .filter(([, suite]) => !suite.wired)
        .map(([suite, suiteContract]) => ({ suite, ...suiteContract })),
    },
  };
}

// Frozen gate selection derived from the authoritative table's legacyGate
// membership. Byte-for-byte the pre-P8 outputs; P9 owns any change.
export function planE2ESuites(eventName, paths) {
  const legacy = SUITE_CONTRACT.filter((suite) => suite.legacyGate);
  const extendedOnly = ["visual", "layout-stress"];
  if (["schedule", "workflow_dispatch"].includes(eventName))
    return { include: legacy.filter(({ suite }) => extendedOnly.includes(suite)) };
  if (eventName === "push") return { include: legacy };
  if (eventName !== "pull_request") throw new Error(`Unsupported E2E event: ${eventName}`);
  if (!Array.isArray(paths)) throw new Error("PR changed paths must be supplied");
  return {
    include: legacy.filter(
      ({ suite }) => !extendedOnly.includes(suite) || paths.some(affectsExtended),
    ),
  };
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
  const shadow = shadowPlan(eventName, paths);
  console.log(`matrix=${JSON.stringify(planE2ESuites(eventName, paths))}`);
  // Shadow report for P9: recorded by the planning job, never drives the gate.
  console.log(`shadow=${JSON.stringify(shadow)}`);
  // Real wiring for the P6-handoff CPU contract suites (own check, not the
  // Frontend E2E gate): run when their trigger paths changed.
  const sharedContracts =
    eventName === "pull_request" &&
    paths.some((path) =>
      Object.values(SHARED_CONTRACT_SUITES).some(
        (suite) => suite.wired && suite.triggers.some((prefix) => path.startsWith(prefix)),
      ),
    );
  console.log(`shared_contracts=${sharedContracts}`);
}
