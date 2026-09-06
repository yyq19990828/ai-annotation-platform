# Parallel work in this repository

Read this when delegating modifying work or integrating worker commits.

- Read-only agents can share the checkout. Each modifying agent gets a separate worktree based on the originating checkout's current local `HEAD`, including unpushed commits. Give it an absolute path and a disjoint write scope.
- Prefer native isolation when available. Claude Code uses `isolation: "worktree"` with `.claude/settings.json` setting `worktree.baseRef: "head"`. Otherwise create the isolated checkout before dispatch. If isolation is unavailable, keep edits in the main process.
- For Orca-managed worktrees, use the installed Orca CLI's current guide. A linked child must use the requested local base; the repository's default base may omit unpushed work. Do not assume a child relationship chooses the Git base.
- Require a real commit on each modifying worker's `worktree-agent-*` branch and a report containing the commit hash, changed paths, and verification status.
- Integrate worker commits into the originating branch and validate there when it owns the dependencies/services. Do not force package installs or pretend checks passed in unequipped workers.
- `.claude/hooks/guard-worktree-paths.mjs` guards Claude edit-tool writes inside `.claude/worktrees/` only. Shell writes and other runtimes remain the agent's responsibility.
- After integration, remove only this task's clean, integrated worktrees and merged branches. Use Orca for its managed state, or `git worktree remove`, `git worktree prune`, and `git branch -d` for unmanaged task worktrees. Preserve unmerged or uncommitted work; cherry-picked commits may require equivalence checks before cleanup.
