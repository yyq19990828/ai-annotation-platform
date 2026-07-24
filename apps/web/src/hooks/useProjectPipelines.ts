import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  projectPipelinesApi,
  type ProjectPipelineCreatePayload,
  type ProjectPipelineListParams,
  type ProjectPipelineUpdatePayload,
} from "@/api/projectPipelines";

export const projectPipelinesQueryKey = (params?: ProjectPipelineListParams) =>
  ["project-pipelines", params ?? {}] as const;

export function useProjectPipelines(
  params?: ProjectPipelineListParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: projectPipelinesQueryKey(params),
    queryFn: () => projectPipelinesApi.list(params),
    enabled: options?.enabled ?? true,
  });
}

export function useCreateProjectPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProjectPipelineCreatePayload) => projectPipelinesApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-pipelines"] });
    },
  });
}

export function useUpdateProjectPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProjectPipelineUpdatePayload }) =>
      projectPipelinesApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-pipelines"] });
    },
  });
}

export function useDeleteProjectPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectPipelinesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-pipelines"] });
    },
  });
}

export function useApplyProjectPipeline(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, setDefault }: { pipelineId: string; setDefault: boolean }) => {
      if (!projectId) throw new Error("No project selected");
      return projectPipelinesApi.apply(projectId, {
        pipeline_id: pipelineId,
        set_default: setDefault,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-pipelines"] });
      if (projectId) qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}
