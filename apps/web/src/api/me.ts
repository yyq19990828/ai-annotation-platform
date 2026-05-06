import { apiClient } from "./client";
import type { MeResponse } from "./auth";

export interface ProfileUpdatePayload {
  name: string;
}

export interface PasswordChangePayload {
  old_password: string;
  new_password: string;
}

// v0.8.4 · 工作台耗时事件批量上报（效率看板源数据）
export interface TaskEventIn {
  client_id?: string;
  task_id: string;
  project_id: string;
  kind: "annotate" | "review";
  started_at: string; // ISO
  ended_at: string; // ISO
  duration_ms: number;
  annotation_count?: number;
  was_rejected?: boolean;
}

export interface TaskEventBatchOut {
  accepted: number;
  queued_async: boolean;
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
  // v0.8.4
  submitTaskEvents: (events: TaskEventIn[]) =>
    apiClient.post<TaskEventBatchOut>("/auth/me/task-events:batch", { events }),
  // v0.8.3 · 在线状态心跳：前端 30s 周期触发，刷新 last_seen_at + status='online'。
  heartbeat: () => apiClient.post<void>("/auth/me/heartbeat"),
};
