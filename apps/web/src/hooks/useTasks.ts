import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi, type AnnotationPayload, type AnnotationUpdatePayload, type TaskListParams } from "../api/tasks";

export function useTaskList(projectId: string | undefined, params?: TaskListParams) {
  return useQuery({
    queryKey: ["tasks", projectId, params],
    queryFn: () => tasksApi.listByProject(projectId!, params),
    enabled: !!projectId,
  });
}

export function useNextTask(projectId: string | undefined) {
  return useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error("No project selected");
      return tasksApi.getNext(projectId);
    },
  });
}

export function useTask(id: string) {
  return useQuery({
    queryKey: ["task", id],
    queryFn: () => tasksApi.get(id),
    enabled: !!id,
  });
}

export function useAnnotations(taskId: string | undefined) {
  return useQuery({
    queryKey: ["annotations", taskId],
    queryFn: () => tasksApi.getAnnotations(taskId!),
    enabled: !!taskId,
  });
}

export function useCreateAnnotation(taskId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AnnotationPayload) => {
      if (!taskId) throw new Error("No task selected");
      return tasksApi.createAnnotation(taskId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDeleteAnnotation(taskId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (annotationId: string) => {
      if (!taskId) throw new Error("No task selected");
      return tasksApi.deleteAnnotation(taskId, annotationId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useUpdateAnnotation(taskId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ annotationId, payload }: { annotationId: string; payload: AnnotationUpdatePayload }) => {
      if (!taskId) throw new Error("No task selected");
      return tasksApi.updateAnnotation(taskId, annotationId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations", taskId] });
    },
  });
}

export function useSubmitTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasksApi.submit(taskId),
    onSuccess: (_, taskId) => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["annotations", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useApproveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasksApi.approve(taskId),
    onSuccess: (_, taskId) => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useRejectTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason?: string }) =>
      tasksApi.reject(taskId, reason),
    onSuccess: (_, { taskId }) => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
