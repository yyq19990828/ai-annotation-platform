#!/usr/bin/env node
// PreToolUse hook (matcher: "Edit|Write|MultiEdit|NotebookEdit")
// Safety net for worktree subagents: when the session cwd is inside
// `.claude/worktrees/` (i.e. a subagent worktree), DENY any file write whose
// resolved target escapes the worktree subtree — guards against harness
// path-resolution bugs leaking subagent edits into the main repo.
//
// Bash is intentionally NOT guarded: subagents need `git commit` to hand their
// branch back to the main process, and an over-broad Bash ban also wedged the
// main agent. Path-escape protection above is the real safety net.
//
// For the main agent (cwd == repo root) the gate is skipped, so it edits
// outside the repo freely (auto-memory, global config, etc.).
//
// Fail-open: if the payload lacks the fields we need, we allow (never wedge the
// session on malformed input). A debug line is appended to a log for auditing.

import { resolve, sep } from "node:path";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOG = join(tmpdir(), "claude-worktree-guard.log");

function log(line) {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // logging is best-effort
  }
}

function emit(output) {
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

function deny(reason) {
  log(`DENY ${reason}`);
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

function isInside(child, parent) {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let event;
  try {
    event = JSON.parse(raw || "{}");
  } catch {
    emit({}); // malformed -> allow
  }

  const toolInput = event.tool_input ?? {};
  const toolName = event.tool_name ?? "";
  const cwd = event.cwd;

  if (!cwd) {
    log(`SKIP missing cwd tool=${toolName}`);
    emit({}); // not enough info -> allow
  }

  const cwdAbs = resolve(cwd);

  // Only enforce when running inside a worktree. The main agent (cwd = repo
  // root) legitimately writes outside the repo (auto-memory at
  // ~/.claude/.../memory, global config, etc.), so it must not be restricted.
  const WORKTREE_MARKER = `${sep}.claude${sep}worktrees${sep}`;
  if (!cwdAbs.includes(WORKTREE_MARKER)) {
    emit({}); // not a worktree session -> allow
  }

  // File-write tools must stay inside the worktree subtree.
  // Edit / Write / MultiEdit carry file_path; NotebookEdit carries notebook_path.
  const filePath = toolInput.file_path ?? toolInput.notebook_path;

  if (!filePath) {
    log(`SKIP missing path tool=${toolName} cwd=${cwdAbs}`);
    emit({}); // not enough info -> allow
  }

  const targetAbs = resolve(cwd, filePath); // resolves both relative and absolute

  if (!isInside(targetAbs, cwdAbs)) {
    deny(
      `write target escapes working directory.\n` +
        `  target: ${targetAbs}\n` +
        `  cwd:    ${cwdAbs}\n` +
        `Rewrite the path to stay inside the working directory (use a relative path).`,
    );
  }

  log(`ALLOW ${targetAbs} (cwd=${cwdAbs})`);
  emit({}); // inside cwd -> allow
});
