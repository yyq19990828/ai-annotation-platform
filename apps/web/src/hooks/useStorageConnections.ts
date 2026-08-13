import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  storageConnectionsApi,
  type StorageConnectionCreatePayload,
  type StorageConnectionUpdatePayload,
} from "@/api/storageConnections";

export function useStorageConnections() {
  return useQuery({
    queryKey: ["storage-connections"],
    queryFn: storageConnectionsApi.list,
  });
}

export function useConnectorAllowlist() {
  return useQuery({
    queryKey: ["storage-connections", "allowlist"],
    queryFn: storageConnectionsApi.getAllowlist,
  });
}

export function useUpdateConnectorAllowlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: string[]) => storageConnectionsApi.updateAllowlist(entries),
    onSuccess: (data) => {
      qc.setQueryData(["storage-connections", "allowlist"], data);
    },
  });
}

export function useResetConnectorAllowlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: storageConnectionsApi.resetAllowlist,
    onSuccess: (data) => {
      qc.setQueryData(["storage-connections", "allowlist"], data);
    },
  });
}

export function useDeploymentSftpPreset(enabled: boolean) {
  return useQuery({
    queryKey: ["storage-connections", "deployment-sftp-preset"],
    queryFn: storageConnectionsApi.getDeploymentSftpPreset,
    enabled,
  });
}

export function useCreateStorageConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StorageConnectionCreatePayload) => storageConnectionsApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storage-connections"] });
    },
  });
}

export function useUpdateStorageConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StorageConnectionUpdatePayload }) =>
      storageConnectionsApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storage-connections"] });
    },
  });
}

export function useDeleteStorageConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageConnectionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storage-connections"] });
    },
  });
}

export function useTestStorageConnection() {
  return useMutation({
    mutationFn: (id: string) => storageConnectionsApi.test(id),
  });
}
