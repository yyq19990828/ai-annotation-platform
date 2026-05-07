import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiKeysApi, type ApiKeyCreatePayload } from "../api/apiKeys";

export function useApiKeys(enabled = true) {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiKeysApi.list(),
    enabled,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ApiKeyCreatePayload) => apiKeysApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiKeysApi.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}
