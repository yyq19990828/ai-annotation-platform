import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  mlBackendsApi,
  type MLBackendCreatePayload,
  type MLBackendUpdatePayload,
} from "@/api/ml-backends";

function invalidateBackendQueries(qc: QueryClient, projectId: string) {
  qc.invalidateQueries({ queryKey: ["ml-backends", projectId] });
  qc.invalidateQueries({ queryKey: ["admin", "ml-integrations", "overview"] });
}

export function useMLBackends(projectId: string | undefined) {
  return useQuery({
    queryKey: ["ml-backends", projectId],
    queryFn: () => mlBackendsApi.list(projectId!),
    enabled: !!projectId,
  });
}

export function useCreateMLBackend(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MLBackendCreatePayload) => mlBackendsApi.create(projectId, payload),
    onSuccess: () => invalidateBackendQueries(qc, projectId),
  });
}

export function useUpdateMLBackend(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ backendId, payload }: { backendId: string; payload: MLBackendUpdatePayload }) =>
      mlBackendsApi.update(projectId, backendId, payload),
    onSuccess: () => invalidateBackendQueries(qc, projectId),
  });
}

export function useDeleteMLBackend(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (backendId: string) => mlBackendsApi.delete(projectId, backendId),
    onSuccess: () => invalidateBackendQueries(qc, projectId),
  });
}

export function useMLBackendHealth(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (backendId: string) => mlBackendsApi.health(projectId, backendId),
    onSuccess: () => invalidateBackendQueries(qc, projectId),
  });
}

export function useInteractiveAnnotate(projectId: string, backendId: string | undefined) {
  return useMutation({
    mutationFn: (payload: { task_id: string; context: Record<string, unknown> }) => {
      if (!backendId) throw new Error("No interactive backend available");
      return mlBackendsApi.interactiveAnnotate(projectId, backendId, payload);
    },
  });
}
