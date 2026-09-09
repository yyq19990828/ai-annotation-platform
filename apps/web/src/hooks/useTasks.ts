import { useCallback } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
  type MutateOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  tasksApi,
  type AnnotationPayload,
  type AnnotationUpdatePayload,
  type TaskListParams,
} from "../api/tasks";
import type { AnnotationResponse, TaskResponse } from "@/types";
import { ApiError } from "../api/client";
import { randomId } from "@/utils/id";

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
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      tasksApi.listByProject(
        projectId!,
        { ...params, limit: TASK_PAGE_SIZE, cursor: pageParam },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: !!projectId,
  });
}

/**
 * Merge task pages while keeping the first occurrence of each task.
 * Cursor pages can overlap when a task changes during a refresh; rendering a
 * task twice would make counts, bulk selection, and the load-more boundary
 * misleading.
 */
export function flattenTaskPages(
  pages: Array<{ items: TaskResponse[] }> | undefined,
): TaskResponse[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const tasks: TaskResponse[] = [];
  for (const page of pages) {
    for (const task of page.items) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      tasks.push(task);
    }
  }
  return tasks;
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
    queryFn: ({ signal }) => tasksApi.get(id, { signal }),
    enabled: !!id,
  });
}

export function useMaskCapabilities(taskId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["task-mask-capabilities", taskId],
    queryFn: ({ signal }) => tasksApi.getMaskCapabilities(taskId!, { signal }),
    enabled: !!taskId && enabled,
    staleTime: 30_000,
  });
}

export function useVideoManifest(taskId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["task-video-manifest", taskId],
    queryFn: ({ signal }) => tasksApi.getVideoManifest(taskId!, { signal }),
    enabled: !!taskId && enabled,
  });
}

export function useVideoFrameTimetable(taskId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["task-video-frame-timetable", taskId],
    queryFn: ({ signal }) => tasksApi.getVideoFrameTimetable(taskId!, undefined, { signal }),
    enabled: !!taskId && enabled,
    staleTime: Infinity,
  });
}

export function useAnnotations(
  taskId: string | undefined,
  videoSegmentId?: string | null,
  enabled = true,
) {
  const queryKey = videoSegmentId
    ? (["annotations", taskId, videoSegmentId] as const)
    : (["annotations", taskId] as const);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => tasksApi.getAnnotations(taskId!, videoSegmentId, { signal }),
    enabled: !!taskId && enabled,
  });
}

interface CreateAnnotationVariables {
  readonly taskId: string | undefined;
  readonly videoSegmentId: string | null | undefined;
  readonly payload: AnnotationPayload;
}

interface CreateAnnotationContext {
  prev: AnnotationResponse[] | undefined;
  tmpId: string | undefined;
}

type CreateAnnotationOptions = MutateOptions<
  AnnotationResponse,
  Error,
  AnnotationPayload,
  CreateAnnotationContext
>;

function createAnnotationQueryKey({ taskId, videoSegmentId }: CreateAnnotationVariables) {
  return videoSegmentId
    ? (["annotations", taskId, videoSegmentId] as const)
    : (["annotations", taskId] as const);
}

