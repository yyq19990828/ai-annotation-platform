#!/usr/bin/env node
// PreToolUse hook (matcher: "Edit|Write|MultiEdit")
// Safety net for harness path-resolution bugs: blocks any file write whose
// resolved target escapes the current working directory subtree.
//
// Rationale: code-modifying subagents run in their own git worktree (forced by
// inject-worktree.mjs). If a write resolves OUTSIDE the session cwd — e.g. a
// subagent edit that lands in the main repo instead of its worktree — we deny
// it. For the main agent, cwd == repo root, so normal edits pass untouched.
//
// Fail-open: if the payload lacks the fields we need, we allow (never wedge the
// session on malformed input). A debug line is appended to a log for auditing.

import { resolve, sep } from 'node:path';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG = join(tmpdir(), 'claude-worktree-guard.log');

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
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function isInside(child, parent) {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let event;
  try {
    event = JSON.parse(raw || '{}');
  } catch {
    emit({}); // malformed -> allow
  }

  const toolInput = event.tool_input ?? {};
  const cwd = event.cwd;
  // Edit / Write / MultiEdit all carry a single file_path.
  const filePath = toolInput.file_path;

  if (!cwd || !filePath) {
    log(`SKIP missing fields cwd=${cwd ?? ''} file_path=${filePath ?? ''}`);
    emit({}); // not enough info -> allow
  }

  const cwdAbs = resolve(cwd);

  // Only enforce when running inside a worktree. The main agent (cwd = repo
  // root) legitimately writes outside the repo (auto-memory at
  // ~/.claude/.../memory, global config, etc.) and must not be restricted.
  const WORKTREE_MARKER = `${sep}.claude${sep}worktrees${sep}`;
  if (!cwdAbs.includes(WORKTREE_MARKER)) {
    emit({}); // not a worktree session -> allow
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
