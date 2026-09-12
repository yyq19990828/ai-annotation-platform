import type { InvitationStatus } from "@/api/invitations";
import type { UserStatusFilter } from "@/api/users";
import type { UrlStateCodec, UrlStateIssue } from "@/hooks/useUrlFilterState";

export type UsersTab = "members" | "roles" | "groups" | "invitations";

export interface UsersUrlState {
  tab: UsersTab;
  q: string;
  status: UserStatusFilter;
  role: string;
  projectId: string;
  groupId: string;
  page: number;
}

export const USERS_URL_DEFAULTS: UsersUrlState = {
  tab: "members",
  q: "",
  status: "active",
  role: "",
  projectId: "",
  groupId: "",
  page: 1,
};

export const USERS_URL_KEYS = [
  "tab",
  "q",
  "status",
  "role",
  "project_id",
  "group_id",
  "page",
] as const;

const TABS = new Set<UsersTab>(["members", "roles", "groups", "invitations"]);
const STATUSES = new Set<UserStatusFilter>(["active", "inactive", "all"]);

function issue(issues: UrlStateIssue[], key: string, message: string) {
  issues.push({ key, message });
}

function parsePage(params: URLSearchParams, issues: UrlStateIssue[], key: string) {
  const raw = params.get(key);
  if (raw === null || raw === "") return 1;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 1) return value;
  issue(issues, key, "页码无效，已使用第 1 页");
  return 1;
}

export function parseUsersUrl(search: string | URLSearchParams) {
  const params = new URLSearchParams(search);
  const issues: UrlStateIssue[] = [];
  const rawTab = params.get("tab");
  const tab = rawTab && TABS.has(rawTab as UsersTab) ? (rawTab as UsersTab) : "members";
  if (rawTab && !TABS.has(rawTab as UsersTab)) issue(issues, "tab", "未知的用户页签");

  const rawStatus = params.get("status");
  const status =
    rawStatus && STATUSES.has(rawStatus as UserStatusFilter)
      ? (rawStatus as UserStatusFilter)
      : "active";
  if (rawStatus && !STATUSES.has(rawStatus as UserStatusFilter)) {
    issue(issues, "status", "未知的账号状态筛选");
  }

  return {
    state: {
      tab,
      q: params.get("q")?.trim() ?? "",
      status,
      role: params.get("role")?.trim() ?? "",
      projectId: params.get("project_id")?.trim() ?? "",
      groupId: params.get("group_id")?.trim() ?? "",
      page: parsePage(params, issues, "page"),
    },
    issues,
  };
}

export const usersUrlCodec: UrlStateCodec<UsersUrlState> = {
  parse: parseUsersUrl,
  encode: (current, state) => {
    const params = new URLSearchParams(current);
    if (state.tab === "members") params.delete("tab");
    else params.set("tab", state.tab);
    if (state.q) params.set("q", state.q.trim());
    else params.delete("q");
    if (state.status === "active") params.delete("status");
    else params.set("status", state.status);
    if (state.role) params.set("role", state.role.trim());
    else params.delete("role");
    if (state.projectId) params.set("project_id", state.projectId.trim());
    else params.delete("project_id");
    if (state.groupId) params.set("group_id", state.groupId.trim());
    else params.delete("group_id");
    if (state.page === 1) params.delete("page");
    else params.set("page", String(state.page));
    return params;
  },
};

export interface InvitationUrlState {
  q: string;
  status: InvitationStatus | "all";
  scope: "me" | "all";
  role: string;
  projectId: string;
  page: number;
}

export const INVITATION_URL_DEFAULTS: InvitationUrlState = {
  q: "",
  status: "all",
  scope: "me",
  role: "",
  projectId: "",
  page: 1,
};

export const INVITATION_URL_KEYS = [
  "invite_q",
  "invite_status",
  "invite_scope",
  "invite_role",
  "invite_project_id",
  "invite_page",
] as const;

const INVITATION_STATUSES = new Set<InvitationStatus | "all">([
  "all",
  "pending",
  "accepted",
  "expired",
  "revoked",
]);

export function parseInvitationUrl(search: string | URLSearchParams) {
  const params = new URLSearchParams(search);
  const issues: UrlStateIssue[] = [];
  const rawStatus = params.get("invite_status");
  const status =
    rawStatus && INVITATION_STATUSES.has(rawStatus as InvitationStatus | "all")
      ? (rawStatus as InvitationStatus | "all")
      : "all";
  if (rawStatus && !INVITATION_STATUSES.has(rawStatus as InvitationStatus | "all")) {
    issue(issues, "invite_status", "未知的邀请状态筛选");
  }
  const rawScope = params.get("invite_scope");
  const scope: InvitationUrlState["scope"] =
    rawScope === "all" || rawScope === "me" ? rawScope : "me";
  if (rawScope && rawScope !== "all" && rawScope !== "me") {
    issue(issues, "invite_scope", "未知的邀请范围");
  }

  return {
    state: {
      q: params.get("invite_q")?.trim() ?? "",
      status,
      scope,
      role: params.get("invite_role")?.trim() ?? "",
      projectId: params.get("invite_project_id")?.trim() ?? "",
      page: parsePage(params, issues, "invite_page"),
    },
    issues,
  };
}

export const invitationUrlCodec: UrlStateCodec<InvitationUrlState> = {
  parse: parseInvitationUrl,
  encode: (current, state) => {
    const params = new URLSearchParams(current);
    if (state.q) params.set("invite_q", state.q.trim());
    else params.delete("invite_q");
    if (state.status === "all") params.delete("invite_status");
    else params.set("invite_status", state.status);
    if (state.scope === "me") params.delete("invite_scope");
    else params.set("invite_scope", state.scope);
    if (state.role) params.set("invite_role", state.role.trim());
    else params.delete("invite_role");
    if (state.projectId) params.set("invite_project_id", state.projectId.trim());
    else params.delete("invite_project_id");
    if (state.page === 1) params.delete("invite_page");
    else params.set("invite_page", String(state.page));
    return params;
  },
};
