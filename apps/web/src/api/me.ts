import { apiClient } from "./client";
import type { MeResponse } from "./auth";

export interface ProfileUpdatePayload {
  name: string;
}

export interface PasswordChangePayload {
  old_password: string;
  new_password: string;
}

export const meApi = {
  updateProfile: (payload: ProfileUpdatePayload) =>
    apiClient.patch<MeResponse>("/auth/me", payload),
  changePassword: (payload: PasswordChangePayload) =>
    apiClient.post<void>("/auth/me/password", payload),
  // v0.8.1 · 自助注销冷静期
  requestDeactivation: (reason: string) =>
    apiClient.post<MeResponse>("/auth/me/deactivation-request", { reason }),
  cancelDeactivation: () =>
    apiClient.delete<MeResponse>("/auth/me/deactivation-request"),
  // v0.8.3 · 在线状态心跳：前端 30s 周期触发，刷新 last_seen_at + status='online'。
  heartbeat: () => apiClient.post<void>("/auth/me/heartbeat"),
};