export function useCreateAnnotation(taskId: string | undefined, videoSegmentId?: string | null) {
  const qc = useQueryClient();
  const mutation = useMutation<
    AnnotationResponse,
    Error,
    CreateAnnotationVariables,
    CreateAnnotationContext
  >({
    // Transport failures must reach the existing durable offline queue instead
    // of leaving a creation draft paused indefinitely inside TanStack Query.
    networkMode: "always",
    // Pending mutations receive new options after a rerender. Their variables
    // retain the submitted owner, including while onMutate awaits cancellation.
    mutationFn: ({ taskId, videoSegmentId, payload }) => {
      if (!taskId) throw new Error("No task selected");
      return tasksApi.createAnnotation(
        taskId,
        videoSegmentId ? { ...payload, video_segment_id: videoSegmentId } : payload,
      );
    },
    // B-19：乐观写入 tmp 条目，避免 pendingDrawing 被清后到 refetch 返回前出现空白闪烁。
    onMutate: async (variables) => {
      const { taskId, videoSegmentId, payload } = variables;
      if (!taskId) return { prev: undefined, tmpId: undefined };
      const queryKey = createAnnotationQueryKey(variables);
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<AnnotationResponse[]>(queryKey);
      const tmpId = `tmp_${randomId()}`;
      const optimistic: AnnotationResponse = {
        id: tmpId,
        task_id: taskId,
        video_segment_id: videoSegmentId ?? null,
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
        render_key: tmpId,
      };
      qc.setQueryData<AnnotationResponse[]>(queryKey, (old) => [...(old ?? []), optimistic]);
      return { prev, tmpId };
    },
    onError: (_err, variables, ctx) => {
      // rollback；offline fallback（optimisticEnqueueCreate）会在同一同步流程内重新写入 tmp 条目，不会出现可见闪烁。
      // Other requests or a refetch may have updated this cache since onMutate.
      if (ctx?.tmpId) {
        qc.setQueryData<AnnotationResponse[]>(createAnnotationQueryKey(variables), (old) =>
          old?.filter((annotation) => annotation.id !== ctx.tmpId),
        );
      }
    },
    onSuccess: (created, variables, ctx) => {
      if (ctx?.tmpId) {
        qc.setQueryData<AnnotationResponse[]>(createAnnotationQueryKey(variables), (old = []) => {
          // Returning to the task can refetch away the optimistic row, or already
          // fetch the created annotation. Keep newer cache data and avoid duplicates.
          if (old.some((annotation) => annotation.id === created.id))
            return old.filter((annotation) => annotation.id !== ctx.tmpId);
          const optimistic = old.find((annotation) => annotation.id === ctx.tmpId);
          const saved = { ...created, render_key: optimistic?.render_key ?? ctx.tmpId };
          return optimistic
            ? old.map((annotation) => (annotation.id === ctx.tmpId ? saved : annotation))
            : [...old, saved];
        });
      }
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["scene-timeline"] });
      // B-20 接续：首条标注会把 task 从 pending 转 in_progress，需刷新批次进度
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const { mutateAsync: runMutation } = mutation;
  const mutateAsync = useCallback(
    (payload: AnnotationPayload, options?: CreateAnnotationOptions) =>
      runMutation(
        { taskId, videoSegmentId, payload },
        options && {
          onSuccess: (created, variables, context, mutationContext) =>
            options.onSuccess?.(created, variables.payload, context, mutationContext),
          onError: (error, variables, context, mutationContext) =>
            options.onError?.(error, variables.payload, context, mutationContext),
          onSettled: (created, error, variables, context, mutationContext) =>
            options.onSettled?.(created, error, variables.payload, context, mutationContext),
        },
      ),
    [runMutation, taskId, videoSegmentId],
  );
  const mutate = useCallback(
    (payload: AnnotationPayload, options?: CreateAnnotationOptions) => {
      // Match useMutation's fire-and-forget API; mutateAsync still rejects.
      void mutateAsync(payload, options).catch(() => undefined);
    },
    [mutateAsync],
  );
  // Unwrap only variables; TanStack still owns status, callbacks and reset behavior.
  return {
    ...mutation,
    variables: mutation.variables?.payload,
    mutate,
    mutateAsync,
  } as UseMutationResult<AnnotationResponse, Error, AnnotationPayload, CreateAnnotationContext>;
}

export function useDeleteAnnotation(taskId: string | undefined, videoSegmentId?: string | null) {
  const qc = useQueryClient();
  const queryKey = videoSegmentId
    ? (["annotations", taskId, videoSegmentId] as const)
    : (["annotations", taskId] as const);
  return useMutation({
    mutationFn: (annotationId: string) => {
      if (!taskId) throw new Error("No task selected");
      return tasksApi.deleteAnnotation(taskId, annotationId);
    },
    onMutate: async (annotationId) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<AnnotationResponse[]>(queryKey);
      qc.setQueryData<AnnotationResponse[]>(queryKey, (old) =>
        (old ?? []).filter((a) => a.id !== annotationId),
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["scene-timeline"] });
    },
  });
}

export function useUpdateAnnotation(
  taskId: string | undefined,
  onConflict?: (annotationId: string, currentVersion: number) => void,
  onSettledAnnotation?: (annotationId: string) => void,
  videoSegmentId?: string | null,
) {
  const qc = useQueryClient();
  const queryKey = videoSegmentId
    ? (["annotations", taskId, videoSegmentId] as const)
    : (["annotations", taskId] as const);
  return useMutation({
    mutationFn: ({
      annotationId,
      payload,
      etag,
    }: {
      annotationId: string;
      payload: AnnotationUpdatePayload;
      etag?: string;
    }) => {
      if (!taskId) throw new Error("No task selected");
      return tasksApi.updateAnnotation(taskId, annotationId, payload, etag);
    },
    onMutate: async ({ annotationId, payload }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<AnnotationResponse[]>(queryKey);
      qc.setQueryData<AnnotationResponse[]>(queryKey, (old) =>
        (old ?? []).map((a) =>
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
        const detail = err.detailRaw as { current_version?: number } | undefined;
        const annotationId = (_vars as { annotationId?: string } | undefined)?.annotationId ?? "";
        if (detail?.current_version && onConflict) {
          onConflict(annotationId, detail.current_version);
        }
      }
      if (ctx?.prev !== undefined) qc.setQueryData(queryKey, ctx.prev);
    },
    onSuccess: (annotation) => {
      qc.setQueryData<AnnotationResponse[]>(queryKey, (old) =>
        (old ?? []).map((item) => (item.id === annotation.id ? annotation : item)),
      );
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["scene-timeline"] });
      // 通知桥 (usePendingGeom): mutation 已 settle (成功或失败), 主动清 pending override,
      // 不依赖被动 800ms 兜底 — 避免慢网 (> 800ms) 回滚后 pending 已 drop 而画面闪到旧几何。
      const annotationId = (vars as { annotationId?: string } | undefined)?.annotationId;
      if (annotationId && onSettledAnnotation) onSettledAnnotation(annotationId);
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
    mutationFn: ({
      taskId,
      reason_type,
      reason,
    }: {
      taskId: string;
      reason_type: "missing" | "extra" | "wrong_label" | "wrong_geometry";
      reason?: string;
    }) => tasksApi.reject(taskId, { reason_type, reason }),
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

export function useAcceptRejection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasksApi.acceptRejection(taskId),
    onSuccess: (_, taskId) => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
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
