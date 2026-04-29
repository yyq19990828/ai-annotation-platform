import { apiClient } from "./client";

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  group_name: string | null;
  status: string;
  is_active: boolean;
  created_at: string;
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

export const usersApi = {
  list: (params?: { role?: string }) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    ).toString();
    return apiClient.get<UserResponse[]>(`/users${q ? `?${q}` : ""}`);
  },

  invite: (payload: InvitePayload) =>
    apiClient.post<InvitationCreated>("/users/invite", payload),

  changeRole: (userId: string, role: string) =>
    apiClient.patch<UserResponse>(`/users/${userId}/role`, { role }),

  deactivate: (userId: string) =>
    apiClient.post<UserResponse>(`/users/${userId}/deactivate`, {}),
};
