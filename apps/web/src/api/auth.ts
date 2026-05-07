import { apiClient } from "./client";

export interface LoginPayload {
  email: string;
  password: string;
  // v0.9.3 · progressive CAPTCHA：达到失败阈值后必填
  captcha_token?: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface MeResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  group_name: string | null;
  status: string;
  created_at: string;
  // v0.8.1
  password_admin_reset_at?: string | null;
  deactivation_requested_at?: string | null;
  deactivation_scheduled_at?: string | null;
}

export const authApi = {
  login: (payload: LoginPayload) =>
    apiClient.post<TokenResponse>("/auth/login", payload),
  me: () => apiClient.get<MeResponse>("/auth/me"),
  logout: () => apiClient.post<void>("/auth/logout", {}),
  logoutAll: () => apiClient.post<TokenResponse>("/auth/logout-all", {}),
  // v0.8.8 · 用现有（即将 / 已过期）token 换新 token，7 天 grace 内有效。
  // useNotificationSocket onclose 1008/4001 时触发，长会话标注员永不被踢。
  refresh: () => apiClient.post<TokenResponse>("/auth/refresh", {}),
};
