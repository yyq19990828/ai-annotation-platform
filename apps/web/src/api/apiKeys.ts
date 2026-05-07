import { apiClient } from "./client";

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** 创建响应：plaintext 仅此一次返回。 */
export interface ApiKeyCreated extends ApiKey {
  plaintext: string;
}

export interface ApiKeyCreatePayload {
  name: string;
  scopes: string[];
}

export const apiKeysApi = {
  list: () => apiClient.get<ApiKey[]>("/me/api-keys"),
  create: (payload: ApiKeyCreatePayload) =>
    apiClient.post<ApiKeyCreated>("/me/api-keys", payload),
  revoke: (id: string) => apiClient.delete<void>(`/me/api-keys/${id}`),
};
