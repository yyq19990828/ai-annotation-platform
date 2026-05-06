import { apiClient } from "./client";

export interface SmtpStatusResponse {
  host: string | null;
  port: number | null;
  user: string | null;
  from_address: string | null;
  password_set: boolean;
  configured: boolean;
}

export interface SystemSettingsResponse {
  environment: string;
  invitation_ttl_days: number;
  frontend_base_url: string;
  smtp: SmtpStatusResponse;
  allow_open_registration: boolean;
}

export interface SystemSettingsPatch {
  allow_open_registration?: boolean;
  invitation_ttl_days?: number;
  frontend_base_url?: string;
  smtp_host?: string;
  smtp_port?: number | null;
  smtp_user?: string;
  smtp_password?: string;
  smtp_from?: string;
}

export interface SmtpTestResponse {
  ok: boolean;
  to?: string;
  from?: string;
  host?: string;
  port?: number;
}

export const settingsApi = {
  getSystem: () => apiClient.get<SystemSettingsResponse>("/settings/system"),
  updateSystem: (patch: SystemSettingsPatch) =>
    apiClient.patch<SystemSettingsResponse>("/settings/system", patch),
  testSmtp: () => apiClient.post<SmtpTestResponse>("/settings/system/test-smtp", {}),
};
