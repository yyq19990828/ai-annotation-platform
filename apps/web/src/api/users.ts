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
  name: string;
  role: string;
  group_name?: string;
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
    apiClient.post<{ status: string }>("/users/invite", payload),
};
