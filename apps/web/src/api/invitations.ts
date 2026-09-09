import { apiClient } from "./client";
import type { MeResponse } from "./auth";

export interface InvitationResolved {
  email: string;
  role: string;
  group_name: string | null;
  project_id: string | null;
  project_name: string | null;
  project_member_role: string | null;
  expires_at: string;
  invited_by_name: string | null;
}

export interface RegisterPayload {
  token: string;
  name: string;
  password: string;
}

export interface RegisterResponse {
  // v0.12.0 · 需邮箱验证时为 null（不自动登录）
  access_token: string | null;
  token_type: string;
  user: MeResponse;
  email_verification_required: boolean;
  acceptance?: InvitationAcceptance | null;
}

export interface InvitationAcceptance {
  project_id: string | null;
  project_name: string | null;
  project_member_role: string | null;
  next_action: "start_work" | "wait_for_allocation";
  next_action_label: string;
  responsible_person_name: string | null;
  active_batch_count: number;
}

export interface ExistingInvitationAcceptanceResponse {
  user: MeResponse;
  acceptance: InvitationAcceptance;
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface InvitationResponse {
  id: string;
  email: string;
  role: string;
  group_name: string | null;
  project_id: string | null;
  project_name: string | null;
  project_member_role: string | null;
  status: InvitationStatus;
  expires_at: string;
  invited_by: string;
  invited_by_name: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface InvitationPageParams {
  status?: InvitationStatus | "all";
  scope?: "me" | "all";
  search?: string;
  role?: string;
  project_id?: string;
  page?: number;
  page_size?: number;
}

export interface InvitationPageResponse {
  items: InvitationResponse[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface InvitationStats {
  total: number;
  pending: number;
  accepted: number;
  expired: number;
  revoked: number;
}

export interface InvitationResendResponse {
  invite_url: string;
  token: string;
  expires_at: string;
}

export interface InvitationSendEmailResponse {
  ok: boolean;
  invitation_id: string;
  email: string;
  invite_url: string;
  message: string;
}

export interface OpenRegisterPayload {
  email: string;
  name: string;
  password: string;
  captcha_token?: string | null;
}

function invitationQuery(params: InvitationPageParams) {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}

export const invitationsApi = {
  resolve: (token: string) =>
    apiClient.publicGet<InvitationResolved>(`/auth/invitations/${encodeURIComponent(token)}`),
  register: (payload: RegisterPayload) =>
    apiClient.publicPost<RegisterResponse>("/auth/register", payload),
  acceptExisting: (token: string) =>
    apiClient.post<ExistingInvitationAcceptanceResponse>("/auth/invitations/accept", {
      token,
    }),

  list: (params?: { status?: InvitationStatus | "all"; scope?: "me" | "all" }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.scope) q.set("scope", params.scope);
    const qs = q.toString();
    return apiClient.get<InvitationResponse[]>(`/invitations${qs ? `?${qs}` : ""}`);
  },
  page: (params: InvitationPageParams = {}) =>
    apiClient.get<InvitationPageResponse>(`/invitations/query?${invitationQuery(params)}`),
  stats: (params: Omit<InvitationPageParams, "page" | "page_size"> = {}) =>
    apiClient.get<InvitationStats>(`/invitations/stats?${invitationQuery(params)}`),
  exportInvitations: async (params: Omit<InvitationPageParams, "page" | "page_size"> = {}) => {
    const token = localStorage.getItem("token");
    const response = await fetch(
      `/api/v1/invitations/export?format=csv&${invitationQuery(params)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!response.ok) throw new Error(`导出邀请失败 (${response.status})`);
    const blob = await response.blob();
    if (!token || token !== localStorage.getItem("token"))
      throw new Error("当前登录状态已改变，请重新导出");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "invitations.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  revoke: (id: string) => apiClient.delete<void>(`/invitations/${id}`),
  resend: (id: string) => apiClient.post<InvitationResendResponse>(`/invitations/${id}/resend`),
  sendEmail: (id: string) =>
    apiClient.post<InvitationSendEmailResponse>(`/invitations/${id}/send-email`, {}),

  registrationStatus: () =>
    apiClient.publicGet<{ open_registration_enabled: boolean }>("/auth/registration-status"),
  openRegister: (payload: OpenRegisterPayload) =>
    apiClient.publicPost<RegisterResponse>("/auth/register-open", payload),

  // v0.12.0 · 邮箱验证
  verifyEmail: (token: string) =>
    apiClient.publicPost<{ message: string }>("/auth/verify-email", { token }),
  resendVerification: (email: string) =>
    apiClient.publicPost<{ message: string }>("/auth/send-verification-email", { email }),
};
