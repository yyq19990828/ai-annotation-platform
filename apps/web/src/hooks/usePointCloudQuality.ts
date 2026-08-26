import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  pointCloudQualityApi,
  type PointCloudQualityRunScope,
  type PointCloudQualityStatus,
} from "@/api/pointCloudQuality";

export const POINT_CLOUD_QUALITY_QUERY_KEY = "point-cloud-quality-issues";

export function usePointCloudQualityIssues(params: {
  projectId: string;
  sceneId?: string;
  taskId?: string;
  status?: PointCloudQualityStatus;
}) {
  return useQuery({
    queryKey: [
      POINT_CLOUD_QUALITY_QUERY_KEY,
      params.projectId,
      params.sceneId ?? null,
      params.taskId ?? null,
      params.status ?? null,
    ],
    queryFn: ({ signal }) => pointCloudQualityApi.issues(params.projectId, params, signal),
    enabled: !!params.projectId && (!!params.sceneId || !!params.taskId),
    staleTime: 5_000,
  });
}

export function useRunPointCloudQuality(projectId: string, scope: PointCloudQualityRunScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => pointCloudQualityApi.runScope(projectId, scope),
    onSuccess: (run) => {
      queryClient.setQueryData(["point-cloud-quality-run", projectId, run.id], run);
    },
  });
}

export function usePointCloudQualityRun(projectId: string, runId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["point-cloud-quality-run", projectId, runId],
    queryFn: ({ signal }) => pointCloudQualityApi.run(projectId, runId!, signal),
    enabled: !!projectId && !!runId,
    refetchInterval: (query) => {
      const value = query.state.data;
      if (!value || ["pending", "running"].includes(value.status)) return 1_500;
      void queryClient.invalidateQueries({ queryKey: [POINT_CLOUD_QUALITY_QUERY_KEY, projectId] });
      return false;
    },
  });
}

export function usePatchPointCloudQualityIssue(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: {
      issueId: string;
      status: "open" | "resolved" | "wont_fix";
      reason?: string;
    }) => pointCloudQualityApi.patchIssue(value.issueId, value.status, value.reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [POINT_CLOUD_QUALITY_QUERY_KEY, projectId],
      });
    },
  });
}
