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
};
