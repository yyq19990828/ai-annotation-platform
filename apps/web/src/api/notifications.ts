import { apiClient } from "./client";

export interface NotificationItem {
  id: number;
  action: string;
  actor_email: string | null;
  actor_role: string | null;
  target_type: string | null;
  target_id: string | null;
  detail_json: Record<string, unknown> | null;
  created_at: string;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  total: number;
}

export const notificationsApi = {
  list: (limit = 30) =>
    apiClient.get<NotificationsResponse>(`/auth/me/notifications?limit=${limit}`),
};
