import { apiClient } from "./client";

export interface SmtpStatusResponse {
  host: string | null;
  port: number | null;
  user: string | null;
  from_address: string | null;
  configured: boolean;
}

export interface SystemSettingsResponse {
  environment: string;
  invitation_ttl_days: number;
  frontend_base_url: string;
  smtp: SmtpStatusResponse;
  allow_open_registration: boolean;
}

export const settingsApi = {
  getSystem: () => apiClient.get<SystemSettingsResponse>("/settings/system"),
};
