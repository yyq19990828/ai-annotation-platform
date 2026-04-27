import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi, type AnnotationPayload } from "../api/tasks";

export function useTask(id: string) {
  return useQuery({
    queryKey: ["task", id],
    queryFn: () => tasksApi.get(id),
    enabled: !!id,
  });
}

export function useAnnotations(taskId: string) {
  return useQuery({
    queryKey: ["annotations", taskId],
    queryFn: () => tasksApi.getAnnotations(taskId),
    enabled: !!taskId,
  });
}

export function useCreateAnnotation(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AnnotationPayload) =>
      tasksApi.createAnnotation(taskId, payload),
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
    },
  });
}
