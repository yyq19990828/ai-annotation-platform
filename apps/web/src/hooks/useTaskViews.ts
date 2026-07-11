import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  taskViewsApi,
  type ProjectTaskQueryPayload,
  type ProjectTaskViewPayload,
  type ProjectTaskViewUpdatePayload,
} from "@/api/taskViews";

export function useTaskViews(projectId: string | undefined) {
  return useQuery({
    queryKey: ["task-views", projectId],
    queryFn: () => taskViewsApi.list(projectId!),
    enabled: !!projectId,
  });
}

export function useProjectTaskQuery(
  projectId: string | undefined,
  payload: ProjectTaskQueryPayload,
  enabled = true,
) {
  return useQuery({
    queryKey: ["project-task-query", projectId, payload],
    queryFn: () => taskViewsApi.query(projectId!, payload),
    enabled: !!projectId && enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDataManagerSchema(projectId: string | undefined) {
  return useQuery({
    queryKey: ["data-manager-schema", projectId],
    queryFn: () => taskViewsApi.schema(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

export function useDataManagerSummary(
  projectId: string | undefined,
  filterJson: Record<string, unknown>,
  enabled = true,
) {
  return useQuery({
    queryKey: ["data-manager-summary", projectId, filterJson],
    queryFn: () => taskViewsApi.summary(projectId!, filterJson),
    enabled: !!projectId && enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDataManagerMatches(
  projectId: string | undefined,
  taskId: string | null,
  filterJson: Record<string, unknown>,
  enabled = true,
) {
  return useQuery({
    queryKey: ["data-manager-matches", projectId, taskId, filterJson],
    queryFn: () => taskViewsApi.matches(projectId!, taskId!, filterJson),
    enabled: !!projectId && !!taskId && enabled,
  });
}

export function useCreateTaskView(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProjectTaskViewPayload) => taskViewsApi.create(projectId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-views", projectId] });
    },
  });
}

export function useUpdateTaskView(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ viewId, payload }: { viewId: string; payload: ProjectTaskViewUpdatePayload }) =>
      taskViewsApi.update(projectId, viewId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-views", projectId] });
      qc.invalidateQueries({ queryKey: ["project-task-query", projectId] });
    },
  });
}

export function useDeleteTaskView(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (viewId: string) => taskViewsApi.remove(projectId, viewId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-views", projectId] });
    },
  });
}

export function useCopyTaskView(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ viewId, name }: { viewId: string; name?: string }) =>
      taskViewsApi.copy(projectId, viewId, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-views", projectId] });
    },
  });
}
