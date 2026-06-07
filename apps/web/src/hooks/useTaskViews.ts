import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
) {
  return useQuery({
    queryKey: ["project-task-query", projectId, payload],
    queryFn: () => taskViewsApi.query(projectId!, payload),
    enabled: !!projectId,
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
