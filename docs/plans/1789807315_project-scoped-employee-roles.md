# Project-scoped employee roles

> Status: local implementation in progress; Increment A and B1 foundations accepted, B2–B5 running.
> Reviewed: 2026-09-19. Repository baseline: `0529967217464bec8ae8fb6531ec732a777adffd`, branch `feat/platform_opt260919`.
> Source: supplied `project-scoped-employee-roles-plan.md`, dated 2026-09-17, based on `53c19bb0fa6ae133b6b2948b9e36af801866f791`.
> Scope of this review: source, callers, existing contracts, tests and documentation. No application tests, live browser validation, database inspection or migration was performed.
> Release milestone: not assigned. This document does not authorize deployment or data repair.

## 1. Recommendation and scope

Merge the global annotator and reviewer identities into `employee`. Determine annotation and review authority from the employee's membership in the resource's actual project. Reuse `project_members`, existing task assignment helpers, workflow checks, account lifecycle guards and API-key scopes.

The minimum complete result is one account annotating in project A and reviewing in project B without logging out, with the same isolation enforced by HTTP, batch operations, workers and frontend routes. This is a cross-cutting change affecting substantially more than eight files. It needs no new dependency, external service, credential, environment variable or configurable RBAC engine.

```text
Authenticated account + API-key scopes
                  |
Resource ID -> actual project -> owner / membership + project role
                                     |
                          project capabilities
                                     |
                task assignment + state + claim + lock + revision
                                     |
                       review contributor evidence
                                     |
                    authorized read / transactional write

Frontend access response -> project-specific navigation and controls
Workers / sockets       -> the same current authority at their boundaries
```

### Chosen boundaries

| Decision                 | Initial contract                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform roles           | `super_admin`, `project_admin`, `employee`, `viewer`; keep the database and account DTO field named `role`.                                                                               |
| Project roles            | `annotator`, `reviewer`, `viewer`; retain `UNIQUE(project_id, user_id)`. One role per employee per project.                                                                               |
| Employee memberships     | An employee may annotate in A, review in B, and have a read-only membership in C. No membership means no project access unless the account is its legitimate manager.                     |
| Managers                 | Super administrators and project owners retain explicit management paths. A project administrator has no management power over another owner's project through their platform role alone. |
| Viewers                  | Existing platform viewers remain viewers and may only receive viewer memberships. Accepting an employee invitation must not silently upgrade them.                                        |
| Registration             | Public self-registration continues to create a viewer. Administrator-created ordinary staff and staff invitations default to employee.                                                    |
| Role changes and removal | Project owner / super administrator only; preview, revalidate and hand off outstanding work before changing authority.                                                                    |
| Self-review              | Reject a contributor's claim, review edits, approval and rejection of their own submitted work, including manager actions. No implicit super-admin exception.                             |
| Full-project export      | Explicit project capability for reviewer and legitimate manager; deny annotator and viewer. This deliberately tightens the current HTTP gate.                                             |
| Historical attribution   | Preserve user IDs, annotations, review facts, audit entries and performance ownership. Current eligibility is not historical contribution.                                                |
| Terminology              | Account: “员工”; project role: “标注员 / 质检员 / 观察者”. Keep the code value `reviewer`.                                                                                                |

Out of scope: multiple simultaneous roles within one project, custom roles, organizations/tenants, skill-based dispatch, a global current-role switch, changes to public registration policy, a new permission administration UI, and storage-level revocation of already issued URLs.

The load-bearing assumption is that existing project memberships reflect intended project responsibilities. If a global role and a membership disagree, the new model can activate previously unavailable authority. Such rows require an explicit migration decision; never silently overwrite memberships from the old global role or create missing memberships from assignments.

## 2. Review findings and corrections to the supplied draft

| Finding against the current checkout                                                                                                                                                     | Required correction                                                                                                                                                      | Evidence                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| The membership model already supports different roles in different projects, but callers require both global and member roles.                                                           | Change the authority source, not just enum values or labels.                                                                                                             | `db/models/project_member.py`; `services/batch.py::_lock_and_validate_assignment_targets`; `api/v1/projects.py::add_member` |
| The source draft predates changes to staff management, project creation, authentication redirects and dialogs.                                                                           | Use the current checkout's callers and tests, including project creation and account lifecycle.                                                                          | Current `CHANGELOG.md` Unreleased; `git diff 53c19bb0..05299672`                                                            |
| `User.role` and `UserCreate.role` default to annotator, but public registration explicitly creates a viewer.                                                                             | Change staff creation defaults without changing registration.                                                                                                            | `db/models/user.py`; `schemas/user.py::UserCreate`; `api/v1/auth.py` registration                                           |
| Account lifecycle still compares membership roles to the global role and reports `historic_mixed_role`.                                                                                  | Legitimate cross-project employee roles must not become lifecycle blockers. Update receiver selection and preserve management scope restrictions.                        | `services/user_lifecycle.py::_receiver_options`, snapshot construction; `services/management.py`                            |
| Project exports currently depend on project visibility; the frontend permission table is stricter.                                                                                       | State export restriction as a deliberate behavior change and apply it to creation, worker execution, cache hits and result access.                                       | `api/v1/projects.py::export_project`; `workers/export.py`; `api/v1/async_jobs.py::_can_access_job`                          |
| Membership reads already use shared row locks; lifecycle mutation uses `NOWAIT` and nonblocking advisory locks to avoid cycles.                                                          | Extend those mechanisms. Do not require a repository-wide blocking lock-order rewrite.                                                                                   | `api/v1/tasks/_shared.py::_has_current_project_membership`; `services/user_lifecycle.py::_lock_snapshot_rows`               |
| Submit evidence contains the assignee and active annotation authors; it is not a complete history of editors or deleted contributions. The persistent fallback covers first review only. | Persist authorization evidence independently of performance facts, including annotation-phase editors and all submission paths.                                          | `api/v1/tasks/_shared.py::_task_contributor_snapshot`, `_review_round_contributor_snapshot`, `perform_task_submit`          |
| Authentication cache clearing already cancels old queries when user ID or token changes.                                                                                                 | Reuse `bindAuthQueryCache`; avoid inventing a second session epoch or rewriting every query key. Add explicit account/project keys to new access queries.                | `apps/web/src/stores/authQueryCache.ts`; `stores/authQueryCache.test.ts`; `hooks/useProjects.ts`                            |
| The member DTO is flat: its `role` means project role, with no platform-role field. Invitation outputs already have `project_member_role`.                                               | Keep membership `role`, add flat `platform_role`, and retain invitation field naming. Avoid a nested-user or role-alias migration.                                       | `schemas/project.py`; `schemas/invitation.py`; `services/management.py` invitation serializer                               |
| Notification navigation chooses annotation/review from the account's global role. Member labels also treat every non-annotator as reviewer.                                              | Resolve the target project's access before navigation and explicitly render all three project roles.                                                                     | `apps/web/src/components/shell/NotificationsPopover.tsx`; `pages/Projects/sections/MembersSection.tsx`                      |
| The proposed eight PRs cannot each leave a usable system if deployed independently.                                                                                                      | Allow additive preparation, then one complete feature merge/cutover, then optional compatible cleanup. Internal work packages are not independently deployable releases. | Cross-layer dependencies described below                                                                                    |

