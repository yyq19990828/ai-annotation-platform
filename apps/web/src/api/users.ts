import { apiClient } from "./client";
import type { UserOut } from "./generated/types.gen";

/** The lifecycle fields are served by the API but may lag the generated client snapshot. */
export type UserResponse = UserOut & {
  is_active?: boolean;
  disabled_kind?: string | null;
  disabled_at?: string | null;
  disabled_by?: string | null;
  disabled_reason?: string | null;
};

export type UserStatusFilter = "active" | "inactive" | "all";

export type OffboardingMode = "handoff" | "emergency_suspend";
export type OffboardingRole = "owner" | "annotator" | "reviewer";

export interface OffboardingReceiverOption {
  id: string;
  name: string;
  email: string;
  role: string;
  project_member_role: string | null;
}

export interface OffboardingBlocker {
  code: string;
  message: string;
}

export interface OffboardingBatchRef {
  batch_id: string;
  batch_name: string;
}

export interface OffboardingRolePreview {
  present: boolean;
  batches: OffboardingBatchRef[];
  receiver_options: OffboardingReceiverOption[];
}

export interface OffboardingProjectPreview {
  project_id: string;
  project_name: string;
  roles: Record<OffboardingRole, OffboardingRolePreview>;
  tasks: Record<string, Record<string, number>>;
  locked_task_count?: number;
  blockers: OffboardingBlocker[];
}

export interface OffboardingApiKeyPreview {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface OffboardingPreview {
  user: UserResponse;
  preview_version: string;
  generated_at: string;
  projects: OffboardingProjectPreview[];
  api_keys: OffboardingApiKeyPreview[];
  blockers: OffboardingBlocker[];
  can_commit: boolean;
}

export interface OffboardingProjectRequest {
  project_id: string;
  owner_receiver_id?: string;
  annotator_receiver_id?: string;
  reviewer_receiver_id?: string;
}

export interface OffboardingCommitRequest {
  preview_version: string;
  reason: string;
  mode: OffboardingMode;
  projects: OffboardingProjectRequest[];
}

export interface OffboardingTransferResult {
  project_id: string;
  role: string;
  receiver_id: string | null;
  batch_ids: string[];
  task_count: number;
  lock_count: number;
}

export interface OffboardingUnresolvedResult {
  project_id: string | null;
  role: string | null;
  reason: string;
  batch_ids: string[];
  task_count: number;
  lock_count: number;
}

export interface OffboardingResult {
  user: UserResponse;
  status: string;
  mode: OffboardingMode;
  transfers: OffboardingTransferResult[];
  unresolved: OffboardingUnresolvedResult[];
  revoked_api_key_ids: string[];
  audit_id: number | null;
}

export interface ReactivateRequest {
  reason?: string;
}

export interface InvitePayload {
  email: string;
  role: string;
  group_name?: string;
}

export interface InvitationCreated {
  invite_url: string;
  token: string;
  expires_at: string;
}

export type UserExportFormat = "csv" | "json";

export interface AdminResetPasswordResult {
  temp_password: string;
  message: string;
  target_email: string;
}

export interface UsersStats {
  total: number;
  online: number;
  weekly_active: number;
}

export const usersApi = {
  list: (params?: { role?: string; project_id?: string; status?: UserStatusFilter }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined)) as Record<
        string,
        string
      >,
    ).toString();
    return apiClient.get<UserResponse[]>(`/users${q ? `?${q}` : ""}`);
  },

  // v0.8.3 · UsersPage 顶部 4 卡之「本周活跃」聚合（last_seen_at >= now-7d）
  stats: () => apiClient.get<UsersStats>("/users/stats"),

  invite: (payload: InvitePayload) => apiClient.post<InvitationCreated>("/users/invite", payload),

  changeRole: (userId: string, role: string) =>
    apiClient.patch<UserResponse>(`/users/${userId}/role`, { role }),

  deactivate: (userId: string) => apiClient.post<UserResponse>(`/users/${userId}/deactivate`, {}),

  offboardingPreview: (userId: string) =>
    apiClient.get<OffboardingPreview>(`/users/${userId}/offboarding-preview`),

  offboard: (userId: string, payload: OffboardingCommitRequest) =>
    apiClient.post<OffboardingResult>(`/users/${userId}/offboarding`, payload),

  reactivate: (userId: string, payload?: ReactivateRequest) =>
    apiClient.post<UserResponse>(`/users/${userId}/reactivate`, payload ?? {}),

  remove: (userId: string, opts?: { transfer_to_user_id?: string }) =>
    apiClient.delete<UserResponse>(
      `/users/${userId}`,
      opts?.transfer_to_user_id ? { transfer_to_user_id: opts.transfer_to_user_id } : undefined,
    ),

  assignGroup: (userId: string, groupId: string | null) =>
    apiClient.patch<UserResponse>(`/users/${userId}/group`, { group_id: groupId }),

  adminResetPassword: (userId: string) =>
    apiClient.post<AdminResetPasswordResult>(`/users/${userId}/admin-reset-password`, {}),

  exportUsers: async (format: UserExportFormat = "csv"): Promise<void> => {
    const token = localStorage.getItem("token");
    const res = await fetch(`/api/v1/users/export?format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { detail?: string }).detail || `导出失败 (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const dispo = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^"]+)"?/.exec(dispo);
    const filename = match ? match[1] : `users.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
