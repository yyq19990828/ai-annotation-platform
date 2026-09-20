/**
 * TEMPORARY P9 evidence harness (removed after the bounded built-artifact run).
 *
 * The worktree e2e config always starts `pnpm dev` (useIsolatedServers is true
 * whenever AAP_WORKTREE_MODE exists), so ordinary local runs never exercise
 * the fingerprinted `--mode e2e` production build. This config overrides ONLY
 * the webServer entries: the same owned API command, plus `vite preview` of
 * the exact built dist. Projects, testDir, testMatch, grepInvert, retries,
 * reporter and every other setting stay inherited from the real config.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import base from "./playwright.config";

const configDir = fileURLToPath(new URL(".", import.meta.url));
const isolatedApiPort = process.env.PLAYWRIGHT_ISOLATED_API_PORT ?? "8010";
const isolatedWebPort = process.env.PLAYWRIGHT_ISOLATED_WEB_PORT ?? "3001";
const isCI = Boolean(process.env.CI);
const e2eDatabaseURL = process.env.PLAYWRIGHT_E2E_DATABASE_URL!;
const e2eRuntimeDatabaseURL = process.env.DATABASE_URL!;

const apiCommand = [
  ...(isCI
    ? []
    : ['DATABASE_URL="$MIGRATION_DATABASE_URL" uv run python scripts/prepare_e2e_db.py']),
  "uv run alembic upgrade head",
  `MIGRATION_DATABASE_URL= TEST_DATABASE_URL= PLAYWRIGHT_E2E_DATABASE_URL= uv run uvicorn app.main:app --host 127.0.0.1 --port ${isolatedApiPort}`,
].join(" && ");

export default {
  ...base,
  webServer: [
    {
      command: apiCommand,
      cwd: resolve(configDir, "../api"),
      env: {
        DATABASE_URL: e2eRuntimeDatabaseURL,
        MIGRATION_DATABASE_URL: e2eDatabaseURL,
        ENVIRONMENT: "development",
        E2E_SEED_ENABLED: "true",
      },
      url: `http://127.0.0.1:${isolatedApiPort}/health/db`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Built artifact observation: preview the exact `--mode e2e` dist
      // instead of the dev server.
      command: `pnpm preview --host 127.0.0.1 --port ${isolatedWebPort}`,
      cwd: configDir,
      env: {
        API_PROXY_TARGET: `http://127.0.0.1:${isolatedApiPort}`,
        PORT: isolatedWebPort,
      },
      url: `http://127.0.0.1:${isolatedWebPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
};