Backend paths in this table are relative to `apps/api/app/`. These are design findings from static review, not a claim of a complete security audit or production data validation.

## 3. Authority and preserved business rules

Add a small `services/project_access.py` module, with thin dependencies in `deps.py`. Separate `PlatformRole` from `ProjectRole`; do not add a policy language, database permission catalog or generic provider interface.

The immutable request context carries `user_id`, `project_id`, platform role, project role, membership ID/version, manager classification and a fixed set of capabilities. The resolver must reject a context/resource project mismatch. Unknown roles fail closed. Never assign `user.role = member.role` to reuse legacy helpers.

| Operation                                                      | Project annotator                          | Project reviewer                                  | Project viewer                | Legitimate manager                       |
| -------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| Project/guide reads                                            | Allowed                                    | Allowed                                           | Allowed                       | Allowed                                  |
| Task and batch reads                                           | Existing assignment/open-pool/return rules | Existing review visibility and assignment rules   | Existing read-only visibility | Managed project                          |
| Annotation claim, save, submit, skip, annotation AI acceptance | Task write checks                          | Denied                                            | Denied                        | Existing management path and task checks |
| Review claim, approve, reject, review adjustment               | Denied                                     | Claim/state/assignment and non-self-review checks | Denied                        | Same business and non-self-review checks |
| Full export                                                    | Denied                                     | Project export capability                         | Denied                        | Project export capability                |
| Members, project configuration, dispatch                       | Denied                                     | Denied                                            | Denied                        | Allowed in managed project               |
| Account platform-role change                                   | Denied                                     | Denied                                            | Denied                        | Super administrator only                 |

Capabilities are necessary but not sufficient. Preserve task-level assignment overrides, batch defaults, unbatched explicit assignment, open pools, returned tasks during batch review, admin locks, optimistic annotation versions, task locks, review claims, mask QC and video boundary checks. `mode=review` is presentation, never authorization.

Current review helpers have privileged owner/super-admin returns. Run self-review validation before those returns. Retain the existing audited manager takeover path while enforcing status, lock/version, QC and contributor checks; do not accidentally require an ordinary employee assignment for a legitimate management takeover.

Read SQL and object-level checks must agree. Reuse `effective_task_assignee_id`, `effective_task_reviewer_id`, their SQL counterparts and task visibility helpers. Do not implement a second assignment interpretation in the new service. Lists, counts, bulk neighbor reads, task views and dashboards must apply the same project-role restriction without an N+1 access lookup for every task.

Unify project list/detail visibility as: super administrator, valid owner, or valid member. Administrative privilege requires a valid administrative platform role and ownership, or super-admin status; an anomalous employee owner is a migration blocker. A project administrator who is only a member of another project receives at most that membership's capabilities, never manager capabilities. Do not automatically add administrators to ordinary employee candidate lists.

API-key scopes remain an additional intersection; `*` does not grant project access. HTTP currently reloads the database user. Socket handlers with JWT-role branches must also resolve current database authority rather than trusting a stale token role.

Apply the export capability to full project, batch and selected-task/Data Manager export. Selected-task export currently checks project visibility and task scope; adding the export capability deliberately denies annotator/viewer requests there too. Keep per-task visibility checks, and enforce the same scope/capability on execution and result delivery. Project performance details and performance CSV remain owner/super-admin only; permission to export annotations does not grant access to other employees' performance. Count platform employees by distinct account and project staff by membership. Preserve member weekly-target overrides and historical annotation/review metrics; do not reinterpret an annotation target as a review target.

Cross-project write batches are rejected unless an existing endpoint explicitly supports them. For existing multi-project operations, retain the public result shape and authorize every resource/group. Preserve existing per-item batch results where present; make a new member mutation fully atomic. Do not turn established partial-result endpoints into a new all-or-nothing contract incidentally.

## 4. Data and API contracts

### Schema

