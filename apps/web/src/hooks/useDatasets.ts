import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { datasetsApi, type DatasetCreatePayload, type DatasetUpdatePayload } from "../api/datasets";

export function useDatasets(params?: { search?: string; data_type?: string }) {
  return useQuery({
    queryKey: ["datasets", params],
    queryFn: () => datasetsApi.list(params),
  });
}

export function useDataset(id: string | undefined) {
  return useQuery({
    queryKey: ["dataset", id],
    queryFn: () => datasetsApi.get(id!),
    enabled: !!id,
  });
}

export function useCreateDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: DatasetCreatePayload) => datasetsApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });
}

export function useUpdateDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: DatasetUpdatePayload }) =>
      datasetsApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });
}

export function useDeleteDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => datasetsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });
}

export function useDatasetItems(datasetId: string | undefined, params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ["dataset-items", datasetId, params],
    queryFn: () => datasetsApi.listItems(datasetId!, params),
    enabled: !!datasetId,
  });
}

export function useScanDatasetItems(datasetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => datasetsApi.scanItems(datasetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      qc.invalidateQueries({ queryKey: ["dataset-items", datasetId] });
    },
  });
}

export function useLinkProject(datasetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => datasetsApi.linkProject(datasetId, projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      qc.invalidateQueries({ queryKey: ["dataset", datasetId] });
      qc.invalidateQueries({ queryKey: ["dataset-projects", datasetId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useUnlinkProject(datasetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => datasetsApi.unlinkProject(datasetId, projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      qc.invalidateQueries({ queryKey: ["dataset", datasetId] });
      qc.invalidateQueries({ queryKey: ["dataset-projects", datasetId] });
    },
  });
}

export function useDatasetProjects(datasetId: string | undefined) {
  return useQuery({
    queryKey: ["dataset-projects", datasetId],
    queryFn: () => datasetsApi.getLinkedProjects(datasetId!),
    enabled: !!datasetId,
  });
}
