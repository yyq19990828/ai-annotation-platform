#!/usr/bin/env node
// PreToolUse hook (matcher: "Task")
// Deterministically forces code-modifying subagents to run in their own git
// worktree by injecting `isolation: "worktree"` into the Task tool input.
// Read-only / non-code subagents are left untouched.
//
// Uses allow + updatedInput (NOT deny), which is the supported, bug-free path
// for the Task tool. See .claude/settings.json for wiring.

// Subagents that never modify repo code -> no worktree needed.
const READ_ONLY_SUBAGENTS = new Set([
  'Explore',
  'Plan',
  'claude-code-guide',
  'statusline-setup',
]);

function emit(output) {
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
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
    // Malformed input: do nothing, let the call proceed unmodified.
    emit({});
  }

  const toolInput = event.tool_input ?? {};
  const subagentType = toolInput.subagent_type;

  // Already has worktree isolation, or is a read-only agent -> leave as is.
  if (toolInput.isolation === 'worktree' || READ_ONLY_SUBAGENTS.has(subagentType)) {
    emit({});
  }

  // Inject worktree isolation for any code-modifying subagent.
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason:
        `Forcing isolation: "worktree" for subagent "${subagentType ?? 'unknown'}" (project policy).`,
      updatedInput: { ...toolInput, isolation: 'worktree' },
    },
  });
});
