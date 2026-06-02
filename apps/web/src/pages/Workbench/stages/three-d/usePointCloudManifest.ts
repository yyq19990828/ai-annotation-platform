import { useQuery } from "@tanstack/react-query";

import { tasksApi } from "@/api/tasks";

/**
 * v0.13.2 · 拉取点云任务的 manifest(主点云 URL + 各相机图 + 标定)。
 * 仅在 stageKind === "3d" 且有 taskId 时启用。
 */
export function usePointCloudManifest(taskId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["task-point-cloud-manifest", taskId],
    queryFn: () => tasksApi.getPointCloudManifest(taskId!),
    enabled: enabled && !!taskId,
    // presigned URL 有有效期(后端 expires_in),不频繁重取。
    staleTime: 5 * 60 * 1000,
  });
}
