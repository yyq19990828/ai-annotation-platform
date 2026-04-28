import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { mlBackendsApi, type MLBackendCreatePayload } from "@/api/ml-backends";

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ml-backends", projectId] }),
  });
}

export function useMLBackendHealth(projectId: string) {
  return useMutation({
    mutationFn: (backendId: string) => mlBackendsApi.health(projectId, backendId),
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
