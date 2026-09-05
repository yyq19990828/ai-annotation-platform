import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../.codex/hooks/session-start.mjs", import.meta.url));
const result = spawnSync(process.execPath, [hook], {
  encoding: "utf8",
  input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
});

assert.equal(result.status, 0, result.stderr);
const output = JSON.parse(result.stdout);
assert.equal(output.continue, true);
assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
assert.match(output.hookSpecificOutput.additionalContext, /Platform:/);
assert.match(output.hookSpecificOutput.additionalContext, /CPU:/);
assert.match(output.hookSpecificOutput.additionalContext, /Memory:/);
assert.match(output.hookSpecificOutput.additionalContext, /GPU:/);
console.log("Codex SessionStart hardware context passed.");
