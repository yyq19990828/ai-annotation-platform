import { apiClient } from "./client";
import type { MeResponse } from "./auth";

export interface InvitationResolved {
  email: string;
  role: string;
  group_name: string | null;
  expires_at: string;
  invited_by_name: string | null;
}

export interface RegisterPayload {
  token: string;
  name: string;
  password: string;
}

export interface RegisterResponse {
  access_token: string;
  token_type: string;
  user: MeResponse;
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface InvitationResponse {
  id: string;
  email: string;
  role: string;
  group_name: string | null;
  status: InvitationStatus;
  expires_at: string;
  invited_by: string;
  invited_by_name: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface InvitationResendResponse {
  invite_url: string;
  token: string;
  expires_at: string;
}

export interface OpenRegisterPayload {
  email: string;
  name: string;
  password: string;
  captcha_token?: string | null;
}

export const invitationsApi = {
  resolve: (token: string) =>
    apiClient.publicGet<InvitationResolved>(`/auth/invitations/${encodeURIComponent(token)}`),
  register: (payload: RegisterPayload) =>
    apiClient.publicPost<RegisterResponse>("/auth/register", payload),

  list: (params?: { status?: InvitationStatus | "all"; scope?: "me" | "all" }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.scope) q.set("scope", params.scope);
    const qs = q.toString();
    return apiClient.get<InvitationResponse[]>(`/invitations${qs ? `?${qs}` : ""}`);
  },
  revoke: (id: string) => apiClient.delete<void>(`/invitations/${id}`),
  resend: (id: string) => apiClient.post<InvitationResendResponse>(`/invitations/${id}/resend`),

  registrationStatus: () =>
    apiClient.publicGet<{ open_registration_enabled: boolean }>("/auth/registration-status"),
  openRegister: (payload: OpenRegisterPayload) =>
    apiClient.publicPost<RegisterResponse>("/auth/register-open", payload),
};
