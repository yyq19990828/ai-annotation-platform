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

export const invitationsApi = {
  resolve: (token: string) =>
    apiClient.publicGet<InvitationResolved>(`/auth/invitations/${encodeURIComponent(token)}`),
  register: (payload: RegisterPayload) =>
    apiClient.publicPost<RegisterResponse>("/auth/register", payload),
};
