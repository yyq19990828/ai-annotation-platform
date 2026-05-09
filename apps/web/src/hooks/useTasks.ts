import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi, type AnnotationPayload, type AnnotationUpdatePayload, type TaskListParams } from "../api/tasks";
import type { AnnotationResponse } from "@/types";
import { ApiError } from "../api/client";

const TASK_PAGE_SIZE = 100;

export class ConflictError extends Error {
  constructor(
    message: string,
    public currentVersion: number,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

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

export function useNextTask(projectId: string | undefined, batchId?: string) {
  return useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error("No project selected");
      return tasksApi.getNext(projectId, batchId || undefined);
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
    // B-19：乐观写入 tmp 条目，避免 pendingDrawing 被清后到 refetch 返回前出现空白闪烁。
    onMutate: async (payload) => {
      if (!taskId) return { prev: undefined, tmpId: undefined };
      await qc.cancelQueries({ queryKey: ["annotations", taskId] });
      const prev = qc.getQueryData<AnnotationResponse[]>(["annotations", taskId]);
      const tmpId = `tmp_${crypto.randomUUID()}`;
      const optimistic: AnnotationResponse = {
        id: tmpId,
        task_id: taskId,
        project_id: null,
        user_id: null,
        source: "manual",
        annotation_type: payload.annotation_type ?? "bbox",
        class_name: payload.class_name,
        geometry: payload.geometry,
        confidence: payload.confidence ?? 1,
        parent_prediction_id: null,
        parent_annotation_id: null,
        lead_time: null,
        is_active: true,
        ground_truth: false,
        attributes: payload.attributes ?? {},
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      qc.setQueryData<AnnotationResponse[]>(
        ["annotations", taskId],
        (old) => [...(old ?? []), optimistic],
      );
      return { prev, tmpId };
    },
    onError: (_err, _payload, ctx) => {
      // rollback；offline fallback（optimisticEnqueueCreate）会在同一同步流程内重新写入 tmp 条目，不会出现可见闪烁。
      if (ctx?.prev !== undefined) qc.setQueryData(["annotations", taskId], ctx.prev);
    },
    onSuccess: (created, _payload, ctx) => {
      if (ctx?.tmpId) {
        qc.setQueryData<AnnotationResponse[]>(
          ["annotations", taskId],
          (old) => (old ?? []).map((a) => (a.id === ctx.tmpId ? created : a)),
        );
      }
      qc.invalidateQueries({ queryKey: ["tasks"] });
      // B-20 接续：首条标注会把 task 从 pending 转 in_progress，需刷新批次进度
      qc.invalidateQueries({ queryKey: ["dashboard"] });
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
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateAnnotation(
  taskId: string | undefined,
  onConflict?: (annotationId: string, currentVersion: number) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ annotationId, payload, etag }: {
      annotationId: string;
      payload: AnnotationUpdatePayload;
      etag?: string;
    }) => {
      if (!taskId) throw new Error("No task selected");
      return tasksApi.updateAnnotation(taskId, annotationId, payload, etag);
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
    onError: (err, _vars, ctx) => {
      if (err instanceof ApiError && err.status === 409) {
        const detail = (err.detailRaw as { current_version?: number } | undefined);
        const annotationId = (_vars as { annotationId?: string } | undefined)?.annotationId ?? "";
        if (detail?.current_version && onConflict) {
          onConflict(annotationId, detail.current_version);
          return; // don't rollback — let user decide
        }
      }
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
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// v0.8.7 F7 · 跳过任务（标注员遇图像损坏 / 无目标 / 不清晰）
export function useSkipTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      reason,
      note,
    }: {
      taskId: string;
      reason: "image_corrupt" | "no_target" | "unclear" | "other";
      note?: string;
    }) => tasksApi.skip(taskId, { reason, note }),
    onSuccess: (_, { taskId }) => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
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
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRejectTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) =>
      tasksApi.reject(taskId, reason),
    onSuccess: (_, { taskId }) => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useWithdrawTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasksApi.withdraw(taskId),
    onSuccess: (_, taskId) => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useReopenTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasksApi.reopen(taskId),
    onSuccess: (_, taskId) => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["annotations", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useReviewClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasksApi.reviewClaim(taskId),
    onSuccess: (_, taskId) => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });
}
