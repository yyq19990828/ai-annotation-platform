import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  batchesApi,
  type BatchCreatePayload,
  type BatchUpdatePayload,
  type BatchSplitPayload,
} from "../api/batches";

export function useBatches(projectId: string, status?: string) {
  return useQuery({
    queryKey: ["batches", projectId, status],
    queryFn: () => batchesApi.list(projectId, status),
    enabled: !!projectId,
  });
}

export function useBatch(projectId: string, batchId: string) {
  return useQuery({
    queryKey: ["batch", projectId, batchId],
    queryFn: () => batchesApi.get(projectId, batchId),
    enabled: !!projectId && !!batchId,
  });
}

export function useCreateBatch(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BatchCreatePayload) =>
      batchesApi.create(projectId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches", projectId] });
    },
  });
}

export function useUpdateBatch(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      batchId,
      payload,
    }: {
      batchId: string;
      payload: BatchUpdatePayload;
    }) => batchesApi.update(projectId, batchId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches", projectId] });
    },
  });
}

export function useDeleteBatch(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => batchesApi.remove(projectId, batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches", projectId] });
    },
  });
}

export function useTransitionBatch(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      batchId,
      targetStatus,
    }: {
      batchId: string;
      targetStatus: string;
    }) => batchesApi.transition(projectId, batchId, targetStatus),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useSplitBatches(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BatchSplitPayload) =>
      batchesApi.split(projectId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches", projectId] });
    },
  });
}

export function useRejectBatch(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => batchesApi.reject(projectId, batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches", projectId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
