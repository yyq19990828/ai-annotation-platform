import { apiClient } from "./client";

export interface GroupResponse {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  created_at: string;
}

export interface GroupCreatePayload {
  name: string;
  description?: string;
}

export interface GroupUpdatePayload {
  name?: string;
  description?: string;
}

export const groupsApi = {
  list: () => apiClient.get<GroupResponse[]>("/groups"),
  create: (payload: GroupCreatePayload) => apiClient.post<GroupResponse>("/groups", payload),
  update: (id: string, payload: GroupUpdatePayload) =>
    apiClient.patch<GroupResponse>(`/groups/${id}`, payload),
  delete: (id: string) => apiClient.delete<void>(`/groups/${id}`),
};
