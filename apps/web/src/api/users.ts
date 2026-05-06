import { apiClient } from "./client";
import type { UserOut } from "./generated/types.gen";

export type UserResponse = UserOut;

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
  list: (params?: { role?: string; project_id?: string }) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    ).toString();
    return apiClient.get<UserResponse[]>(`/users${q ? `?${q}` : ""}`);
  },

  // v0.8.3 · UsersPage 顶部 4 卡之「本周活跃」聚合（last_seen_at >= now-7d）
  stats: () => apiClient.get<UsersStats>("/users/stats"),

  invite: (payload: InvitePayload) =>
    apiClient.post<InvitationCreated>("/users/invite", payload),

  changeRole: (userId: string, role: string) =>
    apiClient.patch<UserResponse>(`/users/${userId}/role`, { role }),

  deactivate: (userId: string) =>
    apiClient.post<UserResponse>(`/users/${userId}/deactivate`, {}),

  remove: (userId: string, opts?: { transfer_to_user_id?: string }) =>
    apiClient.delete<UserResponse>(
      `/users/${userId}`,
      opts?.transfer_to_user_id ? { transfer_to_user_id: opts.transfer_to_user_id } : undefined,
    ),

  assignGroup: (userId: string, groupId: string | null) =>
    apiClient.patch<UserResponse>(`/users/${userId}/group`, { group_id: groupId }),

  adminResetPassword: (userId: string) =>
    apiClient.post<AdminResetPasswordResult>(
      `/users/${userId}/admin-reset-password`,
      {},
    ),

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