| Object                          | Change and invariant                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users.role`                    | Migrate only annotator/reviewer to employee; update ORM and administrator-create defaults. Retain manager/viewer values and account lifecycle state.                      |
| `project_members.role`          | Keep the column and values; validate with `ProjectRole`, never infer from account role. Employee supports the three project roles; platform viewer supports viewer only.  |
| `project_members.version`       | Add non-null integer default 1; increment on role changes. Address mutations by member ID as well as project ID.                                                          |
| `project_members.updated_at`    | Add timestamp; keep `assigned_at` as the original join time.                                                                                                              |
| `user_invitations.project_role` | Nullable project role, separate from platform `role`. A project invitation must contain a compatible role pair; a non-project invitation must not contain a project role. |
| Task contributor evidence       | Persist annotation-phase contributor accumulation and the current frozen review evidence as described in section 5. Preserve existing first-review performance fields.    |

The existing role columns are strings, not PostgreSQL enums. Inspect migration history and the actual target schema before adding final non-null/CHECK constraints. Preserve the membership unique constraint. Add indexes only for measured query needs; do not create every proposed role/user/project permutation.

Keep invitation `project_id` without a foreign key: its deleted target must remain detectable and fail acceptance, not become an account-only invitation. Backfill pending project invitations from the original role before converting their platform role. For old account-only staff invitations, use employee with no project role. Preserve accepted/revoked/expired invitation records as historical facts; adapters may display their legacy identity without using it to grant access.

Invitation HTTP input/output uses the existing name `project_member_role`; map it explicitly to database `project_role`. The account `role` remains separate. Final user/member CHECK constraints can use the new enums, but invitation validation must continue to represent retained historical role values. Do not impose a new-value-only invitation CHECK that makes preserved history invalid.

### Reuse and new endpoints

All HTTP paths below are relative to `/api/v1`.

| Contract                                                             | Implementation decision                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/me`, user create/list/edit                                    | `role` means platform role. Reject legacy global staff-role inputs after cutover. Public registration stays viewer.                                                                                                                   |
| Project list/query/detail                                            | Add `my_project_role`; list role filtering uses `project_role`. Keep existing array and pagination contracts.                                                                                                                         |
| `GET /projects/{project_id}/access` (new)                            | Return project ID, platform role, project role, membership ID/version, access kind and capabilities. Managers may have null membership fields.                                                                                        |
| Project member list/create                                           | Keep membership `role` as `ProjectRole`; add flat `platform_role: PlatformRole` to member output. Create validates active account and platform/project-role compatibility.                                                            |
| Add-member candidates                                                | Reuse the existing managed user list/query with platform `role=employee`; keep its managed/unassigned scope. Use viewer filtering when adding a platform viewer. Do not introduce a duplicate candidate endpoint.                     |
| Assignment candidates                                                | Reuse the project's member list, optionally filtering by `project_role`; ordinary assignment candidates must be active employees with the matching membership role. Recheck on write.                                                 |
| `POST /projects/{project_id}/members/{member_id}/role/preview` (new) | Input target `project_role` and proposed handoff; output current role/version, blockers and a resource snapshot token. No writes.                                                                                                     |
| `PATCH /projects/{project_id}/members/{member_id}/role` (new)        | Require target role, `expected_version`, preview token and reason; accept explicit annotator/reviewer replacement IDs. Revalidate under locks.                                                                                        |
| Existing member deletion                                             | Apply the same blockers and project-local locking. Existing callers may remove an idle member; outstanding work returns 409 and uses existing reassignment before retry. Never silently clear assignments.                            |
| Existing user role preview/change                                    | Super-admin only, including preview. Block incompatible memberships, ownership or unfinished work on platform demotion; never cascade a platform-role edit into other projects. Preserve self-change and last-super-admin safeguards. |
| Invitations, bulk invitations, previews and acceptance               | Persist independent platform/project role, serialize existing `project_member_role` from the new column, and validate invitation authority at acceptance. Existing employee acceptance adds only the intended membership.             |
| Annotator and reviewer dashboards                                    | Reuse existing endpoints and components. Accept employees, filter each workload by the corresponding membership role, and return empty work sets for missing roles. No new employee dashboard API is required.                        |

Do not interpret a legacy user query `role=reviewer` as “any employee with any reviewer membership”. Return a validation error after cutover. Membership `role=reviewer` remains valid. Conflicting old/new aliases must never silently select an authorization value; this plan avoids adding member-role aliases.

Preserve invitation retry behavior: creating or accepting an invitation when the target membership already exists returns 409, even for the same role; a different role must use role change. Reusing an accepted token remains 410. Creating a replacement pending invitation retains the existing same-email serialization and revocation behavior. Do not introduce token or membership idempotency as part of role migration. Preserve email serialization, inviter validity, ownership, expiry and revocation checks. Errors retain existing endpoint conventions: 401 unavailable account, 404 invisible resource, 403 insufficient project capability/self-review, 409 stale version/resource snapshot, busy resources or unknown review evidence. Do not globally rewrite error envelopes or invitation status codes.

## 5. Review contributor evidence

Current `_task_contributor_snapshot` includes the assignee and active, non-cancelled annotation authors. It omits other editors and removed contributions. Copying this list into another column alone cannot deliver the draft's self-review guarantee.

Add three task fields:

- `annotation_contributor_ids`: nullable JSONB array of distinct actor IDs contributing annotation-phase work to this task. New tasks begin with a known empty array; legacy tasks remain unknown until reconstructed.
- `review_contributor_ids`: nullable JSONB array frozen for the current `review_round_id`.
- `review_submitter_id`: nullable user ID for the current round.

Update the accumulator in the same task-locked transaction as each annotation-phase mutation: create/update/delete, bulk writes, undo/restore, conversion, imports, AI acceptance, video/scene commands and multicamera changes. Include the acting user, not just the original annotation author. Review-phase adjustments are review actions and do not add the reviewer to the annotation contributor set.

Unknown is sticky: writing a new annotation on a legacy task must not turn `NULL` into a known set containing only the new actor. Preserve unknown completeness until verified backfill; newly observed actors still belong in the normal durable mutation audit. Do not freeze a known review set from an unknown accumulator. Set an empty accumulator explicitly only for new tasks created after all mutation producers run the recording code; the additive database column has no default that marks old or old-binary-created tasks complete.

Retain contributors across rejection/resubmission and removed/undone objects. This is intentionally conservative: contributors remain disqualified for the task even if their earlier objects are later deleted. Do not silently clear the set on reassignment, role change or reopen. A materially narrower authorship model would need independently retained per-operation provenance and is outside this increment.

At submit/skip/batch send, freeze the accumulated contributors together with surviving annotation authors, the effective annotation assignee and the submitter, atomically with a new review round ID. Extend `perform_task_submit` for its callers and cover skip and other transitions that do not call it. Reuse the existing round ID and first-review machinery without changing historical performance attribution.

