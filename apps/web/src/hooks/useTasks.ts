import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi, type AnnotationPayload, type AnnotationUpdatePayload, type TaskListParams } from "../api/tasks";
import type { AnnotationResponse } from "@/types";

const TASK_PAGE_SIZE = 100;

export function useTaskList(projectId: string | undefined, params?: TaskListParams) {
  return useInfiniteQuery({
    queryKey: ["tasks", projectId, params],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      tasksApi.listByProject(projectId!, { ...params, limit: TASK_PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
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
    onMutate: async (annotationId) => {
      await qc.cancelQueries({ queryKey: ["annotations", taskId] });
      const prev = qc.getQueryData<AnnotationResponse[]>(["annotations", taskId]);
      qc.setQueryData<AnnotationResponse[]>(
        ["annotations", taskId],
        (old) => (old ?? []).filter((a) => a.id !== annotationId),
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["annotations", taskId], ctx.prev);
    },
    onSettled: () => {
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
    onMutate: async ({ annotationId, payload }) => {
      await qc.cancelQueries({ queryKey: ["annotations", taskId] });
      const prev = qc.getQueryData<AnnotationResponse[]>(["annotations", taskId]);
      qc.setQueryData<AnnotationResponse[]>(
        ["annotations", taskId],
        (old) => (old ?? []).map((a) =>
          a.id === annotationId
            ? {
                ...a,
                ...(payload.geometry ? { geometry: payload.geometry } : {}),
                ...(payload.class_name ? { class_name: payload.class_name } : {}),
                ...(payload.attributes !== undefined ? { attributes: payload.attributes } : {}),
              }
            : a,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["annotations", taskId], ctx.prev);
    },
    onSettled: () => {
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
