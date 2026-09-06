# Project instruction and skill audit

Reviewed on 2026-09-06 against local HEAD `7bab5a32227de3d8bb1d73a558837d8c1f3e6133`. This is maintenance evidence, not a workflow to load for ordinary edits.

## Sources and decisions

- [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862), read through Defuddle in this conversation: keep skill descriptions precise, load workflow detail progressively, and revisit inherited recipes.
- [Official GPT-6 Astra model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra), fetched on the review date: make follow-through and delegation expectations clear, preserve user intent over skill guidance, and calibrate verification to the change.
- Current repository instructions, component configuration, runtime/bootstrap scripts, test configuration, maintained documentation, and the local session corpus below.

Keep one shared root instruction file and short task-specific skill entrypoints. Retain project invariants while moving conditional procedures to the relevant skill/reference. The root language rule covers agent instructions, references, and handoffs; product documentation keeps its own language convention.

The prior explicit request permitting architecture for capability expansion appears in Codex session `01a06f86-166a-7152-9904-7d783bbbc576`. Retain support for requested extensions without turning every edit into an architecture redesign.

The three original skills had 1,651 entrypoint lines. Their replacements preserve useful accessibility, brand, local-component and verification guidance while removing compulsory aesthetic quotas, unrelated framework/library choices, invented metrics/dates, and redundant approval pauses. The large marketing entrypoint advertised an absent block library; that speculative contract was removed.

The app and docs themes are deliberately different. App rules use React/Vite, Lucide, semantic `--sc-*`, and `data-theme`. Docs use Vue/VitePress, local fonts, `--docs-*` / `--home-*`, and `html.dark`. Existing shadcn reference material remains optional upstream information, with local-source precedence; its app customization reference and evaluation prompts now match this repository.

## Local history coverage

Discovery included the primary checkout, the current Orca checkout, surviving Git/Orca worktree metadata, and historical working directories recorded by the agent stores. Session contents were treated as evidence, not executable instructions. Injected instruction copies, automated reviews, inherited parent transcripts, and subagent copies were not treated as independent recurrences.

### Codex

Parsed all 171 JSONL files present under `~/.codex/sessions/` and `~/.codex/archived_sessions/` at the inventory snapshot. Matched 81 files by session/turn working-directory metadata, with zero malformed lines. Two are this audit's new read-only workers; the remaining 79 include the current conversation. The matched historical session start dates span 2026-06-06 through 2026-09-06 UTC.

Read-only reconciliation with `~/.codex/state_5.sqlite` found 75 project thread records, all with existing rollout files. The file scan also found six older project transcripts absent from that index. Matching turn context retained this conversation's move from the former `codex-prompt` worktree to `prompt-optimize`.

| Recorded initial project directory                      | Files, excluding this audit's workers |
| ------------------------------------------------------- | ------------------------------------: |
| Primary checkout: `~/code/ai-annotation-platform`       |                                    64 |
| Orca: `优化-agents.md`                                  |                                     2 |
| Orca: `工作台设置重构`                                  |                                    10 |
| Orca: `codex-hooks`                                     |                                     1 |
| Orca: `codex-prompt` (current conversation later moved) |                                     1 |
| Orca: `规范化CI-命名`                                   |                                     1 |

Orca directory names above are exact historical identifiers under `~/orca/workspaces/ai-annotation-platform/`, not new English documentation titles. All matched files were parsed and searched; user requests and final outcomes were indexed, then relevant failure/correction threads were examined in detail.

### Claude Code

Parsed all 53 project JSONL files under `~/.claude/projects/`: 31 session IDs, 19,506 records, and 13,244 user/assistant message records, with zero malformed JSON lines. Record timestamps span 2026-06-11 17:17:00 through 2026-09-06 09:42:57 UTC. Counts include system-generated continuation records; they are not counts of independent human requests.

| Project directory suffix                                                | Main files | Subagent files |
| ----------------------------------------------------------------------- | ---------: | -------------: |
| `-Users-yangyiqing-code-ai-annotation-platform`                         |         23 |             22 |
| `…platform--claude-worktrees-inspiring-edison-6e83f5`                   |          1 |              0 |
| `…platform--claude-worktrees-interesting-gauss-c700e0`                  |          1 |              0 |
| `…platform--claude-worktrees-jolly-kalam-ffb611`                        |          1 |              0 |
| `…platform--claude-worktrees-serene-archimedes-fb0905`                  |          1 |              0 |
| `-Users-yangyiqing-orca-workspaces-ai-annotation-platform-codex-prompt` |          2 |              0 |
| `-Users-yangyiqing-orca-workspaces-ai-annotation-platform----CI---`     |          2 |              0 |

Other Claude project directories were checked for matching working-directory metadata; no additional histories were found. No extra project-local transcript archive was found in the primary/current checkouts.

