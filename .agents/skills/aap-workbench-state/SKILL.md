---
name: aap-workbench-state
description: Change or diagnose Workbench layout, preferences, task/scene switching, tracker restoration, or editing guards where asynchronous state can outlive its owner.
---

# Workbench state ownership

Trace the affected lifecycle through the existing owner before editing. Read only the relevant path:

| Behavior                        | Current entry points                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Dock layout and persistence     | `layout/WorkbenchDockWorkspace.tsx`, `state/useWorkbenchWorkspaceLayout.ts`, `layout/workbenchLayoutSnapshot.ts` |
| Settings and preference storage | `shell/WorkbenchSettingsDialog.tsx`, `state/useUserPreferences.ts`                                               |
| Scene navigation/playback       | `stages/three-d/SceneTimeline.tsx`, `useScenePlayback.ts` in that directory                                      |
| Task locks                      | `apps/web/src/hooks/useTaskLock.ts`                                                                              |
| Tracker restoration             | `apps/web/src/hooks/useVideoTrackerJobs.ts`                                                                      |

Short paths above are relative to `apps/web/src/pages/Workbench/`. Use [lifecycle cases](references/lifecycle.md) for the specific failure boundaries.

Preserve one owner for each persistence/transaction concern. Component snapshots are restore inputs, not a second live state tree. Validate persisted layout grammar against both `workbenchLayoutSnapshot.ts` and `apps/api/app/schemas/workbench_workspace.py`; derive schema versions and supported contexts from source rather than copying old numbers.

Keep corrupt/newer-schema recovery distinct from missing preferences. Failed loading must not authorize writing defaults over saved data. Retain pending writes and error/retry semantics across context changes without letting retired work mutate a new user/task.

Verify the smallest applicable regression and the affected real interaction: edit, switch context, return, and reload when persistence is involved. For floating-panel defects, include dock/float/redock, focus/keyboard routing, and the shared-canvas surface. Do not infer successful persistence from a visually correct panel.