| Workflow transition                                | Evidence lifecycle                                                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submit / skip / eligible tasks in batch send       | Create a new round and frozen evidence; record the actual actor even when an owner submits for another assignee.                                                       |
| Video segment completion                           | Record segment contributors; freeze task evidence only when the task actually enters review.                                                                           |
| Approve                                            | Retain the completed round's evidence and append the review fact.                                                                                                      |
| Reject / withdraw / reset / reopen into annotation | Preserve old round evidence in audit, invalidate current review authority, and retain the annotation contributor accumulator. The next submission creates a new round. |
| Manager transition directly back into review       | Use the same freeze path after validating evidence; never manufacture a round ID with missing contributors.                                                            |

All review claim/edit/approve/reject paths, including batch transitions and QC acceptance that changes reviewed content, validate the current frozen evidence. Unknown evidence returns `409 review_contributors_unknown`; membership or contributor mismatch does not fall back to global roles. Check the effective current annotator as an additional conflict guard; reassignment must not remove frozen contributors.

Migration can reconstruct evidence only from retained, trustworthy submission and mutation history. An old active-author snapshot alone cannot establish that no other editor contributed. Record unresolved task IDs and keep their review writes blocked. Re-submitting the same incomplete history does not make it trustworthy. Maintainer-reviewed data repair or replacement with a separately attributed task is required before releasing such work; keep the original task and audit history. A manual bypass that treats unknown as empty is not part of this plan.

## 6. Member changes, handoff and concurrency

Role-change preview must include effective task assignments, inherited batch assignments, pending/in-progress/review work, returns, active locks, review claims and the availability of a qualified reviewer for remaining review work. Completed/archived attribution is preserved. A batch default still used by unfinished tasks is an active dependency even if task override columns are null.

Use the existing account lifecycle and batch assignment code as the source for receiver validation, snapshot hashing and handoff operations. Extract only project-scoped helpers that have real callers. A small `project_membership.py` may own member mutations; it must not call whole-account offboarding or clear another project's locks, credentials or assignments.

The mutation sequence is fixed:

1. Verify current actor authority and the target member's project, ID and version.
2. Lock involved accounts in stable ID order; lock the target/receiver memberships, project and affected resources using the existing nonblocking lifecycle pattern.
3. Re-read current roles/account status with fresh ORM state; rebuild blockers and compare the preview resource snapshot.
4. Validate explicit replacements against current project roles and effective task/batch assignment. Reject identical annotation/review responsibility.
5. Apply handoff, release only affected project locks/claims, change membership role/version and append audit facts in one transaction.
6. Commit, then invalidate the affected UI scope through existing events/refetch paths.

Use `FOR SHARE` on the membership while an employee's authorized mutation runs; use `FOR UPDATE NOWAIT` for membership mutation and nonblocking resource acquisition where it meets existing task-first paths. Retain task-row-before-task-advisory ordering in lifecycle handoff. A busy lock produces a rolled-back 409, not a partial handoff or an unbounded retry loop. Re-read after lock acquisition; an ORM identity map must not supply an obsolete role.

This extends the repository's existing concurrency model. PostgreSQL shared row locks conflict with updates, while `FOR KEY SHARE` alone does not protect non-key role updates; a consistent acquisition order or nonblocking acquisition avoids a new wait cycle. See [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS).