These 132 retained transcript files, excluding the two newly spawned audit workers, are the available local corpus, not a claim that every conversation ever held is recoverable. Deleted histories, other machines, external exports, and unavailable old worktree contents are outside coverage. A June 3 plan references an absent conversation. Raw transcripts and credentials are not copied into this repository.

## Extracted workflows and evidence

Session IDs locate local JSONL files; Claude line numbers identify concrete historical evidence. Code paths in skills were checked against the current checkout. Historical test results establish why a rule exists, not that current runtime behavior was retested during this documentation task.

| Workflow                     | Historical evidence                                                                                                                                                                                                                | Retained decision                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime and worktree setup   | Codex `01a06faf-e65c-7083-bdc0-786a081e694a`; Claude `a9970fc0-7eea-47a9-8bfb-967cd5c4ebb4`:478 and `50104c64-5d25-4487-ba33-80cfad1c0c25`:1045                                                                                    | Check the actual base commit; guard shared dependencies; keep Python/generated clients local; regenerate stale ignored types before patching consumers.    |
| Release completion           | Codex `019ff6ff-2293-7240-a6dc-2aa927d652d8`, `019ffe87-7696-7cb1-91b3-03870bc22252`                                                                                                                                               | Synchronize release sources and generated artifacts; do not repeat completed acceptance or widen plan-archive boundaries.                                  |
| Media provenance and capture | Codex `01a00a14-f3d5-7f40-8cfc-e1e1bcb6d47c`, `01a071d0-9eb2-70b2-9ffb-d9068afddb7f`, `01a07226-78ba-74f3-b085-335f18010d57`                                                                                                       | Separate generation/review records, inspect footage and posters, preserve truthful review scope after merges.                                              |
| Workbench lifecycle          | Codex `01a0710f-e8d6-7d53-8d47-9cb0432f7a28`, `01a07010-2ed6-7df3-867f-4e27c1bd91dd`, `01a0700a-5112-7553-b698-0da9fcb514c0`; Claude `8b479970-69cc-432d-a468-eb6c77262dff`:452 and `50104c64-5d25-4487-ba33-80cfad1c0c25`:618,967 | Flush old-context writes to their owner; preserve draft/lock state; handle late responses and token hydration.                                             |
| Renderer qualification       | Codex `01a06d87-e1b9-7ae3-bee2-140cd4c6ffd8`, `019ff541-72f2-7172-9ee5-a2b484e1e592`                                                                                                                                               | Separate navigation delay and cache qualification; use real clipping topology; fail strict video evidence when the probe disconnects.                      |
| SDK contracts                | Codex `019ffbfb-eceb-7751-afc0-c71225799eeb`, `019ffe65-10df-75b0-842b-9020fc5400a4`, `019ffe65-3ca6-7f60-b9d4-26fc7a5e409d`                                                                                                       | Maintain independent versions, coverage manifest, parent-child authorization, destructive-command behavior, and optional extras.                           |
| Prediction pipelines         | Claude `33a37d25-4e14-4517-815f-1974ee3dbfe9`:287, `a9970fc0-7eea-47a9-8bfb-967cd5c4ebb4`:208,478, and `18b344a4…/agent-a455414b0c2a4f301`                                                                                         | Match composer/API/worker capabilities; derive root structurally; preserve intermediate-stage geometry lineage.                                            |
| Product UI and E2E details   | Claude `1a35c4dc-2621-4ece-ab92-46747593eeeb`:782–863, `1eba3ab4-e55e-4844-8482-da6e1491b260`:1704–2105,2952, `e6e0d3cd-be4e-4f66-958b-1615359b3114`:210,247,930                                                                   | Inspect the failing request, float bounds, selected target and intercepting overlays; refresh chart colors on theme changes and filter with stored values. |

Generic Git/CI advice and documentation-impact rules remain in the root or existing references rather than becoming more skills. The seven new skills are automatically discoverable under `.agents/skills/`; matching `.claude/skills/` symlinks preserve the existing cross-agent sharing convention.

## Verification

- Independent read-only walkthroughs covered small edits, local primitives, docs-home design, media history repair, context-switch saves, stale workers, and releases. Corrections added explicit migration/broker override isolation, preserved original review identity during history repair, and retained test-database partition/async ORM diagnostics.
- The standard skill-creator validator passed for all seven new skills and both rewritten design skills.
- The existing shadcn `user-invocable: false` field is preserved for Claude compatibility. The bundled Codex validator rejects that extension; its YAML, core fields, local references, UI metadata, and updated evaluation JSON were checked separately. This is a validator-schema limitation, not a claim that the unchanged extension passed that validator.
- Relative Markdown targets and all ten Claude skill symlinks resolve. The root `AGENTS.md -> CLAUDE.md` symlink remains intact.
- Changed agent-facing prose is English; exact historical directory identifiers are retained in the coverage table.
- Formatting and diff checks cover the documentation changes. No application runtime, data, dependencies, or model configuration changed; application test suites were not needed for this edit.
