/**
 * v0.19.0 · ADR-0044 · superadmin 全局 ML backend 注册表 mutation hooks。
 *
 * 全局 backend (project_id=null) 走 /admin/ml-integrations/registry，与项目作用域的
 * useMLBackends（/projects/{id}/ml-backends）解耦。成功后同时失效全局列表 (all) 与
 * 模型市场总览 (overview)，让两处视图一起刷新。
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  adminMlIntegrationsApi,
  type MLBackendRegistryCreatePayload,
  type MLBackendRegistryUpdatePayload,
} from "@/api/adminMlIntegrations";

function invalidateRegistryQueries(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["admin", "ml-integrations", "all"] });
  qc.invalidateQueries({ queryKey: ["admin", "ml-integrations", "overview"] });
}

export function useCreateRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MLBackendRegistryCreatePayload) =>
      adminMlIntegrationsApi.createRegistry(payload),
    onSuccess: () => invalidateRegistryQueries(qc),
  });
}

export function useUpdateRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: MLBackendRegistryUpdatePayload }) =>
      adminMlIntegrationsApi.updateRegistry(id, payload),
    onSuccess: () => invalidateRegistryQueries(qc),
  });
}

export function useDeleteRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminMlIntegrationsApi.deleteRegistry(id),
    onSuccess: () => invalidateRegistryQueries(qc),
  });
}

export function useRegistryHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminMlIntegrationsApi.registryHealth(id),
    onSuccess: () => invalidateRegistryQueries(qc),
  });
}
