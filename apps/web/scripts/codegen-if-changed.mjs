#!/usr/bin/env node
// v0.7.5 · 仅在 OpenAPI snapshot 比生成产物新（或缺产物）时跑 codegen。
// 加速 `pnpm build` —— 默认 prebuild 走这里，跳过未变 snapshot。
//
// 触发重新生成的条件（任一）：
//   1. src/api/generated/types.gen.ts 不存在
//   2. apps/api/openapi.snapshot.json 的 mtime 比 types.gen.ts 新
//   3. OPENAPI_URL 环境变量被显式设置（CI / 自定义场景，绕过 mtime 比较）
//
// 强制重新生成：删除 src/api/generated 后跑 `pnpm build`，或直接 `pnpm codegen`。

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");
const snapshot = resolve(webRoot, "../api/openapi.snapshot.json");
const generated = resolve(webRoot, "src/api/generated/types.gen.ts");

function runCodegen() {
  const result = spawnSync("pnpm", ["codegen"], {
    cwd: webRoot,
    stdio: "inherit",
    shell: true,
  });
  process.exit(result.status ?? 0);
}

if (process.env.OPENAPI_URL) {
  console.log("[codegen-if-changed] OPENAPI_URL set, regenerating");
  runCodegen();
}

if (!existsSync(generated)) {
  console.log("[codegen-if-changed] generated client missing, generating");
  runCodegen();
}

if (!existsSync(snapshot)) {
  console.warn(
    `[codegen-if-changed] snapshot not found at ${snapshot} — skipping (generated kept as-is)`,
  );
  process.exit(0);
}

const snapMtime = statSync(snapshot).mtimeMs;
const genMtime = statSync(generated).mtimeMs;

if (snapMtime > genMtime) {
  console.log("[codegen-if-changed] snapshot newer than generated, regenerating");
  runCodegen();
} else {
  console.log("[codegen-if-changed] snapshot unchanged, skipping codegen");
  process.exit(0);
}