`expected_version` protects the member edit; it does not detect newly assigned work, so the resource snapshot and transaction-time checks are also required. Do not rely on SQLAlchemy mapper versioning to protect bulk SQL updates: [its version counter applies during ORM flush, not arbitrary bulk UPDATE/DELETE](https://docs.sqlalchemy.org/en/20/orm/versioning.html).

Revocation semantics: already authorized, lock-holding writes can finish before the member mutation commits. New writes after revocation commits must fail. Long inference must not hold database locks while computing; reauthorize in the final write transaction. Deleting/recreating a membership produces a new member ID, so replaying an old mutation cannot succeed with a recycled version.

Global employee disable/offboarding continues to use the existing cross-project management boundary and credential retirement. Update its old role-equality assumptions so valid A-annotator/B-reviewer employees are accepted, but do not expand a project administrator's ability to disable staff with work in another owner's projects.

## 7. Frontend and external consumers

Add `EmployeeDashboard` by composing existing annotation/review work cards. Accounts display employee globally; project cards and Workbench show their project role. No projects yields “等待分配项目”. Both annotation and review entry points are available to employees, with server-filtered work and no fabricated global current role.

Keep `usePermissions` for platform actions; add `useProjectAccess(projectId)` for project capabilities. Extend the project route guard with a required action and a loading/error state that cannot mount an editable Workbench. A task-only route must resolve the task's actual project before selecting access. Local guards are presentation; the server remains authoritative.

Reuse `bindAuthQueryCache` for account/token changes. New access keys include user ID and project ID; task keys also distinguish operation mode and filters. Propagate request cancellation and verify old-account/old-project responses cannot mount the new editor. Do not add a second session epoch or a global persisted current project role. Role change invalidates access, members, task/batch lists and the relevant dashboard; window focus and existing notification channels refresh other tabs.

Update all role consumers, not only `App.tsx`: `RequireRole`, default-login redirects, sidebar, avatar labels, project creation step 6, add-member and dispatch dialogs, user/invitation filters and previews, project lists, Workbench AI guards, review mode and offline replay. Preserve the recent logout-return fix and the token-bearing invitation return route. Block unauthorized offline replay and retain the user's local draft for explicit recovery rather than silently deleting it.

Guard project settings with management capability and annotation/review deep links with their specific capability. Data Manager reads retain project/task visibility; assignment and other management actions require management capability, while export requires project export capability. Notification navigation must load access for the resolved task/batch project and choose its supported work mode; an employee's B-review notification must not default to annotation. Keep project owner selection restricted to platform project administrators. Render viewer memberships explicitly instead of the current non-annotator-to-reviewer label fallback.

User-triggered asynchronous work records the initiating user and project. Recheck current authority at enqueue, execution and final annotation/result delivery boundaries; cancellation or permission failure is explicit. Do not manufacture an owner principal to continue an employee request. System jobs retain explicit system authority and bounded scope. Job result access, export cache hits, retry and signed-URL issuance need current capabilities, not only original job ownership.

Sockets and notifications resolve current account/project authority before restricted subscriptions or deliveries. Project removal must stop future restricted deliveries for that project without disconnecting unrelated authorized work. Existing global administrative socket streams remain administrative.

Already issued direct storage URLs are a known remaining boundary. Current defaults are a one-hour download lifetime with up to ten minutes alignment, five-minute comment attachment URLs without alignment, and seven-day export URLs (also subject to alignment at their callers). Preserve and document these current values in this role migration; reject new URL issuance after revocation. Immediate invalidation of old URLs would require a separately scoped storage/proxy change.

Update the Python SDK's typed models and existing member/dashboard methods with the contract. Update CLI member role choices, coverage classifications and corresponding tests. The generated frontend client is ignored output: regenerate from the checked-in OpenAPI snapshot; do not edit it or promise to commit it. Keep application/SDK versions unchanged unless a release or SDK compatibility version change is separately requested.

## 8. File-level work packages

Paths are current anchors, grouped to make the full integration scope reviewable. New files are marked **new**; an implementation PR must record every changed endpoint and its test in its description or supporting review artifact. Do not create a permanent second API inventory.

| Work package                   | Files / owners                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role/schema foundations        | `apps/api/app/db/enums.py`; `db/models/{user,project_member,user_invitation,task}.py`; `schemas/{user,project,invitation}.py`; **new Alembic revisions** based on the actual graph head                                                                                                                                                                                                                                                                      |
| Shared authorization           | **new** `apps/api/app/services/project_access.py`; `deps.py`; `services/{scheduler,batch_permissions}.py`; `api/v1/tasks/_shared.py`                                                                                                                                                                                                                                                                                                                         |
| Staff/membership lifecycle     | `api/v1/{users,projects,invitations,invitations_admin,auth}.py`; `services/{management,invitation,user_lifecycle,deactivation_service,batch}.py`; **new** `services/project_membership.py` if needed for the shared mutation owner                                                                                                                                                                                                                           |
| Workflow and data access       | `api/v1/tasks/{lifecycle,review,annotations,mask_mutations,multicamera_annotations,track_operations,video}.py`; `api/v1/{annotations,annotation_history,batches,task_views,data_manager}.py`; `services/{annotation,task_lock}.py`; `services/data_management/`                                                                                                                                                                                              |
| Multimodal/AI mutation callers | `api/v1/{videos,video_tracker_jobs,predictions,ml_backends}.py`; `services/{ai_mask_accept,annotation_conversion,track_operation,scene_track_command,scene_track_domain,video_tracks}.py`; task subroutes and workers using these owners                                                                                                                                                                                                                     |
| Aggregates and delivery        | `api/v1/dashboard/{annotator,reviewer,admin}.py`; `services/{project_performance,user_brief,notification,task_discussion}.py`; `api/v1/{async_jobs,ws,storage,annotation_comments,annotation_feedbacks,search}.py`; `workers/{export,video_tracker,cross_frame_job}.py` and prediction/result consumers                                                                                                                                                      |
| Frontend identity/access       | `apps/web/src/types/index.ts`; `constants/{roles,permissions}.ts`; `hooks/{usePermissions,useProjects,useDashboard,useAuth}.ts`; **new** `hooks/useProjectAccess.ts`; `App.tsx`; `components/routing/`; `stores/authQueryCache.ts`; `utils/authRedirect.ts`; `components/shell/{NotificationsPopover,TopBar}.tsx`; shell navigation                                                                                                                          |
| Frontend staff/work            | **new** `pages/Dashboard/EmployeeDashboard.tsx`; existing dashboard/performance components; `pages/{Annotate,Review,Users,Register,Projects}/`; `components/projects/{AssignMemberModal,BatchAssignmentModal,ProjectDistributeBatchesModal}.tsx`; `components/projects/steps/Step6Members.tsx`; `components/users/{InviteUserModal,BulkInviteModal,EditUserModal,InvitationListPanel}.tsx`; `pages/Users/usersUrlState.ts`; Workbench modes and write guards |
| Contracts and fixtures         | `apps/api/openapi.snapshot.json`; `apps/web/src/api/{projects,users,invitations,dashboard}.ts`; generated client; `packages/python-sdk/{src/ai_annotation,api-coverage.toml,tests}`; API factories and seeds; web E2E helpers                                                                                                                                                                                                                                |
| Migration tools                | **new** `apps/api/scripts/audit_project_roles.py`; versioned data migration/backfill code and tests; use existing `scripts/worktree_resources.py::migration_graph` and runtime revision validation                                                                                                                                                                                                                                                           |

The account/query helpers, dataset/group authorization, search, user briefs and notification recipients also contain global role checks. Classify each as platform access, project work or historical attribution. Do not mechanically replace every reviewer/annotator string: project roles, historical facts and explicitly retained migration adapters remain valid uses.

## 9. Merge boundaries and delivery order

### Increment A — additive preparation

Deliver the read-only data audit, additive nullable/default-safe schema fields and tested contributor recording for newly generated work while retaining the existing authorization model. Keep all creation defaults and public role contracts unchanged in this increment. Capture evidence on all write/submission paths before claiming self-review readiness.

This increment is independently useful: it reveals migration conflicts and retains future review evidence without changing who may work. Existing binaries can tolerate the added columns. If the feature never ships, the current platform remains usable. Deploy recording code to every API/worker producer with a drained write boundary before considering any new task's evidence complete. Mixed old/new writers cannot establish complete provenance.

An old-code rollback may leave additive columns in place, but old writers would stop maintaining them. Before reopening writes on such a rollback, archive collected authorization evidence and mark affected mutable tasks' completeness unknown. Re-enabling the feature must audit that interval; it cannot trust arrays left over from the earlier recording deployment. Completed review facts and business history remain intact.

### Increment B — complete project-role feature

Implement work packages in dependency order: shared authority and schemas → workflows/assignment plus membership/invitation/lifecycle → frontend and aggregate/delivery consumers → SDK/contracts/docs → isolated integration and migration rehearsal.

These are internal review/development packages, not separately deployable feature phases. Merge the complete feature only after all acceptance gates pass. A single coordinated cutover changes account data and deploys matching API, workers and frontend. Do not merge a frontend that emits employee into an old backend, or a backend that admits employees while sibling endpoints retain global reviewer bypasses. No permanent dual authorization or runtime feature-flag framework is introduced.

The feature may include a narrowly bounded legacy-data reader for upgrade/rehearsal, but all authorization in the new binary derives from project membership. Missing/incorrect membership must never fall back to a legacy global role. Normal external inputs after cutover use the new platform enum.

### Increment C — compatibility cleanup

After deployed clients/scripts are verified, remove remaining obsolete adapters and tighten final constraints. The deployed employee feature must continue working if this cleanup is delayed. Historical role values in immutable records are not deleted or relabeled.

## 10. Migration, operation and rollback

The new audit command is read-only and emits a versioned JSON report containing run ID, repository/schema baseline, aggregate counts and only necessary entity IDs/roles. No password hashes, tokens or signed URLs. It must work before employee conversion and report:

- Global/member role mismatches, unknown/null roles, invalid administrative owners and administrator memberships.
- Effective task and inherited batch assignment without matching active membership; inactive accounts with unfinished work.
- Legitimate cross-project mixed roles separately from genuine inconsistencies.
- Pending invitations by account-only/project target, role, expiry and deleted target.
- Review rounds with complete, incomplete or absent contributor evidence.
- Users, memberships by role, active assignments, locks, claims, task states, annotations and historical performance totals for reconciliation.

Preserve IDs and membership roles. Convert only global annotator/reviewer accounts, including inactive accounts without reactivating them. Keep administrator/viewer identities unchanged. Backfill pending invitation project roles before changing their account role. Preserve source role values in the protected migration snapshot for a restricted rollback.

Data ambiguity is an operational gate owned by the deploying maintainer: use an approved row-level repair list, never automatic role guessing or membership insertion. No production findings are claimed by this plan. Unknown legacy review evidence blocks that work; rollout readiness must identify the resulting unavailable tasks and their agreed recovery before reopening queues.

### Coordinated cutover

1. Rehearse on a disposable isolated database restored from a permitted, appropriately protected snapshot. Verify the full Alembic graph and database revisions; do not invent a migration number or downgrade an incompatible database.
2. Run audit/backfill in resumable batches, then reconcile. Check query plans for membership-filtered dashboard and candidate queries; avoid loading a project's complete task history into a single handoff transaction.
3. Freeze application writes, member/invitation changes and affected queue consumers; drain in-flight writes. Preserve a tested, recoverable backup and the pre-conversion snapshot.
4. Apply final schema/data conversion and deploy the complete matching API/worker/frontend artifacts. Prevent all old API and worker binaries from writing to the employee database. Mounted Python worker code requires an actual worker refresh; dependency/baked-source changes require rebuilds.
5. Re-run audit and test A-annotate/B-review/C-denied with one account, invitation acceptance, role change, self-review denial and result delivery. Reconcile business facts before reopening writes/consumers.
6. Observe permission denials, role mismatches, stale preview conflicts, deadlocks/busy resources and revoked worker writes. Use request/entity IDs in logs, not unbounded project-ID metric labels.

Before new-model writes are enabled, the frozen window permits restoring the complete pre-migration snapshot and old binaries. Once cross-project roles or employee invitations have been written, the old global-role model cannot represent the state losslessly. Roll back to a binary supporting the new schema/model or fix forward. Restoring an older database backup then is an explicit business-data rollback, not an automatic downgrade. Record that boundary in the deployment runbook.

## 11. Acceptance gates

Use two project owners MA/MB and employees U/V: U is A-annotator/B-reviewer; V is A-reviewer/B-annotator. Include project C inaccessible to U, an unassigned employee, an inactive employee, platform/project viewers and a super administrator.

| Gate        | Required observation                                                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AUTH-01     | U can claim/save/submit assigned A work and review eligible B work; inverse write actions return 403.                                                                                                                                                                                                                          |
| AUTH-02     | C resources and A-project/B-resource combinations do not leak data through detail, list/count, bulk neighbors, search, comments, job results or signed-URL creation.                                                                                                                                                           |
| AUTH-03     | Inactive/unassigned employees and viewers cannot obtain write authority from global role, task assignment alone, `mode`, a JWT claim or wildcard API-key scope.                                                                                                                                                                |
| AUTH-04     | Project-admin membership in another project never grants management; platform-role mutation and preview are super-admin only.                                                                                                                                                                                                  |
| AUTH-05     | Full and selected-task export deny annotators/viewers and remain project/task-scoped for reviewers, including cache hits, worker execution, revoked queued jobs and result retrieval.                                                                                                                                          |
| FLOW-01     | Task overrides beat batch defaults; unbatched assignment, open pools, returns during review, review reservations and admin locks retain their semantics.                                                                                                                                                                       |
| FLOW-02     | Task/review states, annotation versions, locks, QC and video boundary failures still prevent invalid transitions.                                                                                                                                                                                                              |
| MEMBER-01   | Add/create-project/invite/clone member paths enforce compatible platform/project roles, uniqueness and active account checks.                                                                                                                                                                                                  |
| MEMBER-02   | Existing employee accepts a different role in a second project; incompatible existing membership conflicts; invalid invitation has no partial effect.                                                                                                                                                                          |
| MEMBER-03   | Unfinished work, active claims/locks or loss of the remaining eligible reviewer blocks role change/removal without an explicit valid handoff. Historical attribution is unchanged.                                                                                                                                             |
| MEMBER-04   | Handoff changes effective task/batch assignment, claims, locks and membership atomically in one project. It never creates an unintended open pool or affects B when changing A.                                                                                                                                                |
| RACE-01     | Preview followed by new assignments, receiver role changes or project ownership changes yields revalidation/conflict. Same-version concurrent mutations cannot both succeed.                                                                                                                                                   |
| RACE-02     | Member change vs assignment/annotation/review/lifecycle does not create a blocking lock cycle. Post-revocation writes fail; already authorized held-lock writes may finish first.                                                                                                                                              |
| RACE-03     | Delete/rejoin rejects stale member ID/version. Global disable retires credentials without confusing legitimate mixed project roles with corruption.                                                                                                                                                                            |
| REVIEW-01   | Contributors, submitter and effective annotator cannot claim/edit/approve/reject their submitted content after reassignment or role change, including manager and batch paths.                                                                                                                                                 |
| REVIEW-02   | Edits by a non-author, deletes, undo/restore, imports, AI acceptance, video/3D writes, skip, batch send and resubmission all preserve contributor evidence.                                                                                                                                                                    |
| REVIEW-03   | Audit retention does not erase new frozen evidence; unknown legacy evidence blocks review. First-review performance facts remain unchanged.                                                                                                                                                                                    |
| ASYNC-01    | Revocation between queueing and final write/delivery stops user-authorized writes/results. Unrelated project work and explicit system jobs follow their own authority.                                                                                                                                                         |
| UI-01       | Same account, two tabs: A annotation and B review independently; direct links, target-project notification links, refresh, back navigation and no-project empty state work. Project settings and Data Manager management actions reject ordinary members; authorized reads remain available and viewers are labeled correctly. |
| UI-02       | Permission loading/failure cannot mount a writable editor; account/project late responses do not contaminate the new context. Logout redirects and invitation return URLs still work.                                                                                                                                          |
| UI-03       | Revocation disables autosave and offline replay with a useful error while preserving recoverable local drafts; the other authorized project remains usable.                                                                                                                                                                    |
| DATA-01     | Migration is repeatable/resumable; users, memberships, pending invitations, assignments and historical performance reconcile to the approved transformation.                                                                                                                                                                   |
| DATA-02     | Staff create defaults become employee; public registration remains viewer; SDK/CLI contracts and seed fixtures express project roles.                                                                                                                                                                                          |
| ROLLBACK-01 | Pre-opening rollback is rehearsed; after-opening rollback rejects destructive old-model conversion and retains the new-model recovery path.                                                                                                                                                                                    |

Concurrency gates require real PostgreSQL and independent transactions/connections. Sequential mocks do not satisfy them. Browser E2E and remote CI results must be reported separately from unit tests.

### Verification commands for implementation

These commands are acceptance instructions, not checks performed during this planning task. Before running them, inspect dependency/config symlinks and use the documented worktree test environments; this checkout's `.env` points to the primary checkout. Do not run migration/seed tests against its ordinary development database.

```bash
# Backend: verified disposable worktree test resources.
pnpm dev:worktree -- init --mode test
pnpm dev:worktree -- exec --mode test -- sh -c 'cd apps/api && .venv/bin/python -m pytest tests/test_users_role_matrix.py tests/test_users_visibility_scope.py tests/test_project_invitations.py tests/test_batch_assignment_guards.py tests/test_task_assignment_visibility.py tests/test_task_assignment_overrides.py tests/test_user_lifecycle.py tests/test_task_actor_lifecycle_guard.py tests/test_project_access.py tests/test_project_member_role_change.py tests/test_project_role_migration.py'

# Changed API contracts and frontend behavior.
pnpm openapi:export
pnpm codegen
pnpm openapi:check
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check

# SDK contracts (from packages/python-sdk).
uv run --extra test pytest

# Browser coverage in its separate worktree environment (from repo root).
pnpm dev:worktree -- exec --mode e2e -- pnpm test:e2e
git diff --check
```

New API tests are `test_project_access.py`, `test_project_member_role_change.py` and `test_project_role_migration.py`, covering the above behavioral matrix rather than one suite per helper. Extend existing invitation, lifecycle, task/batch, dashboard/performance, export, API-key, multimodal and worker suites where they already own the behavior. Add `employee-project-roles.spec.ts` for the two-project UI acceptance and retain the existing login/invitation/permission E2E suites. Run affected frontend tests during iteration and the full platform API suite in the isolated test environment before feature merge. Use the existing project SDK and runtime skills when implementing their respective work packages.

## 12. Documentation and completion

Implementation updates belong in the same change as the behavior:

- User flows: `docs-site/user-guide/getting-started.md`, `concepts.md`, `superadmin/user-management.md`, `projects/index.md`, `projects/batch.md`, `review/index.md`, and affected AI/export guidance.
- Developer contracts: `docs-site/dev/concepts/visibility-and-permissions.md`, task/batch/scheduler concepts, `docs-site/api/guides/projects.md`, `docs-site/api/index.md`, SDK README and `README.md` where API usage changes.
- Operations: add a role-migration runbook under `docs-site/ops/`, document rollback and issued-URL limits, and update the relevant security guidance.
- Architecture: create a new ADR for platform identity versus project authority, linking the existing task-lock/review ADR and recording the stricter self-review and export decisions. Select its number at implementation time.
- Add user-impact entries to `CHANGELOG.md` Unreleased; update affected screenshots through the project's media workflow only when the implemented UI is ready.

Do not present this pending design as current behavior in official documentation, update versions, or add a completed `Outcome` now. After implementation and verification, append `## Outcome` with landed commits, official documentation, checks actually run and remaining limitations; archive only when completed or superseded according to [plan conventions](README.md).

## 13. Review evidence and limits

The review used the current source paths listed above, [visibility and permissions](../../docs-site/dev/concepts/visibility-and-permissions.md), [task lock and review ADR](../adr/archive/0005-task-lock-and-review-matrix.md), [plan conventions](README.md), [development commands](../../DEV.md), current package scripts and test fixtures. Historical ADR details were checked against current code where they differ.

This plan intentionally reuses the current membership model, task assignment helpers, lifecycle conflict handling, dashboard APIs and authentication cache binding. It removes the source draft's redundant candidate/dashboard APIs, member-role alias migration and repository-wide session-key rewrite. It adds explicit coverage for public registration, lifecycle mixed roles, durable contribution tracking, existing export behavior and coordinated merge/deployment boundaries.

Production role mismatches, migration duration, irrecoverable legacy review evidence and query performance remain deployment evidence to obtain through the specified audit/rehearsal gates. They are not assumed clean, and no live data or running services were changed during this review.

## Execution record

- On 2026-09-19 the maintainer authorized staged local implementation, with worker changes reviewed and accepted by the main coordinator.
- Orca Run: `run_4f8e45f5ab0d`. Implementation DAG: A1 schema/audit → A2 evidence recording → B1 authority/member contracts → parallel B2 workflows, B3 asynchronous delivery, B4 frontend, B5 SDK/documentation → B6 integrated acceptance.
- Every modifying worker uses a child of `platform_opt260919`, based on the parent's local HEAD after prerequisite integration. Worker provider/model: OpenCode `deepseek/deepseek-flash#high` (DeepSeek V4.1 Flash, high).
- Worker success reports are provisional until the coordinator reviews the diff, integrates the local commit and verifies affected behavior. No push, main-branch merge or production cutover is authorized by this implementation request.
- Formal cutover and post-deployment compatibility cleanup remain gated by their operational evidence and target-environment authorization.
- A1 accepted on 2026-09-19: migration `0173`, additive ORM fields, read-only audit and documentation are integrated in `65b2bc1a4`, `604ccadf0` and `3bb3ae016`. The coordinator rejected the first two candidates, then passed all 14 targeted PostgreSQL/CLI/pure/drift checks and `git diff --check` on the corrected result. The parent uses an isolated worktree test database; no primary application database migration was performed.
- A2 started from `604ccadf0` once the additive schema and roundtrip were verified, in a separate direct child. The remaining A1 audit fixes were confined to script/docs/tests and integrated independently; full Increment A acceptance still requires contributor-recording validation.
- A2 accepted on 2026-09-19: worker changes are integrated in `4606f4aea`, `355403d85` and `6a0ca07c0`, with coordinator corrections in this execution-record commit. Acceptance fixed malformed UUID handling, pending ORM evidence loss, mixed-order NOWAIT acquisition before autoflush, inherited skip assignees, video segment submitters and prediction-cleanup actors. Final isolated PostgreSQL selections passed 106, 161 and 104 tests respectively (overlapping selections, not a unique total), including independent-connection write/freeze and busy-lock rollback, old-binary raw inserts, legacy migration roundtrip, API/worker/multimodal regressions and audit/model drift. Ruff, Markdown formatting and `git diff --check` passed. The initial migration expectation and expired-ORM test failures were corrected and rerun. No browser E2E or remote CI has run yet; project-role enforcement remains the next increment.
- Extended Increment A baseline at `71dc59e73`: the full isolated API suite passed **4192 tests, 15 skipped**, with one expected duplicate-ZIP-entry warning. An earlier run's three count failures were traced to six rows left by a rejected early A1 migration test; those exact disposable seed rows were removed, the affected 12 tests passed, and the full suite was rerun successfully. No business database was cleared or migrated.
- B1's first candidate `b2eca5bc0` was rejected before integration for incomplete shared authority, member handoff/concurrency and rollback safeguards. B1 is now two parallel, disjoint work packages: the existing `worktree-agent-roles-b1` owns shared authority, identity/invitation/lifecycle contracts and migration; `worktree-agent-roles-b1-members` owns only member mutation service and member/race tests (Task `task_0bca98117f40`). Both are direct children created from accepted parent HEAD `71dc59e73`; the second child receives the first candidate as an explicitly unaccepted source bootstrap, never a migration to execute. Full B1 remains a single coordinator acceptance gate before B2–B5.
- B1 foundations accepted on 2026-09-19 through parent `f9fab1c2a`: current-account/project-bound access, explicit project-role SQL predicates, flat member DTOs, invitation role separation, employee lifecycle eligibility, immutable review-evidence guards, migration `0174` and atomic member preview/CAS/handoff are integrated. Review corrections include fresh locked membership state, no global-role fallback, viewer list/detail agreement, project-local handoff, bounded NOWAIT acquisition including exact historical materialization writes, and unconditional rejection of destructive old-model downgrade. Migration ran only on the disposable parent test database.
- B1 acceptance evidence: 26 member/independent-connection race tests passed; a subsequent 55-test core/scheduler selection passed. The final broader selection at `f9fab1c2a` produced **273 passed, 1 skipped, 3 deselected, 1 failed**. That failure is the deliberately unconnected B2 task-list caller (`test_user_lifecycle::test_preview_commit_transfers_active_and_rejected_tasks`): it does not yet pass the new project role. Two earlier handoff HTTP cases also remain B2 obligations (review claim and annotation save), and the three-case HTTP handoff group was deselected in the final foundation run. No assertion was weakened or marked expected-failure. B2 must close all three workflow gaps before complete Increment B acceptance; B1 is not independently deployable. Static/pure checks, OpenAPI regeneration, Markdown formatting and `git diff --check` passed. No browser E2E or remote CI is claimed.
- The B1 member worker settled successfully after main-thread review. Its clean integrated child worktree was removed through Orca; the branch and all commits remain recoverable. B2–B5 will be direct children of the parent after this acceptance record, with disjoint workflow, aggregate/worker, frontend, and SDK/documentation ownership. The main coordinator retains exclusive database/runtime and final acceptance ownership.
- B2–B5 started from `4ffb0fd83` in `worktree-agent-roles-b2`, `worktree-agent-roles-b3`, `worktree-agent-roles-b4` and `worktree-agent-roles-b5`, each with explicitly verified direct-parent lineage. Dispatches are `ctx_33d34d546189`, `ctx_90f921bdbae1`, `ctx_d6fbd9848541` and `ctx_f1f2199f812e`. All four OpenCode session metadata records confirm provider `deepseek`, model `deepseek-flash`, variant `high`. Both B1 children are now cleanly removed with branches retained. The parent E2E mode is provisioned at schema head `0174` with its own database, Redis and eight buckets; no browser validation has run yet.
